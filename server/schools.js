const { parse } = require('csv-parse/sync');
const { normalizeSchoolNumber } = require('./importer');

const DEFAULT_SCHOOLS_URL = 'https://docs.google.com/spreadsheets/d/1RQo06DqRHv24M8bh1CmJbOl4c_GmoLPXKkHK_sVIoI8/edit?usp=sharing';
const MAX_SHEET_BYTES = 8_000_000;

function parseSchoolCsv(buffer) {
  let records;
  try {
    records = parse(buffer, { bom: true, skip_empty_lines: true, trim: true, max_record_size: 100_000 });
  } catch {
    throw new Error('ملف CSV غير صالح. تحقق من ترميز UTF-8 وعلامات الاقتباس.');
  }
  const headers = new Map((records[0] || []).map((value, index) => [
    String(value).normalize('NFKC').replace(/[\u200e\u200f\u202a-\u202e]/g, '').trim().toLowerCase(),
    index
  ]));
  const find = (aliases, fallbackIndex) => aliases.map((alias) => headers.get(alias)).find((index) => index !== undefined) ?? fallbackIndex;
  const numberColumn = find(['رقم المدرسة', 'الرقم الوزاري', 'رقم المدرسة الوزاري', 'school number', 'school code']);
  const nameColumn = find(['اسم المدرسة', 'اسم المبنى', 'اسم الموقع', 'school name', 'site name', 'name']);
  const supervisorColumn = find(['مشرف الشركة', 'المشرف', 'اسم المشرف', 'المشرف المسؤول', 'supervisor', 'المسئول']);
  const regionColumn = find(['المنطقة', 'الإدارة', 'region', 'area', 'العنوان', 'زون', 'zone']);
  const schoolTypeColumn = find(['نوع المدرسة', 'نوع الموقع', 'school type', 'site type', 'gender'], 19);
  const buildingTypeColumn = find(['نوع المبنى', 'نوع المبني', 'building type', 'building_type'], 15);
  const occupancySizeColumn = find(['occupancy_size', 'occupancy size', 'حجم الإشغال', 'حجم الاشغال'], 21);
  if (numberColumn === undefined || nameColumn === undefined) throw new Error('يلزم وجود عمود رقم المدرسة وعمود اسم المدرسة.');

  const uniqueSchools = new Map();
  for (const record of records.slice(1)) {
    const number = normalizeSchoolNumber(record[numberColumn]);
    const name = String(record[nameColumn] || '').trim().slice(0, 250);
    if (!number || !name) continue;
    uniqueSchools.set(number, {
      number,
      name,
      supervisor: supervisorColumn === undefined ? '' : String(record[supervisorColumn] || '').trim().slice(0, 150),
      region: regionColumn === undefined ? '' : String(record[regionColumn] || '').trim().slice(0, 250),
      schoolType: schoolTypeColumn === undefined ? '' : String(record[schoolTypeColumn] || '').trim().slice(0, 100),
      buildingType: buildingTypeColumn === undefined ? '' : String(record[buildingTypeColumn] || '').trim().slice(0, 100),
      occupancySize: occupancySizeColumn === undefined ? '' : String(record[occupancySizeColumn] || '').trim().slice(0, 100)
    });
  }
  const schools = [...uniqueSchools.values()];
  if (!schools.length) throw new Error('لم يتم العثور على مدارس صالحة في الملف.');
  return schools;
}

function toGoogleCsvUrl(value) {
  const sharedUrl = new URL(value);
  if (sharedUrl.protocol !== 'https:' || sharedUrl.hostname.toLowerCase() !== 'docs.google.com') {
    throw new Error('الرابط يجب أن يكون HTTPS من Google Sheets أو Microsoft 365.');
  }
  const match = sharedUrl.pathname.match(/^\/spreadsheets\/d\/([a-zA-Z0-9_-]+)(?:\/|$)/);
  if (!match) throw new Error('الرابط ليس رابط مشاركة صالحًا لـ Google Sheets.');
  const exportUrl = new URL(`https://docs.google.com/spreadsheets/d/${match[1]}/export`);
  exportUrl.searchParams.set('format', 'csv');
  const gid = sharedUrl.searchParams.get('gid');
  if (gid && /^\d+$/.test(gid)) exportUrl.searchParams.set('gid', gid);
  return exportUrl;
}

async function readLimitedResponse(response) {
  const declaredSize = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_SHEET_BYTES) {
    throw Object.assign(new Error('حجم ملف المدارس يتجاوز 8 ميجابايت.'), { status: 413 });
  }
  if (!response.body) throw new Error('تعذر قراءة استجابة الشيت.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_SHEET_BYTES) {
      await reader.cancel();
      throw Object.assign(new Error('حجم ملف المدارس يتجاوز 8 ميجابايت.'), { status: 413 });
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function fetchSchoolCsv(value, fetchImpl = fetch) {
  const source = new URL(value);
  let target = source.hostname.toLowerCase() === 'docs.google.com' ? toGoogleCsvUrl(value) : source;
  if (target.protocol !== 'https:' || !(
    target.hostname === 'docs.google.com' ||
    target.hostname.endsWith('.sharepoint.com') ||
    target.hostname === 'onedrive.live.com' ||
    target.hostname === 'www.office.com'
  )) throw new Error('استخدم رابط HTTPS من Google Sheets أو Microsoft 365.');

  let response = await fetchImpl(target, { signal: AbortSignal.timeout(12_000), redirect: 'manual' });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get('location');
    if (!location) throw new Error('تعذر متابعة رابط الشيت.');
    target = new URL(location, target);
    const trustedGoogleExport = target.protocol === 'https:' &&
      (target.hostname === 'googleusercontent.com' || target.hostname.endsWith('.googleusercontent.com'));
    if (!trustedGoogleExport) throw new Error('تم رفض تحويل غير آمن أثناء جلب الشيت.');
    response = await fetchImpl(target, { signal: AbortSignal.timeout(12_000), redirect: 'error' });
  }
  if (!response.ok) throw Object.assign(new Error(`تعذر جلب الشيت (HTTP ${response.status}).`), { status: 502 });
  return readLimitedResponse(response);
}

module.exports = { DEFAULT_SCHOOLS_URL, parseSchoolCsv, toGoogleCsvUrl, fetchSchoolCsv };

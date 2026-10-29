const { parse } = require('csv-parse/sync');
const { normalizeSchoolNumber } = require('./importer');

const DEFAULT_SCHOOLS_URL = 'https://docs.google.com/spreadsheets/d/1RQo06DqRHv24M8bh1CmJbOl4c_GmoLPXKkHK_sVIoI8/edit?usp=sharing';
const MAX_SHEET_BYTES = 8_000_000;

function normalizeHeader(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u200e\u200f\u202a-\u202e\u064b-\u065f\u0670\u0640]/g, '')
    .toLocaleLowerCase('ar')
    .replace(/[إأآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function displayHeader(header, index, headers) {
  const normalized = normalizeHeader(header);
  const labels = {
    id: 'معرّف السجل',
    maintenance: 'الصيانة',
    stage: 'المرحلة',
    gender: 'النوع',
    'occupancy size': 'حجم المبنى',
    'study time': 'الفترة الدراسية',
    الشماليات: 'خط العرض',
    الشرقيات: 'خط الطول'
  };
  if (labels[normalized]) return labels[normalized];
  if (['رقم الجوال', 'رقم الاتصال', 'رقم التواصل', 'رقم الهاتف', 'الجوال'].includes(normalized)) {
    const role = normalizeHeader(headers[index - 1] || headers[index + 1] || '');
    const suffix = /المسئول|المسؤول|مسؤول/.test(role) ? 'للمسؤول'
      : /مشرف.*نظافة/.test(role) ? 'لمشرف النظافة'
      : /مشرف.*صيانة/.test(role) ? 'لمشرف الصيانة'
        : /مشرف.*شركة/.test(role) ? 'لمشرف الشركة'
          : /مهندس.*مقاول/.test(role) ? 'لمهندس المقاول'
            : /مهندس.*شركة/.test(role) ? 'لمهندس الشركة'
            : /مهندس.*مرافق/.test(role) ? 'لمهندس المرافق'
              : /بواب/.test(role) ? 'للبواب'
                : /مدير/.test(role) ? 'لمدير المدرسة'
                : /عامل.*نظافة/.test(role) ? `لـ${role.replace(/^اسم\s*/, '')}`
                    : '';
    return suffix ? `${String(header).trim()} ${suffix}` : String(header).trim();
  }
  return String(header).trim() || `بيان ${index + 1}`;
}

function getSchoolMapCoordinates(sourceData) {
  const latitudeField = sourceData?.find((field) => normalizeHeader(field.label) === normalizeHeader('خط العرض'));
  const longitudeField = sourceData?.find((field) => normalizeHeader(field.label) === normalizeHeader('خط الطول'));
  if (!latitudeField || !longitudeField) return null;
  const latitude = Number(latitudeField.value);
  const longitude = Number(longitudeField.value);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const isSaudiLocation = (lat, lon) => lat >= 16 && lat <= 33.5 && lon >= 34 && lon <= 56.5;
  if (isSaudiLocation(latitude, longitude)) return { latitude, longitude, swapped: false };
  if (isSaudiLocation(longitude, latitude)) return { latitude: longitude, longitude: latitude, swapped: true };
  return null;
}

function normalizeSchoolCoordinateLabels(sourceData) {
  const coordinates = getSchoolMapCoordinates(sourceData);
  if (!coordinates?.swapped) return sourceData;
  return sourceData.map((field) => {
    if (normalizeHeader(field.label) === normalizeHeader('خط العرض')) return { ...field, label: 'خط الطول' };
    if (normalizeHeader(field.label) === normalizeHeader('خط الطول')) return { ...field, label: 'خط العرض' };
    return field;
  });
}

function parseSchoolCsv(buffer) {
  let records;
  try {
    records = parse(buffer, { bom: true, skip_empty_lines: true, trim: true, relax_column_count: true, max_record_size: 100_000 });
  } catch {
    throw new Error('ملف CSV غير صالح. تحقق من ترميز UTF-8 وعلامات الاقتباس.');
  }
  const rawHeaders = records[0] || [];
  if (!rawHeaders.length) throw new Error('ملف المدارس لا يحتوي على صف العناوين.');
  const columnCount = records.reduce((count, record) => Math.max(count, record.length), rawHeaders.length);
  const headers = new Map();
  rawHeaders.forEach((value, index) => {
    const normalized = normalizeHeader(value);
    if (!normalized) return;
    const matches = headers.get(normalized) || [];
    matches.push(index);
    headers.set(normalized, matches);
  });
  const find = (aliases) => [...new Set(aliases.map(normalizeHeader).flatMap((alias) => headers.get(alias) || []))];
  const numberColumns = find(['رقم المدرسة', 'الرقم الوزاري', 'رقم المدرسة الوزاري', 'school number', 'school code']);
  const nameColumns = find(['اسم المدرسة', 'اسم المبنى', 'اسم الموقع', 'school name', 'site name', 'name']);
  const supervisorColumns = find(['اسم المشرف صيانة', 'مشرف الشركة', 'المشرف', 'اسم المشرف', 'المشرف المسؤول', 'supervisor', 'المسئول']);
  const regionColumns = find(['المنطقة', 'الإدارة', 'region', 'area', 'العنوان', 'مكتب التعليم', 'الزون', 'زون', 'zone']);
  const schoolTypeColumns = find(['نوع المدرسة', 'نوع الموقع', 'school type', 'site type', 'gender', 'النوع', 'الجنس']);
  const buildingTypeColumns = find(['نوع المبنى', 'نوع المبني', 'building type', 'building_type']);
  const occupancySizeColumns = find(['حجم المبنى', 'حجم المدرسة', 'occupancy_size', 'occupancy size', 'حجم الإشغال', 'حجم الاشغال']);
  const latitudeColumns = find(['خط العرض', 'latitude', 'lat', 'الشماليات']);
  const longitudeColumns = find(['خط الطول', 'longitude', 'lon', 'lng', 'الشرقيات']);
  if (!numberColumns.length || !nameColumns.length) throw new Error('يلزم وجود عمود رقم المدرسة وعمود اسم المدرسة.');
  const valueFrom = (record, columns) => columns.map((index) => String(record[index] || '').trim()).find(Boolean) || '';

  const uniqueSchools = new Map();
  const duplicateHeaderCounts = new Map();
  const columnKeys = rawHeaders.map((header, index) => {
    const normalized = normalizeHeader(header);
    if (!normalized) return `blank:${index}`;
    const previousHeader = normalizeHeader(rawHeaders[index - 1]);
    const contactHeader = ['رقم الجوال', 'رقم الاتصال', 'رقم التواصل', 'رقم الهاتف', 'الجوال'].includes(normalized);
    if (contactHeader && previousHeader) return `column:${normalized}:after:${previousHeader}`;
    const occurrence = (duplicateHeaderCounts.get(normalized) || 0) + 1;
    duplicateHeaderCounts.set(normalized, occurrence);
    return `column:${normalized}:${occurrence}`;
  });
  for (const record of records.slice(1)) {
    const number = normalizeSchoolNumber(valueFrom(record, numberColumns));
    const name = valueFrom(record, nameColumns).slice(0, 250);
    if (!number || !name) continue;
    const sourceData = Array.from({ length: columnCount }, (_, index) => {
      const header = rawHeaders[index] || '';
      return {
      index,
      key: columnKeys[index] || `extra:${index}`,
      header: String(header),
      label: displayHeader(header, index, records[0]),
      value: String(record[index] || '').trim()
      };
    });
    uniqueSchools.set(number, {
      number,
      name,
      supervisor: valueFrom(record, supervisorColumns).slice(0, 150),
      region: valueFrom(record, regionColumns).slice(0, 250),
      schoolType: valueFrom(record, schoolTypeColumns).slice(0, 100),
      buildingType: valueFrom(record, buildingTypeColumns).slice(0, 100),
      occupancySize: valueFrom(record, occupancySizeColumns).slice(0, 100),
      latitude: valueFrom(record, latitudeColumns),
      longitude: valueFrom(record, longitudeColumns),
      sourceData
    });
  }
  const schools = [...uniqueSchools.values()];
  if (!schools.length) throw new Error('لم يتم العثور على مدارس صالحة في الملف.');
  return schools;
}

function mergeSchoolSourceData(previous, incoming) {
  const previousFields = Array.isArray(previous) ? previous : [];
  const incomingFields = Array.isArray(incoming) ? incoming : [];
  const usedPrevious = new Set();
  const previousByKey = new Map(previousFields.map((field, index) => [field.key, { field, index }]).filter(([key]) => key));
  const previousByLabel = new Map();
  for (const [index, field] of previousFields.entries()) {
    const label = normalizeHeader(field.label);
    if (!label) continue;
    const matches = previousByLabel.get(label) || [];
    matches.push({ field, index });
    previousByLabel.set(label, matches);
  }
  const merged = incomingFields.map((field) => {
    let match = field.key ? previousByKey.get(field.key) : null;
    if (!match) {
      const labelMatches = previousByLabel.get(normalizeHeader(field.label)) || [];
      if (labelMatches.length === 1) match = labelMatches[0];
    }
    if (!match && previousFields[field.index] && normalizeHeader(previousFields[field.index].label) === normalizeHeader(field.label)) {
      match = { field: previousFields[field.index], index: field.index };
    }
    if (!match) return field;
    usedPrevious.add(match.index);
    return { ...field, value: field.value || match.field.value || '' };
  });
  return [...merged, ...previousFields.filter((_, index) => !usedPrevious.has(index))];
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

module.exports = {
  DEFAULT_SCHOOLS_URL,
  parseSchoolCsv,
  mergeSchoolSourceData,
  getSchoolMapCoordinates,
  normalizeSchoolCoordinateLabels,
  toGoogleCsvUrl,
  fetchSchoolCsv
};

const { parse } = require('csv-parse/sync');

const ALIASES = {
  case_id: ['مُعرّف الحالة', 'معرف الحالة', 'رقم الحالة', 'رقم البلاغ', 'case id', 'case number', 'ticket id'],
  priority: ['الأولوية', 'priority'],
  status: ['الحالة', 'status', 'حالة البلاغ'],
  created_at: ['تاريخ الإنشاء', 'تاريخ الانشاء', 'تاريخ إنشاء الحالة', 'created', 'created at', 'creation date'],
  slm_status: ['حالة slm', 'حالة sla', 'slm status', 'sla status'],
  description: ['الوصف', 'description', 'ملخص البلاغ'],
  layer2: ['الطبقة 2 للفئة', 'الطبقة الثانية للفئة', 'الفئة', 'category layer 2'],
  layer3: ['الطبقة 3 للفئة', 'الطبقة الثالثة للفئة', 'الطبقة', 'category layer 3'],
  school_number: ['رقم المدرسة', 'الرقم الوزاري', 'رقم المدرسة الوزاري', 'school number', 'school code'],
  building_name: ['اسم المبنى', 'اسم المدرسة', 'school name', 'building name'],
  resolved_at: ['تاريخ الحل', 'تاريخ الإغلاق', 'resolved at', 'resolution date', 'closed at'],
  sla_due_at: ['تاريخ الاستحقاق', 'موعد الاستحقاق', 'sla due date', 'due date'],
  sla_remaining_minutes: ['الوقت المتبقي بالدقائق', 'المدة المتبقية', 'sla remaining minutes', 'remaining minutes'],
  needs_attention: ['بحاجة إلى الانتباه', 'بحاجه الى الانتباه', 'needs attention']
};

function normalizeHeader(value) {
  return String(value || '').normalize('NFKC').replace(/[\u200e\u200f\u202a-\u202e]/g, '').trim().toLocaleLowerCase('ar');
}

function normalizeSchoolNumber(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[\u200e\u200f\u202a-\u202e]/g, '')
    .trim()
    .replace(/^s\s*[-–—]\s*/i, '')
    .replace(/\s+/g, '');
}

function parseDate(value) {
  const raw = String(value || '').replace(/[\u200e\u200f\u202a-\u202e]/g, '').trim();
  if (!raw) return null;
  const iso = new Date(raw);
  if (!Number.isNaN(iso.getTime())) return iso.toISOString();

  const arabic = raw.replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
  const match = arabic.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,\s*(\d{1,2}):(\d{2}):(\d{2})\s*([^\s]+)?)?$/);
  if (!match) return null;
  let [, day, month, year, hour = '0', minute = '0', second = '0', period = ''] = match;
  hour = Number(hour);
  if (/م/.test(period) && hour < 12) hour += 12;
  if (/ص/.test(period) && hour === 12) hour = 0;
  if (hour > 23 || Number(minute) > 59 || Number(second) > 59) return null;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), hour, Number(minute), Number(second)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
  return new Date(date.getTime() - 180 * 60 * 1000).toISOString();
}

function parseOptionalNumber(value) {
  const raw = String(value || '').replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/٫/g, '.').trim();
  const match = raw.match(/-?\d+(?:[.,]\d+)?/);
  if (!match) return null;
  const number = Number(match[0].replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

function parseCsv(buffer) {
  let records;
  try {
    records = parse(buffer, {
      bom: true,
      columns: (headers) => headers.map((header) => String(header).replace(/^\uFEFF/, '').trim()),
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
      max_record_size: 100_000
    });
  } catch {
    throw new Error('ملف CSV غير صالح. تحقق من ترميز UTF-8 وعلامات الاقتباس.');
  }
  if (!records.length) throw new Error('ملف CSV لا يحتوي على صفوف بيانات.');
  const headers = Object.keys(records[0]);
  const normalized = new Map(headers.map((header) => [normalizeHeader(header), header]));
  const mapping = {};
  for (const [field, aliases] of Object.entries(ALIASES)) {
    mapping[field] = aliases.map(normalizeHeader).map((alias) => normalized.get(alias)).find(Boolean) || null;
  }
  const required = ['case_id', 'priority', 'status', 'created_at', 'slm_status', 'description', 'layer3'];
  const missing = required.filter((field) => !mapping[field]);
  if (!mapping.school_number && !mapping.building_name) missing.push('رقم المدرسة أو اسم المبنى');
  if (missing.length) throw new Error(`أعمدة مطلوبة غير موجودة: ${missing.join('، ')}`);
  const badDateRows = [];
  const tickets = records.map((record, index) => {
    const get = (field) => mapping[field] ? String(record[mapping[field]] || '').trim() : '';
    const caseId = get('case_id');
    const createdAt = parseDate(get('created_at'));
    if (!caseId) throw new Error(`معرّف الحالة فارغ في الصف ${index + 2}.`);
    if (!createdAt) badDateRows.push(index + 2);
    const attention = get('needs_attention');
    return {
      case_id: caseId,
      priority: get('priority'),
      status: get('status'),
      created_at: createdAt,
      slm_status: get('slm_status'),
      description: get('description').slice(0, 10_000),
      layer2: get('layer2'),
      layer3: get('layer3'),
      school_number: normalizeSchoolNumber(get('school_number')),
      building_name: get('building_name'),
      resolved_at: parseDate(get('resolved_at')),
      sla_due_at: parseDate(get('sla_due_at')),
      sla_remaining_minutes: parseOptionalNumber(get('sla_remaining_minutes')),
      needs_attention: /^(صواب|نعم|true|yes|1)$/i.test(attention) ? 1 : 0
    };
  });
  if (badDateRows.length) throw new Error(`تعذر فهم تاريخ الإنشاء في الصفوف: ${badDateRows.slice(0, 8).join('، ')}${badDateRows.length > 8 ? '…' : ''}`);
  return tickets;
}

module.exports = { parseCsv, normalizeSchoolNumber, parseDate };

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_SCHOOLS_URL,
  parseSchoolCsv,
  mergeSchoolSourceData,
  getSchoolMapCoordinates,
  normalizeSchoolCoordinateLabels,
  toGoogleCsvUrl,
  fetchSchoolCsv
} = require('./schools');

test('parses the published school-sheet headers and normalizes school numbers', () => {
  const csv = 'ID,اسم الموقع,الرقم الوزاري,العنوان,زون,مشرف الشركة,المسئول,نوع المدرسة\n1,مدرسة تجريبية,S- ١٢٣ ٤٥٦,منطقة الرياض,G2-Z6,مشرف تجريبي,مسؤول المدرسة,حكومية\n';
  const [school] = parseSchoolCsv(Buffer.from(csv));
  assert.equal(school.number, '123456');
  assert.equal(school.name, 'مدرسة تجريبية');
  assert.equal(school.supervisor, 'مشرف تجريبي');
  assert.equal(school.region, 'منطقة الرياض');
  assert.equal(school.schoolType, 'حكومية');
});

test('reads the published P, T, and V school attributes by their source headers', () => {
  const headers = Array(24).fill('');
  headers[2] = 'الرقم الوزاري';
  headers[3] = 'اسم الموقع';
  headers[15] = 'نوع المبني';
  headers[19] = 'gender';
  headers[21] = 'occupancy_size';
  const values = Array(24).fill('');
  values[2] = 'M-123456';
  values[3] = 'مدرسة تجريبية';
  values[15] = 'مبنى تعليمي';
  values[19] = 'بنين';
  values[21] = '350';
  const [school] = parseSchoolCsv(Buffer.from(`${headers.join(',')}\n${values.join(',')}\n`));
  assert.equal(school.number, 'M-123456');
  assert.equal(school.name, 'مدرسة تجريبية');
  assert.equal(school.buildingType, 'مبنى تعليمي');
  assert.equal(school.schoolType, 'بنين');
  assert.equal(school.occupancySize, '350');
});

test('preserves every school-sheet column, translates English headers, and retains coordinates', () => {
  const headers = [
    'ID', 'اسم الموقع', 'الرقم الوزاري', 'العنوان', 'زون', 'مجموعة', 'خط العرض', 'خط الطول',
    'المسئول', 'رقم الجوال', 'مشرف الشركة', 'رقم الجوال', 'مهندس الشركة', 'رقم الجوال',
    'نوع الملكية', 'نوع المبني', 'الحالة', 'maintenance', 'stage', 'gender',
    'فصول تعليمية', 'occupancy_size', 'study_time', 'المبنى الملحق'
  ];
  const values = [
    '10753', 'مدرسة تجريبية', '123456', 'الرياض', 'G2-Z6', '1', '24.74895617', '46.63827736',
    'المسؤول', '500000001', 'المشرف', '500000002', 'المهندس', '500000003',
    'مستقل', 'كبير', 'مستخدم', 'تشغيل وصيانة', 'المتوسطة', 'بنين',
    '12', 'كبير', 'صباح', 'ملحق'
  ];
  const [school] = parseSchoolCsv(Buffer.from(`${headers.join(',')}\n${values.join(',')}\n`));
  assert.equal(school.sourceData.length, 24);
  assert.deepEqual(school.sourceData.slice(0, 3).map((field) => field.label), ['معرّف السجل', 'اسم الموقع', 'الرقم الوزاري']);
  assert.deepEqual(school.sourceData.slice(9, 14).map((field) => field.label), [
    'رقم الجوال للمسؤول', 'مشرف الشركة', 'رقم الجوال لمشرف الشركة', 'مهندس الشركة', 'رقم الجوال لمهندس الشركة'
  ]);
  assert.ok(school.sourceData.some((field) => field.label === 'الصيانة' && field.value === 'تشغيل وصيانة'));
  assert.ok(school.sourceData.some((field) => field.label === 'المرحلة' && field.value === 'المتوسطة'));
  assert.ok(school.sourceData.some((field) => field.label === 'النوع' && field.value === 'بنين'));
  assert.ok(school.sourceData.some((field) => field.label === 'حجم المبنى' && field.value === 'كبير'));
  assert.ok(school.sourceData.some((field) => field.label === 'الفترة الدراسية' && field.value === 'صباح'));
  assert.equal(school.latitude, '24.74895617');
  assert.equal(school.longitude, '46.63827736');
});

test('does not infer school attributes from fixed column positions after a sheet layout change', () => {
  const headers = Array(24).fill('');
  headers[1] = 'رقم المدرسة';
  headers[2] = 'اسم المدرسة';
  headers[15] = 'حقل P';
  headers[19] = 'حقل T';
  headers[21] = 'حقل V';
  const values = Array(24).fill('');
  values[1] = '123456';
  values[2] = 'مدرسة تجريبية';
  values[15] = 'مدرسة حكومية';
  values[19] = 'بنات';
  values[21] = '275';
  const [school] = parseSchoolCsv(Buffer.from(`${headers.join(',')}\n${values.join(',')}\n`));
  assert.equal(school.buildingType, '');
  assert.equal(school.schoolType, '');
  assert.equal(school.occupancySize, '');
  assert.ok(school.sourceData.some((field) => field.label === 'حقل P' && field.value === 'مدرسة حكومية'));
  assert.ok(school.sourceData.some((field) => field.label === 'حقل T' && field.value === 'بنات'));
  assert.ok(school.sourceData.some((field) => field.label === 'حقل V' && field.value === '275'));
});

test('parses the expanded 40-column school sheet by header names', () => {
  const headers = [
    'م', 'المبني ', 'الرقم الوزاري', 'اسم المدرسة ', 'العنوان', 'نوع المبنى', 'مكتب التعليم', 'النوع',
    'المرحلة', 'الملكية', 'الحي', 'حالة الوحدة', 'مقاول النظافة', 'مقاول الصيانه',
    'مقاول الامن و السلامة', 'مقاول المصاعد', 'مقاول التكييف', 'عدد الفصول', 'حجم المدرسة',
    'حجم المبنى', 'الزون', 'الشرقيات', 'الشماليات', 'اسم مهندس المقاول', 'رقم الاتصال',
    'اسم المشرف (صيانة)', 'رقم الاتصال', 'اسم المشرف (نظافة)', 'رقم التواصل', 'البواب',
    'رقم الاتصال', 'اسم المدير / ة', 'رقم الاتصال', 'ايميل مدير/ة المدرسة', 'اسم مهندس المرافق',
    'رقم الاتصال', 'اسم عامل النظافة 1', 'رقم التواصل', 'اسم عامل النظافة2', 'رقم التواصل'
  ];
  const values = Array(headers.length).fill('');
  Object.assign(values, {
    2: '123456',
    3: 'مدرسة تجريبية',
    4: 'الرياض',
    5: 'مبنى تعليمي',
    6: 'مكتب شمال الرياض',
    7: 'بنين',
    8: 'متوسطة',
    12: 'شركة النظافة',
    18: 'متوسط',
    19: 'كبير',
    21: '46.63827736',
    22: '24.74895617',
    23: 'مهندس المقاول',
    24: '500000001',
    25: 'مشرف الصيانة',
    26: '500000002',
    27: 'مشرف النظافة',
    28: '500000003',
    31: 'مدير المدرسة',
    32: '500000004',
    33: 'school@example.test',
    34: 'مهندس المرافق',
    35: '500000005'
  });
  const [school] = parseSchoolCsv(Buffer.from(`${headers.join(',')}\n${values.join(',')}\n`));
  assert.equal(school.number, '123456');
  assert.equal(school.name, 'مدرسة تجريبية');
  assert.equal(school.region, 'الرياض');
  assert.equal(school.supervisor, 'مشرف الصيانة');
  assert.equal(school.buildingType, 'مبنى تعليمي');
  assert.equal(school.schoolType, 'بنين');
  assert.equal(school.occupancySize, 'كبير');
  assert.equal(school.longitude, '46.63827736');
  assert.equal(school.latitude, '24.74895617');
  assert.equal(school.sourceData.length, 40);
  assert.equal(new Set(school.sourceData.map((field) => field.key)).size, 40);
  assert.ok(school.sourceData.some((field) => field.label === 'رقم الاتصال لمهندس المقاول' && field.value === '500000001'));
  assert.ok(school.sourceData.some((field) => field.label === 'رقم الاتصال لمشرف الصيانة' && field.value === '500000002'));
  assert.ok(school.sourceData.some((field) => field.label === 'رقم التواصل لمشرف النظافة' && field.value === '500000003'));
  assert.ok(school.sourceData.some((field) => field.label === 'رقم الاتصال لمدير المدرسة' && field.value === '500000004'));
  assert.ok(school.sourceData.some((field) => field.label === 'خط الطول' && field.value === '46.63827736'));
  assert.ok(school.sourceData.some((field) => field.label === 'خط العرض' && field.value === '24.74895617'));
});

test('uses the next populated named column when a preferred header is empty', () => {
  const csv = [
    'الرقم الوزاري,اسم المدرسة,حجم المبنى,حجم المدرسة,اسم المشرف (صيانة),مشرف الشركة,النوع,gender',
    '123,مدرسة,,كبير,,مشرف بديل,,بنات'
  ].join('\n');
  const [school] = parseSchoolCsv(Buffer.from(csv));
  assert.equal(school.occupancySize, 'كبير');
  assert.equal(school.supervisor, 'مشرف بديل');
  assert.equal(school.schoolType, 'بنات');
});

test('detects swapped Saudi latitude and longitude and avoids invalid map coordinates', () => {
  const swappedFields = [
    { header: 'الشماليات', label: 'خط العرض', value: '46.71596396' },
    { header: 'الشرقيات', label: 'خط الطول', value: '24.75668768' }
  ];
  assert.deepEqual(getSchoolMapCoordinates(swappedFields), {
    latitude: 24.75668768,
    longitude: 46.71596396,
    swapped: true
  });
  assert.deepEqual(normalizeSchoolCoordinateLabels(swappedFields).map(({ label }) => label), ['خط الطول', 'خط العرض']);
  const directFields = [
    { label: 'خط العرض', value: '24.75668768' },
    { label: 'خط الطول', value: '46.71596396' }
  ];
  assert.deepEqual(getSchoolMapCoordinates(directFields), {
    latitude: 24.75668768,
    longitude: 46.71596396,
    swapped: false
  });
  assert.equal(getSchoolMapCoordinates([
    { label: 'خط العرض', value: '46.71596396' },
    { label: 'خط الطول', value: '121.9' }
  ]), null);
});

test('matches reordered columns by stable header keys and keeps values from removed columns', () => {
  const first = parseSchoolCsv(Buffer.from('رقم المدرسة,اسم المدرسة,اسم المشرف (صيانة),رقم الاتصال,حقل قديم\n123,مدرسة,مشرف,555,قيمة محفوظة\n'))[0];
  const next = parseSchoolCsv(Buffer.from('حقل جديد,اسم المشرف (صيانة),رقم الاتصال,اسم المدرسة,رقم المدرسة\nجديد,مشرف محدث,,مدرسة,123\n'))[0];
  const merged = mergeSchoolSourceData(first.sourceData, next.sourceData);
  assert.equal(next.supervisor, 'مشرف محدث');
  assert.equal(merged.find((field) => field.key === next.sourceData.find((item) => item.label === 'رقم الاتصال لمشرف الصيانة').key)?.value, '555');
  assert.ok(merged.some((field) => field.label === 'حقل قديم' && field.value === 'قيمة محفوظة'));
  assert.ok(merged.some((field) => field.label === 'حقل جديد' && field.value === 'جديد'));
});

test('preserves row values beyond the header width as additional details', () => {
  const [school] = parseSchoolCsv(Buffer.from('رقم المدرسة,اسم المدرسة\n123,مدرسة,بيان إضافي\n'));
  assert.equal(school.sourceData.length, 3);
  assert.equal(school.sourceData[2].label, 'بيان 3');
  assert.equal(school.sourceData[2].value, 'بيان إضافي');
});

test('converts the provided Google sharing URL into a CSV export URL', () => {
  const url = toGoogleCsvUrl(DEFAULT_SCHOOLS_URL);
  assert.equal(url.hostname, 'docs.google.com');
  assert.match(url.pathname, /\/export$/);
  assert.equal(url.searchParams.get('format'), 'csv');
});

test('follows only trusted Google CSV export redirects', async () => {
  const requested = [];
  const csv = 'ID,اسم الموقع,الرقم الوزاري\n1,مدرسة تجريبية,123\n';
  const fetchImpl = async (url) => {
    requested.push(new URL(url).hostname);
    if (requested.length === 1) return new Response(null, { status: 302, headers: { location: 'https://files.googleusercontent.com/export/schools.csv' } });
    return new Response(csv, { status: 200, headers: { 'content-type': 'text/csv' } });
  };
  const result = await fetchSchoolCsv(DEFAULT_SCHOOLS_URL, fetchImpl);
  assert.deepEqual(requested, ['docs.google.com', 'files.googleusercontent.com']);
  assert.equal(parseSchoolCsv(result).length, 1);
});

test('rejects redirects outside Google export hosts', async () => {
  const fetchImpl = async () => new Response(null, { status: 302, headers: { location: 'https://example.com/data.csv' } });
  await assert.rejects(() => fetchSchoolCsv(DEFAULT_SCHOOLS_URL, fetchImpl), /تحويل غير آمن/);
});

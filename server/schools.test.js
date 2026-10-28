const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_SCHOOLS_URL, parseSchoolCsv, toGoogleCsvUrl, fetchSchoolCsv } = require('./schools');

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

test('uses the P, T, and V positions when optional school attribute headers are unavailable', () => {
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
  assert.equal(school.buildingType, 'مدرسة حكومية');
  assert.equal(school.schoolType, 'بنات');
  assert.equal(school.occupancySize, '275');
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

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv, normalizeSchoolNumber, parseDate } = require('./importer');

test('parses the Arabic help-platform export and Arabic date', () => {
  const csv = '\uFEFF"مُعرّف الحالة","الأولوية","الحالة","تاريخ الإنشاء","حالة SLM","الوصف","الطبقة 3 للفئة","رقم المدرسة","اسم المبنى","بحاجة إلى الانتباه"\n"CASE-1","حرج","قيد التنفيذ","27‏/10‏/2026, 2:17:22 م","ضمن المهلة الزمنية","وصف","صيانة","S- 123 456","مدرسة أ","صواب"';
  const [ticket] = parseCsv(Buffer.from(csv, 'utf8'));
  assert.equal(ticket.case_id, 'CASE-1');
  assert.equal(ticket.school_number, '123456');
  assert.equal(ticket.created_at, '2026-10-27T11:17:22.000Z');
  assert.equal(ticket.needs_attention, 1);
});

test('rejects missing required columns and malformed dates', () => {
  assert.throws(() => parseCsv(Buffer.from('id,status\n1,open')), /أعمدة مطلوبة/);
  assert.throws(() => parseCsv(Buffer.from('"unterminated')), /CSV غير صالح/);
  const csv = 'مُعرّف الحالة,الأولوية,الحالة,تاريخ الإنشاء,حالة SLM,الوصف,الطبقة 3 للفئة,رقم المدرسة\n1,متوسط,مفتوح,not-a-date,ضمن المهلة,وصف,صيانة,123';
  assert.throws(() => parseCsv(Buffer.from(csv)), /تعذر فهم تاريخ الإنشاء/);
});

test('normalizes school numbers and accepts ISO dates', () => {
  assert.equal(normalizeSchoolNumber(' S- 123 456 '), '123456');
  assert.equal(parseDate('2026-10-27T12:00:00Z'), '2026-10-27T12:00:00.000Z');
});

test('does not turn a missing SLA duration into zero minutes', () => {
  const csv = 'مُعرّف الحالة,الأولوية,الحالة,تاريخ الإنشاء,حالة SLM,الوصف,الطبقة 3 للفئة,رقم المدرسة,الوقت المتبقي بالدقائق\n1,متوسط,مفتوح,2026-10-27T12:00:00Z,ضمن المهلة,وصف,صيانة,123,\n2,متوسط,مفتوح,2026-10-27T12:00:00Z,ضمن المهلة,وصف,صيانة,456,0';
  const tickets = parseCsv(Buffer.from(csv));
  assert.equal(tickets[0].sla_remaining_minutes, null);
  assert.equal(tickets[1].sla_remaining_minutes, 0);
});

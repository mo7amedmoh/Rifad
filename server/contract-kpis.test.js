const test = require('node:test');
const assert = require('node:assert/strict');
const {
  KPI_DEFAULTS, HS_SYSTEM_DEFAULTS, categoryContribution, selectPayout,
  computeIndicators, classifyTicket, HEALTH_PLUMBING_LAYER, findNearestParent,
  isEligibleContractTicket
} = require('./contract-kpis');
const { calculateCompliance } = require('./ticket-status');
const { attributeTicketToSchool } = require('./contract-kpi-service');

test('category contribution divides indicator points across the category weight', () => {
  assert.equal(categoryContribution(20, [50, 50, 50, 50, 50]), 10);
});

test('95.00 percent belongs to the 95-99.99 payout band', () => {
  const payout = selectPayout(95, 7, [{ period: '7+', band: '95-99.99', percentage: 99 }]);
  assert.deepEqual(payout, { period: '7+', band: '95-99.99', payoutPct: 99, message: null });
});

test('a blank payout row returns a message instead of a payout percentage', () => {
  const payout = selectPayout(90, 2, [{ period: '2', band: '90-94.99', percentage: null }]);
  assert.equal(payout.payoutPct, null);
  assert.equal(payout.message, 'جدول الفترة غير مُدخل');
});

test('the HS.9 order denominator counts only the 56 elevator schools before applying orders per school', () => {
  const kpi = KPI_DEFAULTS.filter((item) => item.code === 'HS.9');
  const schools = Array.from({ length: 76 }, (_, index) => ({
    school_number: String(index),
    counts_in_kpi: 1,
    has_elevator: Number(index < 56)
  }));
  const result = computeIndicators({
    month: '2026-10',
    kpis: kpi,
    results: [],
    tickets: [],
    schools,
    categoryMap: new Map(),
    hsSystems: HS_SYSTEM_DEFAULTS.filter((item) => item.kpiCode === 'HS.9'),
    waterKeywords: [],
    categoryWeights: { HS: 100 },
    compliance: calculateCompliance
  });
  assert.equal(result.indicators['HS.9'].eligible_schools, 56);
  assert.equal(result.indicators['HS.9'].denominator, 112);
});

test('attached school reports are attributed to the parent school', () => {
  const result = attributeTicketToSchool({
    matched_school_number: 'ATTACHED-1',
    parent_school_id: 'PARENT-1'
  });
  assert.equal(result.attributed_school_number, 'PARENT-1');
  const report = computeIndicators({
    month: '2026-10',
    kpis: KPI_DEFAULTS.filter((item) => item.code === 'HS.5'),
    results: [],
    tickets: [{
      layer3: 'أعمال كهربائية',
      status: 'مفتوح',
      matched_school_number: 'ATTACHED-1',
      parent_school_id: 'PARENT-1'
    }],
    schools: [],
    categoryMap: new Map([['اعمال كهربائية', 'HS.5']]),
    hsSystems: HS_SYSTEM_DEFAULTS.filter((item) => item.kpiCode === 'HS.5'),
    waterKeywords: [],
    categoryWeights: { HS: 100 },
    compliance: calculateCompliance
  });
  assert.equal(report.reportsBySchool[0].schoolNumber, 'PARENT-1');
  assert.equal(report.reportsBySchool[0].reports, 1);
});

test('an attached school report without a parent is excluded from contract KPIs', () => {
  assert.equal(isEligibleContractTicket({ building_type: 'مشترك ملحق', parent_school_id: null }), false);
  assert.equal(isEligibleContractTicket({ building_type: 'مشترك ملحق', parent_school_id: 'PARENT-1' }), true);
});

test('automatic attached-school linking is limited to 50 metres', () => {
  const attached = { latitude: 24.7, longitude: 46.7 };
  const nearby = { school_number: 'P1', latitude: 24.7001, longitude: 46.7, counts_in_kpi: 1 };
  const distant = { school_number: 'P2', latitude: 24.701, longitude: 46.7, counts_in_kpi: 1 };
  assert.equal(findNearestParent(attached, [nearby])?.schoolNumber, 'P1');
  assert.equal(findNearestParent(attached, [distant]), null);
});

test('health plumbing reports mentioning a water keyword are classified as HS.7', () => {
  const kpi = classifyTicket({
    layer3: HEALTH_PLUMBING_LAYER,
    description: 'فحص خزان المدرسة'
  }, new Map([[HEALTH_PLUMBING_LAYER, 'HS.11']]), ['خزان']);
  assert.equal(kpi, 'HS.7');
});

test('HS.3 counts closed on-time reports against resolved non-cancelled reports', () => {
  const value = calculateCompliance([
    { status: 'مغلق', slm_status: 'ضمن المهلة' },
    { status: 'مغلق', slm_status: 'تم اختراقه' },
    { status: 'قيد التنفيذ', slm_status: 'ضمن المهلة' },
    { status: 'ملغي', slm_status: 'ضمن المهلة' }
  ], { closedOnly: true });
  assert.equal(value.reports, 1);
  assert.equal(value.denominator, 2);
  assert.equal(value.achievedPct, 50);
});

test('KPI seed contains 36 indicators and only the requested auto-calculated indicators', () => {
  assert.equal(KPI_DEFAULTS.length, 36);
  assert.deepEqual(KPI_DEFAULTS.filter((item) => item.source === 'auto').map((item) => item.code),
    ['HS.3', 'HS.5', 'HS.6', 'HS.7', 'HS.8', 'HS.9', 'HS.10', 'HS.11']);
});

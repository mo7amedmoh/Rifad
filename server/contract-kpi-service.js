const {
  computeMonth: calculateMonth,
  normalizeText
} = require('./contract-kpis');
const { calculateCompliance } = require('./ticket-status');

function attributeTicketToSchool(ticket) {
  return {
    ...ticket,
    attributed_school_number: ticket.parent_school_id || ticket.matched_school_number,
    attributed_school_name: ticket.parent_school_name || ticket.school_name
  };
}

function createContractKpiService(db) {
  const setting = (key, fallback = '') => db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value ?? fallback;

  function loadMonthInput(month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('صيغة الشهر يجب أن تكون YYYY-MM.');
    const monthStart = new Date(`${month}-01T00:00:00.000Z`);
    const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
    const tickets = db.prepare(`SELECT t.*, s.parent_school_id, s.building_type, s.name AS school_name, p.name AS parent_school_name
      FROM tickets t JOIN schools s ON s.school_number = t.matched_school_number
      LEFT JOIN schools p ON p.school_number = s.parent_school_id
      WHERE t.deleted_at IS NULL AND t.created_at >= ? AND t.created_at < ?`)
      .all(monthStart.toISOString(), monthEnd.toISOString())
      .map(attributeTicketToSchool);
    const schools = db.prepare(`SELECT school_number, counts_in_kpi, has_elevator
      FROM schools WHERE counts_in_kpi = 1`).all();
    const kpis = db.prepare('SELECT code, name, category, source, target, importance FROM kpis ORDER BY code').all();
    const results = db.prepare('SELECT month, kpi_code, achieved_pct, fine_count FROM kpi_results WHERE month = ?').all(month);
    const categoryMap = new Map(db.prepare('SELECT layer3, kpi_code FROM category_map WHERE kpi_code IS NOT NULL').all()
      .map((item) => [normalizeText(item.layer3), item.kpi_code]));
    const hsSystems = db.prepare('SELECT kpi_code AS kpiCode, name, orders_per_school AS ordersPerSchool, school_filter AS schoolFilter FROM hs_systems').all();
    const categoryWeights = Object.fromEntries(db.prepare('SELECT category, weight FROM category_weights').all()
      .map((item) => [item.category, item.weight]));
    const payoutTable = db.prepare('SELECT period, band, percentage FROM payout_table').all();
    const fines = db.prepare('SELECT kpi_code AS kpiCode, description, value, unit FROM fines').all();
    return {
      month, tickets, schools, kpis, results, categoryMap, hsSystems,
      waterKeywords: db.prepare('SELECT keyword FROM water_keywords').all().map((item) => item.keyword),
      categoryWeights, payoutTable, fines,
      contractStartDate: setting('contract_start_date', '2026-07-01'),
      accountabilityStart: setting('accountability_start', '2026-10-01'),
      monthlyInvoiceValue: Number(setting('monthly_invoice_value', '0')),
      compliance: calculateCompliance
    };
  }

  function computeMonth(month) {
    const input = loadMonthInput(month);
    const result = calculateMonth(input);
    return {
      ...result,
      kpis: input.kpis,
      categoryWeights: input.categoryWeights,
      payoutTable: input.payoutTable,
      fineDefinitions: input.fines,
      accountabilityStart: input.accountabilityStart,
      schoolCounts: {
        eligible: input.schools.length,
        elevators: input.schools.filter((school) => school.has_elevator).length
      },
      attachedSchoolsNeedingParent: db.prepare(`SELECT school_number, name, building_type
        FROM schools WHERE lower(building_type) LIKE '%ملحق%' AND parent_school_id IS NULL ORDER BY name`).all()
    };
  }

  return { computeMonth, loadMonthInput };
}

module.exports = { createContractKpiService, attributeTicketToSchool };

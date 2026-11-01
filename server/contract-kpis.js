const { isClosed, isCancelled, isOpen } = require('./ticket-status');
const NON_KPI_SLA_LAYER = 'استفسارات اعمال النظافة العامة';

const KPI_DEFAULTS = [
  ['CM.1', 'ملائمة القوى العاملة', 'CM'], ['CM.2', 'امتثال تقديم المخرجات', 'CM'],
  ['CM.3', 'كفاءة إدارة التكاليف الثابتة', 'CM'], ['CM.4', 'ملائمة خطة الطوارئ والتعافي', 'CM'],
  ['CM.5', 'استبيان رضا المستخدمين', 'CM'], ['CM.6', 'تقييم خدمات الدعم', 'CM'],
  ['CM.7', 'تحسين رضا المستخدمين', 'CM'], ['CM.8', 'ملائمة الجهاز الإداري', 'CM'],
  ['OM.1', 'كفاءة التشغيل لساعات المباني', 'OM'], ['OM.2', 'كفاءة الصيانة لفرق المتنقلة', 'OM'],
  ['OM.3', 'تقييم جودة إدارة العقد', 'OM'], ['OM.4', 'كفاءة مكتب الدعم', 'OM'],
  ['OM.5', 'إدارة السجلات', 'OM'], ['OM.6', 'إدارة الضمانات', 'OM'], ['OM.7', 'مواعيد شهادات الإنجاز', 'OM'],
  ['HS.1', 'الصيانة المخططة مقابل غير المخططة', 'HS'], ['HS.2', 'خطة الصيانة الوقائية', 'HS'],
  ['HS.3', 'خطة الصيانة للمهام المتراكمة (SLA)', 'HS'], ['HS.4', 'حالة مستوى المباني التشغيلية', 'HS'],
  ['HS.5', 'شبكة الكهرباء', 'HS'], ['HS.6', 'الإنذار ومكافحة الحريق', 'HS'], ['HS.7', 'شبكة المياه', 'HS'],
  ['HS.8', 'التكييف والتهوية', 'HS'], ['HS.9', 'المصاعد', 'HS'],
  ['HS.10', 'العناصر المعمارية والإنشائية', 'HS'], ['HS.11', 'دورات المياه', 'HS'],
  ['HS.12', 'استلام الأجهزة والمعدات', 'HS'],
  ['SS.1', 'خدمات التنظيف', 'SS'], ['SS.2', 'خطة النظافة', 'SS'], ['SS.3', 'إدارة المفاتيح', 'SS'],
  ['SS.4', 'مكافحة الآفات', 'SS'], ['SS.5', 'غسيل الخزانات', 'SS'], ['SS.6', 'توفر المياه', 'SS'],
  ['SS.7', 'كسح الصرف الصحي', 'SS'], ['SS.8', 'البستنة', 'SS'], ['SS.9', 'تنسيق المواقع', 'SS']
].map(([code, name, category]) => ({
  code, name, category,
  source: code === 'HS.3' || /^HS\.(5|6|7|8|9|10|11)$/.test(code) ? 'auto' : 'manual',
  target: 100,
  importance: 'medium'
}));

const CATEGORY_WEIGHTS = { CM: 10, OM: 15, HS: 30, SS: 45 };
const HS_SYSTEM_DEFAULTS = [
  ['HS.5', 'شبكة الكهرباء', 3, 'all'], ['HS.6', 'الإنذار ومكافحة الحريق', 3, 'all'],
  ['HS.7', 'شبكة المياه', 2, 'all'], ['HS.8', 'التكييف والتهوية', 3, 'all'],
  ['HS.9', 'المصاعد', 2, 'has_elevator'], ['HS.10', 'العناصر المعمارية والإنشائية', 4, 'all'],
  ['HS.11', 'دورات المياه', 3, 'all']
].map(([kpiCode, name, ordersPerSchool, schoolFilter]) => ({ kpiCode, name, ordersPerSchool, schoolFilter }));

const CATEGORY_MAP_DEFAULTS = [
  ['بلاغات صيانة الاعمال الكهربائية', 'HS.5'], ['أعمال كهربائية', 'HS.5'],
  ['بلاغات صيانة نظام الانذار ومكافحة الحريق', 'HS.6'],
  ['بلاغات صيانة أجهزة التكييف', 'HS.8'], ['بلاغات نظافة أجهزة التكييف', 'HS.8'],
  ['بلاغات صيانة المصاعد والسلالم الكهربائية', 'HS.9'], ['المصاعد والسلالم الكهربائية', 'HS.9'],
  ['بلاغات صيانة العناصر المعمارية والمدنية', 'HS.10'], ['أعمال مدنية', 'HS.10'],
  ['أعمال سباكة', 'HS.11'], ['بلاغات صيانة الاعمال الصحية', 'HS.11']
].map(([layer3, kpiCode]) => ({ layer3, kpiCode }));

const WATER_KEYWORDS = ['خزان', 'خزانات', 'مضخة', 'طلمبة', 'صهريج', 'توريد', 'انقطاع المياه', 'ضغط', 'عوامة'];
const PAYOUT_PERIODS = ['1', '2', '3', '4-6', '7+'];
const PAYOUT_BANDS = [
  { key: '100', min: 100 },
  { key: '95-99.99', min: 95 },
  { key: '90-94.99', min: 90 },
  { key: '85-89.99', min: 85 },
  { key: '75-84.99', min: 75 },
  { key: '70-74.99', min: 70 },
  { key: '<70', min: -Infinity }
];
const PAYOUT_7_PLUS = [100, 99, 96, 94, 90, 85, 80];
const EXCLUDED_LAYER_KEYS = new Set(['الأنظمة الصوتية', 'أنظمة المراقبة', 'الأعمال الميكانيكية'].map(normalizeText));
const HEALTH_PLUMBING_LAYER = 'بلاغات صيانة الاعمال الصحية';
function isExcludedLayer(value) {
  const layer = normalizeText(value);
  return EXCLUDED_LAYER_KEYS.has(layer) || /نظاف|انظمه صوتيه|مراقبه|اعمال ميكانيكيه/.test(layer);
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function calculateSystemAchievement(reports, denominator) {
  const ratio = denominator > 0 ? reports / denominator : null;
  return {
    reports,
    denominator,
    ratio,
    achieved_pct: denominator > 0 ? clamp(100 - ratio * 100) : reports > 0 ? 0 : 100
  };
}

function categoryContribution(weight, indicatorPoints) {
  if (!indicatorPoints.length) return 0;
  return indicatorPoints.reduce((sum, points) => sum + points, 0) * weight /
    (indicatorPoints.length * 100);
}

function payoutPeriod(contractMonth) {
  if (contractMonth >= 7) return '7+';
  if (contractMonth >= 4) return '4-6';
  return contractMonth > 0 ? String(contractMonth) : null;
}

function payoutBand(achievement) {
  if (!Number.isFinite(achievement)) return null;
  return PAYOUT_BANDS.find((band) => achievement >= band.min)?.key || null;
}

function selectPayout(achievement, contractMonth, payoutTable) {
  const period = payoutPeriod(contractMonth);
  const band = payoutBand(achievement);
  if (!period || !band) return { period, band, payoutPct: null, message: 'خارج فترة العقد' };
  const row = payoutTable.find((item) => item.period === period && item.band === band);
  if (!row || row.percentage === null || row.percentage === undefined) {
    return { period, band, payoutPct: null, message: 'جدول الفترة غير مُدخل' };
  }
  return { period, band, payoutPct: row.percentage, message: null };
}

function contractMonthNumber(month, contractStartDate) {
  const [year, monthNumber] = month.split('-').map(Number);
  const start = new Date(`${contractStartDate}T00:00:00.000Z`);
  if (!Number.isFinite(start.getTime())) return null;
  const value = (year - start.getUTCFullYear()) * 12 + monthNumber - start.getUTCMonth();
  return value > 0 ? value : null;
}

function normalizeText(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('ar')
    .replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي').replace(/\s+/g, ' ');
}

function classifyTicket(ticket, categoryMap, waterKeywords) {
  if (ticket.kpi_override) return ticket.kpi_override;
  const layer = String(ticket.layer3 || '').trim();
  if (normalizeText(layer) === normalizeText(HEALTH_PLUMBING_LAYER)) {
    const description = normalizeText(ticket.description);
    if (waterKeywords.some((word) => description.includes(normalizeText(word)))) return 'HS.7';
  }
  return categoryMap.get(normalizeText(layer)) || null;
}

function isEligibleContractTicket(ticket) {
  const isUnlinkedAttached = normalizeText(ticket.building_type) === normalizeText('مشترك ملحق') &&
    !ticket.parent_school_id;
  return !ticket.excluded_from_kpi && !ticket.deleted_at && !isUnlinkedAttached;
}

function getKpiScore(achievedPct, target) {
  return Math.min(achievedPct / target, 1) * 100;
}

function aggregatePerformance(indicators, kpis, categoryWeights) {
  const categories = {};
  for (const [category, weight] of Object.entries(categoryWeights)) {
    const points = kpis.filter((kpi) => kpi.category === category)
      .map((kpi) => indicators[kpi.code]?.points ?? 0);
    categories[category] = {
      weight,
      points: round(categoryContribution(weight, points), 4),
      indicators: points.length
    };
  }
  return {
    categories,
    achievedPct: round(Object.values(categories).reduce((sum, item) => sum + item.points, 0), 4)
  };
}

function computeIndicators({
  month, kpis, results, tickets, schools, categoryMap, hsSystems, waterKeywords,
  categoryWeights, compliance
}) {
  const indicators = {};
  const activeTickets = tickets.filter(isEligibleContractTicket);
  const systemReports = new Map(HS_SYSTEM_DEFAULTS.map(({ kpiCode }) => [kpiCode, 0]));
  const schoolReports = new Map();
  const unmapped = new Set();
  for (const ticket of activeTickets) {
    if (isCancelled(ticket)) continue;
    const layer = String(ticket.layer3 || '').trim();
    const classification = classifyTicket(ticket, categoryMap, waterKeywords);
    if (classification && systemReports.has(classification)) {
      systemReports.set(classification, systemReports.get(classification) + 1);
      const attributedSchoolNumber = ticket.attributed_school_number || ticket.parent_school_id || ticket.matched_school_number;
      if (attributedSchoolNumber) {
        const key = `${classification}\u0000${attributedSchoolNumber}`;
        const report = schoolReports.get(key) || {
          kpiCode: classification,
          schoolNumber: attributedSchoolNumber,
          schoolName: ticket.attributed_school_name || ticket.parent_school_name || ticket.school_name || '',
          reports: 0
        };
        report.reports += 1;
        schoolReports.set(key, report);
      }
    } else if (!classification && layer && !isExcludedLayer(layer)) {
      unmapped.add(layer);
    }
  }

  for (const kpi of kpis) {
    if (kpi.code === 'HS.3') {
      const slaTickets = activeTickets.filter((ticket) => normalizeText(ticket.layer3) !== normalizeText(NON_KPI_SLA_LAYER));
      const value = compliance(slaTickets, { closedOnly: true });
      indicators[kpi.code] = {
        ...value,
        achieved_pct: value.achievedPct,
        missing: false,
        source: 'auto'
      };
      continue;
    }
    const system = hsSystems.find((item) => item.kpiCode === kpi.code);
    if (kpi.source === 'auto' && system) {
      const eligibleSchools = schools.filter((school) => school.counts_in_kpi &&
        (system.schoolFilter !== 'has_elevator' || school.has_elevator));
      const value = calculateSystemAchievement(
        systemReports.get(kpi.code) || 0,
        system.ordersPerSchool * eligibleSchools.length
      );
      indicators[kpi.code] = {
        ...value,
        eligible_schools: eligibleSchools.length,
        orders_per_school: system.ordersPerSchool,
        missing: false,
        source: 'auto'
      };
      continue;
    }
    const result = results.find((item) => item.kpi_code === kpi.code && item.month === month);
    const achievedPct = result?.achieved_pct ?? 100;
    indicators[kpi.code] = {
      reports: null,
      denominator: null,
      ratio: null,
      achieved_pct: achievedPct,
      fine_count: result?.fine_count ?? 0,
      missing: !result,
      source: 'manual'
    };
  }

  for (const kpi of kpis) {
    const indicator = indicators[kpi.code];
    indicator.points = round(getKpiScore(indicator.achieved_pct, kpi.target), 4);
  }
  const performance = aggregatePerformance(indicators, kpis, categoryWeights);
  return {
    indicators,
    performance: performance.achievedPct,
    categories: performance.categories,
    completeness: Object.values(indicators).filter((item) => !item.missing).length,
    unmappedCategories: [...unmapped].sort((a, b) => a.localeCompare(b, 'ar')),
    reportsBySchool: [...schoolReports.values()].sort((a, b) => a.schoolName.localeCompare(b.schoolName, 'ar'))
  };
}

function calculateFinancials({
  month, performance, contractStartDate, monthlyInvoiceValue, payoutTable, fines, indicators
}) {
  const contractMonth = contractMonthNumber(month, contractStartDate);
  const payout = selectPayout(performance, contractMonth || 0, payoutTable);
  const payable = payout.payoutPct === null ? null : monthlyInvoiceValue * payout.payoutPct / 100;
  const baseDeduction = payable === null ? null : monthlyInvoiceValue - payable;
  const fineTotal = fines.reduce((sum, fine) => {
    const fineCount = indicators[fine.kpiCode]?.fine_count || 0;
    return sum + fineCount * fine.value;
  }, 0);
  return {
    contractMonth,
    payout,
    monthlyInvoiceValue,
    payable: payable === null ? null : round(payable, 2),
    deduction: baseDeduction === null ? null : round(baseDeduction + fineTotal, 2),
    fines: round(fineTotal, 2)
  };
}

function computeMonth(input) {
  const computed = computeIndicators(input);
  const financials = calculateFinancials({
    month: input.month,
    performance: computed.performance,
    contractStartDate: input.contractStartDate,
    monthlyInvoiceValue: input.monthlyInvoiceValue,
    payoutTable: input.payoutTable,
    fines: input.fines,
    indicators: computed.indicators
  });
  return { month: input.month, ...computed, ...financials };
}

function projectMonth({ today, monthInput, daysElapsed, daysInMonth }) {
  const base = computeMonth(monthInput);
  const currentOpen = monthInput.tickets.filter((ticket) => !ticket.excluded_from_kpi &&
    !ticket.deleted_at && isEligibleContractTicket(ticket) && isOpen(ticket));
  const unresolvedCount = currentOpen.length;
  const hs3 = monthInput.kpis.find((item) => item.code === 'HS.3');
  const resolved = hs3 ? base.indicators[hs3.code]?.reports || 0 : 0;
  const closedTotal = monthInput.tickets.filter((ticket) => isEligibleContractTicket(ticket) &&
    isClosed(ticket) && !isCancelled(ticket)).length;
  const makeScenario = (mode) => {
    const scenarioInput = {
      ...monthInput,
      tickets: monthInput.tickets.map((ticket) => {
        if (mode === 'pace' || !currentOpen.some((item) => item.id === ticket.id)) return ticket;
        if (mode === 'best') return { ...ticket, status: 'مغلق', slm_status: 'ضمن المهلة' };
        return { ...ticket, status: 'مغلق', slm_status: 'تم اختراقه' };
      })
    };
    const result = computeMonth(scenarioInput);
    if (mode === 'pace' && daysElapsed > 0) {
      const factor = daysInMonth / daysElapsed;
      for (const system of scenarioInput.hsSystems) {
        const indicator = result.indicators[system.kpiCode];
        const projectedReports = Math.round(indicator.reports * factor);
        const achieved = calculateSystemAchievement(projectedReports, indicator.denominator);
        result.indicators[system.kpiCode] = {
          ...indicator, ...achieved, source: 'auto', missing: false,
          points: round(getKpiScore(achieved.achieved_pct, scenarioInput.kpis.find((kpi) => kpi.code === system.kpiCode).target), 4)
        };
      }
      result.performance = aggregatePerformance(result.indicators, scenarioInput.kpis, scenarioInput.categoryWeights).achievedPct;
      Object.assign(result, calculateFinancials({
        month: scenarioInput.month,
        performance: result.performance,
        contractStartDate: scenarioInput.contractStartDate,
        monthlyInvoiceValue: scenarioInput.monthlyInvoiceValue,
        payoutTable: scenarioInput.payoutTable,
        fines: scenarioInput.fines,
        indicators: result.indicators
      }));
    }
    return result;
  };
  const scenarios = {
    best: makeScenario('best'),
    pace: makeScenario('pace'),
    worst: makeScenario('worst')
  };
  const knownDeductions = Object.values(scenarios).map((scenario) => scenario.deduction).filter(Number.isFinite);
  return {
    today,
    month: base.month,
    daysElapsed,
    daysInMonth,
    openReports: unresolvedCount,
    hs3Current: hs3 ? base.indicators[hs3.code] : null,
    resolvedClosedOnTime: resolved,
    closedReports: closedTotal,
    scenarios,
    range: {
      performance: {
        min: Math.min(scenarios.best.performance, scenarios.pace.performance, scenarios.worst.performance),
        expected: scenarios.pace.performance,
        max: Math.max(scenarios.best.performance, scenarios.pace.performance, scenarios.worst.performance)
      },
      payoutBand: {
        min: scenarios.worst.payout.band,
        expected: scenarios.pace.payout.band,
        max: scenarios.best.payout.band
      },
      deduction: {
        min: knownDeductions.length ? Math.min(...knownDeductions) : null,
        expected: scenarios.pace.deduction,
        max: knownDeductions.length ? Math.max(...knownDeductions) : null
      }
    }
  };
}

function haversineDistanceMeters(first, second) {
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const lat1 = toRadians(first.latitude);
  const lat2 = toRadians(second.latitude);
  const deltaLat = lat2 - lat1;
  const deltaLon = toRadians(second.longitude - first.longitude);
  const value = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function findNearestParent(attachedSchool, candidateSchools, maxDistanceMeters = 50) {
  if (!Number.isFinite(attachedSchool.latitude) || !Number.isFinite(attachedSchool.longitude)) return null;
  let nearest = null;
  for (const school of candidateSchools) {
    if (!school.counts_in_kpi || !Number.isFinite(school.latitude) || !Number.isFinite(school.longitude)) continue;
    const distance = haversineDistanceMeters(attachedSchool, school);
    if (distance <= maxDistanceMeters && (!nearest || distance < nearest.distanceMeters)) {
      nearest = { schoolNumber: school.school_number, distanceMeters: distance };
    }
  }
  return nearest;
}

module.exports = {
  KPI_DEFAULTS, CATEGORY_WEIGHTS, HS_SYSTEM_DEFAULTS, CATEGORY_MAP_DEFAULTS, WATER_KEYWORDS,
  PAYOUT_PERIODS, PAYOUT_BANDS, PAYOUT_7_PLUS, HEALTH_PLUMBING_LAYER, isExcludedLayer,
  calculateSystemAchievement, categoryContribution, payoutPeriod, payoutBand, selectPayout,
  contractMonthNumber, normalizeText, classifyTicket, isEligibleContractTicket, getKpiScore, aggregatePerformance,
  computeIndicators, calculateFinancials, computeMonth, projectMonth, haversineDistanceMeters, findNearestParent
};

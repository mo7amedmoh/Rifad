const {
  isBreached, isClosed, isCancelled, isOpen, calculateCompliance
} = require('./ticket-status');

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthRange(month) {
  if (!MONTH_PATTERN.test(month)) throw new Error('صيغة الشهر يجب أن تكون YYYY-MM.');
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return [start.toISOString(), end.toISOString()];
}

function createMonthlyPerformanceReportService({ db, contractKpiService, slaRemainingMinutes, getSlaSettings }) {
  function getMonthTickets(month) {
    const [start, end] = monthRange(month);
    return db.prepare(`SELECT t.*, s.name AS school_name,
        COALESCE(NULLIF(s.supervisor, ''), p.supervisor, '') AS supervisor, s.parent_school_id,
        p.name AS parent_school_name, s.school_type, s.building_type
      FROM tickets t
      LEFT JOIN schools s ON s.school_number = t.matched_school_number
      LEFT JOIN schools p ON p.school_number = s.parent_school_id
      WHERE t.deleted_at IS NULL AND t.created_at >= ? AND t.created_at < ?
      ORDER BY t.created_at DESC`).all(start, end);
  }

  function groupRows(tickets, getName) {
    const groups = new Map();
    for (const ticket of tickets) {
      if (isCancelled(ticket)) continue;
      const name = getName(ticket) || 'غير محدد';
      const item = groups.get(name) || { name, total: 0, closed: 0, breached: 0, open: 0 };
      item.total += 1;
      if (isClosed(ticket)) item.closed += 1;
      if (isBreached(ticket)) item.breached += 1;
      if (isOpen(ticket)) item.open += 1;
      groups.set(name, item);
    }
    return [...groups.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'ar'))
      .map((item) => ({
        ...item,
        compliance: calculateCompliance(
          tickets.filter((ticket) => !isCancelled(ticket) && (getName(ticket) || 'غير محدد') === item.name)
        ).achievedPct
      }));
  }

  function getReport(month) {
    const tickets = getMonthTickets(month);
    const active = tickets.filter((ticket) => !isCancelled(ticket));
    const previousDate = new Date(`${month}-01T00:00:00.000Z`);
    previousDate.setUTCMonth(previousDate.getUTCMonth() - 1);
    const previousMonth = previousDate.toISOString().slice(0, 7);
    const previousTickets = getMonthTickets(previousMonth);
    const previousCompliance = calculateCompliance(previousTickets).achievedPct;
    const compliance = calculateCompliance(tickets);
    const breached = active.filter(isBreached);
    const openTickets = db.prepare(`SELECT t.*,
        COALESCE(p.name, s.name) AS school_name,
        COALESCE(NULLIF(s.supervisor, ''), p.supervisor, '') AS supervisor
      FROM tickets t LEFT JOIN schools s ON s.school_number = t.matched_school_number
      LEFT JOIN schools p ON p.school_number = s.parent_school_id
      WHERE t.deleted_at IS NULL ORDER BY t.created_at DESC`).all()
      .filter(isOpen)
      .map((ticket) => {
        const remaining = slaRemainingMinutes(ticket, getSlaSettings());
        return {
          id: ticket.id,
          case_id: ticket.case_id,
          school_name: ticket.school_name || ticket.building_name || '',
          supervisor: ticket.supervisor || 'غير محدد',
          layer3: ticket.layer3 || 'غير محدد',
          priority: ticket.priority || 'غير محدد',
          created_at: ticket.created_at,
          sla_remaining_minutes: remaining,
          overdue_minutes: remaining === null ? null : Math.max(0, -remaining)
        };
      });

    const schoolActivity = new Map();
    for (const ticket of active) {
      const schoolNumber = ticket.parent_school_id || ticket.matched_school_number;
      const name = ticket.parent_school_name || ticket.school_name || ticket.building_name || 'غير محدد';
      const item = schoolActivity.get(schoolNumber) || { school_number: schoolNumber, name, total: 0 };
      item.total += 1;
      schoolActivity.set(schoolNumber, item);
    }
    const topSchools = [...schoolActivity.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'ar')).slice(0, 10);
    const schoolsWithoutTickets = db.prepare(`SELECT school_number, name, supervisor, region, school_type, building_type
      FROM schools WHERE counts_in_kpi = 1 ORDER BY name`).all()
      .filter((school) => !schoolActivity.has(school.school_number));

    const schoolTickets = tickets.filter((ticket) => !isCancelled(ticket));
    return {
      month,
      contract: 'TBC-FM-909 مباني مدارس الرياض',
      generatedAt: new Date().toISOString(),
      reportingRules: {
        basis: 'تاريخ إنشاء البلاغ',
        cancelled: 'البلاغات الملغاة مستبعدة',
        timezone: 'Asia/Riyadh'
      },
      summary: {
        total: active.length,
        closed: active.filter(isClosed).length,
        open: active.filter(isOpen).length,
        breached: breached.length,
        compliance: compliance.achievedPct,
        previousMonth,
        previousCompliance,
        complianceChange: Math.round((compliance.achievedPct - previousCompliance) * 10) / 10,
        missingBreachReason: breached.filter((ticket) => !String(ticket.breach_reason || '').trim()).length
      },
      contractKpis: contractKpiService.computeMonth(month),
      layers2: groupRows(schoolTickets, (ticket) => ticket.layer2),
      layers3: groupRows(schoolTickets, (ticket) => ticket.layer3),
      supervisors: groupRows(schoolTickets, (ticket) => ticket.supervisor),
      priorities: groupRows(schoolTickets, (ticket) => ticket.priority),
      breachedTickets: breached.map((ticket) => ({
        id: ticket.id,
        case_id: ticket.case_id,
        school_name: ticket.parent_school_name || ticket.school_name || ticket.building_name || '',
        supervisor: ticket.supervisor || 'غير محدد',
        layer3: ticket.layer3 || 'غير محدد',
        created_at: ticket.created_at,
        breach_reason: String(ticket.breach_reason || '').trim() || 'غير مسجل'
      })),
      openTickets,
      overdueOpenCount: openTickets.filter((ticket) => ticket.overdue_minutes > 0).length,
      topSchools,
      schoolsWithoutTickets
    };
  }

  function getManualSections(month, keys) {
    monthRange(month);
    const rows = db.prepare('SELECT section_key, text FROM report_manual_sections WHERE month = ?').all(month);
    const sections = Object.fromEntries(rows.map((row) => [row.section_key, row.text]));
    return Object.fromEntries(keys.map((key) => [key, sections[key] || '']));
  }

  return { getReport, getManualSections };
}

module.exports = { createMonthlyPerformanceReportService, MONTH_PATTERN };

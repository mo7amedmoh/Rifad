import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Calculator, Save, Settings, Sparkles } from 'lucide-react';

const numberFormat = new Intl.NumberFormat('ar-SA', { maximumFractionDigits: 2 });
const KPI_CATEGORIES = [
  ['CM', 'إدارة العقد'], ['OM', 'التشغيل والإدارة'],
  ['HS', 'الخدمات الثقيلة'], ['SS', 'الخدمات الخفيفة']
];
const PAYOUT_BANDS = ['100', '95-99.99', '90-94.99', '85-89.99', '75-84.99', '70-74.99', '<70'];
const PAYOUT_PERIODS = ['1', '2', '3', '4-6', '7+'];
const displayPercent = (value) => `${numberFormat.format(value ?? 0)}%`;
const displayAmount = (value) => value === null || value === undefined ? '—' : numberFormat.format(value);

function calculateScenario(indicators, kpis, weights, payoutTable, contractMonth, monthlyInvoiceValue, fines) {
  const categories = {};
  for (const [category] of KPI_CATEGORIES) {
    const categoryKpis = kpis.filter((kpi) => kpi.category === category);
    const weight = weights[category] || 0;
    const points = categoryKpis.reduce((sum, kpi) => {
      const achieved = indicators[kpi.code]?.achieved_pct ?? 100;
      return sum + Math.min(achieved / kpi.target, 1) * 100;
    }, 0);
    categories[category] = categoryKpis.length ? points * weight / (categoryKpis.length * 100) : 0;
  }
  const performance = Object.values(categories).reduce((sum, value) => sum + value, 0);
  const band = PAYOUT_BANDS.find((item) => {
    if (item === '100') return performance >= 100;
    if (item === '<70') return performance < 70;
    const minimum = Number(item.split('-')[0]);
    const nextMinimum = PAYOUT_BANDS[PAYOUT_BANDS.indexOf(item) - 1];
    return performance >= minimum && (nextMinimum === '100' ? performance < 100 : performance < Number(nextMinimum.split('-')[0]));
  }) || '<70';
  const period = contractMonth >= 7 ? '7+' : contractMonth >= 4 ? '4-6' : String(contractMonth);
  const payoutPct = contractMonth > 0
    ? payoutTable.find((item) => item.period === period && item.band === band)?.percentage
    : null;
  const payout = payoutPct === null || payoutPct === undefined ? null : monthlyInvoiceValue * payoutPct / 100;
  const fineTotal = fines.reduce((sum, fine) => sum + (indicators[fine.kpiCode]?.fine_count || 0) * fine.value, 0);
  return {
    performance,
    band,
    payoutPct: payoutPct ?? null,
    payout,
    fineTotal,
    deduction: payout === null ? null : monthlyInvoiceValue - payout + fineTotal
  };
}

function serializeLines(value, lineParser) {
  try { return lineParser(value); } catch { return null; }
}

export default function ContractKpis({ request, csrf, isAdmin, canEditResults, notify }) {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [data, setData] = useState(null);
  const [projection, setProjection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingResults, setSavingResults] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [manualDrafts, setManualDrafts] = useState({});
  const [simulationCode, setSimulationCode] = useState('');
  const [simulationDraft, setSimulationDraft] = useState('');
  const [simulationEdits, setSimulationEdits] = useState({});
  const [configDraft, setConfigDraft] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const lastDate = monthEndDate(month);
    const paths = [
      request(`/api/contract-kpis/month?month=${encodeURIComponent(month)}`),
      request(`/api/contract-kpis/project?today=${lastDate}`)
    ];
    if (isAdmin) paths.push(request('/api/contract-kpis/config'));
    Promise.all(paths).then(([monthData, forecast, contractConfig]) => {
      if (!active) return;
      setData(monthData);
      setProjection(forecast);
      if (contractConfig) {
        setConfigDraft(createConfigDraft(contractConfig));
      }
      setManualDrafts({});
      setSimulationEdits({});
      setSimulationCode(monthData.kpis.find((item) => item.source === 'auto')?.code || monthData.kpis[0]?.code || '');
    }).catch((error) => {
      if (active) notify(error.message);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [isAdmin, month, notify, request]);

  const simulatedIndicators = useMemo(() => {
    if (!data) return {};
    return Object.fromEntries(Object.entries(data.indicators).map(([code, value]) => [
      code, { ...value, ...(simulationEdits[code] || {}) }
    ]));
  }, [data, simulationEdits]);
  const simulation = useMemo(() => {
    if (!data) return null;
    const contractMonth = data.contractMonth;
    const fines = data?.fineDefinitions || [];
    return calculateScenario(
      simulatedIndicators, data.kpis, data.categoryWeights, data.payoutTable,
      contractMonth, data.monthlyInvoiceValue, fines
    );
  }, [data, simulatedIndicators]);
  const baseline = data ? calculateScenario(
    data.indicators, data.kpis, data.categoryWeights, data.payoutTable,
    data.contractMonth, data.monthlyInvoiceValue, data.fineDefinitions || []
  ) : null;

  const saveManualResults = async () => {
    if (Object.values(manualDrafts).some((value) => String(value.achieved_pct).trim() === '')) {
      return notify('أدخل قيمة كل مؤشر يدوي تغيّر قبل الحفظ.');
    }
    const results = Object.entries(manualDrafts).map(([kpiCode, value]) => ({
      kpiCode,
      achievedPct: Number(value.achieved_pct),
      fineCount: Number(value.fine_count || 0)
    }));
    if (!results.length) return notify('لا توجد تغييرات يدوية لحفظها.');
    if (results.some((item) => !Number.isFinite(item.achievedPct) || item.achievedPct < 0 ||
      item.achievedPct > 100 || !Number.isInteger(item.fineCount) || item.fineCount < 0)) {
      return notify('تحقق من قيم المؤشر وعدد الغرامات.');
    }
    setSavingResults(true);
    try {
      await request('/api/contract-kpis/results', {
        method: 'PUT', csrf, body: JSON.stringify({ month, results })
      });
      notify('تم حفظ النتائج اليدوية.');
      setManualDrafts({});
      const [refreshed, forecast] = await Promise.all([
        request(`/api/contract-kpis/month?month=${encodeURIComponent(month)}`),
        request(`/api/contract-kpis/project?today=${monthEndDate(month)}`)
      ]);
      setData(refreshed);
      setProjection(forecast);
    } catch (error) {
      notify(error.message);
    } finally {
      setSavingResults(false);
    }
  };

  const saveContractConfig = async (event) => {
    event.preventDefault();
    const categoryMap = serializeLines(configDraft.categoryMapText, (value) => value.split(/\r?\n/)
      .map((line) => line.trim()).filter(Boolean).map((line) => {
        const [layer3, kpiCode = ''] = line.split('|').map((part) => part.trim());
        if (!layer3) throw new Error('صيغة ربط التصنيف غير مكتملة.');
        return { layer3, kpiCode: kpiCode || null };
      }));
    const fines = serializeLines(configDraft.finesText, (value) => value.split(/\r?\n/)
      .map((line) => line.trim()).filter(Boolean).map((line) => {
        const [kpiCode, description, amount, unit = ''] = line.split('|').map((part) => part.trim());
        if (!kpiCode || !description || amount === '' || !Number.isFinite(Number(amount)) || Number(amount) < 0) {
          throw new Error('صيغة الغرامة يجب أن تكون: الرمز | الوصف | القيمة | الوحدة.');
        }
        return { kpiCode, description, value: Number(amount), unit };
      }));
    if (!categoryMap || !fines) return notify('تعذر قراءة التصنيفات أو الغرامات؛ راجع صيغة كل سطر.');
    if (!String(configDraft.monthlyInvoiceValue).trim() ||
      ![configDraft.contractStartDate, configDraft.accountabilityStart].every((value) => String(value).trim()) ||
      Object.values(configDraft.categoryWeights).some((value) => !String(value).trim() || !Number.isFinite(Number(value)))) {
      return notify('أكمل التواريخ وقيمة الفاتورة وأوزان الفئات بأرقام صالحة.');
    }
    const payoutTable = configDraft.payoutTable.map((item) => ({
      ...item, percentage: item.percentage === '' ? null : Number(item.percentage)
    }));
    if (payoutTable.some((item) => item.percentage !== null && (!Number.isFinite(item.percentage) || item.percentage < 0 || item.percentage > 100))) {
      return notify('نسب الاستحقاق يجب أن تكون بين 0 و100 أو فارغة.');
    }
    const categoryWeights = Object.fromEntries(Object.entries(configDraft.categoryWeights).map(([key, value]) => [key, Number(value)]));
    setSavingConfig(true);
    try {
      await request('/api/contract-kpis/config', {
        method: 'PUT',
        csrf,
        body: JSON.stringify({
          settings: {
            contractStartDate: configDraft.contractStartDate,
            accountabilityStart: configDraft.accountabilityStart,
            monthlyInvoiceValue: Number(configDraft.monthlyInvoiceValue)
          },
          categoryWeights, payoutTable, fines, categoryMap,
          waterKeywords: configDraft.waterKeywordsText.split(/\r?\n|،|,/).map((word) => word.trim()).filter(Boolean)
        })
      });
      notify('تم حفظ إعدادات العقد.');
      const [refreshed, monthData, forecast] = await Promise.all([
        request('/api/contract-kpis/config'),
        request(`/api/contract-kpis/month?month=${encodeURIComponent(month)}`),
        request(`/api/contract-kpis/project?today=${monthEndDate(month)}`)
      ]);
      setConfigDraft(createConfigDraft(refreshed));
      setData(monthData);
      setProjection(forecast);
    } catch (error) {
      notify(error.message);
    } finally {
      setSavingConfig(false);
    }
  };

  const saveSimulationEdit = () => {
    if (simulationDraft.trim() === '') return notify('أدخل قيمة محاكاة بين 0 و100.');
    const value = Number(simulationDraft);
    if (!simulationCode || !Number.isFinite(value) || value < 0 || value > 100) {
      return notify('أدخل قيمة محاكاة بين 0 و100.');
    }
    setSimulationEdits((current) => ({ ...current, [simulationCode]: { achieved_pct: value } }));
  };

  if (loading) return <section className="panel contract-kpi-panel"><p>جارٍ تحميل مؤشرات العقد…</p></section>;
  if (!data || !projection) return <section className="panel contract-kpi-panel"><p>تعذر تحميل بيانات مؤشرات العقد.</p></section>;

  const missingManual = data.kpis.filter((kpi) => kpi.source === 'manual' && data.indicators[kpi.code]?.missing).length;
  const nextThreshold = [70, 75, 85, 90, 95, 100].find((threshold) => threshold > simulation.performance);
  const impactRows = [...data.kpis].map((kpi) => ({
    ...kpi,
    impact: (data.categoryWeights[kpi.category] || 0) /
      Math.max(1, data.kpis.filter((item) => item.category === kpi.category).length)
  })).sort((a, b) => b.impact - a.impact).slice(0, 5);
  const periodLabel = data.payout.period === '7+' ? '7+' : data.payout.period;
  const projectionPlan = [
    { key: 'best', label: 'أعلى توقع' },
    { key: 'pace', label: 'المتوقع حسب الوتيرة' },
    { key: 'worst', label: 'أدنى توقع' }
  ];

  return <>
    <section className="panel contract-kpi-panel" dir="rtl">
      <div className="contract-kpi-heading">
        <div><span className="eyebrow"><Calculator size={15} />مؤشرات العقد</span><h2>توقع مؤشرات الأداء والخصم</h2><p>نتائج الشهر وتوقعات الإقفال وفق البلاغات ومؤشرات العقد.</p></div>
        <label className="contract-month-picker">شهر التحليل<input type="month" value={month}
          onChange={(event) => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) setMonth(event.target.value); }} /></label>
      </div>
      <div className="contract-completeness">
        <span>الاكتمال</span><strong>{numberFormat.format(data.completeness)} من 36 مؤشراً مُدخل</strong>
        <div className="contract-progress"><i style={{ width: `${data.completeness / 36 * 100}%` }} /></div>
      </div>
      {missingManual > 0 && <div className="contract-upper-bound"><AlertCircle size={16} />الأرقام حد أعلى لأن مؤشرات يدوية لم تُدخل</div>}
      {data.payout.message === 'جدول الفترة غير مُدخل' && <div className="contract-settings-hint">أدخل جدول هذه الفترة من الإعدادات</div>}
      <div className="contract-forecast-grid">
        <article className="contract-forecast-card contract-forecast-main">
          <span>الأداء الشهري المتوقع</span>
          <strong>{displayPercent(projection.range.performance.min)} <i>—</i> {displayPercent(projection.range.performance.max)}</strong>
          <small>المتوقع: {displayPercent(projection.range.performance.expected)}</small>
        </article>
        <article className="contract-forecast-card"><span>الشريحة</span><strong>{data.payout.band || '—'}</strong><small>شهر العقد {numberFormat.format(data.contractMonth || 0)} · فترة {periodLabel || '—'}</small></article>
        <article className="contract-forecast-card"><span>نسبة المستحق</span><strong>{data.payout.payoutPct === null ? '—' : displayPercent(data.payout.payoutPct)}</strong><small>{data.payout.message || 'وفق جدول الاستحقاق'}</small></article>
        <article className="contract-forecast-card"><span>الخصم / الغرامات</span><strong>{displayAmount(data.deduction)}</strong><small>الغرامات: {displayAmount(data.fines)} · قيمة الفاتورة: {displayAmount(data.monthlyInvoiceValue)}</small></article>
      </div>
      <div className="contract-projection-table-wrap">
        <table className="contract-table contract-forecast-table">
          <thead><tr><th>السيناريو</th><th>الأداء</th><th>الشريحة</th><th>نسبة المستحق</th><th>الخصم</th><th>الغرامات</th></tr></thead>
          <tbody>{projectionPlan.map(({ key, label }) => {
            const scenario = projection.scenarios[key];
            return <tr key={key}><th>{label}</th><td>{displayPercent(scenario.performance)}</td><td>{scenario.payout.band || '—'}</td><td>{scenario.payout.payoutPct === null ? '—' : displayPercent(scenario.payout.payoutPct)}</td><td>{displayAmount(scenario.deduction)}</td><td>{displayAmount(scenario.fines)}</td></tr>;
          })}</tbody>
        </table>
      </div>
      <div className="contract-category-list">
        {KPI_CATEGORIES.map(([code, title]) => (
          <details className="contract-category" key={code} open>
            <summary><strong>{code} · {title}</strong><span>الوزن {displayPercent(data.categoryWeights[code])} · المساهمة {displayPercent(data.categories[code]?.points)}</span></summary>
            <div className="contract-table-wrap"><table className="contract-table">
              <thead><tr><th>المؤشر</th><th>القيمة</th><th>النقاط</th><th>المصدر</th><th>البلاغات</th><th>المقام</th><th>النسبة</th><th>حالات الغرامة</th><th>الحالة</th></tr></thead>
              <tbody>{data.kpis.filter((kpi) => kpi.category === code).map((kpi) => {
                const indicator = data.indicators[kpi.code];
                const draft = manualDrafts[kpi.code] || {
                  achieved_pct: indicator.achieved_pct,
                  fine_count: indicator.fine_count || 0
                };
                const cutoff = kpi.importance === 'high' ? 100 : kpi.importance === 'low' ? 50 : 75;
                const needsPlan = indicator.achieved_pct < cutoff;
                return <tr key={kpi.code}>
                  <th><span>{kpi.code}</span><small>{kpi.name}</small></th>
                  <td>{kpi.source === 'manual' && canEditResults
                    ? <input className="contract-number-input" type="number" min="0" max="100" step="0.01"
                      value={draft.achieved_pct}
                      onChange={(event) => setManualDrafts((current) => ({ ...current, [kpi.code]: { ...draft, achieved_pct: event.target.value } }))} />
                    : displayPercent(indicator.achieved_pct)}</td>
                  <td>{numberFormat.format(indicator.points)}</td>
                  <td><span className={`contract-source contract-source-${kpi.source}`}>{kpi.source}</span></td>
                  <td>{indicator.reports === null ? '—' : numberFormat.format(indicator.reports)}</td>
                  <td>{indicator.denominator === null ? '—' : numberFormat.format(indicator.denominator)}</td>
                  <td>{indicator.ratio === null ? '—' : displayPercent(indicator.ratio * 100)}</td>
                  <td>{kpi.source === 'manual' && canEditResults
                    ? <input className="contract-number-input" type="number" min="0" step="1"
                      value={draft.fine_count}
                      onChange={(event) => setManualDrafts((current) => ({ ...current, [kpi.code]: { ...draft, fine_count: event.target.value } }))} />
                    : numberFormat.format(indicator.fine_count || 0)}</td>
                  <td>{needsPlan && <span className="contract-treatment-flag">يحتاج خطة معالجة</span>}{indicator.missing && <span className="contract-missing-flag">غير مُدخل</span>}</td>
                </tr>;
              })}</tbody>
            </table></div>
          </details>
        ))}
      </div>
      {canEditResults && <div className="contract-save-row"><button type="button" className="btn btn-primary" onClick={saveManualResults} disabled={savingResults}>{savingResults ? 'جارٍ الحفظ…' : <><Save size={15} />حفظ المؤشرات اليدوية</>}</button></div>}
      <div className="contract-simulator">
        <div className="panel-heading"><div><h3><Sparkles size={16} />محاكي المؤشرات</h3><p>تغيير مؤقت لا يُحفظ في قاعدة البيانات.</p></div></div>
        <div className="contract-simulator-controls">
          <label>المؤشر<select value={simulationCode} onChange={(event) => { setSimulationCode(event.target.value); setSimulationDraft(''); }}>
            {data.kpis.map((kpi) => <option key={kpi.code} value={kpi.code}>{kpi.code} · {kpi.name}</option>)}
          </select></label>
          <label>القيمة المتوقعة %<input type="number" min="0" max="100" step="0.01" value={simulationDraft}
            onChange={(event) => setSimulationDraft(event.target.value)} placeholder={numberFormat.format(data.indicators[simulationCode]?.achieved_pct ?? 100)} /></label>
          <button className="btn btn-outline" type="button" onClick={saveSimulationEdit}>تطبيق مؤقت</button>
          {Object.keys(simulationEdits).length > 0 && <button className="btn btn-outline" type="button" onClick={() => setSimulationEdits({})}>إعادة الضبط</button>}
        </div>
        <div className="contract-simulation-comparison">
          <div><strong>قبل</strong><span>الأداء {displayPercent(baseline.performance)}</span><span>الشريحة {baseline.band}</span><span>الخصم {displayAmount(baseline.deduction)}</span></div>
          <div><strong>بعد</strong><span>الأداء {displayPercent(simulation.performance)}</span><span>الشريحة {simulation.band}</span><span>الخصم {displayAmount(simulation.deduction)}</span></div>
        </div>
        <p className="contract-next-band">{nextThreshold
          ? `تحتاج ${numberFormat.format(nextThreshold - simulation.performance)} نقطة للشريحة التالية (${nextThreshold}%).`
          : 'الأداء في أعلى شريحة استحقاق.'}</p>
        <div className="contract-impact-list"><strong>أكثر المؤشرات أثراً في الأداء</strong>{impactRows.map((kpi) => <span key={kpi.code}>{kpi.code} · {kpi.name}<b>{numberFormat.format(kpi.impact)} نقطة متاحة</b></span>)}</div>
      </div>
      {data.unmappedCategories.length > 0 && <div className="contract-unmapped"><strong>تصنيفات غير مربوطة</strong><span>{data.unmappedCategories.join('، ')}</span></div>}
      {data.attachedSchoolsNeedingParent.length > 0 && <div className="contract-unmapped"><strong>ملحقات تحتاج ربط</strong><span>{data.attachedSchoolsNeedingParent.map((school) => school.name).join('، ')}</span></div>}
      <div className="contract-report-footer">تقرير مؤشرات العقد · رِفاد · Shalfa</div>
    </section>
    {isAdmin && configDraft && <ContractSettings
      draft={configDraft}
      setDraft={setConfigDraft}
      save={saveContractConfig}
      saving={savingConfig}
    />}
  </>;
}

function createConfigDraft(config) {
  return {
    ...config.settings,
    categoryWeights: config.categoryWeights,
    payoutTable: config.payoutTable.map((item) => ({ ...item, percentage: item.percentage ?? '' })),
    finesText: config.fines.map((item) => [item.kpiCode, item.description, item.value, item.unit].join(' | ')).join('\n'),
    categoryMapText: config.categoryMap.map((item) => `${item.layer3} | ${item.kpiCode || ''}`).join('\n'),
    waterKeywordsText: config.waterKeywords.join('\n')
  };
}

function monthEndDate(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
}

function ContractSettings({ draft, setDraft, save, saving }) {
  const setField = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
  const setPayout = (period, band, value) => setDraft((current) => ({
    ...current,
    payoutTable: current.payoutTable.map((item) =>
      item.period === period && item.band === band ? { ...item, percentage: value } : item)
  }));
  return <section className="panel contract-settings-panel" dir="rtl">
    <div className="panel-heading"><div><h2><Settings size={17} />إعدادات العقد</h2><p>إعدادات مسؤول النظام؛ لا تظهر هذه الشاشة لبقية الأدوار.</p></div></div>
    <form onSubmit={save}>
      <div className="contract-config-grid">
        <label>بداية العقد<input type="date" value={draft.contractStartDate} onChange={(event) => setField('contractStartDate', event.target.value)} /></label>
        <label>بداية المساءلة<input type="date" value={draft.accountabilityStart} onChange={(event) => setField('accountabilityStart', event.target.value)} /></label>
        <label>قيمة الفاتورة الشهرية<input type="number" min="0" step="0.01" value={draft.monthlyInvoiceValue} onChange={(event) => setField('monthlyInvoiceValue', event.target.value)} /></label>
      </div>
      <div className="contract-weight-grid">{KPI_CATEGORIES.map(([key, label]) => <label key={key}>{key} · {label} %<input type="number" min="0" max="100" step="0.01"
        value={draft.categoryWeights[key]} onChange={(event) => setDraft((current) => ({ ...current, categoryWeights: { ...current.categoryWeights, [key]: event.target.value } }))} /></label>)}</div>
      <div className="contract-table-wrap"><table className="contract-table contract-config-payout">
        <thead><tr><th>الفترة</th>{PAYOUT_BANDS.map((band) => <th key={band}>{band}</th>)}</tr></thead>
        <tbody>{PAYOUT_PERIODS.map((period) => <tr key={period}><th>{period}</th>{PAYOUT_BANDS.map((band) => {
          const value = draft.payoutTable.find((item) => item.period === period && item.band === band)?.percentage ?? '';
          return <td key={band}><input aria-label={`الفترة ${period}، الشريحة ${band}`} type="number" min="0" max="100" step="0.01" value={value}
            onChange={(event) => setPayout(period, band, event.target.value)} /></td>;
        })}</tr>)}</tbody>
      </table></div>
      <div className="contract-config-grid contract-config-textareas">
        <label>الغرامات <small>سطر لكل غرامة: الرمز | الوصف | القيمة | الوحدة</small><textarea rows="5" value={draft.finesText} onChange={(event) => setField('finesText', event.target.value)} placeholder="HS.5 | وصف الغرامة | 1000 | لكل حالة" /></label>
        <label>ربط الطبقة 3 بالمؤشر <small>سطر لكل تصنيف: اسم الطبقة | رمز المؤشر</small><textarea rows="8" value={draft.categoryMapText} onChange={(event) => setField('categoryMapText', event.target.value)} /></label>
        <label>كلمات تصنيف المياه <textarea rows="5" value={draft.waterKeywordsText} onChange={(event) => setField('waterKeywordsText', event.target.value)} /></label>
      </div>
      <button className="btn btn-primary" disabled={saving}>{saving ? 'جارٍ حفظ إعدادات العقد…' : 'حفظ إعدادات العقد'}</button>
    </form>
  </section>;
}

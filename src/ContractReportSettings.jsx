import React, { useEffect, useState } from 'react';
import { Save, Settings } from 'lucide-react';

const CATEGORIES = [
  ['CM', 'إدارة العقد'], ['OM', 'التشغيل والإدارة'],
  ['HS', 'الخدمات الثقيلة'], ['SS', 'الخدمات الخفيفة']
];
const PAYOUT_BANDS = ['100', '95-99.99', '90-94.99', '85-89.99', '75-84.99', '70-74.99', '<70'];
const PAYOUT_PERIODS = ['1', '2', '3', '4-6', '7+'];

function createDraft(config) {
  return {
    ...config.settings,
    categoryWeights: config.categoryWeights,
    payoutTable: config.payoutTable.map((item) => ({ ...item, percentage: item.percentage ?? '' })),
    finesText: config.fines.map((item) => [item.kpiCode, item.description, item.value, item.unit].join(' | ')).join('\n'),
    categoryMapText: config.categoryMap.map((item) => `${item.layer3} | ${item.kpiCode || ''}`).join('\n'),
    waterKeywordsText: config.waterKeywords.join('\n')
  };
}

function parseLines(value, parser) {
  try {
    return parser(value);
  } catch {
    return null;
  }
}

export default function ContractReportSettings({ request, csrf, notify, onSaved }) {
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    request('/api/contract-kpis/config')
      .then((config) => {
        if (active) setDraft(createDraft(config));
      })
      .catch((error) => {
        if (active) notify(error.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [notify, request]);

  const save = async (event) => {
    event.preventDefault();
    const categoryMap = parseLines(draft.categoryMapText, (value) => value.split(/\r?\n/)
      .map((line) => line.trim()).filter(Boolean).map((line) => {
        const [layer3, kpiCode = ''] = line.split('|').map((part) => part.trim());
        if (!layer3) throw new Error('صيغة ربط التصنيف غير مكتملة.');
        return { layer3, kpiCode: kpiCode || null };
      }));
    const fines = parseLines(draft.finesText, (value) => value.split(/\r?\n/)
      .map((line) => line.trim()).filter(Boolean).map((line) => {
        const [kpiCode, description, amount, unit = ''] = line.split('|').map((part) => part.trim());
        if (!kpiCode || !description || amount === '' || !Number.isFinite(Number(amount)) || Number(amount) < 0) {
          throw new Error('صيغة الغرامة يجب أن تكون: الرمز | الوصف | القيمة | الوحدة.');
        }
        return { kpiCode, description, value: Number(amount), unit };
      }));
    if (!categoryMap || !fines) return notify('تعذر قراءة التصنيفات أو الغرامات؛ راجع صيغة كل سطر.');
    if (!String(draft.monthlyInvoiceValue).trim() ||
      ![draft.contractStartDate, draft.accountabilityStart].every((value) => String(value).trim()) ||
      Object.values(draft.categoryWeights).some((value) => !String(value).trim() || !Number.isFinite(Number(value)))) {
      return notify('أكمل التواريخ وقيمة الفاتورة وأوزان الفئات بأرقام صالحة.');
    }
    const payoutTable = draft.payoutTable.map((item) => ({
      ...item, percentage: item.percentage === '' ? null : Number(item.percentage)
    }));
    if (payoutTable.some((item) => item.percentage !== null &&
      (!Number.isFinite(item.percentage) || item.percentage < 0 || item.percentage > 100))) {
      return notify('نسب الاستحقاق يجب أن تكون بين 0 و100 أو فارغة.');
    }

    setSaving(true);
    try {
      await request('/api/contract-kpis/config', {
        method: 'PUT',
        csrf,
        body: JSON.stringify({
          settings: {
            contractStartDate: draft.contractStartDate,
            accountabilityStart: draft.accountabilityStart,
            monthlyInvoiceValue: Number(draft.monthlyInvoiceValue)
          },
          categoryWeights: Object.fromEntries(
            Object.entries(draft.categoryWeights).map(([key, value]) => [key, Number(value)])
          ),
          payoutTable,
          fines,
          categoryMap,
          waterKeywords: draft.waterKeywordsText.split(/\r?\n|،|,/).map((word) => word.trim()).filter(Boolean)
        })
      });
      notify('تم حفظ إعدادات العقد.');
      await onSaved();
    } catch (error) {
      notify(error.message);
    } finally {
      setSaving(false);
    }
  };

  const setField = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
  const setPayout = (period, band, value) => setDraft((current) => ({
    ...current,
    payoutTable: current.payoutTable.map((item) =>
      item.period === period && item.band === band ? { ...item, percentage: value } : item)
  }));

  return <details className="report-contract-config">
    <summary><Settings size={16} />إعدادات العقد (للمدير)</summary>
    <section className="panel contract-settings-panel" dir="rtl">
      {loading ? <p>جارٍ تحميل إعدادات العقد…</p> : !draft ? <p>تعذر تحميل إعدادات العقد.</p> : <>
        <div className="panel-heading"><div><h2>إعدادات العقد</h2><p>تؤثر التعديلات على تقرير الأداء الشهري والحسابات التالية.</p></div></div>
        <form onSubmit={save}>
          <div className="contract-config-grid">
            <label>بداية العقد<input type="date" value={draft.contractStartDate} onChange={(event) => setField('contractStartDate', event.target.value)} /></label>
            <label>بداية المساءلة<input type="date" value={draft.accountabilityStart} onChange={(event) => setField('accountabilityStart', event.target.value)} /></label>
            <label>قيمة الفاتورة الشهرية<input type="number" min="0" step="0.01" value={draft.monthlyInvoiceValue} onChange={(event) => setField('monthlyInvoiceValue', event.target.value)} /></label>
          </div>
          <div className="contract-weight-grid">{CATEGORIES.map(([key, label]) => <label key={key}>{key} · {label} %<input type="number" min="0" max="100" step="0.01"
            value={draft.categoryWeights[key]} onChange={(event) => setDraft((current) => ({
              ...current, categoryWeights: { ...current.categoryWeights, [key]: event.target.value }
            }))} /></label>)}</div>
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
          <button className="btn btn-primary" disabled={saving}>{saving ? <><Save size={15} />جارٍ حفظ إعدادات العقد…</> : 'حفظ إعدادات العقد'}</button>
        </form>
      </>}
    </section>
  </details>;
}

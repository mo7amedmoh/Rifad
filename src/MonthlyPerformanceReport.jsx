import React, { useEffect, useMemo, useState } from 'react';
import {
  AlignmentType, BorderStyle, Document, Footer, Header, PageNumber, Packer,
  Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType
} from 'docx';
import { AlertCircle, CheckCircle2, Download, FileText, Printer, Save } from 'lucide-react';

const MONTHLY_SECTIONS = [
  ['subcontractor', 'المقاول من الباطن'],
  ['inventory', 'المخزون'],
  ['supportOffice', 'مكتب الدعم'],
  ['financialReview', 'المراجعة المالية'],
  ['resourceConsumption', 'استهلاك الموارد'],
  ['potentialIncidents', 'الحوادث المحتملة'],
  ['assetSchedules', 'جداول الأصول'],
  ['otherItems', 'بنود أخرى']
];
const CATEGORY_LABELS = { CM: 'إدارة العقد', OM: 'التشغيل والإدارة', HS: 'الخدمات الثقيلة', SS: 'الخدمات الخفيفة' };
const englishNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const englishInteger = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const numberText = (value) => value === null || value === undefined ? '—' : englishNumber.format(value);
const percentText = (value) => value === null || value === undefined ? '—' : `${englishNumber.format(value)}%`;
const monthToday = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit'
}).format(new Date());
function previousMonth() {
  const [year, month] = monthToday().split('-').map(Number);
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
}
function monthLabel(value) {
  if (!/^\d{4}-\d{2}$/.test(value || '')) return value || '—';
  return new Intl.DateTimeFormat('ar-SA', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${value}-01T00:00:00Z`));
}
function dateLabel(value) {
  if (!value) return 'غير متاح';
  return new Intl.DateTimeFormat('ar-SA', {
    timeZone: 'Asia/Riyadh', day: 'numeric', month: 'long', year: 'numeric'
  }).format(new Date(value));
}
function wordDateLabel(value) {
  if (!value) return 'غير متاح';
  return new Intl.DateTimeFormat('ar-SA-u-nu-latn', {
    timeZone: 'Asia/Riyadh', day: 'numeric', month: 'long', year: 'numeric'
  }).format(new Date(value));
}
function defaultNarrative(report) {
  const weakestLayer = [...(report.layers3 || [])].sort((a, b) => a.compliance - b.compliance)[0];
  const weakestSupervisor = [...(report.supervisors || [])].sort((a, b) => a.compliance - b.compliance)[0];
  return [
    `أضعف تصنيف خلال الشهر: ${weakestLayer?.name || 'لا توجد بيانات'}${weakestLayer ? ` (التزام ${percentText(weakestLayer.compliance)})` : ''}.`,
    `أضعف مشرف حسب الالتزام: ${weakestSupervisor?.name || 'لا توجد بيانات'}${weakestSupervisor ? ` (التزام ${percentText(weakestSupervisor.compliance)})` : ''}.`,
    `عدد البلاغات المفتوحة المتجاوزة للمهلة: ${englishInteger.format(report.overdueOpenCount || 0)}.`
  ].join('\n');
}
function cellText(value, font, header = false) {
  const text = value === null || value === undefined || value === '' ? '—' : String(value);
  return new TableCell({
    margins: { top: 90, bottom: 90, left: 100, right: 100 },
    shading: { type: ShadingType.CLEAR, fill: header ? 'EAF5F3' : 'FFFFFF', color: 'auto' },
    children: [new Paragraph({
      alignment: AlignmentType.RIGHT,
      bidirectional: true,
      children: [new TextRun({ text, font: { ascii: font, hAnsi: font, cs: font, eastAsia: font }, size: 18 })]
    })]
  });
}
function makeWordTable(headers, rows, font) {
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'DCE7E8' };
  const cells = (values, header = false) => values.map((value) => cellText(value, font, header));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: headers.map(() => Math.floor(9000 / headers.length)),
    visuallyRightToLeft: true,
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: [
      new TableRow({ tableHeader: true, children: cells(headers, true) }),
      ...rows.map((row) => new TableRow({ children: cells(row) }))
    ]
  });
}
function wordParagraph(text, font, options = {}) {
  const { bold = false, size = 22, color = '284654', alignment = AlignmentType.RIGHT, pageBreakBefore = false } = options;
  return new Paragraph({
    bidirectional: true,
    alignment,
    pageBreakBefore,
    spacing: { after: 120 },
    children: [new TextRun({
      text: String(text ?? ''),
      bold,
      size,
      color,
      font: { ascii: font, hAnsi: font, cs: font, eastAsia: font }
    })]
  });
}
function sectionTitle(title, font) {
  return wordParagraph(title, font, { bold: true, size: 28, color: '168B83', pageBreakBefore: true });
}
function createWordDocument(snapshot, font) {
  const report = snapshot.report;
  const kpis = report.contractKpis;
  const summary = report.summary;
  const content = [
    wordParagraph(report.contract, font, { bold: true, size: 36, color: '168B83', alignment: AlignmentType.CENTER }),
    wordParagraph('تقرير الأداء الشهري للعقد', font, { bold: true, size: 34, alignment: AlignmentType.CENTER }),
    wordParagraph(new Intl.DateTimeFormat('ar-SA-u-nu-latn', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${report.month}-01T00:00:00Z`)), font, { bold: true, size: 30, alignment: AlignmentType.CENTER }),
    wordParagraph(`تاريخ الإنشاء: ${wordDateLabel(report.generatedAt)}`, font, { alignment: AlignmentType.CENTER }),
    wordParagraph(`الحالة: ${snapshot.status === 'approved' ? 'معتمد' : 'مسودة'}`, font, { alignment: AlignmentType.CENTER }),
    sectionTitle('الملخص التنفيذي', font),
    makeWordTable(['المؤشر', 'القيمة'], [
      ['إجمالي البلاغات', englishInteger.format(summary.total)],
      ['المغلقة', englishInteger.format(summary.closed)],
      ['المفتوحة', englishInteger.format(summary.open)],
      ['المخترقة', englishInteger.format(summary.breached)],
      ['الالتزام', percentText(summary.compliance)],
      [`التزام ${new Intl.DateTimeFormat('ar-SA-u-nu-latn', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${summary.previousMonth}-01T00:00:00Z`))}`, percentText(summary.previousCompliance)],
      ['التغير عن الشهر السابق', percentText(summary.complianceChange)],
      ['اختراقات دون سبب مسجل', englishInteger.format(summary.missingBreachReason)]
    ], font),
    wordParagraph(snapshot.narrative, font),
    sectionTitle('بطاقة الأداء', font),
    wordParagraph(`الأداء الشهري: ${percentText(kpis.performance)} · الشريحة: ${kpis.payout?.band ?? 'غير مُدخل'} · شهر العقد: ${kpis.contractMonth ?? '—'}`, font),
    wordParagraph(`نسبة المستحق: ${percentText(kpis.payout?.payoutPct)} · الخصم: ${kpis.deduction === null ? 'غير مُدخل' : numberText(kpis.deduction)}`, font),
    makeWordTable(['الفئة', 'النقاط النهائية', 'الوزن', 'عدد المؤشرات'], Object.entries(kpis.categories || {}).map(([category, value]) => [
      CATEGORY_LABELS[category] || category, numberText(value.points), percentText(value.weight), englishInteger.format(value.indicators)
    ]), font)
  ];
  if (Object.values(kpis.indicators || {}).some((indicator) => indicator.missing)) {
    content.push(wordParagraph('تنبيه: توجد مؤشرات يدوية لم تُدخل.', font, { bold: true, color: 'B45309' }));
  }
  content.push(makeWordTable(['الرمز', 'المؤشر', 'القيمة', 'النقاط', 'المصدر'], (kpis.kpis || []).map((item) => {
    const value = kpis.indicators[item.code];
    return [item.code, item.name, value?.missing ? 'لم يُدخل' : percentText(value?.achieved_pct), value?.missing ? '—' : numberText(value?.points), item.source === 'auto' ? 'آلي' : 'يدوي'];
  }), font));
  content.push(sectionTitle('تفاصيل مؤشرات الخدمات الثقيلة الآلية', font));
  content.push(makeWordTable(['الرمز', 'المؤشر', 'البلاغات', 'المقام', 'النسبة'], (kpis.kpis || []).filter((item) => item.source === 'auto' && item.code.startsWith('HS.')).map((item) => {
    const value = kpis.indicators[item.code];
    return [item.code, item.name, numberText(value?.reports), numberText(value?.denominator), percentText(value?.ratio === null || value?.ratio === undefined ? null : value.ratio * 100)];
  }), font));
  content.push(sectionTitle('تحليل البلاغات', font));
  for (const [title, rows] of [['حسب الطبقة الثانية', report.layers2], ['حسب الطبقة الثالثة', report.layers3], ['حسب المشرف', report.supervisors], ['حسب الأولوية', report.priorities]]) {
    content.push(wordParagraph(title, font, { bold: true, size: 24 }));
    content.push(makeWordTable(['التصنيف', 'الإجمالي', 'مغلق', 'مخترق', 'الالتزام'], (rows || []).map((row) => [
      row.name, englishInteger.format(row.total), englishInteger.format(row.closed), englishInteger.format(row.breached), percentText(row.compliance)
    ]), font));
  }
  content.push(sectionTitle('البلاغات المخترقة', font));
  content.push(wordParagraph(`عدد الاختراقات دون سبب مسجل: ${englishInteger.format(summary.missingBreachReason)}`, font, { bold: summary.missingBreachReason > 0, color: summary.missingBreachReason ? 'B45309' : '284654' }));
  content.push(makeWordTable(['المعرف', 'المدرسة', 'المشرف', 'التصنيف', 'تاريخ الإنشاء', 'سبب الاختراق'], report.breachedTickets.map((ticket) => [
    ticket.case_id, ticket.school_name, ticket.supervisor, ticket.layer3, wordDateLabel(ticket.created_at), ticket.breach_reason
  ]), font));
  content.push(sectionTitle('البلاغات المفتوحة حالياً من جميع الأشهر', font));
  content.push(wordParagraph(`البلاغات المفتوحة المتجاوزة للمهلة: ${englishInteger.format(report.overdueOpenCount)}`, font, { bold: true }));
  content.push(makeWordTable(['المعرف', 'المدرسة', 'المشرف', 'الأولوية', 'تاريخ الإنشاء', 'مدة التجاوز (دقيقة)'], report.openTickets.map((ticket) => [
    ticket.case_id, ticket.school_name, ticket.supervisor, ticket.priority, wordDateLabel(ticket.created_at), ticket.overdue_minutes > 0 ? englishInteger.format(ticket.overdue_minutes) : '—'
  ]), font));
  content.push(sectionTitle('الحالات غير الثابتة', font));
  content.push(wordParagraph('أعلى 10 مدارس بعدد البلاغات', font, { bold: true, size: 24 }));
  content.push(makeWordTable(['المدرسة', 'الرقم الوزاري', 'عدد البلاغات'], report.topSchools.map((school) => [
    school.name, school.school_number, englishInteger.format(school.total)
  ]), font));
  content.push(wordParagraph('مدارس محسوبة بلا بلاغات خلال الشهر', font, { bold: true, size: 24 }));
  content.push(makeWordTable(['المدرسة', 'الرقم الوزاري', 'المشرف', 'المنطقة'], report.schoolsWithoutTickets.map((school) => [
    school.name, school.school_number, school.supervisor, school.region
  ]), font));
  content.push(sectionTitle('الأقسام اليدوية', font));
  for (const [key, title] of MONTHLY_SECTIONS) {
    const text = snapshot.manualSections?.[key]?.trim();
    content.push(wordParagraph(title, font, { bold: true, size: 24 }));
    content.push(wordParagraph(text || 'لم يُعبأ بعد', font, {
      color: text ? '284654' : '8A5A10',
      size: 20
    }));
  }
  const header = new Header({ children: [wordParagraph(report.contract, font, { size: 16, color: '72858C' })] });
  const footer = new Footer({ children: [new Paragraph({
    alignment: AlignmentType.CENTER,
    bidirectional: true,
    children: [
      new TextRun({ children: ['صفحة ', PageNumber.CURRENT], font: { ascii: font, hAnsi: font, cs: font }, size: 16 })
    ]
  })] });
  return new Document({
    styles: { default: { document: { run: { font: { ascii: font, hAnsi: font, cs: font, eastAsia: font }, size: 20 } } } },
    sections: [{
      properties: { page: { margin: { top: 1150, right: 1100, bottom: 1150, left: 1100 } } },
      headers: { default: header },
      footers: { default: footer },
      children: content
    }]
  });
}

export default function MonthlyPerformanceReport({ csrf, session, request, notify }) {
  const canEdit = ['admin', 'receiver', 'engineer'].includes(session.role);
  const [month, setMonth] = useState(previousMonth);
  const [loaded, setLoaded] = useState(null);
  const [narrative, setNarrative] = useState('');
  const [manualSections, setManualSections] = useState({});
  const [snapshots, setSnapshots] = useState([]);
  const [snapshotId, setSnapshotId] = useState('');
  const [snapshot, setSnapshot] = useState(null);
  const [font, setFont] = useState(() => localStorage.getItem('rifad-monthly-report-font') || 'Arial');
  const [loading, setLoading] = useState(true);
  const [savingSections, setSavingSections] = useState(false);
  const [approving, setApproving] = useState(false);
  const report = snapshot?.data?.report || loaded?.report;
  const currentSections = snapshot?.data?.manualSections || manualSections;
  const narrativeText = snapshot?.data?.narrative ?? narrative;
  const missingManualCount = report?.contractKpis?.kpis?.filter((item) =>
    item.source === 'manual' && report.contractKpis.indicators[item.code]?.missing
  ).length || 0;
  const categories = useMemo(() => Object.entries(report?.contractKpis?.categories || {}), [report]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setSnapshot(null);
    setSnapshotId('');
    Promise.all([
      request(`/api/monthly-performance-report?month=${encodeURIComponent(month)}`),
      request(`/api/monthly-performance-report/snapshots?month=${encodeURIComponent(month)}`)
    ]).then(([data, saved]) => {
      if (!active) return;
      setLoaded(data);
      setManualSections(data.manualSections || {});
      setNarrative(defaultNarrative(data.report));
      setSnapshots(saved.items || []);
    }).catch((error) => {
      if (active) notify(error.message);
    }).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [month, notify, request]);

  const loadSnapshot = async (id) => {
    setSnapshotId(id);
    if (!id) {
      setSnapshot(null);
      return;
    }
    try {
      const { snapshot: saved } = await request(`/api/monthly-performance-report/snapshots/${encodeURIComponent(id)}`);
      setSnapshot(saved);
      notify('تم فتح النسخة المعتمدة المحفوظة.');
    } catch (error) {
      notify(error.message);
    }
  };
  const saveManualSections = async () => {
    setSavingSections(true);
    try {
      const { manualSections: saved } = await request('/api/monthly-performance-report/manual-sections', {
        method: 'PUT',
        csrf,
        body: JSON.stringify({
          month,
          sections: MONTHLY_SECTIONS.map(([key]) => ({ key, text: manualSections[key] || '' }))
        })
      });
      setManualSections(saved);
      notify('تم حفظ الأقسام اليدوية لهذا الشهر.');
    } catch (error) {
      notify(error.message);
    } finally {
      setSavingSections(false);
    }
  };
  const approveReport = async () => {
    if (!loaded?.report || !canEdit) return;
    setApproving(true);
    try {
      const { manualSections: savedSections } = await request('/api/monthly-performance-report/manual-sections', {
        method: 'PUT',
        csrf,
        body: JSON.stringify({
          month,
          sections: MONTHLY_SECTIONS.map(([key]) => ({ key, text: manualSections[key] || '' }))
        })
      });
      setManualSections(savedSections);
      const data = {
        month,
        report: loaded.report,
        manualSections: savedSections,
        narrative,
        font
      };
      const { snapshot: saved } = await request('/api/monthly-performance-report/snapshots', {
        method: 'POST', csrf, body: JSON.stringify({ month, data })
      });
      setSnapshots((items) => [saved, ...items]);
      setSnapshotId(String(saved.id));
      setSnapshot({ ...saved, data, status: 'approved' });
      notify('تم اعتماد التقرير وحفظ نسخة ثابتة.');
    } catch (error) {
      notify(error.message);
    } finally {
      setApproving(false);
    }
  };
  const downloadWord = async () => {
    if (!report) return;
    try {
      const data = {
        month,
        report,
        manualSections: currentSections,
        narrative: narrativeText,
        status: snapshot ? 'approved' : 'draft'
      };
      const blob = await Packer.toBlob(createWordDocument(data, snapshot?.data?.font || font));
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `تقرير-الأداء-الشهري-${month}.docx`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify('تم تنزيل تقرير Word.');
    } catch (error) {
      notify(`تعذر إنشاء ملف Word: ${error.message}`);
    }
  };
  const setFontFamily = (value) => {
    setFont(value);
    localStorage.setItem('rifad-monthly-report-font', value);
  };

  if (loading) return <div className="report-loading">جارٍ إعداد بيانات التقرير الشهري…</div>;
  if (!report) return <div className="report-loading">تعذر تحميل بيانات التقرير.</div>;
  const payoutPct = report.contractKpis.payout?.payoutPct;
  return <div className="monthly-report-page" dir="rtl">
    <div className="page-heading monthly-report-heading">
      <div><div className="eyebrow">تقارير العقد</div><h1>تقرير الأداء الشهري</h1><p>مسودة تقرير عقد مباني مدارس الرياض — القياس حسب تاريخ الإنشاء، الملغاة مستبعدة، والتوقيت الرياض.</p></div>
      <div className="monthly-report-actions">
        <button className="btn btn-primary" onClick={downloadWord}><Download size={16} />تنزيل Word</button>
        <button className="btn btn-outline" onClick={() => window.print()}><Printer size={16} />طباعة/PDF</button>
        {canEdit && !snapshot && <button className="btn btn-outline" onClick={approveReport} disabled={approving}><Save size={16} />{approving ? 'جارٍ الاعتماد…' : 'اعتماد وحفظ نسخة'}</button>}
      </div>
    </div>
    <div className="monthly-report-toolbar">
      <label>شهر التقرير<input type="month" value={month} max={monthToday()} onChange={(event) => {
        if (event.target.value) setMonth(event.target.value);
      }} /></label>
      <label>خط Word<select value={font} onChange={(event) => setFontFamily(event.target.value)}><option>Arial</option><option>Calibri</option><option>Times New Roman</option></select></label>
      <label className="monthly-snapshot-picker">النسخ المعتمدة<select value={snapshotId} onChange={(event) => loadSnapshot(event.target.value)}><option value="">المعاينة الحالية</option>{snapshots.map((item) => <option value={item.id} key={item.id}>نسخة {dateLabel(item.created_at)} · {item.created_by || 'مستخدم'}</option>)}</select></label>
      {snapshot && <span className="report-approved-badge"><CheckCircle2 size={15} />نسخة معتمدة محفوظة · لا تتغير بتحديث البيانات</span>}
    </div>

    <article className="monthly-report-preview">
      <header className="monthly-report-cover">
        <span className="report-cover-mark"><FileText size={28} /></span>
        <span className="eyebrow">العقد TBC-FM-909</span>
        <h2>تقرير الأداء الشهري</h2>
        <h3>مباني مدارس الرياض</h3>
        <strong>{monthLabel(report.month)}</strong>
        <div><span>تاريخ الإنشاء: {dateLabel(report.generatedAt)}</span><b className={snapshot ? 'approved-status' : 'draft-status'}>{snapshot ? 'معتمد' : 'مسودة'}</b></div>
      </header>

      <ReportSection title="الملخص التنفيذي">
        <div className="report-metric-grid">
          {[['إجمالي البلاغات', report.summary.total], ['مغلقة', report.summary.closed], ['مفتوحة', report.summary.open], ['مخترقة', report.summary.breached], ['الالتزام', percentText(report.summary.compliance)], ['التغير عن الشهر السابق', percentText(report.summary.complianceChange)]].map(([label, value]) => <div className="report-metric" key={label}><span>{label}</span><strong>{typeof value === 'number' ? englishInteger.format(value) : value}</strong></div>)}
        </div>
        {report.summary.missingBreachReason > 0 && <div className="report-warning"><AlertCircle size={17} />{englishInteger.format(report.summary.missingBreachReason)} بلاغ مخترق دون سبب مسجل.</div>}
        <label className="report-narrative-edit">فقرة الملخص القابلة للتعديل<textarea disabled={Boolean(snapshot)} value={narrativeText} onChange={(event) => setNarrative(event.target.value)} rows={4} /></label>
      </ReportSection>

      <ReportSection title="بطاقة الأداء">
        {missingManualCount > 0 && <div className="report-warning"><AlertCircle size={17} />{englishInteger.format(missingManualCount)} مؤشراً يدوياً لم يُدخل.</div>}
        <div className="contract-report-scorecards">
          <div><span>الأداء الشهري</span><strong>{percentText(report.contractKpis.performance)}</strong></div>
          <div><span>الشريحة</span><strong>{report.contractKpis.payout?.band || 'غير مُدخل'}</strong></div>
          <div><span>شهر العقد</span><strong>{numberText(report.contractKpis.contractMonth)}</strong></div>
          <div><span>نسبة المستحق</span><strong>{payoutPct == null ? 'غير مُدخل' : percentText(payoutPct)}</strong></div>
          <div><span>الخصم</span><strong>{report.contractKpis.deduction == null ? 'غير مُدخل' : numberText(report.contractKpis.deduction)}</strong></div>
        </div>
        <DataTable headers={['الفئة', 'النقاط', 'الوزن', 'الدرجة النهائية']} rows={categories.map(([category, value]) => [CATEGORY_LABELS[category] || category, numberText(value.points), percentText(value.weight), numberText(value.points)])} />
        <DataTable headers={['الرمز', 'المؤشر', 'القيمة', 'النقاط', 'المصدر']} rows={(report.contractKpis.kpis || []).map((item) => {
          const value = report.contractKpis.indicators[item.code];
          return [item.code, item.name, value?.missing ? 'لم يُدخل' : percentText(value?.achieved_pct), value?.missing ? '—' : numberText(value?.points), item.source === 'auto' ? 'آلي' : 'يدوي'];
        })} />
      </ReportSection>

      <ReportSection title="تفاصيل مؤشرات HS الآلية">
        <DataTable headers={['الرمز', 'النظام', 'البلاغات', 'المقام', 'النسبة']} rows={(report.contractKpis.kpis || []).filter((item) => item.source === 'auto' && item.code.startsWith('HS.')).map((item) => {
          const value = report.contractKpis.indicators[item.code];
          return [item.code, item.name, numberText(value?.reports), numberText(value?.denominator), percentText(value?.ratio == null ? null : value.ratio * 100)];
        })} />
      </ReportSection>

      <ReportSection title="تحليل البلاغات">
        <AnalysisTable title="حسب الطبقة الثانية" rows={report.layers2} />
        <AnalysisTable title="حسب الطبقة الثالثة" rows={report.layers3} />
        <AnalysisTable title="حسب المشرف" rows={report.supervisors} />
        <AnalysisTable title="حسب الأولوية" rows={report.priorities} />
      </ReportSection>

      <ReportSection title="البلاغات المخترقة">
        <p className="report-inline-note">بلا سبب مسجل: <strong>{englishInteger.format(report.summary.missingBreachReason)}</strong></p>
        <DataTable headers={['المعرف', 'المدرسة', 'المشرف', 'التصنيف', 'تاريخ الإنشاء', 'سبب الاختراق']} rows={report.breachedTickets.map((ticket) => [ticket.case_id, ticket.school_name, ticket.supervisor, ticket.layer3, dateLabel(ticket.created_at), ticket.breach_reason])} empty="لا توجد بلاغات مخترقة في هذا الشهر." />
      </ReportSection>

      <ReportSection title="البلاغات المفتوحة حالياً من كل الأشهر">
        <p className="report-inline-note">متجاوزة المهلة: <strong>{englishInteger.format(report.overdueOpenCount)}</strong></p>
        <DataTable headers={['المعرف', 'المدرسة', 'المشرف', 'الأولوية', 'تاريخ الإنشاء', 'مدة التجاوز']} rows={report.openTickets.map((ticket) => [ticket.case_id, ticket.school_name, ticket.supervisor, ticket.priority, dateLabel(ticket.created_at), ticket.overdue_minutes > 0 ? `${englishInteger.format(ticket.overdue_minutes)} دقيقة` : '—'])} empty="لا توجد بلاغات مفتوحة حالياً." />
      </ReportSection>

      <ReportSection title="الحالات غير الثابتة">
        <AnalysisTable title="أعلى 10 مدارس بعدد البلاغات" rows={report.topSchools.map((school) => ({ name: school.name, total: school.total, school_number: school.school_number }))} headers={['المدرسة', 'الرقم الوزاري', 'البلاغات']} />
        <DataTable headers={['المدارس المحسوبة بلا بلاغ خلال الشهر', 'الرقم الوزاري', 'المشرف', 'المنطقة']} rows={report.schoolsWithoutTickets.map((school) => [school.name, school.school_number, school.supervisor, school.region])} empty="جميع المدارس المحسوبة لديها بلاغ واحد على الأقل." />
      </ReportSection>

      <ReportSection title="الأقسام اليدوية">
        <div className="manual-report-sections">
          {MONTHLY_SECTIONS.map(([key, title]) => {
            const text = currentSections[key] || '';
            return <label className={`manual-report-section ${text.trim() ? '' : 'manual-report-empty'}`} key={key}>
              <strong>{title}</strong>
              <textarea disabled={Boolean(snapshot) || !canEdit} rows={3} value={text} placeholder="لم يُعبأ بعد" onChange={(event) => setManualSections((current) => ({ ...current, [key]: event.target.value }))} />
              {!text.trim() && <span className="manual-report-empty-print">لم يُعبأ بعد</span>}
            </label>;
          })}
        </div>
        {canEdit && !snapshot && <button className="btn btn-outline report-save-sections" onClick={saveManualSections} disabled={savingSections}><Save size={15} />{savingSections ? 'جارٍ الحفظ…' : 'حفظ الأقسام اليدوية'}</button>}
      </ReportSection>
      <footer className="monthly-report-footer">TBC-FM-909 · مباني مدارس الرياض · القياس حسب تاريخ الإنشاء · الملغاة مستبعدة · توقيت الرياض</footer>
    </article>
  </div>;
}

function ReportSection({ title, children }) {
  return <section className="monthly-report-section"><h2>{title}</h2>{children}</section>;
}
function DataTable({ headers, rows, empty = 'لا توجد بيانات.' }) {
  return rows.length ? <div className="report-table-wrap"><table className="report-data-table"><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${index}-${row[0]}`}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell ?? '—'}</td>)}</tr>)}</tbody></table></div> : <div className="report-empty">{empty}</div>;
}
function AnalysisTable({ title, rows, headers = ['التصنيف', 'الإجمالي', 'مغلق', 'مخترق', 'الالتزام'] }) {
  return <div className="report-analysis-table"><h3>{title}</h3><DataTable headers={headers} rows={rows.map((row) => headers.length === 3
    ? [row.name, row.school_number || '—', englishInteger.format(row.total)]
    : [row.name, englishInteger.format(row.total), englishInteger.format(row.closed), englishInteger.format(row.breached), percentText(row.compliance)])} /></div>;
}

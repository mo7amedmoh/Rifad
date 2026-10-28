import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { toBlob, toPng } from 'html-to-image';
import {
  Activity, AlertCircle, AlertTriangle, ArrowDownToLine, ArrowLeft,
  Building2, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight,
  ClipboardList, Clock3, CloudUpload, FileSpreadsheet, Filter, LayoutDashboard, Share2,
  LockKeyhole, LogOut, Menu, Plus, Search, Settings, ShieldCheck, Sparkles, Users,
  Wrench, X
} from 'lucide-react';
import './styles.css';

const REASONS = ['تأخر توريد قطع', 'موافقة الاستشاري', 'تعذر دخول المدرسة', 'تأخر إقفال على المنصة', 'نقص عمالة/فنيين', 'تصنيف خاطئ للبلاغ', 'صهريج/خدمة خارجية', 'أخرى'];
const NAV = [
  { id: 'dashboard', title: 'لوحة التحكم', icon: LayoutDashboard },
  { id: 'tickets', title: 'قاعدة بيانات البلاغات', icon: ClipboardList },
  { id: 'analysis', title: 'دراسة وتحليلات', icon: Activity },
  { id: 'schools', title: 'قاعدة بيانات المدارس', icon: Building2 },
  { id: 'account', title: 'حسابي', icon: Users },
  { id: 'users', title: 'إدارة الحسابات', icon: Users, admin: true },
  { id: 'settings', title: 'الإعدادات', icon: Settings, admin: true }
];
const roleLabels = { admin: 'مسؤول النظام', receiver: 'متلقي البلاغات', engineer: 'مهندس منطقة', viewer: 'متابع' };
const historyFieldLabels = { school_number: 'الرقم الوزاري', name: 'اسم المدرسة', supervisor: 'المشرف', region: 'المنطقة', school_type: 'نوع المدرسة', building_type: 'نوع المبنى', occupancy_size: 'حجم الإشغال' };
const fmt = new Intl.NumberFormat('ar-SA');
const formatDate = (value, options) => new Intl.DateTimeFormat('ar-SA', { timeZone: 'Asia/Riyadh', ...options }).format(new Date(value));
const plainDescription = (value) => String(value || '').replace(/<br\s*\/?>/gi, ' • ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const isCriticalPriority = (value) => /حرج|critical|عالي|high|p1/i.test(value || '');
const isBreachedStatus = (value) => /اختراق|breached/i.test(value || '');

async function request(path, { csrf, ...options } = {}) {
  const headers = { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(options.headers || {}) };
  if (csrf && options.method && options.method !== 'GET') headers['X-CSRF-Token'] = csrf;
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'تعذر إكمال الطلب.');
  return data;
}

function App() {
  const [session, setSession] = useState(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [setupAvailable, setSetupAvailable] = useState(false);
  const [csrf, setCsrf] = useState('');
  const [page, setPage] = useState('dashboard');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [period, setPeriod] = useState('month');

  const notify = useCallback((message) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 3500);
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const data = await request('/api/session');
      setSession(data.user || null);
      setSetupRequired(Boolean(data.setupRequired));
      setSetupAvailable(Boolean(data.setupAvailable));
      setCsrf(data.csrfToken || '');
      return data;
    } catch (error) {
      notify(error.message);
      return null;
    } finally { setLoading(false); }
  }, [notify]);

  useEffect(() => { refreshSession(); }, [refreshSession]);

  const signIn = async (payload, setup = false) => {
    const data = await request(setup ? '/api/setup' : '/api/login', {
      method: 'POST', csrf, body: JSON.stringify(payload)
    });
    setSession(data.user);
    setCsrf(data.csrfToken);
    setPage('dashboard');
  };
  const signOut = async () => {
    try {
      await request('/api/logout', { method: 'POST', csrf });
      setSession(null); setCsrf(''); setPage('dashboard');
    } catch (error) { notify(error.message); }
  };

  if (loading) return <div className="loading-screen"><div className="brand-mark"><Activity size={25} /></div><span>رِفاد</span></div>;
  if (!session) return <AuthScreen setupRequired={setupRequired} setupAvailable={setupAvailable} csrf={csrf} onSubmit={signIn} onRefresh={refreshSession} />;

  const allowedNav = NAV.filter((item) => (!item.admin || session.role === 'admin'));
  const currentPage = allowedNav.some((item) => item.id === page) ? page : 'dashboard';
  return (
    <div className="app-shell" dir="rtl">
      {mobileNav && <button className="mobile-backdrop" onClick={() => setMobileNav(false)} aria-label="إغلاق القائمة" />}
      <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <div className="brand-mark"><Activity size={22} strokeWidth={2.5} /></div>
          <div><strong>رِفاد</strong><small>إدارة البلاغات</small></div>
          <button className="icon-btn mobile-close" onClick={() => setMobileNav(false)} aria-label="إغلاق"><X size={18} /></button>
        </div>
        <div className="nav-caption">القائمة الرئيسية</div>
        <nav className="main-nav">
          {allowedNav.map(({ id, title, icon: Icon }) => (
            <button key={id} className={`nav-item ${currentPage === id ? 'active' : ''}`} onClick={() => { setPage(id); setMobileNav(false); }}>
              <Icon size={19} /><span>{title}</span>{currentPage === id && <span className="nav-active-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="user-card">
            <div className="avatar">{session.displayName.slice(0, 1)}</div>
            <div className="user-meta"><strong>{session.displayName}</strong><span>{roleLabels[session.role]}</span></div>
            <button className="icon-btn" onClick={signOut} title="تسجيل الخروج" aria-label="تسجيل الخروج"><LogOut size={17} /></button>
          </div>
          <div className="copyright">رِفاد © 2026 <span>•</span> Shalfa</div>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="topbar-start">
            <button className="icon-btn menu-toggle" onClick={() => setMobileNav(true)} aria-label="فتح القائمة"><Menu size={21} /></button>
            <div className="breadcrumbs"><span>رِفاد</span><ChevronLeft size={14} /><strong>{allowedNav.find((item) => item.id === currentPage)?.title}</strong></div>
          </div>
          <div className="topbar-actions"><div className="live-status"><span /> النظام يعمل بشكل طبيعي</div><div className="top-date"><CalendarDays size={16} />{formatDate(new Date(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div></div>
        </header>
        <div className="page-content">
          {currentPage === 'dashboard' && <Dashboard period={period} setPeriod={setPeriod} notify={notify} />}
          {currentPage === 'analysis' && <Analysis notify={notify} />}
          {currentPage === 'tickets' && <Tickets session={session} csrf={csrf} notify={notify} />}
          {currentPage === 'schools' && <Schools csrf={csrf} session={session} notify={notify} />}
          {currentPage === 'account' && <AccountPage session={session} csrf={csrf} notify={notify} onUpdated={(data) => { setSession(data.user); setCsrf(data.csrfToken); }} />}
          {currentPage === 'users' && <UsersPage csrf={csrf} session={session} notify={notify} />}
          {currentPage === 'settings' && <SettingsPage csrf={csrf} notify={notify} />}
        </div>
        <footer className="page-footer"><span>رِفاد لإدارة البلاغات</span><span>© Mohamed Elshenawy · Shalfa · Internal Private</span></footer>
      </main>
      {toast && <div className="toast"><CheckCircle2 size={18} />{toast}</div>}
    </div>
  );
}

function AuthScreen({ setupRequired, setupAvailable, csrf, onSubmit, onRefresh }) {
  const [setup, setSetup] = useState(Boolean(setupRequired));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ setupToken: '', username: '', displayName: '', password: '' });
  const submit = async (event) => {
    event.preventDefault(); setError(''); setBusy(true);
    try { await onSubmit(form, setup); }
    catch (err) { setError(err.message); if (err.message.includes('إعداد النظام')) { const current = await onRefresh(); setSetup(Boolean(current?.setupRequired)); } }
    finally { setBusy(false); }
  };
  return (
    <div className="auth-page" dir="rtl">
      <div className="auth-decoration decor-one" /><div className="auth-decoration decor-two" />
      <div className="auth-panel">
        <div className="auth-brand"><div className="brand-mark"><Activity size={23} strokeWidth={2.5} /></div><span>رِفاد</span></div>
        <div className="auth-illustration"><div className="illustration-grid" /><div className="illus-card illus-top"><Clock3 size={19} /><div><b>مؤشرات SLA</b><span>متابعة لحظية</span></div><span className="illus-pill">مستقر</span></div><div className="illus-chart"><div /><div /><div /><div /><div /><div /><div /><div /></div><div className="illus-card illus-bottom"><CheckCircle2 size={19} /><div><b>أداء أفضل</b><span>رؤية واضحة لكل بلاغ</span></div></div></div>
        <div className="auth-heading"><span className="eyebrow"><Sparkles size={14} /> منصة متابعة البلاغات</span><h1>{setup ? 'لنبدأ بإعداد رِفاد' : 'مرحبًا بعودتك'}</h1><p>{setup ? 'أنشئ حساب مسؤول النظام الأول للبدء بأمان.' : 'سجّل الدخول لمتابعة البلاغات ومؤشرات الأداء.'}</p></div>
        <form className="auth-form" onSubmit={submit}>
          {setup && <label>رمز التهيئة السري<input required autoComplete="off" type="password" value={form.setupToken} onChange={(e) => setForm({ ...form, setupToken: e.target.value })} placeholder="أدخل الرمز الذي عيّنه مسؤول الخادم" /></label>}
          {setup && !setupAvailable && <div className="form-error"><AlertCircle size={16} />تهيئة النظام غير مفعّلة. على مسؤول الخادم ضبط INITIAL_ADMIN_SETUP_TOKEN أولًا.</div>}
          {setup && <label>الاسم الكامل<input required autoComplete="name" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder="مثال: محمد الشناوي" /></label>}
          <label>اسم المستخدم<input required autoComplete="username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="أدخل اسم المستخدم" /></label>
          <label>كلمة المرور<input required type="password" autoComplete={setup ? 'new-password' : 'current-password'} minLength={setup ? 12 : 1} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={setup ? '12 خانة على الأقل' : 'أدخل كلمة المرور'} /></label>
          {error && <div className="form-error"><AlertCircle size={16} />{error}</div>}
          <button className="btn btn-primary auth-submit" disabled={busy || (setup && !setupAvailable)}>{busy ? 'جارٍ التحقق…' : setup ? 'إنشاء حساب المسؤول' : 'تسجيل الدخول'}<ArrowLeft size={17} /></button>
        </form>
        <div className="auth-secure"><LockKeyhole size={14} /> اتصال آمن · حسابات وصلاحيات محمية</div>
      </div>
      <div className="auth-side"><div className="auth-side-content"><span className="side-label">منصة العمليات الميدانية</span><h2>كل بلاغ في<br />مساره الصحيح.</h2><p>تابع الأداء، اعرف الأولويات، وارفع جودة الاستجابة من لوحة واحدة.</p><div className="side-stat-row"><div><strong>24/7</strong><span>متابعة مستمرة</span></div><i /><div><strong>رؤية</strong><span>أداء أوضح</span></div></div></div><div className="side-orbit orbit-a" /><div className="side-orbit orbit-b" /><div className="auth-side-footer">مصمم لفرق العمل الميداني</div></div>
    </div>
  );
}

function PageHeading({ eyebrow, title, description, action }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function Dashboard({ period, setPeriod, notify }) {
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(true);
  const [ticketView, setTicketView] = useState({ status: 'open', period });
  const reportRef = useRef(null);
  useEffect(() => {
    setTicketView((current) => ({ ...current, period }));
  }, [period]);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      request(`/api/summary?period=${period}`).then((data) => { if (active) setSummary(data); }).catch((e) => notify(e.message)).finally(() => active && setBusy(false));
    };
    setBusy(true);
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [period, notify]);
  const exportImage = async () => {
    try {
      const dataUrl = await toPng(reportRef.current, { pixelRatio: 2, backgroundColor: '#f5f7f8' });
      const link = document.createElement('a'); link.download = `rifad-report-${new Date().toISOString().slice(0, 10)}.png`; link.href = dataUrl; link.click();
      notify('تم تصدير التقرير كصورة.');
    } catch { notify('تعذر تصدير الصورة. حاول مرة أخرى.'); }
  };
  if (busy && !summary) return <PageLoader />;
  const m = summary?.metrics || {};
  const stats = [
    { title: 'إجمالي البلاغات', value: m.total, icon: ClipboardList, color: 'blue', note: period === 'all' ? 'منذ بدء التسجيل' : 'بلاغات خلال الفترة' },
    { title: 'البلاغات المفتوحة', value: m.open, icon: Clock3, color: 'amber', note: `${m.nearBreach || 0} بحاجة إلى انتباه`, status: 'open' },
    { title: 'البلاغات المغلقة', value: m.closed, icon: CheckCircle2, color: 'green', note: 'وفق الحالة الحالية' },
    { title: 'البلاغات المخترقة', value: m.breached, icon: AlertTriangle, color: 'red', note: `${m.missingBreachReason || 0} دون سبب مسجل`, status: 'breached' }
  ];
  return <div ref={reportRef} className="report-surface">
    <PageHeading eyebrow="نظرة عامة" title="لوحة التحكم" description="تابع حالة البلاغات ومؤشرات الالتزام من مكان واحد." action={<div className="heading-actions"><div className="segmented"><button className={period === 'week' ? 'selected' : ''} onClick={() => setPeriod('week')}>أسبوع</button><button className={period === 'month' ? 'selected' : ''} onClick={() => setPeriod('month')}>شهر</button><button className={period === 'all' ? 'selected' : ''} onClick={() => setPeriod('all')}>تراكمي</button></div><button className="btn btn-outline" onClick={() => exportImage(true)}><ArrowDownToLine size={16} />تنزيل التقرير</button></div>} />
    <div className="period-note"><CalendarDays size={15} />{period === 'week' ? 'آخر 7 أيام' : period === 'month' ? 'الشهر الحالي حتى الآن' : 'جميع البلاغات المسجلة'} <span>•</span> القياس حسب تاريخ الإنشاء والحالة الحالية</div>
    <section className="metric-grid">
      {stats.map((metric, index) => <DashboardMetricCard key={metric.title} metric={metric} index={index} selected={ticketView.period !== null && ticketView.status === metric.status && ticketView.period === period} onClick={() => setTicketView({ status: metric.status, period })} />)}
    </section>
    <OpenTicketsSection notify={notify} period={period} view={ticketView} />
    <SlaAlerts items={summary?.approachingSlaTickets || []} count={summary?.approachingSla || 0} />
    <SupervisorPerformance rows={summary?.supervisorPerformance || []} best={summary?.bestSupervisor} />
    <div className="data-footnote"><ShieldCheck size={15} /><span>مؤشرات الالتزام محسوبة من حالة SLM للمدارس المطابقة للدليل. تحسب مدة SLA حسب الأولوية وإعدادات النظام ابتداءً من تاريخ الإنشاء.</span></div>
  </div>;
}
function DashboardMetricCard({ metric, index, selected, onClick }) {
  const { title, value, icon: Icon, color, note, status } = metric;
  const content = <><span className="metric-top"><span className={`metric-icon ${color}`}><Icon size={19} /></span><span className="metric-index">0{index + 1}</span></span><span className="metric-value">{fmt.format(value || 0)}</span><span className="metric-title">{title}</span><span className="metric-note">{note}</span>{status && <span className="metric-hint">اضغط لعرض القائمة</span>}</>;
  return status
    ? <button type="button" className={`metric-card metric-${color} metric-card-clickable ${selected ? 'metric-card-selected' : ''}`} aria-label={`${title}، عرض القائمة`} aria-pressed={selected} onClick={onClick}>{content}</button>
    : <article className={`metric-card metric-${color}`}>{content}</article>;
}
function SlaAlerts({ items, count }) {
  return <section className={`panel sla-alert-panel ${count ? 'has-sla-alerts' : ''}`}>
    <div className="panel-heading"><div><h2><AlertTriangle size={17} />تنبيهات استباقية لـ SLA</h2><p>تُحدّث تلقائيًا كل دقيقة · البلاغات المفتوحة التي تنتهي مهلتها خلال ساعتين</p></div><span className={`tag ${count ? 'tag-soft-amber' : 'tag-soft-green'}`}>{fmt.format(count)} تنبيه</span></div>
    {items.length ? <div className="sla-alert-list">{items.map((ticket) => <div className="sla-alert-row" key={ticket.id}><span className="sla-alert-icon"><Clock3 size={16} /></span><div><strong>{ticket.school_name || ticket.building_name || 'مدرسة غير محددة'}</strong><small>{ticket.case_id} · {ticket.supervisor || 'مشرف غير محدد'} · {ticket.layer3 || 'طبقة غير محددة'}</small></div><b>{slaText(ticket)}</b></div>)}</div> : <div className="sla-alert-empty"><CheckCircle2 size={17} />لا توجد بلاغات مفتوحة تقترب من تجاوز SLA حاليًا.</div>}
  </section>;
}
function OpenTicketsSection({ notify, period, view }) {
  const [data, setData] = useState({ items: [], total: 0, truncated: false, filters: { supervisors: [], layers: [], regions: [] } });
  const [filters, setFilters] = useState({ supervisor: '', layer: '', region: '' });
  const [busy, setBusy] = useState(true);
  const exportRef = useRef(null);
  useEffect(() => {
    let active = true;
    setBusy(true);
    const params = new URLSearchParams({ ...filters, status: view.status, ...(view.period ? { period: view.period } : {}) });
    request(`/api/open-tickets?${params}`)
      .then((result) => { if (active) setData(result); })
      .catch((error) => { if (active) notify(error.message); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [filters, notify, view]);

  const exportForSharing = async (downloadOnly = false) => {
    let captureNode;
    try {
      if (!exportRef.current?.firstElementChild) throw new Error('تعذر تجهيز محتوى التقرير.');
      captureNode = exportRef.current.firstElementChild.cloneNode(true);
      Object.assign(captureNode.style, {
        position: 'fixed',
        left: '0',
        top: '0',
        zIndex: '2147483647',
        opacity: '0',
        pointerEvents: 'none'
      });
      document.body.append(captureNode);
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const blob = await toBlob(captureNode, {
        pixelRatio: 2.5,
        backgroundColor: '#f4f7f7',
        cacheBust: true,
        style: { opacity: '1' }
      });
      if (!blob) throw new Error('تعذر تجهيز صورة التقرير.');
      const filename = `rifad-open-tickets-${new Date().toISOString().slice(0, 10)}.png`;
      const file = new File([blob], filename, { type: 'image/png' });
      if (!downloadOnly && navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title: 'البلاغات المفتوحة - رِفاد', text: `البلاغات المفتوحة: ${fmt.format(data.total)}`, files: [file] });
        notify('تم تجهيز صورة البلاغات للمشاركة.');
      } else {
        const image = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = filename;
        link.href = image;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(image), 1000);
        notify('تم تنزيل الصورة عالية الدقة؛ أرفقها في واتساب للمشاركة.');
      }
    } catch (error) {
      if (error.name !== 'AbortError') notify(error.message || 'تعذر تصدير صورة البلاغات.');
    } finally {
      captureNode?.remove();
    }
  };

  return <section className="panel open-tickets-panel">
    <div className="open-tickets-heading">
      <div><span className="eyebrow">متابعة مباشرة</span><h2>{view.status === 'breached' ? 'البلاغات المخترقة' : 'البلاغات المفتوحة حاليًا'}</h2><p>{view.status === 'breached' ? 'البلاغات التي تجاوزت SLA ضمن الفترة المحددة.' : 'المدرسة والمشرف ووصف مختصر والوقت المتبقي على SLA.'}</p></div>
      <div className="heading-actions"><button className="btn btn-primary" onClick={() => exportForSharing(true)} disabled={busy}><ArrowDownToLine size={16} />تنزيل الصورة</button><button className="btn btn-outline" onClick={() => exportForSharing(false)} disabled={busy}><Share2 size={16} />مشاركة</button></div>
    </div>
    <div className="open-ticket-filters">
      <span className="open-count"><Clock3 size={15} />{busy ? 'جارٍ التحديث…' : `${fmt.format(data.total)} ${view.status === 'breached' ? 'بلاغ مخترق' : 'بلاغ مفتوح'}${view.period ? ` · ${periodLabel(view.period)}` : ''}`}</span>
      <label><span>المشرف</span><select aria-label="فلترة حسب المشرف" value={filters.supervisor} onChange={(event) => setFilters({ ...filters, supervisor: event.target.value })}><option value="">كل المشرفين</option>{data.filters.supervisors.map((name) => <option key={name}>{name}</option>)}</select></label>
      <label><span>الطبقة</span><select aria-label="فلترة حسب الطبقة" value={filters.layer} onChange={(event) => setFilters({ ...filters, layer: event.target.value })}><option value="">كل الطبقات</option>{data.filters.layers.map((name) => <option key={name}>{name}</option>)}</select></label>
      <label><span>المنطقة</span><select aria-label="فلترة حسب المنطقة" value={filters.region} onChange={(event) => setFilters({ ...filters, region: event.target.value })}><option value="">كل المناطق</option>{data.filters.regions.map((name) => <option key={name}>{name}</option>)}</select></label>
      {data.truncated && <span className="muted">يُعرض أول {fmt.format(data.items.length)} بلاغ.</span>}
    </div>
    <div className="open-ticket-table-wrap"><OpenTicketsTable items={data.items} busy={busy} /></div>
    <div className="open-share-canvas" ref={exportRef} aria-hidden="true">
      <div className="open-share-sheet">
        <div className="share-brand-row"><div className="share-brand-mark"><Activity size={21} /></div><div><strong>رِفاد</strong><span>إدارة البلاغات المدرسية</span></div><time>{formatDate(new Date(), { day: 'numeric', month: 'long', year: 'numeric' })}</time></div>
        <div className="share-report-title"><div><h2>{view.status === 'breached' ? 'البلاغات المخترقة' : 'البلاغات المفتوحة حاليًا'}</h2><p>{filters.supervisor || 'كل المشرفين'} · {filters.layer || 'كل الطبقات'} · {filters.region || 'كل المناطق'} · {view.period ? periodLabel(view.period) : 'كل الفترات'}</p></div><strong>{fmt.format(data.total)} <small>بلاغ</small></strong></div>
        <OpenTicketsTable items={data.items} busy={busy} />
        {data.truncated && <p className="share-truncated">المعروض أول {fmt.format(data.items.length)} بلاغ من الإجمالي.</p>}
        <div className="share-footer">رِفاد · Shalfa <span>•</span> © Mohamed Elshenawy</div>
      </div>
    </div>
  </section>;
}

function OpenTicketsTable({ items, busy }) {
  return <table className="open-tickets-table"><thead><tr><th>اسم المدرسة</th><th>المشرف</th><th>وصف البلاغ</th><th>المهلة المتبقية على SLA</th></tr></thead><tbody>
    {busy ? <tr><td colSpan="4">جارٍ تحميل البلاغات المفتوحة…</td></tr> : items.length ? items.map((ticket) => <tr key={ticket.id}><td>{ticket.school_name}</td><td>{ticket.supervisor}</td><td>{briefDescription(ticket.description)}</td><td>{slaText(ticket)}</td></tr>) : <tr><td colSpan="4">لا توجد بلاغات مفتوحة مطابقة للفلاتر.</td></tr>}
  </tbody></table>;
}

function briefDescription(value) {
  const text = String(value || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
  return text.length > 110 ? `${text.slice(0, 107)}…` : text || '—';
}

function slaText(ticket) {
  if (ticket.sla_remaining_minutes !== null) {
    const minutes = Math.ceil(ticket.sla_remaining_minutes);
    if (minutes < 0) {
      const overdue = Math.abs(minutes);
      if (overdue < 60) return `متجاوز ${fmt.format(overdue)} دقيقة`;
      if (overdue < 1440) return `متجاوز ${fmt.format(Math.floor(overdue / 60))} ساعة و${fmt.format(overdue % 60)} دقيقة`;
      return `متجاوز ${fmt.format(Math.floor(overdue / 1440))} يوم و${fmt.format(Math.floor((overdue % 1440) / 60))} ساعة`;
    }
    if (minutes === 0) return 'انتهت المهلة';
    if (minutes < 60) return `${fmt.format(minutes)} دقيقة`;
    if (minutes < 1440) return `${fmt.format(Math.floor(minutes / 60))} ساعة و${fmt.format(minutes % 60)} دقيقة`;
    return `${fmt.format(Math.floor(minutes / 1440))} يوم و${fmt.format(Math.floor((minutes % 1440) / 60))} ساعة`;
  }
  if (/اختراق|breached/i.test(ticket.slm_status)) return 'مخترق · المدة غير متاحة';
  return ticket.needs_attention ? 'قريب من الاختراق' : 'غير متاح في المصدر';
}
function durationText(minutes) {
  if (minutes === null || minutes === undefined) return 'غير متاح';
  if (minutes < 60) return `${fmt.format(minutes)} دقيقة`;
  if (minutes < 1440) return `${fmt.format(Math.floor(minutes / 60))} ساعة و${fmt.format(minutes % 60)} دقيقة`;
  return `${fmt.format(Math.floor(minutes / 1440))} يوم و${fmt.format(Math.floor((minutes % 1440) / 60))} ساعة`;
}

function Analysis({ notify }) {
  const [period, setPeriod] = useState('month');
  const [summary, setSummary] = useState(null);
  const [exporting, setExporting] = useState(false);
  const reportRef = useRef(null);
  useEffect(() => {
    let active = true;
    request(`/api/summary?period=${period}`).then((data) => { if (active) setSummary(data); }).catch((e) => notify(e.message));
    return () => { active = false; };
  }, [period, notify]);
  const m = summary?.metrics || {};
  const exportImage = async (downloadOnly = false) => {
    setExporting(true);
    let captureNode;
    let imageUrl;
    try {
      if (!reportRef.current) throw new Error('تعذر تجهيز محتوى التحليلات.');
      captureNode = reportRef.current.cloneNode(true);
      captureNode.classList.add('analysis-export-capture');
      const bounds = reportRef.current.getBoundingClientRect();
      Object.assign(captureNode.style, {
        position: 'fixed', left: '0', top: '0', zIndex: '2147483647',
        width: `${Math.max(bounds.width, 1200)}px`, maxWidth: 'none', height: 'auto',
        opacity: '0', pointerEvents: 'none', overflow: 'visible'
      });
      document.body.append(captureNode);
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const blob = await toBlob(captureNode, {
        pixelRatio: 2.5,
        backgroundColor: '#f5f7f8',
        cacheBust: true,
        style: { opacity: '1' }
      });
      if (!blob) throw new Error('تعذر إنشاء صورة التحليلات.');
      const file = new File([blob], `rifad-analytics-${new Date().toISOString().slice(0, 10)}.png`, { type: 'image/png' });
      if (!downloadOnly && navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title: 'تحليلات رِفاد', text: 'تقرير تحليلات البلاغات', files: [file] });
        notify('تمت مشاركة صورة التحليلات.');
      } else {
        imageUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = file.name;
        link.href = imageUrl;
        link.click();
        notify('تم تنزيل صورة التحليلات عالية الجودة.');
      }
    } catch (error) {
      if (error.name !== 'AbortError') notify(error.message || 'تعذر تصدير صورة التحليلات.');
    } finally {
      captureNode?.remove();
      if (imageUrl) window.setTimeout(() => URL.revokeObjectURL(imageUrl), 1000);
      setExporting(false);
    }
  };
  return <div className="analysis-page">
    <PageHeading eyebrow="تحليلات الأداء" title="دراسة وتحليلات" description="قراءة توزيع البلاغات ومؤشرات الالتزام حسب الفترة." action={<div className="analysis-heading-actions"><div className="segmented"><button className={period === 'week' ? 'selected' : ''} onClick={() => setPeriod('week')}>أسبوع</button><button className={period === 'month' ? 'selected' : ''} onClick={() => setPeriod('month')}>شهر</button><button className={period === 'all' ? 'selected' : ''} onClick={() => setPeriod('all')}>تراكمي</button></div><button className="btn btn-primary" onClick={() => exportImage(true)} disabled={exporting}><ArrowDownToLine size={16} />تنزيل PNG</button><button className="btn btn-outline" onClick={() => exportImage(false)} disabled={exporting}><Share2 size={16} />{exporting ? 'جارٍ التجهيز…' : 'مشاركة'}</button></div>} />
    <div className="analysis-report" ref={reportRef}>
      <div className="analysis-report-brand"><Activity size={20} /><div><strong>رِفاد · دراسة وتحليلات</strong><span>{periodLabel(period)} · {formatDate(new Date(), { day: 'numeric', month: 'long', year: 'numeric' })}</span></div></div>
      <div className="analysis-callout"><Activity size={18} /><div><strong>مؤشر الالتزام للفترة</strong><span>البلاغات غير المخترقة ÷ إجمالي البلاغات غير الملغاة المنشأة خلال الفترة.</span></div><b>{fmt.format(m.compliance || 0)}%</b></div>
      <div className="analysis-metrics"><MiniMetric title="إجمالي البلاغات" value={m.total} icon={ClipboardList} /><MiniMetric title="مفتوحة" value={m.open} icon={Clock3} /><MiniMetric title="مغلقة" value={m.closed} icon={CheckCircle2} /><MiniMetric title="مخترقة" value={m.breached} icon={AlertTriangle} /></div>
      <div className="panel chart-panel monthly-compliance-panel"><div className="panel-heading"><div><h2>مقارنة الالتزام الشهري بـ SLA</h2><p>نسبة البلاغات غير المخترقة من البلاغات غير الملغاة لكل شهر (آخر 12 شهرًا)</p></div></div><MonthlyComplianceChart rows={summary?.monthlyCompliance || []} /></div>
      <div className="dashboard-grid"><CompliancePanel metrics={m} /><QuickIndicators metrics={m} /></div>
      <div className="dashboard-grid"><section className="panel chart-panel"><div className="panel-heading"><div><h2>تحليل الطبقات</h2><p>حجم البلاغات وحالات SLA لكل طبقة</p></div></div><DetailedBarList rows={summary?.byLayer || []} /></section><section className="panel chart-panel"><div className="panel-heading"><div><h2>تحليل المشرفين</h2><p>الإجمالي، المفتوح، المغلق، والمخترق ونسبة الالتزام</p></div></div><SupervisorAnalysis rows={summary?.bySupervisor || []} /></section></div>
      <div className="dashboard-grid">
        <section className="panel chart-panel"><div className="panel-heading"><div><h2>المدارس الأكثر استقبالًا للبلاغات المفتوحة</h2><p>ترتيب المدارس حسب عدد البلاغات المفتوحة في الفترة</p></div></div><SchoolActivityList rows={summary?.topOpenSchools || []} /></section>
        <section className="panel chart-panel"><div className="panel-heading"><div><h2>البلاغات الأكثر تكرارًا لكل مدرسة</h2><p>تكرار البلاغات حسب تصنيف الطبقة الثالثة</p></div></div><RepeatedTicketList rows={summary?.repeatedBySchool || []} /></section>
      </div>
      <div className="dashboard-grid breach-analysis-grid">
        <section className="panel chart-panel"><div className="panel-heading"><div><h2>البلاغات المخترقة حسب الطبقة</h2><p>عدد البلاغات المخترقة لكل تصنيف</p></div></div><BreachBreakdownList rows={summary?.breachedByLayer || []} empty="لا توجد بلاغات مخترقة في الفترة." /></section>
        <section className="panel chart-panel"><div className="panel-heading"><div><h2>البلاغات المخترقة حسب اليوم</h2><p>تاريخ إنشاء البلاغات المخترقة ضمن الفترة</p></div></div><BreachBreakdownList rows={summary?.breachedByDay || []} empty="لا توجد بلاغات مخترقة في الفترة." /></section>
      </div>
      <div className="data-footnote"><AlertCircle size={15} />تُحتسب التحليلات للمدارس المطابقة بالرقم الوزاري أو باسم مدرسة فريد. يعبّر الالتزام الشهري عن الحالة الحالية لبلاغات كل شهر.</div>
      <div className="analysis-report-footer">رِفاد · Shalfa · © Mohamed Elshenawy · Internal Private</div>
    </div>
  </div>;
}
function periodLabel(period) {
  return period === 'week' ? 'آخر 7 أيام' : period === 'month' ? 'الشهر الحالي' : 'تراكمي';
}
function CompliancePanel({ metrics }) {
  return <section className="panel compliance-panel">
    <div className="panel-heading"><div><h2>معدل الالتزام</h2><p>نسبة البلاغات غير المخترقة خلال الفترة</p></div><span className="tag tag-soft-green"><Activity size={14} />المؤشر العام</span></div>
    <div className="compliance-content"><div className="compliance-ring" style={{ '--percent': `${metrics.compliance || 0}%` }}><div><strong>{fmt.format(metrics.compliance || 0)}<small>%</small></strong><span>نسبة الالتزام</span></div></div><div className="compliance-details"><div className="detail-row"><span><i className="dot-green" />ملتزم ضمن المهلة</span><strong>{fmt.format(metrics.onTime || 0)}</strong></div><div className="detail-row"><span><i className="dot-red" />تجاوز المهلة</span><strong>{fmt.format(metrics.breached || 0)}</strong></div><div className="compliance-divider" /><div className="detail-row cumulative"><span>معدل الالتزام التراكمي</span><strong>{fmt.format(metrics.cumulativeCompliance || 0)}%</strong></div></div></div>
  </section>;
}
function QuickIndicators({ metrics }) {
  const items = [
    { title: 'تجاوزت المهلة وهي مفتوحة', value: metrics.overdueOpen, color: 'red' },
    { title: 'تنتهي خلال ساعتين', value: metrics.dueSoonOpen, color: 'amber' },
    { title: 'مدة SLA غير محددة', value: metrics.missingSlaOpen, color: 'blue' }
  ];
  return <section className="panel quick-panel">
    <div className="panel-heading"><div><h2>مؤشرات سريعة</h2><p>حالة البلاغات المفتوحة مقابل مهلة SLA</p></div><div className="panel-mini-icon"><Activity size={18} /></div></div>
    <div className="quick-alert-list">{items.map((item) => <div className={`quick-alert quick-alert-${item.color}`} key={item.title}><span className="quick-dot" /><span>{item.title}</span><strong>{fmt.format(item.value || 0)}</strong></div>)}</div>
  </section>;
}
function SupervisorPerformance({ rows, best }) {
  return <section className="panel supervisor-performance-panel">
    <div className="panel-heading"><div><h2>أداء المشرفين</h2><p>سرعة إغلاق البلاغات، والإغلاق، والاختراقات خلال الفترة</p></div><span className="tag tag-soft-blue"><Users size={14} />{fmt.format(rows.length)} مشرف</span></div>
    {best && <div className="best-supervisor"><Sparkles size={18} /><span>الأفضل التزامًا بـ SLA</span><strong>{best.name}</strong><b>{fmt.format(best.compliance)}%</b></div>}
    {rows.length ? <div className="supervisor-performance-list">{rows.slice(0, 8).map((row, index) => <div className="supervisor-performance-row" key={row.name}>
      <span className="supervisor-rank">{fmt.format(index + 1)}</span>
      <div className="supervisor-performance-name"><strong>{row.name}</strong><span>{row.averageResponseMinutes === null ? 'لا تتوفر أزمنة حل مسجلة' : `متوسط سرعة الحل: ${durationText(row.averageResponseMinutes)}`}</span></div>
      <div className="supervisor-performance-stat"><strong>{fmt.format(row.closed)}</strong><span>مغلق</span></div>
      <div className="supervisor-performance-stat breached"><strong>{fmt.format(row.breached)}</strong><span>مخترق</span></div>
      <div className="supervisor-performance-stat"><strong>{fmt.format(row.compliance)}%</strong><span>التزام</span></div>
    </div>)}</div> : <EmptyState text="لا توجد بيانات مشرفين للفترة المحددة." />}
    <div className="performance-note">الأفضل أداءً هو الأعلى التزامًا بـ SLA، وعند التعادل يُرجّح عدد البلاغات المغلقة ثم متوسط سرعة الحل.</div>
  </section>;
}
function MonthlyComplianceChart({ rows }) {
  const width = 900;
  const height = 340;
  const plot = { left: 58, right: 24, top: 24, bottom: 68 };
  const plotWidth = width - plot.left - plot.right;
  const plotHeight = height - plot.top - plot.bottom;
  const points = rows.map((row, index) => ({
    ...row,
    x: plot.left + (rows.length > 1 ? index * plotWidth / (rows.length - 1) : plotWidth / 2),
    y: row.compliance === null ? null : plot.top + (100 - row.compliance) * plotHeight / 100
  }));
  const paths = [];
  let segment = [];
  for (const point of points) {
    if (point.y === null) {
      if (segment.length > 1) paths.push(segment);
      segment = [];
    } else {
      segment.push(point);
    }
  }
  if (segment.length > 1) paths.push(segment);
  const hasData = points.some((point) => point.y !== null);
  const labelIndexes = new Set([0, 2, 4, 6, 8, 10, 11]);
  return <div className="monthly-chart-wrap">
    {hasData ? <svg className="monthly-compliance-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="مخطط خطي لمقارنة نسبة الالتزام الشهري">
      {[0, 25, 50, 75, 100].map((value) => {
        const y = plot.top + (100 - value) * plotHeight / 100;
        return <g key={value}><line x1={plot.left} x2={width - plot.right} y1={y} y2={y} className="chart-grid-line" /><text x={plot.left - 10} y={y + 5} textAnchor="end" className="chart-axis-label">{value}%</text></g>;
      })}
      {paths.map((path, index) => <polyline key={index} points={path.map((point) => `${point.x},${point.y}`).join(' ')} className="compliance-line" />)}
      {points.map((point, index) => point.y === null ? null : <g key={point.key}><circle cx={point.x} cy={point.y} r="5" className="compliance-point"><title>{point.label}: {fmt.format(point.compliance)}% ({fmt.format(point.total)} بلاغ)</title></circle>{labelIndexes.has(index) && <text x={point.x} y={height - 29} textAnchor="middle" className="chart-axis-label">{point.label}</text>}</g>)}
    </svg> : <EmptyState text="لا توجد بيانات كافية لعرض الالتزام الشهري." />}
    <div className="chart-legend"><span /><strong>نسبة الالتزام</strong><small>الشهر بلا بلاغات لا يدخل في احتساب النسبة.</small></div>
  </div>;
}
function BreachBreakdownList({ rows, empty }) {
  const max = Math.max(1, ...rows.map((row) => row.total));
  return rows.length ? <div className="breach-breakdown-list">{rows.slice(0, 30).map((row) => <div className="breach-breakdown-row" key={row.date || row.name}><span title={row.name}>{row.name}</span><div className="breach-breakdown-track"><i style={{ width: `${Math.max(3, row.total / max * 100)}%` }} /></div><strong>{fmt.format(row.total)}</strong></div>)}</div> : <EmptyState text={empty} />;
}
function MiniMetric({ title, value, icon: Icon }) { return <div className="mini-metric"><span className="mini-icon"><Icon size={17} /></span><span>{title}</span><strong>{fmt.format(value || 0)}</strong></div>; }
function DetailedBarList({ rows }) {
  const max = Math.max(1, ...rows.map((row) => row.total));
  return <div className="detailed-list">{rows.slice(0, 10).map((row) => <div key={row.name} className="detailed-row"><div className="detailed-info"><strong>{row.name}</strong><span>{fmt.format(row.total)} بلاغ <i>•</i> {fmt.format(row.breached)} مخترق</span></div><div className="detailed-track"><i style={{ width: `${row.total / max * 100}%` }} /></div><b>{row.total ? Math.round((row.breached / row.total) * 100) : 0}%</b></div>)}</div>;
}
function SupervisorAnalysis({ rows }) {
  return rows.length ? <div className="supervisor-analysis-list">{rows.map((row, index) => {
    const openPercent = row.total ? row.open / row.total * 100 : 0;
    const closedPercent = row.total ? row.closed / row.total * 100 : 0;
    return <article className="supervisor-analysis-row" key={row.name}>
      <div className="supervisor-analysis-heading"><span className="supervisor-rank">{fmt.format(index + 1)}</span><strong title={row.name}>{row.name}</strong><b>{fmt.format(row.total)} <small>بلاغ</small></b></div>
      <div className="supervisor-analysis-bar" role="img" aria-label={`${fmt.format(row.open)} مفتوح، ${fmt.format(row.closed)} مغلق، ${fmt.format(row.breached)} مخترق`}>
        <i className="supervisor-open-segment" style={{ width: `${openPercent}%` }} /><i className="supervisor-closed-segment" style={{ width: `${closedPercent}%` }} />
      </div>
      <div className="supervisor-analysis-stats">
        <span><i className="supervisor-open-dot" />مفتوح <strong>{fmt.format(row.open)}</strong></span>
        <span><i className="supervisor-closed-dot" />مغلق <strong>{fmt.format(row.closed)}</strong></span>
        <span><i className="supervisor-breached-dot" />مخترق <strong>{fmt.format(row.breached)}</strong></span>
        <span className="supervisor-compliance">{fmt.format(row.compliance)}% التزام</span>
      </div>
    </article>;
  })}</div> : <EmptyState text="لا توجد بيانات مشرفين للفترة المحددة." />;
}
function SchoolActivityList({ rows }) {
  const max = Math.max(1, ...rows.map((row) => row.total));
  return <div className="detailed-list">{rows.length ? rows.map((row) => <div key={row.school_name} className="detailed-row"><div className="detailed-info"><strong>{row.school_name}</strong><span>{row.supervisor}</span></div><div className="detailed-track"><i style={{ width: `${row.total / max * 100}%` }} /></div><b>{fmt.format(row.total)}</b></div>) : <EmptyState text="لا توجد بلاغات مفتوحة في الفترة المحددة." />}</div>;
}
function RepeatedTicketList({ rows }) {
  const max = Math.max(1, ...rows.map((row) => row.total));
  return <div className="detailed-list">{rows.length ? rows.map((row) => <div key={`${row.school_name}-${row.type}`} className="detailed-row"><div className="detailed-info"><strong>{row.school_name}</strong><span>{row.type} · {row.supervisor}</span></div><div className="detailed-track"><i style={{ width: `${row.total / max * 100}%` }} /></div><b>{fmt.format(row.total)}</b></div>) : <EmptyState text="لا توجد تصنيفات متكررة في الفترة المحددة." />}</div>;
}

function SchoolReport({ report, onOpenTicket, notify }) {
  const { school, metrics } = report;
  const [history, setHistory] = useState([]);
  const [historyLimited, setHistoryLimited] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(true);
  const [exporting, setExporting] = useState(false);
  const reportRef = useRef(null);
  useEffect(() => {
    let active = true;
    setHistoryBusy(true);
    request(`/api/schools/${encodeURIComponent(school.school_number)}/history`)
      .then((result) => {
        if (active) { setHistory(result.items); setHistoryLimited(result.limited); }
      })
      .catch((error) => { if (active) { setHistory([]); notify(error.message); } })
      .finally(() => { if (active) setHistoryBusy(false); });
    return () => { active = false; };
  }, [school.school_number, notify]);
  const exportReport = async () => {
    setExporting(true);
    let captureNode;
    let imageUrl;
    try {
      if (!reportRef.current) throw new Error('تعذر تجهيز تقرير المدرسة.');
      captureNode = reportRef.current.cloneNode(true);
      Object.assign(captureNode.style, {
        position: 'fixed', left: '0', top: '0', zIndex: '2147483647',
        width: `${Math.max(reportRef.current.getBoundingClientRect().width, 1100)}px`,
        maxWidth: 'none', height: 'auto', opacity: '0', pointerEvents: 'none', overflow: 'visible'
      });
      document.body.append(captureNode);
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const blob = await toBlob(captureNode, { pixelRatio: 2.5, backgroundColor: '#f5f7f8', cacheBust: true, style: { opacity: '1' } });
      if (!blob) throw new Error('تعذر إنشاء صورة تقرير المدرسة.');
      const link = document.createElement('a');
      link.download = `rifad-school-${school.school_number}-${new Date().toISOString().slice(0, 10)}.png`;
      imageUrl = URL.createObjectURL(blob);
      link.href = imageUrl;
      link.click();
    } catch (error) {
      notify(error.message || 'تعذر تصدير تقرير المدرسة.');
    } finally {
      captureNode?.remove();
      if (imageUrl) window.setTimeout(() => URL.revokeObjectURL(imageUrl), 1000);
      setExporting(false);
    }
  };
  const exportHistory = () => {
    const cell = (value) => {
      const text = String(value ?? '');
      return `"${(/^[=+\-@]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`;
    };
    const records = [['التاريخ', 'المنفذ', 'المصدر', 'الحقل', 'القيمة السابقة', 'القيمة الجديدة']];
    for (const entry of history) {
      for (const [field, values] of Object.entries(entry.changes)) {
        records.push([formatDate(entry.created_at, { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' }), entry.changed_by || 'مزامنة تلقائية', entry.source, historyFieldLabels[field] || field, values.before ?? '', values.after ?? '']);
      }
    }
    const csv = `\uFEFF${records.map((record) => record.map(cell).join(',')).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `rifad-school-history-${school.school_number}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const maxLayer = Math.max(1, ...report.byLayer.map((item) => item.total));
  const maxMonth = Math.max(1, ...report.monthlyActivity.map((item) => item.total));
  const maxHour = Math.max(1, ...report.byHour.map((item) => item.total));
  const maxWeekday = Math.max(1, ...report.byWeekday.map((item) => item.total));
  const hourWidth = 800;
  const hourHeight = 210;
  const hourPoints = report.byHour.map((item, index) => ({
    ...item,
    x: 24 + index * (hourWidth - 48) / 23,
    y: 170 - item.total / maxHour * 130
  }));
  return <div className="school-report">
    <div className="school-report-actions"><button className="btn btn-primary" onClick={exportReport} disabled={exporting}><ArrowDownToLine size={16} />{exporting ? 'جارٍ التصدير…' : 'تنزيل تقرير المدرسة PNG'}</button><button className="btn btn-outline" onClick={exportHistory} disabled={!history.length}><ArrowDownToLine size={16} />تنزيل سجل التغييرات CSV</button></div>
    <div className="school-report-export" ref={reportRef}>
    <div className="school-report-title">
      <div><h2>{school.name}</h2><p>{school.school_number} · {school.region || 'المنطقة غير محددة'} · {school.supervisor || 'مشرف غير محدد'} · النوع: {school.school_type || 'غير مسجل'} · المبنى: {school.building_type || 'غير محدد'} · الإشغال: {school.occupancy_size || 'غير محدد'}</p></div>
      <span className={`school-volume-badge ${metrics.safeBand ? 'safe' : 'busy'}`}><i />{metrics.safeBand ? 'ضمن النطاق الآمن' : 'معدل البلاغات مرتفع'}<small>مقارنة بوسيط المدارس خلال آخر 12 شهرًا ({fmt.format(metrics.peerMedian)} بلاغ)</small></span>
    </div>
    <div className="school-report-metrics">
      <SchoolMetric title="إجمالي البلاغات" value={metrics.total} />
      <SchoolMetric title="مفتوحة حاليًا" value={metrics.open} />
      <SchoolMetric title="مغلقة" value={metrics.closed} />
      <SchoolMetric title="مخترقة" value={metrics.breached} />
      <SchoolMetric title="معدل الإغلاق" value={`${fmt.format(metrics.closureRate)}%`} />
      <SchoolMetric title="الالتزام بـ SLA" value={`${fmt.format(metrics.compliance)}%`} />
    </div>
    <div className="school-report-charts">
      <section className="school-chart-panel"><div className="school-chart-heading"><h3>بلاغات المدرسة حسب الطبقة</h3><span>الحالي والمغلق والمخترق</span></div>
        {report.byLayer.length ? <div className="school-layer-chart">{report.byLayer.map((item) => <div className="school-layer-row" key={item.name}><div className="school-layer-title"><strong title={item.name}>{item.name}</strong><span>{fmt.format(item.total)} بلاغ · {fmt.format(item.open)} مفتوح · {fmt.format(item.breached)} مخترق</span></div><div className="school-layer-track"><i style={{ width: `${Math.max(3, item.total / maxLayer * 100)}%` }} /></div></div>)}</div> : <EmptyState text="لا توجد بلاغات مسجلة لهذه المدرسة." />}
      </section>
      <section className="school-chart-panel"><div className="school-chart-heading"><h3>نشاط البلاغات شهريًا</h3><span>آخر 12 شهرًا · حسب تاريخ الإنشاء</span></div>
        <div className="school-month-chart">{report.monthlyActivity.map((item) => <div className="school-month-column" key={item.key} title={`${item.label}: ${fmt.format(item.total)} بلاغ`}><strong>{item.total ? fmt.format(item.total) : ''}</strong><i style={{ height: `${Math.max(item.total ? 8 : 2, item.total / maxMonth * 100)}%` }} /><span>{item.label}</span></div>)}</div>
      </section>
      <section className="school-chart-panel"><div className="school-chart-heading"><h3>أوقات تسجيل البلاغات</h3><span>التوزيع حسب ساعة الإنشاء · توقيت الرياض</span></div>
        <div className="school-hours-chart"><svg viewBox={`0 0 ${hourWidth} ${hourHeight}`} role="img" aria-label="توزيع البلاغات بحسب ساعة اليوم">
          {[0, 0.5, 1].map((step) => <line key={step} x1="20" x2="780" y1={170 - step * 130} y2={170 - step * 130} className="school-chart-gridline" />)}
          <polyline points={hourPoints.map((point) => `${point.x},${point.y}`).join(' ')} className="school-hour-line" />
          {hourPoints.map((point, index) => <g key={point.hour}><circle cx={point.x} cy={point.y} r="3.5" className="school-hour-dot"><title>{point.label} · {fmt.format(point.total)} بلاغ</title></circle>{index % 3 === 0 && <text x={point.x} y="198" textAnchor="middle">{point.hour}:00</text>}</g>)}
        </svg></div>
      </section>
      <section className="school-chart-panel"><div className="school-chart-heading"><h3>أيام الأسبوع الأكثر استقبالًا</h3><span>عدد البلاغات بحسب يوم الإنشاء</span></div>
        <div className="school-weekday-chart">{report.byWeekday.map((item) => <div key={item.name}><span>{item.name}</span><div className="school-layer-track"><i style={{ width: `${Math.max(item.total ? 4 : 0, item.total / maxWeekday * 100)}%` }} /></div><strong>{fmt.format(item.total)}</strong></div>)}</div>
      </section>
    </div>
    <section className="school-recent-tickets"><div className="school-chart-heading"><h3>أحدث بلاغات المدرسة</h3><span>اضغط على المعرّف لفتح التفاصيل والبلاغات ذات الصلة</span></div>
      {report.recentTickets.length ? <div className="school-recent-list">{report.recentTickets.map((ticket) => <div key={ticket.id}><button className="ticket-id" onClick={() => onOpenTicket(ticket.id)}>{ticket.case_id}</button><span>{ticket.layer3}</span><span>{ticket.created_at ? formatDate(ticket.created_at, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</span><strong>{ticket.status}</strong></div>)}</div> : <EmptyState text="لا توجد بلاغات مسجلة لهذه المدرسة." />}
    </section>
    </div>
    <section className="school-history-panel"><div className="school-chart-heading"><div><h3>سجل تغييرات بيانات المدرسة</h3><span>تعديلات المستخدمين ومزامنة دليل المدارس</span></div>{historyLimited && <span>آخر 100 تغيير</span>}</div>
      {historyBusy ? <PageLoader /> : history.length ? <div className="school-history-list">{history.map((entry) => <article key={entry.id}><div><strong>{entry.changed_by || 'مزامنة النظام'}</strong><time>{formatDate(entry.created_at, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</time></div><small>{entry.source === 'manual' ? 'تعديل يدوي' : entry.source === 'csv' ? 'استيراد CSV' : 'مزامنة الشيت'}</small><p>{Object.entries(entry.changes).map(([field, values]) => `${historyFieldLabels[field] || field}: ${values.before ?? '—'} ← ${values.after ?? '—'}`).join(' · ')}</p></article>)}</div> : <EmptyState text="لا توجد تغييرات مسجلة لبيانات هذه المدرسة." />}
    </section>
  </div>;
}
function SchoolMetric({ title, value }) {
  return <div className="school-report-metric"><span>{title}</span><strong>{value}</strong></div>;
}
function TicketDetailsModal({ ticketId, onClose, onOpenRelated, notify }) {
  const [ticket, setTicket] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError('');
    request(`/api/tickets/${ticketId}/details`)
      .then((result) => { if (active) setTicket(result.item); })
      .catch((requestError) => { if (active) { setError(requestError.message); notify(requestError.message); } })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [ticketId, notify]);
  useEffect(() => {
    const closeOnEscape = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  return <div className="ticket-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="ticket-detail-modal" role="dialog" aria-modal="true" aria-labelledby="ticket-detail-title">
      <div className="ticket-detail-heading"><div><span className="eyebrow">تفاصيل البلاغ</span><h2 id="ticket-detail-title">{ticket?.case_id || 'جارٍ تحميل البلاغ…'}</h2></div><button className="icon-btn" onClick={onClose} aria-label="إغلاق تفاصيل البلاغ"><X size={19} /></button></div>
      {busy ? <PageLoader /> : error ? <EmptyState text={error} /> : ticket && <>
        <div className="ticket-detail-facts">
          <TicketFact label="تاريخ البلاغ" value={ticket.created_at ? formatDate(ticket.created_at, { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'غير متاح'} />
          <TicketFact label="المهلة المتبقية على SLA" value={slaText(ticket)} />
          <TicketFact label="الطبقة" value={ticket.layer3 || 'غير محدد'} />
          <TicketFact label="المشرف" value={ticket.supervisor || 'غير محدد'} />
          <TicketFact label="نوع المدرسة" value={ticket.school_type || 'غير مسجل في قاعدة المدارس'} />
          <TicketFact label="نوع المبنى" value={ticket.building_type || 'غير مسجل في قاعدة المدارس'} />
          <TicketFact label="حجم الإشغال" value={ticket.occupancy_size || 'غير مسجل في قاعدة المدارس'} />
          <TicketFact label="المدرسة" value={ticket.school_name || ticket.building_name || 'غير محدد'} />
          <TicketFact label="الأولوية" value={ticket.priority || 'غير محددة'} />
          <TicketFact label="الحالة" value={`${ticket.status || 'غير محددة'} · ${ticket.slm_status || 'SLA غير محددة'}`} />
        </div>
        <section className="ticket-detail-description"><h3>وصف البلاغ بالتفصيل</h3><p>{plainDescription(ticket.description) || 'لا يوجد وصف مسجل.'}</p></section>
        {ticket.relatedTickets.length > 0 && <section className="related-tickets"><div className="school-chart-heading"><h3>بلاغات ذات صلة</h3><span>من المدرسة نفسها والطبقة نفسها: {ticket.layer3}</span></div><div className="related-ticket-list">{ticket.relatedTickets.map((related) => <button key={related.id} onClick={() => onOpenRelated(related.id)}><strong>{related.case_id}</strong><span>{related.created_at ? formatDate(related.created_at, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</span><span>{related.status}</span><span>{related.slm_status}</span></button>)}</div></section>}
      </>}
    </section>
  </div>;
}
function TicketFact({ label, value }) {
  return <div className="ticket-detail-fact"><span>{label}</span><strong>{value}</strong></div>;
}

function Tickets({ session, csrf, notify }) {
  const [data, setData] = useState({ items: [], total: 0, page: 1, pages: 1, filters: { layers: [], supervisors: [], regions: [] } });
  const [filters, setFilters] = useState({ q: '', layer: '', supervisor: '', region: '', status: '' });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [reasonEdit, setReasonEdit] = useState(null);
  const [schoolSearch, setSchoolSearch] = useState('');
  const [schoolMatches, setSchoolMatches] = useState([]);
  const [schoolReport, setSchoolReport] = useState(null);
  const [schoolReportBusy, setSchoolReportBusy] = useState(false);
  const [ticketDetailsId, setTicketDetailsId] = useState(null);
  const fileRef = useRef(null);
  useEffect(() => {
    if (schoolSearch.trim().length < 2) { setSchoolMatches([]); return undefined; }
    let active = true;
    const timer = window.setTimeout(() => {
      request(`/api/schools?q=${encodeURIComponent(schoolSearch.trim())}`)
        .then((result) => { if (active) setSchoolMatches(result.items.slice(0, 8)); })
        .catch((error) => { if (active) notify(error.message); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [schoolSearch, notify]);
  const selectSchool = async (school) => {
    setSchoolSearch('');
    setSchoolMatches([]);
    setSchoolReportBusy(true);
    try { setSchoolReport(await request(`/api/schools/${encodeURIComponent(school.school_number)}/report`)); }
    catch (error) { setSchoolReport(null); notify(error.message); }
    finally { setSchoolReportBusy(false); }
  };
  const load = useCallback(async () => {
    setBusy(true);
    const params = new URLSearchParams({ page, limit: 20, ...filters });
    try { setData(await request(`/api/tickets?${params}`)); }
    catch (error) { notify(error.message); }
    finally { setBusy(false); }
  }, [filters, page, notify]);
  useEffect(() => { load(); }, [load]);
  const doSearch = (event) => { event.preventDefault(); setFilters({ ...filters, q: search }); setPage(1); };
  const upload = async (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) { notify('يرجى اختيار ملف CSV.'); return; }
    setUploading(true);
    try {
      const result = await request('/api/import/tickets', { method: 'POST', csrf, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'X-Filename': encodeURIComponent(file.name) }, body: await file.arrayBuffer() });
      notify(result.message); await load();
    } catch (error) { notify(error.message); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };
  const saveReason = async (ticket, reason, note) => {
    try { await request(`/api/tickets/${ticket.id}/breach-reason`, { method: 'PATCH', csrf, body: JSON.stringify({ reason, note }) }); setReasonEdit(null); notify('تم حفظ سبب الاختراق.'); await load(); }
    catch (error) { notify(error.message); }
  };
  const deleteTicket = async (ticket) => {
    if (!window.confirm(`إخفاء البلاغ ${ticket.case_id} من القوائم؟ سيبقى محفوظًا في السجل.`)) return;
    try { await request(`/api/tickets/${ticket.id}`, { method: 'DELETE', csrf }); notify('تم إخفاء البلاغ مع الاحتفاظ به في السجل.'); await load(); }
    catch (error) { notify(error.message); }
  };
  return <><PageHeading eyebrow="سجل البلاغات" title="قاعدة بيانات البلاغات" description="ابحث عن البلاغات، راجع تفاصيلها، واستورد تحديثات المنصة." action={['admin', 'receiver'].includes(session.role) && <><input ref={fileRef} type="file" accept=".csv,text/csv" className="visually-hidden" onChange={(e) => upload(e.target.files?.[0])} /><button className="btn btn-primary" onClick={() => fileRef.current?.click()} disabled={uploading}><CloudUpload size={17} />{uploading ? 'جارٍ الاستيراد…' : 'استيراد ملف البلاغات'}</button></>} />
    <section className="school-report-search panel">
      <div className="school-report-search-heading"><div><span className="eyebrow">تحليل مدرسة بعينها</span><h2>ابحث عن مدرسة</h2><p>اكتب الاسم أو الرقم الوزاري، ثم اختر المدرسة لعرض تقريرها.</p></div><Building2 size={22} /></div>
      <div className="school-lookup">
        <div className="search-field"><Search size={17} /><input value={schoolSearch} onChange={(event) => { setSchoolSearch(event.target.value); setSchoolReport(null); }} placeholder="اسم المدرسة أو الرقم الوزاري…" aria-label="البحث عن مدرسة" autoComplete="off" /></div>
        {schoolMatches.length > 0 && <div className="school-lookup-results" role="listbox" aria-label="نتائج البحث عن المدارس">{schoolMatches.map((school) => <button key={school.school_number} type="button" onClick={() => selectSchool(school)}><strong>{school.name}</strong><span>{school.school_number} · {school.supervisor || 'مشرف غير محدد'}</span></button>)}</div>}
      </div>
      {schoolReportBusy && <PageLoader />}
      {schoolReport && <SchoolReport report={schoolReport} onOpenTicket={setTicketDetailsId} notify={notify} />}
    </section>
    <div className="panel tickets-panel">
      <form className="filter-toolbar" onSubmit={doSearch}><div className="search-field"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث برقم البلاغ أو المدرسة أو الوصف…" /><button type="submit" className="search-submit">بحث</button></div><div className="filter-selects"><select aria-label="حالة البلاغ" value={filters.status} onChange={(e) => { setFilters({ ...filters, status: e.target.value }); setPage(1); }}><option value="">كل الحالات</option><option value="open">البلاغات المفتوحة</option><option value="breached">المخترقة</option><option value="attention">بحاجة إلى الانتباه</option></select><select aria-label="المشرف" value={filters.supervisor} onChange={(e) => { setFilters({ ...filters, supervisor: e.target.value }); setPage(1); }}><option value="">كل المشرفين</option>{data.filters.supervisors.map((name) => <option key={name}>{name}</option>)}</select><select aria-label="الطبقة" value={filters.layer} onChange={(e) => { setFilters({ ...filters, layer: e.target.value }); setPage(1); }}><option value="">كل الطبقات</option>{data.filters.layers.map((name) => <option key={name}>{name}</option>)}</select><select aria-label="المنطقة" value={filters.region} onChange={(e) => { setFilters({ ...filters, region: e.target.value }); setPage(1); }}><option value="">كل المناطق</option>{data.filters.regions.map((name) => <option key={name}>{name}</option>)}</select></div></form>
      <div className="table-caption"><span><Filter size={15} />{fmt.format(data.total)} بلاغ</span><span className="table-period">السجل محفوظ تراكميًا</span></div>
      <div className="table-wrap"><table className="tickets-table"><thead><tr><th>معرّف البلاغ</th><th>المدرسة والمشرف</th><th>الوصف والطبقة</th><th>الأولوية</th><th>الحالة وSLA</th><th>المدة المتبقية</th><th>تاريخ الإنشاء</th><th>سبب الاختراق</th>{session.role === 'admin' && <th />}</tr></thead><tbody>
      {busy ? (
        <tr><td colSpan="9"><PageLoader /></td></tr>
      ) : data.items.length ? data.items.map((ticket) => (
        <tr key={ticket.id}>
          <td><button className="ticket-id" onClick={() => setTicketDetailsId(ticket.id)} title="عرض تفاصيل البلاغ">{ticket.case_id}</button><small>{ticket.school_number || '—'}</small></td>
          <td><strong className="school-name">{ticket.school_name || ticket.building_name || 'غير محدد'}</strong><small>{ticket.supervisor || 'مشرف غير محدد'}</small></td>
          <td><span className="description-cell" title={plainDescription(ticket.description)}>{plainDescription(ticket.description) || '—'}</span><small>{ticket.layer3 || '—'}</small></td>
          <td><span className={`priority-badge ${isCriticalPriority(ticket.priority) ? 'priority-critical' : 'priority-normal'}`}><i />{ticket.priority || '—'}</span></td>
          <td><strong className="status-text">{ticket.status}</strong><small className={isBreachedStatus(ticket.slm_status) ? 'slm-danger' : 'slm-ok'}>{ticket.slm_status || 'غير محدد'}</small></td>
          <td>{ticket.sla_remaining_minutes !== null ? <span className="remaining-time">{slaText(ticket)}</span> : ticket.needs_attention ? <span className="tag tag-soft-amber"><AlertTriangle size={13} />قريب من الاختراق</span> : <span className="muted">غير متاح</span>}</td>
          <td>{ticket.created_at ? formatDate(ticket.created_at, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</td>
          <td>{isBreachedStatus(ticket.slm_status) ? (
            <div className="reason-cell">
              {reasonEdit?.id === ticket.id
                ? <ReasonForm ticket={ticket} onSave={saveReason} onCancel={() => setReasonEdit(null)} />
                : <button className={`reason-button ${ticket.breach_reason ? 'has-reason' : ''}`} disabled={session.role !== 'admin'} onClick={() => setReasonEdit({ id: ticket.id })}>{ticket.breach_reason || 'إضافة سبب'}{!ticket.breach_reason && session.role === 'admin' && <Plus size={13} />}</button>}
            </div>
          ) : <span className="muted">—</span>}</td>
          {session.role === 'admin' && <td><button className="icon-btn danger-icon" title="إخفاء البلاغ" onClick={() => deleteTicket(ticket)}><X size={16} /></button></td>}
        </tr>
      )) : <tr><td colSpan="9"><EmptyState text="لا توجد بلاغات مطابقة للبحث." /></td></tr>}
      </tbody></table></div>
      <div className="pagination"><span>صفحة {fmt.format(data.page)} من {fmt.format(data.pages)}</span><div><button className="icon-btn" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="السابق"><ChevronRight size={17} /></button><button className="icon-btn" disabled={page >= data.pages} onClick={() => setPage(page + 1)} aria-label="التالي"><ChevronLeft size={17} /></button></div></div>
    </div>
    {ticketDetailsId !== null && <TicketDetailsModal ticketId={ticketDetailsId} onClose={() => setTicketDetailsId(null)} onOpenRelated={setTicketDetailsId} notify={notify} />}
    <div className="data-footnote"><ShieldCheck size={15} />الاستيراد يحدّث البلاغات الموجودة حسب المعرّف، ولا يكررها. الحذف متاح للمسؤول فقط ويحتفظ بالسجل.</div>
  </>;
}
function ReasonForm({ ticket, onSave, onCancel }) {
  const [reason, setReason] = useState(ticket.breach_reason || '');
  const [note, setNote] = useState(ticket.breach_note || '');
  return <div className="reason-form"><select value={reason} onChange={(e) => setReason(e.target.value)} aria-label="سبب الاختراق"><option value="">سبب الاختراق</option>{REASONS.map((item) => <option key={item}>{item}</option>)}</select>{reason === 'أخرى' && <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="اكتب السبب" />}{<div className="reason-actions"><button onClick={() => onSave(ticket, reason, note)}><Check size={13} />حفظ</button><button onClick={onCancel}><X size={13} /></button></div>}</div>;
}
function Schools({ csrf, session, notify }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);
  const [selectedSchool, setSelectedSchool] = useState(null);
  const [adding, setAdding] = useState(false);
  const [newSchool, setNewSchool] = useState({
    schoolNumber: '', name: '', supervisor: '', region: '', schoolType: '', buildingType: '', occupancySize: ''
  });
  const fileRef = useRef(null);
  const canEdit = ['admin', 'receiver'].includes(session.role);
  const load = useCallback(async (search = query) => {
    try { const data = await request(`/api/schools?q=${encodeURIComponent(search)}`); setItems(data.items); setTotal(data.total); }
    catch (error) { notify(error.message); }
  }, [notify, query]);
  useEffect(() => { load(); }, [load]);
  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    try { const result = await request('/api/schools/import', { method: 'POST', csrf, body: JSON.stringify({ csv: await file.text() }) }); notify(result.message); await load(); }
    catch (error) { notify(error.message); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };
  const sync = async () => {
    setBusy(true);
    try { const result = await request('/api/schools/sync', { method: 'POST', csrf, body: '{}' }); notify(result.message); setQuery(''); await load(''); }
    catch (error) { notify(error.message); }
    finally { setBusy(false); }
  };
  const addSchool = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await request('/api/schools', { method: 'POST', csrf, body: JSON.stringify(newSchool) });
      notify('تمت إضافة المدرسة.');
      setAdding(false);
      setNewSchool({ schoolNumber: '', name: '', supervisor: '', region: '', schoolType: '', buildingType: '', occupancySize: '' });
      setQuery('');
      await load('');
    } catch (error) { notify(error.message); }
    finally { setBusy(false); }
  };
  const deleteSchool = async (school) => {
    if (!window.confirm(`حذف «${school.name}» من دليل المدارس؟ ستبقى البلاغات محفوظة، لكنها لن تدخل في التحليلات حتى إعادة ربطها.`)) return;
    setBusy(true);
    try {
      await request(`/api/schools/${encodeURIComponent(school.school_number)}`, { method: 'DELETE', csrf });
      notify('حُذفت المدرسة من الدليل مع الاحتفاظ ببلاغاتها.');
      await load();
    } catch (error) { notify(error.message); }
    finally { setBusy(false); }
  };
  const deleteAllSchools = async () => {
    if (!total) return;
    if (!window.confirm(`حذف جميع المدارس (${fmt.format(total)}) من الدليل؟ ستبقى البلاغات وسجلات التغييرات محفوظة، لكنها لن تدخل في التحليلات حتى مزامنة المدارس مجددًا.`)) return;
    setBusy(true);
    try {
      const result = await request('/api/schools', { method: 'DELETE', csrf });
      notify(result.message);
      setEditing(null);
      setQuery('');
      await load('');
    } catch (error) { notify(error.message); }
    finally { setBusy(false); }
  };
  const updateSchool = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await request(`/api/schools/${encodeURIComponent(editing.originalNumber)}`, {
        method: 'PATCH',
        csrf,
        body: JSON.stringify({
          schoolNumber: editing.school_number,
          name: editing.name,
          supervisor: editing.supervisor,
          region: editing.region,
          schoolType: editing.school_type,
          buildingType: editing.building_type,
          occupancySize: editing.occupancy_size
        })
      });
      notify('تم حفظ بيانات المدرسة.');
      setEditing(null);
      await load();
    } catch (error) { notify(error.message); }
    finally { setBusy(false); }
  };
  const editInput = (field, label, value, required = false) => <input
    aria-label={label}
    required={required}
    value={value}
    onChange={(event) => setEditing({ ...editing, [field]: event.target.value })}
  />;
  return <><PageHeading eyebrow="دليل المدارس" title="قاعدة بيانات المدارس" description="اربط أرقام المدارس بالمشرف والمنطقة لتحسين دقة التحليلات." action={canEdit && <div className="heading-actions"><input ref={fileRef} type="file" accept=".csv,text/csv" className="visually-hidden" onChange={(e) => upload(e.target.files?.[0])} />{session.role === 'admin' && <button className="btn btn-outline" onClick={deleteAllSchools} disabled={busy || total === 0}><X size={15} />حذف جميع المدارس</button>}<button className="btn btn-outline" onClick={() => { setAdding(!adding); setEditing(null); }} disabled={busy}><Plus size={16} />إضافة مدرسة</button><button className="btn btn-primary" onClick={() => fileRef.current?.click()} disabled={busy}><CloudUpload size={17} />استيراد قائمة المدارس</button></div>} />
    <div className="school-summary"><div className="school-summary-icon"><Building2 size={22} /></div><div><span>مدرسة في قاعدة البيانات</span><strong>{fmt.format(total)}</strong></div><div className="school-summary-note"><CheckCircle2 size={15} />توحيد رقم المدرسة يربط البلاغ بالمشرف تلقائيًا</div></div>
    <section className="panel school-panel"><div className="panel-heading"><div><h2>دليل المدارس والمشرفين</h2><p>تتم إزالة البادئة S- والمسافات من الرقم الوزاري عند الاستيراد. تعيد المزامنة مطابقة الاسم الفريد لتحديث رقم المدرسة دون تكرارها.</p></div><div className="search-field compact-search"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث باسم المدرسة أو الرقم…" /></div></div>
    {adding && <form className="school-create-form" onSubmit={addSchool}>{[
      ['schoolNumber', 'الرقم الوزاري', true],
      ['name', 'اسم المدرسة', true],
      ['supervisor', 'المشرف المسؤول'],
      ['region', 'المنطقة'],
      ['schoolType', 'نوع المدرسة'],
      ['buildingType', 'نوع المبنى'],
      ['occupancySize', 'حجم الإشغال']
    ].map(([field, label, required]) => <label key={field}>{label}<input required={required} value={newSchool[field]} onChange={(event) => setNewSchool({ ...newSchool, [field]: event.target.value })} /></label>)}<div className="school-create-actions"><button className="btn btn-primary" disabled={busy}><Check size={15} />حفظ المدرسة</button><button type="button" className="btn btn-outline" onClick={() => setAdding(false)} disabled={busy}>إلغاء</button></div></form>}
    <div className="table-wrap"><table className="tickets-table schools-table"><thead><tr><th>الرقم الوزاري</th><th>اسم المدرسة</th><th>المشرف المسؤول</th><th>النوع</th><th>نوع المبنى</th><th>حجم المبنى</th><th>آخر تحديث</th>{canEdit && <th>إجراءات</th>}</tr></thead><tbody>{items.length ? items.map((school) => {
      const activeEdit = editing?.originalNumber === school.school_number;
      return <tr key={school.school_number}>
        <td>{activeEdit ? editInput('school_number', 'الرقم الوزاري', editing.school_number, true) : <button className="school-number school-number-link" onClick={() => setSelectedSchool(school.school_number)} aria-label={`عرض تفاصيل ${school.name}`}>{school.school_number}</button>}</td>
        <td>{activeEdit ? <div className="school-edit-name">{editInput('name', 'اسم المدرسة', editing.name, true)}<label>المنطقة{editInput('region', 'المنطقة', editing.region)}</label></div> : <strong className="school-name">{school.name}</strong>}</td>
        <td>{activeEdit ? editInput('supervisor', 'المشرف المسؤول', editing.supervisor) : school.supervisor || <span className="muted">غير محدد</span>}</td>
        <td>{activeEdit ? editInput('school_type', 'نوع المدرسة', editing.school_type) : school.school_type || '—'}</td>
        <td>{activeEdit ? editInput('building_type', 'نوع المبنى', editing.building_type) : school.building_type || '—'}</td>
        <td>{activeEdit ? editInput('occupancy_size', 'حجم الإشغال', editing.occupancy_size) : school.occupancy_size || '—'}</td>
        <td>{new Intl.DateTimeFormat('ar-SA', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(school.updated_at))}</td>
        {canEdit && <td><div className="school-actions">{activeEdit
          ? <><button className="btn btn-small btn-primary" onClick={updateSchool} disabled={busy}><Check size={14} />حفظ</button><button className="btn btn-small btn-outline" onClick={() => setEditing(null)} disabled={busy}>إلغاء</button></>
          : <><button className="btn btn-small btn-outline" onClick={() => setEditing({ originalNumber: school.school_number, school_number: school.school_number, name: school.name, supervisor: school.supervisor || '', region: school.region || '', school_type: school.school_type || '', building_type: school.building_type || '', occupancy_size: school.occupancy_size || '' })} disabled={busy}>تعديل</button>{session.role === 'admin' && <button className="icon-btn danger-icon" title="حذف المدرسة" aria-label={`حذف ${school.name}`} onClick={() => deleteSchool(school)} disabled={busy}><X size={15} /></button>}</>}</div></td>}
      </tr>;
    }) : <tr><td colSpan={canEdit ? '8' : '7'}><EmptyState text="لا توجد مدارس بعد. استورد ملف CSV يحتوي على رقم المدرسة واسمها." /></td></tr>}</tbody></table></div></section>
    <section className="panel sync-panel"><div className="sync-icon"><FileSpreadsheet size={20} /></div><div className="sync-copy"><strong>مزامنة من شيت أونلاين</strong><span>تطابق المزامنة رقم المدرسة، وتحدّث الأرقام المعدّلة عند تطابق اسم فريد. المدارس المضافة يدويًا تبقى في الدليل.</span></div>{session.role === 'admin' && <button className="btn btn-outline" onClick={sync} disabled={busy}><Activity size={16} />{busy ? 'جارٍ المزامنة…' : 'مزامنة الآن'}</button>}</section>
    {selectedSchool && <SchoolDetailsModal schoolNumber={selectedSchool} onClose={() => setSelectedSchool(null)} notify={notify} />}
  </>;
}
function schoolBuildingCount(school) {
  const size = `${school.occupancy_size || ''} ${school.building_type || ''}`;
  if (/كبير|large/i.test(size)) return 3;
  if (/متوسط|medium/i.test(size)) return 2;
  return 1;
}
function SchoolVector({ count }) {
  return <div className="school-vector" aria-hidden="true">{Array.from({ length: count }, (_, index) => <svg key={index} viewBox="0 0 96 88" role="presentation">
    <path d="M12 37 48 10l36 27v43H12z" fill="#e8f5f2" stroke="#268c83" strokeWidth="3" strokeLinejoin="round" />
    <path d="M7 38 48 7l41 31" fill="none" stroke="#268c83" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M39 80V57a9 9 0 0 1 18 0v23" fill="#fff" stroke="#268c83" strokeWidth="3" />
    <path d="M21 47h10v10H21zm44 0h10v10H65z" fill="#9bd7cb" stroke="#268c83" strokeWidth="2" />
    <path d="M44 21h8v11h-8z" fill="#f3c775" />
  </svg>)}</div>;
}
function SchoolDetailsModal({ schoolNumber, onClose, notify }) {
  const [school, setSchool] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    request(`/api/schools/${encodeURIComponent(schoolNumber)}`)
      .then(({ item }) => { if (active) setSchool(item); })
      .catch((requestError) => { if (active) { setError(requestError.message); notify(requestError.message); } })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [schoolNumber, notify]);
  useEffect(() => {
    const closeOnEscape = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  const coordinates = (school?.source_data || []).reduce((result, field) => {
    if (field.label === 'خط العرض') result.latitude = field.value;
    if (field.label === 'خط الطول') result.longitude = field.value;
    return result;
  }, {});
  const latitude = Number(coordinates.latitude);
  const longitude = Number(coordinates.longitude);
  const hasCoordinates = Boolean(coordinates.latitude && coordinates.longitude) &&
    Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
    Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
  const mapUrl = hasCoordinates ? `https://www.google.com/maps?q=${latitude},${longitude}` : '';
  return <div className="ticket-detail-backdrop school-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="ticket-detail-modal school-detail-modal" role="dialog" aria-modal="true" aria-labelledby="school-detail-title">
      <div className="ticket-detail-heading"><div><span className="eyebrow">بيانات المدرسة</span><h2 id="school-detail-title">{school?.school_number || schoolNumber}</h2></div><button className="icon-btn" onClick={onClose} aria-label="إغلاق تفاصيل المدرسة"><X size={19} /></button></div>
      {busy ? <PageLoader /> : error ? <EmptyState text={error} /> : school && <>
        <header className="school-detail-hero">
          <SchoolVector count={schoolBuildingCount(school)} />
          <div className="school-detail-intro"><h3>{school.name}</h3><p>{school.region || 'المنطقة غير مسجلة'}</p>{mapUrl && <a href={mapUrl} target="_blank" rel="noreferrer"><Building2 size={15} />عرض موقع المدرسة على خرائط Google</a>}</div>
        </header>
        {school.source_data?.length
          ? <div className="school-detail-table-wrap"><table className="school-details-table"><tbody>{school.source_data.map((field, index) => <tr key={`${field.label}-${index}`}><th scope="row">{field.label || `بيان ${index + 1}`}</th><td>{field.value || '—'}</td></tr>)}</tbody></table></div>
          : <p className="school-detail-empty">بيانات أعمدة الشيت غير محفوظة لهذه المدرسة بعد. نفّذ مزامنة المدارس لعرض كامل التفاصيل.</p>}
      </>}
    </section>
  </div>;
}
function AccountPage({ session, csrf, notify, onUpdated }) {
  const [form, setForm] = useState({ username: session.username, displayName: session.displayName, currentPassword: '', newPassword: '' });
  const [busy, setBusy] = useState(false);
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await request('/api/account', {
        method: 'PUT',
        csrf,
        body: JSON.stringify(form)
      });
      onUpdated(result);
      setForm({ username: result.user.username, displayName: result.user.displayName, currentPassword: '', newPassword: '' });
      notify('تم تحديث بيانات الحساب بنجاح.');
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy(false);
    }
  };
  return <>
    <PageHeading eyebrow="الملف الشخصي" title="حسابي" description="حدّث اسمك واسم المستخدم وكلمة المرور الخاصة بك." />
    <form className="panel account-form" onSubmit={save}>
      <div className="settings-title"><span className="settings-icon"><Users size={19} /></span><div><h2>بيانات الحساب</h2><p>{roleLabels[session.role]} · يتطلب الحفظ تأكيد كلمة المرور الحالية.</p></div></div>
      <div className="form-grid">
        <label>الاسم الكامل<input required minLength="2" maxLength="100" autoComplete="name" value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label>
        <label>اسم المستخدم<input required minLength="3" maxLength="40" autoComplete="username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label>
        <label>كلمة المرور الحالية<input required type="password" autoComplete="current-password" value={form.currentPassword} onChange={(event) => setForm({ ...form, currentPassword: event.target.value })} /></label>
        <label>كلمة المرور الجديدة <span className="muted">(اختياري)</span><input type="password" minLength="12" maxLength="128" autoComplete="new-password" value={form.newPassword} onChange={(event) => setForm({ ...form, newPassword: event.target.value })} placeholder="12 خانة على الأقل" /></label>
      </div>
      <div className="form-hint"><LockKeyhole size={14} />عند تغيير كلمة المرور، سيتم إنهاء الجلسات الأخرى للمستخدم وتحديث الجلسة الحالية.</div>
      <button className="btn btn-primary" disabled={busy}>{busy ? 'جارٍ حفظ الحساب…' : 'حفظ بيانات الحساب'}</button>
    </form>
  </>;
}
function UsersPage({ csrf, session, notify }) {
  const [users, setUsers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ username: '', displayName: '', password: '', role: 'viewer' });
  const [editingUser, setEditingUser] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => request('/api/users').then((data) => setUsers(data.items)).catch((e) => notify(e.message)), [notify]);
  useEffect(() => { load(); }, [load]);
  const addUser = async (event) => {
    event.preventDefault(); setBusy(true);
    try { await request('/api/users', { method: 'POST', csrf, body: JSON.stringify(form) }); notify('تم إنشاء الحساب.'); setShowForm(false); setForm({ username: '', displayName: '', password: '', role: 'viewer' }); await load(); }
    catch (error) { notify(error.message); }
    finally { setBusy(false); }
  };
  const toggle = async (user) => {
    try { await request(`/api/users/${user.id}`, { method: 'PATCH', csrf, body: JSON.stringify({ active: !user.active }) }); notify('تم تحديث حالة الحساب.'); await load(); }
    catch (error) { notify(error.message); }
  };
  const saveUser = async (event) => {
    event.preventDefault();
    if (!editingUser) return;
    setBusy(true);
    try {
      const { id, role, password } = editingUser;
      await request(`/api/users/${id}`, {
        method: 'PATCH',
        csrf,
        body: JSON.stringify({ role, ...(password ? { password } : {}) })
      });
      notify('تم تحديث صلاحيات الحساب وكلمة المرور.');
      setEditingUser(null);
      await load();
    } catch (error) { notify(error.message); }
    finally { setBusy(false); }
  };
  return <><PageHeading eyebrow="المستخدمون والصلاحيات" title="إدارة الحسابات" description="تحكم في الوصول إلى بيانات البلاغات حسب دور كل مستخدم." action={<button className="btn btn-primary" onClick={() => setShowForm(!showForm)}><Plus size={17} />إضافة حساب</button>} />
    {showForm && <form className="panel user-form" onSubmit={addUser}><div className="panel-heading"><div><h2>حساب جديد</h2><p>كلمة المرور يجب ألا تقل عن 12 خانة.</p></div><button type="button" className="icon-btn" onClick={() => setShowForm(false)}><X size={18} /></button></div><div className="form-grid"><label>الاسم الكامل<input required value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></label><label>اسم المستخدم<input required minLength="3" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></label><label>كلمة المرور<input required type="password" minLength="12" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label><label>الدور<select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="receiver">متلقي البلاغات</option><option value="engineer">مهندس منطقة</option><option value="viewer">متابع</option></select></label></div><button className="btn btn-primary" disabled={busy}>{busy ? 'جارٍ الإنشاء…' : 'إنشاء الحساب'}</button></form>}
    {editingUser && <form className="panel user-form" onSubmit={saveUser}><div className="panel-heading"><div><h2>تعديل حساب {editingUser.displayName}</h2><p>اترك كلمة المرور فارغة للاحتفاظ بكلمة المرور الحالية.</p></div><button type="button" className="icon-btn" onClick={() => setEditingUser(null)} aria-label="إغلاق تعديل الحساب"><X size={18} /></button></div><div className="form-grid"><label>الصلاحية<select required value={editingUser.role} disabled={editingUser.id === session.id} onChange={(event) => setEditingUser({ ...editingUser, role: event.target.value })}><option value="admin">مسؤول النظام</option><option value="receiver">متلقي البلاغات</option><option value="engineer">مهندس منطقة</option><option value="viewer">متابع</option></select></label><label>كلمة مرور جديدة<input type="password" minLength="12" maxLength="128" autoComplete="new-password" disabled={editingUser.id === session.id} value={editingUser.password} onChange={(event) => setEditingUser({ ...editingUser, password: event.target.value })} placeholder={editingUser.id === session.id ? 'استخدم صفحة حسابي' : '12 خانة على الأقل'} /></label></div>{editingUser.id === session.id && <div className="form-hint"><LockKeyhole size={14} />لتغيير كلمة مرور حسابك الحالي، استخدم صفحة «حسابي».</div>}<button className="btn btn-primary" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ التعديلات'}</button></form>}
    <div className="panel users-panel"><div className="panel-heading"><div><h2>حسابات النظام</h2><p>{fmt.format(users.length)} مستخدم</p></div><span className="tag tag-soft-blue"><ShieldCheck size={14} />صلاحيات مفعّلة</span></div><div className="table-wrap"><table className="tickets-table users-table"><thead><tr><th>المستخدم</th><th>اسم الدخول</th><th>الدور</th><th>تاريخ الإنشاء</th><th>الحالة</th><th>الإجراءات</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><div className="user-table-name"><span className="avatar">{user.display_name.slice(0, 1)}</span><strong>{user.display_name}</strong></div></td><td>{user.username}</td><td><span className="tag tag-soft-blue">{roleLabels[user.role]}</span></td><td>{new Intl.DateTimeFormat('ar-SA', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${user.created_at}Z`))}</td><td><span className={`account-status ${user.active ? 'account-active' : 'account-disabled'}`}><i />{user.active ? 'نشط' : 'معطل'}</span></td><td><div className="user-actions"><button className="btn btn-small btn-outline" onClick={() => setEditingUser({ id: user.id, displayName: user.display_name, role: user.role, password: '' })}>تعديل</button><button className="btn btn-small btn-outline" onClick={() => toggle(user)} disabled={user.id === session.id}>{user.active ? 'تعطيل' : 'تفعيل'}</button></div></td></tr>)}</tbody></table></div></div>
    <div className="roles-grid"><div className="role-card"><span className="role-icon role-blue"><ShieldCheck size={17} /></span><div><strong>مسؤول النظام</strong><span>الحسابات، الإعدادات، حذف المدارس والبلاغات وتعديلها.</span></div></div><div className="role-card"><span className="role-icon role-amber"><CloudUpload size={17} /></span><div><strong>متلقي البلاغات</strong><span>استيراد البلاغات والمدارس وتعديل بيانات المدارس دون حذفها.</span></div></div><div className="role-card"><span className="role-icon role-green"><Wrench size={17} /></span><div><strong>مهندس المنطقة</strong><span>عرض ومتابعة البلاغات.</span></div></div><div className="role-card"><span className="role-icon role-purple"><Users size={17} /></span><div><strong>متابع</strong><span>عرض البلاغات والتقارير دون تعديل.</span></div></div></div>
  </>;
}
function SettingsPage({ csrf, notify }) {
  const [settings, setSettings] = useState({ schoolsUrl: '', criticalHours: 24, mediumHours: 72, importRuns: [] });
  const [busy, setBusy] = useState(false);
  useEffect(() => { request('/api/settings').then(setSettings).catch((e) => notify(e.message)); }, [notify]);
  const save = async (event) => {
    event.preventDefault(); setBusy(true);
    try { await request('/api/settings', { method: 'PUT', csrf, body: JSON.stringify({ schoolsUrl: settings.schoolsUrl, criticalHours: Number(settings.criticalHours), mediumHours: Number(settings.mediumHours) }) }); notify('تم حفظ الإعدادات.'); }
    catch (error) { notify(error.message); }
    finally { setBusy(false); }
  };
  return <><PageHeading eyebrow="تهيئة النظام" title="الإعدادات" description="إدارة مصادر البيانات ومراجعة عمليات الاستيراد الأخيرة." />
    <form className="panel settings-form" onSubmit={save}>
      <div className="settings-title"><span className="settings-icon"><FileSpreadsheet size={19} /></span><div><h2>مصدر قاعدة بيانات المدارس</h2><p>رابط CSV منشور من Google Sheets أو Microsoft 365 بصلاحية عرض.</p></div></div>
      <label className="setting-label">رابط الشيت<input type="url" dir="ltr" value={settings.schoolsUrl} onChange={(e) => setSettings({ ...settings, schoolsUrl: e.target.value })} placeholder="https://docs.google.com/spreadsheets/d/…" /></label>
      <div className="form-hint"><LockKeyhole size={14} />يقبل النظام روابط HTTPS من نطاقات Google Sheets وMicrosoft 365 فقط.</div>
      <div className="settings-title sla-settings-title"><span className="settings-icon"><Clock3 size={19} /></span><div><h2>مدد SLA حسب الأولوية</h2><p>تُحسب المهلة المتبقية من تاريخ إنشاء البلاغ، وتُطبق القيم على البلاغات الحالية والجديدة.</p></div></div>
      <div className="sla-settings-grid">
        <label className="setting-label">مهلة البلاغ الحرج (ساعة)<input type="number" min="1" max="720" step="1" required value={settings.criticalHours} onChange={(e) => setSettings({ ...settings, criticalHours: e.target.value })} /></label>
        <label className="setting-label">مهلة البلاغ المتوسط (ساعة)<input type="number" min="1" max="720" step="1" required value={settings.mediumHours} onChange={(e) => setSettings({ ...settings, mediumHours: e.target.value })} /></label>
      </div>
      <div className="form-hint"><Clock3 size={14} />القيم الافتراضية: الحرج 24 ساعة، والمتوسط 72 ساعة. النطاق المسموح من 1 إلى 720 ساعة.</div>
      <button className="btn btn-primary" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ الإعدادات'}</button>
    </form>
    <section className="panel import-history"><div className="panel-heading"><div><h2>سجل الاستيراد</h2><p>آخر عمليات تحديث البلاغات في قاعدة البيانات</p></div><span className="tag tag-soft-blue"><Clock3 size={14} />آخر 8 عمليات</span></div>{settings.importRuns?.length ? settings.importRuns.map((run, i) => <div className="history-row" key={`${run.filename}-${i}`}><span className="history-file"><FileSpreadsheet size={16} /></span><div><strong>{run.filename}</strong><small>{new Date(`${run.imported_at}Z`).toLocaleString('ar-SA')}</small></div><span className="history-number">{fmt.format(run.total_rows)} سجل</span><span className="history-detail">+{fmt.format(run.inserted_rows)} جديد · {fmt.format(run.updated_rows)} محدّث</span></div>) : <EmptyState text="لم يتم استيراد ملفات بعد." />}</section>
    <div className="security-note"><ShieldCheck size={18} /><div><strong>إرشادات أمان</strong><span>استخدم كلمة مرور قوية لكل حساب، واحتفظ بنسخة احتياطية مشفرة من قاعدة البيانات. عند النشر على شبكة، استخدم HTTPS وسر جلسة خاصًا.</span></div></div>
  </>;
}

function EmptyState({ text }) { return <div className="empty-state"><div><Search size={19} /></div><span>{text}</span></div>; }
function PageLoader() { return <div className="page-loader"><span className="spinner" />جارٍ تحميل البيانات…</div>; }
const rootElement = document.getElementById('root');
const appRoot = import.meta.hot?.data?.root || createRoot(rootElement);
if (import.meta.hot) import.meta.hot.data.root = appRoot;
appRoot.render(<React.StrictMode><App /></React.StrictMode>);

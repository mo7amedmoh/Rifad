require('dotenv').config();

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const db = require('./db');
const SQLiteSessionStore = require('./session-store');
const { parseCsv, normalizeSchoolNumber } = require('./importer');
const { DEFAULT_SCHOOLS_URL, parseSchoolCsv, fetchSchoolCsv } = require('./schools');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const production = process.env.NODE_ENV === 'production';
const sessionSecret = process.env.SESSION_SECRET;
const initialAdminSetupToken = process.env.INITIAL_ADMIN_SETUP_TOKEN;
const setupTokenConfigured = typeof initialAdminSetupToken === 'string' &&
  initialAdminSetupToken.length >= 32 && initialAdminSetupToken.length <= 256;
if (production && (!sessionSecret || sessionSecret.length < 32)) {
  throw new Error('SESSION_SECRET must contain at least 32 characters in production.');
}
app.disable('x-powered-by');
if (production) app.set('trust proxy', 1);
app.use(helmet(production ? { contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"], styleSrc: ["'self'", 'https://fonts.googleapis.com'],
  fontSrc: ["'self'", 'https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:'],
  scriptSrc: ["'self'"], connectSrc: ["'self'"], objectSrc: ["'none'"],
  baseUri: ["'self'"], frameAncestors: ["'none'"]
} } } : { contentSecurityPolicy: false }));
app.use(express.json({ limit: '9mb' }));
app.use(session({
  name: 'rifad.sid',
  secret: sessionSecret || 'local-development-secret-change-before-deployment',
  resave: false,
  saveUninitialized: false,
  store: new SQLiteSessionStore(),
  cookie: { httpOnly: true, sameSite: 'strict', secure: production, maxAge: 8 * 60 * 60 * 1000 }
}));

const roles = ['admin', 'receiver', 'engineer', 'viewer'];
const roleNames = { admin: 'مسؤول النظام', receiver: 'متلقي البلاغات', engineer: 'مهندس منطقة', viewer: 'متابع' };
const breachReasons = ['تأخر توريد قطع', 'موافقة الاستشاري', 'تعذر دخول المدرسة', 'تأخر إقفال على المنصة', 'نقص عمالة/فنيين', 'تصنيف خاطئ للبلاغ', 'صهريج/خدمة خارجية', 'أخرى'];
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('schools_url', ?)").run(DEFAULT_SCHOOLS_URL);
db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('sla_critical_hours', '24')").run();
db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('sla_medium_hours', '72')").run();

function publicUser(user) {
  return user && { id: user.id, username: user.username, displayName: user.display_name, role: user.role, roleName: roleNames[user.role] };
}
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'سجّل الدخول للمتابعة.' });
  const user = db.prepare('SELECT id, username, display_name, role, active FROM users WHERE id = ?').get(req.session.userId);
  if (!user || !user.active) return req.session.destroy(() => res.status(401).json({ error: 'الحساب غير متاح.' }));
  req.user = user;
  next();
}
function requireRole(...allowed) {
  return (req, res, next) => allowed.includes(req.user.role) ? next() : res.status(403).json({ error: 'لا تملك صلاحية تنفيذ هذا الإجراء.' });
}
function requireCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const expected = req.session.csrfToken;
  const provided = req.get('x-csrf-token');
  if (!expected || !provided || expected !== provided) return res.status(403).json({ error: 'تعذر التحقق من الطلب. حدّث الصفحة وحاول مجددًا.' });
  next();
}
function audit(userId, action, entity, entityId = '') {
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id) VALUES (?, ?, ?, ?)').run(userId, action, entity, String(entityId));
}
const schoolHistoryFields = ['school_number', 'name', 'supervisor', 'region', 'school_type', 'building_type', 'occupancy_size'];
function recordSchoolChange(schoolNumber, userId, source, before, after) {
  const changes = Object.fromEntries(schoolHistoryFields
    .filter((field) => (before?.[field] ?? '') !== (after[field] ?? ''))
    .map((field) => [field, { before: before?.[field] ?? null, after: after[field] ?? '' }]));
  if (!Object.keys(changes).length) return;
  db.prepare('INSERT INTO school_change_log (school_number, user_id, source, changes) VALUES (?, ?, ?, ?)')
    .run(schoolNumber, userId || null, source, JSON.stringify(changes));
}
function normalizeSchoolName(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ar')
    .replace(/[\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/^مدرسة\s*/u, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}
function schoolNumberKey(value) {
  return String(value || '').replace(/^m[-–—]?|[-–—]?m$/i, '');
}
function refreshTicketSchoolMatches() {
  const schools = db.prepare('SELECT school_number, name FROM schools').all();
  const schoolsByNumber = new Map(schools.map((school) => [school.school_number, school.school_number]));
  const schoolNumbersByKey = new Map();
  const names = new Map();
  for (const school of schools) {
    const numberKey = schoolNumberKey(school.school_number);
    if (numberKey) schoolNumbersByKey.set(numberKey, schoolNumbersByKey.has(numberKey) ? null : school.school_number);
    const name = normalizeSchoolName(school.name);
    if (!name) continue;
    names.set(name, names.has(name) ? null : school.school_number);
  }
  const tickets = db.prepare('SELECT id, school_number, building_name, matched_school_number, school_match_override FROM tickets').all();
  const update = db.prepare('UPDATE tickets SET matched_school_number = ?, school_match_override = ? WHERE id = ?');
  db.transaction((rows) => {
    for (const ticket of rows) {
      const overriddenSchool = ticket.school_match_override && schoolsByNumber.has(ticket.matched_school_number)
        ? ticket.matched_school_number : null;
      const schoolNumber = schoolsByNumber.get(ticket.school_number) || schoolNumbersByKey.get(schoolNumberKey(ticket.school_number));
      const schoolName = names.get(normalizeSchoolName(ticket.building_name));
      const matchedSchoolNumber = overriddenSchool || schoolNumber || schoolName || null;
      const override = overriddenSchool ? 1 : 0;
      if (matchedSchoolNumber !== ticket.matched_school_number || override !== ticket.school_match_override) update.run(matchedSchoolNumber, override, ticket.id);
    }
  })(tickets);
}
refreshTicketSchoolMatches();
function getSlaSettings() {
  const settings = db.prepare("SELECT key, value FROM app_settings WHERE key IN ('sla_critical_hours', 'sla_medium_hours')").all();
  const values = Object.fromEntries(settings.map(({ key, value }) => [key, Number(value)]));
  return {
    criticalHours: Number.isInteger(values.sla_critical_hours) ? values.sla_critical_hours : 24,
    mediumHours: Number.isInteger(values.sla_medium_hours) ? values.sla_medium_hours : 72
  };
}
function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
function cleanTicket(row) {
  return { ...row, needs_attention: Boolean(row.needs_attention), school_name: row.school_name || row.building_name, supervisor: row.supervisor || '', region: row.region || '' };
}
function slaRemainingMinutes(ticket, slaSettings, now = Date.now()) {
  const priority = ticket.priority.trim();
  const slaHours = /حرج|critical|عالي|high|p1/i.test(priority)
    ? slaSettings.criticalHours
    : /متوسط|medium|moderate|p2/i.test(priority) ? slaSettings.mediumHours : null;
  const createdAt = Date.parse(ticket.created_at);
  if (slaHours !== null && Number.isFinite(createdAt)) {
    return Math.ceil((createdAt + slaHours * 60 * 60 * 1000 - now) / 60_000);
  }
  const dueAt = Date.parse(ticket.sla_due_at);
  if (Number.isFinite(dueAt)) return Math.ceil((dueAt - now) / 60_000);
  return ticket.sla_remaining_minutes;
}
function isBreached(ticket) {
  return /تم اختراقه|مخترق|breached|violated/i.test(ticket.slm_status);
}
function isClosed(ticket) {
  return /مغلق|تم حل|محلول|closed|resolved/i.test(ticket.status);
}
function isCancelled(ticket) {
  return /ملغى|ملغي|cancelled|canceled/i.test(ticket.status.trim());
}
function isOpen(ticket) {
  return !isClosed(ticket) && !isCancelled(ticket);
}
app.use('/api', (req, res, next) => {
  const origin = req.get('origin');
  const allowedOrigin = process.env.APP_ORIGIN || (production ? `${req.protocol}://${req.get('host')}` : 'http://127.0.0.1:5173');
  let allowedDevelopmentOrigin = false;
  if (!production && origin) {
    try {
      const parsed = new URL(origin);
      allowedDevelopmentOrigin = parsed.protocol === 'http:' &&
        ['127.0.0.1', 'localhost'].includes(parsed.hostname) &&
        Number(parsed.port) >= 5173 && Number(parsed.port) <= 5199;
    } catch { allowedDevelopmentOrigin = false; }
  }
  if (origin && origin !== allowedOrigin && !allowedDevelopmentOrigin) return res.status(403).json({ error: 'مصدر الطلب غير مسموح.' });
  next();
});
app.get('/healthz', (req, res) => res.status(200).json({ ok: true }));
app.get('/api/session', (req, res) => {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  const user = req.session.userId ? db.prepare('SELECT id, username, display_name, role, active FROM users WHERE id = ?').get(req.session.userId) : null;
  res.json({
    setupRequired: db.prepare('SELECT COUNT(*) AS count FROM users').get().count === 0,
    setupAvailable: setupTokenConfigured,
    user: publicUser(user),
    csrfToken: req.session.csrfToken
  });
});
app.post('/api/setup', loginLimiter, requireCsrf, (req, res, next) => {
  try {
    if (db.prepare('SELECT COUNT(*) AS count FROM users').get().count !== 0) return res.status(409).json({ error: 'تم إعداد النظام مسبقًا.' });
    const input = z.object({
      setupToken: z.string().min(1).max(256),
      username: z.string().trim().min(3).max(40).regex(/^[\p{L}\p{N}_.-]+$/u),
      displayName: z.string().trim().min(2).max(100),
      password: z.string().min(12).max(128)
    }).parse(req.body);
    const suppliedToken = Buffer.from(input.setupToken);
    const expectedToken = Buffer.from(setupTokenConfigured ? initialAdminSetupToken : crypto.randomBytes(32).toString('hex'));
    if (!setupTokenConfigured || suppliedToken.length !== expectedToken.length || !crypto.timingSafeEqual(suppliedToken, expectedToken)) {
      return res.status(setupTokenConfigured ? 403 : 503).json({ error: setupTokenConfigured ? 'رمز التهيئة غير صحيح.' : 'تهيئة المسؤول متوقفة. عيّن INITIAL_ADMIN_SETUP_TOKEN بطول 32 إلى 256 محرفًا في إعدادات الخادم.' });
    }
    const passwordHash = bcrypt.hashSync(input.password, 12);
    const result = db.transaction(() => {
      if (db.prepare('SELECT COUNT(*) AS count FROM users').get().count !== 0) return null;
      return db.prepare('INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)').run(input.username, input.displayName, passwordHash, 'admin');
    })();
    if (!result) return res.status(409).json({ error: 'تم إعداد النظام مسبقًا.' });
    req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.userId = Number(result.lastInsertRowid);
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      res.json({ user: publicUser(db.prepare('SELECT id, username, display_name, role FROM users WHERE id = ?').get(req.session.userId)), csrfToken: req.session.csrfToken });
    });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'البيانات غير صالحة. استخدم كلمة مرور من 12 خانة على الأقل.' });
    next(error);
  }
});
app.post('/api/login', loginLimiter, requireCsrf, (req, res, next) => {
  try {
    const input = z.object({ username: z.string().trim().min(1).max(40), password: z.string().min(1).max(128) }).parse(req.body);
    const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(input.username);
    if (!user || !user.active || !bcrypt.compareSync(input.password, user.password_hash)) return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
    req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.userId = user.id;
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      res.json({ user: publicUser(user), csrfToken: req.session.csrfToken });
    });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'أدخل اسم المستخدم وكلمة المرور.' });
    next(error);
  }
});
app.post('/api/logout', requireAuth, requireCsrf, (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.use('/api', requireAuth, requireCsrf);
app.put('/api/account', (req, res, next) => {
  const parsed = z.object({
    currentPassword: z.string().min(1).max(128),
    username: z.string().trim().min(3).max(40).regex(/^[\p{L}\p{N}_.-]+$/u),
    displayName: z.string().trim().min(2).max(100),
    newPassword: z.string().min(12).max(128).optional().or(z.literal(''))
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'تحقق من الاسم واسم المستخدم وكلمة المرور الجديدة (12 خانة على الأقل).' });
  const currentUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!currentUser || !bcrypt.compareSync(parsed.data.currentPassword, currentUser.password_hash)) {
    return res.status(403).json({ error: 'كلمة المرور الحالية غير صحيحة.' });
  }
  try {
    const newPasswordHash = parsed.data.newPassword
      ? bcrypt.hashSync(parsed.data.newPassword, 12)
      : currentUser.password_hash;
    db.prepare('UPDATE users SET username = ?, display_name = ?, password_hash = ? WHERE id = ?')
      .run(parsed.data.username, parsed.data.displayName, newPasswordHash, req.user.id);
    audit(req.user.id, 'update', 'account', req.user.id);
    if (parsed.data.newPassword) {
      db.prepare("DELETE FROM sessions WHERE json_extract(sess, '$.userId') = ?").run(req.user.id);
    }
    req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.userId = req.user.id;
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      res.json({
        user: publicUser(db.prepare('SELECT id, username, display_name, role FROM users WHERE id = ?').get(req.user.id)),
        csrfToken: req.session.csrfToken
      });
    });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'اسم المستخدم مستخدم بالفعل.' });
    next(error);
  }
});

app.get('/api/summary', requireRole(...roles), (req, res) => {
  const slaSettings = getSlaSettings();
  const now = new Date();
  const period = req.query.period === 'week' ? 'week' : req.query.period === 'month' ? 'month' : 'all';
  const dateCutoff = period === 'week'
    ? new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
    : period === 'month' ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString() : null;
  const dateFilter = dateCutoff ? ' AND t.created_at >= ?' : '';
  const tickets = db.prepare(`SELECT t.*, s.name AS school_name, s.supervisor, s.region FROM tickets t JOIN schools s ON s.school_number = t.matched_school_number WHERE t.deleted_at IS NULL${dateFilter} ORDER BY t.created_at DESC`).all(...(dateCutoff ? [dateCutoff] : []));
  const activeTickets = tickets
    .filter(isOpen)
    .map((ticket) => ({ ...ticket, sla_remaining_minutes: slaRemainingMinutes(ticket, slaSettings) }));
  const alertSource = period === 'all' ? tickets : db.prepare(`SELECT t.*, s.name AS school_name, s.supervisor, s.region
    FROM tickets t JOIN schools s ON s.school_number = t.matched_school_number
    WHERE t.deleted_at IS NULL`).all();
  const allOpenTickets = alertSource
    .filter(isOpen)
    .map((ticket) => ({ ...ticket, sla_remaining_minutes: slaRemainingMinutes(ticket, slaSettings) }));
  const approachingSla = allOpenTickets
    .filter((ticket) => ticket.sla_remaining_minutes > 0 && ticket.sla_remaining_minutes <= 120)
    .sort((a, b) => a.sla_remaining_minutes - b.sla_remaining_minutes);
  const eligible = tickets.filter((ticket) => !isCancelled(ticket));
  const breached = eligible.filter(isBreached);
  const closed = eligible.filter(isClosed);
  const onTime = eligible.length - breached.length;
  const by = (key) => {
    const result = new Map();
    for (const ticket of tickets) {
      const name = key === 'supervisor'
        ? (ticket.supervisor || 'غير محدد')
        : (ticket[key] || 'غير محدد');
      const item = result.get(name) || { name, total: 0, breached: 0, open: 0 };
      item.total += 1;
      if (isBreached(ticket)) item.breached += 1;
      if (isOpen(ticket)) item.open += 1;
      result.set(name, item);
    }
    return [...result.values()].sort((a, b) => b.total - a.total).slice(0, 8);
  };
  const bySchool = (rows, key) => {
    const result = new Map();
    for (const ticket of rows) {
      const group = key === 'layer3' ? ticket.layer3.trim() : ticket.description.trim();
      if (!group) continue;
      const groupKey = `${ticket.matched_school_number}\u0000${group.toLocaleLowerCase('ar')}`;
      const item = result.get(groupKey) || {
        school_name: ticket.school_name,
        supervisor: ticket.supervisor || 'غير محدد',
        type: key === 'layer3' ? group : group.slice(0, 140),
        total: 0
      };
      item.total += 1;
      result.set(groupKey, item);
    }
    return [...result.values()].filter((item) => item.total > 1).sort((a, b) => b.total - a.total).slice(0, 10);
  };
  const openBySchool = new Map();
  for (const ticket of activeTickets) {
    const item = openBySchool.get(ticket.matched_school_number) || {
      school_name: ticket.school_name,
      supervisor: ticket.supervisor || 'غير محدد',
      total: 0
    };
    item.total += 1;
    openBySchool.set(ticket.matched_school_number, item);
  }
  const nearBreach = activeTickets.filter((ticket) => ticket.needs_attention || (ticket.sla_remaining_minutes !== null && ticket.sla_remaining_minutes <= 120));
  const overdueOpen = activeTickets.filter((ticket) => ticket.sla_remaining_minutes !== null && ticket.sla_remaining_minutes <= 0).length;
  const dueSoonOpen = activeTickets.filter((ticket) => ticket.sla_remaining_minutes > 0 && ticket.sla_remaining_minutes <= 120).length;
  const missingSlaOpen = activeTickets.filter((ticket) => ticket.sla_remaining_minutes === null).length;
  const approachingSlaTickets = approachingSla.slice(0, 10).map(cleanTicket);
  const breachedWithoutReason = breached.filter((ticket) => !ticket.breach_reason);
  const supervisorStats = new Map();
  for (const ticket of eligible) {
    const name = ticket.supervisor || 'غير محدد';
    const item = supervisorStats.get(name) || { name, total: 0, closed: 0, breached: 0, onTime: 0, responseTotal: 0, responseSamples: 0 };
    item.total += 1;
    if (isClosed(ticket)) item.closed += 1;
    if (isBreached(ticket)) item.breached += 1;
    else item.onTime += 1;
    const createdAt = Date.parse(ticket.created_at);
    const resolvedAt = Date.parse(ticket.resolved_at);
    if (Number.isFinite(createdAt) && Number.isFinite(resolvedAt) && resolvedAt >= createdAt) {
      item.responseTotal += resolvedAt - createdAt;
      item.responseSamples += 1;
    }
    supervisorStats.set(name, item);
  }
  const supervisorPerformance = [...supervisorStats.values()].map((item) => ({
    ...item,
    compliance: item.total ? Math.round((item.onTime / item.total) * 1000) / 10 : 0,
    averageResponseMinutes: item.responseSamples ? Math.round(item.responseTotal / item.responseSamples / 60_000) : null
  })).sort((a, b) => b.compliance - a.compliance || b.closed - a.closed ||
    (a.averageResponseMinutes ?? Number.MAX_SAFE_INTEGER) - (b.averageResponseMinutes ?? Number.MAX_SAFE_INTEGER));
  const breachedCountBy = (key) => {
    const counts = new Map();
    for (const ticket of breached) {
      const name = ticket[key] || 'غير محدد';
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    return [...counts].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total).slice(0, 10);
  };
  const dayCounts = new Map();
  for (const ticket of breached) {
    if (!ticket.created_at) continue;
    const day = ticket.created_at.slice(0, 10);
    dayCounts.set(day, (dayCounts.get(day) || 0) + 1);
  }
  const breachedByDay = [...dayCounts].map(([date, total]) => ({
    date,
    name: new Intl.DateTimeFormat('ar-SA', { timeZone: 'Asia/Riyadh', day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00+03:00`)),
    total
  })).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
  const supervisorAnalysis = new Map();
  for (const ticket of tickets) {
    if (isCancelled(ticket)) continue;
    const name = ticket.supervisor || 'غير محدد';
    const item = supervisorAnalysis.get(name) || { name, total: 0, open: 0, closed: 0, breached: 0 };
    item.total += 1;
    if (isClosed(ticket)) item.closed += 1;
    else item.open += 1;
    if (isBreached(ticket)) item.breached += 1;
    supervisorAnalysis.set(name, item);
  }
  const bySupervisor = [...supervisorAnalysis.values()].map((item) => ({
    ...item,
    compliance: item.total ? Math.round(((item.total - item.breached) / item.total) * 1000) / 10 : 0
  })).sort((a, b) => b.total - a.total).slice(0, 10);
  const startMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  const endMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const trendTickets = db.prepare(`SELECT t.created_at, t.slm_status, t.status
    FROM tickets t JOIN schools s ON s.school_number = t.matched_school_number
    WHERE t.deleted_at IS NULL AND t.created_at >= ? AND t.created_at < ?`).all(startMonth.toISOString(), endMonth.toISOString());
  const monthlyCounts = new Map();
  for (const ticket of trendTickets) {
    const month = ticket.created_at.slice(0, 7);
    const count = monthlyCounts.get(month) || { total: 0, breached: 0 };
    if (isCancelled(ticket)) continue;
    count.total += 1;
    if (isBreached(ticket)) count.breached += 1;
    monthlyCounts.set(month, count);
  }
  const monthlyCompliance = Array.from({ length: 12 }, (_, index) => {
    const month = new Date(Date.UTC(startMonth.getUTCFullYear(), startMonth.getUTCMonth() + index, 1));
    const key = month.toISOString().slice(0, 7);
    const count = monthlyCounts.get(key) || { total: 0, breached: 0 };
    return {
      key,
      label: new Intl.DateTimeFormat('ar-SA', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(month),
      total: count.total,
      compliance: count.total ? Math.round(((count.total - count.breached) / count.total) * 1000) / 10 : null
    };
  });
  res.json({
    period,
    metrics: {
      total: tickets.length,
      open: activeTickets.length,
      closed: closed.length,
      breached: breached.length,
      onTime,
      nearBreach: nearBreach.length,
      approachingSla: approachingSla.length,
      overdueOpen,
      dueSoonOpen,
      missingSlaOpen,
      compliance: eligible.length ? Math.round((onTime / eligible.length) * 1000) / 10 : 0,
      cumulative: db.prepare("SELECT COUNT(*) AS count FROM tickets t JOIN schools s ON s.school_number = t.matched_school_number WHERE t.deleted_at IS NULL").get().count,
      cumulativeCompliance: (() => {
        const all = db.prepare("SELECT t.slm_status, t.status FROM tickets t JOIN schools s ON s.school_number = t.matched_school_number WHERE t.deleted_at IS NULL AND t.status NOT LIKE '%لغى%'").all();
        return all.length ? Math.round((all.filter((x) => !/تم اختراقه|مخترق|breached|violated/i.test(x.slm_status)).length / all.length) * 1000) / 10 : 0;
      })(),
      missingBreachReason: breachedWithoutReason.length
    },
    byLayer: by('layer3'),
    bySupervisor,
    topOpenSchools: [...openBySchool.values()].sort((a, b) => b.total - a.total).slice(0, 10),
    repeatedBySchool: bySchool(tickets, 'layer3'),
    openTickets: activeTickets.slice(0, 8).map(cleanTicket),
    approachingSlaTickets,
    monthlyCompliance,
    breachedByLayer: breachedCountBy('layer3'),
    breachedByDay,
    supervisorPerformance: supervisorPerformance.slice(0, 10),
    bestSupervisor: supervisorPerformance[0] || null
  });
});
app.get('/api/open-tickets', requireRole(...roles), (req, res) => {
  const slaSettings = getSlaSettings();
  const statusFilter = req.query.status === 'breached' ? 'breached' : 'open';
  const period = ['week', 'month'].includes(req.query.period) ? req.query.period : 'all';
  const supervisor = String(req.query.supervisor || '').trim().slice(0, 150);
  const layer = String(req.query.layer || '').trim().slice(0, 180);
  const region = String(req.query.region || '').trim().slice(0, 150);
  const limit = Math.max(1, Math.min(2000, Number(req.query.limit) || 2000));
  const tickets = db.prepare(`SELECT t.*, s.name AS school_name, s.supervisor, s.region
    FROM tickets t JOIN schools s ON s.school_number = t.matched_school_number
    WHERE t.deleted_at IS NULL ORDER BY t.created_at DESC`).all();
  const filteredPeriod = tickets.filter((ticket) => {
    if (period === 'week') return Date.parse(ticket.created_at) >= Date.now() - 7 * 24 * 60 * 60 * 1000;
    if (period === 'month') {
      const created = new Date(ticket.created_at);
      const now = new Date();
      return created.getUTCFullYear() === now.getUTCFullYear() && created.getUTCMonth() === now.getUTCMonth();
    }
    return true;
  });
  const openTickets = filteredPeriod.filter((ticket) => statusFilter === 'breached'
    ? isBreached(ticket)
    : isOpen(ticket));
  const supervisors = [...new Set(openTickets.map((ticket) => ticket.supervisor || 'غير محدد'))].sort((a, b) => a.localeCompare(b, 'ar'));
  const layers = [...new Set(openTickets.map((ticket) => ticket.layer3 || 'غير محدد'))].sort((a, b) => a.localeCompare(b, 'ar'));
  const regions = [...new Set(openTickets.map((ticket) => ticket.region || 'غير محدد'))].sort((a, b) => a.localeCompare(b, 'ar'));
  const filtered = openTickets.filter((ticket) =>
    (!supervisor || (ticket.supervisor || 'غير محدد') === supervisor) &&
    (!layer || (ticket.layer3 || 'غير محدد') === layer) &&
    (!region || (ticket.region || 'غير محدد') === region)
  );
  const now = Date.now();
  const items = filtered.slice(0, limit).map((ticket) => {
    return {
      id: ticket.id,
      case_id: ticket.case_id,
      school_name: ticket.school_name || ticket.building_name || 'غير محدد',
      supervisor: ticket.supervisor || 'غير محدد',
      description: ticket.description,
      sla_remaining_minutes: slaRemainingMinutes(ticket, slaSettings, now),
      slm_status: ticket.slm_status,
      needs_attention: Boolean(ticket.needs_attention),
      layer3: ticket.layer3 || 'غير محدد'
    };
  });
  res.json({ items, total: filtered.length, truncated: filtered.length > limit, filters: { supervisors, layers, regions }, status: statusFilter, period });
});
app.get('/api/tickets', requireRole(...roles), (req, res) => {
  const page = Math.max(1, Math.min(10000, Number(req.query.page) || 1));
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
  const q = String(req.query.q || '').trim().slice(0, 120);
  const layer = String(req.query.layer || '').trim().slice(0, 150);
  const supervisor = String(req.query.supervisor || '').trim().slice(0, 100);
  const region = String(req.query.region || '').trim().slice(0, 150);
  const status = String(req.query.status || '').trim().slice(0, 100);
  const clauses = ['t.deleted_at IS NULL'];
  const params = [];
  if (q) { clauses.push('(t.case_id LIKE ? OR t.school_number LIKE ? OR t.building_name LIKE ? OR t.description LIKE ? OR s.name LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  if (layer) { clauses.push('t.layer3 = ?'); params.push(layer); }
  if (supervisor) { clauses.push('s.supervisor = ?'); params.push(supervisor); }
  if (region) { clauses.push('s.region = ?'); params.push(region); }
  if (status === 'open') clauses.push("t.status NOT LIKE '%مغلق%' AND t.status NOT LIKE '%حل%' AND t.status NOT LIKE '%ملغ%' AND t.status NOT LIKE '%closed%'");
  if (status === 'breached') clauses.push("t.slm_status LIKE '%اختراق%'");
  if (status === 'attention') clauses.push('t.needs_attention = 1');
  const where = clauses.join(' AND ');
  const items = db.prepare(`SELECT t.*, s.name AS school_name, s.supervisor, s.region FROM tickets t JOIN schools s ON s.school_number = t.matched_school_number WHERE ${where} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, (page - 1) * limit);
  const total = db.prepare(`SELECT COUNT(*) AS count FROM tickets t JOIN schools s ON s.school_number = t.matched_school_number WHERE ${where}`).get(...params).count;
  const filters = db.prepare("SELECT DISTINCT t.layer3 FROM tickets t JOIN schools s ON s.school_number = t.matched_school_number WHERE t.deleted_at IS NULL AND t.layer3 <> '' ORDER BY t.layer3").all().map((row) => row.layer3);
  const supervisors = db.prepare("SELECT DISTINCT supervisor FROM schools WHERE supervisor <> '' ORDER BY supervisor").all().map((row) => row.supervisor);
  const regions = db.prepare("SELECT DISTINCT region FROM schools WHERE region <> '' ORDER BY region").all().map((row) => row.region);
  const slaSettings = getSlaSettings();
  res.json({ items: items.map((item) => ({ ...item, needs_attention: Boolean(item.needs_attention), sla_remaining_minutes: slaRemainingMinutes(item, slaSettings) })), total, page, pages: Math.max(1, Math.ceil(total / limit)), filters: { layers: filters, supervisors, regions } });
});
app.get('/api/tickets/:id/details', requireRole(...roles), (req, res) => {
  const ticketId = Number(req.params.id);
  if (!Number.isSafeInteger(ticketId) || ticketId < 1) return res.status(400).json({ error: 'معرّف البلاغ غير صالح.' });
  const ticket = db.prepare(`SELECT t.*, s.name AS school_name, s.supervisor, s.region, s.school_type, s.building_type, s.occupancy_size
    FROM tickets t JOIN schools s ON s.school_number = t.matched_school_number
    WHERE t.id = ? AND t.deleted_at IS NULL`).get(ticketId);
  if (!ticket) return res.status(404).json({ error: 'البلاغ غير موجود.' });
  const relatedTickets = ticket.layer3
    ? db.prepare(`SELECT id, case_id, status, slm_status, priority, layer3, created_at, resolved_at
        FROM tickets WHERE id <> ? AND matched_school_number = ? AND layer3 = ? AND deleted_at IS NULL
        ORDER BY created_at DESC LIMIT 10`).all(ticket.id, ticket.matched_school_number, ticket.layer3)
    : [];
  res.json({
    item: {
      ...cleanTicket(ticket),
      school_type: ticket.school_type || '',
      building_type: ticket.building_type || '',
      occupancy_size: ticket.occupancy_size || '',
      sla_remaining_minutes: slaRemainingMinutes(ticket, getSlaSettings()),
      relatedTickets
    }
  });
});
app.post('/api/import/tickets', requireRole('admin', 'receiver'),
  express.raw({ type: ['text/csv', 'application/octet-stream'], limit: '8mb' }),
  (req, res, next) => {
    try {
      if (!Buffer.isBuffer(req.body)) return res.status(415).json({ error: 'ارفع ملف CSV بترميز UTF-8.' });
      const tickets = parseCsv(req.body);
      const upsert = db.prepare(`INSERT INTO tickets
        (case_id, priority, status, created_at, slm_status, description, layer2, layer3, school_number, building_name, resolved_at, sla_due_at, sla_remaining_minutes, needs_attention, imported_at)
        VALUES (@case_id,@priority,@status,@created_at,@slm_status,@description,@layer2,@layer3,@school_number,@building_name,@resolved_at,@sla_due_at,@sla_remaining_minutes,@needs_attention,CURRENT_TIMESTAMP)
        ON CONFLICT(case_id) DO UPDATE SET
          priority=excluded.priority, status=excluded.status, slm_status=excluded.slm_status,
          description=excluded.description, layer2=excluded.layer2, layer3=excluded.layer3,
          school_number=excluded.school_number, building_name=excluded.building_name,
          resolved_at=COALESCE(excluded.resolved_at,tickets.resolved_at),
          sla_due_at=COALESCE(excluded.sla_due_at,tickets.sla_due_at),
          sla_remaining_minutes=excluded.sla_remaining_minutes, needs_attention=excluded.needs_attention,
          imported_at=CURRENT_TIMESTAMP`);
      const exists = db.prepare('SELECT COUNT(*) AS count FROM tickets WHERE case_id = ?');
      let inserted = 0; let updated = 0;
      const transaction = db.transaction((rows) => {
        for (const ticket of rows) {
          if (exists.get(ticket.case_id).count) updated += 1; else inserted += 1;
          upsert.run(ticket);
        }
        const rawFilename = String(req.get('x-filename') || 'tickets.csv');
        let filename;
        try { filename = decodeURIComponent(rawFilename); } catch { filename = rawFilename; }
        filename = filename.replace(/[\\/:<>\"|?*\u0000-\u001f]/g, '_').trim().slice(0, 180) || 'tickets.csv';
        db.prepare('INSERT INTO import_runs (imported_by, filename, total_rows, inserted_rows, updated_rows) VALUES (?, ?, ?, ?, ?)').run(req.user.id, filename, rows.length, inserted, updated);
      });
      transaction(tickets);
      refreshTicketSchoolMatches();
      audit(req.user.id, 'import', 'tickets', tickets.length);
      res.json({ imported: tickets.length, inserted, updated, message: `تم استيراد ${tickets.length} بلاغًا؛ ${inserted} جديد و${updated} محدّث.` });
    } catch (error) {
      if (error.message.includes('SQLITE_CONSTRAINT')) return res.status(400).json({ error: 'تعذر الاستيراد بسبب بيانات مكررة أو غير صالحة.' });
      if (error.message.includes('CSV') || error.message.includes('صف') || error.message.includes('أعمدة') || error.message.includes('معرّف')) return res.status(400).json({ error: error.message });
      next(error);
    }
  });
app.patch('/api/tickets/:id/breach-reason', requireRole('admin', 'engineer'), (req, res) => {
  const parsed = z.object({ reason: z.enum(breachReasons), note: z.string().trim().max(500).optional().default('') }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'اختر سببًا صحيحًا للاختراق.' });
  if (parsed.data.reason === 'أخرى' && !parsed.data.note) return res.status(400).json({ error: 'اكتب سبب الاختراق عند اختيار «أخرى».' });
  const result = db.prepare('UPDATE tickets SET breach_reason = ?, breach_note = ? WHERE id = ? AND deleted_at IS NULL').run(parsed.data.reason, parsed.data.note, req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'البلاغ غير موجود.' });
  audit(req.user.id, 'set-breach-reason', 'ticket', req.params.id);
  res.json({ ok: true });
});
app.delete('/api/tickets/:id', requireRole('admin'), (req, res) => {
  const result = db.prepare('UPDATE tickets SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'البلاغ غير موجود.' });
  audit(req.user.id, 'soft-delete', 'ticket', req.params.id);
  res.json({ ok: true, message: 'تم إخفاء البلاغ مع الاحتفاظ به في السجل.' });
});
app.get('/api/schools', requireRole(...roles), (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 120);
  const like = `%${q}%`;
  const normalizedNumber = schoolNumberKey(normalizeSchoolNumber(q));
  const numberLike = normalizedNumber ? `%${normalizedNumber}%` : like;
  const items = db.prepare(`SELECT school_number, name, supervisor, region, school_type, building_type, occupancy_size, updated_at FROM schools
    WHERE ? = '' OR school_number LIKE ? OR (? <> '' AND school_number LIKE ?)
      OR name LIKE ? OR supervisor LIKE ? ORDER BY name LIMIT 500`)
    .all(q, like, normalizedNumber, numberLike, like, like);
  const total = db.prepare('SELECT COUNT(*) AS count FROM schools').get().count;
  res.json({ items, total });
});
app.get('/api/schools/:schoolNumber', requireRole(...roles), (req, res) => {
  const schoolNumber = normalizeSchoolNumber(req.params.schoolNumber);
  const school = db.prepare('SELECT * FROM schools WHERE school_number = ?').get(schoolNumber);
  if (!school) return res.status(404).json({ error: 'المدرسة غير موجودة في دليل المدارس.' });
  res.json({ item: { ...school, source_data: JSON.parse(school.source_data || '[]') } });
});
app.post('/api/schools', requireRole('admin', 'receiver'), (req, res) => {
  const parsed = z.object({
    schoolNumber: z.string().trim().min(1).max(50),
    name: z.string().trim().min(1).max(250),
    supervisor: z.string().trim().max(150).optional().default(''),
    region: z.string().trim().max(250).optional().default(''),
    schoolType: z.string().trim().max(100).optional().default(''),
    buildingType: z.string().trim().max(100).optional().default(''),
    occupancySize: z.string().trim().max(100).optional().default('')
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'أدخل رقم المدرسة واسمها وتحقق من بقية البيانات.' });

  const number = normalizeSchoolNumber(parsed.data.schoolNumber);
  if (!number) return res.status(400).json({ error: 'رقم المدرسة غير صالح.' });
  if (db.prepare('SELECT 1 FROM schools WHERE school_number = ?').get(number)) {
    return res.status(409).json({ error: 'رقم المدرسة مسجل مسبقًا.' });
  }
  try {
    storeSchools([{
      number,
      name: parsed.data.name,
      supervisor: parsed.data.supervisor,
      region: parsed.data.region,
      schoolType: parsed.data.schoolType,
      buildingType: parsed.data.buildingType,
      occupancySize: parsed.data.occupancySize
    }], req.user.id, 'manual');
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'رقم المدرسة مسجل مسبقًا.' });
    }
    throw error;
  }
  audit(req.user.id, 'create', 'school', number);
  res.status(201).json({ item: db.prepare('SELECT * FROM schools WHERE school_number = ?').get(number) });
});
app.delete('/api/schools', requireRole('admin'), (req, res) => {
  const count = db.prepare('SELECT COUNT(*) AS count FROM schools').get().count;
  db.transaction(() => {
    db.prepare('DELETE FROM schools').run();
    audit(req.user.id, 'delete-all', 'schools', count);
  })();
  res.json({ deleted: count, message: `تم حذف ${count} مدرسة من الدليل. لم تُحذف البلاغات أو سجلات التغييرات.` });
});
app.delete('/api/schools/:schoolNumber', requireRole('admin', 'receiver'), (req, res) => {
  const schoolNumber = normalizeSchoolNumber(req.params.schoolNumber);
  const result = db.prepare('DELETE FROM schools WHERE school_number = ?').run(schoolNumber);
  if (!result.changes) return res.status(404).json({ error: 'المدرسة غير موجودة.' });
  audit(req.user.id, 'delete', 'school', schoolNumber);
  res.json({ ok: true, message: 'حُذفت المدرسة من الدليل مع الاحتفاظ بالبلاغات وسجل التغييرات.' });
});
app.get('/api/schools/:schoolNumber/report', requireRole(...roles), (req, res) => {
  const schoolNumber = normalizeSchoolNumber(req.params.schoolNumber);
  const school = db.prepare(`SELECT school_number, name, supervisor, region, school_type, building_type, occupancy_size, updated_at
    FROM schools WHERE school_number = ?`).get(schoolNumber);
  if (!school) return res.status(404).json({ error: 'المدرسة غير موجودة في دليل المدارس.' });
  const tickets = db.prepare(`SELECT * FROM tickets
    WHERE matched_school_number = ? AND deleted_at IS NULL
    ORDER BY created_at DESC`).all(schoolNumber);
  const activeTickets = tickets.filter(isOpen);
  const eligible = tickets.filter((ticket) => !isCancelled(ticket));
  const closed = eligible.filter(isClosed);
  const breached = eligible.filter(isBreached);
  const layerCounts = new Map();
  for (const ticket of tickets) {
    const name = ticket.layer3 || 'غير محدد';
    const item = layerCounts.get(name) || { name, total: 0, open: 0, closed: 0, breached: 0 };
    item.total += 1;
    if (isOpen(ticket)) item.open += 1;
    if (isClosed(ticket)) item.closed += 1;
    if (isBreached(ticket)) item.breached += 1;
    layerCounts.set(name, item);
  }
  const now = new Date();
  const startMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  const monthlyCounts = new Map();
  const hourlyCounts = Array.from({ length: 24 }, (_, hour) => ({ hour, label: `${String(hour).padStart(2, '0')}:00`, total: 0 }));
  const weekdayCounts = new Map();
  for (const ticket of tickets) {
    const createdAt = Date.parse(ticket.created_at);
    if (!Number.isFinite(createdAt) || createdAt < startMonth.getTime()) continue;
    const date = new Date(createdAt);
    const monthKey = date.toISOString().slice(0, 7);
    const month = monthlyCounts.get(monthKey) || { total: 0, closed: 0, breached: 0 };
    if (!isCancelled(ticket)) {
      month.total += 1;
      if (isClosed(ticket)) month.closed += 1;
      if (isBreached(ticket)) month.breached += 1;
    }
    monthlyCounts.set(monthKey, month);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Riyadh', hour: '2-digit', hourCycle: 'h23', weekday: 'long'
    }).formatToParts(date);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value);
    const weekday = parts.find((part) => part.type === 'weekday')?.value;
    if (Number.isInteger(hour) && hourlyCounts[hour]) hourlyCounts[hour].total += 1;
    if (weekday) weekdayCounts.set(weekday, (weekdayCounts.get(weekday) || 0) + 1);
  }
  const monthlyActivity = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(startMonth.getUTCFullYear(), startMonth.getUTCMonth() + index, 1));
    const key = date.toISOString().slice(0, 7);
    const counts = monthlyCounts.get(key) || { total: 0, closed: 0, breached: 0 };
    return {
      key,
      label: new Intl.DateTimeFormat('ar-SA', { month: 'short', timeZone: 'UTC' }).format(date),
      ...counts
    };
  });
  const reportingSchoolCounts = db.prepare(`SELECT s.school_number, COUNT(t.id) AS total
    FROM schools s LEFT JOIN tickets t ON t.matched_school_number = s.school_number
      AND t.deleted_at IS NULL AND t.created_at >= ?
      AND t.status NOT LIKE '%ملغ%' AND LOWER(t.status) NOT LIKE '%cancel%'
    GROUP BY s.school_number`).all(startMonth.toISOString())
    .map((row) => row.total).filter((total) => total > 0).sort((a, b) => a - b);
  const median = reportingSchoolCounts.length
    ? reportingSchoolCounts[Math.floor((reportingSchoolCounts.length - 1) / 2)]
    : 0;
  const schoolTicketCount = reportingSchoolCounts.length
    ? monthlyActivity.reduce((sum, month) => sum + month.total, 0)
    : 0;
  const weekdayOrder = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const weekdayLabels = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const byWeekday = weekdayOrder.map((day, index) => ({ name: weekdayLabels[index], total: weekdayCounts.get(day) || 0 }));
  res.json({
    school: {
      school_number: school.school_number,
      name: school.name,
      supervisor: school.supervisor,
      region: school.region,
      school_type: school.school_type,
      building_type: school.building_type,
      occupancy_size: school.occupancy_size
    },
    metrics: {
      total: tickets.length,
      open: activeTickets.length,
      closed: closed.length,
      breached: breached.length,
      closureRate: eligible.length ? Math.round((closed.length / eligible.length) * 1000) / 10 : 0,
      compliance: eligible.length ? Math.round(((eligible.length - breached.length) / eligible.length) * 1000) / 10 : 0,
      last12Months: schoolTicketCount,
      peerMedian: median,
      safeBand: schoolTicketCount <= median
    },
    byLayer: [...layerCounts.values()].sort((a, b) => b.total - a.total).slice(0, 12),
    monthlyActivity,
    byHour: hourlyCounts,
    byWeekday,
    recentTickets: tickets.slice(0, 8).map((ticket) => ({
      id: ticket.id,
      case_id: ticket.case_id,
      layer3: ticket.layer3 || 'غير محدد',
      status: ticket.status,
      created_at: ticket.created_at,
      description: ticket.description
    }))
  });
});
app.get('/api/schools/:schoolNumber/history', requireRole(...roles), (req, res) => {
  const schoolNumber = normalizeSchoolNumber(req.params.schoolNumber);
  if (!db.prepare('SELECT 1 FROM schools WHERE school_number = ?').get(schoolNumber)) {
    return res.status(404).json({ error: 'المدرسة غير موجودة في دليل المدارس.' });
  }
  const items = db.prepare(`SELECT h.id, h.school_number, h.source, h.changes, h.created_at,
      u.display_name AS changed_by
    FROM school_change_log h LEFT JOIN users u ON u.id = h.user_id
    WHERE h.school_number = ? ORDER BY h.id DESC LIMIT 100`).all(schoolNumber)
    .map(({ changes, ...item }) => ({ ...item, changes: JSON.parse(changes) }));
  res.json({ items, limited: items.length === 100 });
});
app.patch('/api/schools/:schoolNumber', requireRole('admin', 'receiver'), (req, res) => {
  const currentNumber = normalizeSchoolNumber(req.params.schoolNumber);
  const current = db.prepare('SELECT * FROM schools WHERE school_number = ?').get(currentNumber);
  if (!current) return res.status(404).json({ error: 'المدرسة غير موجودة.' });
  const parsed = z.object({
    schoolNumber: z.string().trim().min(1).max(50).optional(),
    name: z.string().trim().min(1).max(250).optional(),
    supervisor: z.string().trim().max(150).optional(),
    region: z.string().trim().max(250).optional(),
    schoolType: z.string().trim().max(100).optional(),
    buildingType: z.string().trim().max(100).optional(),
    occupancySize: z.string().trim().max(100).optional()
  }).refine((value) => Object.keys(value).length > 0).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'تحقق من رقم المدرسة واسمها وبيانات المشرف والمنطقة.' });
  const updatedNumber = normalizeSchoolNumber(parsed.data.schoolNumber ?? current.school_number);
  if (!updatedNumber) return res.status(400).json({ error: 'رقم المدرسة غير صالح.' });
  const updated = {
    school_number: updatedNumber,
    name: parsed.data.name ?? current.name,
    supervisor: parsed.data.supervisor ?? current.supervisor,
    region: parsed.data.region ?? current.region,
    school_type: parsed.data.schoolType ?? current.school_type,
    building_type: parsed.data.buildingType ?? current.building_type,
    occupancy_size: parsed.data.occupancySize ?? current.occupancy_size
  };
  try {
    db.transaction(() => {
      db.prepare(`UPDATE schools SET school_number = ?, name = ?, supervisor = ?, region = ?, school_type = ?, building_type = ?, occupancy_size = ?, updated_at = CURRENT_TIMESTAMP
        WHERE school_number = ?`).run(updated.school_number, updated.name, updated.supervisor, updated.region, updated.school_type, updated.building_type, updated.occupancy_size, currentNumber);
      if (updatedNumber !== currentNumber) {
        db.prepare('UPDATE school_change_log SET school_number = ? WHERE school_number = ?').run(updatedNumber, currentNumber);
      }
      recordSchoolChange(updatedNumber, req.user.id, 'manual', current, updated);
      if (updatedNumber !== currentNumber) {
        db.prepare(`UPDATE tickets SET matched_school_number = ?, school_match_override = 1
          WHERE matched_school_number = ?`).run(updatedNumber, currentNumber);
      }
    })();
    refreshTicketSchoolMatches();
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'رقم المدرسة مسجل مسبقًا.' });
    }
    throw error;
  }
  audit(req.user.id, 'update', 'school', currentNumber);
  res.json({ item: updated });
});
app.post('/api/schools/import', requireRole('admin', 'receiver'), (req, res) => {
  try {
    const input = z.object({ csv: z.string().min(1).max(8_000_000) }).parse(req.body);
    const rows = parseSchoolCsv(Buffer.from(input.csv, 'utf8'));
    storeSchools(rows, req.user.id, 'csv');
    audit(req.user.id, 'import', 'schools', rows.length);
    res.json({ imported: rows.length, message: `تم تحديث ${rows.length} مدرسة.` });
  } catch (error) {
    res.status(400).json({ error: error.message || 'تعذر قراءة ملف المدارس.' });
  }
});
function storeSchools(rows, userId = null, source = 'sync') {
  const currentSchools = source === 'manual' ? [] : db.prepare('SELECT * FROM schools').all();
  const currentByName = new Map();
  const incomingByName = new Map();
  const addToNameIndex = (index, key, item) => {
    if (!key) return;
    const matches = index.get(key) || [];
    matches.push(item);
    index.set(key, matches);
  };
  for (const school of currentSchools) addToNameIndex(currentByName, normalizeSchoolName(school.name), school);
  for (const school of rows) addToNameIndex(incomingByName, normalizeSchoolName(school.name), school);
  const currentNumbers = new Set(currentSchools.map((school) => school.school_number));
  const renumberedSchools = [];
  for (const school of rows) {
    if (currentNumbers.has(school.number)) continue;
    const nameKey = normalizeSchoolName(school.name);
    const previousMatches = currentByName.get(nameKey) || [];
    const incomingMatches = incomingByName.get(nameKey) || [];
    if (previousMatches.length !== 1 || incomingMatches.length !== 1) continue;
    const previous = previousMatches[0];
    if (currentNumbers.has(school.number)) continue;
    renumberedSchools.push({ previous, school });
    currentNumbers.add(school.number);
  }

  const save = db.prepare(`INSERT INTO schools (school_number, name, supervisor, region, school_type, building_type, occupancy_size, source_data, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(school_number) DO UPDATE SET name=excluded.name, supervisor=excluded.supervisor, region=excluded.region,
      school_type=COALESCE(NULLIF(excluded.school_type, ''), schools.school_type),
      building_type=COALESCE(NULLIF(excluded.building_type, ''), schools.building_type),
      occupancy_size=COALESCE(NULLIF(excluded.occupancy_size, ''), schools.occupancy_size),
      source_data=CASE WHEN excluded.source_data <> '[]' THEN excluded.source_data ELSE schools.source_data END,
      updated_at=CURRENT_TIMESTAMP`);
  db.transaction((items) => {
    for (const { previous, school } of renumberedSchools) {
      const after = {
        school_number: school.number,
        name: school.name,
        supervisor: school.supervisor || '',
        region: school.region || '',
        school_type: school.schoolType || previous.school_type || '',
        building_type: school.buildingType || previous.building_type || '',
        occupancy_size: school.occupancySize || previous.occupancy_size || ''
      };
      recordSchoolChange(school.number, userId, source, previous, after);
      db.prepare('UPDATE schools SET school_number = ? WHERE school_number = ?')
        .run(school.number, previous.school_number);
      db.prepare('UPDATE tickets SET matched_school_number = ? WHERE matched_school_number = ?')
        .run(school.number, previous.school_number);
      db.prepare('UPDATE tickets SET school_match_override = 1 WHERE matched_school_number = ?')
        .run(school.number);
      db.prepare('UPDATE school_change_log SET school_number = ? WHERE school_number = ?')
        .run(school.number, previous.school_number);
    }
    items.forEach((school) => {
      const before = db.prepare('SELECT * FROM schools WHERE school_number = ?').get(school.number);
      const previousSourceData = JSON.parse(before?.source_data || '[]');
      const incomingSourceData = school.sourceData || [];
      const sourceData = source === 'sync' || incomingSourceData.length >= previousSourceData.length
        ? incomingSourceData
        : previousSourceData;
      const after = {
        school_number: school.number,
        name: school.name,
        supervisor: school.supervisor || '',
        region: school.region || '',
        school_type: school.schoolType || before?.school_type || '',
        building_type: school.buildingType || before?.building_type || '',
        occupancy_size: school.occupancySize || before?.occupancy_size || ''
      };
      save.run(
        school.number, school.name, school.supervisor || '', school.region || '',
        school.schoolType || '', school.buildingType || '', school.occupancySize || '',
        JSON.stringify(sourceData)
      );
      recordSchoolChange(school.number, userId, source, before, after);
    });
  })(rows);
  refreshTicketSchoolMatches();
  return { renumbered: renumberedSchools.length };
}
async function syncSchoolData(urlValue = DEFAULT_SCHOOLS_URL, userId = null) {
  let csv;
  try { csv = await fetchSchoolCsv(urlValue); }
  catch (error) {
    if (error.status) throw error;
    throw Object.assign(new Error('تعذر الاتصال بشيت المدارس. تحقق من صلاحية المشاركة واتصال الإنترنت.'), { status: 502 });
  }
  const rows = parseSchoolCsv(csv);
  const result = storeSchools(rows, userId, 'sync');
  if (userId) audit(userId, 'sync', 'schools', rows.length);
  return { count: rows.length, renumbered: result.renumbered };
}
app.post('/api/schools/sync', requireRole('admin'), asyncRoute(async (req, res) => {
  const urlValue = db.prepare("SELECT value FROM app_settings WHERE key = 'schools_url'").get()?.value || DEFAULT_SCHOOLS_URL;
  try {
    const result = await syncSchoolData(urlValue, req.user.id);
    res.json({
      imported: result.count,
      renumbered: result.renumbered,
      message: `تمت مزامنة ${result.count} مدرسة، وتحديث أرقام ${result.renumbered} مدرسة.`
    });
  } catch (error) {
    console.error(`School synchronization failed: ${error.message}`);
    res.status(error.status || 502).json({ error: error.message });
  }
}));
app.get('/api/settings', requireRole('admin'), (req, res) => {
  res.json({
    schoolsUrl: db.prepare("SELECT value FROM app_settings WHERE key = 'schools_url'").get()?.value || '',
    ...getSlaSettings(),
    importRuns: db.prepare('SELECT filename, total_rows, inserted_rows, updated_rows, imported_at FROM import_runs ORDER BY id DESC LIMIT 8').all()
  });
});
app.put('/api/settings', requireRole('admin'), (req, res) => {
  const parsed = z.object({
    schoolsUrl: z.string().trim().max(2000).url().or(z.literal('')).optional(),
    criticalHours: z.number().int().min(1).max(720).optional(),
    mediumHours: z.number().int().min(1).max(720).optional()
  }).refine((value) => value.schoolsUrl !== undefined || value.criticalHours !== undefined || value.mediumHours !== undefined).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'تحقق من رابط الشيت ومدد SLA (من ساعة إلى 720 ساعة).' });
  if (parsed.data.schoolsUrl) {
    try {
      const url = new URL(parsed.data.schoolsUrl);
      const host = url.hostname.toLowerCase();
      if (url.protocol !== 'https:' || !(host === 'docs.google.com' || host.endsWith('.sharepoint.com') || host === 'onedrive.live.com' || host === 'www.office.com')) return res.status(400).json({ error: 'استخدم رابط HTTPS من Google Sheets أو Microsoft 365.' });
    } catch { return res.status(400).json({ error: 'رابط الشيت غير صالح.' }); }
  }
  if (parsed.data.schoolsUrl !== undefined) {
    db.prepare("INSERT INTO app_settings (key, value) VALUES ('schools_url', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(parsed.data.schoolsUrl);
    audit(req.user.id, 'update', 'settings', 'schools_url');
  }
  for (const [field, key] of [['criticalHours', 'sla_critical_hours'], ['mediumHours', 'sla_medium_hours']]) {
    if (parsed.data[field] === undefined) continue;
    db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(parsed.data[field]));
    audit(req.user.id, 'update', 'settings', key);
  }
  res.json({ ok: true });
});
app.get('/api/users', requireRole('admin'), (req, res) => {
  res.json({ items: db.prepare('SELECT id, username, display_name, role, active, created_at FROM users ORDER BY id').all() });
});
app.post('/api/users', requireRole('admin'), (req, res) => {
  const parsed = z.object({ username: z.string().trim().min(3).max(40).regex(/^[\p{L}\p{N}_.-]+$/u), displayName: z.string().trim().min(2).max(100), password: z.string().min(12).max(128),   role: z.enum(roles) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'تحقق من الاسم وكلمة المرور والدور.' });
  try {
    const result = db.prepare('INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)').run(parsed.data.username, parsed.data.displayName, bcrypt.hashSync(parsed.data.password, 12), parsed.data.role);
    audit(req.user.id, 'create', 'user', result.lastInsertRowid);
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'اسم المستخدم مستخدم بالفعل.' });
    throw error;
  }
});
app.patch('/api/users/:id', requireRole('admin'), (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'لا يمكن تعطيل حسابك الحالي.' });
  const parsed = z.object({ active: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'قيمة حالة الحساب غير صالحة.' });
  const target = db.prepare('SELECT role, active FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'المستخدم غير موجود.' });
  if (target.role === 'admin' && target.active && !parsed.data.active &&
      db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active = 1").get().count <= 1) {
    return res.status(409).json({ error: 'يجب إبقاء مسؤول نظام واحد نشط على الأقل.' });
  }
  const result = db.prepare('UPDATE users SET active = ? WHERE id = ?').run(Number(parsed.data.active), req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'المستخدم غير موجود.' });
  audit(req.user.id, 'update', 'user', req.params.id);
  res.json({ ok: true });
});

app.use('/api', (error, req, res, next) => {
  console.error('API error:', error.message);
  if (res.headersSent) return next(error);
  if (error.status === 413 || error.type === 'entity.too.large') return res.status(413).json({ error: 'حجم الملف أو البيانات يتجاوز الحد المسموح.' });
  if (error.status === 502) return res.status(502).json({ error: error.message || 'تعذر جلب بيانات الشيت.' });
  if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'تنسيق البيانات المرسلة غير صالح.' });
  res.status(500).json({ error: 'حدث خطأ داخلي. حاول مجددًا لاحقًا.' });
});
if (production && process.env.SERVE_CLIENT !== 'false') {
  const webRoot = path.resolve(__dirname, '../dist');
  app.use(express.static(webRoot));
  app.get('*', (req, res) => res.sendFile(path.join(webRoot, 'index.html')));
}

if (require.main === module) {
  const schoolUrl = db.prepare("SELECT value FROM app_settings WHERE key = 'schools_url'").get()?.value || DEFAULT_SCHOOLS_URL;
  syncSchoolData(schoolUrl)
    .then(({ count }) => console.info(`School data synchronized: ${count} records.`))
    .catch((error) => console.error(`Automatic school synchronization failed: ${error.message}`))
    .finally(() => app.listen(PORT, '0.0.0.0', () => console.log(`Rifad API listening on port ${PORT}`)));
}
module.exports = app;

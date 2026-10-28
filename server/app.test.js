const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const bcrypt = require('bcryptjs');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rifad-test-'));
process.env.DATABASE_PATH = path.join(tempDir, 'rifad.sqlite');
process.env.INITIAL_ADMIN_SETUP_TOKEN = 'test-only-initial-setup-token-0123456789';
const app = require('./index');
const db = require('./db');

test('secure setup, repeated ticket import, reason capture, and school mapping', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const healthResponse = await fetch(`${base}/healthz`);
  assert.equal(healthResponse.status, 200);
  assert.deepEqual(await healthResponse.json(), { ok: true });

  let cookie = '';
  const sessionResponse = await fetch(`${base}/api/session`);
  assert.equal(sessionResponse.status, 200);
  const sessionData = await sessionResponse.json();
  assert.equal(sessionData.setupRequired, true);
  assert.equal(sessionData.setupAvailable, true);
  cookie = sessionResponse.headers.get('set-cookie').split(';')[0];

  const noCsrf = await fetch(`${base}/api/setup`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(noCsrf.status, 403);
  const wrongSetupToken = await fetch(`${base}/api/setup`, {
    method: 'POST',
    headers: { Cookie: cookie, 'X-CSRF-Token': sessionData.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ setupToken: 'incorrect-token', username: 'admin-test', displayName: 'مدير تجريبي', password: 'a-strong-password-123' })
  });
  assert.equal(wrongSetupToken.status, 403);
  const setupResponse = await fetch(`${base}/api/setup`, {
    method: 'POST',
    headers: { Cookie: cookie, 'X-CSRF-Token': sessionData.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ setupToken: process.env.INITIAL_ADMIN_SETUP_TOKEN, username: 'admin-test', displayName: 'مدير تجريبي', password: 'a-strong-password-123' })
  });
  assert.equal(setupResponse.status, 200);
  cookie = setupResponse.headers.get('set-cookie').split(';')[0];
  const authData = await setupResponse.json();
  assert.equal(authData.user.role, 'admin');

  const settingsResponse = await fetch(`${base}/api/settings`, { headers: { Cookie: cookie } });
  const initialSettings = await settingsResponse.json();
  assert.match(initialSettings.schoolsUrl, /1RQo06DqRHv24M8bh1CmJbOl4c_GmoLPXKkHK_sVIoI8/);
  assert.equal(initialSettings.criticalHours, 24);
  assert.equal(initialSettings.mediumHours, 72);
  assert.equal(initialSettings.priorityMatrixEnabled, false);
  assert.equal(initialSettings.priorityOverAlertEnabled, true);
  assert.equal(initialSettings.priorityUnderAlertEnabled, false);

  const createdAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const csv = [
    '"مُعرّف الحالة","الأولوية","الحالة","تاريخ الإنشاء","حالة SLM","الوصف","الطبقة 3 للفئة","رقم المدرسة","اسم المبنى"',
    `"CASE-TEST-1","حرج","قيد التنفيذ","${createdAt}","تم اختراقه","وصف اختباري","أعمال صيانة","S- ١٢٣ ٤٥٦","اسم مبنى مختلف"`,
    `"CASE-ORPHAN-1","متوسط","قيد التنفيذ","${createdAt}","ضمن المهلة","بلاغ غير مرتبط","أعمال صيانة","999999","مدرسة غير مسجلة"`,
    `"CASE-NAME-MATCH-1","متوسط","قيد التنفيذ","${createdAt}","ضمن المهلة","مطابقة بالاسم","أعمال صيانة","999998","مدرسة تجريبية"`
  ].join('\n');
  const importCsv = () => fetch(`${base}/api/import/tickets`, {
    method: 'POST', headers: { Cookie: cookie, 'X-CSRF-Token': authData.csrfToken, 'Content-Type': 'text/csv; charset=utf-8' }, body: csv
  });
  const firstImport = await importCsv();
  assert.equal(firstImport.status, 200);
  assert.equal((await firstImport.json()).inserted, 3);
  const secondImport = await importCsv();
  const secondData = await secondImport.json();
  assert.equal(secondImport.status, 200);
  assert.equal(secondData.inserted, 0);
  assert.equal(secondData.updated, 3);

  const unmatchedTicketsResponse = await fetch(`${base}/api/tickets?q=CASE-ORPHAN-1`, { headers: { Cookie: cookie } });
  assert.equal((await unmatchedTicketsResponse.json()).total, 0);
  const unmatchedOpenResponse = await fetch(`${base}/api/open-tickets`, { headers: { Cookie: cookie } });
  assert.equal((await unmatchedOpenResponse.json()).total, 0);
  const unmatchedSummaryResponse = await fetch(`${base}/api/summary?period=all`, { headers: { Cookie: cookie } });
  const unmatchedSummary = await unmatchedSummaryResponse.json();
  assert.equal(unmatchedSummary.metrics.total, 0);
  assert.equal(unmatchedSummary.metrics.cumulative, 0);

  const schoolsResponse = await fetch(`${base}/api/schools/import`, {
    method: 'POST',
    headers: { Cookie: cookie, 'X-CSRF-Token': authData.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ csv: 'رقم المدرسة,اسم المدرسة,المشرف المسؤول,المنطقة,نوع المدرسة,نوع المبني,occupancy_size\nM-123456,مدرسة تجريبية,مشرف تجريبي,الرياض,حكومية,مبنى تعليمي,350' })
  });
  assert.equal(schoolsResponse.status, 200);
  const schoolNumberSearchResponse = await fetch(`${base}/api/schools?q=123456`, { headers: { Cookie: cookie } });
  const schoolRow = (await schoolNumberSearchResponse.json()).items[0];
  assert.equal(schoolRow.school_number, 'M-123456');
  assert.equal(schoolRow.school_type, 'حكومية');
  assert.equal(schoolRow.building_type, 'مبنى تعليمي');
  assert.equal(schoolRow.occupancy_size, '350');
  const schoolRefreshWithoutType = await fetch(`${base}/api/schools/import`, {
    method: 'POST',
    headers: { Cookie: cookie, 'X-CSRF-Token': authData.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ csv: 'رقم المدرسة,اسم المدرسة,المشرف المسؤول,المنطقة\nM-123456,مدرسة تجريبية,مشرف تجريبي,الرياض' })
  });
  assert.equal(schoolRefreshWithoutType.status, 200);

  const nameMatchedResponse = await fetch(`${base}/api/tickets?q=CASE-NAME-MATCH-1`, { headers: { Cookie: cookie } });
  const nameMatched = await nameMatchedResponse.json();
  assert.equal(nameMatched.total, 1);
  assert.equal(nameMatched.items[0].school_name, 'مدرسة تجريبية');

  const mediumCreatedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const mediumImportResponse = await fetch(`${base}/api/import/tickets`, {
    method: 'POST',
    headers: { Cookie: cookie, 'X-CSRF-Token': authData.csrfToken, 'Content-Type': 'text/csv; charset=utf-8' },
    body: [
      '"مُعرّف الحالة","الأولوية","الحالة","تاريخ الإنشاء","حالة SLM","الوصف","الطبقة 3 للفئة","رقم المدرسة","اسم المبنى"',
      `"CASE-MEDIUM-1","متوسط","قيد التنفيذ","${mediumCreatedAt}","ضمن المهلة","وصف متوسط","أعمال صيانة","123456","مدرسة تجريبية"`
    ].join('\n')
  });
  assert.equal(mediumImportResponse.status, 200);

  db.prepare('UPDATE tickets SET description = ?, priority = ? WHERE case_id = ?')
    .run('تنظيف أجهزة التكييف', 'حرج', 'CASE-MEDIUM-1');
  const disabledPrioritySummary = await fetch(`${base}/api/summary?period=all`, { headers: { Cookie: cookie } });
  assert.equal((await disabledPrioritySummary.json()).priorityAlertCount, 0);
  const enablePriorityMatrix = await fetch(`${base}/api/settings`, {
    method: 'PUT',
    headers: { Cookie: cookie, 'X-CSRF-Token': authData.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ priorityMatrixEnabled: true })
  });
  assert.equal(enablePriorityMatrix.status, 200);
  const enabledPrioritySummary = await fetch(`${base}/api/summary?period=all`, { headers: { Cookie: cookie } });
  const priorityAlerts = await enabledPrioritySummary.json();
  const priorityAlert = priorityAlerts.priorityAlerts.find((item) => item.case_id === 'CASE-MEDIUM-1');
  assert.equal(priorityAlert.expectedPriority, 'P4');
  assert.equal(priorityAlert.currentPriority, 'حرج');
  assert.equal(priorityAlert.alertDirection, 'over');
  assert.match(priorityAlert.reason, /صيانة خدمية بسيطة/);
  db.prepare('UPDATE tickets SET description = ?, priority = ? WHERE case_id = ?')
    .run('التماس كهربائي في غرفة الكهرباء', 'متوسط', 'CASE-MEDIUM-1');
  const underPriorityDisabledSummary = await fetch(`${base}/api/summary?period=all`, { headers: { Cookie: cookie } });
  assert.equal((await underPriorityDisabledSummary.json()).priorityAlertCount, 0);
  const enableUnderPriorityAlerts = await fetch(`${base}/api/settings`, {
    method: 'PUT',
    headers: { Cookie: cookie, 'X-CSRF-Token': authData.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ priorityUnderAlertEnabled: true })
  });
  assert.equal(enableUnderPriorityAlerts.status, 200);
  const underPriorityEnabledSummary = await fetch(`${base}/api/summary?period=all`, { headers: { Cookie: cookie } });
  const underPriorityAlert = (await underPriorityEnabledSummary.json()).priorityAlerts.find((item) => item.case_id === 'CASE-MEDIUM-1');
  assert.equal(underPriorityAlert.expectedPriority, 'P1');
  assert.equal(underPriorityAlert.alertDirection, 'under');
  const updatedPrioritySettingsResponse = await fetch(`${base}/api/settings`, { headers: { Cookie: cookie } });
  const updatedPrioritySettings = await updatedPrioritySettingsResponse.json();
  assert.equal(updatedPrioritySettings.priorityUnderAlertEnabled, true);
  const disablePriorityMatrix = await fetch(`${base}/api/settings`, {
    method: 'PUT',
    headers: { Cookie: cookie, 'X-CSRF-Token': authData.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ priorityMatrixEnabled: false })
  });
  assert.equal(disablePriorityMatrix.status, 200);
  db.prepare('UPDATE tickets SET description = ?, priority = ? WHERE case_id = ?')
    .run('وصف متوسط', 'متوسط', 'CASE-MEDIUM-1');

  const ticketsResponse = await fetch(`${base}/api/tickets?q=CASE-TEST-1`, { headers: { Cookie: cookie } });
  const tickets = await ticketsResponse.json();
  assert.equal(tickets.items.length, 1);
  assert.equal(tickets.items[0].school_number, '123456');
  assert.equal(tickets.items[0].supervisor, 'مشرف تجريبي');
  assert.ok(tickets.items[0].sla_remaining_minutes > 22 * 60 && tickets.items[0].sla_remaining_minutes <= 23 * 60);
  const ticketId = tickets.items[0].id;
  const mediumTicketsResponse = await fetch(`${base}/api/tickets?q=CASE-MEDIUM-1`, { headers: { Cookie: cookie } });
  const mediumTickets = await mediumTicketsResponse.json();
  assert.ok(mediumTickets.items[0].sla_remaining_minutes > 70 * 60 && mediumTickets.items[0].sla_remaining_minutes <= 71 * 60);
  const schoolSearch = await fetch(`${base}/api/tickets?q=${encodeURIComponent('مدرسة تجريبية')}`, { headers: { Cookie: cookie } });
  assert.equal((await schoolSearch.json()).total, 3);
  const openTicketsResponse = await fetch(`${base}/api/open-tickets`, { headers: { Cookie: cookie } });
  const openTickets = await openTicketsResponse.json();
  assert.equal(openTickets.total, 3);
  const criticalTicket = openTickets.items.find((ticket) => ticket.case_id === 'CASE-TEST-1');
  const mediumTicket = openTickets.items.find((ticket) => ticket.case_id === 'CASE-MEDIUM-1');
  assert.equal(criticalTicket.school_name, 'مدرسة تجريبية');
  assert.ok(criticalTicket.sla_remaining_minutes > 22 * 60 && criticalTicket.sla_remaining_minutes <= 23 * 60);
  assert.ok(mediumTicket.sla_remaining_minutes > 70 * 60 && mediumTicket.sla_remaining_minutes <= 71 * 60);
  assert.equal(openTickets.items.some((ticket) => ticket.case_id === 'CASE-ORPHAN-1'), false);
  assert.equal(openTickets.items.some((ticket) => ticket.case_id === 'CASE-NAME-MATCH-1'), true);
  assert.deepEqual(openTickets.filters.supervisors, ['مشرف تجريبي']);
  const breachedTicketsResponse = await fetch(`${base}/api/open-tickets?status=breached`, { headers: { Cookie: cookie } });
  assert.equal((await breachedTicketsResponse.json()).total, 1);
  const filteredOpenResponse = await fetch(`${base}/api/open-tickets?supervisor=unknown`, { headers: { Cookie: cookie } });
  assert.equal((await filteredOpenResponse.json()).total, 0);
  const regionFilteredOpenResponse = await fetch(`${base}/api/open-tickets?region=${encodeURIComponent('الرياض')}`, { headers: { Cookie: cookie } });
  const regionFilteredOpen = await regionFilteredOpenResponse.json();
  assert.equal(regionFilteredOpen.total, 3);
  assert.deepEqual(regionFilteredOpen.filters.regions, ['الرياض']);
  const regionFilteredTickets = await fetch(`${base}/api/tickets?region=${encodeURIComponent('الرياض')}`, { headers: { Cookie: cookie } });
  assert.equal((await regionFilteredTickets.json()).total, 3);
  db.prepare('UPDATE tickets SET created_at = ? WHERE case_id = ?')
    .run(new Date(Date.now() - 23.5 * 60 * 60 * 1000).toISOString(), 'CASE-TEST-1');
  const approachingSummary = await fetch(`${base}/api/summary?period=month`, { headers: { Cookie: cookie } });
  const approachingData = await approachingSummary.json();
  assert.equal(approachingData.metrics.approachingSla, 1);
  assert.equal(approachingData.approachingSlaTickets[0].case_id, 'CASE-TEST-1');
  db.prepare('UPDATE tickets SET created_at = ? WHERE case_id = ?').run(createdAt, 'CASE-TEST-1');

  const reasonResponse = await fetch(`${base}/api/tickets/${ticketId}/breach-reason`, {
    method: 'PATCH',
    headers: { Cookie: cookie, 'X-CSRF-Token': authData.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'أخرى' })
  });
  assert.equal(reasonResponse.status, 400);
  const validReasonResponse = await fetch(`${base}/api/tickets/${ticketId}/breach-reason`, {
    method: 'PATCH',
    headers: { Cookie: cookie, 'X-CSRF-Token': authData.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'تعذر دخول المدرسة' })
  });
  assert.equal(validReasonResponse.status, 200);

  const receiverUserResponse = await fetch(`${base}/api/users`, {
    method: 'POST',
    headers: { Cookie: cookie, 'X-CSRF-Token': authData.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'receiver-test', displayName: 'متلقي تجريبي', password: 'a-receiver-password-123', role: 'receiver' })
  });
  assert.equal(receiverUserResponse.status, 201);
  const receiverUserId = (await receiverUserResponse.json()).id;
  const receiverLoginSessionResponse = await fetch(`${base}/api/session`);
  const receiverLoginSession = await receiverLoginSessionResponse.json();
  const receiverLoginCookie = receiverLoginSessionResponse.headers.get('set-cookie').split(';')[0];
  const receiverLoginResponse = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { Cookie: receiverLoginCookie, 'X-CSRF-Token': receiverLoginSession.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'receiver-test', password: 'a-receiver-password-123' })
  });
  assert.equal(receiverLoginResponse.status, 200);
  const receiverAuth = await receiverLoginResponse.json();
  const receiverCookie = receiverLoginResponse.headers.get('set-cookie').split(';')[0];
  const receiverRequest = (url, options = {}) => fetch(`${base}${url}`, {
    ...options,
    headers: {
      Cookie: receiverCookie,
      ...(options.method && options.method !== 'GET' ? { 'X-CSRF-Token': receiverAuth.csrfToken } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  assert.equal((await receiverRequest(`/api/tickets/${ticketId}/breach-reason`, {
    method: 'PATCH', body: JSON.stringify({ reason: 'تعذر دخول المدرسة' })
  })).status, 403);
  assert.equal((await receiverRequest(`/api/tickets/${ticketId}`, { method: 'DELETE' })).status, 403);
  assert.equal((await receiverRequest('/api/schools/123456', { method: 'DELETE' })).status, 403);
  assert.equal((await receiverRequest('/api/schools', { method: 'DELETE' })).status, 403);
  assert.equal((await receiverRequest(`/api/users/${receiverUserId}`, {
    method: 'PATCH', body: JSON.stringify({ role: 'admin' })
  })).status, 403);
  assert.equal((await fetch(`${base}/api/users/${authData.user.id}`, {
    method: 'PATCH',
    headers: { Cookie: cookie, 'X-CSRF-Token': authData.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'viewer' })
  })).status, 400);

  const updateReceiverResponse = await fetch(`${base}/api/users/${receiverUserId}`, {
    method: 'PATCH',
    headers: { Cookie: cookie, 'X-CSRF-Token': authData.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'engineer', password: 'a-new-receiver-password-456' })
  });
  assert.equal(updateReceiverResponse.status, 200);
  assert.equal(db.prepare('SELECT role FROM users WHERE id = ?').get(receiverUserId).role, 'engineer');
  assert.equal(bcrypt.compareSync('a-new-receiver-password-456', db.prepare('SELECT password_hash FROM users WHERE id = ?').get(receiverUserId).password_hash), true);
  assert.equal((await (await fetch(`${base}/api/session`, { headers: { Cookie: receiverCookie } })).json()).user, null);
  const updatedReceiverLoginSessionResponse = await fetch(`${base}/api/session`);
  const updatedReceiverLoginSession = await updatedReceiverLoginSessionResponse.json();
  const updatedReceiverLoginCookie = updatedReceiverLoginSessionResponse.headers.get('set-cookie').split(';')[0];
  const updatedReceiverLoginResponse = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { Cookie: updatedReceiverLoginCookie, 'X-CSRF-Token': updatedReceiverLoginSession.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'receiver-test', password: 'a-new-receiver-password-456' })
  });
  assert.equal(updatedReceiverLoginResponse.status, 200);
  assert.equal((await updatedReceiverLoginResponse.json()).user.role, 'engineer');

  const resolvedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const closedCreatedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const closedImportResponse = await fetch(`${base}/api/import/tickets`, {
    method: 'POST',
    headers: { Cookie: cookie, 'X-CSRF-Token': authData.csrfToken, 'Content-Type': 'text/csv; charset=utf-8' },
    body: [
      '"مُعرّف الحالة","الأولوية","الحالة","تاريخ الإنشاء","حالة SLM","الوصف","الطبقة 3 للفئة","رقم المدرسة","اسم المبنى","تاريخ الحل"',
      `"CASE-CLOSED-1","متوسط","مغلق","${closedCreatedAt}","ضمن المهلة","وصف مغلق","أعمال صيانة","123456","مدرسة تجريبية","${resolvedAt}"`
    ].join('\n')
  });
  assert.equal(closedImportResponse.status, 200);

  const monthlySummaryResponse = await fetch(`${base}/api/summary?period=month`, { headers: { Cookie: cookie } });
  const monthlySummary = await monthlySummaryResponse.json();
  const monthlyOpenResponse = await fetch(`${base}/api/open-tickets?status=open&period=month`, { headers: { Cookie: cookie } });
  assert.equal((await monthlyOpenResponse.json()).total, monthlySummary.metrics.open);

  db.prepare('UPDATE tickets SET status = ? WHERE case_id = ?').run('ملغى يدويًا', 'CASE-MEDIUM-1');
  const cancelledSummaryResponse = await fetch(`${base}/api/summary?period=month`, { headers: { Cookie: cookie } });
  const cancelledSummary = await cancelledSummaryResponse.json();
  const cancelledOpenResponse = await fetch(`${base}/api/open-tickets?status=open&period=month`, { headers: { Cookie: cookie } });
  assert.equal((await cancelledOpenResponse.json()).total, cancelledSummary.metrics.open);
  assert.equal(cancelledSummary.metrics.open, 2);
  db.prepare('UPDATE tickets SET status = ? WHERE case_id = ?').run('قيد التنفيذ', 'CASE-MEDIUM-1');

  const summaryResponse = await fetch(`${base}/api/summary?period=all`, { headers: { Cookie: cookie } });
  const summary = await summaryResponse.json();
  assert.equal(summary.metrics.total, 4);
  assert.equal(summary.metrics.cumulative, 4);
  assert.equal(summary.metrics.breached, 1);
  assert.equal(summary.metrics.onTime, 3);
  assert.equal(summary.metrics.closed, 1);
  assert.equal(summary.metrics.missingBreachReason, 0);
  assert.equal(summary.bySupervisor[0].name, 'مشرف تجريبي');
  assert.equal(summary.bySupervisor[0].total, 4);
  assert.equal(summary.bySupervisor[0].open, 3);
  assert.equal(summary.bySupervisor[0].closed, 1);
  assert.equal(summary.bySupervisor[0].breached, 1);
  assert.equal(summary.bySupervisor[0].compliance, 75);
  assert.equal(summary.topOpenSchools[0].total, 3);
  assert.equal(summary.repeatedBySchool[0].total, 4);
  assert.equal(summary.monthlyCompliance.length, 12);
  const currentMonth = summary.monthlyCompliance.at(-1);
  assert.equal(currentMonth.total, 4);
  assert.equal(currentMonth.compliance, 75);
  assert.equal(summary.breachedByLayer[0].total, 1);
  assert.equal(summary.breachedByDay[0].total, 1);
  assert.equal(summary.supervisorPerformance[0].closed, 1);
  assert.equal(summary.supervisorPerformance[0].breached, 1);
  assert.equal(summary.supervisorPerformance[0].averageResponseMinutes, 60);
  assert.equal(summary.bestSupervisor.name, 'مشرف تجريبي');
  assert.equal(summary.metrics.overdueOpen, 0);
  assert.equal(summary.metrics.dueSoonOpen, 0);
  assert.equal(summary.metrics.missingSlaOpen, 0);

  const schoolReportResponse = await fetch(`${base}/api/schools/M-123456/report`, { headers: { Cookie: cookie } });
  assert.equal(schoolReportResponse.status, 200);
  const schoolReport = await schoolReportResponse.json();
  assert.equal(schoolReport.school.school_type, 'حكومية');
  assert.equal(schoolReport.school.building_type, 'مبنى تعليمي');
  assert.equal(schoolReport.school.occupancy_size, '350');
  assert.equal(schoolReport.metrics.total, 4);
  assert.equal(schoolReport.metrics.closed, 1);
  assert.equal(schoolReport.metrics.closureRate, 25);
  assert.equal(schoolReport.byLayer[0].total, 4);
  assert.equal(schoolReport.byHour.length, 24);
  assert.equal(schoolReport.byWeekday.length, 7);
  assert.equal(schoolReport.monthlyActivity.reduce((sum, month) => sum + month.total, 0), 4);
  const ticketDetailsResponse = await fetch(`${base}/api/tickets/${ticketId}/details`, { headers: { Cookie: cookie } });
  assert.equal(ticketDetailsResponse.status, 200);
  const ticketDetails = (await ticketDetailsResponse.json()).item;
  assert.equal(ticketDetails.school_type, 'حكومية');
  assert.equal(ticketDetails.building_type, 'مبنى تعليمي');
  assert.equal(ticketDetails.occupancy_size, '350');
  assert.equal(ticketDetails.layer3, 'أعمال صيانة');
  assert.equal(ticketDetails.relatedTickets.length, 3);
  assert.ok(ticketDetails.relatedTickets.every((related) => related.layer3 === ticketDetails.layer3));

  const updateSchoolResponse = await fetch(`${base}/api/schools/M-123456`, {
    method: 'PATCH',
    headers: { Cookie: cookie, 'X-CSRF-Token': authData.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ schoolNumber: '654321', name: 'مدرسة تجريبية مصححة', supervisor: 'مشرف مصحح', region: 'منطقة مصححة' })
  });
  assert.equal(updateSchoolResponse.status, 200);
  const correctedSchool = (await updateSchoolResponse.json()).item;
  assert.equal(correctedSchool.school_number, '654321');
  assert.equal(correctedSchool.name, 'مدرسة تجريبية مصححة');
  const schoolHistoryResponse = await fetch(`${base}/api/schools/654321/history`, { headers: { Cookie: cookie } });
  const schoolHistory = await schoolHistoryResponse.json();
  assert.ok(schoolHistory.items.some((entry) => entry.source === 'csv' && entry.changes.building_type?.after === 'مبنى تعليمي'));
  assert.ok(schoolHistory.items.some((entry) => entry.source === 'manual' && entry.changes.name?.before === 'مدرسة تجريبية'));
  const correctedTicketResponse = await fetch(`${base}/api/tickets?q=CASE-TEST-1`, { headers: { Cookie: cookie } });
  const correctedTicket = (await correctedTicketResponse.json()).items[0];
  assert.equal(correctedTicket.school_number, '123456');
  assert.equal(correctedTicket.school_name, 'مدرسة تجريبية مصححة');
  assert.equal(correctedTicket.supervisor, 'مشرف مصحح');
  assert.equal(summary.topOpenSchools[0].school_name, 'مدرسة تجريبية');
  assert.equal(summary.topOpenSchools[0].total, 3);
  assert.equal(summary.repeatedBySchool[0].school_name, 'مدرسة تجريبية');
  assert.equal(summary.repeatedBySchool[0].type, 'أعمال صيانة');
  assert.equal(summary.repeatedBySchool[0].total, 4);

  const updateSettingsResponse = await fetch(`${base}/api/settings`, {
    method: 'PUT',
    headers: { Cookie: cookie, 'X-CSRF-Token': authData.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ criticalHours: 48, mediumHours: 96 })
  });
  assert.equal(updateSettingsResponse.status, 200);
  const savedSettingsResponse = await fetch(`${base}/api/settings`, { headers: { Cookie: cookie } });
  const savedSettings = await savedSettingsResponse.json();
  assert.equal(savedSettings.criticalHours, 48);
  assert.equal(savedSettings.mediumHours, 96);
  const updatedTicketsResponse = await fetch(`${base}/api/tickets?q=CASE-TEST-1`, { headers: { Cookie: cookie } });
  const updatedTickets = await updatedTicketsResponse.json();
  assert.ok(updatedTickets.items[0].sla_remaining_minutes > 46 * 60 && updatedTickets.items[0].sla_remaining_minutes <= 47 * 60);
  const updatedMediumTicketsResponse = await fetch(`${base}/api/tickets?q=CASE-MEDIUM-1`, { headers: { Cookie: cookie } });
  const updatedMediumTickets = await updatedMediumTicketsResponse.json();
  assert.ok(updatedMediumTickets.items[0].sla_remaining_minutes > 94 * 60 && updatedMediumTickets.items[0].sla_remaining_minutes <= 95 * 60);
  const invalidSettingsResponse = await fetch(`${base}/api/settings`, {
    method: 'PUT',
    headers: { Cookie: cookie, 'X-CSRF-Token': authData.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ criticalHours: 0 })
  });
  assert.equal(invalidSettingsResponse.status, 400);

  db.prepare('UPDATE tickets SET created_at = ? WHERE case_id = ?')
    .run(new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(), 'CASE-MEDIUM-1');
  const weeklySummaryResponse = await fetch(`${base}/api/summary?period=week`, { headers: { Cookie: cookie } });
  assert.equal((await weeklySummaryResponse.json()).metrics.total, 3);
  const weeklyOpenResponse = await fetch(`${base}/api/open-tickets?status=open&period=week`, { headers: { Cookie: cookie } });
  assert.equal((await weeklyOpenResponse.json()).total, 2);

  const invalidCurrentPassword = await fetch(`${base}/api/account`, {
    method: 'PUT',
    headers: { Cookie: cookie, 'X-CSRF-Token': authData.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin-test', displayName: 'مدير تجريبي', currentPassword: 'wrong-password', newPassword: '' })
  });
  assert.equal(invalidCurrentPassword.status, 403);
  const accountResponse = await fetch(`${base}/api/account`, {
    method: 'PUT',
    headers: { Cookie: cookie, 'X-CSRF-Token': authData.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin-renamed', displayName: 'مدير محدث', currentPassword: 'a-strong-password-123', newPassword: 'a-new-strong-password-456' })
  });
  assert.equal(accountResponse.status, 200);
  const accountData = await accountResponse.json();
  assert.equal(accountData.user.username, 'admin-renamed');
  assert.equal(accountData.user.displayName, 'مدير محدث');
  cookie = accountResponse.headers.get('set-cookie').split(';')[0];
  const updatedSessionResponse = await fetch(`${base}/api/session`, { headers: { Cookie: cookie } });
  const updatedSessionData = await updatedSessionResponse.json();
  assert.equal(updatedSessionData.user.displayName, 'مدير محدث');
  const loginSessionResponse = await fetch(`${base}/api/session`);
  const loginSession = await loginSessionResponse.json();
  const loginCookie = loginSessionResponse.headers.get('set-cookie').split(';')[0];
  const updatedLoginResponse = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { Cookie: loginCookie, 'X-CSRF-Token': loginSession.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin-renamed', password: 'a-new-strong-password-456' })
  });
  assert.equal(updatedLoginResponse.status, 200);

  const nativeFetch = global.fetch;
  const schoolSheetCsv = [
    'ID,اسم الموقع,الرقم الوزاري,العنوان,زون,مجموعة,خط العرض,خط الطول,المسئول,رقم الجوال,مشرف الشركة,رقم الجوال,مهندس الشركة,رقم الجوال,نوع الملكية,نوع المبني,الحالة,maintenance,stage,gender,فصول تعليمية,occupancy_size,study_time,المبنى الملحق',
    '10753,مدرسة تجريبية مصححة,777888,منطقة الرياض,G2-Z6,1,24.74895617,46.63827736,مسؤول المدرسة,500000001,مشرف الشيت,500000002,مهندس المنطقة,500000003,مستقل,كبير,مستخدم,تشغيل وصيانة,المتوسطة,بنين,12,كبير,صباح,ملحق'
  ].join('\n');
  global.fetch = (input, options) => String(input).startsWith(base)
    ? nativeFetch(input, options)
    : Promise.resolve(new Response(schoolSheetCsv, { status: 200 }));
  try {
    const syncResponse = await nativeFetch(`${base}/api/schools/sync`, {
      method: 'POST',
      headers: { Cookie: cookie, 'X-CSRF-Token': updatedSessionData.csrfToken, 'Content-Type': 'application/json' },
      body: '{}'
    });
    assert.equal(syncResponse.status, 200);
    const syncResult = await syncResponse.json();
    assert.equal(syncResult.imported, 1);
    assert.equal(syncResult.renumbered, 1);
    const renumberedSchool = db.prepare('SELECT * FROM schools WHERE school_number = ?').get('777888');
    assert.equal(renumberedSchool.name, 'مدرسة تجريبية مصححة');
    assert.equal(renumberedSchool.supervisor, 'مشرف الشيت');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schools').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM tickets WHERE matched_school_number = ? AND school_match_override = 1').get('777888').count, 4);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM school_change_log WHERE school_number = ?').get('777888').count > 0, true);
    const schoolDetailsResponse = await nativeFetch(`${base}/api/schools/777888`, { headers: { Cookie: cookie } });
    assert.equal(schoolDetailsResponse.status, 200);
    const schoolDetails = (await schoolDetailsResponse.json()).item;
    assert.equal(schoolDetails.source_data.length, 24);
    assert.equal(schoolDetails.source_data[0].label, 'معرّف السجل');
    assert.ok(schoolDetails.source_data.some((field) => field.label === 'خط العرض' && field.value === '24.74895617'));
    assert.ok(schoolDetails.source_data.some((field) => field.label === 'الصيانة' && field.value === 'تشغيل وصيانة'));

    const addSchoolResponse = await nativeFetch(`${base}/api/schools`, {
      method: 'POST',
      headers: { Cookie: cookie, 'X-CSRF-Token': updatedSessionData.csrfToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolNumber: '888999', name: 'مدرسة تجريبية مصححة', region: 'الرياض' })
    });
    assert.equal(addSchoolResponse.status, 201);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schools').get().count, 2);

    global.fetch = (input, options) => String(input).startsWith(base)
      ? nativeFetch(input, options)
      : Promise.resolve(new Response([
        'رقم المدرسة,اسم المدرسة,المشرف المسؤول',
        '999000,مدرسة تجريبية مصححة,مشرف الشيت'
      ].join('\n'), { status: 200 }));
    const ambiguousSyncResponse = await nativeFetch(`${base}/api/schools/sync`, {
      method: 'POST',
      headers: { Cookie: cookie, 'X-CSRF-Token': updatedSessionData.csrfToken, 'Content-Type': 'application/json' },
      body: '{}'
    });
    assert.equal(ambiguousSyncResponse.status, 200);
    assert.equal((await ambiguousSyncResponse.json()).renumbered, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schools').get().count, 3);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schools WHERE school_number IN (?, ?)').get('777888', '888999').count, 2);

    const duplicateSchoolResponse = await nativeFetch(`${base}/api/schools`, {
      method: 'POST',
      headers: { Cookie: cookie, 'X-CSRF-Token': updatedSessionData.csrfToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolNumber: '888999', name: 'نسخة مكررة' })
    });
    assert.equal(duplicateSchoolResponse.status, 409);

    const deleteTargetResponse = await nativeFetch(`${base}/api/schools`, {
      method: 'POST',
      headers: { Cookie: cookie, 'X-CSRF-Token': updatedSessionData.csrfToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolNumber: '111222', name: 'مدرسة مضافة للاختبار' })
    });
    assert.equal(deleteTargetResponse.status, 201);

    const deleteSchoolResponse = await nativeFetch(`${base}/api/schools/111222`, {
      method: 'DELETE',
      headers: { Cookie: cookie, 'X-CSRF-Token': updatedSessionData.csrfToken }
    });
    assert.equal(deleteSchoolResponse.status, 200);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schools WHERE school_number = ?').get('111222').count, 0);

    const ticketCountBeforeDeleteAll = db.prepare('SELECT COUNT(*) AS count FROM tickets').get().count;
    const deleteAllResponse = await nativeFetch(`${base}/api/schools`, {
      method: 'DELETE',
      headers: { Cookie: cookie, 'X-CSRF-Token': updatedSessionData.csrfToken }
    });
    assert.equal(deleteAllResponse.status, 200);
    assert.equal((await deleteAllResponse.json()).deleted, 3);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schools').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM tickets').get().count, ticketCountBeforeDeleteAll);
    assert.ok(db.prepare('SELECT COUNT(*) AS count FROM school_change_log').get().count > 0);
  } finally {
    global.fetch = nativeFetch;
  }
});

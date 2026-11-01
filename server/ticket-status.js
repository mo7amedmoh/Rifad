function isBreached(ticket) {
  return /تم اختراقه|مخترق|breached|violated/i.test(ticket.slm_status || '');
}

function isClosed(ticket) {
  return /مغلق|تم حل|محلول|closed|resolved/i.test(ticket.status || '');
}

function isCancelled(ticket) {
  return /ملغى|ملغي|cancelled|canceled/i.test((ticket.status || '').trim());
}

function isOpen(ticket) {
  return !isClosed(ticket) && !isCancelled(ticket);
}

function calculateCompliance(tickets, { closedOnly = false, denominatorAll = false } = {}) {
  const eligible = tickets.filter((ticket) => !isCancelled(ticket));
  const numeratorTickets = eligible.filter((ticket) => !closedOnly || isClosed(ticket));
  const denominator = denominatorAll ? eligible.length : numeratorTickets.length;
  const onTime = numeratorTickets.filter((ticket) => !isBreached(ticket)).length;
  return {
    reports: onTime,
    denominator,
    ratio: denominator ? onTime / denominator : 0,
    achievedPct: denominator ? Math.round((onTime / denominator) * 1000) / 10 : 0
  };
}

module.exports = { isBreached, isClosed, isCancelled, isOpen, calculateCompliance };

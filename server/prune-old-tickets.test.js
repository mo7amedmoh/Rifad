const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { isValidCutoff, pruneTickets } = require('./prune-old-tickets');

test('validates month-start cutoff dates', () => {
  assert.equal(isValidCutoff('2026-07-01'), true);
  assert.equal(isValidCutoff('2026-07-02'), false);
  assert.equal(isValidCutoff('2026-13-01'), false);
});

test('deletes only tickets before the cutoff and cascades ticket history', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rifad-prune-'));
  const databasePath = path.join(directory, 'test.sqlite');
  const db = new DatabaseSync(databasePath);
  db.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE tickets (id INTEGER PRIMARY KEY, created_at TEXT);
    CREATE TABLE ticket_history (
      id INTEGER PRIMARY KEY,
      ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE
    );
    INSERT INTO tickets (id, created_at) VALUES
      (1, '2026-04-15T12:00:00.000Z'),
      (2, '2026-06-30T23:59:59.000Z'),
      (3, '2026-07-01T00:00:00.000Z'),
      (4, NULL);
    INSERT INTO ticket_history (ticket_id) VALUES (1), (2), (3);`);
  db.close();

  assert.throws(() => pruneTickets({
    databasePath, cutoffDate: '2026-07-01', confirmed: false
  }), /الحذف نهائي/);
  assert.equal(pruneTickets({ databasePath, cutoffDate: '2026-07-01', confirmed: true }), 2);

  const result = new DatabaseSync(databasePath);
  assert.deepEqual(result.prepare('SELECT id FROM tickets ORDER BY id').all().map((row) => ({ ...row })), [
    { id: 3 },
    { id: 4 }
  ]);
  assert.deepEqual(result.prepare('SELECT ticket_id FROM ticket_history').all().map((row) => ({ ...row })), [
    { ticket_id: 3 }
  ]);
  result.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

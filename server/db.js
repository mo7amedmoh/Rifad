const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const databasePath = path.resolve(process.env.DATABASE_PATH || './data/rifad.sqlite');
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new DatabaseSync(databasePath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
db.transaction = (callback) => (...args) => {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = callback(...args);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
};
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','receiver','engineer','viewer')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS schools (
    school_number TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    supervisor TEXT NOT NULL DEFAULT '',
    region TEXT NOT NULL DEFAULT '',
    school_type TEXT NOT NULL DEFAULT '',
    building_type TEXT NOT NULL DEFAULT '',
    occupancy_size TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY,
    case_id TEXT NOT NULL UNIQUE,
    priority TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '',
    created_at TEXT,
    slm_status TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    layer2 TEXT NOT NULL DEFAULT '',
    layer3 TEXT NOT NULL DEFAULT '',
    school_number TEXT NOT NULL DEFAULT '',
    building_name TEXT NOT NULL DEFAULT '',
    resolved_at TEXT,
    sla_due_at TEXT,
    sla_remaining_minutes REAL,
    needs_attention INTEGER NOT NULL DEFAULT 0,
    breach_reason TEXT NOT NULL DEFAULT '',
    breach_note TEXT NOT NULL DEFAULT '',
    deleted_at TEXT,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_tickets_created ON tickets(created_at);
  CREATE INDEX IF NOT EXISTS idx_tickets_open ON tickets(deleted_at, status);
  CREATE INDEX IF NOT EXISTS idx_tickets_school ON tickets(school_number);
  CREATE TABLE IF NOT EXISTS import_runs (
    id INTEGER PRIMARY KEY,
    imported_by INTEGER REFERENCES users(id),
    filename TEXT NOT NULL,
    total_rows INTEGER NOT NULL,
    inserted_rows INTEGER NOT NULL,
    updated_rows INTEGER NOT NULL,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS school_change_log (
    id INTEGER PRIMARY KEY,
    school_number TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id),
    source TEXT NOT NULL,
    changes TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_school_change_log_school ON school_change_log(school_number, id DESC);
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expire INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expire);
`);

const ticketColumns = db.prepare('PRAGMA table_info(tickets)').all().map((column) => column.name);
if (!ticketColumns.includes('matched_school_number')) db.exec('ALTER TABLE tickets ADD COLUMN matched_school_number TEXT');
if (!ticketColumns.includes('school_match_override')) db.exec('ALTER TABLE tickets ADD COLUMN school_match_override INTEGER NOT NULL DEFAULT 0');
const schoolColumns = db.prepare('PRAGMA table_info(schools)').all().map((column) => column.name);
if (!schoolColumns.includes('school_type')) db.exec("ALTER TABLE schools ADD COLUMN school_type TEXT NOT NULL DEFAULT ''");
if (!schoolColumns.includes('building_type')) db.exec("ALTER TABLE schools ADD COLUMN building_type TEXT NOT NULL DEFAULT ''");
if (!schoolColumns.includes('occupancy_size')) db.exec("ALTER TABLE schools ADD COLUMN occupancy_size TEXT NOT NULL DEFAULT ''");

module.exports = db;

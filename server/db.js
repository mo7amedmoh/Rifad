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
    elevator_contractor TEXT NOT NULL DEFAULT '',
    counts_in_kpi INTEGER NOT NULL DEFAULT 0,
    has_elevator INTEGER NOT NULL DEFAULT 0,
    parent_school_id TEXT,
    source_data TEXT NOT NULL DEFAULT '[]',
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
    excluded_from_kpi INTEGER NOT NULL DEFAULT 0,
    exclusion_reason TEXT NOT NULL DEFAULT '',
    kpi_override TEXT,
    deleted_at TEXT,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_tickets_created ON tickets(created_at);
  CREATE INDEX IF NOT EXISTS idx_tickets_open ON tickets(deleted_at, status);
  CREATE INDEX IF NOT EXISTS idx_tickets_school ON tickets(school_number);
  CREATE TABLE IF NOT EXISTS ticket_history (
    id INTEGER PRIMARY KEY,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    source TEXT NOT NULL,
    reference TEXT NOT NULL DEFAULT '',
    changes TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_ticket_history_ticket ON ticket_history(ticket_id, id DESC);
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
  CREATE TABLE IF NOT EXISTS attached_override (
    attached_school_number TEXT PRIMARY KEY,
    parent_school_number TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS kpis (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('CM','OM','HS','SS')),
    source TEXT NOT NULL CHECK (source IN ('auto','manual')),
    target REAL NOT NULL DEFAULT 100 CHECK (target > 0),
    importance TEXT NOT NULL DEFAULT 'medium'
  );
  CREATE TABLE IF NOT EXISTS category_weights (
    category TEXT PRIMARY KEY CHECK (category IN ('CM','OM','HS','SS')),
    weight REAL NOT NULL CHECK (weight >= 0)
  );
  CREATE TABLE IF NOT EXISTS payout_table (
    period TEXT NOT NULL,
    band TEXT NOT NULL,
    percentage REAL CHECK (percentage >= 0 AND percentage <= 100),
    PRIMARY KEY (period, band)
  );
  CREATE TABLE IF NOT EXISTS fines (
    id INTEGER PRIMARY KEY,
    kpi_code TEXT NOT NULL REFERENCES kpis(code) ON UPDATE CASCADE ON DELETE CASCADE,
    description TEXT NOT NULL,
    value REAL NOT NULL CHECK (value >= 0),
    unit TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS hs_systems (
    kpi_code TEXT PRIMARY KEY REFERENCES kpis(code) ON UPDATE CASCADE ON DELETE CASCADE,
    name TEXT NOT NULL,
    orders_per_school REAL NOT NULL CHECK (orders_per_school >= 0),
    school_filter TEXT NOT NULL CHECK (school_filter IN ('all','has_elevator'))
  );
  CREATE TABLE IF NOT EXISTS category_map (
    layer3 TEXT PRIMARY KEY,
    kpi_code TEXT REFERENCES kpis(code) ON UPDATE CASCADE ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS water_keywords (
    keyword TEXT PRIMARY KEY
  );
  CREATE TABLE IF NOT EXISTS kpi_results (
    month TEXT NOT NULL,
    kpi_code TEXT NOT NULL REFERENCES kpis(code) ON UPDATE CASCADE ON DELETE CASCADE,
    achieved_pct REAL NOT NULL CHECK (achieved_pct >= 0 AND achieved_pct <= 100),
    fine_count INTEGER NOT NULL DEFAULT 0 CHECK (fine_count >= 0),
    PRIMARY KEY (month, kpi_code)
  );
  CREATE INDEX IF NOT EXISTS idx_kpi_results_month ON kpi_results(month);
  CREATE TABLE IF NOT EXISTS report_manual_sections (
    month TEXT NOT NULL,
    section_key TEXT NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (month, section_key)
  );
  CREATE TABLE IF NOT EXISTS report_snapshots (
    id INTEGER PRIMARY KEY,
    month TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER REFERENCES users(id),
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_report_snapshots_month ON report_snapshots(month, id DESC);
`);

const ticketColumns = db.prepare('PRAGMA table_info(tickets)').all().map((column) => column.name);
if (!ticketColumns.includes('matched_school_number')) db.exec('ALTER TABLE tickets ADD COLUMN matched_school_number TEXT');
if (!ticketColumns.includes('school_match_override')) db.exec('ALTER TABLE tickets ADD COLUMN school_match_override INTEGER NOT NULL DEFAULT 0');
if (!ticketColumns.includes('excluded_from_kpi')) db.exec('ALTER TABLE tickets ADD COLUMN excluded_from_kpi INTEGER NOT NULL DEFAULT 0');
if (!ticketColumns.includes('exclusion_reason')) db.exec("ALTER TABLE tickets ADD COLUMN exclusion_reason TEXT NOT NULL DEFAULT ''");
if (!ticketColumns.includes('kpi_override')) db.exec('ALTER TABLE tickets ADD COLUMN kpi_override TEXT');
const schoolColumns = db.prepare('PRAGMA table_info(schools)').all().map((column) => column.name);
if (!schoolColumns.includes('school_type')) db.exec("ALTER TABLE schools ADD COLUMN school_type TEXT NOT NULL DEFAULT ''");
if (!schoolColumns.includes('building_type')) db.exec("ALTER TABLE schools ADD COLUMN building_type TEXT NOT NULL DEFAULT ''");
if (!schoolColumns.includes('occupancy_size')) db.exec("ALTER TABLE schools ADD COLUMN occupancy_size TEXT NOT NULL DEFAULT ''");
if (!schoolColumns.includes('source_data')) db.exec("ALTER TABLE schools ADD COLUMN source_data TEXT NOT NULL DEFAULT '[]'");
if (!schoolColumns.includes('elevator_contractor')) db.exec("ALTER TABLE schools ADD COLUMN elevator_contractor TEXT NOT NULL DEFAULT ''");
if (!schoolColumns.includes('counts_in_kpi')) db.exec('ALTER TABLE schools ADD COLUMN counts_in_kpi INTEGER NOT NULL DEFAULT 0');
if (!schoolColumns.includes('has_elevator')) db.exec('ALTER TABLE schools ADD COLUMN has_elevator INTEGER NOT NULL DEFAULT 0');
if (!schoolColumns.includes('parent_school_id')) db.exec('ALTER TABLE schools ADD COLUMN parent_school_id TEXT');

const {
  KPI_DEFAULTS, CATEGORY_WEIGHTS, HS_SYSTEM_DEFAULTS, CATEGORY_MAP_DEFAULTS,
  PAYOUT_PERIODS, PAYOUT_BANDS, PAYOUT_7_PLUS, WATER_KEYWORDS
} = require('./contract-kpis');
const seedKpi = db.prepare(`INSERT OR IGNORE INTO kpis (code, name, category, source, target, importance)
  VALUES (?, ?, ?, ?, ?, ?)`);
for (const kpi of KPI_DEFAULTS) seedKpi.run(kpi.code, kpi.name, kpi.category, kpi.source, kpi.target, kpi.importance);
const seedWeight = db.prepare('INSERT OR IGNORE INTO category_weights (category, weight) VALUES (?, ?)');
for (const [category, weight] of Object.entries(CATEGORY_WEIGHTS)) seedWeight.run(category, weight);
const seedSystem = db.prepare(`INSERT OR IGNORE INTO hs_systems (kpi_code, name, orders_per_school, school_filter)
  VALUES (?, ?, ?, ?)`);
for (const item of HS_SYSTEM_DEFAULTS) seedSystem.run(item.kpiCode, item.name, item.ordersPerSchool, item.schoolFilter);
const seedMap = db.prepare('INSERT OR IGNORE INTO category_map (layer3, kpi_code) VALUES (?, ?)');
for (const item of CATEGORY_MAP_DEFAULTS) seedMap.run(item.layer3, item.kpiCode);
const seedKeyword = db.prepare('INSERT OR IGNORE INTO water_keywords (keyword) VALUES (?)');
for (const keyword of WATER_KEYWORDS) seedKeyword.run(keyword);
const seedPayout = db.prepare('INSERT OR IGNORE INTO payout_table (period, band, percentage) VALUES (?, ?, ?)');
for (const period of PAYOUT_PERIODS) {
  PAYOUT_BANDS.forEach((band, index) => {
    seedPayout.run(period, band.key, period === '7+' ? PAYOUT_7_PLUS[index] : null);
  });
}
const seedSetting = db.prepare('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)');
seedSetting.run('contract_start_date', '2026-07-01');
seedSetting.run('accountability_start', '2026-10-01');
seedSetting.run('monthly_invoice_value', '0');

module.exports = db;

import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_FILE = join(__dirname, '../../prospect.db');

export const db = new Database(DB_FILE);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id                 TEXT PRIMARY KEY,
      name               TEXT NOT NULL,
      vertical           TEXT,
      subsector          TEXT,
      priority_tier      TEXT,
      score_interest     INTEGER NOT NULL DEFAULT 3,
      score_fit          INTEGER NOT NULL DEFAULT 3,
      score_access       INTEGER NOT NULL DEFAULT 3,
      score_timing       INTEGER NOT NULL DEFAULT 3,
      notes              TEXT,
      status             TEXT,
      research           TEXT,
      last_research_date TEXT
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      company_id  TEXT REFERENCES companies(id) ON DELETE SET NULL,
      title       TEXT,
      warmth      INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS outreach (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id  TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      date        TEXT NOT NULL,
      type        TEXT NOT NULL,
      notes       TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_contacts_company_id ON contacts(company_id);
    CREATE INDEX IF NOT EXISTS idx_outreach_contact_id ON outreach(contact_id);
    CREATE INDEX IF NOT EXISTS idx_outreach_company_id ON outreach(company_id);

    CREATE TABLE IF NOT EXISTS job_postings (
      id            TEXT PRIMARY KEY,
      company_id    TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      greenhouse_id INTEGER NOT NULL,
      title         TEXT NOT NULL,
      location      TEXT,
      departments   TEXT,
      url           TEXT,
      status        TEXT NOT NULL DEFAULT 'active',
      is_new        INTEGER NOT NULL DEFAULT 0,
      first_seen_at      TEXT NOT NULL,
      last_seen_at       TEXT NOT NULL,
      closed_at          TEXT,
      gh_first_published TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_job_postings_company_id ON job_postings(company_id);
    CREATE INDEX IF NOT EXISTS idx_job_postings_is_new ON job_postings(is_new);

    CREATE TABLE IF NOT EXISTS fetch_runs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      run_at          TEXT NOT NULL DEFAULT (datetime('now')),
      companies_count INTEGER,
      jobs_found      INTEGER,
      new_jobs        INTEGER,
      closed_jobs     INTEGER
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS saved_searches (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      filters    TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS applications (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      job_posting_id  TEXT REFERENCES job_postings(id) ON DELETE SET NULL,
      company_id      TEXT REFERENCES companies(id) ON DELETE SET NULL,
      company_name    TEXT NOT NULL,
      role_title      TEXT NOT NULL,
      role_id         TEXT,
      date_applied    TEXT,
      referral        INTEGER NOT NULL DEFAULT 0,
      stage           TEXT NOT NULL DEFAULT 'Drafting',
      notes           TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_applications_job_posting_id ON applications(job_posting_id);
    CREATE INDEX IF NOT EXISTS idx_applications_company_id ON applications(company_id);
  `);

  // Add greenhouse_slug column to companies if it doesn't exist yet
  try {
    db.exec(`ALTER TABLE companies ADD COLUMN greenhouse_slug TEXT`);
  } catch {
    // Column already exists — safe to ignore
  }

  // Add gh_first_published column to job_postings if it doesn't exist yet
  try {
    db.exec(`ALTER TABLE job_postings ADD COLUMN gh_first_published TEXT`);
  } catch {
    // Column already exists — safe to ignore
  }

  // Add new contact fields
  for (const col of [
    `ALTER TABLE contacts ADD COLUMN status TEXT NOT NULL DEFAULT 'Active'`,
    `ALTER TABLE contacts ADD COLUMN next_action TEXT`,
    `ALTER TABLE contacts ADD COLUMN next_touch TEXT`,
  ]) {
    try { db.exec(col); } catch { /* already exists */ }
  }

  // Add new outreach fields
  for (const col of [
    `ALTER TABLE outreach ADD COLUMN action TEXT`,
    `ALTER TABLE outreach ADD COLUMN result TEXT`,
  ]) {
    try { db.exec(col); } catch { /* already exists */ }
  }

  // Make outreach.company_id nullable (contacts may not belong to a prospect company)
  // SQLite requires recreating the table to change a NOT NULL constraint.
  const outreachCols = db.pragma('table_info(outreach)');
  const companyIdCol = outreachCols.find((c) => c.name === 'company_id');
  if (companyIdCol?.notnull === 1) {
    db.exec(`
      CREATE TABLE outreach_new (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        contact_id  TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        company_id  TEXT REFERENCES companies(id) ON DELETE SET NULL,
        date        TEXT NOT NULL,
        type        TEXT NOT NULL DEFAULT '',
        action      TEXT,
        result      TEXT,
        notes       TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO outreach_new (id, contact_id, company_id, date, type, action, result, notes, created_at)
        SELECT id, contact_id, company_id, date, type, action, result, notes, created_at FROM outreach;
      DROP TABLE outreach;
      ALTER TABLE outreach_new RENAME TO outreach;
      CREATE INDEX IF NOT EXISTS idx_outreach_contact_id ON outreach(contact_id);
      CREATE INDEX IF NOT EXISTS idx_outreach_company_id ON outreach(company_id);
    `);
    console.log('[DB] Migrated outreach.company_id to nullable');
  }

  // Seed default fetch schedule if not set
  const scheduleExists = db.prepare("SELECT 1 FROM settings WHERE key = 'fetch_schedule'").get();
  if (!scheduleExists) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('fetch_schedule', ?)")
      .run(JSON.stringify({ frequency: 'daily', hour: 8, minute: 0, timezone: 'America/Los_Angeles' }));
  } else {
    // Patch existing rows that predate the timezone field
    const row = db.prepare("SELECT value FROM settings WHERE key = 'fetch_schedule'").get();
    const val = JSON.parse(row.value);
    if (!val.timezone) {
      val.timezone = 'America/Los_Angeles';
      db.prepare("UPDATE settings SET value = ? WHERE key = 'fetch_schedule'").run(JSON.stringify(val));
    }
  }

  // Seed known Greenhouse slugs
  const slugMap = [
    ['Adyen',      'adyen'],
    ['Block',      'block'],
    ['Brex',       'brex'],
    ['Duolingo',   'duolingo'],
    ['Okta',       'okta'],
    ['Ramp',       'rampnetwork'],
    ['Smartsheet', 'smartsheet'],
    ['SoFi',       'sofi'],
    ['Stripe',     'stripe'],
  ];
  const updateSlug = db.prepare(
    "UPDATE companies SET greenhouse_slug = ? WHERE name = ? AND greenhouse_slug IS NULL"
  );
  for (const [name, slug] of slugMap) {
    updateSlug.run(slug, name);
  }
}

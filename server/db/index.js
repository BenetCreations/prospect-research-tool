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
  `);
}

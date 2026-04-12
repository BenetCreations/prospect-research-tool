/**
 * One-time seed script: imports contacts and outreach from CSV files in /seed_data/.
 *
 * Usage:
 *   node server/db/seed_csv.js
 *
 * Edit FILE NAMES and COLUMN MAPPINGS below to match your actual CSV files.
 */

import { createReadStream } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

// ─── FILE NAMES ───────────────────────────────────────────────────────────────
const CONTACTS_FILE = 'seed_data/job_search_os_v5_contacts.csv';
const OUTREACH_FILE = 'seed_data/job_search_os_v5_outreach.csv';

// ─── COLUMN MAPPINGS ──────────────────────────────────────────────────────────
// Keys are internal field names; values are the exact column header in the CSV.
// Set value to null to skip that field.

const CONTACTS_MAP = {
  id:         'Contact ID',   // optional — auto-generated if missing/empty
  name:       'Name',         // REQUIRED
  company:    'Company',
  title:      'Title',
  warmth:     'Warmth',       // Accepts: 1-4 or Cold/Warm/Hot/Strong
  status:     'Status',       // Active | Parked | Closed
  nextAction: 'Next Action',
  nextTouch:  'Next Date',    // date column in your contacts sheet
};

const OUTREACH_MAP = {
  date:        'Date',        // REQUIRED
  contactName: 'Contact',     // REQUIRED — matched by name against contacts table
  company:     'Company',     // used to look up company_id if contact has none
  notes:       'Notes',
  action:      'Action',
  result:      'Result',
};
// ─────────────────────────────────────────────────────────────────────────────

const WARMTH_LABELS = { cold: 1, warm: 2, hot: 3, strong: 4 };

function parseWarmth(raw) {
  if (!raw) return 1;
  const n = Number(raw);
  if (!isNaN(n) && n >= 1 && n <= 4) return n;
  return WARMTH_LABELS[String(raw).toLowerCase().trim()] ?? 1;
}

function formatDate(raw) {
  if (!raw) return null;
  // Try to parse and normalize to YYYY-MM-DD
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return raw.trim();
}

async function parseCsv(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    const rl = readline.createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
    let headers = null;

    rl.on('line', (line) => {
      if (!line.trim()) return;
      // Simple CSV parser — handles quoted fields with commas
      const fields = [];
      let cur = '';
      let inQuote = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
          else inQuote = !inQuote;
        } else if (ch === ',' && !inQuote) {
          fields.push(cur.trim());
          cur = '';
        } else {
          cur += ch;
        }
      }
      fields.push(cur.trim());

      if (!headers) {
        headers = fields;
      } else {
        const row = {};
        headers.forEach((h, i) => { row[h] = fields[i] ?? ''; });
        rows.push(row);
      }
    });

    rl.on('close', () => resolve(rows));
    rl.on('error', reject);
  });
}

async function seedContacts(db) {
  const filePath = join(ROOT, CONTACTS_FILE);
  let rows;
  try {
    rows = await parseCsv(filePath);
  } catch (e) {
    console.log(`  [contacts] Skipping — could not read ${filePath}: ${e.message}`);
    return;
  }

  const companyRows = db.prepare('SELECT id, name FROM companies').all();
  const nameToCompanyId = new Map(companyRows.map((c) => [c.name.toLowerCase(), c.id]));

  const upsert = db.prepare(`
    INSERT INTO contacts (id, name, company_id, title, warmth, status, next_action, next_touch)
    VALUES (@id, @name, @companyId, @title, @warmth, @status, @nextAction, @nextTouch)
    ON CONFLICT(id) DO UPDATE SET
      name       = excluded.name,
      company_id = excluded.company_id,
      title      = excluded.title,
      warmth     = excluded.warmth,
      status     = excluded.status,
      next_action = excluded.next_action,
      next_touch = excluded.next_touch
  `);

  const doSeed = db.transaction(() => {
    let count = 0;
    rows.forEach((row, i) => {
      const name = CONTACTS_MAP.name ? (row[CONTACTS_MAP.name] ?? '').trim() : '';
      if (!name) return;

      const companyRaw = CONTACTS_MAP.company ? (row[CONTACTS_MAP.company] ?? '').trim() : '';
      const companyId = companyRaw ? (nameToCompanyId.get(companyRaw.toLowerCase()) ?? null) : null;

      const idRaw = CONTACTS_MAP.id ? (row[CONTACTS_MAP.id] ?? '').trim() : '';
      const id = idRaw || ('P' + Date.now() + i);

      upsert.run({
        id,
        name,
        companyId,
        title:      CONTACTS_MAP.title      ? (row[CONTACTS_MAP.title]      ?? null) : null,
        warmth:     parseWarmth(CONTACTS_MAP.warmth ? row[CONTACTS_MAP.warmth] : null),
        status:     CONTACTS_MAP.status     ? (row[CONTACTS_MAP.status]     || 'Active') : 'Active',
        nextAction: CONTACTS_MAP.nextAction ? (row[CONTACTS_MAP.nextAction] ?? null) : null,
        nextTouch:  CONTACTS_MAP.nextTouch  ? formatDate(row[CONTACTS_MAP.nextTouch]) : null,
      });
      count++;
    });
    return count;
  });

  const count = doSeed();
  console.log(`  [contacts] Imported ${count} rows`);
}

async function seedOutreach(db) {
  const filePath = join(ROOT, OUTREACH_FILE);
  let rows;
  try {
    rows = await parseCsv(filePath);
  } catch (e) {
    console.log(`  [outreach] Skipping — could not read ${filePath}: ${e.message}`);
    return;
  }

  // Clear existing outreach so re-running this script is safe
  const cleared = db.prepare('DELETE FROM outreach').run();
  if (cleared.changes) console.log(`  [outreach] Cleared ${cleared.changes} existing rows before re-seeding`);

  const contactRows = db.prepare('SELECT id, name, company_id FROM contacts').all();
  const nameToContact = new Map(contactRows.map((c) => [c.name.toLowerCase(), c]));

  const companyRows = db.prepare('SELECT id, name FROM companies').all();
  const nameToCompanyId = new Map(companyRows.map((c) => [c.name.toLowerCase(), c.id]));

  const insert = db.prepare(`
    INSERT INTO outreach (contact_id, company_id, date, type, action, notes, result)
    VALUES (@contactId, @companyId, @date, @action, @action, @notes, @result)
  `);

  const doSeed = db.transaction(() => {
    let count = 0, skipped = 0;
    rows.forEach((row) => {
      const dateRaw = OUTREACH_MAP.date ? row[OUTREACH_MAP.date] : null;
      const date = formatDate(dateRaw);
      if (!date) {
        console.log(`  [outreach] Missing/unparseable date "${dateRaw}" — skipping row`);
        skipped++;
        return;
      }

      const contactRaw = OUTREACH_MAP.contactName ? (row[OUTREACH_MAP.contactName] ?? '').trim() : '';
      const contact = nameToContact.get(contactRaw.toLowerCase());
      if (!contact) {
        console.log(`  [outreach] No contact match for "${contactRaw}" — skipping row`);
        skipped++;
        return;
      }

      // company_id: prefer contact's own, fall back to CSV Company column lookup
      let companyId = contact.company_id ?? null;
      if (!companyId && OUTREACH_MAP.company) {
        const companyRaw = (row[OUTREACH_MAP.company] ?? '').trim();
        companyId = nameToCompanyId.get(companyRaw.toLowerCase()) ?? null;
      }

      insert.run({
        contactId: contact.id,
        companyId,
        date,
        action:  OUTREACH_MAP.action ? (row[OUTREACH_MAP.action] ?? null) : null,
        notes:   OUTREACH_MAP.notes  ? (row[OUTREACH_MAP.notes]  ?? null) : null,
        result:  OUTREACH_MAP.result ? (row[OUTREACH_MAP.result]  ?? null) : null,
      });
      count++;
    });
    if (skipped) console.log(`  [outreach] Skipped ${skipped} rows total`);
    return count;
  });

  const count = doSeed();
  console.log(`  [outreach] Imported ${count} rows`);
}

async function main() {
  const db = new Database(join(ROOT, 'prospect.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  console.log('Seeding from seed_data/...');
  await seedContacts(db);
  await seedOutreach(db);
  console.log('Done.');
  db.close();
}

main().catch((e) => { console.error(e); process.exit(1); });

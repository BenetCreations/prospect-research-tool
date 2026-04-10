import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { db, initDb } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const companies = JSON.parse(
  readFileSync(join(__dirname, '../../seed_companies.json'), 'utf-8')
);
const contacts = JSON.parse(
  readFileSync(join(__dirname, '../../seed_contacts.json'), 'utf-8')
);

const migrate = db.transaction(() => {
  initDb();

  const insertCompany = db.prepare(`
    INSERT OR REPLACE INTO companies
      (id, name, vertical, subsector, priority_tier,
       score_interest, score_fit, score_access, score_timing,
       notes, status, research, last_research_date)
    VALUES
      (@id, @name, @vertical, @subsector, @priorityTier,
       @interest, @fit, @access, @timing,
       @notes, @status, @research, @lastResearchDate)
  `);

  for (const c of companies) {
    insertCompany.run({
      id: c.id,
      name: c.name,
      vertical: c.vertical ?? null,
      subsector: c.subsector ?? null,
      priorityTier: c.priorityTier ?? null,
      interest: c.scores.interest,
      fit: c.scores.fit,
      access: c.scores.access,
      timing: c.scores.timing,
      notes: c.notes ?? null,
      status: c.status ?? null,
      research: c.research ?? null,
      lastResearchDate: c.lastResearchDate ?? null,
    });
  }

  // Build case-insensitive name → id map
  const nameToId = new Map(companies.map((c) => [c.name.toLowerCase(), c.id]));

  const insertContact = db.prepare(`
    INSERT OR REPLACE INTO contacts (id, name, company_id, title, warmth)
    VALUES (@id, @name, @companyId, @title, @warmth)
  `);

  let orphanCount = 0;
  for (const ct of contacts) {
    const companyId = ct.company
      ? (nameToId.get(ct.company.toLowerCase()) ?? null)
      : null;
    if (ct.company && !companyId) {
      orphanCount++;
      console.log(`  Orphan: ${ct.name} @ ${ct.company}`);
    }
    insertContact.run({
      id: ct.id,
      name: ct.name,
      companyId,
      title: ct.title ?? null,
      warmth: ct.warmth,
    });
  }

  console.log(`\nMigrated ${companies.length} companies, ${contacts.length} contacts (${orphanCount} orphans with no matching company)`);
});

migrate();

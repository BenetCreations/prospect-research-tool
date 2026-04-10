import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
import { db, initDb } from './db/index.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

initDb();

// --- Helpers ---

function rowToCompany(row) {
  return {
    id: row.id,
    name: row.name,
    vertical: row.vertical,
    subsector: row.subsector,
    priorityTier: row.priority_tier,
    scores: {
      interest: row.score_interest,
      fit:      row.score_fit,
      access:   row.score_access,
      timing:   row.score_timing,
      total:    row.score_interest + row.score_fit + row.score_access + row.score_timing,
    },
    notes:            row.notes,
    status:           row.status,
    research:         row.research,
    lastResearchDate: row.last_research_date,
  };
}

function rowToContact(row) {
  return {
    id:        row.id,
    name:      row.name,
    companyId: row.company_id,
    title:     row.title,
    warmth:    row.warmth,
  };
}

// --- Company endpoints ---

app.get('/api/companies', (req, res) => {
  const companyRows = db.prepare('SELECT * FROM companies').all();
  const contactRows = db.prepare('SELECT * FROM contacts WHERE company_id IS NOT NULL').all();

  const contactsByCompany = {};
  for (const ct of contactRows) {
    if (!contactsByCompany[ct.company_id]) contactsByCompany[ct.company_id] = [];
    contactsByCompany[ct.company_id].push(rowToContact(ct));
  }

  const enriched = companyRows.map((row) => ({
    ...rowToCompany(row),
    contacts: contactsByCompany[row.id] ?? [],
  }));

  res.json(enriched);
});

app.post('/api/companies', (req, res) => {
  const { name, vertical, priorityTier } = req.body;
  if (!name || !vertical || !priorityTier) {
    return res.status(400).json({ error: 'name, vertical, and priorityTier are required' });
  }

  const id = 'C' + Date.now();
  db.prepare(`
    INSERT INTO companies (id, name, vertical, priority_tier,
      score_interest, score_fit, score_access, score_timing)
    VALUES (?, ?, ?, ?, 3, 3, 3, 3)
  `).run(id, name, vertical, priorityTier);

  const row = db.prepare('SELECT * FROM companies WHERE id = ?').get(id);
  res.status(201).json({ ...rowToCompany(row), contacts: [] });
});

app.patch('/api/companies/:id', (req, res) => {
  const { id } = req.params;
  const { scores, notes, priorityTier } = req.body;
  const { interest, fit, access, timing } = scores;

  const result = db.prepare(`
    UPDATE companies
    SET score_interest = ?, score_fit = ?, score_access = ?, score_timing = ?, notes = ?,
        priority_tier = COALESCE(?, priority_tier)
    WHERE id = ?
  `).run(interest, fit, access, timing, notes ?? null, priorityTier ?? null, id);

  if (result.changes === 0) return res.status(404).json({ error: 'Company not found' });

  const row = db.prepare('SELECT * FROM companies WHERE id = ?').get(id);
  res.json(rowToCompany(row));
});

// --- Contact endpoints ---

app.post('/api/contacts', (req, res) => {
  const { name, companyId, title, warmth } = req.body;
  if (!name || !warmth) return res.status(400).json({ error: 'name and warmth are required' });

  if (companyId) {
    const co = db.prepare('SELECT id FROM companies WHERE id = ?').get(companyId);
    if (!co) return res.status(400).json({ error: 'Invalid companyId' });
  }

  const id = 'P' + Date.now();
  db.prepare(`
    INSERT INTO contacts (id, name, company_id, title, warmth)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, name, companyId ?? null, title ?? null, warmth);

  const row = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
  res.status(201).json(rowToContact(row));
});

app.patch('/api/contacts/:id', (req, res) => {
  const { id } = req.params;
  const { name, title, warmth } = req.body;

  const result = db.prepare(`
    UPDATE contacts SET name = ?, title = ?, warmth = ? WHERE id = ?
  `).run(name, title ?? null, warmth, id);

  if (result.changes === 0) return res.status(404).json({ error: 'Contact not found' });

  const row = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
  res.status(200).json(rowToContact(row));
});

app.post('/api/contacts/import', (req, res) => {
  const incoming = req.body;
  if (!Array.isArray(incoming)) return res.status(400).json({ error: 'Body must be an array' });

  const companyRows = db.prepare('SELECT id, name FROM companies').all();
  const nameToId = new Map(companyRows.map((c) => [c.name.toLowerCase(), c.id]));

  // Build a lookup of existing contacts by (name, company_id) so we can match without deleting
  const existingContacts = db.prepare('SELECT * FROM contacts').all();
  const existingMap = new Map();
  for (const ct of existingContacts) {
    const key = ct.name.toLowerCase() + '|' + (ct.company_id ?? '');
    existingMap.set(key, ct);
  }

  const doImport = db.transaction(() => {
    const update = db.prepare(`
      UPDATE contacts SET name = ?, title = ?, company_id = ? WHERE id = ?
    `);
    const insert = db.prepare(`
      INSERT INTO contacts (id, name, company_id, title, warmth)
      VALUES (@id, @name, @companyId, @title, @warmth)
    `);

    let inserted = 0, updated = 0;
    for (let i = 0; i < incoming.length; i++) {
      const ct = incoming[i];
      const companyId = ct.company
        ? (nameToId.get(ct.company.toLowerCase()) ?? null)
        : null;
      const matchKey = (ct.name ?? '').toLowerCase() + '|' + (companyId ?? '');
      const existing = existingMap.get(matchKey);

      if (existing) {
        // Contact already in dashboard — update name/title/company but preserve dashboard warmth
        update.run(ct.name ?? '', ct.title ?? null, companyId, existing.id);
        updated++;
      } else {
        insert.run({
          id: ct.id || 'P' + Date.now() + i,
          name: ct.name ?? '',
          companyId,
          title: ct.title ?? null,
          warmth: Number(ct.warmth) || 1,
        });
        inserted++;
      }
    }
    return { inserted, updated };
  });

  const { inserted, updated } = doImport();
  res.json({ imported: inserted + updated, inserted, updated });
});

// --- Outreach endpoints ---

app.get('/api/contacts/:id/outreach', (req, res) => {
  const { id } = req.params;
  const { companyId } = req.query;

  let rows;
  if (companyId) {
    rows = db.prepare(`
      SELECT o.*, c.name AS company_name
      FROM outreach o
      JOIN companies c ON o.company_id = c.id
      WHERE o.contact_id = ? AND o.company_id = ?
      ORDER BY o.date DESC, o.created_at DESC
    `).all(id, companyId);
  } else {
    rows = db.prepare(`
      SELECT o.*, c.name AS company_name
      FROM outreach o
      JOIN companies c ON o.company_id = c.id
      WHERE o.contact_id = ?
      ORDER BY o.date DESC, o.created_at DESC
    `).all(id);
  }
  res.json(rows);
});

app.post('/api/contacts/:id/outreach', (req, res) => {
  const { id: contactId } = req.params;
  const { companyId, date, type, notes } = req.body;

  if (!companyId || !date || !type) {
    return res.status(400).json({ error: 'companyId, date, and type are required' });
  }

  const validTypes = ['email', 'linkedin', 'call', 'meeting', 'text'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
  }

  const contact = db.prepare('SELECT id FROM contacts WHERE id = ?').get(contactId);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });

  const company = db.prepare('SELECT id FROM companies WHERE id = ?').get(companyId);
  if (!company) return res.status(404).json({ error: 'Company not found' });

  const result = db.prepare(`
    INSERT INTO outreach (contact_id, company_id, date, type, notes)
    VALUES (?, ?, ?, ?, ?)
  `).run(contactId, companyId, date, type, notes ?? null);

  const row = db.prepare('SELECT * FROM outreach WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(row);
});

app.delete('/api/outreach/:id', (req, res) => {
  const result = db.prepare('DELETE FROM outreach WHERE id = ?').run(Number(req.params.id));
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ deleted: true });
});

// --- Research endpoint ---

app.post('/api/companies/:id/research', async (req, res) => {
  const { id } = req.params;
  const row = db.prepare('SELECT * FROM companies WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Company not found' });

  const company = rowToCompany(row);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const prompt = `You are a job search research assistant. Research ${company.name} thoroughly by performing these 3 web searches:

1. "${company.name} partnerships team structure 2025 2026" — looking for partnerships org signals
2. "${company.name} Seattle office careers partnerships BD" — looking for relevant open roles and Seattle presence
3. "${company.name} funding revenue growth 2025 2026" — looking for recent company momentum

After completing all searches, synthesize your findings into a structured brief with exactly these four sections:

## Partnerships Org Signals
[Findings about their partnerships team, structure, key people, and org]

## Seattle / Role Fit
[Findings about Seattle presence and relevant open roles in partnerships or BD]

## Recent Momentum
[Findings about funding, revenue, growth trajectory, and recent news]

## Updated Assessment
[Overall assessment as a job search prospect, integrating all findings above]

Be specific and cite concrete details from your searches. If a search returns limited results, note that.`;

  try {
    let fullText = '';

    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }],
    });

    stream.on('text', (chunk) => {
      fullText += chunk;
      res.write(`data: ${JSON.stringify({ type: 'text', text: chunk })}\n\n`);
    });

    await stream.finalMessage();

    const lastResearchDate = new Date().toISOString();
    db.prepare(`
      UPDATE companies SET research = ?, last_research_date = ? WHERE id = ?
    `).run(fullText, lastResearchDate, id);

    res.write(`data: ${JSON.stringify({ type: 'done', lastResearchDate })}\n\n`);
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

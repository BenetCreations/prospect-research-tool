import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
import cron from 'node-cron';
import nodemailer from 'nodemailer';
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
    id:          row.id,
    name:        row.name,
    companyId:   row.company_id,
    companyName: row.company_name ?? null,
    title:       row.title,
    warmth:      row.warmth,
    status:      row.status ?? 'Active',
    nextAction:  row.next_action ?? '',
    nextTouch:   row.next_touch ?? '',
    lastTouch:   row.last_touch ?? null,
  };
}

function rowToOutreach(row) {
  return {
    id:          row.id,
    contactId:   row.contact_id,
    contactName: row.contact_name ?? null,
    companyId:   row.company_id,
    companyName: row.company_name ?? null,
    date:        row.date,
    action:      row.action ?? row.type ?? '',
    notes:       row.notes ?? '',
    result:      row.result ?? '',
    createdAt:   row.created_at,
  };
}

function rowToApplication(row) {
  return {
    id:           row.id,
    jobPostingId: row.job_posting_id,
    companyId:    row.company_id,
    companyName:  row.company_name,
    roleTitle:    row.role_title,
    roleId:       row.role_id,
    dateApplied:  row.date_applied,
    referral:     row.referral === 1,
    stage:        row.stage,
    notes:        row.notes,
    jobUrl:       row.job_url ?? null,
    createdAt:    row.created_at,
    updatedAt:    row.updated_at,
  };
}

const VALID_STAGES = ['Drafting', 'Applied', 'Recruiter Screen', 'Hiring Manager', 'Interviewing', 'Final Round', 'Offer', 'Rejected'];

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

app.get('/api/contacts', (req, res) => {
  const rows = db.prepare(`
    SELECT ct.*,
           co.name AS company_name,
           (SELECT MAX(o.date) FROM outreach o WHERE o.contact_id = ct.id) AS last_touch
    FROM contacts ct
    LEFT JOIN companies co ON ct.company_id = co.id
    ORDER BY ct.name ASC
  `).all();
  res.json(rows.map(rowToContact));
});

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
  const { name, title, warmth, status, nextAction, nextTouch } = req.body;

  const result = db.prepare(`
    UPDATE contacts
    SET name = ?, title = ?, warmth = ?,
        status = COALESCE(?, status),
        next_action = COALESCE(?, next_action),
        next_touch = COALESCE(?, next_touch)
    WHERE id = ?
  `).run(name, title ?? null, warmth, status ?? null, nextAction ?? null, nextTouch ?? null, id);

  if (result.changes === 0) return res.status(404).json({ error: 'Contact not found' });

  const row = db.prepare(`
    SELECT ct.*, co.name AS company_name,
           (SELECT MAX(o.date) FROM outreach o WHERE o.contact_id = ct.id) AS last_touch
    FROM contacts ct LEFT JOIN companies co ON ct.company_id = co.id
    WHERE ct.id = ?
  `).get(id);
  res.status(200).json(rowToContact(row));
});

app.delete('/api/contacts/:id', (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM outreach WHERE contact_id = ?').run(id);
  const result = db.prepare('DELETE FROM contacts WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ error: 'Contact not found' });
  res.status(204).end();
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

// GET all outreach (for Outreach tab)
app.get('/api/outreach', (req, res) => {
  const rows = db.prepare(`
    SELECT o.*,
           ct.name AS contact_name,
           co.name AS company_name
    FROM outreach o
    LEFT JOIN contacts ct ON o.contact_id = ct.id
    LEFT JOIN companies co ON o.company_id = co.id
    ORDER BY o.date DESC, o.created_at DESC
  `).all();
  res.json(rows.map(rowToOutreach));
});

// POST new outreach (body-based, for Outreach tab)
const VALID_ACTIONS = [
  'Cold Outreach', 'Warm Outreach', 'Follow-Up', 'Intro Request',
  'Meeting Booked', 'Meeting Held', 'Thank You Sent',
  'Intro Made', 'Referral Offered', 'Referral Submitted',
];

app.post('/api/outreach', (req, res) => {
  const { contactId, date, action, notes, result: resultText } = req.body;
  if (!contactId || !date) {
    return res.status(400).json({ error: 'contactId and date are required' });
  }

  const contact = db.prepare('SELECT id, company_id FROM contacts WHERE id = ?').get(contactId);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });

  const companyId = contact.company_id ?? null;

  const dbResult = db.prepare(`
    INSERT INTO outreach (contact_id, company_id, date, type, action, notes, result)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(contactId, companyId, date, action ?? '', action ?? null, notes ?? null, resultText ?? null);

  const row = db.prepare(`
    SELECT o.*, ct.name AS contact_name, co.name AS company_name
    FROM outreach o
    LEFT JOIN contacts ct ON o.contact_id = ct.id
    LEFT JOIN companies co ON o.company_id = co.id
    WHERE o.id = ?
  `).get(dbResult.lastInsertRowid);
  res.status(201).json(rowToOutreach(row));
});

// PATCH outreach entry
app.patch('/api/outreach/:id', (req, res) => {
  const { date, action, notes, result: resultText, contactId } = req.body;
  const id = Number(req.params.id);

  // If contactId is changing, re-derive company_id
  let companyIdClause = '';
  const params = [];

  if (contactId !== undefined) {
    const contact = db.prepare('SELECT id, company_id FROM contacts WHERE id = ?').get(contactId);
    if (!contact) return res.status(400).json({ error: 'Contact not found' });
    companyIdClause = ', contact_id = ?, company_id = ?';
    params.push(contactId, contact.company_id ?? null);
  }

  const dbResult = db.prepare(`
    UPDATE outreach
    SET date = ?, action = ?, type = ?, notes = ?, result = ?
    ${companyIdClause}
    WHERE id = ?
  `).run(date, action ?? null, action ?? null, notes ?? null, resultText ?? null, ...params, id);

  if (dbResult.changes === 0) return res.status(404).json({ error: 'Outreach not found' });

  const row = db.prepare(`
    SELECT o.*, ct.name AS contact_name, co.name AS company_name
    FROM outreach o
    LEFT JOIN contacts ct ON o.contact_id = ct.id
    LEFT JOIN companies co ON o.company_id = co.id
    WHERE o.id = ?
  `).get(id);
  res.json(rowToOutreach(row));
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

// --- Email digest ---

function fmtDateEmail(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function parseDepts(raw) {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

async function sendJobDigestEmail(newJobs) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'fetch_schedule'").get();
  const schedule = JSON.parse(row.value);
  const { emailTo, emailSubjectWithJobs, emailSubjectNoJobs } = schedule;

  if (!emailTo || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) return;

  const count = newJobs.length;
  const subject = count === 0
    ? (emailSubjectNoJobs?.trim() || 'Zero New Job Postings')
    : (emailSubjectWithJobs?.trim() || '(X) New Job Postings').replace(/\(X\)/g, String(count));

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });

  const bodyHtml = count === 0
    ? `<p style="font-family:sans-serif;color:#64748b;">No new job postings were found in this run.</p>`
    : `
      <table style="width:100%;border-collapse:collapse;font-family:sans-serif;font-size:14px;">
        <thead>
          <tr style="background:#0f172a;color:#94a3b8;">
            <th style="padding:8px 12px;text-align:left;border-bottom:1px solid #1e293b;">Company</th>
            <th style="padding:8px 12px;text-align:left;border-bottom:1px solid #1e293b;">Title</th>
            <th style="padding:8px 12px;text-align:left;border-bottom:1px solid #1e293b;">Location</th>
            <th style="padding:8px 12px;text-align:left;border-bottom:1px solid #1e293b;">Department</th>
            <th style="padding:8px 12px;text-align:left;border-bottom:1px solid #1e293b;">Published</th>
            <th style="padding:8px 12px;text-align:left;border-bottom:1px solid #1e293b;">First Seen</th>
          </tr>
        </thead>
        <tbody>
          ${newJobs.map((j, i) => `
            <tr style="background:${i % 2 === 0 ? '#1e293b' : '#0f172a'};">
              <td style="padding:8px 12px;color:#e2e8f0;border-bottom:1px solid #334155;">${j.company_name ?? '—'}</td>
              <td style="padding:8px 12px;border-bottom:1px solid #334155;">
                ${j.url
                  ? `<a href="${j.url}" style="color:#2dd4bf;text-decoration:none;">${j.title}</a>`
                  : `<span style="color:#e2e8f0;">${j.title}</span>`}
              </td>
              <td style="padding:8px 12px;color:#94a3b8;border-bottom:1px solid #334155;">${j.location ?? '—'}</td>
              <td style="padding:8px 12px;color:#94a3b8;border-bottom:1px solid #334155;">${parseDepts(j.departments).join(', ') || '—'}</td>
              <td style="padding:8px 12px;color:#94a3b8;border-bottom:1px solid #334155;">${fmtDateEmail(j.gh_first_published)}</td>
              <td style="padding:8px 12px;color:#94a3b8;border-bottom:1px solid #334155;">${fmtDateEmail(j.first_seen_at)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

  const html = `
    <div style="background:#020617;padding:24px;min-height:100vh;">
      <h2 style="font-family:sans-serif;color:#f1f5f9;margin:0 0 16px;">${subject}</h2>
      ${bodyHtml}
      <p style="font-family:sans-serif;font-size:12px;color:#475569;margin-top:24px;">
        Sent by Prospect Research Tool · ${new Date().toLocaleString()}
      </p>
    </div>
  `;

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: emailTo,
    subject,
    html,
  });

  console.log(`[Email] Digest sent to ${emailTo}: "${subject}"`);
}

// --- Greenhouse job fetcher ---

async function fetchGreenhouseJobs() {
  const companies = db.prepare(
    'SELECT id, name, greenhouse_slug FROM companies WHERE greenhouse_slug IS NOT NULL'
  ).all();

  const now = new Date().toISOString();
  let totalFound = 0, totalNew = 0, totalClosed = 0;
  const newJobRows = [];

  for (const company of companies) {
    const url = `https://boards-api.greenhouse.io/v1/boards/${company.greenhouse_slug}/jobs?content=true`;
    let jobs;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      jobs = data.jobs ?? [];
    } catch { continue; }

    const fetchedIds = new Set();

    for (const job of jobs) {
      const id = `${company.id}:${job.id}`;
      fetchedIds.add(id);
      const departments = JSON.stringify(
        (job.departments ?? []).map((d) => d.name).filter(Boolean)
      );
      const ghFirstPublished = job.first_published ?? null;
      const existing = db.prepare('SELECT id FROM job_postings WHERE id = ?').get(id);
      if (existing) {
        db.prepare(
          "UPDATE job_postings SET last_seen_at = ?, status = 'active', is_new = 0, gh_first_published = COALESCE(gh_first_published, ?) WHERE id = ?"
        ).run(now, ghFirstPublished, id);
      } else {
        db.prepare(`
          INSERT INTO job_postings
            (id, company_id, greenhouse_id, title, location, departments, url, is_new, first_seen_at, last_seen_at, gh_first_published)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
        `).run(id, company.id, job.id, job.title, job.location?.name ?? null, departments, job.absolute_url, now, now, ghFirstPublished);
        newJobRows.push({
          id,
          company_name: company.name,
          title: job.title,
          location: job.location?.name ?? null,
          departments,
          url: job.absolute_url,
          gh_first_published: ghFirstPublished,
          first_seen_at: now,
        });
        totalNew++;
      }
      totalFound++;
    }

    // Mark jobs no longer in the feed as closed
    const activeForCompany = db.prepare(
      "SELECT id FROM job_postings WHERE company_id = ? AND status = 'active'"
    ).all(company.id);
    for (const row of activeForCompany) {
      if (!fetchedIds.has(row.id)) {
        db.prepare(
          "UPDATE job_postings SET status = 'closed', closed_at = ? WHERE id = ?"
        ).run(now, row.id);
        totalClosed++;
      }
    }
  }

  db.prepare(`
    INSERT INTO fetch_runs (run_at, companies_count, jobs_found, new_jobs, closed_jobs)
    VALUES (?, ?, ?, ?, ?)
  `).run(now, companies.length, totalFound, totalNew, totalClosed);

  console.log(`[Greenhouse] Ran: ${totalFound} active, ${totalNew} new, ${totalClosed} closed`);

  // Send email digest (fire-and-forget; errors are logged but don't break the fetch)
  sendJobDigestEmail(newJobRows).catch((err) => console.error('[Email] Failed to send digest:', err.message));

  return { companiesCount: companies.length, jobsFound: totalFound, newJobs: totalNew, closedJobs: totalClosed };
}

// --- Dynamic cron scheduling ---

function cronExprFromSchedule({ frequency, hour, minute }) {
  const dayExpr = frequency === 'weekdays' ? '1-5' : '*';
  return `${minute} ${hour} * * ${dayExpr}`;
}

let currentCronTask = null;

function applySchedule() {
  if (currentCronTask) currentCronTask.stop();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'fetch_schedule'").get();
  const schedule = JSON.parse(row.value);
  const expr = cronExprFromSchedule(schedule);
  const tz = schedule.timezone ?? 'America/Los_Angeles';
  currentCronTask = cron.schedule(expr, fetchGreenhouseJobs, { timezone: tz });
  console.log(`[Greenhouse] Scheduled: ${expr} (${tz})`);
}

applySchedule();

// --- Greenhouse job posting endpoints ---

app.get('/api/job-postings', (req, res) => {
  const { newOnly, companyId, status = 'active' } = req.query;
  let sql = `
    SELECT jp.*, c.name AS company_name
    FROM job_postings jp
    JOIN companies c ON jp.company_id = c.id
    WHERE 1=1
  `;
  const params = [];
  if (status !== 'all') { sql += ' AND jp.status = ?'; params.push(status); }
  if (newOnly === '1') { sql += ' AND jp.is_new = 1'; }
  if (companyId) { sql += ' AND jp.company_id = ?'; params.push(companyId); }
  sql += ' ORDER BY jp.first_seen_at DESC';
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/job-postings/fetch', async (req, res) => {
  try {
    const result = await fetchGreenhouseJobs();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/job-postings/runs', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM fetch_runs ORDER BY id DESC LIMIT 20'
  ).all();
  res.json(rows);
});

app.get('/api/companies/greenhouse', (req, res) => {
  const rows = db.prepare(
    'SELECT id, name, greenhouse_slug FROM companies WHERE greenhouse_slug IS NOT NULL ORDER BY name'
  ).all();
  res.json(rows);
});

app.get('/api/settings/fetch-schedule', (req, res) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'fetch_schedule'").get();
  res.json(JSON.parse(row.value));
});

const VALID_TIMEZONES = new Set([
  'America/Los_Angeles', 'America/Denver', 'America/Phoenix',
  'America/Chicago', 'America/New_York', 'America/Anchorage', 'Pacific/Honolulu',
]);

app.put('/api/settings/fetch-schedule', (req, res) => {
  const { frequency, hour, minute, timezone = 'America/Los_Angeles', savedSearchId = null, emailTo = null, emailSubjectWithJobs = null, emailSubjectNoJobs = null } = req.body;
  if (!['daily', 'weekdays'].includes(frequency) ||
      typeof hour !== 'number' || hour < 0 || hour > 23 ||
      typeof minute !== 'number' || minute < 0 || minute > 59 ||
      !VALID_TIMEZONES.has(timezone)) {
    return res.status(400).json({ error: 'Invalid schedule parameters' });
  }
  const payload = {
    frequency,
    hour,
    minute,
    timezone,
    savedSearchId: savedSearchId ?? null,
    emailTo: emailTo?.trim() || null,
    emailSubjectWithJobs: emailSubjectWithJobs?.trim() || null,
    emailSubjectNoJobs: emailSubjectNoJobs?.trim() || null,
  };
  db.prepare("UPDATE settings SET value = ? WHERE key = 'fetch_schedule'").run(JSON.stringify(payload));
  applySchedule();
  res.json(payload);
});

// --- Saved searches ---

app.get('/api/saved-searches', (req, res) => {
  res.json(db.prepare('SELECT * FROM saved_searches ORDER BY created_at DESC').all());
});

app.post('/api/saved-searches', (req, res) => {
  const { name, filters } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  const result = db.prepare(
    'INSERT INTO saved_searches (name, filters) VALUES (?, ?)'
  ).run(name.trim(), JSON.stringify(filters));
  const row = db.prepare('SELECT * FROM saved_searches WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(row);
});

app.delete('/api/saved-searches/:id', (req, res) => {
  const id = Number(req.params.id);
  // Clear schedule reference if this search was selected
  const schedRow = db.prepare("SELECT value FROM settings WHERE key = 'fetch_schedule'").get();
  const sched = JSON.parse(schedRow.value);
  if (sched.savedSearchId === id) {
    sched.savedSearchId = null;
    db.prepare("UPDATE settings SET value = ? WHERE key = 'fetch_schedule'").run(JSON.stringify(sched));
  }
  db.prepare('DELETE FROM saved_searches WHERE id = ?').run(id);
  res.json({ deleted: true });
});

// --- Applications endpoints ---

app.get('/api/applications/posting-ids', (req, res) => {
  const rows = db.prepare(
    'SELECT job_posting_id FROM applications WHERE job_posting_id IS NOT NULL'
  ).all();
  res.json(rows.map((r) => r.job_posting_id));
});

app.get('/api/applications', (req, res) => {
  const rows = db.prepare(`
    SELECT a.*, jp.url AS job_url
    FROM applications a
    LEFT JOIN job_postings jp ON a.job_posting_id = jp.id
    ORDER BY a.created_at DESC
  `).all();
  res.json(rows.map(rowToApplication));
});

app.post('/api/applications', (req, res) => {
  const { jobPostingId, companyId, companyName, roleTitle, roleId } = req.body;
  if (!companyName || !roleTitle) {
    return res.status(400).json({ error: 'companyName and roleTitle are required' });
  }

  if (jobPostingId) {
    const existing = db.prepare(
      'SELECT id FROM applications WHERE job_posting_id = ?'
    ).get(jobPostingId);
    if (existing) {
      return res.status(409).json({ error: 'Application already exists for this posting', id: existing.id });
    }
  }

  const result = db.prepare(`
    INSERT INTO applications (job_posting_id, company_id, company_name, role_title, role_id, stage)
    VALUES (?, ?, ?, ?, ?, 'Drafting')
  `).run(jobPostingId ?? null, companyId ?? null, companyName, roleTitle, roleId ?? null);

  const row = db.prepare(`
    SELECT a.*, NULL AS job_url FROM applications a WHERE a.id = ?
  `).get(result.lastInsertRowid);
  res.status(201).json(rowToApplication(row));
});

app.patch('/api/applications/:id', (req, res) => {
  const { id } = req.params;
  const { roleTitle, roleId, dateApplied, referral, stage, notes } = req.body;

  if (!VALID_STAGES.includes(stage)) {
    return res.status(400).json({ error: `stage must be one of: ${VALID_STAGES.join(', ')}` });
  }

  const now = new Date().toISOString();
  const result = db.prepare(`
    UPDATE applications
    SET role_title = ?, role_id = ?, date_applied = ?, referral = ?,
        stage = ?, notes = ?, updated_at = ?
    WHERE id = ?
  `).run(
    roleTitle,
    roleId ?? null,
    dateApplied ?? null,
    referral ? 1 : 0,
    stage,
    notes ?? null,
    now,
    Number(id)
  );

  if (result.changes === 0) return res.status(404).json({ error: 'Application not found' });

  const row = db.prepare(`
    SELECT a.*, jp.url AS job_url
    FROM applications a
    LEFT JOIN job_postings jp ON a.job_posting_id = jp.id
    WHERE a.id = ?
  `).get(Number(id));
  res.json(rowToApplication(row));
});

app.delete('/api/applications/:id', (req, res) => {
  const result = db.prepare('DELETE FROM applications WHERE id = ?').run(Number(req.params.id));
  if (result.changes === 0) return res.status(404).json({ error: 'Application not found' });
  res.json({ deleted: true });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install all dependencies (root + server + client)
npm run install:all

# Run everything (server + client dev servers concurrently)
npm run dev

# Run server only (port 3001, auto-restarts on file change)
npm run dev --prefix server

# Run client only (Vite, port 5173)
npm run dev --prefix client

# One-time DB migration from seed JSON files (run once after fresh clone)
node server/db/migrate.js

# Build client for production
npm run build --prefix client
```

## Architecture

**Monorepo** with two packages: `server/` (Express API) and `client/` (React + Vite). The client proxies all `/api/*` requests to `http://localhost:3001` via Vite's dev proxy.

### Data layer

Persistence is **SQLite** (`prospect.db` at the project root) via `better-sqlite3` (synchronous API). Three tables:

- `companies` — flat columns for scores (`score_interest`, `score_fit`, `score_access`, `score_timing`); no `total` column, it's computed on read
- `contacts` — linked to companies via `company_id` (TEXT FK, nullable for orphan contacts)
- `outreach` — log entries linked to both a contact and a company

Schema is created idempotently by `initDb()` in `server/db/index.js` on every server start. The migration script `server/db/migrate.js` is for one-time import from the legacy `seed_*.json` files (kept as backup).

### Server (`server/index.js`)

Single-file Express app. Uses ESM (`"type": "module"`). Two helper functions convert DB rows to API shapes: `rowToCompany()` reconstructs the nested `scores` object and camelCases fields; `rowToContact()` maps `company_id` → `companyId`.

Key API behaviors:
- `GET /api/companies` returns companies with a nested `contacts` array (joined in JS, not SQL)
- `PATCH /api/companies/:id` returns the company **without** contacts — the client re-attaches them from local state
- `POST /api/contacts/import` does a full DELETE + re-insert (replaces all contacts); cascades-deletes outreach entries
- `POST /api/companies/:id/research` streams Server-Sent Events using the Anthropic SDK's streaming API with the `web_search` tool

### Client (`client/src/`)

React 18 + Tailwind. No router — single page with two views toggled by `mainView` state in `App.jsx`.

- **Dashboard view**: grid of `CompanyCard` components; clicking opens `DetailPanel` (right drawer)
- **Research view**: `ResearchWorkspace` — sidebar lists all companies sorted by tier then score; selecting one shows its research brief on the right with a single "Run Research" button in the header

`DetailPanel` handles: score editing, notes, per-company contact management (add/edit inline), and per-contact outreach logging. Outreach entries are fetched per-contact via `GET /api/contacts/:id/outreach?companyId=`.

### Environment

Requires `ANTHROPIC_API_KEY` in `.env` at the project root. The server loads it with `dotenv.config({ path: '../.env' })` relative to `server/`.

# Prospect Research Tool

A personal job search CRM built to track target companies, score them across multiple dimensions, manage contacts, log outreach, and generate AI research briefs on demand.

Built entirely with Claude Code (Anthropic's AI coding CLI) over the course of a few weeks while actively job searching.

---

## What it does

- **Dashboard** — grid of target companies, color-coded by priority tier (A/B/C), showing composite scores and contact warmth indicators
- **Detail panel** — edit priority tier, individual scores (Interest, Fit, Access, Timing), notes, contacts, and outreach history per company
- **Research workspace** — runs a live AI research brief for any company using Claude's `web_search` tool, streamed in real-time; results are saved to the database
- **Export** — downloads all companies and scores as a CSV
- **Contact import** — bulk-import contacts from CSV or JSON

---

## Screenshots

**Dashboard view** — 22 companies sorted by tier and score, with tier counts in the header

![Dashboard](screenshots/dashboard.jpeg)

**Detail panel** — editing priority tier, scores, and contacts for a company

![Detail panel](screenshots/detail-panel.jpeg)

**Research workspace** — AI-generated brief for Stripe, streamed from the Claude API using live web search

![Research](screenshots/research.jpeg)

---

## Tech stack

| Layer | Stack |
|---|---|
| Frontend | React 18, Vite, Tailwind CSS |
| Backend | Node.js, Express |
| Database | SQLite via `better-sqlite3` |
| AI | Anthropic Claude API (`claude-sonnet-4-20250514`) with `web_search` tool |
| Dev tooling | Claude Code (AI coding CLI) |

---

## How AI was used

**Claude Code** was used as the primary development tool throughout — not for boilerplate generation, but for iterative feature work: designing the data model, building out the API, wiring up the React components, and debugging. The feature additions (outreach logging, contact import, research streaming, tier editing, CSV export) were each built in conversation with Claude Code, reviewing the actual code before and after each change.

The **in-app research feature** uses the Anthropic API directly: when "Run Research" is clicked, the server sends a structured prompt to Claude with the `web_search` tool enabled, performs three targeted searches about the company (partnerships org, Seattle presence, recent momentum), and streams the synthesized brief back to the client via Server-Sent Events.

The goal was to learn what it actually feels like to build something real with an AI coding assistant — including where it's fast, where it needs correction, and how to stay in control of the output.

---

## Setup

```bash
# Install dependencies
npm run install:all

# Add your Anthropic API key
echo "ANTHROPIC_API_KEY=your_key_here" > .env

# Run migrations (first time only)
node server/db/migrate.js

# Start dev servers
npm run dev
```

Runs on `localhost:5173` (client) proxying to `localhost:3001` (API).

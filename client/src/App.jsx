import { useEffect, useRef, useState } from 'react';
import DetailPanel from './DetailPanel.jsx';
import AddCompanyModal from './AddCompanyModal.jsx';
import ResearchBrief from './ResearchBrief.jsx';
import PostingsWorkspace from './PostingsWorkspace.jsx';
import ApplicationsWorkspace from './ApplicationsWorkspace.jsx';
import ContactsWorkspace from './ContactsWorkspace.jsx';
import OutreachWorkspace from './OutreachWorkspace.jsx';

const TIER_ORDER = { 'Tier A': 0, 'Tier B': 1, 'Tier C': 2 };

const TIER_STYLES = {
  'Tier A': {
    badge: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/35',
    border: 'border-emerald-500/55',
    accent: 'bg-emerald-500',
  },
  'Tier B': {
    badge: 'bg-amber-500/15 text-amber-300 border border-amber-500/35',
    border: 'border-amber-500/55',
    accent: 'bg-amber-500',
  },
  'Tier C': {
    badge: 'bg-slate-600/50 text-slate-300 border border-slate-500/40',
    border: 'border-slate-500/60',
    accent: 'bg-slate-500',
  },
};

const WARMTH_COLORS = {
  1: 'bg-slate-500',
  2: 'bg-teal-400/55',
  3: 'bg-emerald-400',
  4: 'bg-emerald-300',
};

function contactsForDashboardDots(contacts) {
  return [...(contacts ?? [])].sort((a, b) => {
    const wa = Number(a.warmth) || 1;
    const wb = Number(b.warmth) || 1;
    if (wa !== wb) return wb - wa;
    return String(a.id ?? '').localeCompare(String(b.id ?? ''));
  });
}

function CompanyCard({ company, onClick }) {
  const tier = company.priorityTier;
  const styles = TIER_STYLES[tier] || TIER_STYLES['Tier C'];
  const contactDots = contactsForDashboardDots(company.contacts);

  return (
    <button
      onClick={onClick}
      className={`text-left bg-slate-900/80 rounded-lg border-2 ${styles.border} shadow-lg shadow-black/20 overflow-hidden flex flex-col w-full
        hover:bg-slate-800/90 hover:shadow-xl hover:shadow-black/25 hover:-translate-y-0.5 transition-all duration-150 cursor-pointer`}
    >
      <div className={`h-1 w-full ${styles.accent}`} />
      <div className="p-4 flex flex-col gap-2 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-100 leading-tight">{company.name}</h2>
          <span className="shrink-0 flex items-center gap-1.5">
            {!company.hasJobBoard && (
              <svg
                className="w-3.5 h-3.5 text-slate-600 shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                title="Not tracked in Job Postings — no Greenhouse/Ashby/Lever/Workday board found"
              >
                <circle cx="12" cy="12" r="9" strokeWidth={2} />
                <line x1="6" y1="18" x2="18" y2="6" strokeWidth={2} strokeLinecap="round" />
              </svg>
            )}
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${styles.badge}`}>
              {tier}
            </span>
          </span>
        </div>
        <p className="text-sm text-slate-400">{company.vertical}</p>
        <div className="mt-auto pt-2 flex items-center justify-between border-t border-slate-700/80">
          <span className="text-xs text-slate-500">Total score</span>
          <span className="text-sm font-bold text-slate-200">{company.scores.total}</span>
        </div>
        {contactDots.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            {contactDots.map((ct) => (
              <span
                key={ct.id}
                title={ct.name}
                className={`w-2 h-2 rounded-full ${WARMTH_COLORS[ct.warmth] ?? 'bg-slate-500'}`}
              />
            ))}
          </div>
        )}
      </div>
    </button>
  );
}

function StatBadge({ label, count, styles }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${styles.border} ${styles.badge}`}>
      <span className="text-sm font-medium">{label}</span>
      <span className="text-sm font-bold">{count}</span>
    </div>
  );
}

function companyHasResearch(c) {
  return typeof c.research === 'string' && c.research.trim().length > 0;
}

function ResearchWorkspace({ companies, selectedId, setSelectedId, onSave }) {
  const [researching, setResearching] = useState(null); // company id being researched
  const [streamedText, setStreamedText] = useState('');
  const [researchError, setResearchError] = useState(null);
  const streamedRef = useRef('');

  const sorted = [...companies].sort((a, b) => {
    const td = (TIER_ORDER[a.priorityTier] ?? 99) - (TIER_ORDER[b.priorityTier] ?? 99);
    if (td !== 0) return td;
    return b.scores.total - a.scores.total;
  });

  const activeCompany = companies.find((c) => c.id === selectedId) ?? null;
  const displayText = researching === selectedId ? streamedText : (activeCompany?.research ?? '');

  async function handleResearch(companyId) {
    setResearching(companyId);
    setSelectedId(companyId);
    setStreamedText('');
    streamedRef.current = '';
    setResearchError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/research`, { method: 'POST' });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const event = JSON.parse(line.slice(6));
          if (event.type === 'text') {
            streamedRef.current += event.text;
            setStreamedText((prev) => prev + event.text);
          } else if (event.type === 'done') {
            onSave({ id: companyId, research: streamedRef.current, lastResearchDate: event.lastResearchDate });
          } else if (event.type === 'error') {
            throw new Error(event.message);
          }
        }
      }
    } catch (e) {
      setResearchError(e.message);
    } finally {
      setResearching(null);
    }
  }

  return (
    <div className="flex flex-1 min-h-0 w-full max-w-[1800px] mx-auto">
      <aside className="w-80 shrink-0 border-r border-slate-800 bg-slate-900/40 flex flex-col min-h-[calc(100vh-4.25rem)]">
        <div className="p-4 border-b border-slate-800">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">All Companies</h2>
          <p className="text-xs text-slate-600 mt-1">{sorted.length} companies · sorted by tier & score</p>
        </div>
        <ul className="flex-1 overflow-y-auto p-2 space-y-1">
          {sorted.map((c) => {
            const styles = TIER_STYLES[c.priorityTier] || TIER_STYLES['Tier C'];
            const isActive = selectedId === c.id;
            const lastRun = c.lastResearchDate
              ? new Date(c.lastResearchDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              : null;
            return (
              <li key={c.id}>
                <div
                  className={`rounded-lg px-3 py-2.5 transition-colors cursor-pointer
                    ${isActive ? 'bg-slate-800 ring-1 ring-teal-500/40' : 'hover:bg-slate-800/60'}`}
                  onClick={() => setSelectedId(c.id)}
                >
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${styles.accent}`} aria-hidden />
                    <span className="font-medium text-slate-200 text-sm truncate flex-1">{c.name}</span>
                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full shrink-0 ${styles.badge}`}>
                      {c.priorityTier}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-1 pl-4">
                    {lastRun ? `Researched ${lastRun}` : 'No research yet'}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 min-h-[calc(100vh-4.25rem)] bg-slate-950">
        <div className="flex-1 overflow-y-auto p-6 md:p-8">
          {researchError && (
            <p className="text-red-400 text-sm mb-4">Research error: {researchError}</p>
          )}
          {activeCompany ? (
            <div>
              <header className="mb-8 pb-6 border-b border-slate-800">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-3">
                      <h1 className="text-2xl font-bold text-slate-100 tracking-tight">{activeCompany.name}</h1>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${(TIER_STYLES[activeCompany.priorityTier] || TIER_STYLES['Tier C']).badge}`}>
                        {activeCompany.priorityTier}
                      </span>
                    </div>
                    <p className="text-sm text-slate-400 mt-1">
                      {activeCompany.vertical}
                      {activeCompany.lastResearchDate && researching !== activeCompany.id
                        ? ` · Last research ${new Date(activeCompany.lastResearchDate).toLocaleDateString('en-US', {
                            month: 'short', day: 'numeric', year: 'numeric',
                          })}`
                        : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleResearch(activeCompany.id)}
                    disabled={!!researching}
                    className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md shrink-0
                      bg-violet-500/15 text-violet-300 hover:bg-violet-500/25 disabled:opacity-50
                      transition-colors border border-violet-500/35"
                  >
                    {researching === activeCompany.id ? (
                      <>
                        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                        </svg>
                        Researching…
                      </>
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                        </svg>
                        Run Research
                      </>
                    )}
                  </button>
                </div>
              </header>
              {displayText
                ? <ResearchBrief text={displayText} variant="page" />
                : <p className="text-slate-500 text-sm">No research yet. Click Run Research to generate a brief.</p>
              }
            </div>
          ) : (
            <p className="text-slate-500 text-sm">Select a company from the list.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  // Parse a single CSV line respecting quoted fields
  function parseLine(line) {
    const fields = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuote = !inQuote; }
      } else if (ch === ',' && !inQuote) {
        fields.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    fields.push(cur.trim());
    return fields;
  }

  const headers = parseLine(lines[0]).map((h) => h.toLowerCase().trim());
  const idx = (...keys) => { for (const k of keys) { const i = headers.indexOf(k); if (i !== -1) return i; } return -1; };

  const WARMTH_TEXT = { cold: 1, warm: 2, hot: 3, strong: 4 };

  return lines.slice(1).map((line, i) => {
    const f = parseLine(line);
    const rawWarmth = f[idx('warmth')] ?? '';
      const warmth = (WARMTH_TEXT[rawWarmth.toLowerCase()] ?? Number(rawWarmth)) || 1;
    return {
      id: f[idx('id', 'contact id', 'contact_id')] || '',
      name: f[idx('name')] ?? '',
      company: f[idx('company')] ?? null,
      title: f[idx('title')] ?? null,
      warmth,
    };
  }).filter((ct) => ct.name);
}

export default function App() {
  const [companies, setCompanies] = useState([]);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [importing, setImporting] = useState(false);
  const csvInputRef = useRef(null);
  const [mainView, setMainView] = useState('dashboard');
  const [researchSelectedId, setResearchSelectedId] = useState(null);
  const [applications, setApplications] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [outreach, setOutreach] = useState([]);

  function fetchCompanies() {
    return fetch('/api/companies')
      .then((res) => res.json())
      .then(setCompanies)
      .catch(() => setError('Could not load companies'));
  }

  function fetchApplications() {
    return fetch('/api/applications')
      .then((res) => res.json())
      .then(setApplications)
      .catch(() => console.error('Could not load applications'));
  }

  function fetchContacts() {
    return fetch('/api/contacts')
      .then((res) => res.json())
      .then(setContacts)
      .catch(() => console.error('Could not load contacts'));
  }

  function fetchOutreach() {
    return fetch('/api/outreach')
      .then((res) => res.json())
      .then(setOutreach)
      .catch(() => console.error('Could not load outreach'));
  }

  function handleApplicationCreated(newApp) {
    setApplications((prev) => [newApp, ...prev]);
  }

  function handleApplicationUpdated(updated) {
    setApplications((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  }

  function handleApplicationDeleted(id) {
    setApplications((prev) => prev.filter((a) => a.id !== id));
  }

  useEffect(() => { fetchCompanies(); fetchApplications(); fetchContacts(); fetchOutreach(); }, []);

  useEffect(() => {
    setResearchSelectedId((id) => {
      if (id == null) return id;
      const c = companies.find((x) => x.id === id);
      return c && companyHasResearch(c) ? id : null;
    });
  }, [companies]);

  async function handleImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImporting(true);
    try {
      const text = await file.text();
      let parsed;
      if (file.name.endsWith('.json')) {
        parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) throw new Error('JSON file must be an array of contacts');
      } else {
        parsed = parseCSV(text);
        if (!parsed.length) throw new Error('No valid rows found in CSV');
      }
      const res = await fetch('/api/contacts/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      if (!res.ok) throw new Error('Import failed');
      await fetchCompanies();
    } catch (e) {
      setError(`Import error: ${e.message}`);
    } finally {
      setImporting(false);
    }
  }

  const sorted = [...companies].sort((a, b) => {
    const tierDiff = (TIER_ORDER[a.priorityTier] ?? 99) - (TIER_ORDER[b.priorityTier] ?? 99);
    if (tierDiff !== 0) return tierDiff;
    return b.scores.total - a.scores.total;
  });

  const counts = companies.reduce((acc, c) => {
    acc[c.priorityTier] = (acc[c.priorityTier] || 0) + 1;
    return acc;
  }, {});

  const selectedCompany = companies.find((c) => c.id === selectedId) ?? null;

  function handleSave(updated) {
    setCompanies((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    // Keep flat contacts list in sync when contacts are added/edited via DetailPanel
    fetchContacts();
  }

  function handleExport() {
    const headers = ['id', 'name', 'vertical', 'subsector', 'priority_tier', 'score_interest', 'score_fit', 'score_access', 'score_timing', 'score_total', 'status', 'notes'];
    const escape = (v) => {
      if (v == null) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = companies.map((c) => [
      c.id, c.name, c.vertical, c.subsector ?? '', c.priorityTier ?? '',
      c.scores.interest, c.scores.fit, c.scores.access, c.scores.timing, c.scores.total,
      c.status ?? '', c.notes ?? '',
    ].map(escape).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prospects-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleAdd(created) {
    setCompanies((prev) => [...prev, { ...created, contacts: [] }]);
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      <header className="shrink-0 bg-slate-900/90 border-b border-slate-800 backdrop-blur-sm px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-5 min-w-0">
          <h1 className="text-xl font-bold text-slate-100 tracking-tight shrink-0">Prospect Research</h1>
          <nav className="flex rounded-lg bg-slate-800/80 p-1 ring-1 ring-slate-700/60 shrink-0" aria-label="Main views">
            <button
              type="button"
              onClick={() => setMainView('dashboard')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors
                ${mainView === 'dashboard'
                  ? 'bg-slate-950 text-slate-100 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'}`}
            >
              Dashboard
            </button>
            <button
              type="button"
              onClick={() => setMainView('research')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors
                ${mainView === 'research'
                  ? 'bg-slate-950 text-slate-100 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'}`}
            >
              Research
            </button>
            <button
              type="button"
              onClick={() => setMainView('postings')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors
                ${mainView === 'postings'
                  ? 'bg-slate-950 text-slate-100 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'}`}
            >
              Postings
            </button>
            <button
              type="button"
              onClick={() => setMainView('applications')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors
                ${mainView === 'applications'
                  ? 'bg-slate-950 text-slate-100 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'}`}
            >
              Applications
            </button>
            <button
              type="button"
              onClick={() => setMainView('contacts')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors
                ${mainView === 'contacts'
                  ? 'bg-slate-950 text-slate-100 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'}`}
            >
              Contacts
            </button>
            <button
              type="button"
              onClick={() => setMainView('outreach')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors
                ${mainView === 'outreach'
                  ? 'bg-slate-950 text-slate-100 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'}`}
            >
              Outreach
            </button>
          </nav>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,.json"
            className="hidden"
            onChange={handleImport}
          />
          <button
            onClick={handleExport}
            disabled={companies.length === 0}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg
              border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-50 transition-colors"
          >
            Export CSV
          </button>
          <button
            onClick={() => csvInputRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg
              border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-50 transition-colors"
          >
            {importing ? 'Importing…' : 'Import Contacts'}
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white shadow-lg shadow-teal-950/40 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Company
          </button>
        </div>
      </header>

      {mainView === 'dashboard' ? (
        <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-6">
          {error ? (
            <p className="text-red-400">{error}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 mb-6">
                <span className="text-sm text-slate-400 font-medium">
                  {companies.length} companies
                </span>
                <span className="text-slate-600">|</span>
                {['Tier A', 'Tier B', 'Tier C'].map((tier) => (
                  <StatBadge
                    key={tier}
                    label={tier}
                    count={counts[tier] || 0}
                    styles={TIER_STYLES[tier]}
                  />
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {sorted.map((company) => (
                  <CompanyCard
                    key={company.id}
                    company={company}
                    onClick={() => setSelectedId(company.id)}
                  />
                ))}
              </div>
            </>
          )}
        </main>
      ) : mainView === 'research' ? (
        <div className="flex-1 flex flex-col min-h-0">
          {error ? (
            <p className="text-red-400 px-6 py-4">{error}</p>
          ) : (
            <ResearchWorkspace
              companies={companies}
              selectedId={researchSelectedId}
              setSelectedId={setResearchSelectedId}
              onSave={(partial) => setCompanies((prev) =>
                prev.map((c) => c.id === partial.id ? { ...c, ...partial } : c)
              )}
            />
          )}
        </div>
      ) : mainView === 'postings' ? (
        <div className="flex-1 flex flex-col min-h-0">
          <PostingsWorkspace onApplicationCreated={handleApplicationCreated} />
        </div>
      ) : mainView === 'contacts' ? (
        <div className="flex-1 flex flex-col min-h-0">
          <ContactsWorkspace
            contacts={contacts}
            companies={companies}
            onContactsChange={(updated) => {
              setContacts(updated);
              // Re-fetch so lastTouch etc. stay accurate
              fetchContacts();
            }}
          />
        </div>
      ) : mainView === 'outreach' ? (
        <div className="flex-1 flex flex-col min-h-0">
          <OutreachWorkspace
            outreach={outreach}
            contacts={contacts}
            onOutreachChange={(updated) => {
              setOutreach(updated);
              // Refresh contacts so Last Touch column stays current
              fetchContacts();
            }}
          />
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          <ApplicationsWorkspace
            applications={applications}
            onUpdate={handleApplicationUpdated}
            onDelete={handleApplicationDeleted}
          />
        </div>
      )}

      <DetailPanel
        company={selectedCompany}
        onClose={() => setSelectedId(null)}
        onSave={handleSave}
      />

      {showAddModal && (
        <AddCompanyModal
          onClose={() => setShowAddModal(false)}
          onAdd={handleAdd}
        />
      )}
    </div>
  );
}

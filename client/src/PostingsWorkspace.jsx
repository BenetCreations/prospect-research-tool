import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const TIMEZONES = [
  { value: 'America/Los_Angeles', label: 'Pacific (PT)'         },
  { value: 'America/Denver',      label: 'Mountain (MT)'        },
  { value: 'America/Phoenix',     label: 'Arizona — no DST'     },
  { value: 'America/Chicago',     label: 'Central (CT)'         },
  { value: 'America/New_York',    label: 'Eastern (ET)'         },
  { value: 'America/Anchorage',   label: 'Alaska (AKT)'         },
  { value: 'Pacific/Honolulu',    label: 'Hawaii (HT)'          },
];

function tzShortLabel(tz) {
  return TIMEZONES.find((t) => t.value === tz)?.label ?? tz;
}

const SORT_FIELDS = {
  company_name:       (j) => j.company_name?.toLowerCase() ?? '',
  title:              (j) => j.title?.toLowerCase() ?? '',
  location:           (j) => j.location?.toLowerCase() ?? '',
  department:         (j) => (parseDepts(j.departments)[0] ?? '').toLowerCase(),
  gh_first_published: (j) => j.gh_first_published ?? '',
  first_seen_at:      (j) => j.first_seen_at ?? '',
};

function parseDepts(raw) {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtTime(h, m) {
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function nextRunLabel(frequency, hour, minute) {
  const now = new Date();
  const candidate = new Date(now);
  candidate.setHours(hour, minute, 0, 0);
  if (candidate <= now) candidate.setDate(candidate.getDate() + 1);
  if (frequency === 'weekdays') {
    while (candidate.getDay() === 0 || candidate.getDay() === 6) {
      candidate.setDate(candidate.getDate() + 1);
    }
  }
  const isToday = candidate.toDateString() === now.toDateString();
  const isTomorrow = new Date(now.getTime() + 86400000).toDateString() === candidate.toDateString();
  const dayLabel = isToday ? 'today' : isTomorrow ? 'tomorrow' : candidate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return `${dayLabel} at ${fmtTime(hour, minute)}`;
}

function applySortKeys(jobs, sortKeys) {
  if (!sortKeys.length) return jobs;
  return [...jobs].sort((a, b) => {
    for (const { field, dir } of sortKeys) {
      const fn = SORT_FIELDS[field];
      const av = fn(a);
      const bv = fn(b);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
    }
    return 0;
  });
}

function loadLocalState() {
  try {
    const raw = localStorage.getItem('postings_state');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveLocalState(state) {
  try { localStorage.setItem('postings_state', JSON.stringify(state)); } catch {}
}

// ── Title filter: mode configs ──────────────────────────────────────────────

const TITLE_MODES = [
  {
    id: 'contains',
    label: 'contains',
    colors: 'bg-teal-500/15 text-teal-300 border-teal-500/40 hover:bg-teal-500/25',
  },
  {
    id: 'starts_with',
    label: 'starts with',
    colors: 'bg-violet-500/15 text-violet-300 border-violet-500/40 hover:bg-violet-500/25',
  },
  {
    id: 'excludes',
    label: 'excludes',
    colors: 'bg-rose-500/15 text-rose-300 border-rose-500/40 hover:bg-rose-500/25',
  },
];

function nextMode(current) {
  const idx = TITLE_MODES.findIndex((m) => m.id === current);
  return TITLE_MODES[(idx + 1) % TITLE_MODES.length].id;
}

function modeConfig(id) {
  return TITLE_MODES.find((m) => m.id === id) ?? TITLE_MODES[0];
}

// ── Title filter: data model ─────────────────────────────────────────────────
//
// titleFilter: {
//   groups:   [{ id, op: 'ANY'|'ALL', rules: [{ id, mode, value }] }]
//   groupOps: ['AND'|'OR', ...]   // length = groups.length - 1
// }
//
// Within a group: op='ANY' → OR across rules; op='ALL' → AND across rules.
// Between groups: groupOps[i] connects groups[i] and groups[i+1].

let _idSeq = 1;
const uid = () => _idSeq++;

function newRule() { return { id: uid(), mode: 'contains', value: '' }; }
function newGroup(op = 'ANY') { return { id: uid(), op, rules: [newRule()] }; }

const DEFAULT_TITLE_FILTER = { groups: [newGroup()], groupOps: [] };

function matchesRule(title, rule) {
  const t = (title ?? '').toLowerCase();
  const terms = rule.value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!terms.length) return true; // empty rule passes everything
  if (rule.mode === 'contains')   return terms.some((term) => t.includes(term));
  if (rule.mode === 'starts_with') return terms.some((term) => t.startsWith(term));
  if (rule.mode === 'excludes')   return !terms.some((term) => t.includes(term));
  return true;
}

function matchesTitleFilter(title, titleFilter) {
  const { groups, groupOps } = titleFilter;
  if (!groups?.length) return true;

  const groupResults = groups.map((g) => {
    const activeRules = g.rules.filter((r) => r.value.trim());
    if (!activeRules.length) return true;
    const results = activeRules.map((r) => matchesRule(title, r));
    return g.op === 'ALL' ? results.every(Boolean) : results.some(Boolean);
  });

  // Combine group results with explicit operators
  let result = groupResults[0];
  for (let i = 0; i < (groupOps ?? []).length; i++) {
    result = groupOps[i] === 'AND'
      ? result && groupResults[i + 1]
      : result || groupResults[i + 1];
  }
  return result;
}

// Re-assigns all group/rule IDs via uid() so React keys are fresh after loading a saved search
function normalizeTitleFilter(tf) {
  return {
    groupOps: tf.groupOps ?? [],
    groups: (tf.groups?.length ? tf.groups : [newGroup()]).map((g) => ({
      ...g,
      id: uid(),
      rules: (g.rules?.length ? g.rules : [newRule()]).map((r) => ({ ...r, id: uid() })),
    })),
  };
}

// ── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_FILTERS = {
  newOnly: false,
  titleFilter: DEFAULT_TITLE_FILTER,
  location: '',
  department: '',
  showClosed: false,
};

const DEFAULT_SORT = [{ field: 'first_seen_at', dir: 'desc' }];

// Rank indicator characters ①–⑨
const RANK_CHARS = ['①', '②', '③', '④', '⑤'];

export default function PostingsWorkspace({ onApplicationCreated }) {
  const [jobs, setJobs] = useState([]);
  const [ghCompanies, setGhCompanies] = useState([]);
  const [lastRun, setLastRun] = useState(null);
  const [appliedPostingIds, setAppliedPostingIds] = useState(new Set());
  const [scheduleEdit, setScheduleEdit] = useState(null);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleSaved, setScheduleSaved] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [savedSearches, setSavedSearches] = useState([]);
  const [saveSearchName, setSaveSearchName] = useState('');
  const [savingSearch, setSavingSearch] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [companiesOpen, setCompaniesOpen] = useState(false);

  // Restore persisted state
  const persisted = useMemo(() => loadLocalState(), []);
  const [filters, setFilters] = useState(() => {
    if (!persisted?.filters) return DEFAULT_FILTERS;
    const saved = { ...DEFAULT_FILTERS, ...persisted.filters };
    // Migrate old flat titleKeyword / titleFilters shapes → grouped titleFilter
    if (typeof saved.titleKeyword === 'string' || Array.isArray(saved.titleFilters)) {
      const oldVal = typeof saved.titleKeyword === 'string' ? saved.titleKeyword : '';
      const g = newGroup();
      g.rules[0].value = oldVal;
      saved.titleFilter = { groups: [g], groupOps: [] };
      delete saved.titleKeyword;
      delete saved.titleFilters;
    }
    // Ensure titleFilter has at least one group with one rule
    if (!saved.titleFilter?.groups?.length) {
      saved.titleFilter = { groups: [newGroup()], groupOps: [] };
    }
    return saved;
  });
  const [sortKeys, setSortKeys] = useState(() => persisted?.sortKeys ?? DEFAULT_SORT);
  const [enabledCompanies, setEnabledCompanies] = useState(null); // null = all; Set populated after companies load

  // Persist filters + sort whenever they change
  useEffect(() => {
    saveLocalState({
      filters,
      sortKeys,
      enabledCompanies: enabledCompanies ? [...enabledCompanies] : null,
    });
  }, [filters, sortKeys, enabledCompanies]);

  const loadData = useCallback(async () => {
    try {
      const [jobsRes, companiesRes, runsRes, schedRes, savedRes, appliedRes] = await Promise.all([
        fetch('/api/job-postings?status=all'),
        fetch('/api/companies/greenhouse'),
        fetch('/api/job-postings/runs'),
        fetch('/api/settings/fetch-schedule'),
        fetch('/api/saved-searches'),
        fetch('/api/applications/posting-ids'),
      ]);
      const [jobsData, companiesData, runsData, schedData, savedData, appliedData] = await Promise.all([
        jobsRes.json(), companiesRes.json(), runsRes.json(), schedRes.json(), savedRes.json(), appliedRes.json(),
      ]);
      setJobs(jobsData);
      setGhCompanies(companiesData);
      setLastRun(runsData[0] ?? null);
      setScheduleEdit(schedData);
      setSavedSearches(savedData);
      setAppliedPostingIds(new Set(appliedData));
      // Initialize enabled companies from persisted state or default all
      setEnabledCompanies((prev) => {
        if (prev !== null) return prev;
        const saved = persisted?.enabledCompanies;
        if (saved) return new Set(saved);
        return new Set(companiesData.map((c) => c.id));
      });
    } catch (e) {
      console.error('PostingsWorkspace load error:', e);
    } finally {
      setLoading(false);
    }
  }, [persisted]);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleRunNow() {
    setFetching(true);
    try {
      await fetch('/api/job-postings/fetch', { method: 'POST' });
      await loadData();
    } finally {
      setFetching(false);
    }
  }

  async function handleFlagApplication(job) {
    setAppliedPostingIds((prev) => new Set([...prev, job.id]));
    try {
      const res = await fetch('/api/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobPostingId: job.id,
          companyId:    job.company_id,
          companyName:  job.company_name,
          roleTitle:    job.title,
          roleId:       String(job.greenhouse_id),
        }),
      });
      if (res.status === 409) return;
      if (!res.ok) throw new Error('Failed to create application');
      onApplicationCreated?.(await res.json());
    } catch (e) {
      setAppliedPostingIds((prev) => {
        const next = new Set(prev);
        next.delete(job.id);
        return next;
      });
      console.error('Flag application error:', e);
    }
  }

  async function handleSaveSchedule() {
    setScheduleSaving(true);
    try {
      const res = await fetch('/api/settings/fetch-schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...scheduleEdit,
          timezone: scheduleEdit.timezone ?? 'America/Los_Angeles',
          savedSearchId: scheduleEdit.savedSearchId ?? null,
          emailTo: scheduleEdit.emailTo?.trim() || null,
          emailSubjectWithJobs: scheduleEdit.emailSubjectWithJobs?.trim() || null,
          emailSubjectNoJobs: scheduleEdit.emailSubjectNoJobs?.trim() || null,
        }),
      });
      const updated = await res.json();
      setScheduleEdit(updated);
      setScheduleSaved(true);
      setTimeout(() => setScheduleSaved(false), 2500);
    } finally {
      setScheduleSaving(false);
    }
  }

  function handleApplySavedSearch(search) {
    const parsed = JSON.parse(search.filters);
    setFilters({
      ...DEFAULT_FILTERS,
      ...parsed,
      titleFilter: normalizeTitleFilter(parsed.titleFilter ?? { groups: [newGroup()], groupOps: [] }),
    });
  }

  async function handleSaveSearch() {
    if (!saveSearchName.trim()) return;
    setSavingSearch(true);
    try {
      const { titleFilter, location, department, newOnly, showClosed } = filters;
      const payload = {
        name: saveSearchName.trim(),
        filters: { titleFilter, location, department, newOnly, showClosed },
      };
      const res = await fetch('/api/saved-searches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const created = await res.json();
      setSavedSearches((prev) => [created, ...prev]);
      setSaveSearchName('');
    } finally {
      setSavingSearch(false);
    }
  }

  async function handleDeleteSavedSearch(id) {
    await fetch(`/api/saved-searches/${id}`, { method: 'DELETE' });
    setSavedSearches((prev) => prev.filter((s) => s.id !== id));
    if (scheduleEdit?.savedSearchId === id) {
      setScheduleEdit((s) => ({ ...s, savedSearchId: null }));
    }
  }

  // --- Filtering ---
  const filteredJobs = useMemo(() => {
    let result = jobs;

    // Status: hide closed unless showClosed
    if (!filters.showClosed) {
      result = result.filter((j) => j.status === 'active');
    }

    // New only
    if (filters.newOnly) {
      result = result.filter((j) => j.is_new === 1);
    }

    // Title filter (grouped query builder)
    const tf = filters.titleFilter;
    if (tf?.groups?.some((g) => g.rules.some((r) => r.value.trim()))) {
      result = result.filter((j) => matchesTitleFilter(j.title, tf));
    }

    // Location — comma-separated terms, OR logic
    if (filters.location.trim()) {
      const locs = filters.location.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      result = result.filter((j) => locs.some((loc) => j.location?.toLowerCase().includes(loc)));
    }

    // Department — comma-separated terms, OR logic
    if (filters.department.trim()) {
      const depts = filters.department.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      result = result.filter((j) =>
        parseDepts(j.departments).some((d) => depts.some((term) => d.toLowerCase().includes(term)))
      );
    }

    // Company filter
    if (enabledCompanies !== null) {
      result = result.filter((j) => enabledCompanies.has(j.company_id));
    }

    return result;
  }, [jobs, filters, enabledCompanies]);

  // --- Sorting ---
  const displayedJobs = useMemo(() => applySortKeys(filteredJobs, sortKeys), [filteredJobs, sortKeys]);

  // --- Sort header click ---
  function handleSortClick(field, e) {
    const shift = e.shiftKey;
    setSortKeys((prev) => {
      const idx = prev.findIndex((k) => k.field === field);
      if (shift) {
        // Shift+click: toggle in place or append
        if (idx === -1) return [...prev, { field, dir: 'asc' }];
        const cur = prev[idx];
        if (cur.dir === 'asc') return prev.map((k, i) => i === idx ? { ...k, dir: 'desc' } : k);
        return prev.filter((_, i) => i !== idx);
      } else {
        // Regular click: reset to single sort key, cycle if same field
        if (idx === -1 || prev.length > 1) return [{ field, dir: 'asc' }];
        const cur = prev[0];
        if (cur.dir === 'asc') return [{ field, dir: 'desc' }];
        return [{ field, dir: 'asc' }]; // wrap back to asc
      }
    });
  }

  function SortHeader({ field, label }) {
    const idx = sortKeys.findIndex((k) => k.field === field);
    const active = idx !== -1;
    const dir = active ? sortKeys[idx].dir : null;
    return (
      <th
        scope="col"
        onClick={(e) => handleSortClick(field, e)}
        className="px-3 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider
          cursor-pointer select-none hover:text-slate-200 transition-colors whitespace-nowrap"
      >
        <span className="flex items-center gap-1">
          {label}
          {active && (
            <span className="flex items-center gap-0.5 text-teal-400">
              {dir === 'asc'
                ? <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                : <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
              }
              {sortKeys.length > 1 && (
                <span className="text-[10px] leading-none">{RANK_CHARS[idx] ?? idx + 1}</span>
              )}
            </span>
          )}
          {!active && (
            <svg className="w-3 h-3 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          )}
        </span>
      </th>
    );
  }

  function toggleCompany(id) {
    setEnabledCompanies((prev) => {
      const next = new Set(prev ?? ghCompanies.map((c) => c.id));
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAllCompanies() {
    const allIds = new Set(ghCompanies.map((c) => c.id));
    const allEnabled = enabledCompanies !== null && ghCompanies.every((c) => enabledCompanies.has(c.id));
    setEnabledCompanies(allEnabled ? new Set() : allIds);
  }

  const selectAllCompaniesRef = useRef(null);
  const allCompaniesSelected = ghCompanies.length > 0 && ghCompanies.every((c) => enabledCompanies?.has(c.id));
  const someCompaniesSelected = ghCompanies.some((c) => enabledCompanies?.has(c.id)) && !allCompaniesSelected;
  const enabledCount = ghCompanies.filter((c) => enabledCompanies?.has(c.id)).length;
  const totalCount = ghCompanies.length;
  useEffect(() => {
    if (selectAllCompaniesRef.current) {
      selectAllCompaniesRef.current.indeterminate = someCompaniesSelected;
    }
  }, [someCompaniesSelected]);

  const newCount = jobs.filter((j) => j.is_new === 1 && j.status === 'active').length;

  return (
    <div className="flex flex-1 min-h-0 w-full max-w-[1800px] mx-auto">

      {/* ── Left sidebar ── */}
      <aside className="w-80 shrink-0 border-r border-slate-800 bg-slate-900/40 flex flex-col overflow-y-auto min-h-[calc(100vh-4.25rem)]">

        {/* Run controls */}
        <div className="p-4 border-b border-slate-800">
          <button
            onClick={handleRunNow}
            disabled={fetching}
            className="w-full flex items-center justify-center gap-2 text-sm font-medium px-3 py-2 rounded-md
              bg-teal-600 hover:bg-teal-500 disabled:opacity-60 text-white transition-colors"
          >
            {fetching ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Fetching…
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Run Now
              </>
            )}
          </button>

          {lastRun ? (
            <div className="mt-3 space-y-1">
              <p className="text-xs text-slate-500">Last run: {fmtDate(lastRun.run_at)}</p>
              <div className="flex gap-3 text-xs">
                <span className="text-slate-400">{lastRun.jobs_found ?? 0} active</span>
                {lastRun.new_jobs > 0 && (
                  <span className="text-teal-400 font-medium">+{lastRun.new_jobs} new</span>
                )}
                {lastRun.closed_jobs > 0 && (
                  <span className="text-slate-500">{lastRun.closed_jobs} closed</span>
                )}
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-600 mt-3">No fetch runs yet.</p>
          )}
        </div>

        {/* Schedule */}
        <div className="p-4 border-b border-slate-800">
          <button
            onClick={() => setScheduleOpen((o) => !o)}
            className="w-full flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider mb-0 hover:text-slate-400 transition-colors"
          >
            <span>Schedule</span>
            <svg
              className={`w-3.5 h-3.5 transition-transform ${scheduleOpen ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {scheduleEdit && (
            <p className="text-xs text-slate-500 mt-1.5">
              {scheduleEdit.frequency === 'weekdays' ? 'Weekdays' : 'Daily'} at {fmtTime(scheduleEdit.hour, scheduleEdit.minute)}
              {' '}
              <span className="text-slate-600">{tzShortLabel(scheduleEdit.timezone)}</span>
              {' · '}next {nextRunLabel(scheduleEdit.frequency, scheduleEdit.hour, scheduleEdit.minute)}
            </p>
          )}
          {scheduleOpen && scheduleEdit && (
            <div className="space-y-3 mt-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Frequency</label>
                <select
                  value={scheduleEdit.frequency}
                  onChange={(e) => setScheduleEdit((s) => ({ ...s, frequency: e.target.value }))}
                  className="w-full text-sm bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-slate-200 focus:outline-none focus:border-teal-500"
                >
                  <option value="daily">Every day</option>
                  <option value="weekdays">Weekdays only</option>
                </select>
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-xs text-slate-400 mb-1">Hour</label>
                  <select
                    value={scheduleEdit.hour}
                    onChange={(e) => setScheduleEdit((s) => ({ ...s, hour: Number(e.target.value) }))}
                    className="w-full text-sm bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-slate-200 focus:outline-none focus:border-teal-500"
                  >
                    {Array.from({ length: 24 }, (_, i) => {
                      const ampm = i < 12 ? 'AM' : 'PM';
                      const h = i % 12 === 0 ? 12 : i % 12;
                      return <option key={i} value={i}>{h} {ampm}</option>;
                    })}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-slate-400 mb-1">Minute</label>
                  <select
                    value={scheduleEdit.minute}
                    onChange={(e) => setScheduleEdit((s) => ({ ...s, minute: Number(e.target.value) }))}
                    className="w-full text-sm bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-slate-200 focus:outline-none focus:border-teal-500"
                  >
                    {[0, 15, 30, 45].map((m) => (
                      <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Timezone</label>
                <select
                  value={scheduleEdit.timezone ?? 'America/Los_Angeles'}
                  onChange={(e) => setScheduleEdit((s) => ({ ...s, timezone: e.target.value }))}
                  className="w-full text-sm bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-slate-200 focus:outline-none focus:border-teal-500"
                >
                  {TIMEZONES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Filter (optional)</label>
                <select
                  value={scheduleEdit.savedSearchId ?? ''}
                  onChange={(e) => setScheduleEdit((s) => ({
                    ...s,
                    savedSearchId: e.target.value ? Number(e.target.value) : null,
                  }))}
                  className="w-full text-sm bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-slate-200 focus:outline-none focus:border-teal-500"
                >
                  <option value="">None — fetch all</option>
                  {savedSearches.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Email digest to</label>
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={scheduleEdit.emailTo ?? ''}
                  onChange={(e) => setScheduleEdit((s) => ({ ...s, emailTo: e.target.value }))}
                  className="w-full text-sm bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-teal-500"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Subject — with new jobs</label>
                <input
                  type="text"
                  placeholder="(X) New Job Postings"
                  value={scheduleEdit.emailSubjectWithJobs ?? ''}
                  onChange={(e) => setScheduleEdit((s) => ({ ...s, emailSubjectWithJobs: e.target.value }))}
                  className="w-full text-sm bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-teal-500"
                />
                <p className="text-[11px] text-slate-600 mt-1"><span className="text-slate-400 font-mono">(X)</span> is replaced with the posting count (e.g. "(X) New Jobs" → "4 New Jobs")</p>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Subject — no new jobs</label>
                <input
                  type="text"
                  placeholder="Zero New Job Postings"
                  value={scheduleEdit.emailSubjectNoJobs ?? ''}
                  onChange={(e) => setScheduleEdit((s) => ({ ...s, emailSubjectNoJobs: e.target.value }))}
                  className="w-full text-sm bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-teal-500"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSaveSchedule}
                  disabled={scheduleSaving}
                  className="flex-1 text-sm font-medium px-3 py-1.5 rounded-md
                    bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-50 transition-colors"
                >
                  {scheduleSaving ? 'Saving…' : 'Save Schedule'}
                </button>
                {scheduleSaved && (
                  <span className="text-xs text-teal-400 font-medium">Saved</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Saved Searches */}
        <div className="p-4 border-b border-slate-800">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Saved Searches</h3>

          {savedSearches.length === 0 ? (
            <p className="text-xs text-slate-600 mb-3">No saved searches yet.</p>
          ) : (
            <div className="space-y-1.5 mb-3">
              {savedSearches.map((s) => (
                <div key={s.id} className="flex items-center gap-1.5 group">
                  <button
                    onClick={() => handleApplySavedSearch(s)}
                    className="flex-1 text-left text-xs text-slate-300 hover:text-teal-300 truncate transition-colors"
                    title={s.name}
                  >
                    {s.name}
                  </button>
                  <button
                    onClick={() => handleApplySavedSearch(s)}
                    className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-slate-700 hover:bg-teal-600 text-slate-400 hover:text-white transition-colors"
                  >
                    apply
                  </button>
                  <button
                    onClick={() => handleDeleteSavedSearch(s.id)}
                    className="shrink-0 text-slate-600 hover:text-rose-400 transition-colors"
                    title="Delete saved search"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-1.5">
            <input
              type="text"
              value={saveSearchName}
              onChange={(e) => setSaveSearchName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveSearch()}
              placeholder="Name this search…"
              className="flex-1 min-w-0 text-xs bg-slate-800 border border-slate-700 rounded px-2 py-1.5
                text-slate-200 placeholder-slate-600 focus:outline-none focus:border-teal-500"
            />
            <button
              onClick={handleSaveSearch}
              disabled={savingSearch || !saveSearchName.trim()}
              className="shrink-0 text-xs font-medium px-2.5 py-1.5 rounded
                bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-40 transition-colors"
            >
              {savingSearch ? '…' : 'Save'}
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="p-4 space-y-4 flex-1">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Filters</h3>

          {/* Toggles */}
          <div className="space-y-2">
            {[
              { key: 'newOnly', label: 'New only' },
              { key: 'showClosed', label: 'Show closed' },
            ].map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2.5 cursor-pointer group">
                <span className={`relative inline-flex h-4.5 w-8 shrink-0 items-center rounded-full transition-colors
                  ${filters[key] ? 'bg-teal-500' : 'bg-slate-700 group-hover:bg-slate-600'}`}
                  style={{ height: '18px', width: '32px' }}
                >
                  <input
                    type="checkbox"
                    checked={filters[key]}
                    onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.checked }))}
                    className="sr-only"
                  />
                  <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform
                    ${filters[key] ? 'translate-x-4' : 'translate-x-1'}`}
                  />
                </span>
                <span className="text-sm text-slate-300">{label}</span>
              </label>
            ))}
          </div>

          {/* Title filter — grouped query builder */}
          <div>
            <label className="block text-xs text-slate-400 mb-2">Title</label>

            {/* Helper to update titleFilter immutably */}
            {(() => {
              const tf = filters.titleFilter ?? { groups: [newGroup()], groupOps: [] };

              const setTf = (updater) =>
                setFilters((f) => ({ ...f, titleFilter: updater(f.titleFilter ?? { groups: [newGroup()], groupOps: [] }) }));

              const addGroup = () => setTf((tf) => ({
                groups: [...tf.groups, newGroup()],
                groupOps: [...(tf.groupOps ?? []), 'AND'],
              }));

              const removeGroup = (gid) => setTf((tf) => {
                const idx = tf.groups.findIndex((g) => g.id === gid);
                const groups = tf.groups.filter((g) => g.id !== gid);
                const groupOps = (tf.groupOps ?? []).filter((_, i) => i !== idx && i !== idx - 1)
                  // keep the op that survives: if removing middle group, drop one op
                  .slice(0, groups.length - 1);
                return { groups: groups.length ? groups : [newGroup()], groupOps };
              });

              const toggleGroupOp = (gid) => setTf((tf) => {
                const idx = tf.groups.findIndex((g) => g.id === gid);
                // groupOps[idx - 1] is the op BEFORE this group
                const ops = [...(tf.groupOps ?? [])];
                ops[idx - 1] = ops[idx - 1] === 'AND' ? 'OR' : 'AND';
                return { ...tf, groupOps: ops };
              });

              const toggleGroupInternalOp = (gid) => setTf((tf) => ({
                ...tf,
                groups: tf.groups.map((g) => g.id === gid ? { ...g, op: g.op === 'ANY' ? 'ALL' : 'ANY' } : g),
              }));

              const addRule = (gid) => setTf((tf) => ({
                ...tf,
                groups: tf.groups.map((g) => g.id === gid ? { ...g, rules: [...g.rules, newRule()] } : g),
              }));

              const removeRule = (gid, rid) => setTf((tf) => ({
                ...tf,
                groups: tf.groups.map((g) => {
                  if (g.id !== gid) return g;
                  const rules = g.rules.filter((r) => r.id !== rid);
                  return { ...g, rules: rules.length ? rules : [newRule()] };
                }),
              }));

              const updateRule = (gid, rid, patch) => setTf((tf) => ({
                ...tf,
                groups: tf.groups.map((g) =>
                  g.id === gid
                    ? { ...g, rules: g.rules.map((r) => r.id === rid ? { ...r, ...patch } : r) }
                    : g
                ),
              }));

              return (
                <div className="space-y-1.5">
                  {tf.groups.map((group, gi) => (
                    <div key={group.id}>
                      {/* Inter-group operator (shown above every group except the first) */}
                      {gi > 0 && (
                        <div className="flex justify-center my-1.5">
                          <button
                            onClick={() => toggleGroupOp(group.id)}
                            className="text-[10px] font-bold px-2.5 py-0.5 rounded-full border
                              bg-amber-500/10 text-amber-300 border-amber-500/35 hover:bg-amber-500/20
                              transition-colors tracking-widest"
                          >
                            {(tf.groupOps ?? [])[gi - 1] ?? 'AND'}
                          </button>
                        </div>
                      )}

                      {/* Group card */}
                      <div className="rounded-lg border border-slate-700/70 bg-slate-800/40 p-2 space-y-1.5">
                        {/* Group header: internal op + remove */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1 text-[10px] text-slate-500">
                            <span>Match</span>
                            <button
                              onClick={() => toggleGroupInternalOp(group.id)}
                              className={`font-bold px-1.5 py-0.5 rounded border transition-colors
                                ${group.op === 'ANY'
                                  ? 'bg-teal-500/15 text-teal-300 border-teal-500/40 hover:bg-teal-500/25'
                                  : 'bg-violet-500/15 text-violet-300 border-violet-500/40 hover:bg-violet-500/25'
                                }`}
                            >
                              {group.op === 'ANY' ? 'ANY' : 'ALL'}
                            </button>
                            <span>of:</span>
                          </div>
                          {tf.groups.length > 1 && (
                            <button
                              onClick={() => removeGroup(group.id)}
                              className="text-slate-600 hover:text-rose-400 transition-colors"
                              title="Remove group"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          )}
                        </div>

                        {/* Rules */}
                        {group.rules.map((rule) => {
                          const mc = modeConfig(rule.mode);
                          return (
                            <div key={rule.id} className="flex items-center gap-1">
                              <button
                                onClick={() => updateRule(group.id, rule.id, { mode: nextMode(rule.mode) })}
                                title="Click to change match type"
                                className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded border
                                  transition-colors whitespace-nowrap ${mc.colors}`}
                              >
                                {mc.label}
                              </button>
                              <input
                                type="text"
                                value={rule.value}
                                onChange={(e) => updateRule(group.id, rule.id, { value: e.target.value })}
                                placeholder={rule.mode === 'excludes' ? 'e.g. law firm' : 'e.g. partner, bd'}
                                className="min-w-0 flex-1 text-xs bg-slate-900 border border-slate-700 rounded
                                  px-2 py-1 text-slate-200 placeholder-slate-600
                                  focus:outline-none focus:border-teal-500"
                              />
                              {group.rules.length > 1 && (
                                <button
                                  onClick={() => removeRule(group.id, rule.id)}
                                  className="shrink-0 text-slate-600 hover:text-rose-400 transition-colors"
                                  title="Remove rule"
                                >
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              )}
                            </div>
                          );
                        })}

                        {/* Add rule inside group */}
                        <button
                          onClick={() => addRule(group.id)}
                          className="flex items-center gap-0.5 text-[10px] text-slate-500 hover:text-teal-400 transition-colors mt-0.5"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                          Add rule
                        </button>
                      </div>
                    </div>
                  ))}

                  {/* Add group */}
                  <button
                    onClick={addGroup}
                    className="flex items-center gap-0.5 text-[10px] text-slate-500 hover:text-teal-400 transition-colors"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add group
                  </button>
                </div>
              );
            })()}
          </div>

          {/* Location + Department filters */}
          {[
            { key: 'location',   label: 'Location',   placeholder: 'Seattle, Redmond (comma = OR)' },
            { key: 'department', label: 'Department',  placeholder: 'Sales, Partnerships (comma = OR)' },
          ].map(({ key, label, placeholder }) => (
            <div key={key}>
              <label className="block text-xs text-slate-400 mb-1">{label}</label>
              <input
                type="text"
                value={filters[key]}
                onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.value }))}
                placeholder={placeholder}
                className="w-full text-sm bg-slate-800 border border-slate-700 rounded px-2.5 py-1.5
                  text-slate-200 placeholder-slate-600 focus:outline-none focus:border-teal-500"
              />
            </div>
          ))}

          {/* Company filter */}
          <div>
            <button
              type="button"
              onClick={() => setCompaniesOpen((o) => !o)}
              className="w-full flex items-center justify-between group mb-1"
            >
              <span className="text-xs text-slate-400">Companies</span>
              <span className="flex items-center gap-1.5">
                {totalCount > 0 && (
                  <span className={`text-[10px] tabular-nums ${
                    enabledCount === totalCount ? 'text-slate-600' : 'text-violet-400 font-medium'
                  }`}>
                    {enabledCount}/{totalCount}
                  </span>
                )}
                <svg
                  className={`w-3 h-3 text-slate-600 group-hover:text-slate-400 transition-transform transition-colors ${
                    companiesOpen ? 'rotate-180' : ''
                  }`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </span>
            </button>
            {companiesOpen && (
              <div className="space-y-1.5 mt-1">
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    ref={selectAllCompaniesRef}
                    type="checkbox"
                    checked={allCompaniesSelected}
                    onChange={toggleAllCompanies}
                    className="w-3.5 h-3.5 rounded border-slate-600 bg-slate-800 cursor-pointer accent-violet-500"
                  />
                  <span className="text-xs text-slate-500 group-hover:text-slate-300 transition-colors">Select all</span>
                </label>
                {ghCompanies.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={enabledCompanies?.has(c.id) ?? true}
                      onChange={() => toggleCompany(c.id)}
                      className="w-3.5 h-3.5 rounded border-slate-600 bg-slate-800 cursor-pointer accent-violet-500"
                    />
                    <span className="text-sm text-slate-300 group-hover:text-slate-100 transition-colors">{c.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col min-w-0 bg-slate-950 overflow-hidden">

        {/* Stats bar */}
        <div className="shrink-0 px-6 py-3 border-b border-slate-800 flex items-center gap-4">
          <span className="text-sm text-slate-400">
            {displayedJobs.length} posting{displayedJobs.length !== 1 ? 's' : ''}
            {filteredJobs.length !== displayedJobs.length ? '' : ''}
          </span>
          {newCount > 0 && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-teal-500/15 text-teal-300 border border-teal-500/35">
              {newCount} new
            </span>
          )}
          {sortKeys.length > 0 && (
            <span className="text-xs text-slate-600 ml-auto">
              Sorted by {sortKeys.map((k) => k.field.replace('_', ' ')).join(' › ')}
              {' · '}
              <button
                onClick={() => setSortKeys(DEFAULT_SORT)}
                className="text-slate-500 hover:text-slate-300 transition-colors"
              >
                reset
              </button>
            </span>
          )}
          <span className="text-xs text-slate-600 ml-auto">
            Shift+click column headers for multi-sort
          </span>
        </div>

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center h-48 text-slate-500 text-sm">Loading…</div>
          ) : displayedJobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2">
              <p className="text-slate-400 text-sm">No matching postings.</p>
              <p className="text-slate-600 text-xs">Adjust your filters or click Run Now to fetch jobs.</p>
            </div>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 bg-slate-900 z-10 border-b border-slate-800">
                <tr>
                  <SortHeader field="company_name" label="Company" />
                  <SortHeader field="title"        label="Title" />
                  <SortHeader field="location"     label="Location" />
                  <SortHeader field="department"   label="Department" />
                  <SortHeader field="gh_first_published" label="Posted" />
                  <SortHeader field="first_seen_at" label="First Seen" />
                  <th scope="col" className="px-3 py-2.5 w-28" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {displayedJobs.map((job) => {
                  const depts = parseDepts(job.departments);
                  return (
                    <tr
                      key={job.id}
                      className="hover:bg-slate-900/60 transition-colors group"
                    >
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className="text-slate-300 font-medium">{job.company_name}</span>
                      </td>
                      <td className="px-3 py-2.5 max-w-xs">
                        <a
                          href={job.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-slate-100 hover:text-teal-300 transition-colors font-medium leading-snug"
                        >
                          {job.title}
                        </a>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-slate-400">
                        {job.location ?? '—'}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {depts.length > 0
                            ? depts.map((d) => (
                                <span key={d} className="text-xs px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/60">
                                  {d}
                                </span>
                              ))
                            : <span className="text-slate-600">—</span>
                          }
                        </div>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-slate-500 text-xs">
                        {job.gh_first_published ? fmtDate(job.gh_first_published) : '—'}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-slate-500 text-xs">
                        {fmtDate(job.first_seen_at)}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 justify-end">
                          {job.is_new === 1 && (
                            <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-teal-500/15 text-teal-300 border border-teal-500/35">
                              New
                            </span>
                          )}
                          {job.status === 'closed' && (
                            <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/25">
                              Closed
                            </span>
                          )}
                          {appliedPostingIds.has(job.id) ? (
                            <span className="text-xs font-medium px-2 py-0.5 rounded bg-violet-500/15 text-violet-300 border border-violet-500/35">
                              Saved.
                            </span>
                          ) : (
                            <button
                              onClick={() => handleFlagApplication(job)}
                              title="Save to Applications"
                              className="opacity-0 group-hover:opacity-100 transition-opacity text-xs font-medium px-2 py-0.5 rounded border border-slate-600 text-slate-400 hover:border-violet-500/60 hover:text-violet-300 hover:bg-violet-500/10 transition-colors"
                            >
                              Save
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

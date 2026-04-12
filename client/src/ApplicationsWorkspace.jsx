import { useEffect, useMemo, useRef, useState } from 'react';

const STAGES = [
  'Drafting',
  'Applied',
  'Recruiter Screen',
  'Hiring Manager',
  'Interviewing',
  'Final Round',
  'Offer',
  'Rejected',
];

const STAGE_STYLES = {
  'Drafting':         'bg-slate-700/60 text-slate-400 border-slate-600/60',
  'Applied':          'bg-blue-500/15 text-blue-300 border-blue-500/35',
  'Recruiter Screen': 'bg-sky-500/15 text-sky-300 border-sky-500/35',
  'Hiring Manager':   'bg-cyan-500/15 text-cyan-300 border-cyan-500/35',
  'Interviewing':     'bg-teal-500/15 text-teal-300 border-teal-500/35',
  'Final Round':      'bg-violet-500/15 text-violet-300 border-violet-500/35',
  'Offer':            'bg-emerald-500/15 text-emerald-300 border-emerald-500/35',
  'Rejected':         'bg-red-500/10 text-red-400 border-red-500/25',
};

function fmtDate(iso) {
  if (!iso) return '—';
  const [year, month, day] = iso.split('-');
  const d = new Date(Number(year), Number(month) - 1, Number(day));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const SORT_FNS = {
  company_name: (a) => a.companyName.toLowerCase(),
  role_title:   (a) => a.roleTitle.toLowerCase(),
  role_id:      (a) => a.roleId ?? '',
  date_applied: (a) => a.dateApplied ?? '',
  referral:     (a) => (a.referral ? 1 : 0),
  stage:        (a) => STAGES.indexOf(a.stage),
  created_at:   (a) => a.createdAt,
};

const DEFAULT_SORT = [{ field: 'created_at', dir: 'desc' }];
const RANK_CHARS = ['①', '②', '③', '④', '⑤'];

function applySortKeys(apps, sortKeys) {
  if (!sortKeys.length) return apps;
  return [...apps].sort((a, b) => {
    for (const { field, dir } of sortKeys) {
      const fn = SORT_FNS[field];
      const av = fn ? fn(a) : '';
      const bv = fn ? fn(b) : '';
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
    }
    return 0;
  });
}

export default function ApplicationsWorkspace({ applications, onUpdate, onDelete }) {
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [stageFilter, setStageFilter] = useState('saved');
  const [sortKeys, setSortKeys] = useState(DEFAULT_SORT);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [deleting, setDeleting] = useState(false);
  const selectAllRef = useRef(null);

  function handleSortClick(field, e) {
    const shift = e.shiftKey;
    setSortKeys((prev) => {
      const idx = prev.findIndex((k) => k.field === field);
      if (shift) {
        if (idx === -1) return [...prev, { field, dir: 'asc' }];
        const cur = prev[idx];
        if (cur.dir === 'asc') return prev.map((k, i) => i === idx ? { ...k, dir: 'desc' } : k);
        return prev.filter((_, i) => i !== idx);
      } else {
        if (idx === -1 || prev.length > 1) return [{ field, dir: 'asc' }];
        const cur = prev[0];
        if (cur.dir === 'asc') return [{ field, dir: 'desc' }];
        return [{ field, dir: 'asc' }];
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
        className="px-3 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider cursor-pointer select-none hover:text-slate-200 transition-colors whitespace-nowrap"
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

  function startEdit(app) {
    setEditingId(app.id);
    setEditDraft({
      roleTitle:   app.roleTitle,
      roleId:      app.roleId ?? '',
      dateApplied: app.dateApplied ?? '',
      referral:    app.referral,
      stage:       app.stage,
      notes:       app.notes ?? '',
    });
  }

  async function commitEdit() {
    if (!editingId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/applications/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...editDraft,
          dateApplied: editDraft.dateApplied || null,
          roleId:      editDraft.roleId || null,
          notes:       editDraft.notes || null,
        }),
      });
      if (!res.ok) throw new Error('Save failed');
      onUpdate(await res.json());
      setEditingId(null);
      setEditDraft({});
    } catch (e) {
      console.error('Application save error:', e);
    } finally {
      setSaving(false);
    }
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft({});
  }

  async function handleToggleReferral(app) {
    const res = await fetch(`/api/applications/${app.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roleTitle:   app.roleTitle,
        roleId:      app.roleId ?? null,
        dateApplied: app.dateApplied ?? null,
        referral:    !app.referral,
        stage:       app.stage,
        notes:       app.notes ?? null,
      }),
    });
    if (res.ok) onUpdate(await res.json());
  }

  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    const visibleIds = sorted.map((a) => a.id);
    const allSelected = visibleIds.every((id) => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        visibleIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => new Set([...prev, ...visibleIds]));
    }
  }

  async function handleDeleteSelected() {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    if (!window.confirm(`Remove ${count} application${count !== 1 ? 's' : ''}?`)) return;
    setDeleting(true);
    try {
      await Promise.all(
        [...selectedIds].map((id) => fetch(`/api/applications/${id}`, { method: 'DELETE' }))
      );
      selectedIds.forEach((id) => onDelete(id));
      setSelectedIds(new Set());
    } finally {
      setDeleting(false);
    }
  }

  const activeCount = applications.filter(
    (a) => a.stage !== 'Rejected' && a.stage !== 'Offer'
  ).length;
  const offerCount = applications.filter((a) => a.stage === 'Offer').length;

  const sorted = useMemo(() => {
    const filtered =
      stageFilter === 'saved'
        ? applications
        : applications.filter((a) => a.stage === stageFilter);
    return applySortKeys(filtered, sortKeys);
  }, [applications, stageFilter, sortKeys]);

  // Drive the select-all checkbox indeterminate state
  const visibleIds = sorted.map((a) => a.id);
  const selectedVisibleCount = visibleIds.filter((id) => selectedIds.has(id)).length;
  const allVisibleSelected = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected;
    }
  }, [someVisibleSelected]);


  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Stats bar */}
      <div className="px-4 py-2.5 border-b border-slate-800 flex items-center gap-4 shrink-0">
        <span className="text-sm text-slate-400">
          {applications.length} application{applications.length !== 1 ? 's' : ''}
        </span>
        <span className="text-xs text-slate-500">{activeCount} active</span>
        {offerCount > 0 && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/35">
            {offerCount} Offer{offerCount !== 1 ? 's' : ''}
          </span>
        )}
        {sortKeys.length > 1 && (
          <button
            onClick={() => setSortKeys(DEFAULT_SORT)}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            Sorted by {sortKeys.map((k) => k.field.replace(/_/g, ' ')).join(' › ')} · Reset
          </button>
        )}
        {selectedIds.size > 0 && (
          <button
            onClick={handleDeleteSelected}
            disabled={deleting}
            className="ml-auto flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/25 hover:bg-red-500/20 transition-colors disabled:opacity-50"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            {deleting ? 'Deleting…' : `Delete ${selectedIds.size} selected`}
          </button>
        )}
      </div>

      {/* Stage filter chips */}
      <div className="flex items-center gap-1.5 flex-wrap px-4 py-2.5 border-b border-slate-800 shrink-0">
        <button
          onClick={() => setStageFilter('saved')}
          className={`text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
            stageFilter === 'saved'
              ? 'bg-slate-600 text-slate-100 border-slate-500'
              : 'bg-transparent text-slate-500 border-slate-700 hover:border-slate-600 hover:text-slate-400'
          }`}
        >
          Saved ({applications.length})
        </button>
        {STAGES.map((s) => (
          <button
            key={s}
            onClick={() => setStageFilter(s)}
            className={`text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
              stageFilter === s
                ? `${STAGE_STYLES[s]}`
                : 'bg-transparent text-slate-500 border-slate-700 hover:border-slate-600 hover:text-slate-400'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <p className="text-slate-400 text-sm">No applications yet.</p>
            <p className="text-slate-600 text-xs">
              Save a posting in the Postings tab to create your first application.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-slate-950 border-b border-slate-800">
              <tr>
                {/* Select-all checkbox */}
                <th scope="col" className="pl-4 pr-2 py-2.5 w-8">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAll}
                    className="w-3.5 h-3.5 rounded border-slate-600 bg-slate-800 text-violet-500 cursor-pointer accent-violet-500"
                  />
                </th>
                <SortHeader field="company_name" label="Company" />
                <SortHeader field="role_title"   label="Role Title" />
                <SortHeader field="role_id"      label="Role ID" />
                <SortHeader field="date_applied" label="Date Applied" />
                <SortHeader field="referral"     label="Referral" />
                <SortHeader field="stage"        label="Stage" />
                <th scope="col" className="px-3 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap">
                  Notes
                </th>
                <th scope="col" className="px-3 py-2.5 w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {sorted.map((app) => {
                const isEditing = editingId === app.id;
                const isSelected = selectedIds.has(app.id);
                return (
                  <tr
                    key={app.id}
                    onClick={() => { if (!isEditing) startEdit(app); }}
                    className={`transition-colors group cursor-pointer ${
                      isEditing
                        ? 'bg-slate-900/80 ring-1 ring-inset ring-violet-500/30'
                        : isSelected
                          ? 'bg-violet-500/5'
                          : 'hover:bg-slate-900/60'
                    }`}
                  >
                    {/* Checkbox */}
                    <td className="pl-4 pr-2 py-2.5 w-8" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(app.id)}
                        className="w-3.5 h-3.5 rounded border-slate-600 bg-slate-800 cursor-pointer accent-violet-500"
                      />
                    </td>

                    {/* Company */}
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className="text-slate-300 font-medium">{app.companyName}</span>
                    </td>

                    {/* Role Title */}
                    <td className="px-3 py-2.5 max-w-xs">
                      {isEditing ? (
                        <input
                          autoFocus
                          value={editDraft.roleTitle}
                          onChange={(e) => setEditDraft((d) => ({ ...d, roleTitle: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); }}
                          onClick={(e) => e.stopPropagation()}
                          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-sm focus:outline-none focus:border-violet-500"
                        />
                      ) : app.jobUrl ? (
                        <a
                          href={app.jobUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-slate-100 font-medium hover:text-teal-300 transition-colors leading-snug"
                        >
                          {app.roleTitle}
                        </a>
                      ) : (
                        <span className="text-slate-100 font-medium">{app.roleTitle}</span>
                      )}
                    </td>

                    {/* Role ID */}
                    <td className="px-3 py-2.5 whitespace-nowrap w-28">
                      {isEditing ? (
                        <input
                          value={editDraft.roleId}
                          onChange={(e) => setEditDraft((d) => ({ ...d, roleId: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); }}
                          onClick={(e) => e.stopPropagation()}
                          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-300 text-sm focus:outline-none focus:border-violet-500"
                          placeholder="e.g. 12345"
                        />
                      ) : (
                        <span className="text-slate-500 font-mono text-xs">{app.roleId ?? '—'}</span>
                      )}
                    </td>

                    {/* Date Applied */}
                    <td className="px-3 py-2.5 whitespace-nowrap w-36">
                      {isEditing ? (
                        <input
                          type="date"
                          value={editDraft.dateApplied}
                          onChange={(e) => setEditDraft((d) => ({ ...d, dateApplied: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); }}
                          onClick={(e) => e.stopPropagation()}
                          className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-300 text-sm focus:outline-none focus:border-violet-500"
                        />
                      ) : (
                        <span className="text-slate-400 text-xs">{fmtDate(app.dateApplied)}</span>
                      )}
                    </td>

                    {/* Referral */}
                    <td className="px-3 py-2.5 w-20">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleToggleReferral(app); }}
                        className={`text-xs font-medium px-2 py-0.5 rounded border transition-colors ${
                          app.referral
                            ? 'bg-amber-500/15 text-amber-300 border-amber-500/35 hover:bg-amber-500/25'
                            : 'bg-slate-700/50 text-slate-500 border-slate-600/50 hover:bg-slate-700'
                        }`}
                      >
                        {app.referral ? 'Yes' : 'No'}
                      </button>
                    </td>

                    {/* Stage */}
                    <td className="px-3 py-2.5 w-40">
                      {isEditing ? (
                        <select
                          value={editDraft.stage}
                          onChange={(e) => setEditDraft((d) => ({ ...d, stage: e.target.value }))}
                          onClick={(e) => e.stopPropagation()}
                          className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-300 text-sm focus:outline-none focus:border-violet-500"
                        >
                          {STAGES.map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      ) : (
                        <span className={`text-xs font-medium px-2 py-0.5 rounded border ${STAGE_STYLES[app.stage] ?? STAGE_STYLES['Drafting']}`}>
                          {app.stage}
                        </span>
                      )}
                    </td>

                    {/* Notes */}
                    <td className="px-3 py-2.5">
                      {isEditing ? (
                        <input
                          value={editDraft.notes}
                          onChange={(e) => setEditDraft((d) => ({ ...d, notes: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); }}
                          onClick={(e) => e.stopPropagation()}
                          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-300 text-sm focus:outline-none focus:border-violet-500"
                          placeholder="Notes…"
                        />
                      ) : (
                        <span className="text-slate-500 text-xs truncate max-w-xs block">{app.notes ?? ''}</span>
                      )}
                    </td>

                    {/* Edit controls (only visible while editing) */}
                    <td className="px-3 py-2.5 w-20">
                      {isEditing && (
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={commitEdit}
                            disabled={saving}
                            title="Save"
                            className="text-xs px-2 py-0.5 rounded bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-50"
                          >
                            {saving ? '…' : 'Save'}
                          </button>
                          <button
                            onClick={cancelEdit}
                            title="Cancel"
                            className="text-xs px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

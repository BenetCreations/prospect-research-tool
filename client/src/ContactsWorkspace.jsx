import { useRef, useState } from 'react';
import FilterableSelect from './FilterableSelect.jsx';

const WARMTH_OPTIONS = ['Cold', 'Warm', 'Hot', 'Strong'];
const WARMTH_TO_INT = { Cold: 1, Warm: 2, Hot: 3, Strong: 4 };
const INT_TO_WARMTH = { 1: 'Cold', 2: 'Warm', 3: 'Hot', 4: 'Strong' };

const WARMTH_COLORS = {
  1: 'text-slate-400',
  2: 'text-teal-400',
  3: 'text-emerald-400',
  4: 'text-emerald-300',
};

const STATUS_OPTIONS = ['Active', 'Parked', 'Closed'];

const STATUS_COLORS = {
  Active: 'text-emerald-400',
  Parked: 'text-amber-400',
  Closed: 'text-slate-500',
};

function formatDate(raw) {
  if (!raw) return '';
  const d = new Date(raw + (raw.includes('T') ? '' : 'T00:00:00'));
  if (isNaN(d.getTime())) return raw;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${mm}/${dd}/${yy}`;
}

function parseDate(raw) {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const mdy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mdy) {
    const [, m, d, y] = mdy;
    const year = y.length === 2 ? (Number(y) >= 50 ? '19' : '20') + y : y;
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const dt = new Date(trimmed);
  if (!isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  return trimmed;
}

// Column config — used for sorting keys and autofit measurement
const COLS = [
  { key: 'id',          label: 'ID',          getValue: (ct) => ct.id ?? '' },
  { key: 'name',        label: 'Name',        getValue: (ct) => ct.name ?? '' },
  { key: 'companyName', label: 'Company',     getValue: (ct) => ct.companyName ?? '' },
  { key: 'title',       label: 'Title',       getValue: (ct) => ct.title ?? '' },
  { key: 'warmth',      label: 'Warmth',      getValue: (ct) => INT_TO_WARMTH[ct.warmth] ?? '' },
  { key: 'status',      label: 'Status',      getValue: (ct) => ct.status ?? '' },
  { key: 'lastTouch',   label: 'Last Touch',  getValue: (ct) => ct.lastTouch ? formatDate(ct.lastTouch) : '' },
  { key: 'nextAction',  label: 'Next Action', getValue: (ct) => ct.nextAction ?? '' },
  { key: 'nextTouch',   label: 'Next Touch',  getValue: (ct) => ct.nextTouch ? formatDate(ct.nextTouch) : '' },
];

const DEFAULT_WIDTHS = [72, 150, 140, 140, 100, 90, 100, 180, 100];
const CELL_PAD = 28; // px-3 (12px each side) + 4px buffer

const EMPTY_DRAFT = { name: '', companyName: '', title: '', warmth: 'Warm', status: 'Active', nextAction: '', nextTouch: '' };

export default function ContactsWorkspace({ contacts, companies, onContactsChange }) {
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [newRow, setNewRow] = useState(EMPTY_DRAFT);
  const [sortKey, setSortKey] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [colWidths, setColWidths] = useState(DEFAULT_WIDTHS);

  const tableRef = useRef(null);
  const cellRefs = useRef({});
  const newRefs = useRef({});

  const companyNames = companies.map((c) => c.name).sort();

  // ── Column resize (drag) ─────────────────────────────────────────────────
  function startResize(e, colIdx) {
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startWidth = colWidths[colIdx];
    let didDrag = false;

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    function onMouseMove(ev) {
      const delta = ev.clientX - startX;
      if (Math.abs(delta) > 2) didDrag = true;
      if (didDrag) {
        const newWidth = Math.max(40, startWidth + delta);
        setColWidths((prev) => { const next = [...prev]; next[colIdx] = newWidth; return next; });
      }
    }

    function onMouseUp() {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  // ── Autofit ──────────────────────────────────────────────────────────────
  function autofitColumn(colIdx) {
    const col = COLS[colIdx];
    if (!col || !tableRef.current) return;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const style = window.getComputedStyle(tableRef.current);
    ctx.font = style.font || '14px system-ui, sans-serif';

    // Header: label + sort icon space
    let max = ctx.measureText(col.label.toUpperCase()).width + CELL_PAD + 24;

    for (const row of contacts) {
      const val = String(col.getValue(row));
      if (val) max = Math.max(max, ctx.measureText(val).width + CELL_PAD);
    }

    setColWidths((prev) => {
      const next = [...prev];
      next[colIdx] = Math.max(60, Math.ceil(max));
      return next;
    });
  }

  // ── Sorting ──────────────────────────────────────────────────────────────
  const sorted = [...contacts].sort((a, b) => {
    let av = a[sortKey] ?? '';
    let bv = b[sortKey] ?? '';
    if (sortKey === 'warmth') { av = Number(av); bv = Number(bv); }
    const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
    return sortDir === 'asc' ? cmp : -cmp;
  });

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  }

  // ── Edit row ─────────────────────────────────────────────────────────────
  function startEdit(ct) {
    setEditingId(ct.id);
    setDraft({
      name:        ct.name,
      companyName: ct.companyName ?? '',
      title:       ct.title ?? '',
      warmth:      INT_TO_WARMTH[ct.warmth] ?? 'Warm',
      status:      ct.status ?? 'Active',
      nextAction:  ct.nextAction ?? '',
      nextTouch:   ct.nextTouch ? formatDate(ct.nextTouch) : '',
    });
  }

  function cancelEdit() { setEditingId(null); setDraft({}); }

  async function saveEdit(id) {
    setSaving(true);
    try {
      const company = companies.find((c) => c.name.toLowerCase() === (draft.companyName ?? '').toLowerCase());
      const body = {
        name:       draft.name,
        title:      draft.title || null,
        warmth:     WARMTH_TO_INT[draft.warmth] ?? 2,
        status:     draft.status,
        nextAction: draft.nextAction || null,
        nextTouch:  draft.nextTouch ? parseDate(draft.nextTouch) : null,
      };
      if (company) body.companyId = company.id;

      const res = await fetch(`/api/contacts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Save failed');
      const updated = await res.json();
      onContactsChange(contacts.map((c) => (c.id === id ? { ...c, ...updated, companyName: draft.companyName } : c)));
      setEditingId(null);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  function handleRowBlur(id, e) {
    const next = e.relatedTarget;
    if (next && e.currentTarget.contains(next)) return;
    saveEdit(id);
  }

  // ── New row ───────────────────────────────────────────────────────────────
  async function saveNewRow() {
    if (!newRow.name.trim()) return;
    try {
      const company = companies.find((c) => c.name.toLowerCase() === (newRow.companyName ?? '').toLowerCase());
      const body = {
        name:       newRow.name,
        title:      newRow.title || null,
        warmth:     WARMTH_TO_INT[newRow.warmth] ?? 2,
        companyId:  company?.id ?? null,
        status:     newRow.status,
        nextAction: newRow.nextAction || null,
        nextTouch:  newRow.nextTouch ? parseDate(newRow.nextTouch) : null,
      };
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed');
      const created = await res.json();
      onContactsChange([...contacts, { ...created, companyName: newRow.companyName }]);
      setNewRow(EMPTY_DRAFT);
    } catch (e) {
      console.error(e);
    }
  }

  function handleNewRowBlur(e) {
    const next = e.relatedTarget;
    if (next && e.currentTarget.contains(next)) return;
    if (newRow.name.trim()) saveNewRow();
  }

  // ── Header cell ──────────────────────────────────────────────────────────
  function ColHeader({ colIdx, sortCol, children }) {
    return (
      <th
        onClick={() => toggleSort(sortCol)}
        style={{ width: colWidths[colIdx] }}
        className="relative px-3 py-2 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider
          cursor-pointer select-none hover:text-slate-200 whitespace-nowrap overflow-hidden
          border-r border-slate-700/50 last:border-r-0"
      >
        <span className="mr-3">{children}</span>
        <span className="opacity-40 text-slate-300">
          {sortKey === sortCol ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
        </span>
        {/* Resize handle — double-click to autofit */}
        <div
          className="absolute right-0 top-0 h-full w-2 cursor-col-resize z-10 group/handle"
          onMouseDown={(e) => startResize(e, colIdx)}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => { e.stopPropagation(); autofitColumn(colIdx); }}
          title="Drag to resize · Double-click to autofit"
        >
          <div className="absolute right-0 top-1 bottom-1 w-px bg-teal-400/0 group-hover/handle:bg-teal-400/70 transition-colors" />
        </div>
      </th>
    );
  }

  const TD = ({ colIdx, className = '', children }) => (
    <td
      style={{ width: colWidths[colIdx], maxWidth: colWidths[colIdx] }}
      className={`px-3 py-1.5 overflow-hidden border-r border-slate-800/50 last:border-r-0 ${className}`}
    >
      {children}
    </td>
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-950">
      <div className="px-6 py-4 border-b border-slate-800 shrink-0 flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-100">Contacts</h2>
        <span className="text-xs text-slate-500">{contacts.length} contact{contacts.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="flex-1 overflow-auto">
        <table ref={tableRef} className="border-collapse text-sm table-fixed" style={{ width: colWidths.reduce((s, w) => s + w, 0) }}>
          <colgroup>
            {colWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
          </colgroup>
          <thead className="sticky top-0 bg-slate-900 z-10">
            <tr className="border-b border-slate-800">
              {/* ID header — no sort, no autofit */}
              <th
                style={{ width: colWidths[0] }}
                className="relative px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider
                  overflow-hidden border-r border-slate-700/50"
              >
                ID
                <div
                  className="absolute right-0 top-0 h-full w-2 cursor-col-resize z-10 group/handle"
                  onMouseDown={(e) => startResize(e, 0)}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => { e.stopPropagation(); autofitColumn(0); }}
                  title="Drag to resize · Double-click to autofit"
                >
                  <div className="absolute right-0 top-1 bottom-1 w-px bg-teal-400/0 group-hover/handle:bg-teal-400/70 transition-colors" />
                </div>
              </th>
              <ColHeader colIdx={1} sortCol="name">Name</ColHeader>
              <ColHeader colIdx={2} sortCol="companyName">Company</ColHeader>
              <ColHeader colIdx={3} sortCol="title">Title</ColHeader>
              <ColHeader colIdx={4} sortCol="warmth">Warmth</ColHeader>
              <ColHeader colIdx={5} sortCol="status">Status</ColHeader>
              <ColHeader colIdx={6} sortCol="lastTouch">Last Touch</ColHeader>
              <ColHeader colIdx={7} sortCol="nextAction">Next Action</ColHeader>
              <ColHeader colIdx={8} sortCol="nextTouch">Next Touch</ColHeader>
            </tr>
          </thead>
          <tbody>
            {sorted.map((ct) => {
              const isEditing = editingId === ct.id;
              return (
                <tr
                  key={ct.id}
                  onBlur={isEditing ? (e) => handleRowBlur(ct.id, e) : undefined}
                  onClick={() => { if (!isEditing) startEdit(ct); }}
                  className={`border-b border-slate-800/60 group
                    ${isEditing ? 'bg-slate-800/50' : 'hover:bg-slate-900/60 cursor-pointer'}`}
                >
                  <TD colIdx={0}><span className="text-xs text-slate-600 font-mono truncate block">{ct.id}</span></TD>

                  <TD colIdx={1}>
                    {isEditing ? (
                      <input
                        ref={(el) => { cellRefs.current[`${ct.id}-0`] = el; }}
                        value={draft.name}
                        onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Escape') cancelEdit(); if (e.key === 'Enter') saveEdit(ct.id); }}
                        className="w-full bg-slate-700/50 rounded px-2 py-0.5 text-slate-100 outline-none focus:ring-1 focus:ring-teal-500"
                        autoFocus
                      />
                    ) : (
                      <span className="text-slate-200 font-medium truncate block">{ct.name}</span>
                    )}
                  </TD>

                  <TD colIdx={2}>
                    {isEditing ? (
                      <FilterableSelect
                        value={draft.companyName}
                        options={companyNames}
                        onChange={(v) => setDraft((p) => ({ ...p, companyName: v }))}
                        inputClass="text-slate-100 text-sm"
                        className="w-full bg-slate-700/50 rounded px-2 py-0.5 focus-within:ring-1 focus-within:ring-teal-500"
                      />
                    ) : (
                      <span className="text-slate-400 truncate block">{ct.companyName ?? ''}</span>
                    )}
                  </TD>

                  <TD colIdx={3}>
                    {isEditing ? (
                      <input
                        value={draft.title}
                        onChange={(e) => setDraft((p) => ({ ...p, title: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Escape') cancelEdit(); if (e.key === 'Enter') saveEdit(ct.id); }}
                        className="w-full bg-slate-700/50 rounded px-2 py-0.5 text-slate-100 outline-none focus:ring-1 focus:ring-teal-500"
                      />
                    ) : (
                      <span className="text-slate-400 truncate block">{ct.title ?? ''}</span>
                    )}
                  </TD>

                  <TD colIdx={4}>
                    {isEditing ? (
                      <FilterableSelect
                        value={draft.warmth}
                        options={WARMTH_OPTIONS}
                        onChange={(v) => setDraft((p) => ({ ...p, warmth: v }))}
                        inputClass="text-slate-100 text-sm"
                        className="w-full bg-slate-700/50 rounded px-2 py-0.5 focus-within:ring-1 focus-within:ring-teal-500"
                      />
                    ) : (
                      <span className={`font-medium truncate block ${WARMTH_COLORS[ct.warmth] ?? 'text-slate-400'}`}>
                        {INT_TO_WARMTH[ct.warmth] ?? '—'}
                      </span>
                    )}
                  </TD>

                  <TD colIdx={5}>
                    {isEditing ? (
                      <FilterableSelect
                        value={draft.status}
                        options={STATUS_OPTIONS}
                        onChange={(v) => setDraft((p) => ({ ...p, status: v }))}
                        inputClass="text-slate-100 text-sm"
                        className="w-full bg-slate-700/50 rounded px-2 py-0.5 focus-within:ring-1 focus-within:ring-teal-500"
                      />
                    ) : (
                      <span className={`truncate block ${STATUS_COLORS[ct.status] ?? 'text-slate-400'}`}>
                        {ct.status ?? 'Active'}
                      </span>
                    )}
                  </TD>

                  <TD colIdx={6}>
                    <span className="text-slate-500 text-xs truncate block">
                      {ct.lastTouch ? formatDate(ct.lastTouch) : '—'}
                    </span>
                  </TD>

                  <TD colIdx={7}>
                    {isEditing ? (
                      <input
                        value={draft.nextAction}
                        onChange={(e) => setDraft((p) => ({ ...p, nextAction: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Escape') cancelEdit(); if (e.key === 'Enter') saveEdit(ct.id); }}
                        className="w-full bg-slate-700/50 rounded px-2 py-0.5 text-slate-100 outline-none focus:ring-1 focus:ring-teal-500"
                      />
                    ) : (
                      <span className="text-slate-400 text-xs truncate block">{ct.nextAction ?? ''}</span>
                    )}
                  </TD>

                  <TD colIdx={8}>
                    {isEditing ? (
                      <input
                        value={draft.nextTouch}
                        placeholder="MM/DD/YY"
                        onChange={(e) => setDraft((p) => ({ ...p, nextTouch: e.target.value }))}
                        onBlur={(e) => {
                          const parsed = parseDate(e.target.value);
                          setDraft((p) => ({ ...p, nextTouch: parsed ? formatDate(parsed) : '' }));
                        }}
                        onKeyDown={(e) => { if (e.key === 'Escape') cancelEdit(); if (e.key === 'Enter') saveEdit(ct.id); }}
                        className="w-full bg-slate-700/50 rounded px-2 py-0.5 text-slate-100 outline-none focus:ring-1 focus:ring-teal-500 placeholder:text-slate-600 text-xs"
                      />
                    ) : (
                      <span className="text-slate-400 text-xs truncate block">
                        {ct.nextTouch ? formatDate(ct.nextTouch) : ''}
                      </span>
                    )}
                  </TD>
                </tr>
              );
            })}

            {/* New row */}
            <tr onBlur={handleNewRowBlur} className="border-b border-slate-800/40 bg-slate-900/30">
              <TD colIdx={0}><span className="text-xs text-slate-700">new</span></TD>

              <TD colIdx={1}>
                <input
                  ref={(el) => { newRefs.current[0] = el; }}
                  value={newRow.name}
                  placeholder="Name…"
                  onChange={(e) => setNewRow((p) => ({ ...p, name: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter' && newRow.name.trim()) saveNewRow(); }}
                  className="w-full bg-transparent rounded px-2 py-0.5 text-slate-300 placeholder:text-slate-700 outline-none focus:bg-slate-700/50 focus:ring-1 focus:ring-teal-500/50"
                />
              </TD>

              <TD colIdx={2}>
                <FilterableSelect
                  value={newRow.companyName}
                  options={companyNames}
                  onChange={(v) => setNewRow((p) => ({ ...p, companyName: v }))}
                  placeholder="Company…"
                  inputClass="text-slate-300 text-sm placeholder:text-slate-700"
                  className="w-full rounded px-2 py-0.5 focus-within:bg-slate-700/50 focus-within:ring-1 focus-within:ring-teal-500/50"
                />
              </TD>

              <TD colIdx={3}>
                <input
                  value={newRow.title}
                  placeholder="Title…"
                  onChange={(e) => setNewRow((p) => ({ ...p, title: e.target.value }))}
                  className="w-full bg-transparent rounded px-2 py-0.5 text-slate-300 placeholder:text-slate-700 outline-none focus:bg-slate-700/50 focus:ring-1 focus:ring-teal-500/50"
                />
              </TD>

              <TD colIdx={4}>
                <FilterableSelect
                  value={newRow.warmth}
                  options={WARMTH_OPTIONS}
                  onChange={(v) => setNewRow((p) => ({ ...p, warmth: v }))}
                  placeholder="Warmth…"
                  inputClass="text-slate-300 text-sm placeholder:text-slate-700"
                  className="w-full rounded px-2 py-0.5 focus-within:bg-slate-700/50 focus-within:ring-1 focus-within:ring-teal-500/50"
                />
              </TD>

              <TD colIdx={5}>
                <FilterableSelect
                  value={newRow.status}
                  options={STATUS_OPTIONS}
                  onChange={(v) => setNewRow((p) => ({ ...p, status: v }))}
                  placeholder="Status…"
                  inputClass="text-slate-300 text-sm placeholder:text-slate-700"
                  className="w-full rounded px-2 py-0.5 focus-within:bg-slate-700/50 focus-within:ring-1 focus-within:ring-teal-500/50"
                />
              </TD>

              <TD colIdx={6} />

              <TD colIdx={7}>
                <input
                  value={newRow.nextAction}
                  placeholder="Next action…"
                  onChange={(e) => setNewRow((p) => ({ ...p, nextAction: e.target.value }))}
                  className="w-full bg-transparent rounded px-2 py-0.5 text-slate-300 placeholder:text-slate-700 outline-none focus:bg-slate-700/50 focus:ring-1 focus:ring-teal-500/50 text-xs"
                />
              </TD>

              <TD colIdx={8}>
                <input
                  value={newRow.nextTouch}
                  placeholder="MM/DD/YY"
                  onChange={(e) => setNewRow((p) => ({ ...p, nextTouch: e.target.value }))}
                  onBlur={(e) => {
                    const parsed = parseDate(e.target.value);
                    setNewRow((p) => ({ ...p, nextTouch: parsed ? formatDate(parsed) : '' }));
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && newRow.name.trim()) saveNewRow(); }}
                  className="w-full bg-transparent rounded px-2 py-0.5 text-slate-300 placeholder:text-slate-700 outline-none focus:bg-slate-700/50 focus:ring-1 focus:ring-teal-500/50 text-xs"
                />
              </TD>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { useRef, useState } from 'react';
import FilterableSelect from './FilterableSelect.jsx';

const ACTION_OPTIONS = [
  'Cold Outreach',
  'Warm Outreach',
  'Follow-Up',
  'Intro Request',
  'Meeting Booked',
  'Meeting Held',
  'Thank You Sent',
  'Intro Made',
  'Referral Offered',
  'Referral Submitted',
];

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

const today = () => formatDate(new Date().toISOString().slice(0, 10));

// Column config for autofit measurement
const COLS = [
  { label: 'ID',      getValue: (e) => String(e.id ?? '') },
  { label: 'Date',    getValue: (e) => e.date ? formatDate(e.date) : '' },
  { label: 'Contact', getValue: (e) => e.contactName ?? '' },
  { label: 'Notes',   getValue: (e) => e.notes ?? '' },
  { label: 'Action',  getValue: (e) => e.action ?? '' },
  { label: 'Result',  getValue: (e) => e.result ?? '' },
  { label: '',        getValue: () => '' }, // delete column
];

const DEFAULT_WIDTHS = [60, 90, 150, 240, 165, 165, 36];
const CELL_PAD = 28;

const EMPTY_NEW = { date: today(), contactName: '', notes: '', action: '', result: '' };

function TD({ colWidths, colIdx, className = '', children }) {
  return (
    <td
      style={{ width: colWidths[colIdx], maxWidth: colWidths[colIdx] }}
      className={`px-3 py-1.5 overflow-hidden border-r border-slate-800/50 last:border-r-0 ${className}`}
    >
      {children}
    </td>
  );
}

export default function OutreachWorkspace({ outreach, contacts, onOutreachChange }) {
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [newRow, setNewRow] = useState(EMPTY_NEW);
  const [sortKey, setSortKey] = useState('date');
  const [sortDir, setSortDir] = useState('desc');
  const [colWidths, setColWidths] = useState(DEFAULT_WIDTHS);

  const tableRef = useRef(null);
  const newRowRefs = useRef([]);
  const editRowRefs = useRef([]);

  const contactNames = contacts.map((c) => c.name).sort();

  // ── Cell tab navigation ──────────────────────────────────────────────────
  function focusCell(refs, currentIdx, shiftKey) {
    const nextIdx = shiftKey ? currentIdx - 1 : currentIdx + 1;
    if (nextIdx >= 0 && nextIdx < refs.length) {
      refs[nextIdx]?.focus();
    }
  }

  function handleCellTab(refs, cellIdx, e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      focusCell(refs, cellIdx, e.shiftKey);
    }
  }

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

    let max = ctx.measureText(col.label.toUpperCase()).width + CELL_PAD + 24;

    for (const row of outreach) {
      const val = String(col.getValue(row));
      if (val) max = Math.max(max, ctx.measureText(val).width + CELL_PAD);
    }

    setColWidths((prev) => {
      const next = [...prev];
      next[colIdx] = Math.max(40, Math.ceil(max));
      return next;
    });
  }

  // ── Sorting ──────────────────────────────────────────────────────────────
  const sorted = [...outreach].sort((a, b) => {
    const av = a[sortKey] ?? '';
    const bv = b[sortKey] ?? '';
    const cmp = String(av).localeCompare(String(bv));
    return sortDir === 'asc' ? cmp : -cmp;
  });

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  }

  // ── Edit row ─────────────────────────────────────────────────────────────
  function startEdit(entry) {
    setEditingId(entry.id);
    setDraft({
      date:        entry.date ? formatDate(entry.date) : '',
      contactName: entry.contactName ?? '',
      notes:       entry.notes ?? '',
      action:      entry.action ?? '',
      result:      entry.result ?? '',
    });
  }

  function cancelEdit() { setEditingId(null); setDraft({}); }

  async function saveEdit(id) {
    setSaving(true);
    try {
      const contact = contacts.find((c) => c.name.toLowerCase() === (draft.contactName ?? '').toLowerCase());
      const body = {
        date:      parseDate(draft.date),
        action:    draft.action || null,
        notes:     draft.notes || null,
        result:    draft.result || null,
        contactId: contact?.id,
      };
      const res = await fetch(`/api/outreach/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Save failed');
      const updated = await res.json();
      onOutreachChange(outreach.map((e) => (e.id === id ? updated : e)));
      setEditingId(null);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  function handleRowBlur(id, e) {
    const next = e.relatedTarget;
    if (next && e.currentTarget.contains(next)) return;
    const row = e.currentTarget;
    requestAnimationFrame(() => {
      if (row.contains(document.activeElement)) return;
      saveEdit(id);
    });
  }

  async function handleDelete(id) {
    await fetch(`/api/outreach/${id}`, { method: 'DELETE' });
    onOutreachChange(outreach.filter((e) => e.id !== id));
  }

  // ── New row ───────────────────────────────────────────────────────────────
  async function saveNewRow() {
    if (!newRow.date || !newRow.contactName) return;
    try {
      const contact = contacts.find((c) => c.name.toLowerCase() === newRow.contactName.toLowerCase());
      if (!contact) return;
      const body = {
        contactId: contact.id,
        date:      parseDate(newRow.date),
        action:    newRow.action || null,
        notes:     newRow.notes || null,
        result:    newRow.result || null,
      };
      const res = await fetch('/api/outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed');
      const created = await res.json();
      onOutreachChange([created, ...outreach]);
      setNewRow(EMPTY_NEW);
    } catch (err) {
      console.error(err);
    }
  }

  function handleNewRowBlur(e) {
    const next = e.relatedTarget;
    if (next && e.currentTarget.contains(next)) return;
    const row = e.currentTarget;
    requestAnimationFrame(() => {
      if (row.contains(document.activeElement)) return;
      if (newRow.date && newRow.contactName) saveNewRow();
    });
  }

  // ── Header cell ──────────────────────────────────────────────────────────
  function ColHeader({ colIdx, sortCol, children }) {
    return (
      <th
        onClick={sortCol ? () => toggleSort(sortCol) : undefined}
        style={{ width: colWidths[colIdx] }}
        className={`relative px-3 py-2 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider
          select-none whitespace-nowrap overflow-hidden
          border-r border-slate-700/50 last:border-r-0
          ${sortCol ? 'cursor-pointer hover:text-slate-200' : ''}`}
      >
        {children && <span className="mr-3">{children}</span>}
        {sortCol && (
          <span className="opacity-40 text-slate-300">
            {sortKey === sortCol ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
          </span>
        )}
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


  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-950">
      <div className="px-6 py-4 border-b border-slate-800 shrink-0 flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-100">Outreach</h2>
        <span className="text-xs text-slate-500">{outreach.length} entr{outreach.length !== 1 ? 'ies' : 'y'}</span>
      </div>

      <div className="flex-1 overflow-auto">
        <table ref={tableRef} className="border-collapse text-sm table-fixed" style={{ width: colWidths.reduce((s, w) => s + w, 0) }}>
          <colgroup>
            {colWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
          </colgroup>
          <thead className="sticky top-0 bg-slate-900 z-10">
            <tr className="border-b border-slate-800">
              <ColHeader colIdx={0}>ID</ColHeader>
              <ColHeader colIdx={1} sortCol="date">Date</ColHeader>
              <ColHeader colIdx={2} sortCol="contactName">Contact</ColHeader>
              <ColHeader colIdx={3} sortCol="notes">Notes</ColHeader>
              <ColHeader colIdx={4} sortCol="action">Action</ColHeader>
              <ColHeader colIdx={5} sortCol="result">Result</ColHeader>
              <ColHeader colIdx={6} />
            </tr>
          </thead>
          <tbody>
            {/* New row at top */}
            <tr onBlur={handleNewRowBlur} className="border-b border-slate-800/40 bg-slate-900/30">
              <TD colWidths={colWidths} colIdx={0}><span className="text-xs text-slate-700">new</span></TD>

              <TD colWidths={colWidths} colIdx={1}>
                <input
                  ref={(el) => { newRowRefs.current[0] = el; }}
                  value={newRow.date}
                  placeholder="MM/DD/YY"
                  onChange={(e) => setNewRow((p) => ({ ...p, date: e.target.value }))}
                  onBlur={(e) => {
                    const parsed = parseDate(e.target.value);
                    setNewRow((p) => ({ ...p, date: parsed ? formatDate(parsed) : e.target.value }));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newRow.contactName) saveNewRow();
                    else handleCellTab(newRowRefs.current, 0, e);
                  }}
                  className="w-full bg-transparent rounded px-2 py-0.5 text-slate-300 placeholder:text-slate-700 outline-none focus:bg-slate-700/50 focus:ring-1 focus:ring-teal-500/50 text-xs"
                />
              </TD>

              <TD colWidths={colWidths} colIdx={2}>
                <FilterableSelect
                  ref={(el) => { newRowRefs.current[1] = el; }}
                  value={newRow.contactName}
                  options={contactNames}
                  onChange={(v) => setNewRow((p) => ({ ...p, contactName: v }))}
                  onTab={(shiftKey) => focusCell(newRowRefs.current, 1, shiftKey)}
                  placeholder="Contact…"
                  inputClass="text-slate-300 text-sm placeholder:text-slate-700"
                  className="w-full rounded px-2 py-0.5 focus-within:bg-slate-700/50 focus-within:ring-1 focus-within:ring-teal-500/50"
                />
              </TD>

              <TD colWidths={colWidths} colIdx={3}>
                <input
                  ref={(el) => { newRowRefs.current[2] = el; }}
                  value={newRow.notes}
                  placeholder="Notes…"
                  onChange={(e) => setNewRow((p) => ({ ...p, notes: e.target.value }))}
                  onKeyDown={(e) => handleCellTab(newRowRefs.current, 2, e)}
                  className="w-full bg-transparent rounded px-2 py-0.5 text-slate-300 placeholder:text-slate-700 outline-none focus:bg-slate-700/50 focus:ring-1 focus:ring-teal-500/50 text-xs"
                />
              </TD>

              <TD colWidths={colWidths} colIdx={4}>
                <FilterableSelect
                  ref={(el) => { newRowRefs.current[3] = el; }}
                  value={newRow.action}
                  options={ACTION_OPTIONS}
                  onChange={(v) => setNewRow((p) => ({ ...p, action: v }))}
                  onTab={(shiftKey) => focusCell(newRowRefs.current, 3, shiftKey)}
                  placeholder="Action…"
                  inputClass="text-slate-300 text-sm placeholder:text-slate-700"
                  className="w-full rounded px-2 py-0.5 focus-within:bg-slate-700/50 focus-within:ring-1 focus-within:ring-teal-500/50"
                />
              </TD>

              <TD colWidths={colWidths} colIdx={5}>
                <input
                  ref={(el) => { newRowRefs.current[4] = el; }}
                  value={newRow.result}
                  placeholder="Result…"
                  onChange={(e) => setNewRow((p) => ({ ...p, result: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newRow.contactName) saveNewRow();
                    else handleCellTab(newRowRefs.current, 4, e);
                  }}
                  className="w-full bg-transparent rounded px-2 py-0.5 text-slate-300 placeholder:text-slate-700 outline-none focus:bg-slate-700/50 focus:ring-1 focus:ring-teal-500/50 text-xs"
                />
              </TD>

              <TD colWidths={colWidths} colIdx={6} />
            </tr>

            {sorted.map((entry) => {
              const isEditing = editingId === entry.id;
              return (
                <tr
                  key={entry.id}
                  onBlur={isEditing ? (e) => handleRowBlur(entry.id, e) : undefined}
                  onClick={() => { if (!isEditing) startEdit(entry); }}
                  className={`border-b border-slate-800/60 group
                    ${isEditing ? 'bg-slate-800/50' : 'hover:bg-slate-900/60 cursor-pointer'}`}
                >
                  <TD colWidths={colWidths} colIdx={0}><span className="text-xs text-slate-600 font-mono">{entry.id}</span></TD>

                  <TD colWidths={colWidths} colIdx={1}>
                    {isEditing ? (
                      <input
                        ref={(el) => { editRowRefs.current[0] = el; }}
                        value={draft.date}
                        placeholder="MM/DD/YY"
                        onChange={(e) => setDraft((p) => ({ ...p, date: e.target.value }))}
                        onBlur={(e) => {
                          const parsed = parseDate(e.target.value);
                          setDraft((p) => ({ ...p, date: parsed ? formatDate(parsed) : e.target.value }));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') cancelEdit();
                          else if (e.key === 'Enter') saveEdit(entry.id);
                          else handleCellTab(editRowRefs.current, 0, e);
                        }}
                        autoFocus
                        className="w-full bg-slate-700/50 rounded px-2 py-0.5 text-slate-100 outline-none focus:ring-1 focus:ring-teal-500 text-xs"
                      />
                    ) : (
                      <span className="text-slate-400 text-xs">{entry.date ? formatDate(entry.date) : ''}</span>
                    )}
                  </TD>

                  <TD colWidths={colWidths} colIdx={2}>
                    {isEditing ? (
                      <FilterableSelect
                        ref={(el) => { editRowRefs.current[1] = el; }}
                        value={draft.contactName}
                        options={contactNames}
                        onChange={(v) => setDraft((p) => ({ ...p, contactName: v }))}
                        onTab={(shiftKey) => focusCell(editRowRefs.current, 1, shiftKey)}
                        inputClass="text-slate-100 text-sm"
                        className="w-full bg-slate-700/50 rounded px-2 py-0.5 focus-within:ring-1 focus-within:ring-teal-500"
                      />
                    ) : (
                      <span className="text-slate-200 font-medium truncate block">{entry.contactName ?? ''}</span>
                    )}
                  </TD>

                  <TD colWidths={colWidths} colIdx={3}>
                    {isEditing ? (
                      <input
                        ref={(el) => { editRowRefs.current[2] = el; }}
                        value={draft.notes}
                        onChange={(e) => setDraft((p) => ({ ...p, notes: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') cancelEdit();
                          else if (e.key === 'Enter') saveEdit(entry.id);
                          else handleCellTab(editRowRefs.current, 2, e);
                        }}
                        className="w-full bg-slate-700/50 rounded px-2 py-0.5 text-slate-100 outline-none focus:ring-1 focus:ring-teal-500 text-xs"
                      />
                    ) : (
                      <span className="text-slate-400 text-xs truncate block">{entry.notes ?? ''}</span>
                    )}
                  </TD>

                  <TD colWidths={colWidths} colIdx={4}>
                    {isEditing ? (
                      <FilterableSelect
                        ref={(el) => { editRowRefs.current[3] = el; }}
                        value={draft.action}
                        options={ACTION_OPTIONS}
                        onChange={(v) => setDraft((p) => ({ ...p, action: v }))}
                        onTab={(shiftKey) => focusCell(editRowRefs.current, 3, shiftKey)}
                        inputClass="text-slate-100 text-sm"
                        className="w-full bg-slate-700/50 rounded px-2 py-0.5 focus-within:ring-1 focus-within:ring-teal-500"
                      />
                    ) : (
                      <span className="text-slate-300 text-xs truncate block">{entry.action ?? ''}</span>
                    )}
                  </TD>

                  <TD colWidths={colWidths} colIdx={5}>
                    {isEditing ? (
                      <input
                        ref={(el) => { editRowRefs.current[4] = el; }}
                        value={draft.result}
                        onChange={(e) => setDraft((p) => ({ ...p, result: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') cancelEdit();
                          else if (e.key === 'Enter') saveEdit(entry.id);
                          else handleCellTab(editRowRefs.current, 4, e);
                        }}
                        className="w-full bg-slate-700/50 rounded px-2 py-0.5 text-slate-100 outline-none focus:ring-1 focus:ring-teal-500 text-xs"
                      />
                    ) : (
                      <span className="text-slate-400 text-xs truncate block">{entry.result ?? ''}</span>
                    )}
                  </TD>

                  <TD colWidths={colWidths} colIdx={6} className="px-2 text-right">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(entry.id); }}
                      className="text-slate-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all text-base leading-none"
                    >
                      ×
                    </button>
                  </TD>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

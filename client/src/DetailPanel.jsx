import { useCallback, useEffect, useState } from 'react';

const OUTREACH_TYPES = [
  { value: 'email',    label: 'Email' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'call',     label: 'Call' },
  { value: 'meeting',  label: 'Meeting' },
  { value: 'text',     label: 'Text' },
];

const today = () => new Date().toISOString().slice(0, 10);

const TIERS = ['Tier A', 'Tier B', 'Tier C'];

const TIER_STYLES = {
  'Tier A': { badge: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/35', bar: 'bg-emerald-500' },
  'Tier B': { badge: 'bg-amber-500/15 text-amber-300 border border-amber-500/35', bar: 'bg-amber-500' },
  'Tier C': { badge: 'bg-slate-600/50 text-slate-300 border border-slate-500/40', bar: 'bg-slate-500' },
};

const TIER_BUTTON_STYLES = {
  'Tier A': { active: 'bg-emerald-500/20 border-emerald-400/60 text-emerald-200', inactive: 'border-slate-700 text-slate-600 hover:border-emerald-500/35' },
  'Tier B': { active: 'bg-amber-500/20 border-amber-400/60 text-amber-200', inactive: 'border-slate-700 text-slate-600 hover:border-amber-500/35' },
  'Tier C': { active: 'bg-slate-600/40 border-slate-500/60 text-slate-300', inactive: 'border-slate-700 text-slate-600 hover:border-slate-500/40' },
};

const WARMTH_COLORS = {
  1: 'bg-slate-500',
  2: 'bg-teal-400/55',
  3: 'bg-emerald-400',
  4: 'bg-emerald-300',
};

const WARMTH_LABELS = { 1: 'Cold', 2: 'Warm', 3: 'Hot', 4: 'Strong' };

const WARMTH_BUTTON_STYLES = {
  1: { active: 'bg-slate-600 border-slate-400 text-slate-200', inactive: 'border-slate-700 text-slate-600 hover:border-slate-500' },
  2: { active: 'bg-teal-500/20 border-teal-400/55 text-teal-200', inactive: 'border-slate-700 text-slate-600 hover:border-teal-500/35' },
  3: { active: 'bg-emerald-500/20 border-emerald-400 text-emerald-200', inactive: 'border-slate-700 text-slate-600 hover:border-emerald-500/40' },
  4: { active: 'bg-emerald-500/25 border-emerald-300 text-emerald-100', inactive: 'border-slate-700 text-slate-600 hover:border-emerald-400/45' },
};

const SCORE_FIELDS = [
  { key: 'interest', label: 'Interest' },
  { key: 'fit',      label: 'Fit'      },
  { key: 'access',   label: 'Access'   },
  { key: 'timing',   label: 'Timing'   },
];

export default function DetailPanel({ company, onClose, onSave }) {
  const [scores, setScores] = useState({ interest: 1, fit: 1, access: 1, timing: 1 });
  const [notes, setNotes] = useState('');
  const [tier, setTier] = useState('Tier C');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Contacts state
  const [addingContact, setAddingContact] = useState(false);
  const [newContact, setNewContact] = useState({ name: '', title: '', warmth: 2 });
  const [contactSaving, setContactSaving] = useState(false);
  const [editingContactId, setEditingContactId] = useState(null);
  const [editValues, setEditValues] = useState({ name: '', title: '', warmth: 2 });

  // Outreach state
  const [outreachMap, setOutreachMap] = useState({});       // contactId → entry[]
  const [logFormOpen, setLogFormOpen] = useState(null);     // contactId or null
  const [logFormData, setLogFormData] = useState({ date: today(), type: 'email', notes: '' });
  const [outreachSaving, setOutreachSaving] = useState(false);

  useEffect(() => {
    if (company) {
      const { interest, fit, access, timing } = company.scores;
      setScores({ interest, fit, access, timing });
      setNotes(company.notes ?? '');
      setTier(company.priorityTier ?? 'Tier C');
      setError(null);
      setAddingContact(false);
      setNewContact({ name: '', title: '', warmth: 2 });
      setEditingContactId(null);
      setLogFormOpen(null);
      setOutreachMap({});
    }
  }, [company?.id]);

  // Fetch outreach for all contacts when company changes
  const fetchOutreach = useCallback(async (contacts, companyId) => {
    const entries = await Promise.all(
      contacts.map((ct) =>
        fetch(`/api/contacts/${ct.id}/outreach?companyId=${companyId}`)
          .then((r) => r.json())
          .then((data) => [ct.id, data])
          .catch(() => [ct.id, []])
      )
    );
    setOutreachMap(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    if (company?.contacts?.length) {
      fetchOutreach(company.contacts, company.id);
    }
  }, [company?.id, company?.contacts, fetchOutreach]);

  const total = scores.interest + scores.fit + scores.access + scores.timing;
  const isOpen = company !== null;
  const styles = TIER_STYLES[tier] ?? TIER_STYLES['Tier C'];

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${company.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scores, notes, priorityTier: tier }),
      });
      if (!res.ok) throw new Error('Save failed');
      const updated = await res.json();
      onSave({ ...updated, contacts: company.contacts ?? [] });
      onClose();
    } catch {
      setError('Could not save. Is the server running?');
    } finally {
      setSaving(false);
    }
  }

  async function handleAddContact(e) {
    e.preventDefault();
    if (!newContact.name.trim()) return;
    setContactSaving(true);
    try {
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newContact, companyId: company.id }),
      });
      if (!res.ok) throw new Error('Failed to add contact');
      const created = await res.json();
      onSave({ ...company, contacts: [...(company.contacts ?? []), created] });
      setNewContact({ name: '', title: '', warmth: 2 });
      setAddingContact(false);
    } catch {
      setError('Could not add contact.');
    } finally {
      setContactSaving(false);
    }
  }

  function startEditing(ct) {
    setEditingContactId(ct.id);
    setEditValues({ name: ct.name, title: ct.title ?? '', warmth: ct.warmth });
    setAddingContact(false);
  }

  async function handleEditContact(e) {
    e.preventDefault();
    if (!editValues.name.trim()) return;
    setContactSaving(true);
    try {
      const res = await fetch(`/api/contacts/${editingContactId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editValues),
      });
      if (!res.ok) throw new Error('Failed to update contact');
      const updated = await res.json();
      onSave({
        ...company,
        contacts: company.contacts.map((c) => (c.id === updated.id ? updated : c)),
      });
      setEditingContactId(null);
    } catch {
      setError('Could not update contact.');
    } finally {
      setContactSaving(false);
    }
  }

  async function handleLogOutreach(e, contactId) {
    e.preventDefault();
    setOutreachSaving(true);
    try {
      const res = await fetch(`/api/contacts/${contactId}/outreach`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: company.id, ...logFormData }),
      });
      if (!res.ok) throw new Error('Failed to log outreach');
      const created = await res.json();
      setOutreachMap((prev) => ({
        ...prev,
        [contactId]: [created, ...(prev[contactId] ?? [])],
      }));
      setLogFormOpen(null);
      setLogFormData({ date: today(), type: 'email', notes: '' });
    } catch {
      setError('Could not log outreach.');
    } finally {
      setOutreachSaving(false);
    }
  }

  async function handleDeleteOutreach(contactId, entryId) {
    try {
      await fetch(`/api/outreach/${entryId}`, { method: 'DELETE' });
      setOutreachMap((prev) => ({
        ...prev,
        [contactId]: (prev[contactId] ?? []).filter((e) => e.id !== entryId),
      }));
    } catch {
      setError('Could not delete outreach entry.');
    }
  }


  const companyContacts = company?.contacts ?? [];

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 bg-black/60 z-20" onClick={onClose} />
      )}

      <div
        className={`fixed top-0 right-0 h-full w-96 bg-slate-900 border-l border-slate-800 shadow-2xl shadow-black/40 z-30 flex flex-col
          transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {company && (
          <>
            <div className={`h-1 w-full shrink-0 ${styles.bar}`} />

            {/* Header */}
            <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-slate-800">
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-bold text-slate-100 leading-tight truncate">
                  {company.name}
                </h2>
                <p className="text-sm text-slate-400 mt-0.5 truncate">
                  {company.vertical}
                  {company.subsector ? ` · ${company.subsector}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${styles.badge}`}>
                  {tier}
                </span>
                <button
                  onClick={onClose}
                  className="text-slate-500 hover:text-slate-300 transition-colors p-1 -mr-1"
                  aria-label="Close"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-6">

              {/* Priority Tier */}
              <section>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  Priority Tier
                </h3>
                <div className="flex gap-1.5">
                  {TIERS.map((t) => {
                    const s = TIER_BUTTON_STYLES[t];
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setTier(t)}
                        className={`flex-1 text-xs font-medium py-1.5 rounded border transition-colors
                          ${tier === t ? s.active : s.inactive}`}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Scores */}
              <section>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                  Scores
                </h3>
                <div className="flex flex-col gap-2">
                  {SCORE_FIELDS.map(({ key, label }) => (
                    <div key={key} className="flex items-center justify-between">
                      <label htmlFor={`score-${key}`} className="text-sm text-slate-300 w-20">
                        {label}
                      </label>
                      <select
                        id={`score-${key}`}
                        value={scores[key]}
                        onChange={(e) =>
                          setScores((prev) => ({ ...prev, [key]: Number(e.target.value) }))
                        }
                        className="text-sm border border-slate-600 rounded px-2 py-1 bg-slate-800 text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-500 w-20 text-center"
                      >
                        {[1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                  <div className="flex items-center justify-between border-t border-slate-800 pt-2 mt-1">
                    <span className="text-sm font-semibold text-slate-300">Total</span>
                    <span className="text-sm font-bold text-slate-100 w-20 text-center">{total}</span>
                  </div>
                </div>
              </section>

              {/* Notes */}
              <section>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  Notes
                </h3>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                  placeholder="Add notes…"
                  className="w-full text-sm text-slate-200 placeholder:text-slate-500 border border-slate-600 rounded px-3 py-2 resize-none bg-slate-800/80 focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </section>

              {/* Contacts */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Contacts
                  </h3>
                  {!addingContact && (
                    <button
                      onClick={() => setAddingContact(true)}
                      className="text-xs font-medium text-teal-400 hover:text-teal-300 transition-colors"
                    >
                      + Add
                    </button>
                  )}
                </div>

                {/* Contact list */}
                <div className="flex flex-col gap-1">
                  {companyContacts.map((ct) =>
                    editingContactId === ct.id ? (
                      <form
                        key={ct.id}
                        onSubmit={handleEditContact}
                        className="flex flex-col gap-2 p-3 bg-slate-800/60 rounded-lg border border-slate-700"
                      >
                        <input
                          type="text"
                          value={editValues.name}
                          onChange={(e) => setEditValues((p) => ({ ...p, name: e.target.value }))}
                          required
                          autoFocus
                          className="w-full text-sm text-slate-100 placeholder:text-slate-500 bg-slate-800 border border-slate-600 rounded px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-500"
                        />
                        <input
                          type="text"
                          placeholder="Title"
                          value={editValues.title}
                          onChange={(e) => setEditValues((p) => ({ ...p, title: e.target.value }))}
                          className="w-full text-sm text-slate-100 placeholder:text-slate-500 bg-slate-800 border border-slate-600 rounded px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-500"
                        />
                        <div className="flex gap-1.5">
                          {[1, 2, 3, 4].map((n) => {
                            const s = WARMTH_BUTTON_STYLES[n];
                            return (
                              <button
                                key={n}
                                type="button"
                                onClick={() => setEditValues((p) => ({ ...p, warmth: n }))}
                                className={`flex-1 text-xs font-medium py-1 rounded border transition-colors
                                  ${editValues.warmth === n ? s.active : s.inactive}`}
                              >
                                {WARMTH_LABELS[n]}
                              </button>
                            );
                          })}
                        </div>
                        <div className="flex gap-2 pt-0.5">
                          <button
                            type="button"
                            onClick={() => setEditingContactId(null)}
                            className="flex-1 text-xs font-medium py-1.5 rounded border border-slate-600 text-slate-400 hover:bg-slate-700 transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={contactSaving || !editValues.name.trim()}
                            className="flex-1 text-xs font-medium py-1.5 rounded bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white transition-colors"
                          >
                            {contactSaving ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div key={ct.id} className="flex flex-col">
                        {/* Contact row */}
                        <div
                          className="group flex items-start gap-3.5 py-1.5 cursor-pointer"
                          onClick={() => startEditing(ct)}
                        >
                          <span
                            className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${WARMTH_COLORS[ct.warmth] ?? 'bg-slate-500'}`}
                            title={WARMTH_LABELS[ct.warmth]}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-slate-200 leading-snug">{ct.name}</p>
                            {ct.title && (
                              <p className="text-xs text-slate-500 leading-snug truncate">{ct.title}</p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setLogFormOpen((prev) => prev === ct.id ? null : ct.id);
                              setLogFormData({ date: today(), type: 'email', notes: '' });
                            }}
                            className="text-xs font-medium text-teal-600 hover:text-teal-400 transition-colors shrink-0 px-2.5 py-1 rounded hover:bg-slate-800/60"
                          >
                            + Log
                          </button>
                          <svg
                            className="w-4 h-4 text-slate-600 group-hover:text-slate-400 transition-colors shrink-0 mt-0.5 ml-1"
                            fill="none" stroke="currentColor" viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15.828a2 2 0 01-1.414.586H9v-2a2 2 0 01.586-1.414z" />
                          </svg>
                        </div>

                        {/* Outreach log form */}
                        {logFormOpen === ct.id && (
                          <form
                            onSubmit={(e) => handleLogOutreach(e, ct.id)}
                            className="ml-4 mb-1 flex flex-col gap-2 p-2.5 bg-slate-800/60 rounded-lg border border-slate-700"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex gap-2">
                              <input
                                type="date"
                                value={logFormData.date}
                                onChange={(e) => setLogFormData((p) => ({ ...p, date: e.target.value }))}
                                required
                                className="flex-1 text-xs text-slate-200 bg-slate-800 border border-slate-600 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-500"
                              />
                              <select
                                value={logFormData.type}
                                onChange={(e) => setLogFormData((p) => ({ ...p, type: e.target.value }))}
                                className="flex-1 text-xs text-slate-200 bg-slate-800 border border-slate-600 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-500"
                              >
                                {OUTREACH_TYPES.map((t) => (
                                  <option key={t.value} value={t.value}>{t.label}</option>
                                ))}
                              </select>
                            </div>
                            <textarea
                              value={logFormData.notes}
                              onChange={(e) => setLogFormData((p) => ({ ...p, notes: e.target.value }))}
                              placeholder="Notes (optional)"
                              rows={2}
                              className="w-full text-xs text-slate-200 placeholder:text-slate-500 bg-slate-800 border border-slate-600 rounded px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-teal-500"
                            />
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => setLogFormOpen(null)}
                                className="flex-1 text-xs font-medium py-1 rounded border border-slate-600 text-slate-400 hover:bg-slate-700 transition-colors"
                              >
                                Cancel
                              </button>
                              <button
                                type="submit"
                                disabled={outreachSaving}
                                className="flex-1 text-xs font-medium py-1 rounded bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white transition-colors"
                              >
                                {outreachSaving ? 'Saving…' : 'Save'}
                              </button>
                            </div>
                          </form>
                        )}

                        {/* Outreach entries */}
                        {(outreachMap[ct.id] ?? []).map((entry) => (
                          <div
                            key={entry.id}
                            className="ml-4 flex items-start gap-2 py-0.5 group/entry"
                          >
                            <div className="w-1.5 h-1.5 rounded-full bg-slate-600 mt-1.5 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <span className="text-xs text-slate-500">
                                {entry.date}&nbsp;·&nbsp;
                                <span className="text-slate-400">{OUTREACH_TYPES.find((t) => t.value === entry.type)?.label ?? entry.type}</span>
                              </span>
                              {entry.notes && (
                                <p className="text-xs text-slate-500 truncate">{entry.notes}</p>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => handleDeleteOutreach(ct.id, entry.id)}
                              className="text-slate-700 hover:text-red-400 opacity-0 group-hover/entry:opacity-100 transition-all text-xs shrink-0"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    )
                  )}
                  {!companyContacts.length && !addingContact && (
                    <p className="text-xs text-slate-600 italic">No contacts yet</p>
                  )}
                </div>

                {/* Inline add form */}
                {addingContact && (
                  <form
                    onSubmit={handleAddContact}
                    className="mt-3 flex flex-col gap-2 p-3 bg-slate-800/60 rounded-lg border border-slate-700"
                  >
                    <input
                      type="text"
                      placeholder="Name *"
                      value={newContact.name}
                      onChange={(e) => setNewContact((p) => ({ ...p, name: e.target.value }))}
                      required
                      autoFocus
                      className="w-full text-sm text-slate-100 placeholder:text-slate-500 bg-slate-800 border border-slate-600 rounded px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                    <input
                      type="text"
                      placeholder="Title"
                      value={newContact.title}
                      onChange={(e) => setNewContact((p) => ({ ...p, title: e.target.value }))}
                      className="w-full text-sm text-slate-100 placeholder:text-slate-500 bg-slate-800 border border-slate-600 rounded px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                    {/* Warmth toggle */}
                    <div className="flex gap-1.5">
                      {[1, 2, 3, 4].map((n) => {
                        const s = WARMTH_BUTTON_STYLES[n];
                        return (
                          <button
                            key={n}
                            type="button"
                            onClick={() => setNewContact((p) => ({ ...p, warmth: n }))}
                            className={`flex-1 text-xs font-medium py-1 rounded border transition-colors
                              ${newContact.warmth === n ? s.active : s.inactive}`}
                          >
                            {WARMTH_LABELS[n]}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex gap-2 pt-0.5">
                      <button
                        type="button"
                        onClick={() => { setAddingContact(false); setNewContact({ name: '', title: '', warmth: 2 }); }}
                        className="flex-1 text-xs font-medium py-1.5 rounded border border-slate-600 text-slate-400 hover:bg-slate-700 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={contactSaving || !newContact.name.trim()}
                        className="flex-1 text-xs font-medium py-1.5 rounded bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white transition-colors"
                      >
                        {contactSaving ? 'Adding…' : 'Add'}
                      </button>
                    </div>
                  </form>
                )}
              </section>

            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-slate-800 shrink-0 bg-slate-900/80">
              {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors shadow-lg shadow-teal-950/35"
              >
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

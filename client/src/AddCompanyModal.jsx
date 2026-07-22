import { useState } from 'react';

const VERTICALS = [
  'Fintech',
  'Cloud / Data Platforms',
  'Commerce / SMB Platform',
  'Mission-Driven / Vertical SaaS',
  'Other',
];

const TIERS = ['Tier A', 'Tier B', 'Tier C'];

const JOB_BOARD_LABELS = {
  greenhouse: 'Greenhouse',
  ashby: 'Ashby',
  lever: 'Lever',
  workday: 'Workday',
};

export default function AddCompanyModal({ onClose, onAdd }) {
  const [name, setName] = useState('');
  const [vertical, setVertical] = useState(VERTICALS[0]);
  const [priorityTier, setPriorityTier] = useState('Tier B');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), vertical, priorityTier }),
      });
      if (!res.ok) throw new Error('Failed to create company');
      const created = await res.json();
      onAdd(created);
      setResult(created);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Dialog */}
      <div className="relative bg-slate-900 border border-slate-800 rounded-xl shadow-2xl shadow-black/50 w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-slate-100">Add Company</h2>
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

        {result ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-slate-300">
              Checked Greenhouse, Ashby, Lever & Workday for <span className="font-medium text-slate-100">{result.name}</span>:
            </p>
            <div className="flex flex-col gap-1.5">
              {Object.entries(JOB_BOARD_LABELS).map(([source, label]) => {
                const found = result.jobBoardDetection?.[source];
                return (
                  <div
                    key={source}
                    className={`flex items-center justify-between text-sm rounded-lg border px-3 py-1.5
                      ${found ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300' : 'border-slate-800 bg-slate-800/40 text-slate-500'}`}
                  >
                    <span>{label}</span>
                    <span className="text-xs font-medium">{found ? 'Found' : 'Not found'}</span>
                  </div>
                );
              })}
            </div>

            {!result.jobBoardDetection?.anyFound && (
              <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2">
                No job board found automatically. You can add one manually from the company's detail panel.
              </p>
            )}

            <button
              type="button"
              onClick={onClose}
              className="w-full text-sm font-medium py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-white transition-colors shadow-lg shadow-teal-950/35"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Company name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Acme Corp"
                autoFocus
                required
                className="w-full text-sm text-slate-100 placeholder:text-slate-500 border border-slate-600 rounded-lg px-3 py-2 bg-slate-800/80 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Vertical</label>
              <select
                value={vertical}
                onChange={(e) => setVertical(e.target.value)}
                className="w-full text-sm border border-slate-600 rounded-lg px-3 py-2 bg-slate-800 text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                {VERTICALS.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Priority tier</label>
              <div className="flex gap-2">
                {TIERS.map((tier) => (
                  <button
                    key={tier}
                    type="button"
                    onClick={() => setPriorityTier(tier)}
                    className={`flex-1 text-sm font-medium py-1.5 rounded-lg border transition-colors
                      ${priorityTier === tier
                        ? tier === 'Tier A'
                          ? 'bg-emerald-500/20 border-emerald-500/55 text-emerald-300'
                          : tier === 'Tier B'
                          ? 'bg-amber-500/20 border-amber-500/55 text-amber-300'
                          : 'bg-slate-600/50 border-slate-500 text-slate-200'
                        : 'bg-slate-800/60 border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-400'
                      }`}
                  >
                    {tier}
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 text-sm font-medium py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !name.trim()}
                className="flex-1 text-sm font-medium py-2 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white transition-colors shadow-lg shadow-teal-950/35"
              >
                {saving ? 'Checking job boards…' : 'Add Company'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

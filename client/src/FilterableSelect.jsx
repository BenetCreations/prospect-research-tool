import { useEffect, useRef, useState } from 'react';

/**
 * A filterable combobox dropdown for use in spreadsheet-style rows.
 *
 * Props:
 *   value        – current selected value (string)
 *   options      – array of strings to choose from
 *   onChange     – called with new value when selection changes
 *   onTab        – called when Tab is pressed (after committing selection); used for cell navigation
 *   placeholder  – input placeholder text
 *   className    – extra classes on the wrapper div
 *   inputClass   – extra classes on the input element
 *   disabled     – disables the input
 */
export default function FilterableSelect({
  value = '',
  options = [],
  onChange,
  onTab,
  placeholder = '',
  className = '',
  inputClass = '',
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const wrapperRef = useRef(null);

  // Sync display text when value changes externally
  const [displayText, setDisplayText] = useState(value);
  useEffect(() => { setDisplayText(value); }, [value]);

  const filtered = query
    ? options.filter((o) => o.toLowerCase().includes(query.toLowerCase()))
    : options;

  // Keep highlighted in bounds
  useEffect(() => {
    setHighlighted(0);
  }, [query]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (open && listRef.current) {
      const item = listRef.current.children[highlighted];
      item?.scrollIntoView({ block: 'nearest' });
    }
  }, [highlighted, open]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        commitAndClose(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open, displayText, value]);

  function commitAndClose(revert = true) {
    if (revert) setDisplayText(value);
    setQuery('');
    setOpen(false);
  }

  function selectOption(opt) {
    setDisplayText(opt);
    setQuery('');
    setOpen(false);
    onChange?.(opt);
  }

  function handleFocus() {
    setQuery('');
    setDisplayText('');
    setOpen(true);
  }

  function handleInputChange(e) {
    setQuery(e.target.value);
    setDisplayText(e.target.value);
    setOpen(true);
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && filtered[highlighted]) {
        selectOption(filtered[highlighted]);
      }
    } else if (e.key === 'Tab') {
      // Commit first filtered match (or currently highlighted), then let Tab bubble for cell nav
      const toSelect = filtered[highlighted] ?? filtered[0] ?? null;
      if (toSelect) {
        onChange?.(toSelect);
        setDisplayText(toSelect);
      } else if (displayText && !options.includes(displayText)) {
        // Free-text not in list — revert to last known good value
        setDisplayText(value);
      }
      setQuery('');
      setOpen(false);
      onTab?.();
      // Don't preventDefault — let Tab propagate so focus moves to next cell
    } else if (e.key === 'Escape') {
      e.preventDefault();
      commitAndClose(true);
      inputRef.current?.blur();
    }
  }

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        value={open ? (query || displayText) : displayText}
        placeholder={placeholder}
        disabled={disabled}
        onChange={handleInputChange}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        className={`w-full bg-transparent outline-none ${inputClass}`}
      />
      {open && filtered.length > 0 && (
        <ul
          ref={listRef}
          className="absolute z-50 top-full left-0 mt-0.5 w-full min-w-max bg-slate-800 border border-slate-600 rounded shadow-xl max-h-52 overflow-y-auto"
        >
          {filtered.map((opt, i) => (
            <li
              key={opt}
              onMouseDown={(e) => { e.preventDefault(); selectOption(opt); }}
              onMouseEnter={() => setHighlighted(i)}
              className={`px-3 py-1.5 text-sm cursor-pointer select-none
                ${i === highlighted ? 'bg-teal-600/30 text-teal-100' : 'text-slate-200 hover:bg-slate-700'}`}
            >
              {opt}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

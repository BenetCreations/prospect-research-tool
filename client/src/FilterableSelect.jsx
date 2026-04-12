import { forwardRef, useEffect, useImperativeHandle, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

/**
 * A filterable combobox dropdown for use in spreadsheet-style rows.
 *
 * Props:
 *   value        – current selected value (string)
 *   options      – array of strings to choose from
 *   onChange     – called with new value when selection changes
 *   onTab        – called with (shiftKey: boolean) when Tab is pressed;
 *                  the focus move is deferred so React can flush state first
 *   placeholder  – input placeholder text
 *   className    – extra classes on the wrapper div
 *   inputClass   – extra classes on the input element
 *   disabled     – disables the input
 */
const FilterableSelect = forwardRef(function FilterableSelect({
  value = '',
  options = [],
  onChange,
  onTab,
  placeholder = '',
  className = '',
  inputClass = '',
  disabled = false,
}, ref) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const [dropdownStyle, setDropdownStyle] = useState({});
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const wrapperRef = useRef(null);
  // Track whether we're committing via Tab so blur doesn't fight us
  const tabCommittingRef = useRef(false);

  // Expose the inner input element to parent via ref
  useImperativeHandle(ref, () => inputRef.current);

  // Sync display text when value changes externally
  const [displayText, setDisplayText] = useState(value);
  useEffect(() => { setDisplayText(value); }, [value]);

  const filtered = query
    ? options.filter((o) => o.toLowerCase().includes(query.toLowerCase()))
    : options;

  // Keep highlighted in bounds
  useEffect(() => { setHighlighted(0); }, [query]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (open && listRef.current) {
      const item = listRef.current.children[highlighted];
      if (item) {
        const list = listRef.current;
        const itemTop = item.offsetTop;
        const itemBottom = itemTop + item.offsetHeight;
        if (itemTop < list.scrollTop) {
          list.scrollTop = itemTop;
        } else if (itemBottom > list.scrollTop + list.clientHeight) {
          list.scrollTop = itemBottom - list.clientHeight;
        }
      }
    }
  }, [highlighted, open]);

  // Position the portal dropdown below the input
  useEffect(() => {
    if (open && inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      setDropdownStyle({
        position: 'fixed',
        top: rect.bottom + 2,
        left: rect.left,
        minWidth: rect.width,
        zIndex: 9999,
      });
    }
  }, [open]);

  // Close on outside click — but skip if tab-committing
  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (tabCommittingRef.current) return;
      if (
        wrapperRef.current && !wrapperRef.current.contains(e.target) &&
        (!listRef.current || !listRef.current.contains(e.target))
      ) {
        setDisplayText(value);
        setQuery('');
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open, value]);

  const selectOption = useCallback((opt) => {
    setDisplayText(opt);
    setQuery('');
    setOpen(false);
    onChange?.(opt);
  }, [onChange]);

  function handleFocus() {
    if (tabCommittingRef.current) return;
    setQuery('');
    setDisplayText('');
    setOpen(true);
  }

  function handleInputChange(e) {
    setQuery(e.target.value);
    setDisplayText(e.target.value);
    setOpen(true);
  }

  function handleBlur() {
    // If a tab commit is in progress, don't interfere
    if (tabCommittingRef.current) return;
    // Small delay to allow mousedown on dropdown items to fire first
    setTimeout(() => {
      if (tabCommittingRef.current) return;
      if (!open) return;
      setDisplayText(value);
      setQuery('');
      setOpen(false);
    }, 150);
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
      e.preventDefault();
      tabCommittingRef.current = true;

      // Commit the best match
      const toSelect = filtered[highlighted] ?? filtered[0] ?? null;
      if (toSelect) {
        onChange?.(toSelect);
        setDisplayText(toSelect);
      } else if (displayText && !options.includes(displayText)) {
        setDisplayText(value);
      }
      setQuery('');
      setOpen(false);

      // Defer focus move to after React flushes the state updates above.
      // requestAnimationFrame ensures the DOM is settled before we move focus.
      const shiftKey = e.shiftKey;
      requestAnimationFrame(() => {
        tabCommittingRef.current = false;
        onTab?.(shiftKey);
      });
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setDisplayText(value);
      setQuery('');
      setOpen(false);
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
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        className={`w-full bg-transparent outline-none ${inputClass}`}
      />
      {open && filtered.length > 0 && createPortal(
        <ul
          ref={listRef}
          style={dropdownStyle}
          className="min-w-max bg-slate-800 border border-slate-600 rounded shadow-xl max-h-52 overflow-y-auto"
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
        </ul>,
        document.body
      )}
    </div>
  );
});

export default FilterableSelect;

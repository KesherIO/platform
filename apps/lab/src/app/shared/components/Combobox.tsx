import { useState, useRef, useEffect } from 'react';

interface ComboboxProps {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  readOnly?: boolean;
  className?: string;
  placeholder?: string;
  multiLine?: boolean;
}

export function Combobox({
  value,
  options,
  onChange,
  readOnly,
  className = '',
  placeholder,
  multiLine,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = options.filter((o) =>
    o.toLowerCase().includes((query || '').toLowerCase())
  );

  const handleSelect = (opt: string) => {
    if (multiLine) {
      const trimmed = value.trim();
      const next = trimmed ? `${trimmed}. ${opt}` : opt;
      onChange(next);
    } else {
      onChange(opt);
    }
    setOpen(false);
    setQuery('');
    inputRef.current?.focus();
  };

  const InputTag = multiLine ? 'textarea' : 'input';

  return (
    <div ref={ref} className="relative">
      <InputTag
        ref={inputRef as never}
        type={multiLine ? undefined : 'text'}
        rows={multiLine ? 3 : undefined}
        readOnly={readOnly}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setQuery(e.target.value.split('. ').pop() ?? '');
          if (!open) setOpen(true);
        }}
        onFocus={() => {
          if (!readOnly && options.length > 0) {
            setQuery('');
            setOpen(true);
          }
        }}
        className={`${className} ${multiLine ? 'resize-none' : ''}`}
      />
      {open && !readOnly && filtered.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-gray-700 bg-gray-900 py-1 shadow-lg">
          {filtered.map((opt) => (
            <li key={opt}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelect(opt)}
                className={`w-full px-3 py-1.5 text-left text-sm transition hover:bg-gray-800 ${
                  value.includes(opt)
                    ? 'text-cyan font-medium'
                    : 'text-gray-300'
                }`}
              >
                {opt}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

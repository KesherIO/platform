import { useEffect, useRef, useState, ReactNode } from 'react';
import { Info } from 'lucide-react';

interface InfoPopoverProps {
  /** Accessible label for the trigger button and the popover itself. */
  label: string;
  children: ReactNode;
}

/**
 * Small "i" trigger that reveals a dark popover panel on click — for short
 * reference info near a page header, not a full modal. Closes on
 * click-outside or Escape.
 */
export function InfoPopover({ label, children }: InfoPopoverProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        aria-expanded={open}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
      >
        <Info size={18} strokeWidth={2} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={label}
          className="absolute left-0 top-full z-20 mt-2 w-72 rounded-xl border border-gray-700 bg-gray-900 p-4 shadow-2xl"
        >
          {children}
        </div>
      )}
    </div>
  );
}

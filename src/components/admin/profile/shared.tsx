import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface SectionCardProps {
  eyebrow: string;
  title: string;
  description?: string;
  className?: string;
  children: ReactNode;
}

interface FieldProps {
  label: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}

export const inputClassName =
  'mt-1.5 w-full rounded-lg border border-[color:var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text)] outline-none transition focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:var(--accent)]/20';

export const textareaClassName = `${inputClassName} resize-y`;

export const SectionCard = ({
  eyebrow,
  title,
  description,
  className = '',
  children
}: SectionCardProps) => (
  <section
    className={`rounded-lg border border-[color:var(--border)] bg-[var(--surface)] p-4 ${className}`}
  >
    <div className="mb-3 space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--text-muted)]">
        {eyebrow}
      </p>
      <div>
        <h3 className="font-display text-lg font-semibold text-[var(--text)]">{title}</h3>
        {description && <p className="mt-1 text-sm text-[var(--text-muted)]">{description}</p>}
      </div>
    </div>
    {children}
  </section>
);

interface TagListInputProps {
  values: string[];
  onChange: (values: string[]) => void;
  emptyPlaceholder: string;
  morePlaceholder: string;
  ariaLabel?: string;
}

// Enter or a comma adds the typed tag; Backspace on an empty input removes the last one.
export const TagListInput = ({
  values,
  onChange,
  emptyPlaceholder,
  morePlaceholder,
  ariaLabel
}: TagListInputProps) => {
  const [inputValue, setInputValue] = useState('');

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      const nextTag = inputValue.trim();
      if (nextTag && !values.includes(nextTag)) {
        onChange([...values, nextTag]);
        setInputValue('');
      }
      return;
    }

    if (event.key === 'Backspace' && !inputValue && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div className="rounded-lg border border-[color:var(--border)] bg-[var(--surface-muted)] p-4">
      <div className="flex flex-wrap items-center gap-2">
        {values.map(tag => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-lg border border-[color:var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--text)]"
          >
            {tag}
            <button
              type="button"
              aria-label={`${tag} 삭제`}
              onClick={() => onChange(values.filter(value => value !== tag))}
              className="rounded-md p-0.5 text-[var(--text-muted)] transition hover:bg-[var(--surface-muted)] hover:text-red-500 dark:hover:text-red-300"
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          value={inputValue}
          aria-label={ariaLabel}
          onChange={event => setInputValue(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={values.length ? morePlaceholder : emptyPlaceholder}
          className="min-w-[200px] flex-1 bg-transparent px-1 py-2 text-sm text-[var(--text)] outline-none"
        />
      </div>
    </div>
  );
};

export const Field = ({ label, hint, className = '', children }: FieldProps) => (
  <label className={`block text-xs uppercase tracking-[0.18em] text-[var(--text-muted)] ${className}`}>
    <span>{label}</span>
    {hint && <span className="mt-1 block text-[11px] normal-case tracking-normal">{hint}</span>}
    {children}
  </label>
);

/** Simple stamp-card mark. Decorative: the adjacent text carries the name, so it is hidden from screen readers. */
export function Logo({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <rect x="2" y="6" width="28" height="20" rx="5" fill="var(--tc-green-700)" />
      <circle cx="11" cy="16" r="3.2" fill="var(--tc-gold-500)" />
      <circle cx="21" cy="16" r="3.2" fill="none" stroke="var(--tc-gold-300)" strokeWidth="1.6" />
    </svg>
  );
}

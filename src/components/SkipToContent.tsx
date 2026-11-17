import type { MouseEvent } from 'react';

// Pages put this id on their <main> element.
const MAIN_CONTENT_ID = 'main-content';

// Moves focus without touching the URL hash, which the router and the post page's
// heading-anchor handling also react to.
const focusMainContent = (event: MouseEvent<HTMLAnchorElement>) => {
  const main = document.getElementById(MAIN_CONTENT_ID);
  if (!main) return;
  event.preventDefault();
  main.focus();
};

export function SkipToContent() {
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      onClick={focusMainContent}
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:border focus:border-[color:var(--border)] focus:bg-[var(--surface)] focus:px-3 focus:py-2 focus:text-sm focus:text-[var(--text)] focus:shadow"
    >
      본문으로 건너뛰기
    </a>
  );
}

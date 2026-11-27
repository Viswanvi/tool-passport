/**
 * The card's icons, drawn here as plain SVG so nothing is fetched from outside the app (Runs on Atlassian). Simple
 * outline shapes on a 24-unit grid, coloured by `currentColor`.
 */

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false">${body}</svg>`;

export const ICONS = {
  check: svg('<path d="M5 12l5 5l10 -10"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>'),
  alert: svg('<path d="M10.3 4.2L2.6 17.5a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
  question: svg('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .9-1 1.6v.4"/><path d="M12 17h.01"/>'),
  ban: svg('<circle cx="12" cy="12" r="9"/><path d="M5.7 5.7l12.6 12.6"/>'),
  minus: svg('<path d="M6 12h12"/>'),
  cube: svg('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5"/><path d="M12 12v9"/><path d="M12 12L4 7.5"/>'),
  shield: svg('<path d="M12 3l8 3v5c0 5-3.4 8.6-8 10c-4.6-1.4-8-5-8-10V6z"/>'),
  server: svg('<rect x="4" y="4" width="16" height="6" rx="1.5"/><rect x="4" y="14" width="16" height="6" rx="1.5"/><path d="M8 7h.01"/><path d="M8 17h.01"/>'),
  key: svg('<circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L20 3"/><path d="M16 7l3 3"/><path d="M14 9l2 2"/>'),
  sparkles: svg('<path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z"/><path d="M19 15l.7 1.6l1.6 .7l-1.6 .7L19 19.6l-.7-1.6l-1.6-.7l1.6-.7z"/>'),
  search: svg('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>'),
  passport: svg('<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M9 17h6"/>'),
} as const;

export type IconName = keyof typeof ICONS;

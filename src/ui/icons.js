/*
 * OpenAutoGrowth — Inline SVG icon set
 * Style: 1.5px stroke, round caps, no fill, currentColor.
 * Mirrors lucide icon geometry. See: docs/frontend/01-design-system.md §8
 */

const PATHS = {
  // ── Agent icons ────────────────────────────────
  'network':      '<circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><line x1="12" y1="7" x2="5" y2="17"/><line x1="12" y1="7" x2="19" y2="17"/><line x1="7" y1="19" x2="17" y2="19"/>',
  'map':          '<polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21 3 6"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/>',
  'trending-up':  '<polyline points="3 17 9 11 13 15 21 7"/><polyline points="14 7 21 7 21 14"/>',
  'pen-line':     '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>',
  'image':        '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>',
  'radio-tower':  '<path d="M4.93 4.93c-2.55 2.54-2.55 6.67 0 9.21"/><path d="M19.07 4.93c2.55 2.54 2.55 6.67 0 9.21"/><path d="M7.76 7.76a4 4 0 0 0 0 5.66"/><path d="M16.24 7.76a4 4 0 0 1 0 5.66"/><circle cx="12" cy="10" r="1.5"/><path d="M12 12v10"/><path d="M8 22h8"/>',
  'bar-chart':    '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="3" y1="20" x2="21" y2="20"/>',
  'settings':     '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',

  // ── UI icons ───────────────────────────────────
  'sprout':       '<path d="M7 20h10"/><path d="M10 20c5.5-2.5.8-6.4 3-10"/><path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z"/><path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z"/>',
  'play':         '<polygon points="6 4 20 12 6 20 6 4"/>',
  'rocket':       '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
  'chevron-down': '<polyline points="6 9 12 15 18 9"/>',
  'chevron-right':'<polyline points="9 18 15 12 9 6"/>',
  'arrow-left':   '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  'arrow-right':  '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
  'dot':          '<circle cx="12" cy="12" r="4"/>',
  'check':        '<polyline points="20 6 9 17 4 12"/>',
  'x':            '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  'sparkles':     '<path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/><path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z"/>',
  'activity':     '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  'clock':        '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  'globe':        '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
};

const SIZES = { sm: 16, md: 20, lg: 24 };

/**
 * Render an inline SVG icon string.
 * @param {string} name - icon key, see PATHS
 * @param {'sm'|'md'|'lg'|number} [size='md']
 * @param {object} [opts]
 * @param {string} [opts.className]
 * @param {string} [opts.ariaLabel]
 */
export function icon(name, size = 'md', opts = {}) {
  const px = typeof size === 'number' ? size : (SIZES[size] || 20);
  const body = PATHS[name];
  if (!body) {
    console.warn(`[icons] unknown icon: ${name}`);
    return '';
  }
  const cls = opts.className ? ` class="${opts.className}"` : '';
  const a11y = opts.ariaLabel
    ? ` role="img" aria-label="${opts.ariaLabel}"`
    : ' aria-hidden="true"';
  return `<svg${cls}${a11y} width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

export const availableIcons = Object.keys(PATHS);

import type { Card, Chip, Stamp } from '../engine/card';

/**
 * How a card's evidence reads, shared by the UI Kit screens and the Custom UI card frame (D59), so both say exactly
 * the same thing. Times are formatted in the viewer's own time zone. No Forge imports.
 */

export const time = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export const day = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

/** "until Dec 26" on an approval that lapses; "on Dec 26" on one that has. */
export const untilText = (c: Chip) => (c.until && day(c.until) ? ` · ${c.label === 'Approval expired' ? 'on' : 'until'} ${day(c.until)}` : '');

/** The full evidence line: "Assets record · read 02:08 PM", "Approved · TPD-12 · until Dec 26". */
export function chipText(c: Chip): string {
  if (c.label === 'Assets record') return `Assets record · read ${time(c.readAt)}`;
  if (c.label === 'Recorded by owner') return `Recorded by owner${c.changedAt ? ` · ${day(c.changedAt)}` : ''}`;
  return `${c.label} · ${c.detail}${untilText(c)}`;
}

/** The evidence label in a few words ("Owner-verified · 13.2"); the full line goes in the tooltip. */
export function chipShort(c: Chip): string {
  const short = c.detail && c.detail.length <= 12 && c.label !== 'Assets record' && c.label !== 'Recorded by owner';
  return short ? `${c.label} · ${c.detail}` : c.label;
}

/** One check in words, for Details. */
export function checkLine(c: Card['checks'][number]): string {
  const chip = c.chip;
  const extra =
    chip.label === 'Assets record' || chip.label === 'Recorded by owner'
      ? `${chip.detail}${chip.changedAt ? `, changed ${day(chip.changedAt)}` : ''}`
      : `${chip.detail}${untilText(chip)}`;
  return `${c.subject}: ${c.statusText} (${chip.label}${extra ? ` · ${extra}` : ''})`;
}

/**
 * A stamp's third line and its tooltip. The third line is its evidence in a few words or, when it didn't pass, what
 * is missing; the tooltip carries everything.
 */
export function stampLines(stamp: Stamp): { third: string | null; tip: string } {
  const third = stamp.state !== 'pass' && stamp.detail ? stamp.detail : stamp.chip ? chipShort(stamp.chip) : null;
  const more = stamp.more ? `+${stamp.more} more ${stamp.more === 1 ? 'check' : 'checks'}` : null;
  const tip = [stamp.detail, stamp.chip ? `Evidence: ${chipText(stamp.chip)}` : null, more].filter(Boolean).join(' · ');
  return { third, tip };
}

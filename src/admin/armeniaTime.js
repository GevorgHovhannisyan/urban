// The store operates out of Armenia, and the admin scheduling dates
// (drop releases, early access) should always be entered/read in Armenia
// Time regardless of the machine the admin panel happens to be opened on —
// relying on the browser's own timezone (via Date.getTimezoneOffset()) broke
// this whenever the admin's OS clock wasn't actually set to Armenia,
// producing dates that looked right on-screen but were hours or, combined
// with manual re-entry, entire months off from what was intended.
//
// Armenia has used a fixed UTC+4 offset with no daylight saving time since
// 2012, so this can be a constant rather than a real timezone-database
// lookup.
export const ARMENIA_OFFSET_MINUTES = 4 * 60;
export const ARMENIA_LABEL = 'Armenia Time, UTC+4';

// <input type="datetime-local"> needs "YYYY-MM-DDTHH:mm" with no timezone
// suffix, and just displays those digits verbatim — it doesn't know or care
// what timezone they represent. The API stores/returns UTC ISO strings, so
// turning one into the other means shifting the instant by the Armenia
// offset, not the viewer's local offset.
export function toArmeniaDatetimeLocal(iso) {
  if (!iso) return '';
  const utcMs = new Date(iso).getTime();
  return new Date(utcMs + ARMENIA_OFFSET_MINUTES * 60000).toISOString().slice(0, 16);
}

// Reverses the above: the digits the admin typed are Armenia wall-clock
// time. Appending "Z" forces JS to parse them as UTC digits first (rather
// than guessing via the browser's own timezone), then subtracting the
// offset converts that back to the true UTC instant for storage.
export function fromArmeniaDatetimeLocal(local) {
  if (!local) return null;
  const armeniaMs = new Date(`${local}:00.000Z`).getTime();
  return new Date(armeniaMs - ARMENIA_OFFSET_MINUTES * 60000).toISOString();
}

export function nowInArmeniaForInput() {
  return toArmeniaDatetimeLocal(new Date().toISOString());
}

// Relative presets ("Tomorrow", "+1 Week"...) sidestep the browser's native
// datetime-local widget entirely, which renders as separate mm/dd/yyyy
// number segments — typing into the wrong segment (easy to do, especially
// coming from Armenia's day-first date convention) silently produces a
// wildly different, no-warning-given date.
export function armeniaInputFromNowPlusMs(ms) {
  return toArmeniaDatetimeLocal(new Date(Date.now() + ms).toISOString());
}

// A plain-language readout of whatever's currently in a datetime-local
// input, so a mis-typed date is obvious immediately instead of discovered
// later on the live storefront. `local`'s digits already represent Armenia
// time (see toArmeniaDatetimeLocal above) — formatting with timeZone: 'UTC'
// prints those digits verbatim rather than re-shifting by the viewer's own
// browser timezone.
// For displaying a stored UTC ISO timestamp as Armenia time — unlike the
// datetime-local helpers above, this doesn't need manual offset math since
// Intl already knows the Asia/Yerevan zone (fixed UTC+4, no DST).
export function formatArmeniaInstant(iso) {
  if (!iso) return '';
  return `${new Date(iso).toLocaleString('en-US', {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Yerevan',
  })} (Armenia Time)`;
}

export function formatArmeniaPreview(local) {
  if (!local) return '';
  const d = new Date(`${local}:00.000Z`);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleString('en-US', {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
  })} (Armenia Time)`;
}

import { Input } from './AdminLayout';
import { ARMENIA_LABEL, armeniaInputFromNowPlusMs, formatArmeniaPreview } from '../armeniaTime';

const PRESETS = [
  ['Now', 0],
  ['+1 Hour', 60 * 60 * 1000],
  ['Tomorrow', 24 * 60 * 60 * 1000],
  ['+3 Days', 3 * 24 * 60 * 60 * 1000],
  ['+1 Week', 7 * 24 * 60 * 60 * 1000],
];

// Drop/early-access date picker shared by Products and Drops. A native
// <input type="datetime-local"> renders as separate mm/dd/yyyy number
// segments — typing into the wrong one (easy to do, especially coming from
// Armenia's day-first date convention) silently produces a wildly different
// date with no warning. The preset buttons sidestep typing a date at all for
// the common cases, the calendar icon opens the browser's picker, and the
// preview line makes whatever ends up in the field impossible to misread
// before saving. `value` is an Armenia-time "YYYY-MM-DDTHH:mm" string.
export default function ArmeniaDateField({ label, value, onChange }) {
  return (
    <div>
      <Input
        label={`${label} (${ARMENIA_LABEL})`}
        type="datetime-local"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        // Opening the picker on click makes the whole field usable, not just
        // the small calendar icon (showPicker isn't available everywhere).
        onClick={(e) => { try { e.currentTarget.showPicker?.(); } catch { /* unsupported */ } }}
        style={{ colorScheme: 'dark' }}
      />
      <p className={`text-[11px] mt-1.5 ${value ? 'text-white/70' : 'text-white/40'}`}>{value ? `→ ${formatArmeniaPreview(value)}` : 'No date set'}</p>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
        {PRESETS.map(([presetLabel, ms]) => (
          <button
            key={presetLabel}
            type="button"
            onClick={() => onChange(armeniaInputFromNowPlusMs(ms))}
            className="text-[11px] font-mono uppercase tracking-widest text-white/50 hover:text-white transition-colors underline underline-offset-4"
          >
            {presetLabel}
          </button>
        ))}
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="text-[11px] font-mono uppercase tracking-widest text-[#e5484d]/80 hover:text-[#e5484d] transition-colors underline underline-offset-4"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

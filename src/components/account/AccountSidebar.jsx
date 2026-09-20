// Grouped by what the section is actually for (buying vs. managing the
// account itself) instead of one flat 01-09 list — the numbering read as
// arbitrary once there were nine of them, and grouping is what actually
// helps someone scan for "where do I check my order" vs. "where do I change
// my password." Sign Out stays its own thing at the bottom, outside both
// groups, exactly as before.
const GROUPS = [
  {
    label: 'Shopping',
    items: [
      { id: 'overview', label: 'Overview' },
      { id: 'orders', label: 'My Orders' },
      { id: 'archive', label: 'My Archive' },
      { id: 'rewards', label: 'Rewards' },
      { id: 'wishlist', label: 'Wishlist' },
    ],
  },
  {
    label: 'Account',
    items: [
      { id: 'addresses', label: 'Addresses' },
      { id: 'profile', label: 'Profile' },
      { id: 'preferences', label: 'Preferences' },
      { id: 'security', label: 'Security' },
    ],
  },
];
const SECTIONS = GROUPS.flatMap((g) => g.items);

export default function AccountSidebar({ active, onSelect, onSignOut }) {
  return (
    <nav className="account-sidebar" aria-label="Account navigation">
      {/* Mobile: dropdown, no horizontal overflow */}
      <div className="lg:hidden flex gap-3 mb-8">
        <select
          value={active}
          onChange={(e) => onSelect(e.target.value)}
          aria-label="Account section"
          className="up-input flex-1"
        >
          {GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.items.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </optgroup>
          ))}
        </select>
        <button onClick={onSignOut} className="border border-border px-4 text-[10px] font-mono uppercase tracking-widest shrink-0">
          Sign Out
        </button>
      </div>

      {/* Desktop: full sidebar, grouped */}
      <div className="hidden lg:block space-y-7">
        {GROUPS.map((group) => (
          <div key={group.label}>
            <p className="px-4 mb-2 text-[10px] font-mono text-muted/80 tracking-[.22em] uppercase">{group.label}</p>
            <ul className="space-y-0.5">
              {group.items.map((s) => (
                <li key={s.id}>
                  <button
                    onClick={() => onSelect(s.id)}
                    aria-current={active === s.id ? 'page' : undefined}
                    className={`w-full text-left px-4 py-3 flex items-center text-xs tracking-widest uppercase font-mono transition-all duration-300 border-l-2 ${
                      active === s.id
                        ? 'border-accent text-fg bg-accent/[0.07] shadow-[inset_0_0_20px_-14px_rgba(198,93,30,0.6)]'
                        : 'border-transparent text-muted hover:text-fg hover:bg-fg/[0.03] hover:border-border'
                    }`}
                  >
                    {s.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <button
        onClick={onSignOut}
        className="hidden lg:block mt-7 w-full text-left px-4 py-3 text-xs tracking-widest uppercase font-mono text-muted hover:text-accent transition-colors duration-300 border-l-2 border-transparent hover:border-accent/40"
      >
        Sign Out
      </button>
    </nav>
  );
}

export { SECTIONS };

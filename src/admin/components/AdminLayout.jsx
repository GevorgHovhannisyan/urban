import { useAdminAuth } from '../context/AdminAuthContext';

export const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: 'M3 13h8V3H3zM13 21h8V11h-8zM13 3v6h8V3zM3 21h8v-6H3z' },
  { id: 'products', label: 'Products', icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4' },
  { id: 'drops', label: 'Drops', icon: 'M13 2 3 14h7l-1 8 11-14h-7l1-6z' },
  { id: 'orders', label: 'Orders', icon: 'M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0' },
  { id: 'returns', label: 'Returns', icon: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5' },
  { id: 'reviews', label: 'Reviews', icon: 'M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z' },
  { id: 'editions', label: 'Limited Editions', icon: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4' },
  { id: 'promos', label: 'Promo Codes', icon: 'M20.59 13.41L13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01' },
  { id: 'gift-cards', label: 'Gift Cards', icon: 'M20 12v8H4v-8M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z' },
  { id: 'reports', label: 'Reports', icon: 'M3 3v18h18M7 15l4-4 3 3 5-6' },
  { id: 'journal', label: 'Journal', icon: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z' },
  { id: 'customers', label: 'Customers', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' },
  { id: 'newsletter', label: 'Newsletter', icon: 'M4 4h16v16H4zM22 6l-10 7L2 6' },
  { id: 'content', label: 'Site Content', icon: 'M4 7V4h16v3M9 20h6M12 4v16' },
  { id: 'community', label: 'Community', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17 3.13a4 4 0 0 1 0 7.75M21 21v-2a4 4 0 0 0-3-3.87' },
  { id: 'media', label: 'Media Library', icon: 'M3 3h18v18H3zM3 15l5-5 4 4 5-5 4 4M8.5 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z' },
];

function Icon({ path, className = 'w-[18px] h-[18px]' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d={path} />
    </svg>
  );
}

export default function AdminLayout({ section, onNavigate, title, subtitle, actions, children }) {
  const { email, logout } = useAdminAuth();

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-[#F5F5F3] flex font-body" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      {/* Sidebar */}
      <aside className="w-64 shrink-0 border-r border-white/8 flex flex-col h-screen sticky top-0">
        <div className="px-6 py-6 border-b border-white/8">
          <p className="font-display font-black tracking-[0.25em] uppercase text-lg" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
            Urban Phoenix
          </p>
          <p className="text-[10px] font-mono text-white/40 tracking-[0.2em] uppercase mt-1">Admin</p>
        </div>

        <nav className="flex-1 overflow-y-auto py-4">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`w-full flex items-center gap-3 px-6 py-3 text-sm transition-colors ${
                section === item.id
                  ? 'text-white bg-white/[0.06] border-r-2 border-[#C65D1E]'
                  : 'text-white/50 hover:text-white hover:bg-white/[0.03]'
              }`}
            >
              <Icon path={item.icon} />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="px-6 py-5 border-t border-white/8">
          <p className="text-xs text-white/40 truncate mb-3">{email}</p>
          <button onClick={logout} className="text-[11px] font-mono uppercase tracking-widest text-white/50 hover:text-white transition-colors">
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 min-w-0">
        <header className="border-b border-white/8 px-8 py-6 flex items-center justify-between gap-4 sticky top-0 bg-[#0A0A0A]/95 backdrop-blur z-10">
          <div>
            <h1 className="text-2xl font-display font-black uppercase tracking-wide" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>{title}</h1>
            {subtitle && <p className="text-sm text-white/40 mt-0.5">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-3 shrink-0">{actions}</div>}
        </header>
        <main className="p-8">{children}</main>
      </div>
    </div>
  );
}

export function StatCard({ label, value, accent = false }) {
  return (
    <div className="bg-white/[0.03] border border-white/8 p-5">
      <p className="text-[11px] font-mono uppercase tracking-widest text-white/40 mb-2">{label}</p>
      <p className={`text-3xl font-display font-black ${accent ? 'text-[#C65D1E]' : 'text-white'}`} style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>{value}</p>
    </div>
  );
}

export function Badge({ tone = 'neutral', children }) {
  const tones = {
    neutral: 'bg-white/8 text-white/60',
    success: 'bg-[#1a2e1a] text-[#6fbf73]',
    warn: 'bg-[#2e2a1a] text-[#d9a441]',
    danger: 'bg-[#2e1a1a] text-[#e5484d]',
    info: 'bg-[#1a232e] text-[#5b9bd9]',
  };
  return <span className={`inline-block px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest ${tones[tone]}`}>{children}</span>;
}

export function Button({ variant = 'secondary', className = '', ...props }) {
  const base = 'text-[11px] font-mono uppercase tracking-widest px-4 py-2.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
  const variants = {
    primary: 'bg-[#C65D1E] text-white hover:bg-[#D96B26]',
    secondary: 'border border-white/15 text-white/70 hover:text-white hover:border-white/30',
    danger: 'border border-[#e5484d]/40 text-[#e5484d] hover:bg-[#e5484d]/10',
  };
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

export function Input({ label, className = '', ...props }) {
  return (
    <label className="block">
      {label && <span className="block text-[11px] font-mono uppercase tracking-widest text-white/40 mb-1.5">{label}</span>}
      <input
        className={`w-full bg-white/[0.03] border border-white/12 px-3 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[#C65D1E] transition-colors ${className}`}
        {...props}
      />
    </label>
  );
}

export function Textarea({ label, className = '', ...props }) {
  return (
    <label className="block">
      {label && <span className="block text-[11px] font-mono uppercase tracking-widest text-white/40 mb-1.5">{label}</span>}
      <textarea
        className={`w-full bg-white/[0.03] border border-white/12 px-3 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[#C65D1E] transition-colors resize-none ${className}`}
        {...props}
      />
    </label>
  );
}

export function Select({ label, className = '', children, ...props }) {
  return (
    <label className="block">
      {label && <span className="block text-[11px] font-mono uppercase tracking-widest text-white/40 mb-1.5">{label}</span>}
      <select
        className={`w-full bg-[#141414] border border-white/12 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#C65D1E] transition-colors ${className}`}
        {...props}
      >
        {children}
      </select>
    </label>
  );
}

export function Checkbox({ label, ...props }) {
  return (
    <label className="flex items-center gap-2.5 text-sm text-white/80 cursor-pointer select-none">
      <input type="checkbox" className="w-4 h-4 accent-[#C65D1E]" {...props} />
      {label}
    </label>
  );
}

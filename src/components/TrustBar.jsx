const ITEMS = [
  {
    label: 'Free U.S. Shipping',
    desc: 'On orders $150+',
    icon: <path d="M3 7h11v10H3zM14 10h4l3 3v4h-7zM7 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />,
  },
  {
    label: '14-Day Returns',
    desc: 'Free & unworn',
    icon: <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" />,
  },
  {
    label: 'Secure Checkout',
    desc: 'Encrypted payment',
    icon: <path d="M5 11h14v9H5zM8 11V7a4 4 0 0 1 8 0v4" />,
  },
  {
    label: 'Authenticity Guaranteed',
    desc: 'Every piece, verified',
    icon: <path d="M12 2l3 2.4 3.6.6-1.2 3.6 1.2 3.6-3.6.6L12 16l-3-3.2-3.6-.6 1.2-3.6L5.4 5l3.6-.6z" />,
  },
];

export default function TrustBar() {
  return (
    <section className="border-y border-border bg-bg">
      <div className="max-w-screen-2xl mx-auto px-6 lg:px-12 py-8 grid grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8">
        {ITEMS.map((item) => (
          <div key={item.label} className="flex items-center gap-3">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="text-muted shrink-0">
              {item.icon}
            </svg>
            <div className="min-w-0">
              <p className="text-[11px] font-mono tracking-widest uppercase text-fg truncate">{item.label}</p>
              <p className="text-[11px] font-body text-muted truncate">{item.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

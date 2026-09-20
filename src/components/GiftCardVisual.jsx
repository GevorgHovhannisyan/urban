// The Urban Phoenix gift card artifact — used both as a live preview while
// a customer is building their purchase and as the "real" card once a code
// exists. Deliberately literal dark colors rather than theme tokens: this
// is a fixed branded artifact (like the logo or product photography), not
// page chrome, so it should look identical regardless of the visitor's
// light/dark preference — and matches the equally-static card graphic
// embedded in the gift card email, which can't use CSS variables at all.
export default function GiftCardVisual({ amountLabel, currency, code, revealed = false }) {
  return (
    <div
      className="relative overflow-hidden bg-[#131110] border border-accent px-6 py-7 sm:px-8 sm:py-8"
      style={{ aspectRatio: '1.75 / 1' }}
    >
      {/* Subtle corner glow — the one decorative touch, kept restrained. */}
      <div
        className="absolute -top-16 -right-16 w-48 h-48 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(198,93,30,0.16), transparent 70%)' }}
        aria-hidden="true"
      />

      <div className="relative flex items-start justify-between">
        <span className="font-display font-black uppercase tracking-[0.22em] text-sm sm:text-lg text-white">
          Urban Phoenix
        </span>
        <span className="font-mono text-[9px] sm:text-[10px] tracking-[0.25em] text-accent-light uppercase">
          Gift Card
        </span>
      </div>

      <div className="relative mt-7 sm:mt-10">
        <p className="font-display font-black text-3xl sm:text-4xl text-white leading-none">
          {amountLabel}
        </p>
        <p className="font-mono text-[9px] sm:text-[10px] tracking-[0.25em] text-white/50 uppercase mt-2">
          {currency} · Collection 001
        </p>
      </div>

      <div className="relative mt-6 sm:mt-8 pt-4 sm:pt-5 border-t border-white/10">
        <p className="font-mono text-[8px] sm:text-[9px] tracking-[0.25em] text-white/50 uppercase mb-1.5">
          Gift Card Code
        </p>
        <p
          className={`font-mono font-bold text-base sm:text-xl tracking-[0.1em] break-all ${revealed ? 'text-white select-all' : 'text-white/35'}`}
        >
          {code}
        </p>
      </div>
    </div>
  );
}

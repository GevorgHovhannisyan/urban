import ScrollReveal from '../components/ScrollReveal';
import TextReveal from '../components/TextReveal';
import { useApp } from '../context/AppContext';
import RevealImage from '../components/RevealImage';

const BELIEFS = [
  {
    num: '01',
    value: 'Individuality',
    description: 'You decide who you become. Style should communicate character, not erase it.',
  },
  {
    num: '02',
    value: 'Choice',
    description: 'Your past may shape you. It does not get the final decision.',
  },
  {
    num: '03',
    value: 'Strength',
    description: 'Strength is not avoiding pressure. It is what you build through it.',
  },
  {
    num: '04',
    value: 'Transformation',
    description: 'Change is not something to fear. It is part of becoming.',
  },
  {
    num: '05',
    value: 'Expression',
    description: 'What you wear can carry a message without explaining everything.',
  },
];

export default function AboutPage() {
  const { navigate, content } = useApp();
  const story = content.aboutStory;

  return (
    <main className="bg-bg min-h-screen pt-[var(--site-header-h,68px)]">

      {/* 1 — About hero: cinematic, photo-backed like the site's other campaign
          heroes (Collection/Drop pages). Overlay + text stay literal
          black/white — they sit on photography, not page chrome, so they
          must not flip with the theme. */}
      <section className="relative h-screen min-h-[600px] flex items-end overflow-hidden">
        <RevealImage
          src={story.imageUrl}
          alt={story.imageAlt || ''}
          fetchPriority="high"
          wrapperClassName="absolute inset-0"
          className="w-full h-full object-cover up-photo"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/55 to-black/15" />

        <div className="relative z-10 w-full max-w-screen-2xl mx-auto px-6 lg:px-12 pb-20 lg:pb-28">
          <ScrollReveal>
            <p className="text-[10px] font-mono text-white/70 tracking-[0.3em] uppercase mb-6">
              About Urban Phoenix
            </p>
          </ScrollReveal>
          <TextReveal
            as="h1"
            lines={['We Exist For Those Who Refuse To Stand Still.']}
            className="font-display font-black uppercase text-white leading-[0.9] max-w-5xl"
            style={{ fontSize: 'clamp(2.75rem, 7vw, 7rem)', letterSpacing: '-0.02em' }}
          />
        </div>
      </section>

      {/* 1b — Origin: shortened to the single idea it needs to carry — born
          in Armenia, built for people still becoming — rather than restating
          it from several angles. */}
      <section className="py-20 lg:py-28 max-w-screen-2xl mx-auto px-6 lg:px-12">
        <div className="max-w-2xl">
          <ScrollReveal>
            <p className="font-display font-black uppercase text-fg leading-[1.05] mb-8" style={{ fontSize: 'clamp(1.5rem, 3vw, 2.25rem)' }}>
              Urban Phoenix was born in Armenia in 2026.
            </p>
            <div className="space-y-1 text-base font-body font-light text-muted leading-relaxed mb-8">
              <p>Not to tell people who they should be.</p>
              <p>But to create for those who are still becoming.</p>
            </div>
            <p className="text-base font-body font-light text-muted leading-relaxed mb-8 max-w-xl">
              You are not limited by where you started, what happened before, or what others expect from you.
            </p>
            <p className="font-display font-black uppercase text-fg leading-tight mb-8" style={{ fontSize: 'clamp(1.5rem, 3vw, 2.25rem)' }}>
              You can change.
              <br />
              Rebuild.
              <br />
              Choose again.
            </p>
            <p className="text-sm font-mono text-muted tracking-widest uppercase">
              Urban Phoenix exists inside that process.
            </p>
          </ScrollReveal>
        </div>
      </section>

      {/* 2 — Character Is Built: the brand's core permanent statement,
          replacing the old "We Are Not A Brand" heading. Phoenix meaning
          shortened to one intro line + the core statement + the four-beat
          list, without restating the same idea in a lead-in paragraph first. */}
      <section className="border-t border-border py-20 lg:py-28">
        <div className="max-w-screen-2xl mx-auto px-6 lg:px-12">
          <div className="grid lg:grid-cols-12 gap-10 lg:gap-16 items-start">
            <div className="lg:col-span-5">
              <ScrollReveal>
                <p className="text-[10px] font-mono text-muted tracking-[0.25em] uppercase mb-4">Brand Meaning</p>
                <h2
                  className="font-display font-black uppercase text-fg leading-[0.9]"
                  style={{ fontSize: 'clamp(2.5rem, 4.5vw, 4.75rem)', letterSpacing: '-0.015em' }}
                >
                  Character Is Built.
                </h2>
              </ScrollReveal>
            </div>
            <div className="lg:col-span-7">
              <ScrollReveal delay={100}>
                <p className="text-base font-body font-light text-muted leading-loose max-w-xl mb-8">
                  The Phoenix in Urban Phoenix is not simply about a mythical bird.
                </p>
                <p
                  className="font-display font-black uppercase text-fg leading-[1.05] mb-8 max-w-xl"
                  style={{ fontSize: 'clamp(1.75rem, 3.2vw, 2.75rem)', letterSpacing: '-0.01em' }}
                >
                  The Phoenix represents the process of rebuilding yourself.
                </p>
                <div className="space-y-1 text-base font-body font-light text-muted leading-relaxed mb-6">
                  <p>Falling.</p>
                  <p>Learning.</p>
                  <p>Changing.</p>
                  <p>Rising differently.</p>
                </div>
                <p className="text-base font-body font-light text-muted leading-relaxed max-w-xl">
                  Not returning to who you were.
                  <br />
                  <span className="text-fg">Becoming who you choose to be.</span>
                </p>
              </ScrollReveal>
            </div>
          </div>
        </div>
      </section>

      {/* 3 — Brand code: oversized, asymmetrical editorial type — the
          permanent Built From Chaos / Made For Progress / Worn By
          Individuals asset, with a shorter supporting paragraph. */}
      <section className="border-t border-border py-20 lg:py-28 overflow-hidden">
        <div className="max-w-screen-2xl mx-auto px-6 lg:px-12">
          <TextReveal
            as="h2"
            className="font-display font-black uppercase text-fg leading-[0.88] mb-12 lg:mb-16"
            style={{ fontSize: 'clamp(2.5rem, 7vw, 6.5rem)', letterSpacing: '-0.02em' }}
            lines={[
              'Built From Chaos.',
              <span className="pl-[6vw]">Made For Progress.</span>,
              <span className="pl-[12vw] text-accent">Worn By Individuals.</span>,
            ]}
          />
          <ScrollReveal delay={100}>
            <div className="lg:ml-auto lg:max-w-lg space-y-1 text-base font-body font-light text-muted leading-loose">
              <p>Strength and vulnerability.</p>
              <p>Chaos and control.</p>
              <p>The streets and individuality.</p>
              <p className="mb-6">Where you came from and where you choose to go next.</p>
              <p>
                Every piece is personal.
                <br />
                Not a uniform.
                <br />
                <span className="font-display font-black uppercase text-fg text-xl tracking-tight">A choice.</span>
              </p>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* 4/5 — Vision & Mission: side-by-side on desktop, stacked on mobile,
          copy trimmed to its essential statements. */}
      <section className="border-t border-border">
        <div className="grid lg:grid-cols-2">
          <div className="px-6 lg:px-12 py-16 lg:py-20 lg:border-r border-border">
            <ScrollReveal>
              <p className="text-[10px] font-mono text-accent tracking-[0.25em] uppercase mb-4">Vision</p>
              <h2
                className="font-display font-black uppercase text-fg leading-[0.95] mb-6"
                style={{ fontSize: 'clamp(2rem, 3.2vw, 3rem)', letterSpacing: '-0.015em' }}
              >
                Our Vision
              </h2>
              <p className="text-base font-body font-light text-muted leading-loose max-w-md">
                To shape an urban culture where people can express their journey, character, individuality, and strength through what they wear.
              </p>
            </ScrollReveal>
          </div>
          <div className="px-6 lg:px-12 py-16 lg:py-20 border-t lg:border-t-0 border-border">
            <ScrollReveal delay={100}>
              <p className="text-[10px] font-mono text-accent tracking-[0.25em] uppercase mb-4">Mission</p>
              <h2
                className="font-display font-black uppercase text-fg leading-[0.95] mb-6"
                style={{ fontSize: 'clamp(2rem, 3.2vw, 3rem)', letterSpacing: '-0.015em' }}
              >
                Our Mission
              </h2>
              <div className="space-y-4 text-base font-body font-light text-muted leading-loose max-w-md">
                <p>
                  To create meaningful streetwear that reveals individuality and represents the strength developed through adversity.
                </p>
                <p>
                  We combine strong design, intentional details, limited releases, and storytelling to create pieces that carry an idea beyond the garment itself.
                </p>
                <p className="text-fg">
                  From what was.
                  <br />
                  Toward what can be.
                </p>
              </div>
            </ScrollReveal>
          </div>
        </div>
      </section>

      {/* 6 — What We Believe: reuses the site's numbered divide-y list
          pattern. */}
      <section className="border-t border-border py-20 lg:py-24">
        <div className="max-w-screen-2xl mx-auto px-6 lg:px-12">
          <ScrollReveal>
            <p className="text-[10px] font-mono text-muted tracking-[0.3em] uppercase mb-12 text-center">What We Believe</p>
          </ScrollReveal>
          <div className="divide-y divide-border">
            {BELIEFS.map((item, i) => (
              <ScrollReveal key={item.num} delay={i * 80}>
                <div className="grid lg:grid-cols-12 gap-6 items-start py-8 lg:py-10 group">
                  <div className="lg:col-span-1">
                    <p className="text-[10px] font-mono text-muted tracking-widest">{item.num}</p>
                  </div>
                  <div className="lg:col-span-4">
                    <h3
                      className="font-display font-black uppercase text-fg group-hover:text-accent transition-colors duration-300 leading-none"
                      style={{ fontSize: 'clamp(2.25rem, 4vw, 4rem)', letterSpacing: '-0.015em' }}
                    >
                      {item.value}
                    </h3>
                  </div>
                  <div className="lg:col-span-7 lg:pt-3">
                    <p className="text-sm font-body font-light text-muted leading-relaxed max-w-lg">
                      {item.description}
                    </p>
                  </div>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* 7 — Collection 001: a pointer to the chapter, not a second retelling
          of its own story (CollectionPage.jsx already owns that narrative in
          full). */}
      <section className="relative py-24 lg:py-32 overflow-hidden">
        <RevealImage
          src={content.homeBanner.imageUrl}
          alt="Collection 001 Campaign"
          loading="lazy"
          decoding="async"
          wrapperClassName="absolute inset-0"
          className="w-full h-full object-cover up-photo"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/40" />

        <div className="relative z-10 max-w-screen-2xl mx-auto px-6 lg:px-12">
          <ScrollReveal>
            <p className="text-[10px] font-mono text-accent-light tracking-[0.3em] uppercase mb-4">Collection 001</p>
            <h2
              className="font-display font-black uppercase text-white leading-[0.88] mb-8"
              style={{ fontSize: 'clamp(2.75rem, 6.5vw, 6rem)', letterSpacing: '-0.02em' }}
            >
              Freedom To Become
            </h2>
            <p className="text-base font-body font-light text-white/80 mb-10 max-w-lg leading-relaxed">
              Our debut chapter, built around one question: who do you want to become? Three pieces made for those who choose evolution over comfort.
            </p>
            <button
              onClick={() => navigate('collection')}
              className="bg-accent text-white px-8 py-4 text-[11px] font-mono tracking-[0.2em] uppercase hover:bg-accent-light transition-colors"
            >
              Shop Collection 001
            </button>
          </ScrollReveal>
        </div>
      </section>

      {/* 8 — Refuse To Fade: manifesto moment, paired with the community
          photo. */}
      <section className="grid lg:grid-cols-2 border-t border-border">
        <div className="relative overflow-hidden bg-card order-2 lg:order-1" style={{ minHeight: '380px' }}>
          <RevealImage
            src="https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=900&h=700&fit=crop&auto=format&q=85"
            alt="Urban Phoenix Community"
            loading="lazy"
            decoding="async"
            wrapperClassName="absolute inset-0"
            className="w-full h-full object-cover up-photo"
          />
          <div className="absolute inset-0 bg-black/10" />
        </div>
        <div className="bg-card flex items-center px-6 lg:px-16 py-16 lg:py-20 order-1 lg:order-2">
          <ScrollReveal>
            <h2
              className="font-display font-black uppercase text-fg leading-[0.9] mb-8"
              style={{ fontSize: 'clamp(2.25rem, 4vw, 4rem)', letterSpacing: '-0.015em' }}
            >
              Refuse To Fade.
            </h2>
            <p className="text-base font-body font-light text-muted leading-relaxed mb-6 max-w-sm">
              Urban Phoenix belongs to those who keep moving — athletes, artists, builders, creators, people rebuilding quietly.
            </p>
            <p className="text-sm font-mono text-muted tracking-widest uppercase mb-2">Connected by one idea:</p>
            <p
              className="font-display font-black uppercase text-fg leading-tight"
              style={{ fontSize: 'clamp(1.5rem, 2.6vw, 2rem)' }}
            >
              You do not have to remain who you were.
            </p>
          </ScrollReveal>
        </div>
      </section>

      {/* 9 — Armenia origin: typographic, no imagery — no origin-specific
          brand photography exists to reuse, and generic stock would break
          the site's editorial standard. */}
      <section className="border-t border-border py-20 lg:py-28 max-w-screen-2xl mx-auto px-6 lg:px-12">
        <div className="grid lg:grid-cols-12 gap-10 lg:gap-16 items-start">
          <div className="lg:col-span-6">
            <ScrollReveal>
              <h2
                className="font-display font-black uppercase text-fg leading-[0.92]"
                style={{ fontSize: 'clamp(2.25rem, 4.5vw, 4.25rem)', letterSpacing: '-0.02em' }}
              >
                Born In Armenia.
                <br />
                <span className="text-fg/50">Built To Move Beyond It.</span>
              </h2>
            </ScrollReveal>
          </div>
          <div className="lg:col-span-6">
            <ScrollReveal delay={100}>
              <div className="space-y-6 text-base font-body font-light text-muted leading-loose max-w-xl">
                <p>Urban Phoenix was created in Armenia.</p>
                <p>
                  Its contrast, energy, architecture, pressure, streets, people, and constant movement are part of our origin.
                </p>
                <p>But Urban Phoenix was never designed to belong to one place.</p>
                <p className="text-fg">
                  It begins here.
                  <br />
                  Where it goes next is open.
                </p>
              </div>
            </ScrollReveal>
          </div>
        </div>
      </section>

      {/* 10 — Final sign-off. */}
      <section className="border-t border-border py-28 lg:py-36 text-center relative overflow-hidden">
        <div className="relative z-10 max-w-4xl mx-auto px-6">
          <ScrollReveal>
            <p className="text-[10px] font-mono text-muted tracking-[0.3em] uppercase mb-8">Urban Phoenix</p>
            <p className="text-xs font-mono text-muted tracking-[0.25em] uppercase mb-10">Est. Armenia / 2026</p>
            <p
              className="font-display font-black uppercase text-fg leading-[1.1] mb-10"
              style={{ fontSize: 'clamp(1.25rem, 2.4vw, 1.75rem)', letterSpacing: '-0.01em' }}
            >
              Built From Chaos.
              <br />
              Made For Progress.
              <br />
              Worn By Individuals.
            </p>
          </ScrollReveal>
          <TextReveal
            as="h2"
            className="font-display font-black uppercase text-accent leading-[0.9]"
            style={{ fontSize: 'clamp(3rem, 7vw, 8rem)', letterSpacing: '-0.02em' }}
            lines={['Freedom To Become.']}
          />
        </div>
      </section>
    </main>
  );
}

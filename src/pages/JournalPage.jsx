import { useEffect, useState } from 'react';
import { useApp, pageToPath } from '../context/AppContext';
import ScrollReveal from '../components/ScrollReveal';
import TextReveal from '../components/TextReveal';
import RevealImage from '../components/RevealImage';
import { PageSkeleton } from '../components/Skeleton';

export default function JournalPage() {
  const { navigate, t } = useApp();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/journal')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { if (!cancelled) setPosts(Array.isArray(d.posts) ? d.posts : []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const go = (post) => (e) => { e.preventDefault(); navigate('journal-post', { slug: post.slug }); };

  if (loading) return <PageSkeleton />;

  const [lead, ...rest] = posts;

  return (
    <main className="bg-bg min-h-screen pt-[var(--site-header-h,68px)]">
      <div className="max-w-screen-2xl mx-auto px-6 lg:px-12 py-16">
        <p className="text-[10px] font-mono text-muted tracking-[0.3em] uppercase mb-3 label-fade-in">Urban Phoenix</p>
        <TextReveal
          as="h1"
          lines={['Journal']}
          className="font-display font-black uppercase text-fg leading-none mb-16"
          style={{ fontSize: 'clamp(3rem, 7vw, 7rem)', letterSpacing: '-0.02em' }}
        />

        {posts.length === 0 ? (
          <p className="text-muted">No stories published yet.</p>
        ) : (
          <>
            {/* Cover story — image and headline are choreographed rather
                than fading up as one flat block: the image leads (its own
                RevealImage load-reveal), the headline's line-mask follows
                on a short delay, so the sequence reads as photo, then
                statement, rather than everything arriving at once. */}
            <a href={pageToPath('journal-post', lead)} onClick={go(lead)} className="group grid lg:grid-cols-2 gap-8 lg:gap-16 mb-24 items-center">
              <ScrollReveal>
                <div className="relative overflow-hidden bg-card" style={{ aspectRatio: '4/3' }}>
                  <RevealImage src={lead.coverImage} alt={lead.title} fetchPriority="high" wrapperClassName="absolute inset-0" className="w-full h-full object-cover up-photo transition-transform duration-700 group-hover:scale-[1.03]" />
                </div>
              </ScrollReveal>
              <div>
                <p className="text-[10px] font-mono text-accent tracking-[0.25em] uppercase mb-4 label-fade-in">Featured Story</p>
                <TextReveal
                  as="h2"
                  lines={[lead.title]}
                  className="font-display font-black uppercase text-fg leading-[0.95] mb-6"
                  style={{ fontSize: 'clamp(2rem, 4vw, 3.5rem)', letterSpacing: '-0.015em' }}
                />
                <ScrollReveal delay={220}>
                  <p className="text-sm font-body font-light text-muted leading-relaxed mb-6 max-w-lg">{lead.excerpt}</p>
                  <p className="text-[11px] font-mono text-muted tracking-widest uppercase">
                    {lead.author} · {new Date(lead.publishedAt).toLocaleDateString()}
                  </p>
                </ScrollReveal>
              </div>
            </a>

            {/* Rest — asymmetric grid */}
            {rest.length > 0 && (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
                {rest.map((post, i) => (
                  <ScrollReveal key={post.id} delay={i * 80}>
                    <a href={pageToPath('journal-post', post)} onClick={go(post)} className="group block">
                      <div className="relative overflow-hidden bg-card mb-4" style={{ aspectRatio: '4/5' }}>
                        <RevealImage src={post.coverImage} alt={post.title} loading="lazy" decoding="async" wrapperClassName="absolute inset-0" className="w-full h-full object-cover up-photo transition-transform duration-700 group-hover:scale-[1.03]" />
                      </div>
                      <p className="text-[10px] font-mono text-muted tracking-widest uppercase mb-2">
                        {new Date(post.publishedAt).toLocaleDateString()}
                      </p>
                      <h3 className="font-display font-black uppercase text-fg leading-tight mb-2" style={{ fontSize: '1.4rem' }}>
                        {post.title}
                      </h3>
                      <p className="text-sm font-body font-light text-muted leading-relaxed">{post.excerpt}</p>
                    </a>
                  </ScrollReveal>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

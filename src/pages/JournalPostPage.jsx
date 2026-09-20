import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { handleImgError } from '../utils/imageFallback';
import ProductCard from '../components/ProductCard';
import ScrollReveal from '../components/ScrollReveal';
import { PageSkeleton } from '../components/Skeleton';

export default function JournalPostPage() {
  const { navigate, pageData, products } = useApp();
  const slug = pageData?.slug;
  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    fetch(`/api/journal/${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
      .then((d) => { if (!cancelled) setPost(d.post); })
      .catch(() => { if (!cancelled) setNotFound(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug]);

  if (loading) return <PageSkeleton />;

  if (notFound || !post) {
    return (
      <main className="bg-bg min-h-screen pt-[var(--site-header-h,68px)] flex items-center justify-center px-6">
        <div className="text-center">
          <p className="text-muted mb-6">Story not found.</p>
          <button onClick={() => navigate('journal')} className="btn-primary px-8 py-3 text-xs font-mono uppercase tracking-widest">Back to Journal</button>
        </div>
      </main>
    );
  }

  const relatedProducts = (post.relatedProductIds || [])
    .map((id) => products.find((p) => p.id === id))
    .filter(Boolean);

  return (
    <main className="bg-bg min-h-screen pt-[var(--site-header-h,68px)]">
      <div className="max-w-screen-2xl mx-auto px-6 lg:px-12 py-4 flex items-center gap-2">
        <button onClick={() => navigate('journal')} className="text-[10px] font-mono text-muted hover:text-fg transition-colors tracking-wide uppercase">Journal</button>
        <span className="text-muted/40 text-[10px] font-mono">/</span>
        <span className="text-[10px] font-mono text-fg/70 tracking-wide uppercase truncate max-w-[240px]">{post.title}</span>
      </div>

      <article className="max-w-screen-lg mx-auto px-6 lg:px-12 pb-24">
        <p className="text-[10px] font-mono text-accent tracking-[0.25em] uppercase mb-4">
          {post.author} · {new Date(post.publishedAt).toLocaleDateString()}
        </p>
        <h1 className="font-display font-black uppercase text-fg leading-[0.95] mb-10" style={{ fontSize: 'clamp(2.2rem, 5vw, 4.5rem)', letterSpacing: '-0.02em' }}>
          {post.title}
        </h1>

        {post.coverImage && (
          <div className="relative overflow-hidden bg-card mb-12" style={{ aspectRatio: '16/9' }}>
            <img src={post.coverImage} onError={handleImgError} alt={post.title} fetchPriority="high" className="up-photo absolute inset-0 w-full h-full object-cover" />
          </div>
        )}

        <div className="max-w-2xl mx-auto space-y-6">
          {post.body.split('\n\n').map((paragraph, i) => (
            paragraph.trim() ? (
              <p key={i} className="text-base font-body font-light text-muted leading-loose whitespace-pre-line">
                {paragraph}
              </p>
            ) : null
          ))}
        </div>

        {relatedProducts.length > 0 && (
          <section className="mt-20 pt-16 border-t border-border">
            <ScrollReveal>
              <p className="text-[10px] font-mono text-muted tracking-[0.25em] uppercase mb-2">Shop The Story</p>
              <h2 className="font-display font-black uppercase text-fg leading-none mb-10" style={{ fontSize: 'clamp(2rem, 4vw, 3rem)', letterSpacing: '-0.015em' }}>
                Featured Pieces
              </h2>
            </ScrollReveal>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-5">
              {relatedProducts.map((p, i) => (
                <ScrollReveal key={p.id} delay={i * 80}>
                  <ProductCard product={p} />
                </ScrollReveal>
              ))}
            </div>
          </section>
        )}
      </article>
    </main>
  );
}

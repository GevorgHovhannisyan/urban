import { useEffect, useRef, useState } from 'react';

// Scroll-triggered line-mask reveal for major editorial statements —
// deliberately reserved for the handful of oversized manifesto-style
// headings on About/Journal, never body copy. Each line sits in an
// overflow-hidden mask and translates up into place on a short stagger,
// once, the first time it scrolls into view — the same visual idea as the
// homepage hero's word-mask (Phase 1), just triggered by scroll instead of
// mount since these sit well below the fold.
export default function TextReveal({ lines, as: Tag = 'span', className = '', lineClassName = '', style }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.unobserve(el); }
    }, { threshold: 0.15, rootMargin: '0px 0px -60px 0px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag ref={ref} className={className} style={style}>
      {lines.map((line, i) => (
        <span key={i} className="text-reveal-line-mask">
          <span
            className={`text-reveal-line ${visible ? 'is-visible' : ''} ${lineClassName}`}
            style={visible ? { animationDelay: `${i * 90}ms` } : undefined}
          >
            {line}
          </span>
        </span>
      ))}
    </Tag>
  );
}

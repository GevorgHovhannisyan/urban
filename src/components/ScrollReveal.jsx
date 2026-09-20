import { useEffect, useRef } from 'react';
export default function ScrollReveal({ children, delay = 0, className = '', style }) {
    const ref = useRef(null);
    useEffect(() => {
        const el = ref.current;
        if (!el)
            return;
        const delayClass = delay > 0 ? `reveal-delay-${Math.min(Math.ceil(delay / 100), 5)}` : '';
        el.classList.add('reveal');
        if (delayClass)
            el.classList.add(delayClass);
        const observer = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting) {
                el.classList.add('visible');
                observer.unobserve(el);
            }
        }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
        observer.observe(el);
        return () => observer.disconnect();
    }, [delay]);
    return (<div ref={ref} className={className} style={style}>
      {children}
    </div>);
}

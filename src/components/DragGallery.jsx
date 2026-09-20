import { useRef } from 'react';

// Horizontal drag gallery: mobile gets real native touch-scroll momentum
// for free (plain overflow-x:auto — never intercepted), desktop mice get an
// added pointer-drag-to-scroll layer, since a mouse has no native
// drag-to-scroll gesture of its own. Every handler below checks
// `pointerType === 'mouse'` first and no-ops otherwise, so touch input is
// never touched by this component at all.
export default function DragGallery({ children, className = '' }) {
  const trackRef = useRef(null);
  const state = useRef({ dragging: false, startX: 0, scrollLeft: 0, moved: false });

  const onPointerDown = (e) => {
    if (e.pointerType !== 'mouse') return;
    const el = trackRef.current;
    state.current = { dragging: true, startX: e.clientX, scrollLeft: el.scrollLeft, moved: false };
    el.classList.add('is-dragging');
  };
  const onPointerMove = (e) => {
    if (e.pointerType !== 'mouse' || !state.current.dragging) return;
    const el = trackRef.current;
    const dx = e.clientX - state.current.startX;
    if (Math.abs(dx) > 4) state.current.moved = true;
    el.scrollLeft = state.current.scrollLeft - dx;
  };
  const endDrag = (e) => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    state.current.dragging = false;
    trackRef.current?.classList.remove('is-dragging');
  };
  // A real drag (pointer actually moved) shouldn't also register as a click
  // on whatever's underneath (e.g. a product card's link) once released.
  const onClickCapture = (e) => {
    if (state.current.moved) {
      e.preventDefault();
      e.stopPropagation();
      state.current.moved = false;
    }
  };

  return (
    <div
      ref={trackRef}
      className={`drag-gallery ${className}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onClickCapture={onClickCapture}
    >
      {children}
    </div>
  );
}

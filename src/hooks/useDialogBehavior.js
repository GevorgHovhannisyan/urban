import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

// Shared behavior for full-screen overlays (cart drawer, mobile nav, lightbox,
// edition selector): locks background scroll, closes on Escape, and — when a
// containerRef is passed — traps Tab/Shift+Tab focus inside the dialog and
// restores focus to whatever triggered it on close, per WAI-ARIA dialog
// pattern. Only SizeGuideDrawer had any of this originally; every other
// overlay let the page scroll behind it, had no keyboard dismissal, and let
// Tab escape into the page behind an open modal.
export function useDialogBehavior(open, onClose, containerRef) {
  // Callers overwhelmingly pass an inline `() => setOpen(false)`, a fresh
  // function reference on every render of the parent. That used to be a
  // dependency of the effect below, so any state update in the parent while
  // a dialog was open (e.g. typing into a field inside it) re-ran the whole
  // setup/teardown cycle — which steals focus to the first focusable element
  // and restores-then-resteals it on every keystroke, making text inputs
  // inside these dialogs (the admin product form, search) unusable past the
  // first character. Routing onClose through a ref lets the effect always
  // call the latest callback without needing to depend on its identity.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const previouslyFocused = document.activeElement;

    if (containerRef?.current) {
      const focusable = containerRef.current.querySelectorAll(FOCUSABLE_SELECTOR);
      (focusable[0] || containerRef.current).focus?.();
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onCloseRef.current?.();
        return;
      }
      if (event.key !== 'Tab' || !containerRef?.current) return;

      const focusable = Array.from(containerRef.current.querySelectorAll(FOCUSABLE_SELECTOR))
        .filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus?.();
    };
  }, [open, containerRef]);
}

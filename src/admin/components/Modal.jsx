import { useRef } from 'react';
import { useDialogBehavior } from '../../hooks/useDialogBehavior';
import { Button } from './AdminLayout';

export default function Modal({ open, onClose, title, children, footer }) {
  const panelRef = useRef(null);
  useDialogBehavior(open, onClose, panelRef);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative bg-[#0F0F0F] border border-white/10 w-full max-w-lg max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/8 sticky top-0 bg-[#0F0F0F]">
          <h2 className="text-lg font-display font-black uppercase" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-white/40 hover:text-white transition-colors text-xl leading-none">×</button>
        </div>
        <div className="px-6 py-5 space-y-4">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-white/8 flex justify-end gap-3">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmModal({ open, onClose, onConfirm, title, message, confirmLabel = 'Delete', danger = true }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      }
    >
      <p className="text-sm text-white/70">{message}</p>
    </Modal>
  );
}

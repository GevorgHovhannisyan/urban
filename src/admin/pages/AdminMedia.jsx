import { useEffect, useRef, useState } from 'react';
import { useAdminAuth } from '../context/AdminAuthContext';
import { useToast } from '../context/ToastContext';
import AdminLayout, { Button, Input } from '../components/AdminLayout';
import Modal from '../components/Modal';

function formatBytes(bytes) {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Upload directly through the same two endpoints Site Content's media
// fields already use (server/app.mjs's /uploads, /uploads/video) — every
// upload lands in the Media Library automatically (server/media-api.mjs's
// recordMedia, called from those same routes), so this page never needs
// its own separate upload path to stay in sync with what Site Content sees.
async function uploadFile(token, file) {
  const isVideo = file.type.startsWith('video/');
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(isVideo ? '/api/admin/uploads/video' : '/api/admin/uploads', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || 'Upload failed.');
  return data;
}

function DeleteMediaModal({ item, onClose, onDeleted, adminFetch, toast }) {
  const [usage, setUsage] = useState(null); // null = still checking, [] = safe, [..] = in use
  const [deleting, setDeleting] = useState(false);

  // Read-only check first (GET /media/:id/usage) — deleting only ever
  // happens from the explicit button below, never as a side effect of
  // opening this dialog, even when the image turns out to be unused.
  useEffect(() => {
    if (!item) return;
    setUsage(null);
    adminFetch(`/media/${encodeURIComponent(item.id)}/usage`)
      .then((data) => setUsage(data.usage || []))
      .catch((err) => toast(err.message, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);

  const confirmDelete = async (force) => {
    setDeleting(true);
    try {
      await adminFetch(`/media/${encodeURIComponent(item.id)}${force ? '?force=1' : ''}`, { method: 'DELETE' });
      toast('Image deleted.');
      onDeleted(item.id);
      onClose();
    } catch (err) {
      toast(err.message, true);
    } finally {
      setDeleting(false);
    }
  };

  if (!item) return null;
  return (
    <Modal open={Boolean(item)} onClose={onClose} title="Delete image">
      <div className="flex items-center gap-3 mb-2">
        <img src={item.url} alt="" className="w-14 h-14 object-cover bg-white/5 shrink-0" />
        <p className="text-sm text-white/70 truncate">{item.filename}</p>
      </div>
      {usage === null ? (
        <p className="text-sm text-white/50">Checking where this image is used…</p>
      ) : usage.length > 0 ? (
        <div>
          <p className="text-sm text-amber-400 font-medium mb-2">THIS IMAGE IS CURRENTLY USED ON:</p>
          <ul className="text-sm text-white/70 space-y-1 mb-4 list-disc list-inside">
            {usage.map((loc) => <li key={loc}>{loc}</li>)}
          </ul>
          <p className="text-xs text-white/40 mb-4">Replace it in those places first, or delete anyway — the pages above will fall back to their default image.</p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="danger" disabled={deleting} onClick={() => confirmDelete(true)}>{deleting ? 'Deleting…' : 'Delete anyway'}</Button>
          </div>
        </div>
      ) : (
        <div>
          <p className="text-sm text-white/70 mb-4">Not used anywhere. This cannot be undone.</p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="danger" disabled={deleting} onClick={() => confirmDelete(false)}>{deleting ? 'Deleting…' : 'Delete'}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function AltTextModal({ item, onClose, onSaved, adminFetch, toast }) {
  const [alt, setAlt] = useState(item?.alt || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => setAlt(item?.alt || ''), [item]);
  if (!item) return null;

  const save = async () => {
    setSaving(true);
    try {
      const data = await adminFetch(`/media/${encodeURIComponent(item.id)}`, { method: 'PUT', body: JSON.stringify({ alt }) });
      onSaved(data.media);
      toast('Alt text updated.');
      onClose();
    } catch (err) {
      toast(err.message, true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={Boolean(item)}
      onClose={onClose}
      title="Alt text"
      footer={<Button variant="primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Button>}
    >
      <img src={item.url} alt="" className="w-full max-h-56 object-contain bg-white/5 mb-3" />
      <Input
        label="Describes the image for screen readers — leave blank only for a purely decorative image"
        value={alt}
        onChange={(e) => setAlt(e.target.value)}
        placeholder="e.g. Model wearing the Freedom To Become hoodie in black"
      />
    </Modal>
  );
}

export default function AdminMedia({ onNavigate }) {
  const { token, adminFetch } = useAdminAuth();
  const toast = useToast();
  const [media, setMedia] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [altTarget, setAltTarget] = useState(null);
  const [filter, setFilter] = useState('all'); // all | image | video
  const inputRef = useRef(null);

  const load = () => {
    setLoading(true);
    adminFetch('/media')
      .then((data) => setMedia(data.media || []))
      .catch((err) => toast(err.message, true))
      .finally(() => setLoading(false));
  };

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUpload = async (files) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of files) {
        const data = await uploadFile(token, file);
        if (data.media) setMedia((prev) => [data.media, ...prev]);
      }
      toast(files.length > 1 ? `${files.length} files uploaded.` : 'File uploaded.');
    } catch (err) {
      toast(err.message, true);
    } finally {
      setUploading(false);
    }
  };

  const visible = media.filter((m) => filter === 'all' || m.kind === filter);

  return (
    <AdminLayout
      section="media"
      onNavigate={onNavigate}
      title="Media Library"
      subtitle="Every image and video uploaded through Site Content, Products, and Journal — replace or remove from one place"
      actions={
        <>
          <Button variant="primary" disabled={uploading} onClick={() => inputRef.current?.click()}>
            {uploading ? 'Uploading…' : 'Upload'}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/webm"
            multiple
            className="hidden"
            onChange={(e) => { handleUpload(Array.from(e.target.files || [])); e.target.value = ''; }}
          />
        </>
      }
    >
      <div className="flex gap-2 mb-5">
        {['all', 'image', 'video'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-[11px] font-mono uppercase tracking-widest px-3 py-1.5 border ${filter === f ? 'border-white/40 text-white' : 'border-white/10 text-white/40 hover:text-white/70'}`}
          >
            {f === 'all' ? 'All' : f === 'image' ? 'Images' : 'Videos'}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-white/40 text-sm">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="text-white/40 text-sm">No media uploaded yet. Use Upload above, or upload directly from any image field in Site Content.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {visible.map((item) => (
            <div key={item.id} className="border border-white/8">
              <div className="aspect-square bg-white/5 relative overflow-hidden">
                {item.kind === 'video' ? (
                  <video src={item.url} className="w-full h-full object-cover" muted />
                ) : (
                  <img src={item.url} alt={item.alt || ''} className="w-full h-full object-cover" />
                )}
              </div>
              <div className="p-3 space-y-1">
                <p className="text-xs text-white/70 truncate" title={item.filename}>{item.filename}</p>
                <p className="text-[10px] font-mono text-white/40 uppercase tracking-wide">
                  {item.mimeType}{item.width && item.height ? ` · ${item.width}×${item.height}` : ''} · {formatBytes(item.sizeBytes)}
                </p>
                <p className="text-[10px] text-white/30">{new Date(item.uploadedAt).toLocaleDateString()}</p>
                {item.kind === 'image' && !item.alt && (
                  <p className="text-[10px] text-amber-400/80">No alt text</p>
                )}
                <div className="flex gap-3 pt-1">
                  {item.kind === 'image' && (
                    <button onClick={() => setAltTarget(item)} className="text-[10px] font-mono uppercase tracking-widest text-white/50 hover:text-white underline underline-offset-4">Alt text</button>
                  )}
                  <button onClick={() => setDeleteTarget(item)} className="text-[10px] font-mono uppercase tracking-widest text-white/50 hover:text-red-400 underline underline-offset-4">Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <AltTextModal
        item={altTarget}
        onClose={() => setAltTarget(null)}
        onSaved={(updated) => setMedia((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))}
        adminFetch={adminFetch}
        toast={toast}
      />
      <DeleteMediaModal
        item={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={(id) => setMedia((prev) => prev.filter((m) => m.id !== id))}
        adminFetch={adminFetch}
        toast={toast}
      />
    </AdminLayout>
  );
}

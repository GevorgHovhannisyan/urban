import { useEffect, useRef, useState } from 'react';
import { useAdminAuth } from '../context/AdminAuthContext';
import { useToast } from '../context/ToastContext';
import AdminLayout, { Button, Input } from '../components/AdminLayout';

// Bypasses adminFetch on purpose — it always forces
// Content-Type: application/json, which breaks multipart uploads (the
// browser needs to set its own boundary in that header).
async function uploadImageFile(token, file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch('/api/admin/uploads', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || 'Upload failed.');
  return data.url;
}

export default function AdminCommunity({ onNavigate }) {
  const { adminFetch, token } = useAdminAuth();
  const toast = useToast();
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingId, setUploadingId] = useState(null); // row id, or 'new' for the add-photo button
  const newFileInputRef = useRef(null);

  useEffect(() => {
    adminFetch('/content')
      .then((data) => setImages(data.content?.community?.images || []))
      .catch((err) => toast(err.message, true))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addImage = () => setImages((prev) => [...prev, { id: `img_${Date.now()}`, url: '', link: '' }]);
  const removeImage = (id) => setImages((prev) => prev.filter((img) => img.id !== id));
  const updateImage = (id, field, value) => setImages((prev) => prev.map((img) => (img.id === id ? { ...img, [field]: value } : img)));

  const handleReplaceUpload = async (id, file) => {
    if (!file) return;
    setUploadingId(id);
    try {
      const url = await uploadImageFile(token, file);
      updateImage(id, 'url', url);
    } catch (err) {
      toast(err.message, true);
    } finally {
      setUploadingId(null);
    }
  };

  const handleNewUpload = async (file) => {
    if (!file) return;
    setUploadingId('new');
    try {
      const url = await uploadImageFile(token, file);
      setImages((prev) => [...prev, { id: `img_${Date.now()}`, url, link: '' }]);
    } catch (err) {
      toast(err.message, true);
    } finally {
      setUploadingId(null);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const data = await adminFetch('/content/community', { method: 'PUT', body: JSON.stringify({ images }) });
      setImages(data.content.images || []);
      toast('Community section updated.');
    } catch (err) {
      toast(err.message, true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminLayout section="community" onNavigate={onNavigate} title="Community" subtitle='Photos for the "@UrbanPhoenix" grid near the bottom of the homepage'>
      {loading ? (
        <p className="text-white/40 text-sm">Loading…</p>
      ) : (
        <div className="border border-white/8 mb-4">
          <div className="px-5 py-4 border-b border-white/8">
            <p className="text-sm font-medium">Homepage Photo Grid</p>
            <p className="text-xs text-white/40 mt-0.5">Upload photos directly, or paste an image URL — plus an optional link each photo opens (defaults to your Instagram profile). The grid is hidden entirely from the homepage if empty.</p>
          </div>
          <div className="p-5 space-y-4">
            {images.length === 0 && <p className="text-white/40 text-sm">No images yet — add one below.</p>}
            {images.map((img, i) => (
              <div key={img.id} className="border border-white/8 p-4 flex gap-3 items-start">
                <div className="w-16 h-16 shrink-0 bg-white/5 relative">
                  {img.url && (
                    <img src={img.url} alt="" className="w-16 h-16 object-cover" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
                  )}
                  {uploadingId === img.id && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-[9px] font-mono text-white/70">…</div>
                  )}
                </div>
                <div className="flex-1 space-y-2">
                  <Input label={`Image ${i + 1} URL`} value={img.url} onChange={(e) => updateImage(img.id, 'url', e.target.value)} placeholder="https://… or upload a photo" />
                  <Input label="Link (optional)" value={img.link} onChange={(e) => updateImage(img.id, 'link', e.target.value)} placeholder="Where this photo links to when clicked (defaults to your Instagram)" />
                  <label className="inline-block">
                    <span className="text-[11px] font-mono uppercase tracking-widest text-white/50 hover:text-white transition-colors cursor-pointer underline underline-offset-4">
                      {uploadingId === img.id ? 'Uploading…' : 'Upload a photo to replace this'}
                    </span>
                    <input type="file" accept="image/*" className="hidden" disabled={uploadingId === img.id} onChange={(e) => { handleReplaceUpload(img.id, e.target.files?.[0]); e.target.value = ''; }} />
                  </label>
                </div>
                <Button variant="danger" onClick={() => removeImage(img.id)} className="shrink-0">Remove</Button>
              </div>
            ))}
            <div className="flex flex-wrap gap-3">
              <Button variant="secondary" onClick={addImage}>+ Add Image URL</Button>
              <Button variant="secondary" disabled={uploadingId === 'new'} onClick={() => newFileInputRef.current?.click()}>
                {uploadingId === 'new' ? 'Uploading…' : '+ Upload Photo'}
              </Button>
              <input ref={newFileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { handleNewUpload(e.target.files?.[0]); e.target.value = ''; }} />
              <Button variant="primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save changes'}</Button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

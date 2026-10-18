import { useRef, useState } from 'react';
import { useAdminAuth } from '../context/AdminAuthContext';
import { uploadAdminImage } from '../uploadImage';

// .heic/.heif: iPhone photos — converted where the browser can decode them.
const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/avif,.heic,.heif';

// Image picker that uploads straight to the server (POST /api/admin/uploads,
// stored under public/uploads) and hands back the resulting "/uploads/..."
// path via onChange — so admins upload a file instead of pasting a URL.
// Existing values that are plain URLs (older content) still preview and keep
// working until replaced.
export default function ImageUploadField({ label, value, onChange, hint }) {
  const { token } = useAdminAuth();
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);

  const upload = async (file) => {
    if (!file) return;
    setError('');
    setUploading(true);
    try {
      onChange(await uploadAdminImage(token, file));
    } catch (err) {
      setError(err.message || 'Upload failed.');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    upload(e.dataTransfer.files?.[0]);
  };

  return (
    <div>
      {label && <span className="block text-[11px] font-mono uppercase tracking-widest text-white/40 mb-1.5">{label}</span>}
      <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => upload(e.target.files?.[0])} />

      {value ? (
        <div className="flex gap-4 items-start border border-white/12 bg-white/[0.03] p-3">
          <img src={value} alt="" className="w-32 h-20 object-cover bg-white/5 border border-white/10 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-white/50 truncate" title={value}>{value}</p>
            <div className="flex gap-2 mt-3">
              <button type="button" disabled={uploading} onClick={() => inputRef.current?.click()} className="text-[11px] font-mono uppercase tracking-widest px-3 py-2 border border-white/15 text-white/70 hover:text-white hover:border-white/30 disabled:opacity-50">
                {uploading ? 'Uploading…' : 'Replace'}
              </button>
              <button type="button" disabled={uploading} onClick={() => onChange('')} className="text-[11px] font-mono uppercase tracking-widest px-3 py-2 border border-[#e5484d]/40 text-[#e5484d] hover:bg-[#e5484d]/10 disabled:opacity-50">
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`w-full border border-dashed px-4 py-7 text-center transition-colors ${dragging ? 'border-[#C65D1E] bg-[#C65D1E]/10' : 'border-white/15 hover:border-white/35 bg-white/[0.02]'}`}
        >
          <span className="block text-sm text-white/80">{uploading ? 'Uploading…' : 'Click to upload an image'}</span>
          <span className="block text-[11px] text-white/40 mt-1">or drag and drop it here · JPG, PNG, WebP, GIF, AVIF · large photos are resized automatically</span>
        </button>
      )}
      {hint && !error && <p className="text-[11px] text-white/35 mt-1.5">{hint}</p>}
      {error && <p className="text-[11px] text-[#e5484d] mt-1.5" role="alert">{error}</p>}
    </div>
  );
}

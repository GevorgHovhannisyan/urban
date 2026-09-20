import { useEffect, useState } from 'react';
import { useAdminAuth } from '../context/AdminAuthContext';
import { useToast } from '../context/ToastContext';
import AdminLayout, { Badge, Button, Input, Textarea, Select } from '../components/AdminLayout';
import Modal, { ConfirmModal } from '../components/Modal';

const EMPTY_POST = {
  title: '', slug: '', excerpt: '', body: '', coverImage: '', author: 'Urban Phoenix',
  relatedProductIds: '', status: 'published',
};

function toFormState(p) {
  if (!p) return EMPTY_POST;
  return { ...p, relatedProductIds: (p.relatedProductIds || []).join(', ') };
}

function toPayload(form) {
  return {
    title: form.title,
    slug: form.slug,
    excerpt: form.excerpt,
    body: form.body,
    coverImage: form.coverImage,
    author: form.author,
    status: form.status,
    relatedProductIds: form.relatedProductIds.split(',').map((s) => s.trim()).filter(Boolean),
  };
}

export default function AdminJournal({ onNavigate }) {
  const { adminFetch } = useAdminAuth();
  const toast = useToast();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_POST);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const load = () => {
    setLoading(true);
    adminFetch('/journal')
      .then((data) => setPosts(data.posts))
      .catch((err) => toast(err.message, true))
      .finally(() => setLoading(false));
  };

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openNew = () => { setForm(EMPTY_POST); setEditing('new'); };
  const openEdit = (p) => { setForm(toFormState(p)); setEditing(p); };
  const close = () => setEditing(null);

  const save = async () => {
    const payload = toPayload(form);
    if (!payload.title) {
      toast('Title is required.', true);
      return;
    }
    setSaving(true);
    try {
      if (editing === 'new') {
        await adminFetch('/journal', { method: 'POST', body: JSON.stringify(payload) });
        toast('Post created.');
      } else {
        await adminFetch(`/journal/${encodeURIComponent(editing.id)}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast('Post updated.');
      }
      close();
      load();
    } catch (err) {
      toast(err.message, true);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await adminFetch(`/journal/${encodeURIComponent(deleteTarget.id)}`, { method: 'DELETE' });
      toast('Post deleted.');
      setDeleteTarget(null);
      load();
    } catch (err) {
      toast(err.message, true);
    }
  };

  return (
    <AdminLayout
      section="journal"
      onNavigate={onNavigate}
      title="Journal"
      subtitle={`${posts.length} post(s)`}
      actions={<Button variant="primary" onClick={openNew}>New post</Button>}
    >
      {loading ? (
        <p className="text-white/40 text-sm">Loading…</p>
      ) : (
        <div className="border border-white/8 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/8 text-left text-[11px] font-mono uppercase tracking-widest text-white/40">
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Slug</th>
                <th className="px-4 py-3">Published</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {posts.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-white/40">No posts yet.</td></tr>
              )}
              {posts.map((p) => (
                <tr key={p.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="px-4 py-3">{p.title}</td>
                  <td className="px-4 py-3 font-mono text-white/50">{p.slug}</td>
                  <td className="px-4 py-3 text-white/60">{new Date(p.publishedAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3"><Badge tone={p.status === 'published' ? 'success' : 'neutral'}>{p.status}</Badge></td>
                  <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                    <Button variant="secondary" onClick={() => openEdit(p)}>Edit</Button>
                    <Button variant="danger" onClick={() => setDeleteTarget(p)}>Delete</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={Boolean(editing)}
        onClose={close}
        title={editing === 'new' ? 'New post' : `Edit ${editing?.title || ''}`}
        footer={<><Button variant="secondary" onClick={close}>Cancel</Button><Button variant="primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Button></>}
      >
        <div className="grid grid-cols-2 gap-3">
          <Input label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Input label="Slug (blank = auto from title)" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
        </div>
        <Textarea label="Excerpt" rows={2} value={form.excerpt} onChange={(e) => setForm({ ...form, excerpt: e.target.value })} />
        <Textarea label="Body (blank lines separate paragraphs)" rows={8} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Cover image URL" value={form.coverImage} onChange={(e) => setForm({ ...form, coverImage: e.target.value })} />
          <Input label="Author" value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Related product IDs (comma separated)" placeholder="p001, p002" value={form.relatedProductIds} onChange={(e) => setForm({ ...form, relatedProductIds: e.target.value })} />
          <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="published">Published</option>
            <option value="draft">Draft</option>
          </Select>
        </div>
      </Modal>

      <ConfirmModal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
        title="Delete post"
        message={`Delete "${deleteTarget?.title}" permanently?`}
      />
    </AdminLayout>
  );
}

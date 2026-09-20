import { useEffect, useRef, useState } from 'react';
import { useAdminAuth } from '../context/AdminAuthContext';
import { useToast } from '../context/ToastContext';
import AdminLayout, { Button, Input, Textarea, Checkbox } from '../components/AdminLayout';

async function uploadFile(token, file, kind) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(kind === 'video' ? '/api/admin/uploads/video' : '/api/admin/uploads', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || 'Upload failed.');
  return data.url;
}

const SECTIONS = [
  {
    id: 'announcement',
    label: 'Announcement Bar',
    hint: 'Shows in a slim bar above the navigation on every page.',
    fields: [
      { key: 'enabled', label: 'Show announcement bar', type: 'checkbox' },
      { key: 'message', label: 'Message', type: 'text' },
    ],
  },
  {
    id: 'homeHero',
    label: 'Homepage — Hero',
    hint: 'The full-screen section at the very top of the homepage. Recommended: wide landscape image, at least 1920×1080.',
    fields: [
      { key: 'eyebrow', label: 'Eyebrow label', type: 'text' },
      { key: 'headline', label: 'Headline', type: 'text' },
      { key: 'subheadline', label: 'Subheadline', type: 'textarea' },
      { key: 'primaryCtaText', label: 'Primary button text', type: 'text' },
      { key: 'secondaryCtaText', label: 'Secondary button text', type: 'text' },
      { key: 'imageUrl', label: 'Background image (desktop)', type: 'image' },
      { key: 'imageAlt', label: 'Image alt text', type: 'text' },
      { key: 'mobileImageUrl', label: 'Background image (mobile, optional — falls back to the desktop image above when empty)', type: 'image' },
      { key: 'videoUrl', label: 'Background video (optional — replaces the image when set)', type: 'video' },
    ],
  },
  {
    id: 'homeBanner',
    label: 'Homepage — Collection Banner',
    hint: 'The full-bleed banner between the hero and the product grid.',
    fields: [
      { key: 'eyebrow', label: 'Eyebrow label', type: 'text' },
      { key: 'headline', label: 'Headline', type: 'text' },
      { key: 'body', label: 'Body text', type: 'textarea' },
      { key: 'ctaText', label: 'Button text', type: 'text' },
      { key: 'imageUrl', label: 'Background image', type: 'image' },
      { key: 'imageAlt', label: 'Image alt text', type: 'text' },
    ],
  },
  {
    id: 'brandPhilosophy',
    label: 'Homepage — Brand Statement',
    hint: 'The single brand-philosophy line further down the homepage. The last word is always shown in the accent color.',
    fields: [
      { key: 'headline', label: 'Headline', type: 'text' },
      { key: 'subline', label: 'Supporting line', type: 'text' },
    ],
  },
  {
    id: 'aboutStory',
    label: 'About Page — Origin Story',
    hint: 'The full-width image and opening paragraph on the About page.',
    fields: [
      { key: 'eyebrow', label: 'Eyebrow label', type: 'text' },
      { key: 'headline', label: 'Headline', type: 'text' },
      { key: 'body', label: 'Opening paragraph', type: 'textarea' },
      { key: 'imageUrl', label: 'Image', type: 'image' },
      { key: 'imageAlt', label: 'Image alt text', type: 'text' },
    ],
  },
  {
    id: 'shopMenuVideo',
    label: 'Shop Menu — Video Panel',
    hint: 'The right-hand panel in the "Shop" dropdown in the main navigation. Leave blank to show a plain wordmark instead.',
    fields: [
      { key: 'videoUrl', label: 'Video', type: 'video' },
      { key: 'posterUrl', label: 'Poster image (shown while the video loads)', type: 'image' },
    ],
  },
  {
    id: 'footer',
    label: 'Footer',
    hint: 'The brand tagline and copyright name in the site footer. Navigation links stay fixed since they map to real pages.',
    fields: [
      { key: 'tagline', label: 'Tagline', type: 'textarea' },
      { key: 'copyrightName', label: 'Copyright name (shown as "© {year} [this name]. All rights reserved.")', type: 'text' },
    ],
  },
  {
    id: 'socialLinks',
    label: 'Social Links',
    hint: 'Shown in the footer and elsewhere. A network only appears if its URL is filled in — leave blank to hide it entirely.',
    fields: [
      { key: 'instagram', label: 'Instagram URL', type: 'text' },
      { key: 'tiktok', label: 'TikTok URL', type: 'text' },
      { key: 'twitter', label: 'Twitter / X URL', type: 'text' },
    ],
  },
  {
    id: 'shippingInfo',
    label: 'Shipping & Delivery — Page Intro',
    hint: 'Introductory copy for the Shipping Policy page only. The actual delivery-time estimates and fees are centrally configured in the shipping system and are not edited here, so what customers are promised can never drift from what checkout actually honors.',
    fields: [
      { key: 'intro', label: 'Intro text', type: 'textarea' },
    ],
  },
];

// Shared by any image/video URL field across every content section — lets
// the admin either paste an external URL (unchanged behavior) or upload a
// file directly, which fills the same URL field with the resulting
// /uploads/... path.
function MediaField({ label, kind, value, onChange, token, toast }) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef(null);

  const handleFile = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      onChange(await uploadFile(token, file, kind));
    } catch (err) {
      toast(err.message, true);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <Input label={label} value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={`https://… or upload a ${kind}`} />
      <div className="flex items-center gap-3 mt-1.5">
        {kind === 'image' && value && (
          <img src={value} alt="" className="w-10 h-10 object-cover shrink-0 bg-white/5" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
        )}
        <button type="button" disabled={uploading} onClick={() => inputRef.current?.click()} className="text-[11px] font-mono uppercase tracking-widest text-white/50 hover:text-white transition-colors underline underline-offset-4 disabled:opacity-50">
          {uploading ? 'Uploading…' : `Upload ${kind === 'video' ? 'a video' : 'an image'}`}
        </button>
        <input ref={inputRef} type="file" accept={kind === 'video' ? 'video/mp4,video/webm' : 'image/*'} className="hidden" onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
    </div>
  );
}

// Read-only reference table for the real, currently-active delivery
// estimates/fees (server/delivery.mjs) — shown above the editable Shipping
// & Delivery intro copy so it's never possible to mistake that free-text
// field for something that could change what checkout actually charges or
// promises.
function ShippingReference({ adminFetch }) {
  const [zones, setZones] = useState(null);
  useEffect(() => {
    adminFetch('/shipping-reference').then((data) => setZones(data.zones)).catch(() => {});
  }, [adminFetch]);
  if (!zones) return null;
  return (
    <div className="border border-white/8 mb-4">
      <div className="px-5 py-4 border-b border-white/8">
        <p className="text-sm font-medium">Current delivery estimates &amp; fees (reference only)</p>
        <p className="text-xs text-white/40 mt-0.5">Configured in the shipping system, not editable here — shown so the intro copy below can stay accurate.</p>
      </div>
      <div className="p-5 grid sm:grid-cols-2 gap-4">
        {zones.map((zone) => (
          <div key={zone.label}>
            <p className="text-xs font-mono uppercase tracking-widest text-white/50 mb-1.5">{zone.label}</p>
            {zone.methods.map((m) => (
              <p key={m.id} className="text-sm text-white/70">{m.label}: {m.description} — {m.cost ? `$${m.cost.toFixed(2)}` : 'Free'}</p>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const SIZE_GUIDE_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const SIZE_GUIDE_GARMENT_TYPES = [
  { id: 'tshirt', label: 'T-Shirt' },
  { id: 'hoodie', label: 'Hoodie' },
  { id: 'sweatshirt', label: 'Sweatshirt' },
  { id: 'longsleeve', label: 'Long Sleeve' },
];

// Structured table editor, not a raw-JSON textarea — matches the task's own
// "numeric controls, not a risky visual/free-text editor" guidance. One
// garment type's table is shown/edited at a time; saving sends the whole
// sizeGuide section (server/content-api.mjs's sanitizeSizeGuide validates
// and range-clamps every cell server-side regardless of what this sends).
function SizeGuideEditor({ initial, adminFetch, toast }) {
  const [table, setTable] = useState(initial);
  const [activeType, setActiveType] = useState('tshirt');
  const [saving, setSaving] = useState(false);

  const setCell = (size, field, value) => {
    setTable((prev) => ({
      ...prev,
      [activeType]: { ...prev[activeType], [size]: { ...prev[activeType][size], [field]: value } },
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const data = await adminFetch('/content/sizeGuide', { method: 'PUT', body: JSON.stringify(table) });
      setTable(data.content);
      toast('Size Guide updated.');
    } catch (err) {
      toast(err.message, true);
    } finally {
      setSaving(false);
    }
  };

  const rows = table[activeType] || {};

  return (
    <div className="border border-white/8 mb-4">
      <div className="px-5 py-4 border-b border-white/8">
        <p className="text-sm font-medium">Size Guide</p>
        <p className="text-xs text-white/40 mt-0.5">Measurements in centimeters, shown to customers in both cm and inches. A garment type with no product using it yet is still fine to leave at its defaults.</p>
      </div>
      <div className="p-5">
        <div className="flex gap-2 mb-4 flex-wrap">
          {SIZE_GUIDE_GARMENT_TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveType(t.id)}
              className={`text-[11px] font-mono uppercase tracking-widest px-3 py-1.5 border ${activeType === t.id ? 'border-white/40 text-white' : 'border-white/10 text-white/40 hover:text-white/70'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-white/40 text-xs">
              <th className="pb-2 pr-3">Size</th>
              <th className="pb-2 pr-3">Chest (cm)</th>
              <th className="pb-2 pr-3">Front length (cm)</th>
              <th className="pb-2">Sleeve length (cm)</th>
            </tr>
          </thead>
          <tbody>
            {SIZE_GUIDE_SIZES.map((size) => (
              <tr key={size} className="border-t border-white/8">
                <td className="py-2 pr-3 font-mono">{size}</td>
                {['chest', 'length', 'sleeve'].map((field) => (
                  <td key={field} className="py-2 pr-3">
                    <input
                      type="number"
                      step="0.1"
                      min="20"
                      max="200"
                      value={rows[size]?.[field] ?? ''}
                      onChange={(e) => setCell(size, field, e.target.value)}
                      className="w-24 bg-transparent border border-white/15 px-2 py-1.5 text-sm text-white focus:outline-none focus:border-white/40"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <Button variant="primary" disabled={saving} onClick={save} className="mt-4">{saving ? 'Saving…' : 'Save changes'}</Button>
      </div>
    </div>
  );
}

const CTA_DESTINATION_OPTIONS = [
  { value: 'shop', label: 'Shop' },
  { value: 'collection', label: 'Collection 001' },
  { value: 'about', label: 'About' },
  { value: 'journal', label: 'Journal' },
];

// A tiny local <select>, not AdminLayout's <Select> (that one always wraps
// a label the way this needs to sit inline next to a text field instead).
function DestinationSelect({ value, onChange }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-transparent border border-white/15 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-white/40"
    >
      {CTA_DESTINATION_OPTIONS.map((o) => <option key={o.value} value={o.value} className="bg-[#0F0F0F]">{o.label}</option>)}
    </select>
  );
}

// Matches the actual, current Collection 001 page structure exactly
// (CollectionPage.jsx) — one numbered sub-panel per real section, each with
// its own Save button and its own "Section enabled" toggle wired straight
// to whether CollectionPage.jsx renders that section at all. 04 (Next
// Collection Teaser) saves to the separate `collection002` content section
// since that's editorially about Collection 002, but it's still this same
// page's 4th section, so it's grouped here rather than off on its own.
function CollectionOneEditor({ initial001, initial002, adminFetch, toast }) {
  const { token } = useAdminAuth();
  const [c1, setC1] = useState(initial001);
  const [c2, setC2] = useState(initial002);
  const [savingPanel, setSavingPanel] = useState(null);

  const save001 = async (panel) => {
    setSavingPanel(panel);
    try {
      const data = await adminFetch('/content/collection001', { method: 'PUT', body: JSON.stringify(c1) });
      setC1(data.content);
      toast('Collection 001 updated.');
    } catch (err) {
      toast(err.message, true);
    } finally {
      setSavingPanel(null);
    }
  };
  const save002 = async () => {
    setSavingPanel('04');
    try {
      const data = await adminFetch('/content/collection002', { method: 'PUT', body: JSON.stringify(c2) });
      setC2(data.content);
      toast('Next Collection Teaser updated.');
    } catch (err) {
      toast(err.message, true);
    } finally {
      setSavingPanel(null);
    }
  };

  const Panel = ({ number, title, hint, children, onSave, savingKey }) => (
    <div className="border border-white/8 mb-4">
      <div className="px-5 py-4 border-b border-white/8">
        <p className="text-sm font-medium">{number} — {title}</p>
        {hint && <p className="text-xs text-white/40 mt-0.5">{hint}</p>}
      </div>
      <div className="p-5 space-y-3">
        {children}
        <Button variant="primary" disabled={savingPanel === savingKey} onClick={onSave}>{savingPanel === savingKey ? 'Saving…' : 'Save changes'}</Button>
      </div>
    </div>
  );

  return (
    <div className="mb-8">
      <p className="text-xs font-mono uppercase tracking-widest text-white/40 mb-3">Site Content → Collections → Collection 001</p>

      <Panel number="01" title="Hero" hint="The full-screen section at the top of the Collection 001 page." onSave={() => save001('01')} savingKey="01">
        <Checkbox label="Section visible" checked={c1.heroEnabled} onChange={(e) => setC1({ ...c1, heroEnabled: e.target.checked })} />
        <Input label="Eyebrow" value={c1.heroLabel} onChange={(e) => setC1({ ...c1, heroLabel: e.target.value })} />
        <Textarea label="Main heading (one line break = a second stacked line, e.g. Collection / 001)" rows={2} value={c1.heroHeadline} onChange={(e) => setC1({ ...c1, heroHeadline: e.target.value })} />
        <Textarea label="Description" rows={3} value={c1.heroSub} onChange={(e) => setC1({ ...c1, heroSub: e.target.value })} />
        <div className="flex items-end gap-3">
          <div className="flex-1"><Input label="CTA label" value={c1.heroCtaLabel} onChange={(e) => setC1({ ...c1, heroCtaLabel: e.target.value })} /></div>
          <div>
            <span className="block text-xs text-white/50 mb-1.5">CTA destination</span>
            <DestinationSelect value={c1.heroCtaDestination} onChange={(v) => setC1({ ...c1, heroCtaDestination: v })} />
          </div>
        </div>
        <MediaField label="Desktop hero image" kind="image" value={c1.heroImageUrl} onChange={(v) => setC1({ ...c1, heroImageUrl: v })} token={token} toast={toast} />
        <MediaField label="Mobile hero image (optional — falls back to the desktop image above when empty)" kind="image" value={c1.heroMobileImageUrl} onChange={(v) => setC1({ ...c1, heroMobileImageUrl: v })} token={token} toast={toast} />
        <Input label="Hero image alt text" value={c1.heroImageAlt} onChange={(e) => setC1({ ...c1, heroImageAlt: e.target.value })} />
      </Panel>

      <Panel number="02" title="The Story" hint="FREEDOM / TO / BECOME. — the last stacked line is always shown in the accent color." onSave={() => save001('02')} savingKey="02">
        <Checkbox label="Section visible" checked={c1.storyEnabled} onChange={(e) => setC1({ ...c1, storyEnabled: e.target.checked })} />
        <Input label="Eyebrow" value={c1.storyEyebrow} onChange={(e) => setC1({ ...c1, storyEyebrow: e.target.value })} />
        <Textarea
          label="Heading — one line per stacked line (FREEDOM / TO / BECOME.). The LAST line is always the highlighted/accent one — a structured rule, not free HTML."
          rows={3}
          value={c1.storyHeadline}
          onChange={(e) => setC1({ ...c1, storyHeadline: e.target.value })}
        />
        <Textarea
          label="Story paragraphs — leave one blank line between paragraphs to add/remove/reorder them; each becomes its own paragraph on the page"
          rows={8}
          value={c1.storyBody}
          onChange={(e) => setC1({ ...c1, storyBody: e.target.value })}
        />
      </Panel>

      <Panel number="03" title="Products Section" hint='The real Collection 001 products always come from Admin → Products — only the heading/eyebrow around them is editorial.' onSave={() => save001('03')} savingKey="03">
        <Checkbox label="Section visible" checked={c1.productsEnabled} onChange={(e) => setC1({ ...c1, productsEnabled: e.target.checked })} />
        <Input label="Eyebrow" value={c1.productsEyebrow} onChange={(e) => setC1({ ...c1, productsEyebrow: e.target.value })} />
        <div>
          <span className="block text-xs text-white/50 mb-1.5">Heading</span>
          <div className="flex gap-4 mb-2">
            <label className="flex items-center gap-2 text-sm text-white/70">
              <input type="radio" checked={c1.productsHeadingMode === 'dynamic'} onChange={() => setC1({ ...c1, productsHeadingMode: 'dynamic' })} />
              Dynamic — "All {'{count}'} Pieces" from the real product count
            </label>
            <label className="flex items-center gap-2 text-sm text-white/70">
              <input type="radio" checked={c1.productsHeadingMode === 'custom'} onChange={() => setC1({ ...c1, productsHeadingMode: 'custom' })} />
              Custom text
            </label>
          </div>
          {c1.productsHeadingMode === 'custom' && (
            <Input value={c1.productsHeadingCustom} onChange={(e) => setC1({ ...c1, productsHeadingCustom: e.target.value })} placeholder="e.g. The Pieces" />
          )}
        </div>
      </Panel>

      <Panel number="04" title="Next Collection Teaser" hint="Display copy only — changing this can never publish Collection 002 or make it purchasable; that's controlled entirely by real product data." onSave={save002} savingKey="04">
        <Checkbox label="Section visible" checked={c2.enabled} onChange={(e) => setC2({ ...c2, enabled: e.target.checked })} />
        <Input label="Eyebrow" value={c2.eyebrow} onChange={(e) => setC2({ ...c2, eyebrow: e.target.value })} />
        <Textarea label="Heading (one line break = a second stacked line, e.g. Coming / Soon)" rows={2} value={c2.headline} onChange={(e) => setC2({ ...c2, headline: e.target.value })} />
        <MediaField label="Desktop background image" kind="image" value={c2.imageUrl} onChange={(v) => setC2({ ...c2, imageUrl: v })} token={token} toast={toast} />
        <MediaField label="Mobile background image (optional — falls back to the desktop image above when empty)" kind="image" value={c2.mobileImageUrl} onChange={(v) => setC2({ ...c2, mobileImageUrl: v })} token={token} toast={toast} />
        <Input label="Image alt text" value={c2.imageAlt} onChange={(e) => setC2({ ...c2, imageAlt: e.target.value })} />
        <Checkbox label="Show a CTA button" checked={c2.ctaEnabled} onChange={(e) => setC2({ ...c2, ctaEnabled: e.target.checked })} />
        {c2.ctaEnabled && (
          <div className="flex items-end gap-3">
            <div className="flex-1"><Input label="CTA label" value={c2.ctaLabel} onChange={(e) => setC2({ ...c2, ctaLabel: e.target.value })} /></div>
            <div>
              <span className="block text-xs text-white/50 mb-1.5">CTA destination</span>
              <DestinationSelect value={c2.ctaDestination} onChange={(v) => setC2({ ...c2, ctaDestination: v })} />
            </div>
          </div>
        )}
      </Panel>

      <Panel number="05" title="SEO" hint="Search engine and social-share preview for the Collection 001 page." onSave={() => save001('05')} savingKey="05">
        <Input label="SEO title" value={c1.seoTitle} onChange={(e) => setC1({ ...c1, seoTitle: e.target.value })} />
        <Textarea label="Meta description" rows={2} value={c1.seoDescription} onChange={(e) => setC1({ ...c1, seoDescription: e.target.value })} />
        <MediaField label="Social share (OG) image — optional, falls back to the hero image when empty" kind="image" value={c1.seoImage} onChange={(v) => setC1({ ...c1, seoImage: v })} token={token} toast={toast} />
      </Panel>
    </div>
  );
}

function SectionPanel({ section, initial, adminFetch, toast }) {
  const { token } = useAdminAuth();
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const data = await adminFetch(`/content/${encodeURIComponent(section.id)}`, { method: 'PUT', body: JSON.stringify(values) });
      setValues(data.content);
      toast(`${section.label} updated.`);
    } catch (err) {
      toast(err.message, true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-white/8 mb-4">
      <div className="px-5 py-4 border-b border-white/8">
        <p className="text-sm font-medium">{section.label}</p>
        <p className="text-xs text-white/40 mt-0.5">{section.hint}</p>
      </div>
      <div className="p-5 space-y-3">
        {section.fields.map((f) => {
          if (f.type === 'checkbox') {
            return <Checkbox key={f.key} label={f.label} checked={Boolean(values[f.key])} onChange={(e) => setValues({ ...values, [f.key]: e.target.checked })} />;
          }
          if (f.type === 'textarea') {
            return <Textarea key={f.key} label={f.label} rows={3} value={values[f.key] || ''} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />;
          }
          if (f.type === 'image' || f.type === 'video') {
            return <MediaField key={f.key} label={f.label} kind={f.type} value={values[f.key]} onChange={(v) => setValues({ ...values, [f.key]: v })} token={token} toast={toast} />;
          }
          return <Input key={f.key} label={f.label} value={values[f.key] || ''} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />;
        })}
        <Button variant="primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save changes'}</Button>
      </div>
    </div>
  );
}

export default function AdminContent({ onNavigate }) {
  const { adminFetch } = useAdminAuth();
  const toast = useToast();
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminFetch('/content')
      .then((data) => setContent(data.content))
      .catch((err) => toast(err.message, true))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AdminLayout section="content" onNavigate={onNavigate} title="Site Content" subtitle="Edit homepage, collection, about, footer, and social copy without touching code">
      {loading || !content ? (
        <p className="text-white/40 text-sm">Loading…</p>
      ) : (
        <>
          {SECTIONS.map((section) => (
            <div key={section.id}>
              {section.id === 'aboutStory' && (
                <CollectionOneEditor initial001={content.collection001} initial002={content.collection002} adminFetch={adminFetch} toast={toast} />
              )}
              {section.id === 'shippingInfo' && <ShippingReference adminFetch={adminFetch} />}
              <SectionPanel section={section} initial={content[section.id] || {}} adminFetch={adminFetch} toast={toast} />
            </div>
          ))}
          <SizeGuideEditor initial={content.sizeGuide} adminFetch={adminFetch} toast={toast} />
        </>
      )}
    </AdminLayout>
  );
}

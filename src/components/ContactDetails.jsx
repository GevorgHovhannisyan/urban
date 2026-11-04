import { useApp } from '../context/AppContext';

// Business contact details (Admin → Site Content → Contact Details), shared
// by the Contact page, the footer and the Contact Information page. Blank
// fields are skipped; the address keeps the admin's line breaks. The
// registered address is the legal entity's, labelled as not being a store.
export default function ContactDetails({ className = '', itemClassName = '', labelClassName = '', valueClassName = '' }) {
  const { content, t } = useApp();
  const details = content.contactDetails || {};
  const rows = [
    ['Phone', details.phone, details.phone && `tel:${details.phone.replace(/[^\d+]/g, '')}`],
    ['Email', details.email, details.email && `mailto:${details.email}`],
    ['Address', details.address],
    ['Registered address', details.legalAddress, null, 'Legal entity address — not a store or pickup point.'],
    ['Business hours', details.hours],
  ].filter(([, value]) => value && String(value).trim());
  if (!rows.length) return null;

  return (
    <dl className={className}>
      {rows.map(([label, value, href, note]) => (
        <div key={label} className={itemClassName}>
          <dt className={labelClassName}>{t(label)}</dt>
          <dd className={`whitespace-pre-line ${valueClassName}`}>
            {href ? <a href={href} className="hover:text-accent transition-colors" translate="no">{value}</a> : value}
            {note && <span className="block mt-1 text-[11px] opacity-60">{note}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

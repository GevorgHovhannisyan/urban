import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { deliveryHandoffText } from '../data/shippingRules';

// Live delivery-rate table for the Shipping Policy page. Every price comes
// from /api/delivery-methods (server/delivery.mjs — the same module checkout
// charges from), queried below and at the $150 free-shipping threshold, so
// this table can never disagree with what checkout actually charges.
const DESTINATIONS = [
  { label: 'Yerevan', country: 'AM', city: 'Yerevan' },
  { label: 'Other regions of Armenia', country: 'AM', city: 'Gyumri' },
  { label: 'United States', country: 'US', city: '' },
  { label: 'Russia', country: 'RU', city: '' },
];
const THRESHOLD = 150;

const fetchMethods = (country, city, subtotal) => {
  const params = new URLSearchParams({ country, city, subtotal: String(subtotal) });
  return fetch(`/api/delivery-methods?${params}`).then((r) => (r.ok ? r.json() : Promise.reject())).then((d) => d.methods || []);
};

export default function DeliveryRates() {
  const { formatMoney } = useApp();
  const [rows, setRows] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all(DESTINATIONS.map(async (dest) => {
      const [base, atThreshold] = await Promise.all([fetchMethods(dest.country, dest.city, 0), fetchMethods(dest.country, dest.city, THRESHOLD)]);
      return {
        ...dest,
        methods: base.map((m) => ({ ...m, thresholdCost: atThreshold.find((x) => x.id === m.id)?.cost ?? m.cost })),
      };
    }))
      .then((result) => { if (!cancelled) setRows(result); })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, []);

  if (!rows?.length) return null;
  const money = (value) => (value === 0 ? 'Free' : formatMoney(value, { regional: false }));

  return (
    <section className="delivery-rates" aria-labelledby="delivery-rates-title">
      <h2 id="delivery-rates-title" className="delivery-rates__title">Current delivery rates</h2>
      <div className="delivery-rates__grid">
        {rows.map((dest) => (
          <div key={dest.label} className="delivery-rates__dest">
            <h3 className="delivery-rates__dest-name">{dest.label}</h3>
            <ul className="delivery-rates__methods">
              {dest.methods.map((m) => (
                <li key={m.id} className="delivery-rates__method">
                  <div className="delivery-rates__method-head">
                    <span className="delivery-rates__method-name">{m.label}</span>
                    <span className="delivery-rates__cost">{money(m.cost)}</span>
                  </div>
                  <span className="delivery-rates__time">{m.description}</span>
                  {deliveryHandoffText(m, { withArea: false }) && <span className="delivery-rates__time">{deliveryHandoffText(m, { withArea: false })}</span>}
                  {m.thresholdCost !== m.cost && (
                    <span className="delivery-rates__note">
                      {m.thresholdCost === 0
                        ? <span>Free on orders of $150+</span>
                        : <><span>{money(m.thresholdCost)}</span> <span>on orders of $150+</span></>}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="delivery-rates__footnote">Prices are shown in your selected currency. Customs duties and import taxes are not included.</p>
    </section>
  );
}

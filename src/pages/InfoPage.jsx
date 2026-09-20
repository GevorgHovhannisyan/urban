import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { getLegalPolicy } from '../data/legalPolicies';
import './InfoPage.css';

const basicContent = {
  sizing: { title:'Sizing Guide', intro:'Urban Phoenix uses an intentionally oversized silhouette. Use the measurements below to choose your preferred fit.', sections:[['Tops & Outerwear',['XS  — Chest 54 cm · Length 68 cm\nS   — Chest 57 cm · Length 70 cm\nM   — Chest 60 cm · Length 72 cm\nL   — Chest 63 cm · Length 74 cm\nXL  — Chest 66 cm · Length 76 cm\nXXL — Chest 69 cm · Length 78 cm']],['How to measure',['Measure a garment you already own while it is laid flat. Chest is measured pit to pit. Length is measured from the highest shoulder point to the hem.']]]},
  faq: { title:'Frequently Asked Questions', intro:'Everything you need to know before placing your order.', sections:[['When will my order ship?',['Orders are prepared within 1–2 business days.']],['How does the fit run?',['Most pieces are oversized. Check the sizing guide and product measurements.']],['Can I change an order?',['Contact us as quickly as possible. Changes are only possible before fulfillment.']],['Where do you ship?',['We currently ship only to Armenia and the United States. Armenia ships free on every order; U.S. orders ship free on $150+. Available delivery methods and rates are shown at checkout.']]]},
  campaign: { title:'Campaign 001', intro:'FREEDOM TO BECOME — a study of movement, pressure and self-definition.', sections:[['Concept',['Shaped by the streets. Defined by choice. The campaign follows people moving through the city without asking permission to belong.']],['Collection',['Heavyweight silhouettes, controlled proportions and minimal graphics designed to carry presence.']]]},
};

const policyTypeMap = {
  privacy: 'privacy', refund: 'refund', terms: 'terms', shipping: 'shipping', legal: 'legal', cookies: 'cookies', 'contact-info': 'contactInfo',
};

function ContentBlock({ block }) {
  if (typeof block === 'string') return <p>{block}</p>;
  if (block?.list) return <ul>{block.list.map(item => <li key={item}>{item}</li>)}</ul>;
  return null;
}

export default function InfoPage({ type }) {
  const { navigate, language, t, content } = useApp();
  const [cookiePrefs, setCookiePrefs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('up_cookie_preferences')) || { functional: true, analytics: false, marketing: false }; }
    catch { return { functional: true, analytics: false, marketing: false }; }
  });
  const [saved, setSaved] = useState(false);

  const policyKey = policyTypeMap[type];
  const item = policyKey ? getLegalPolicy(language, policyKey) : basicContent[type] || basicContent.faq;

  useEffect(() => setSaved(false), [type, language]);

  const saveCookies = () => {
    localStorage.setItem('up_cookie_preferences', JSON.stringify(cookiePrefs));
    localStorage.setItem('up_cookie_consent', 'custom');
    window.dispatchEvent(new CustomEvent('up-cookie-preferences-changed', { detail: cookiePrefs }));
    setSaved(true);
  };

  return (
    <main className={`info-page info-page--${type}`}>
      <section className="info-page__container">
        <p className="info-page__eyebrow">Urban Phoenix / {policyKey ? 'Terms & Policies' : 'Information'}</p>
        <h1 className="info-page__title">{item.title}</h1>
        {item.updated && <p className="info-page__updated">{item.updated}</p>}
        {/* Shipping Policy's intro is the one CMS-editable exception (Admin
            → Site Content → Shipping & Delivery) — every other policy's
            intro comes from src/data/legalPolicies.js as before. The actual
            day-count estimates/fees never live in this field; those stay
            authoritative in server/delivery.mjs (see content-api.mjs's
            shippingInfo comment). */}
        <p className="info-page__intro">{type === 'shipping' ? content.shippingInfo.intro : (policyKey ? item.intro : t(item.intro))}</p>

        <div className="info-page__sections">
          {item.sections.map(([heading, blocks], index) => (
            <article key={heading} className="info-page__section">
              <div className="info-page__section-heading">
                <span className="info-page__number">{String(index + 1).padStart(2, '0')}</span>
                <h2>{policyKey ? heading : t(heading)}</h2>
              </div>
              <div className="info-page__section-copy">
                {(Array.isArray(blocks) ? blocks : [blocks]).map((block, blockIndex) => (
                  policyKey
                    ? <ContentBlock key={blockIndex} block={block} />
                    : <p key={blockIndex} className="info-page__preline">{t(block)}</p>
                ))}
              </div>
            </article>
          ))}
        </div>

        {type === 'cookies' && (
          <div className="cookie-center" aria-label={item.title}>
            <div className="cookie-center__row cookie-center__row--locked">
              <div><strong>{language === 'hy' ? 'Անհրաժեշտ' : language === 'ru' ? 'Обязательные' : 'Essential'}</strong><span>{language === 'hy' ? 'Միշտ ակտիվ' : language === 'ru' ? 'Всегда включены' : 'Always active'}</span></div>
              <span className="cookie-center__status">ON</span>
            </div>
            {[
              ['functional', language === 'hy' ? 'Ֆունկցիոնալ' : language === 'ru' ? 'Функциональные' : 'Functional'],
              ['analytics', language === 'hy' ? 'Վերլուծական' : language === 'ru' ? 'Аналитические' : 'Analytics'],
              ['marketing', language === 'hy' ? 'Մարքեթինգային' : language === 'ru' ? 'Маркетинговые' : 'Marketing'],
            ].map(([key, label]) => (
              <label className="cookie-center__row" key={key}>
                <strong>{label}</strong>
                <input type="checkbox" checked={cookiePrefs[key]} onChange={event => setCookiePrefs(current => ({ ...current, [key]: event.target.checked }))} />
                <span className="cookie-center__switch" aria-hidden="true" />
              </label>
            ))}
            <button type="button" className="cookie-center__save" onClick={saveCookies}>{saved ? (language === 'hy' ? 'Պահպանված է' : language === 'ru' ? 'Сохранено' : 'Saved') : (language === 'hy' ? 'Պահպանել ընտրությունը' : language === 'ru' ? 'Сохранить настройки' : 'Save preferences')}</button>
          </div>
        )}

        <button type="button" onClick={() => navigate('contact')} className="info-page__contact">{t('Need more help')}</button>
      </section>
    </main>
  );
}

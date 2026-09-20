import { useState } from 'react';
import { useApp, pageToPath } from '../context/AppContext';
import Icon from './Icon';
import PaymentBadge from './PaymentBadge';
import ScrollReveal from './ScrollReveal';
import './Footer.css';

const shopLinks = [
  ['All Products', 'shop'],
  ['Hoodies', 'shop', { category: 'hoodies' }],
  ['T-Shirts', 'shop', { category: 'tops' }],
  ['Pants', 'shop', { category: 'bottoms' }],
  ['Outerwear', 'shop', { category: 'outerwear' }],
  ['Accessories', 'shop', { category: 'accessories' }],
  ['Gift Cards', 'gift-cards'],
];

const brandLinks = [
  ['About Urban Phoenix', 'about'],
  ['Collections', 'collection'],
  ['Journal', 'journal'],
  ['Campaign 001', 'campaign'],
];

const helpLinks = [
  ['Sizing Guide', 'sizing'],
  ['Shipping & Returns', 'shipping'],
  ['Track Your Order', 'track'],
  ['Contact Us', 'contact'],
  ['FAQ', 'faq'],
];

const policyLinks = [
  ['Privacy Policy', 'privacy'],
  ['Refund Policy', 'refund'],
  ['Terms of Service', 'terms'],
  ['Contact Information', 'contact-info'],
  ['Shipping Policy', 'shipping'],
  ['Legal Notice', 'legal'],
  ['Cookie Preferences', 'cookies'],
];

export default function Footer() {
  const { navigate, t, socialLinks, content } = useApp();
  const [policiesOpen, setPoliciesOpen] = useState(false);
  const footerContent = content.footer;

  const renderGroup = (title, items) => (
    <div className="site-footer__group">
      <h4 className="site-footer__group-title">{t(title)}</h4>
      <ul className="site-footer__list">
        {items.map(([label, page, data]) => (
          <li key={`${page}-${label}`}>
            <a
              href={pageToPath(page)}
              onClick={(e) => { e.preventDefault(); navigate(page, data || {}); }}
              className="site-footer__link"
            >
              {t(label)}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <footer className="site-footer">
      <div className="site-footer__container">
        <div className="site-footer__main">
          <div className="site-footer__brand">
            <a
              href={pageToPath('home')}
              onClick={(e) => { e.preventDefault(); navigate('home'); }}
              className="site-footer__logo"
            >
              Urban Phoenix
            </a>

            <p className="site-footer__description">
              {footerContent.tagline}
            </p>

            <div className="site-footer__socials">
              {/* Only a network with an actual configured URL renders at
                  all — never a dead/empty social icon (Admin → Site Content
                  → Social Links; see content-api.mjs's socialLinks). */}
              {[['Instagram', 'instagram', socialLinks.instagram], ['TikTok', 'tiktok', socialLinks.tiktok], ['Twitter', 'twitter', socialLinks.twitter]]
                .filter(([, , href]) => href)
                .map(([network, icon, href]) => (
                <a key={network} href={href} target="_blank" rel="noopener noreferrer" className="site-footer__social-link" aria-label={network}>
                  <Icon name={icon} size={16} />
                  <span className="site-footer__social-label">{network}</span>
                </a>
              ))}
            </div>
          </div>

          {renderGroup('Shop', shopLinks)}
          {renderGroup('Brand', brandLinks)}
          {renderGroup('Help', helpLinks)}
        </div>

        <div className="site-footer__policy-area">
          <button
            type="button"
            className="site-footer__policy-toggle"
            onClick={() => setPoliciesOpen((current) => !current)}
            aria-expanded={policiesOpen}
            aria-controls="footer-policy-links"
          >
            <span>{t('Terms and Policies')}</span>
            <span
              className={`site-footer__policy-icon ${policiesOpen ? 'site-footer__policy-icon--open' : ''}`}
              aria-hidden="true"
            >
              +
            </span>
          </button>

          <div
            id="footer-policy-links"
            className={`site-footer__policy-panel ${policiesOpen ? 'site-footer__policy-panel--open' : ''}`}
          >
            <div className="site-footer__policy-grid">
              {policyLinks.map(([label, page]) => (
                <a
                  key={page}
                  href={pageToPath(page)}
                  onClick={(e) => { e.preventDefault(); navigate(page); }}
                  className="site-footer__policy-link"
                >
                  <span>{t(label)}</span>
                  <span aria-hidden="true">↗</span>
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="site-footer__bottom">
          <p className="site-footer__copyright">
            © {new Date().getFullYear()} {footerContent.copyrightName}. {t('All rights reserved.')}
          </p>

          {/* Only card networks actually reachable through the connected
              payment provider (server/payment/providers/stripe.mjs) —
              PayPal/Idram remain unconnected server-side placeholders (see
              order-api.mjs's ALLOWED_PAYMENT_METHODS) and must not be shown
              here as if customers could pay with them. */}
          <div className="site-footer__payments" aria-label="Accepted payment methods">
            {['visa', 'mastercard', 'amex'].map((method) => (
              <PaymentBadge key={method} name={method} />
            ))}
          </div>
        </div>

        <ScrollReveal>
          <p className="site-footer__wordmark" aria-hidden="true">Urban Phoenix</p>
        </ScrollReveal>
      </div>
    </footer>
  );
}

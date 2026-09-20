import { useState } from 'react';
import AccountSidebar from './AccountSidebar';
import AccountOverview from './AccountOverview';
import AccountOrders from './AccountOrders';
import LimitedPiecesArchive from './LimitedPiecesArchive';
import AccountRewards from './AccountRewards';
import AccountWishlist from './AccountWishlist';
import AccountAddresses from './AccountAddresses';
import AccountProfile from './AccountProfile';
import AccountPreferences from './AccountPreferences';
import AccountSecurity from './AccountSecurity';
import { useApp } from '../../context/AppContext';

const SECTIONS = new Set(['overview', 'orders', 'archive', 'rewards', 'wishlist', 'addresses', 'profile', 'preferences', 'security']);
// Mirrors src/admin/AdminApp.jsx's URL-synced section pattern: without this,
// `section` was plain local state with no reflection in the URL at all, so
// refreshing while on any tab but Overview silently dropped the user back to
// Overview — a real "state doesn't survive a refresh" gap. Uses a hash
// fragment rather than a query param/path segment so it never touches
// AppContext's page router (hash changes don't trigger navigation there).
const sectionFromHash = () => {
  const hash = window.location.hash.replace(/^#/, '');
  return SECTIONS.has(hash) ? hash : 'overview';
};

export default function AccountLayout() {
  const { logout, navigate } = useApp();
  const [section, setSectionState] = useState(sectionFromHash);
  const setSection = (next) => {
    setSectionState(next);
    window.history.replaceState(null, '', `#${next}`);
  };

  const signOut = () => { logout(); navigate('home'); };

  return (
    <main className="pt-[var(--site-header-h,68px)] min-h-screen">
      <div className="max-w-screen-2xl mx-auto px-6 lg:px-12 py-12 lg:py-16">
        <div className="grid lg:grid-cols-[220px_1fr] gap-10 lg:gap-16">
          <AccountSidebar active={section} onSelect={setSection} onSignOut={signOut} />
          <div>
            {section === 'overview' && <AccountOverview onNavigate={setSection} />}
            {section === 'orders' && <AccountOrders onNavigate={setSection} />}
            {section === 'archive' && <LimitedPiecesArchive />}
            {section === 'rewards' && <AccountRewards />}
            {section === 'wishlist' && <AccountWishlist />}
            {section === 'addresses' && <AccountAddresses />}
            {section === 'profile' && <AccountProfile />}
            {section === 'preferences' && <AccountPreferences />}
            {section === 'security' && <AccountSecurity />}
          </div>
        </div>
      </div>
    </main>
  );
}

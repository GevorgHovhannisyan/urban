import { useEffect, useState } from 'react';
import { AdminAuthProvider, useAdminAuth } from './context/AdminAuthContext';
import { ToastProvider } from './context/ToastContext';
import AdminLogin from './pages/AdminLogin';
import AdminDashboard from './pages/AdminDashboard';
import AdminProducts from './pages/AdminProducts';
import AdminOrders from './pages/AdminOrders';
import AdminReviews from './pages/AdminReviews';
import AdminEditions from './pages/AdminEditions';
import AdminPromoCodes from './pages/AdminPromoCodes';
import AdminGiftCards from './pages/AdminGiftCards';
import AdminReturns from './pages/AdminReturns';
import AdminReports from './pages/AdminReports';
import AdminJournal from './pages/AdminJournal';
import AdminCustomers from './pages/AdminCustomers';
import AdminNewsletter from './pages/AdminNewsletter';
import AdminContent from './pages/AdminContent';
import AdminCommunity from './pages/AdminCommunity';
import AdminDrops from './pages/AdminDrops';
import AdminMedia from './pages/AdminMedia';

const SECTIONS = ['dashboard', 'products', 'drops', 'orders', 'returns', 'reviews', 'editions', 'promos', 'gift-cards', 'reports', 'journal', 'customers', 'newsletter', 'content', 'community', 'media'];

function sectionFromPath() {
  const seg = window.location.pathname.replace(/^\/admin\/?/, '').split('/')[0];
  return SECTIONS.includes(seg) ? seg : 'dashboard';
}

const PAGES = {
  dashboard: AdminDashboard,
  products: AdminProducts,
  drops: AdminDrops,
  orders: AdminOrders,
  returns: AdminReturns,
  reviews: AdminReviews,
  editions: AdminEditions,
  promos: AdminPromoCodes,
  'gift-cards': AdminGiftCards,
  reports: AdminReports,
  journal: AdminJournal,
  customers: AdminCustomers,
  newsletter: AdminNewsletter,
  content: AdminContent,
  community: AdminCommunity,
  media: AdminMedia,
};

function AdminRoutes() {
  const { isAuthenticated } = useAdminAuth();
  const [section, setSection] = useState(sectionFromPath);

  const navigate = (next) => {
    setSection(next);
    const path = next === 'dashboard' ? '/admin' : `/admin/${next}`;
    if (path !== window.location.pathname) window.history.pushState({}, '', path);
    document.title = `${next[0].toUpperCase()}${next.slice(1)} — Urban Phoenix Admin`;
  };

  useEffect(() => {
    const onPopState = () => setSection(sectionFromPath());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    document.title = `${section[0].toUpperCase()}${section.slice(1)} — Urban Phoenix Admin`;
  }, [section]);

  if (!isAuthenticated) return <AdminLogin />;

  const Page = PAGES[section] || AdminDashboard;
  return <Page onNavigate={navigate} />;
}

export default function AdminApp() {
  return (
    <AdminAuthProvider>
      <ToastProvider>
        <AdminRoutes />
      </ToastProvider>
    </AdminAuthProvider>
  );
}

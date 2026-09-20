import { Suspense, lazy } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import PageTransitionOverlay from './components/PageTransitionOverlay';
import ProductContinuityLayer from './components/ProductContinuityLayer';
import CartDrawer from './components/CartDrawer';
import HomePage from './pages/HomePage';
import PrivacyPopup from './components/PrivacyPopup';
import RegionPopup from './components/RegionPopup';
import { PageSkeleton } from './components/Skeleton';
import ProductsUnavailable from './components/ProductsUnavailable';

// HomePage loads eagerly (the most common landing page — no reason to show a
// loading flash for it). Every other route is code-split so a first-time
// visitor doesn't have to download Checkout/Account/Admin-adjacent page code
// before the homepage can render.
const ShopPage = lazy(() => import('./pages/ShopPage'));
const ProductPage = lazy(() => import('./pages/ProductPage'));
const CollectionPage = lazy(() => import('./pages/CollectionPage'));
const AboutPage = lazy(() => import('./pages/AboutPage'));
const CartPage = lazy(() => import('./pages/CartPage'));
const WishlistPage = lazy(() => import('./pages/WishlistPage'));
const SearchPage = lazy(() => import('./pages/SearchPage'));
const AuthPage = lazy(() => import('./pages/AuthPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const AccountPage = lazy(() => import('./pages/AccountPage'));
const CheckoutPage = lazy(() => import('./pages/CheckoutPage'));
const TrackOrderPage = lazy(() => import('./pages/TrackOrderPage'));
const ContactPage = lazy(() => import('./pages/ContactPage'));
const JournalPage = lazy(() => import('./pages/JournalPage'));
const JournalPostPage = lazy(() => import('./pages/JournalPostPage'));
const DropPage = lazy(() => import('./pages/DropPage'));
const GiftCardPage = lazy(() => import('./pages/GiftCardPage'));
const InfoPage = lazy(() => import('./pages/InfoPage'));
// The admin app is its own tree entirely (own auth, own layout, no customer
// Navbar/Footer/cart) — code-split so customers never download any of it.
const AdminApp = lazy(() => import('./admin/AdminApp'));

function PageLoading() {
  return <PageSkeleton />;
}

const VERIFICATION_MESSAGES = {
  verified: { text: 'Your email has been verified. You can now sign in.', tone: 'success' },
  expired: { text: 'That verification link has expired. Please request a new one from the sign-in page.', tone: 'error' },
  invalid: { text: 'That verification link is invalid or has already been used.', tone: 'error' },
};

function EmailVerificationBanner() {
  const { emailVerificationStatus, dismissEmailVerificationStatus, navigate } = useApp();
  if (!emailVerificationStatus) return null;
  const info = VERIFICATION_MESSAGES[emailVerificationStatus];
  if (!info) return null;
  return (
    <div className={`ev-banner ev-banner-${info.tone}`} style={{
      position: 'fixed', top: 'var(--site-header-h, 68px)', left: 0, right: 0, zIndex: 55, padding: '12px 20px',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px',
      fontSize: '13px', textAlign: 'center',
      background: info.tone === 'success' ? 'color-mix(in srgb, var(--color-success) 15%, var(--bg-primary))' : 'color-mix(in srgb, var(--color-error) 15%, var(--bg-primary))',
      color: info.tone === 'success' ? 'var(--color-success)' : 'var(--color-error)',
      borderBottom: '1px solid var(--border-color)',
    }}>
      <span>{info.text}</span>
      {info.tone === 'success' && (
        <button onClick={() => { dismissEmailVerificationStatus(); navigate('login'); }} style={{ textDecoration: 'underline' }}>Sign in</button>
      )}
      <button onClick={dismissEmailVerificationStatus} aria-label="Dismiss" style={{ opacity: 0.6 }}>&times;</button>
    </div>
  );
}

// Every page key the big conditional chain below actually renders — an
// unrecognized path (typo, dead link, removed page) previously matched none
// of them and silently rendered an empty page-transition div (just header/
// footer, no content, no error message). Anything not in this set now falls
// through to NotFoundPage instead of rendering nothing.
const KNOWN_PAGES = new Set(['home','shop','product','collection','about','cart','wishlist','search','login','reset-password','account','checkout','track','contact','journal','journal-post','drop','gift-cards','sizing','shipping','faq','privacy','terms','cookies','campaign','refund','legal','contact-info']);

function NotFoundPage(){const {navigate}=useApp(); return <main className="min-h-screen flex items-center justify-center px-6 pt-[var(--site-header-h,68px)]"><div className="text-center max-w-xl"><p className="text-accent font-mono uppercase tracking-widest mb-5">404</p><h1 className="font-display font-black text-4xl uppercase mb-5">Page not found</h1><p className="text-muted mb-8">The page you're looking for doesn't exist or may have moved.</p><button onClick={() => navigate('home')} className="btn-primary px-8 py-4 uppercase text-xs tracking-widest">Return home</button></div></main>;}

function Routes(){const {page,selectedProduct,productsStatus,navigate,regionChosen}=useApp(); const info=['sizing','shipping','faq','privacy','terms','cookies','campaign','refund','legal','contact-info']; const productPageReady=productsStatus!=='loading'; return <div className="min-h-screen bg-bg text-fg font-body"><PageTransitionOverlay key={page}/><EmailVerificationBanner/><Navbar/><CartDrawer/><Suspense fallback={<PageLoading/>}><div key={page} className="page-transition">{page==='home'&&<HomePage/>}{page==='shop'&&<ShopPage/>}{page==='product'&&!productPageReady&&<PageLoading/>}{page==='product'&&productPageReady&&productsStatus==='error'&&<main className="min-h-screen pt-[var(--site-header-h,68px)]"><ProductsUnavailable/></main>}{page==='product'&&productPageReady&&productsStatus==='success'&&selectedProduct&&<ProductPage product={selectedProduct}/>} {page==='collection'&&<CollectionPage/>}{page==='about'&&<AboutPage/>}{page==='cart'&&<CartPage/>}{page==='wishlist'&&<WishlistPage/>}{page==='search'&&<SearchPage/>}{page==='login'&&<AuthPage/>}{page==='reset-password'&&<ResetPasswordPage/>}{page==='account'&&<AccountPage/>}{page==='checkout'&&<CheckoutPage/>}{page==='track'&&<TrackOrderPage/>}{page==='contact'&&<ContactPage/>}{page==='journal'&&<JournalPage/>}{page==='journal-post'&&<JournalPostPage/>}{page==='drop'&&<DropPage/>}{page==='gift-cards'&&<GiftCardPage/>}{info.includes(page)&&<InfoPage type={page}/>}{(!KNOWN_PAGES.has(page)||(page==='product'&&productsStatus==='success'&&!selectedProduct))&&<NotFoundPage/>}</div></Suspense>{!['cart','checkout'].includes(page)&&<Footer/>}<RegionPopup/>{regionChosen&&<PrivacyPopup onOpenPrivacy={() => navigate('privacy')}/>}</div>}
export default function App(){
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')) {
    return <Suspense fallback={<div className="min-h-screen bg-bg" />}><AdminApp/></Suspense>;
  }
  return <AppProvider><ProductContinuityLayer/><Routes/></AppProvider>;
}

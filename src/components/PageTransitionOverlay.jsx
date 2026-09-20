// Purely decorative wipe layer — see the `.page-wipe` comment in index.css
// for why this never touches routing/back-forward/scroll restoration: it's
// remounted by React (via the `key={page}` passed in from App.jsx) and
// plays a fire-and-forget CSS animation on top of whatever already swapped
// underneath it, nothing more.
export default function PageTransitionOverlay() {
  return <div className="page-wipe" aria-hidden="true" />;
}

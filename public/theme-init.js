// Resolves and applies the theme before any CSS paints, so the page never
// flashes the wrong theme on load. Priority: saved choice in localStorage,
// then the OS/browser prefers-color-scheme, then the dark default. Loaded as
// a same-origin <script src> (not inline) so it runs under this app's CSP,
// which intentionally omits 'unsafe-inline' from script-src — see
// server/app.mjs. Must stay render-blocking (no async/defer) to run before
// first paint.
(function () {
  try {
    var stored = localStorage.getItem('up_theme');
    var theme = stored === 'light' || stored === 'dark'
      ? stored
      : (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme;
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();

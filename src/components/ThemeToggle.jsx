import { useApp } from '../context/AppContext';
import Icon from './Icon';

// Shows the icon for the mode a click will switch TO (moon while light is
// active, sun while dark is active) — matches the up-icon sizing/hover
// treatment already used by the search/wishlist/cart icons in the header.
export default function ThemeToggle({ className = '' }) {
  const { theme, toggleTheme } = useApp();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-pressed={isDark}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={`up-icon inline-flex items-center justify-center ${className}`}
    >
      <span key={theme} className="theme-toggle-icon inline-flex">
        <Icon name={isDark ? 'sun' : 'moon'} size={19} />
      </span>
    </button>
  );
}

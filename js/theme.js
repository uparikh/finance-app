/**
 * theme.js — Light / Dark Mode Manager
 *
 * Responsibilities:
 *  - Read the saved theme from localStorage on page load
 *  - Apply the theme to <html data-theme="..."> immediately (before paint)
 *  - Expose toggleTheme() for the Settings screen toggle switch
 *  - Expose getCurrentTheme() for reading current state
 *
 * Storage key: 'finance-app-theme'
 * Values:      'light' | 'dark'
 * Default:     'light'
 */

// ─── Constants ───────────────────────────────────────────────────────────────

const THEME_STORAGE_KEY = 'finance-app-theme';
const THEME_LIGHT = 'light';
const THEME_DARK  = 'dark';

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Reads the saved theme from localStorage.
 * Falls back to 'light' if nothing is stored.
 * @returns {'light'|'dark'}
 */
function getSavedTheme() {
  return localStorage.getItem(THEME_STORAGE_KEY) || THEME_LIGHT;
}

/**
 * Applies a theme by setting the data-theme attribute on <html>.
 * CSS variables in variables.css respond to [data-theme="dark"].
 * @param {'light'|'dark'} theme
 */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

/**
 * Saves the chosen theme to localStorage so it persists across sessions.
 * @param {'light'|'dark'} theme
 */
function saveTheme(theme) {
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns the currently active theme.
 * @returns {'light'|'dark'}
 */
function getCurrentTheme() {
  return document.documentElement.getAttribute('data-theme') || THEME_LIGHT;
}

/**
 * Toggles between light and dark mode.
 * Updates the DOM attribute, persists to localStorage, and syncs any
 * toggle switch UI elements on the page.
 */
function toggleTheme() {
  const current = getCurrentTheme();
  const next    = current === THEME_LIGHT ? THEME_DARK : THEME_LIGHT;

  applyTheme(next);
  saveTheme(next);

  // Sync the toggle switch checkbox in the Settings screen (if present)
  const themeToggleInput = document.getElementById('theme-toggle-input');
  if (themeToggleInput) {
    themeToggleInput.checked = (next === THEME_DARK);
  }

  // Notify other modules (e.g. DashboardScreen) that the theme changed
  // so they can re-render charts with the correct explicit colors.
  document.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme: next } }));

  console.log(`[Theme] Switched to ${next} mode`);
}

/**
 * Initializes the theme system.
 * Called once on DOMContentLoaded by app.js.
 * Reads localStorage and applies the saved theme immediately.
 */
function initTheme() {
  const saved = getSavedTheme();
  applyTheme(saved);

  // Sync toggle switch if it already exists in the DOM
  const themeToggleInput = document.getElementById('theme-toggle-input');
  if (themeToggleInput) {
    themeToggleInput.checked = (saved === THEME_DARK);
  }

  console.log(`[Theme] Initialized with ${saved} mode`);
}

// ─── Auto-init on script load ─────────────────────────────────────────────────
// Apply theme as early as possible to prevent a flash of wrong theme (FOWT).
// This runs synchronously when the script is parsed, before DOMContentLoaded.
(function () {
  const saved = getSavedTheme();
  applyTheme(saved);
})();

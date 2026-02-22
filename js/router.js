/**
 * router.js — Client-Side Screen Router
 *
 * Responsibilities:
 *  - navigateTo(screenName): show the target screen, hide all others
 *  - Update the active state on the bottom navigation bar
 *  - Persist the current screen to sessionStorage so a page refresh
 *    returns the user to the same screen
 *  - On init, restore the last visited screen (or default to 'dashboard')
 *
 * Valid screen names: 'dashboard' | 'upload' | 'transactions' | 'analytics' | 'settings'
 * Storage key: 'finance-app-current-screen'
 */

// ─── Constants ───────────────────────────────────────────────────────────────

const SCREEN_STORAGE_KEY = 'finance-app-current-screen';
const DEFAULT_SCREEN     = 'dashboard';

/** All valid screen names — must match id="screen-{name}" in the HTML */
const VALID_SCREENS = ['dashboard', 'upload', 'transactions', 'analytics', 'settings'];

// ─── Internal State ──────────────────────────────────────────────────────────

/** Tracks the currently active screen name */
let currentScreen = null;

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Reads the last visited screen from sessionStorage.
 * Falls back to DEFAULT_SCREEN if nothing is stored or the value is invalid.
 * @returns {string}
 */
function getSavedScreen() {
  const saved = sessionStorage.getItem(SCREEN_STORAGE_KEY);
  return VALID_SCREENS.includes(saved) ? saved : DEFAULT_SCREEN;
}

/**
 * Persists the current screen name to sessionStorage.
 * @param {string} screenName
 */
function saveScreen(screenName) {
  sessionStorage.setItem(SCREEN_STORAGE_KEY, screenName);
}

/**
 * Updates the active CSS class on all bottom nav items.
 * Matches nav items by their data-nav attribute.
 * @param {string} screenName
 */
function updateNavActiveState(screenName) {
  const navItems = document.querySelectorAll('.bottom-nav-item');
  navItems.forEach(item => {
    const target = item.getAttribute('data-nav');
    if (target === screenName) {
      item.classList.add('active');
      item.setAttribute('aria-current', 'page');
    } else {
      item.classList.remove('active');
      item.removeAttribute('aria-current');
    }
  });
}

/**
 * Attaches a scroll listener to a screen element so the header gets a
 * 'scrolled' class when the user scrolls down (adds a subtle border).
 * @param {HTMLElement} screenEl
 */
function attachScrollListener(screenEl) {
  // Avoid attaching duplicate listeners
  if (screenEl._scrollListenerAttached) return;
  screenEl._scrollListenerAttached = true;

  const header = screenEl.querySelector('.screen-header');
  if (!header) return;

  screenEl.addEventListener('scroll', () => {
    if (screenEl.scrollTop > 4) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  }, { passive: true });
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Navigates to the specified screen.
 *
 * Steps:
 *  1. Validate the screen name
 *  2. Hide all screens (remove .active)
 *  3. Show the target screen (add .active)
 *  4. Update bottom nav active state
 *  5. Persist to sessionStorage
 *  6. Reset scroll position to top
 *
 * @param {string} screenName - One of VALID_SCREENS
 */
function navigateTo(screenName, params) {
  // Guard: ignore invalid screen names
  if (!VALID_SCREENS.includes(screenName)) {
    console.warn(`[Router] Unknown screen: "${screenName}". Valid screens: ${VALID_SCREENS.join(', ')}`);
    return;
  }

  // Store navigation params so the target screen can read them
  window._navParams = params || {};

  // Allow re-navigating to the same screen when params are provided
  // (e.g. navigateTo('transactions', { categoryId: 'food' }) from dashboard)
  const hasParams = params && Object.keys(params).length > 0;
  if (screenName === currentScreen && !hasParams) return;

  // ── Step 1: Hide all screens ──────────────────────────────────────────────
  const allScreens = document.querySelectorAll('.screen');
  allScreens.forEach(el => {
    el.classList.remove('active');
    el.setAttribute('aria-hidden', 'true');
  });

  // ── Step 2: Show the target screen ───────────────────────────────────────
  const targetScreen = document.getElementById(`screen-${screenName}`);
  if (!targetScreen) {
    console.error(`[Router] Screen element #screen-${screenName} not found in DOM.`);
    return;
  }

  targetScreen.classList.add('active');
  targetScreen.removeAttribute('aria-hidden');

  // Reset scroll to top when switching screens
  targetScreen.scrollTop = 0;

  // Attach scroll listener for sticky header effect
  attachScrollListener(targetScreen);

  // ── Step 3: Update nav + state ────────────────────────────────────────────
  updateNavActiveState(screenName);
  saveScreen(screenName);
  currentScreen = screenName;

  console.log(`[Router] Navigated to: ${screenName}`);
}

/**
 * Returns the name of the currently active screen.
 * @returns {string|null}
 */
function getCurrentScreen() {
  return currentScreen;
}

/**
 * Initializes the router.
 * Restores the last visited screen from sessionStorage, or defaults to 'dashboard'.
 * Called by app.js after all screen HTML has been loaded into the DOM.
 */
function initRouter() {
  const initialScreen = getSavedScreen();
  navigateTo(initialScreen);
  console.log(`[Router] Initialized. Starting on: ${initialScreen}`);
}

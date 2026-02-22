/**
 * app.js — Application Entry Point
 *
 * Responsibilities:
 *  1. Wait for the DOM to be ready
 *  2. Load all screen HTML fragments into #screen-container via fetch()
 *  3. Initialize the theme system (theme.js)
 *  4. Initialize the router (router.js)
 *  5. Wire up bottom navigation click handlers
 *  6. Wire up the theme toggle in the Settings screen
 *
 * Load order (guaranteed by HTML script tags):
 *   app.js → router.js → theme.js
 * All three are loaded as regular scripts (not modules) so they share
 * the global scope and can call each other's functions directly.
 */

// ─── Screen Manifest ─────────────────────────────────────────────────────────

/**
 * List of all screens to load.
 * Each entry maps a screen name to its HTML fragment file path.
 * The HTML fragment contains a single <div class="screen" id="screen-{name}">
 */
const SCREENS = [
  { name: 'dashboard',    path: 'screens/dashboard.html'    },
  { name: 'upload',       path: 'screens/upload.html'       },
  { name: 'transactions', path: 'screens/transactions.html' },
  { name: 'analytics',    path: 'screens/analytics.html'    },
  { name: 'settings',     path: 'screens/settings.html'     },
];

// ─── Screen Loader ────────────────────────────────────────────────────────────

/**
 * Fetches a single screen HTML file and injects it into #screen-container.
 * @param {{ name: string, path: string }} screen
 * @returns {Promise<void>}
 */
async function loadScreen(screen) {
  try {
    const response = await fetch(screen.path);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} loading ${screen.path}`);
    }
    const html = await response.text();

    const container = document.getElementById('screen-container');
    // Use insertAdjacentHTML to append without replacing existing content
    container.insertAdjacentHTML('beforeend', html);
  } catch (err) {
    console.error(`[App] Failed to load screen "${screen.name}":`, err);
    // Insert a fallback error screen so the app doesn't silently break
    const container = document.getElementById('screen-container');
    container.insertAdjacentHTML('beforeend', `
      <div class="screen" id="screen-${screen.name}" data-screen="${screen.name}" aria-hidden="true">
        <div class="screen-content">
          <div class="empty-state">
            <span class="empty-state-icon">⚠️</span>
            <p class="empty-state-title">Screen unavailable</p>
            <p class="empty-state-subtitle">
              Could not load the ${screen.name} screen.<br>
              Make sure you're running this via a local server.
            </p>
          </div>
        </div>
      </div>
    `);
  }
}

/**
 * Loads all screens in parallel and waits for all to complete.
 * @returns {Promise<void>}
 */
async function loadAllScreens() {
  await Promise.all(SCREENS.map(loadScreen));
}

// ─── Navigation Wiring ───────────────────────────────────────────────────────

/**
 * Attaches click handlers to all bottom nav items.
 * Each nav item must have a data-nav="screenName" attribute.
 */
function wireBottomNav() {
  const navItems = document.querySelectorAll('.bottom-nav-item');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const target = item.getAttribute('data-nav');
      if (target) {
        navigateTo(target); // defined in router.js
        // Initialize screen-specific logic after navigation
        onScreenActivated(target);
      }
    });
  });

  console.log(`[App] Bottom nav wired (${navItems.length} items)`);
}

// ─── Screen Activation Hooks ─────────────────────────────────────────────────

/**
 * Called after navigating to a screen.
 * Initializes screen-specific modules that need to run on each visit.
 * @param {string} screenName
 */
function onScreenActivated(screenName, params) {
  if (screenName === 'upload') {
    if (typeof UploadScreen !== 'undefined' && typeof UploadScreen.init === 'function') {
      UploadScreen.init().catch(function (err) {
        console.error('[App] UploadScreen.init() failed:', err);
      });
    }
  }

  if (screenName === 'dashboard') {
    if (typeof DashboardScreen !== 'undefined' && typeof DashboardScreen.init === 'function') {
      DashboardScreen.init().catch(function (err) {
        console.error('[App] DashboardScreen.init() failed:', err);
      });
    }
  }

  if (screenName === 'transactions') {
    if (typeof TransactionsScreen !== 'undefined' && typeof TransactionsScreen.init === 'function') {
      // Pass navigation params directly; init() will also read window._navParams as fallback
      TransactionsScreen.init(params || {}).catch(function (err) {
        console.error('[App] TransactionsScreen.init() failed:', err);
      });
    }
  }

  if (screenName === 'analytics') {
    if (typeof AnalyticsScreen !== 'undefined' && typeof AnalyticsScreen.init === 'function') {
      AnalyticsScreen.init().catch(function (err) {
        console.error('[App] AnalyticsScreen.init() failed:', err);
      });
    }
  }

  if (screenName === 'settings') {
    if (typeof SettingsScreen !== 'undefined' && typeof SettingsScreen.init === 'function') {
      SettingsScreen.init().catch(function (err) {
        console.error('[App] SettingsScreen.init() failed:', err);
      });
    }
  }
}

// ─── Theme Toggle Wiring ─────────────────────────────────────────────────────

/**
 * Wires the theme toggle switch in the Settings screen.
 * The toggle input has id="theme-toggle-input".
 * Clicking it calls toggleTheme() from theme.js.
 */
function wireThemeToggle() {
  const themeToggleInput = document.getElementById('theme-toggle-input');
  if (!themeToggleInput) {
    console.warn('[App] Theme toggle input not found — Settings screen may not be loaded yet.');
    return;
  }

  // Set initial checked state based on current theme.
  // The change event is wired by SettingsScreen.init() on each visit
  // to avoid duplicate handlers.
  themeToggleInput.checked = (getCurrentTheme() === 'dark'); // getCurrentTheme() from theme.js

  console.log('[App] Theme toggle state synced');
}

// ─── App Initialization ──────────────────────────────────────────────────────

/**
 * Main initialization function.
 * Runs after the DOM is fully parsed (DOMContentLoaded).
 */
async function initApp() {
  console.log('[App] Starting initialization...');

  // Helper: update the splash subtitle so we can see exactly where we are
  function setSplashStatus(msg) {
    var el = document.getElementById('splash-status');
    if (el) el.textContent = msg;
  }

  setSplashStatus('Starting…');

  // 1. Configure PDF.js worker (parsers.js depends on this)
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    console.log('[App] PDF.js worker configured ✅');
  } else {
    console.warn('[App] pdfjsLib not found — PDF parsing will be unavailable');
  }

  // 2. Initialize the IndexedDB database layer.
  //    This must run before any screen tries to read/write data.
  setSplashStatus('Opening database…');
  try {
    await FinanceDB.init(); // defined in db.js
  } catch (err) {
    console.error('[App] Database initialization failed:', err);
    // Show a user-friendly error in the loading screen so the user isn't
    // left staring at a spinner if IndexedDB is unavailable (e.g. private
    // browsing mode on some browsers, or storage quota exceeded).
    const loadingEl = document.getElementById('app-loading');
    var isPrivateMode = err && err.message && err.message.indexOf('timed out') !== -1;
    if (loadingEl) {
      loadingEl.innerHTML = `
        <span style="font-size: 48px;">⚠️</span>
        <p style="font-size: 16px; font-weight: 600; color: var(--text-primary); margin: 0;">
          ${isPrivateMode ? 'Private mode detected' : 'Storage unavailable'}
        </p>
        <p style="font-size: 13px; color: var(--text-secondary); text-align: center; max-width: 280px; margin: 0;">
          ${isPrivateMode
            ? 'This app stores your data locally and cannot run in Private/Incognito mode. Please open it in a regular browser tab.'
            : 'This app requires IndexedDB storage. Please make sure you\'re not in private/incognito mode, then reload the page.'}
        </p>
        <button
          onclick="location.reload()"
          style="margin-top: 8px; padding: 10px 24px; border-radius: 12px;
                 background: var(--accent-primary); color: #fff; border: none;
                 font-size: 14px; font-weight: 600; cursor: pointer;"
        >Open in Regular Tab</button>
      `;
    }
    return; // Abort further initialization
  }

  setSplashStatus('Loading screens…');

  // 2. Apply saved theme immediately (theme.js auto-init already ran,
  //    but we call initTheme() here to sync any toggle UI elements)
  initTheme(); // defined in theme.js

  // 3. Load all screen HTML fragments into the DOM
  await loadAllScreens();

  setSplashStatus('Wiring UI…');

  // 4. Wire bottom navigation
  wireBottomNav();

  // 5. Wire theme toggle (now that Settings screen is in the DOM)
  wireThemeToggle();

  // 6. Start the router — navigate to the initial/saved screen
  initRouter(); // defined in router.js

  // 7. Run screen-specific init for the initial screen
  //    (wireBottomNav only fires on click, so we need this for the first load)
  const initialScreen = typeof getCurrentScreen === 'function' ? getCurrentScreen() : null;
  if (initialScreen) {
    onScreenActivated(initialScreen);
  }

  // 8. Fade out and remove the splash screen now that the app is ready
  const splash = document.getElementById('splash-screen');
  if (splash) {
    splash.style.opacity = '0';
    setTimeout(function () {
      if (splash.parentNode) splash.remove();
    }, 400);
  }

  console.log('Finance App initialized ✅');
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

// Wait for the HTML to be fully parsed before running
document.addEventListener('DOMContentLoaded', initApp);

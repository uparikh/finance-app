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
      if (!target) return;

      // Fix 3: Warn user if they navigate away from upload review state
      if (target !== 'upload' &&
          typeof UploadScreen !== 'undefined' &&
          typeof UploadScreen.isInReviewState === 'function' &&
          UploadScreen.isInReviewState()) {
        const confirmed = window.confirm(
          '⚠️ Unsaved Transactions\n\n' +
          'You have ' + (typeof pendingTransactions !== 'undefined' ? '' : 'unsaved ') +
          'transactions that haven\'t been saved yet.\n\n' +
          'Leaving now will discard them. Continue?'
        );
        if (!confirmed) return;
        // User confirmed — discard pending transactions
        UploadScreen.showState('idle');
      }

      navigateTo(target); // defined in router.js
      // Initialize screen-specific logic after navigation
      onScreenActivated(target);
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

// ─── Global Bottom Sheet: Scroll Lock + Swipe-to-Close ───────────────────────
// Handles ALL .bottom-sheet-panel elements (transactions edit, settings sheets,
// upload edit sheet). Features:
//   - Locks background scroll when any sheet is open
//   - Swipe-down on the handle/header area follows the finger (real-time)
//   - Dismiss if pulled >35% of sheet height or fast flick
//   - Spring back if not far enough
//   - Backdrop fades out immediately on dismiss

(function () {
  var _sheet = {
    panel:       null,
    backdrop:    null,
    startY:      0,
    lastY:       0,
    startTime:   0,
    onHandle:    false,
    active:      false,
  };

  // ── Scroll lock: prevent background scroll when a sheet is open ──────────
  // We watch for .active being added to any .bottom-sheet-panel via MutationObserver
  var _scrollLockCount = 0;

  function _lockScroll() {
    _scrollLockCount++;
    document.body.style.overflow = 'hidden';
  }

  function _unlockScroll() {
    _scrollLockCount = Math.max(0, _scrollLockCount - 1);
    if (_scrollLockCount === 0) {
      document.body.style.overflow = '';
    }
  }

  // Observe all bottom-sheet-panel elements for .active class changes
  var _sheetObserver = new MutationObserver(function (mutations) {
    mutations.forEach(function (m) {
      if (m.type === 'attributes' && m.attributeName === 'class') {
        var el = m.target;
        if (!el.classList.contains('bottom-sheet-panel')) return;
        if (el.classList.contains('active')) {
          _lockScroll();
        } else {
          _unlockScroll();
        }
      }
    });
  });

  // Start observing once DOM is ready
  document.addEventListener('DOMContentLoaded', function () {
    // Observe existing panels
    document.querySelectorAll('.bottom-sheet-panel').forEach(function (p) {
      _sheetObserver.observe(p, { attributes: true });
    });
    // Also observe body for dynamically injected panels
    var bodyObserver = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (node) {
          if (node.nodeType === 1) {
            if (node.classList && node.classList.contains('bottom-sheet-panel')) {
              _sheetObserver.observe(node, { attributes: true });
            }
            node.querySelectorAll && node.querySelectorAll('.bottom-sheet-panel').forEach(function (p) {
              _sheetObserver.observe(p, { attributes: true });
            });
          }
        });
      });
    });
    bodyObserver.observe(document.body, { childList: true, subtree: true });
  });

  // ── Helper: find the panel and backdrop from a touch target ─────────────
  function _findPanel(target) {
    var el = target;
    while (el && el !== document.body) {
      if (el.classList && el.classList.contains('bottom-sheet-panel')) return el;
      el = el.parentElement;
    }
    return null;
  }

  function _findBackdrop(panel) {
    if (!panel || !panel.id) return null;
    var id = panel.id
      .replace('-panel', '-backdrop')
      .replace(/-sheet$/, '-sheet-backdrop');
    return document.getElementById(id) || null;
  }

  // ── Helper: is the touch on the handle or header area? ──────────────────
  function _isOnHandle(touch, panel) {
    // Check for .bottom-sheet-handle element
    var handle = panel.querySelector('.bottom-sheet-handle');
    if (handle) {
      var r = handle.getBoundingClientRect();
      // Allow a generous 60px zone around the handle
      if (touch.clientY >= r.top - 10 && touch.clientY <= r.bottom + 50) return true;
    }
    // Also allow the top 70px of the panel (title area)
    var panelRect = panel.getBoundingClientRect();
    return touch.clientY <= panelRect.top + 70;
  }

  // ── Touch handlers ───────────────────────────────────────────────────────
  document.addEventListener('touchstart', function (e) {
    var panel = _findPanel(e.target);
    if (!panel || !panel.classList.contains('active')) {
      _sheet.active = false;
      return;
    }
    _sheet.panel     = panel;
    _sheet.backdrop  = _findBackdrop(panel);
    _sheet.startY    = e.touches[0].clientY;
    _sheet.lastY     = e.touches[0].clientY;
    _sheet.startTime = Date.now();
    _sheet.onHandle  = _isOnHandle(e.touches[0], panel);
    _sheet.active    = true;
    panel.style.transition = 'none';
  }, { passive: true });

  document.addEventListener('touchmove', function (e) {
    if (!_sheet.active || !_sheet.onHandle) return;
    var dy = e.touches[0].clientY - _sheet.startY;
    _sheet.lastY = e.touches[0].clientY;
    if (dy > 0) {
      _sheet.panel.style.transform = 'translateX(-50%) translateY(' + dy + 'px)';
      // Fade backdrop proportionally
      if (_sheet.backdrop) {
        _sheet.backdrop.style.opacity = String(Math.max(0, 1 - dy / 300));
      }
      e.preventDefault();
    }
  }, { passive: false });

  document.addEventListener('touchend', function (e) {
    if (!_sheet.active) return;
    _sheet.active = false;

    var panel    = _sheet.panel;
    var backdrop = _sheet.backdrop;
    if (!panel) return;

    panel.style.transition = '';

    if (!_sheet.onHandle) return; // not a handle swipe — spring back

    var dy      = _sheet.lastY - _sheet.startY;
    var elapsed = Date.now() - _sheet.startTime;
    var vy      = dy / elapsed; // px/ms
    var h       = panel.offsetHeight || 400;

    var dismiss = dy > 0 && (dy > h * 0.35 || vy > 0.5);

    if (dismiss) {
      // Dismiss: slide out, fade backdrop immediately
      panel.style.transition = 'transform 0.28s cubic-bezier(0.4, 0, 0.2, 1)';
      panel.style.transform  = 'translateX(-50%) translateY(100%)';
      if (backdrop) {
        backdrop.style.transition = 'opacity 0.2s ease';
        backdrop.style.opacity    = '0';
      }
      setTimeout(function () {
        panel.classList.remove('active');
        panel.style.transform  = '';
        panel.style.transition = '';
        if (backdrop) {
          backdrop.classList.remove('active');
          backdrop.style.opacity    = '';
          backdrop.style.transition = '';
        }
      }, 280);
    } else {
      // Spring back
      panel.style.transition = 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)';
      panel.style.transform  = 'translateX(-50%) translateY(0)';
      if (backdrop) backdrop.style.opacity = '';
      setTimeout(function () {
        panel.style.transition = '';
      }, 300);
    }

    _sheet.panel    = null;
    _sheet.backdrop = null;
  }, { passive: true });
})();

// ─── Bootstrap ───────────────────────────────────────────────────────────────

// Wait for the HTML to be fully parsed before running
document.addEventListener('DOMContentLoaded', initApp);

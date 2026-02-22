/**
 * settings.js — Settings Screen Module
 *
 * Exposes a global `SettingsScreen` object.
 * Handles: appearance, category management, account management,
 * data export/import/backup, storage stats, and about info.
 *
 * Dependencies (loaded before this file):
 *   db.js     → FinanceDB
 *   theme.js  → toggleTheme(), getCurrentTheme()
 *   router.js → navigateTo()
 */

(function (global) {
  'use strict';

  // ─── Internal State ─────────────────────────────────────────────────────────

  /** Currently-editing category id, or null for "add new" mode */
  let _editingCategoryId = null;

  /** Currently-editing account id */
  let _editingAccountId = null;

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Shows a toast notification.
   * Reuses the existing .toast element in the DOM (created by settings.html).
   * @param {string} message
   */
  function _showToast(message) {
    // Try to find a toast element scoped to settings, fall back to any toast
    let toast = document.getElementById('settings-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'settings-toast';
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(function () {
      toast.classList.remove('show');
    }, 2800);
  }

  /**
   * Opens a bottom sheet by adding .active to its backdrop and panel.
   * @param {string} backdropId
   * @param {string} panelId
   */
  function _openSheet(backdropId, panelId) {
    const backdrop = document.getElementById(backdropId);
    const panel    = document.getElementById(panelId);
    if (backdrop) backdrop.classList.add('active');
    if (panel)    panel.classList.add('active');
    // Sheets are moved to document.body in init() so position:fixed works on iOS.
    // No scroll manipulation needed.
  }

  /**
   * Closes a bottom sheet.
   * @param {string} backdropId
   * @param {string} panelId
   */
  function _closeSheet(backdropId, panelId) {
    const backdrop = document.getElementById(backdropId);
    const panel    = document.getElementById(panelId);
    if (backdrop) backdrop.classList.remove('active');
    if (panel)    panel.classList.remove('active');
  }

  /**
   * Formats a monthKey like "2025-06" → "Jun 2025".
   * @param {string|null} monthKey
   * @returns {string}
   */
  function _formatMonth(monthKey) {
    if (!monthKey) return '—';
    const [year, month] = monthKey.split('-');
    const date = new Date(parseInt(year, 10), parseInt(month, 10) - 1, 1);
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }

  /**
   * Generates a slug-style ID from a name string.
   * e.g. "Food & Dining" → "food-dining"
   * @param {string} name
   * @returns {string}
   */
  function _slugify(name) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  const SettingsScreen = {

    // ── Initialization ─────────────────────────────────────────────────────

    /**
     * Called when the settings screen becomes active.
     * Loads categories, accounts, storage stats, and syncs the dark mode toggle.
     */
    init: async function () {
      console.log('[Settings] init()');

      // ── iOS Fix: move bottom sheets to document.body so position:fixed works ──
      ['category-sheet-backdrop', 'category-edit-sheet',
       'account-sheet-backdrop',  'account-edit-sheet',
       'confirm-sheet-backdrop',  'confirm-sheet'
      ].forEach(function (id) {
        const el = document.getElementById(id);
        if (el && el.parentElement !== document.body) {
          document.body.appendChild(el);
        }
      });

      // Sync dark mode toggle
      const toggle = document.getElementById('theme-toggle-input');
      if (toggle) {
        toggle.checked = (getCurrentTheme() === 'dark');
        toggle.onchange = function () { toggleTheme(); };
      }

      // ── Accent Color Picker ─────────────────────────────────────────────────
      const ACCENT_COLORS = [
        { name: 'Indigo',  value: '#6C63FF' },
        { name: 'Emerald', value: '#10B981' },
        { name: 'Rose',    value: '#F43F5E' },
        { name: 'Amber',   value: '#F59E0B' },
        { name: 'Sky',     value: '#0EA5E9' },
        { name: 'Violet',  value: '#8B5CF6' },
      ];

      const ACCENT_KEY = 'finance-app-accent';
      const savedAccent = localStorage.getItem(ACCENT_KEY) || '#6C63FF';

      // Apply saved accent on init
      SettingsScreen._applyAccentColor(savedAccent);

      const swatchContainer = document.getElementById('accent-color-swatches');
      if (swatchContainer) {
        swatchContainer.innerHTML = '';
        ACCENT_COLORS.forEach(function (color) {
          const btn = document.createElement('button');
          btn.setAttribute('aria-label', color.name + ' accent color');
          btn.setAttribute('title', color.name);
          btn.style.cssText = `
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background: ${color.value};
            border: 3px solid ${color.value === savedAccent ? 'var(--text-primary)' : 'transparent'};
            outline: 2px solid ${color.value === savedAccent ? color.value : 'transparent'};
            outline-offset: 2px;
            cursor: pointer;
            transition: transform 0.15s ease, border-color 0.15s ease;
            flex-shrink: 0;
          `;
          btn.addEventListener('click', function () {
            localStorage.setItem(ACCENT_KEY, color.value);
            SettingsScreen._applyAccentColor(color.value);
            // Update swatch borders
            swatchContainer.querySelectorAll('button').forEach(function (b) {
              const isActive = b === btn;
              b.style.borderColor = isActive ? 'var(--text-primary)' : 'transparent';
              b.style.outlineColor = isActive ? color.value : 'transparent';
            });
          });
          btn.addEventListener('mouseenter', function () { btn.style.transform = 'scale(1.15)'; });
          btn.addEventListener('mouseleave', function () { btn.style.transform = 'scale(1)'; });
          swatchContainer.appendChild(btn);
        });
      }

      // Wire import file input
      const importInput = document.getElementById('import-file-input');
      if (importInput) {
        importInput.onchange = function (e) {
          const file = e.target.files && e.target.files[0];
          if (file) {
            SettingsScreen.importData(file);
            // Reset so the same file can be re-selected
            importInput.value = '';
          }
        };
      }

      // Load data
      try {
        const [categories, accounts] = await Promise.all([
          FinanceDB.getCategories(),
          FinanceDB.getAccounts(),
        ]);
        SettingsScreen.renderCategories(categories);
        SettingsScreen.renderAccounts(accounts);
      } catch (err) {
        console.error('[Settings] Failed to load categories/accounts:', err);
      }

      await SettingsScreen.loadStorageStats();
    },

    // ── Categories ─────────────────────────────────────────────────────────

    /**
     * Renders the category list into #settings-category-list.
     * @param {object[]} categories
     */
    renderCategories: function (categories) {
      const list = document.getElementById('settings-category-list');
      if (!list) return;

      list.innerHTML = '';

      categories.forEach(function (cat) {
        const row = document.createElement('div');
        row.className = 'category-settings-row';
        row.innerHTML = `
          <span class="category-settings-emoji">${cat.emoji || '📦'}</span>
          <div class="category-color-dot" style="background:${cat.color || '#BDC3C7'}"></div>
          <span class="category-settings-name">${_escapeHtml(cat.name)}</span>
          <button class="category-edit-btn" data-id="${cat.id}" aria-label="Edit ${_escapeHtml(cat.name)}">Edit</button>
        `;
        row.querySelector('.category-edit-btn').addEventListener('click', function () {
          SettingsScreen.openCategoryEdit(cat.id);
        });
        list.appendChild(row);
      });
    },

    /**
     * Opens the category edit bottom sheet.
     * @param {string|null} categoryId — null = add new category
     */
    openCategoryEdit: async function (categoryId) {
      _editingCategoryId = categoryId;

      const sheetTitle   = document.getElementById('category-sheet-title');
      const emojiInput   = document.getElementById('cat-edit-emoji');
      const nameInput    = document.getElementById('cat-edit-name');
      const colorInput   = document.getElementById('cat-edit-color');
      const colorPreview = document.getElementById('cat-edit-color-preview');
      const deleteBtn    = document.getElementById('cat-delete-btn');

      if (!sheetTitle || !emojiInput || !nameInput || !colorInput) return;

      if (categoryId) {
        // Edit mode — load existing category
        sheetTitle.textContent = 'Edit Category';
        try {
          const categories = await FinanceDB.getCategories();
          const cat = categories.find(function (c) { return c.id === categoryId; });
          if (!cat) return;

          emojiInput.value = cat.emoji || '';
          nameInput.value  = cat.name  || '';
          colorInput.value = cat.color || '#6C63FF';
          if (colorPreview) colorPreview.style.background = cat.color || '#6C63FF';

          // Delete button: disabled for default categories
          if (deleteBtn) {
            if (cat.isDefault) {
              deleteBtn.disabled = true;
              deleteBtn.title    = 'Default categories cannot be deleted';
              deleteBtn.style.opacity = '0.4';
            } else {
              deleteBtn.disabled = false;
              deleteBtn.title    = '';
              deleteBtn.style.opacity = '1';
              deleteBtn.onclick = function () {
                SettingsScreen._confirmDeleteCategory(cat);
              };
            }
          }
        } catch (err) {
          console.error('[Settings] openCategoryEdit load failed:', err);
          return;
        }
      } else {
        // Add mode
        sheetTitle.textContent = 'Add Category';
        emojiInput.value = '';
        nameInput.value  = '';
        colorInput.value = '#6C63FF';
        if (colorPreview) colorPreview.style.background = '#6C63FF';
        if (deleteBtn) {
          deleteBtn.disabled = true;
          deleteBtn.style.opacity = '0.4';
        }
      }

      // Sync color preview on change
      colorInput.oninput = function () {
        if (colorPreview) colorPreview.style.background = colorInput.value;
      };

      _openSheet('category-sheet-backdrop', 'category-edit-sheet');
    },

    /**
     * Internal: shows delete confirmation for a category.
     * @param {object} cat
     */
    _confirmDeleteCategory: async function (cat) {
      // Count transactions in this category
      let count = 0;
      try {
        const txns = await FinanceDB.getTransactionsByCategory(cat.id);
        count = Array.isArray(txns) ? txns.length : 0;
      } catch (_) {
        count = 0;
      }

      const body = count > 0
        ? `This will permanently delete the "${cat.name}" category. ${count} transaction${count !== 1 ? 's' : ''} will be moved to "Other". This cannot be undone.`
        : `This will permanently delete the "${cat.name}" category. This cannot be undone.`;

      SettingsScreen.showConfirmSheet({
        title:        '🗑️ Delete Category?',
        body:         body,
        confirmText:  'Delete',
        confirmClass: 'btn-danger',
        onConfirm:    async function () {
          try {
            await FinanceDB.deleteCategory(cat.id);
            _closeSheet('category-sheet-backdrop', 'category-edit-sheet');
            const categories = await FinanceDB.getCategories();
            SettingsScreen.renderCategories(categories);
            _showToast('🗑️ Category deleted');
          } catch (err) {
            console.error('[Settings] deleteCategory failed:', err);
            _showToast('❌ Failed to delete category');
          }
        },
      });
    },

    /**
     * Saves the category edit form to the DB, then refreshes the list.
     */
    saveCategoryEdit: async function () {
      const emojiInput = document.getElementById('cat-edit-emoji');
      const nameInput  = document.getElementById('cat-edit-name');
      const colorInput = document.getElementById('cat-edit-color');

      if (!nameInput) return;

      const emoji = (emojiInput ? emojiInput.value.trim() : '') || '📦';
      const name  = nameInput.value.trim();
      const color = colorInput ? colorInput.value : '#6C63FF';

      if (!name) {
        _showToast('⚠️ Category name is required');
        return;
      }

      try {
        if (_editingCategoryId) {
          // Update existing
          await FinanceDB.updateCategory(_editingCategoryId, { name, emoji, color });
          _showToast('✅ Category saved');
        } else {
          // Add new
          const existingCategories = await FinanceDB.getCategories();
          let id = _slugify(name);

          // Ensure unique ID
          if (existingCategories.some(function (c) { return c.id === id; })) {
            id = id + '-' + Date.now();
          }

          const maxOrder = existingCategories.reduce(function (max, c) {
            return Math.max(max, c.sortOrder || 0);
          }, 0);

          await FinanceDB.addCategory({
            id:        id,
            name:      name,
            emoji:     emoji,
            color:     color,
            isDefault: false,
            isHidden:  false,
            sortOrder: maxOrder + 1,
          });
          _showToast('✅ Category added');
        }

        _closeSheet('category-sheet-backdrop', 'category-edit-sheet');
        const categories = await FinanceDB.getCategories();
        SettingsScreen.renderCategories(categories);
      } catch (err) {
        console.error('[Settings] saveCategoryEdit failed:', err);
        _showToast('❌ Failed to save category');
      }
    },

    // ── Accounts ───────────────────────────────────────────────────────────

    /**
     * Renders the account list into #settings-account-list.
     * @param {object[]} accounts
     */
    renderAccounts: function (accounts) {
      const list = document.getElementById('settings-account-list');
      if (!list) return;

      list.innerHTML = '';

      accounts.forEach(function (acct) {
        const typeClass = acct.type === 'checking' ? 'checking'
                        : acct.type === 'savings'  ? 'savings'
                        : 'credit';

        const row = document.createElement('div');
        row.className = 'account-settings-row';
        row.innerHTML = `
          <div class="account-color-swatch" style="background:${acct.color || '#6C63FF'}"></div>
          <div class="account-settings-info">
            <div class="account-settings-name">${_escapeHtml(acct.name)}</div>
            <div class="account-settings-type">${_escapeHtml(acct.institution || '')}</div>
          </div>
          <span class="account-type-badge ${typeClass}">${acct.type || 'checking'}</span>
          <button class="category-edit-btn" data-id="${acct.id}" aria-label="Edit ${_escapeHtml(acct.name)}">Edit</button>
        `;
        row.querySelector('.category-edit-btn').addEventListener('click', function () {
          SettingsScreen.openAccountEdit(acct.id);
        });
        list.appendChild(row);
      });
    },

    /**
     * Opens the account edit bottom sheet.
     * @param {string} accountId
     */
    openAccountEdit: async function (accountId) {
      _editingAccountId = accountId;

      const sheetTitle    = document.getElementById('account-sheet-title');
      const nameInput     = document.getElementById('acct-edit-name');
      const colorInput    = document.getElementById('acct-edit-color');
      const colorPreview  = document.getElementById('acct-edit-color-preview');
      const activeToggle  = document.getElementById('acct-edit-active');

      if (!nameInput) return;

      try {
        const accounts = await FinanceDB.getAccounts();
        const acct = accounts.find(function (a) { return a.id === accountId; });
        if (!acct) return;

        if (sheetTitle) sheetTitle.textContent = 'Edit Account';
        nameInput.value = acct.name || '';
        if (colorInput) {
          colorInput.value = acct.color || '#6C63FF';
          colorInput.oninput = function () {
            if (colorPreview) colorPreview.style.background = colorInput.value;
          };
        }
        if (colorPreview) colorPreview.style.background = acct.color || '#6C63FF';
        if (activeToggle) activeToggle.checked = acct.isActive !== false;

      } catch (err) {
        console.error('[Settings] openAccountEdit load failed:', err);
        return;
      }

      _openSheet('account-sheet-backdrop', 'account-edit-sheet');
    },

    /**
     * Saves the account edit form to the DB, then refreshes the list.
     */
    saveAccountEdit: async function () {
      const nameInput    = document.getElementById('acct-edit-name');
      const colorInput   = document.getElementById('acct-edit-color');
      const activeToggle = document.getElementById('acct-edit-active');

      if (!nameInput || !_editingAccountId) return;

      const name     = nameInput.value.trim();
      const color    = colorInput ? colorInput.value : '#6C63FF';
      const isActive = activeToggle ? activeToggle.checked : true;

      if (!name) {
        _showToast('⚠️ Account name is required');
        return;
      }

      try {
        await FinanceDB.updateAccount(_editingAccountId, { name, color, isActive });
        _closeSheet('account-sheet-backdrop', 'account-edit-sheet');
        const accounts = await FinanceDB.getAccounts();
        SettingsScreen.renderAccounts(accounts);
        _showToast('✅ Account saved');
      } catch (err) {
        console.error('[Settings] saveAccountEdit failed:', err);
        _showToast('❌ Failed to save account');
      }
    },

    // ── Data Export / Import / Clear ───────────────────────────────────────

    /**
     * Exports all data as a JSON file download.
     * On iOS Safari this triggers the share sheet.
     */
    exportData: async function () {
      try {
        const data = await FinanceDB.exportAllData();
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = 'finance-backup-' + new Date().toISOString().split('T')[0] + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
        _showToast('✅ Backup saved!');
      } catch (err) {
        console.error('[Settings] exportData failed:', err);
        _showToast('❌ Export failed');
      }
    },

    /**
     * Reads a JSON file and imports it into the DB after confirmation.
     * @param {File} file
     */
    importData: function (file) {
      const reader = new FileReader();
      reader.onload = function (e) {
        let json;
        try {
          json = JSON.parse(e.target.result);
        } catch (_) {
          _showToast('❌ Invalid backup file');
          return;
        }

        SettingsScreen.showConfirmSheet({
          title:       '⚠️ Restore Backup?',
          body:        'This will replace your existing transaction data. Categories and accounts will be preserved. Continue?',
          confirmText: 'Restore',
          confirmClass:'btn-primary',
          onConfirm:   async function () {
            try {
              await FinanceDB.importData(json);
              _showToast('✅ Data restored successfully!');
              // Refresh all screens
              if (typeof DashboardScreen !== 'undefined' && DashboardScreen.init) {
                DashboardScreen.init().catch(function () {});
              }
              await SettingsScreen.loadStorageStats();
            } catch (err) {
              console.error('[Settings] importData failed:', err);
              _showToast('❌ Restore failed');
            }
          },
        });
      };
      reader.readAsText(file);
    },

    /**
     * Shows a confirmation sheet, then clears all transaction data.
     */
    clearAllData: function () {
      SettingsScreen.showConfirmSheet({
        title:       '⚠️ Clear All Data?',
        body:        'This will permanently delete all your transactions and monthly summaries. Your categories and accounts will be kept. This cannot be undone.',
        confirmText: 'Yes, Delete Everything',
        confirmClass:'btn-danger',
        onConfirm:   async function () {
          try {
            await FinanceDB.clearAllData();
            _showToast('🗑️ All data cleared');
            // Refresh dashboard and stats
            if (typeof DashboardScreen !== 'undefined' && DashboardScreen.init) {
              DashboardScreen.init().catch(function () {});
            }
            await SettingsScreen.loadStorageStats();
            if (typeof navigateTo === 'function') {
              navigateTo('dashboard');
            }
          } catch (err) {
            console.error('[Settings] clearAllData failed:', err);
            _showToast('❌ Failed to clear data');
          }
        },
      });
    },

    // ── Storage Stats ──────────────────────────────────────────────────────

    /**
     * Loads storage stats from the DB and updates the stats section.
     */
    loadStorageStats: async function () {
      const container = document.getElementById('settings-storage-stats');
      if (!container) return;

      try {
        const stats = await FinanceDB.getStorageStats();

        const txnEl     = document.getElementById('stat-transaction-count');
        const monthEl   = document.getElementById('stat-month-count');
        const oldestEl  = document.getElementById('stat-oldest-month');
        const newestEl  = document.getElementById('stat-newest-month');

        if (txnEl)    txnEl.textContent   = stats.transactionCount.toLocaleString();
        if (monthEl)  monthEl.textContent  = stats.monthCount;
        if (oldestEl) oldestEl.textContent = _formatMonth(stats.oldestMonth);
        if (newestEl) newestEl.textContent = _formatMonth(stats.newestMonth);
      } catch (err) {
        console.error('[Settings] loadStorageStats failed:', err);
      }
    },

    // ── Confirm Sheet ──────────────────────────────────────────────────────

    /**
     * Shows a generic confirmation bottom sheet.
     * @param {{ title: string, body: string, confirmText: string, confirmClass: string, onConfirm: function }} options
     */
    showConfirmSheet: function (options) {
      const titleEl   = document.getElementById('confirm-sheet-title');
      const bodyEl    = document.getElementById('confirm-sheet-body');
      const confirmBtn= document.getElementById('confirm-sheet-confirm-btn');
      const cancelBtn = document.getElementById('confirm-sheet-cancel-btn');

      if (!titleEl || !bodyEl || !confirmBtn) return;

      titleEl.textContent = options.title   || 'Are you sure?';
      bodyEl.textContent  = options.body    || '';
      confirmBtn.textContent = options.confirmText || 'Confirm';

      // Reset button classes
      confirmBtn.className = 'btn btn-full ' + (options.confirmClass || 'btn-primary');

      // Wire confirm action
      confirmBtn.onclick = function () {
        _closeSheet('confirm-sheet-backdrop', 'confirm-sheet');
        if (typeof options.onConfirm === 'function') {
          options.onConfirm();
        }
      };

      // Wire cancel
      if (cancelBtn) {
        cancelBtn.onclick = function () {
          _closeSheet('confirm-sheet-backdrop', 'confirm-sheet');
        };
      }

      _openSheet('confirm-sheet-backdrop', 'confirm-sheet');
    },

    // ── _applyAccentColor ───────────────────────────────────────────────────

    /**
     * Applies an accent color to all CSS custom properties that use --accent.
     * @param {string} hex  e.g. '#6C63FF'
     */
    _applyAccentColor: function (hex) {
      if (!hex) return;
      const root = document.documentElement;

      function hexToRgb(h) {
        const r = parseInt(h.slice(1, 3), 16);
        const g = parseInt(h.slice(3, 5), 16);
        const b = parseInt(h.slice(5, 7), 16);
        return { r: r, g: g, b: b };
      }

      const { r, g, b } = hexToRgb(hex);
      root.style.setProperty('--accent',          hex);
      root.style.setProperty('--accent-primary',   hex);
      root.style.setProperty('--accent-light',     'rgba(' + r + ',' + g + ',' + b + ',0.12)');
      root.style.setProperty('--accent-rgb',       r + ',' + g + ',' + b);

      // Update theme-color meta for browser chrome
      const themeMeta = document.querySelector('meta[name="theme-color"]:not([media])');
      if (themeMeta) themeMeta.setAttribute('content', hex);
    },

  }; // end SettingsScreen

  // ─── Escape HTML helper (module-private) ────────────────────────────────────

  function _escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ─── Expose Globally ────────────────────────────────────────────────────────

  global.SettingsScreen = SettingsScreen;

}(window));

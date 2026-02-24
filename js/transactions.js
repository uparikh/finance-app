/**
 * transactions.js — Transactions Screen Logic
 *
 * Manages all state and interactions for the transactions screen:
 *   - Month selector dropdown (populated from DB)
 *   - Category filter chips (dynamic, from DB)
 *   - Account filter dropdown
 *   - Real-time search bar
 *   - Summary strip (count, income, expenses)
 *   - Transaction list grouped by date
 *   - Edit bottom sheet (inline editing of saved transactions)
 *   - Delete with confirmation
 *
 * Depends on: FinanceDB (db.js), navigateTo (router.js)
 * Exposes: global TransactionsScreen
 */

(function (global) {
  'use strict';

  // ─── Module State ────────────────────────────────────────────────────────────

  /** All transactions for the selected month (unfiltered) */
  let _allTransactions = [];

  /** Currently filtered + searched transactions */
  let _filteredTransactions = [];

  /** All categories from DB, keyed by id */
  let _categoriesMap = {};

  /** All accounts from DB, keyed by id */
  let _accountsMap = {};

  /** Current filter state */
  let _currentMonthKey   = null;
  let _currentCategoryId = null; // null = all
  let _currentAccountId  = null; // null = all
  let _currentSearch     = '';

  /** ID of the transaction currently being edited */
  let _editingId = null;

  /** Original merchant name of the transaction being edited (before any changes) */
  let _originalMerchantName = null;

  /** Debounce timer for search input */
  let _searchDebounce = null;

  // ─── DOM Helpers ─────────────────────────────────────────────────────────────

  function el(id) {
    return document.getElementById(id);
  }

  // ─── Utility: HTML Escape ────────────────────────────────────────────────────

  function _esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ─── Utility: Date Formatting ────────────────────────────────────────────────

  /**
   * Formats 'YYYY-MM-DD' → 'February 20' (for date group headers)
   */
  function _formatDateHeader(dateStr) {
    if (!dateStr) return 'Unknown Date';
    try {
      const [year, month, day] = dateStr.split('-').map(Number);
      const d = new Date(year, month - 1, day);
      return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    } catch (e) {
      return dateStr;
    }
  }

  /**
   * Formats 'YYYY-MM' → 'February 2026' (for month selector)
   */
  function _formatMonthLabel(monthKey) {
    if (!monthKey) return '';
    try {
      const [y, m] = monthKey.split('-').map(Number);
      const d = new Date(y, m - 1, 1);
      return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    } catch (e) {
      return monthKey;
    }
  }

  /**
   * Formats 'YYYY-MM-DD' → 'February 15, 2026' (for edit sheet date field)
   */
  function _formatDateFull(dateStr) {
    if (!dateStr) return '';
    try {
      const [year, month, day] = dateStr.split('-').map(Number);
      const d = new Date(year, month - 1, day);
      return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    } catch (e) {
      return dateStr;
    }
  }

  /**
   * Parses a human-readable date string back to 'YYYY-MM-DD'.
   * Falls back to the original if parsing fails.
   */
  function _parseDateToISO(dateStr, fallback) {
    if (!dateStr) return fallback || '';
    try {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) {
        const y   = d.getFullYear();
        const m   = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + day;
      }
    } catch (e) { /* fall through */ }
    return fallback || '';
  }

  // ─── Utility: Amount Formatting ──────────────────────────────────────────────

  function _formatAmount(amount, isTransfer) {
    const abs = Math.abs(amount);
    const formatted = abs.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    if (isTransfer) {
      return { text: '~$' + formatted, color: 'var(--text-tertiary, #9CA3AF)' };
    }
    if (amount >= 0) {
      return { text: '+$' + formatted, color: 'var(--success)' };
    } else {
      return { text: '-$' + formatted, color: 'var(--danger)' };
    }
  }

  function _formatCurrency(amount) {
    return '$' + Math.abs(amount).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  // ─── Utility: Category Helpers ───────────────────────────────────────────────

  function _getCategoryEmoji(categoryId) {
    const cat = _categoriesMap[categoryId];
    if (cat) return cat.emoji;
    const fallback = {
      food: '🍔', groceries: '🛒', transport: '🚗', shopping: '🛍️',
      subscriptions: '📺', health: '💊', travel: '✈️', housing: '🏠',
      entertainment: '🎬', utilities: '💡', income: '💰', transfer: '🔄',
      other: '📦',
    };
    return fallback[categoryId] || '📦';
  }

  function _getCategoryName(categoryId) {
    const cat = _categoriesMap[categoryId];
    if (cat) return cat.name;
    const fallback = {
      food: 'Food & Dining', groceries: 'Groceries', transport: 'Transport',
      shopping: 'Shopping', subscriptions: 'Subscriptions', health: 'Health & Medical',
      travel: 'Travel', housing: 'Housing & Rent', entertainment: 'Entertainment',
      utilities: 'Utilities', income: 'Income', transfer: 'Transfer', other: 'Other',
    };
    return fallback[categoryId] || categoryId;
  }

  function _getCategoryColor(categoryId) {
    const cat = _categoriesMap[categoryId];
    if (cat && cat.color) return cat.color;
    const fallback = {
      food: '#FF6B6B', groceries: '#4ECDC4', transport: '#45B7D1',
      shopping: '#96CEB4', subscriptions: '#9B59B6', health: '#E74C3C',
      travel: '#3498DB', housing: '#E67E22', entertainment: '#F39C12',
      utilities: '#1ABC9C', income: '#2ECC71', transfer: '#95A5A6', other: '#BDC3C7',
    };
    return fallback[categoryId] || '#BDC3C7';
  }

  // ─── Public: Filter Setters ──────────────────────────────────────────────────

  function setMonthFilter(monthKey) {
    _currentMonthKey = monthKey;
  }

  function setCategoryFilter(categoryId) {
    _currentCategoryId = categoryId || null;
  }

  function setAccountFilter(accountId) {
    _currentAccountId = accountId || null;
  }

  function setSearchQuery(query) {
    _currentSearch = (query || '').trim().toLowerCase();
  }

  // ─── Load Transactions ───────────────────────────────────────────────────────

  /**
   * Reads current filter state, queries DB, renders list.
   * When _currentMonthKey === 'all', loads ALL transactions across every month.
   */
  async function loadTransactions() {
    if (!_currentMonthKey) return;

    try {
      if (_currentMonthKey === 'all') {
        _allTransactions = await FinanceDB.getAllTransactions();
      } else {
        _allTransactions = await FinanceDB.getTransactionsByMonth(_currentMonthKey);
      }
    } catch (err) {
      console.error('[TransactionsScreen] loadTransactions failed:', err);
      _allTransactions = [];
    }

    applyFilters();
  }

  // ─── Apply Filters ───────────────────────────────────────────────────────────

  /**
   * Applies category + account + search filters to loaded transactions.
   * Updates summary strip and re-renders list.
   */
  function applyFilters() {
    let filtered = _allTransactions.slice();

    // Category filter
    if (_currentCategoryId) {
      filtered = filtered.filter(function (t) {
        return t.categoryId === _currentCategoryId;
      });
    }

    // Account filter
    if (_currentAccountId) {
      filtered = filtered.filter(function (t) {
        return t.accountId === _currentAccountId;
      });
    }

    // Search filter
    if (_currentSearch) {
      filtered = filtered.filter(function (t) {
        const merchant = (t.merchantName || '').toLowerCase();
        const desc     = (t.description  || '').toLowerCase();
        const notes    = (t.notes        || '').toLowerCase();
        return merchant.indexOf(_currentSearch) !== -1 ||
               desc.indexOf(_currentSearch)     !== -1 ||
               notes.indexOf(_currentSearch)    !== -1;
      });
    }

    _filteredTransactions = filtered;

    _updateSummaryStrip();
    renderList(_filteredTransactions);
  }

  // ─── Summary Strip ───────────────────────────────────────────────────────────

  function _updateSummaryStrip() {
    const strip = el('txn-summary-strip');
    if (!strip) return;

    let income    = 0;
    let expenses  = 0;
    let transfers = 0;

    _filteredTransactions.forEach(function (t) {
      if (t.categoryId === 'transfer') {
        transfers += Math.abs(t.amount);
      } else if (t.amount > 0) {
        income += t.amount;
      } else {
        expenses += Math.abs(t.amount);
      }
    });

    const countEl    = strip.querySelector('[data-summary="count"]');
    const incomeEl   = strip.querySelector('[data-summary="income"]');
    const expenseEl  = strip.querySelector('[data-summary="expenses"]');
    const transferEl = strip.querySelector('[data-summary="transfers"]');

    if (countEl)    countEl.textContent    = _filteredTransactions.length;
    if (incomeEl)   incomeEl.textContent   = _formatCurrency(income);
    if (expenseEl)  expenseEl.textContent  = _formatCurrency(expenses);
    if (transferEl) transferEl.textContent = _formatCurrency(transfers);
  }

  // ─── Render List ─────────────────────────────────────────────────────────────

  /**
   * Groups transactions by date, renders rows.
   * Shows empty state if empty.
   */
  function renderList(transactions) {
    const listEl = el('txn-list');
    if (!listEl) return;

    if (transactions.length === 0) {
      // Determine which empty state to show
      if (_allTransactions.length === 0) {
        const isAllView = _currentMonthKey === 'all';
        listEl.innerHTML =
          '<div class="empty-state">' +
            '<div class="empty-state-icon">📄</div>' +
            '<p class="empty-state-title">' + (isAllView ? 'No transactions yet' : 'No data for this month') + '</p>' +
            '<p class="empty-state-subtitle">Upload a bank statement to see your transactions here.</p>' +
            '<button class="btn btn-primary" style="margin-top:16px;" onclick="navigateTo(\'upload\')">' +
              'Upload Statement →' +
            '</button>' +
          '</div>';
      } else {
        listEl.innerHTML =
          '<div class="empty-state">' +
            '<div class="empty-state-icon">🔍</div>' +
            '<p class="empty-state-title">No transactions found</p>' +
            '<p class="empty-state-subtitle">Try changing your filters or search query.</p>' +
          '</div>';
      }
      return;
    }

    // Sort by date descending (newest first)
    const sorted = transactions.slice().sort(function (a, b) {
      return (b.date || '').localeCompare(a.date || '');
    });

    // Group by date
    const groups     = {};
    const groupOrder = [];
    sorted.forEach(function (txn) {
      const dateKey = txn.date || 'Unknown';
      if (!groups[dateKey]) {
        groups[dateKey] = [];
        groupOrder.push(dateKey);
      }
      groups[dateKey].push(txn);
    });

    // Build DOM using document fragment for performance
    const fragment = document.createDocumentFragment();

    groupOrder.forEach(function (dateKey) {
      // Date header
      const header = document.createElement('div');
      header.className = 'txn-date-header';
      header.textContent = _formatDateHeader(dateKey);
      fragment.appendChild(header);

      // Transaction rows
      groups[dateKey].forEach(function (txn) {
        const isTransfer = txn.categoryId === 'transfer';
        const emoji    = _getCategoryEmoji(txn.categoryId);
        const catName  = _getCategoryName(txn.categoryId);
        const catColor = isTransfer ? '#9CA3AF' : _getCategoryColor(txn.categoryId);
        const amtInfo  = _formatAmount(txn.amount, isTransfer);
        const merchant = txn.merchantName || txn.description || 'Unknown';

        // Background color = category color at 15% opacity (dimmer for transfers)
        const bgColor = _hexToRgba(catColor, isTransfer ? 0.10 : 0.15);

        const isHighCost = !txn.isIncome && !isTransfer && Math.abs(txn.amount) >= 150;
        const highCostBadge = isHighCost ? '<span class="high-cost-badge">⚠️ High</span>' : '';

        const item = document.createElement('div');
        item.className = 'txn-item' +
          (isHighCost ? ' high-cost' : '') +
          (isTransfer ? ' txn-transfer' : '');
        item.setAttribute('data-txn-id', txn.id);
        item.setAttribute('role', 'button');
        item.setAttribute('tabindex', '0');
        item.setAttribute('aria-label', 'Edit ' + merchant);

        item.innerHTML =
          '<div class="txn-emoji-circle" style="background:' + bgColor + ';' + (isTransfer ? 'opacity:0.7;' : '') + '">' +
            emoji +
          '</div>' +
          '<div class="txn-info">' +
            '<div class="txn-merchant" style="' + (isTransfer ? 'color:var(--text-secondary);' : '') + '">' + _esc(merchant) + '</div>' +
            '<div class="txn-category">' + _esc(catName) + '</div>' +
          '</div>' +
          '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;">' +
            '<div class="txn-amount" style="color:' + amtInfo.color + ';">' + _esc(amtInfo.text) + '</div>' +
            highCostBadge +
          '</div>';

        // Tap to edit
        item.addEventListener('click', function () {
          openEditSheet(txn.id);
        });
        item.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openEditSheet(txn.id);
          }
        });

        fragment.appendChild(item);
      });
    });

    listEl.innerHTML = '';
    listEl.appendChild(fragment);
  }

  /**
   * Converts a hex color to rgba string.
   * @param {string} hex - e.g. '#FF6B6B'
   * @param {number} alpha
   * @returns {string}
   */
  function _hexToRgba(hex, alpha) {
    try {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
    } catch (e) {
      return 'rgba(189,195,199,0.15)';
    }
  }

  // ─── Month Selector ──────────────────────────────────────────────────────────

  /**
   * Populates the month selector dropdown with all months that have data.
   * Always includes an "All Transactions" option at the top.
   */
  async function _populateMonthSelector() {
    const select = el('txn-month-select');
    if (!select) return;

    try {
      const months = await FinanceDB.getMonthsWithData();

      select.innerHTML = '';

      // "All Transactions" option — always present at the top
      const allOpt = document.createElement('option');
      allOpt.value = 'all';
      allOpt.textContent = '📋 All Transactions';
      if (_currentMonthKey === 'all') allOpt.selected = true;
      select.appendChild(allOpt);

      if (months.length === 0) return;

      // Show most recent first
      const reversed = months.slice().reverse();

      reversed.forEach(function (monthKey) {
        const opt = document.createElement('option');
        opt.value = monthKey;
        opt.textContent = _formatMonthLabel(monthKey);
        if (monthKey === _currentMonthKey) opt.selected = true;
        select.appendChild(opt);
      });

    } catch (err) {
      console.error('[TransactionsScreen] _populateMonthSelector failed:', err);
    }
  }

  // ─── Category Filter Chips ───────────────────────────────────────────────────

  /**
   * Renders category filter chips based on categories present in the current month.
   */
  function _renderCategoryChips() {
    const container = el('txn-category-chips');
    if (!container) return;

    // Collect unique category IDs from current month's transactions
    const catIds = [...new Set(_allTransactions.map(function (t) { return t.categoryId; }).filter(Boolean))];

    const fragment = document.createDocumentFragment();

    // "All" chip always first
    const allChip = document.createElement('button');
    allChip.className = 'filter-chip' + (_currentCategoryId === null ? ' active' : '');
    allChip.textContent = 'All';
    allChip.setAttribute('data-category', '');
    allChip.addEventListener('click', function () {
      setCategoryFilter(null);
      _updateChipActiveState('');
      applyFilters();
    });
    fragment.appendChild(allChip);

    // One chip per category
    catIds.forEach(function (catId) {
      const emoji = _getCategoryEmoji(catId);
      const name  = _getCategoryName(catId);

      const chip = document.createElement('button');
      chip.className = 'filter-chip' + (_currentCategoryId === catId ? ' active' : '');
      chip.textContent = emoji + ' ' + name;
      chip.setAttribute('data-category', catId);
      chip.addEventListener('click', function () {
        setCategoryFilter(catId);
        _updateChipActiveState(catId);
        applyFilters();
      });
      fragment.appendChild(chip);
    });

    container.innerHTML = '';
    container.appendChild(fragment);
  }

  function _updateChipActiveState(activeCatId) {
    const container = el('txn-category-chips');
    if (!container) return;
    container.querySelectorAll('.filter-chip').forEach(function (chip) {
      const catId = chip.getAttribute('data-category');
      if (catId === activeCatId) {
        chip.classList.add('active');
      } else {
        chip.classList.remove('active');
      }
    });
  }

  // ─── Account Filter Dropdown ─────────────────────────────────────────────────

  /**
   * Populates the account filter dropdown with accounts present in the current month.
   */
  function _populateAccountFilter() {
    const select = el('txn-account-select');
    if (!select) return;

    // Collect unique account IDs from current month's transactions
    const accountIds = [...new Set(_allTransactions.map(function (t) { return t.accountId; }).filter(Boolean))];

    select.innerHTML = '<option value="">💳 All Accounts</option>';

    accountIds.forEach(function (accountId) {
      const account = _accountsMap[accountId];
      const name    = account ? account.name : accountId;
      const opt     = document.createElement('option');
      opt.value       = accountId;
      opt.textContent = name;
      if (accountId === _currentAccountId) opt.selected = true;
      select.appendChild(opt);
    });
  }

  // ─── Edit Bottom Sheet ───────────────────────────────────────────────────────

  /**
   * Injects the transactions edit bottom sheet into document.body.
   * Uses unique IDs prefixed with 'txn-' to avoid conflicts with upload.js sheet.
   */
  function _ensureTxnEditSheet() {
    if (el('txn-edit-sheet-backdrop')) return; // already injected

    const html =
      '<div id="txn-edit-sheet-backdrop" class="bottom-sheet-backdrop" aria-hidden="true"></div>' +
      '<div id="txn-edit-sheet-panel" class="bottom-sheet-panel" role="dialog" aria-modal="true" aria-labelledby="txn-edit-sheet-title">' +
        '<div class="bottom-sheet-handle" aria-hidden="true"></div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">' +
          '<h2 id="txn-edit-sheet-title" style="font-size:18px;font-weight:700;color:var(--text-primary);margin:0;">Edit Transaction</h2>' +
          '<button id="txn-edit-sheet-close" class="btn-icon" aria-label="Close edit sheet" style="font-size:20px;padding:6px;">✕</button>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label" for="txn-edit-merchant-name">Merchant Name</label>' +
          '<input type="text" id="txn-edit-merchant-name" class="form-input" placeholder="e.g. Netflix" autocomplete="off" autocorrect="off" spellcheck="false">' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label" for="txn-edit-amount">Amount</label>' +
          '<div style="position:relative;margin-bottom:10px;">' +
            '<span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);font-size:15px;color:var(--text-secondary);pointer-events:none;">$</span>' +
            '<input type="number" id="txn-edit-amount" class="form-input" placeholder="0.00" min="0" step="0.01" style="padding-left:28px;" inputmode="decimal">' +
          '</div>' +
          '<div class="radio-group">' +
            '<div id="txn-edit-type-expense" class="radio-option selected-expense" role="radio" aria-checked="true" tabindex="0">💸 Expense</div>' +
            '<div id="txn-edit-type-income" class="radio-option" role="radio" aria-checked="false" tabindex="0">💰 Income</div>' +
          '</div>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label" for="txn-edit-date">Date</label>' +
          '<input type="text" id="txn-edit-date" class="form-input" placeholder="e.g. February 15, 2026" autocomplete="off">' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label" for="txn-edit-category-select">Category</label>' +
          '<div style="position:relative;">' +
            '<select id="txn-edit-category-select" class="form-select"><option value="other">📦 Other</option></select>' +
            '<span style="position:absolute;right:14px;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--text-secondary);font-size:12px;">▼</span>' +
          '</div>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label" for="txn-edit-notes">Notes <span style="font-weight:400;opacity:0.7;">(optional)</span></label>' +
          '<input type="text" id="txn-edit-notes" class="form-input" placeholder="Add a note…" autocomplete="off">' +
        '</div>' +
        '<div style="display:flex;gap:12px;margin-top:8px;">' +
          '<button id="txn-edit-sheet-cancel" class="btn btn-ghost" style="flex:1;" aria-label="Cancel edit">Cancel</button>' +
          '<button id="txn-edit-sheet-save" class="btn btn-primary" style="flex:2;" aria-label="Save transaction edit">Save ✅</button>' +
        '</div>' +
        '<button id="txn-edit-sheet-delete" class="btn-danger-outline" aria-label="Delete transaction">' +
          '🗑️ Delete Transaction' +
        '</button>' +
      '</div>';

    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    while (wrapper.firstChild) {
      document.body.appendChild(wrapper.firstChild);
    }

    // Wire up sheet controls
    const backdrop = el('txn-edit-sheet-backdrop');
    const closeBtn = el('txn-edit-sheet-close');
    const cancelBtn = el('txn-edit-sheet-cancel');
    const saveBtn   = el('txn-edit-sheet-save');
    const deleteBtn = el('txn-edit-sheet-delete');
    const incomeOpt  = el('txn-edit-type-income');
    const expenseOpt = el('txn-edit-type-expense');

    if (backdrop)   backdrop.addEventListener('click', _closeTxnEditSheet);
    if (closeBtn)   closeBtn.addEventListener('click', _closeTxnEditSheet);
    if (cancelBtn)  cancelBtn.addEventListener('click', _closeTxnEditSheet);
    if (saveBtn)    saveBtn.addEventListener('click', saveEdit);
    if (deleteBtn)  deleteBtn.addEventListener('click', function () {
      if (_editingId !== null) deleteTransaction(_editingId);
    });
    if (incomeOpt)  incomeOpt.addEventListener('click', function () { _setTxnAmountType('income'); });
    if (expenseOpt) expenseOpt.addEventListener('click', function () { _setTxnAmountType('expense'); });
  }

  function _setTxnAmountType(type) {
    const incomeOpt  = el('txn-edit-type-income');
    const expenseOpt = el('txn-edit-type-expense');
    if (!incomeOpt || !expenseOpt) return;

    incomeOpt.classList.remove('selected-income', 'selected-expense');
    expenseOpt.classList.remove('selected-income', 'selected-expense');

    if (type === 'income') {
      incomeOpt.classList.add('selected-income');
      incomeOpt.setAttribute('data-selected', 'true');
      incomeOpt.setAttribute('aria-checked', 'true');
      expenseOpt.removeAttribute('data-selected');
      expenseOpt.setAttribute('aria-checked', 'false');
    } else {
      expenseOpt.classList.add('selected-expense');
      expenseOpt.setAttribute('data-selected', 'true');
      expenseOpt.setAttribute('aria-checked', 'true');
      incomeOpt.removeAttribute('data-selected');
      incomeOpt.setAttribute('aria-checked', 'false');
    }
  }

  async function _populateTxnCategoryDropdown(selectedId) {
    const select = el('txn-edit-category-select');
    if (!select) return;

    try {
      const categories = await FinanceDB.getCategories();
      select.innerHTML = '';
      categories.forEach(function (cat) {
        const opt = document.createElement('option');
        opt.value = cat.id;
        opt.textContent = cat.emoji + ' ' + cat.name;
        if (cat.id === selectedId) opt.selected = true;
        select.appendChild(opt);
      });
      if (!select.value && categories.length > 0) {
        const otherOpt = select.querySelector('option[value="other"]');
        if (otherOpt) otherOpt.selected = true;
      }
    } catch (err) {
      console.error('[TransactionsScreen] _populateTxnCategoryDropdown failed:', err);
    }
  }

  /**
   * Opens the edit bottom sheet for a specific saved transaction.
   * @param {number} transactionId
   */
  async function openEditSheet(transactionId) {
    _ensureTxnEditSheet();

    try {
      const txn = await FinanceDB.getTransaction(transactionId);
      if (!txn) {
        console.warn('[TransactionsScreen] Transaction not found:', transactionId);
        return;
      }

      _editingId = transactionId;
      _originalMerchantName = txn.merchantName || txn.description || '';

      // Populate fields
      const nameInput   = el('txn-edit-merchant-name');
      const amountInput = el('txn-edit-amount');
      const dateInput   = el('txn-edit-date');
      const notesInput  = el('txn-edit-notes');

      if (nameInput)   nameInput.value   = txn.merchantName || txn.description || '';
      if (amountInput) amountInput.value = Math.abs(txn.amount || 0).toFixed(2);
      if (dateInput)   dateInput.value   = _formatDateFull(txn.date);
      if (notesInput)  notesInput.value  = txn.notes || '';

      // Set income/expense toggle
      _setTxnAmountType((txn.amount || 0) >= 0 ? 'income' : 'expense');

      // Populate category dropdown
      await _populateTxnCategoryDropdown(txn.categoryId);

      // Show the sheet
      const backdrop = el('txn-edit-sheet-backdrop');
      const panel    = el('txn-edit-sheet-panel');
      if (backdrop) backdrop.classList.add('active');
      if (panel)    panel.classList.add('active');

      // Focus merchant name for accessibility
      setTimeout(function () {
        if (nameInput) nameInput.focus();
      }, 350);

    } catch (err) {
      console.error('[TransactionsScreen] openEditSheet failed:', err);
    }
  }

  function _closeTxnEditSheet() {
    const backdrop = el('txn-edit-sheet-backdrop');
    const panel    = el('txn-edit-sheet-panel');
    if (backdrop) backdrop.classList.remove('active');
    if (panel)    panel.classList.remove('active');
    _editingId = null;
  }

  // ─── Save Edit ───────────────────────────────────────────────────────────────

  /**
   * Saves changes to DB, recomputes summary, refreshes list.
   */
  async function saveEdit() {
    if (_editingId === null) {
      _closeTxnEditSheet();
      return;
    }

    // Disable save + delete buttons to prevent double-tap
    const txnSaveBtn   = el('txn-edit-sheet-save');
    const txnDeleteBtn = el('txn-edit-sheet-delete');
    if (txnSaveBtn)   { txnSaveBtn.disabled   = true; }
    if (txnDeleteBtn) { txnDeleteBtn.disabled = true; }

    const nameInput   = el('txn-edit-merchant-name');
    const amountInput = el('txn-edit-amount');
    const dateInput   = el('txn-edit-date');
    const notesInput  = el('txn-edit-notes');
    const catSelect   = el('txn-edit-category-select');
    const incomeOpt   = el('txn-edit-type-income');

    const merchantName = nameInput   ? nameInput.value.trim()   : '';
    const amountRaw    = amountInput ? parseFloat(amountInput.value) : 0;
    const dateRaw      = dateInput   ? dateInput.value.trim()   : '';
    const notes        = notesInput  ? notesInput.value.trim()  : '';
    const categoryId   = catSelect   ? catSelect.value          : 'other';
    const isIncome     = incomeOpt   ? incomeOpt.hasAttribute('data-selected') : false;

    // Validate amount
    if (isNaN(amountRaw) || amountRaw < 0) {
      if (amountInput) {
        amountInput.style.borderColor = 'var(--danger)';
        setTimeout(function () { amountInput.style.borderColor = ''; }, 2000);
      }
      if (txnSaveBtn)   { txnSaveBtn.disabled   = false; }
      if (txnDeleteBtn) { txnDeleteBtn.disabled = false; }
      return;
    }

    // Fetch original to get fallback date AND original category (for merchant rule logic)
    let originalDate     = '';
    let originalCategory = null;
    try {
      const orig = await FinanceDB.getTransaction(_editingId);
      originalDate     = orig ? (orig.date     || '') : '';
      originalCategory = orig ? (orig.categoryId || null) : null;
    } catch (e) { /* ignore */ }

    const parsedDate   = _parseDateToISO(dateRaw, originalDate);
    const storedAmount = isIncome ? Math.abs(amountRaw) : -Math.abs(amountRaw);
    const monthKey     = parsedDate ? parsedDate.slice(0, 7) : (_currentMonthKey || '');

    const changes = {
      merchantName:     merchantName || undefined,
      amount:           storedAmount,
      date:             parsedDate,
      monthKey:         monthKey,
      categoryId:       categoryId,
      notes:            notes,
      isIncome:         isIncome,
      isManuallyEdited: true,
    };

    // Remove undefined keys
    Object.keys(changes).forEach(function (k) {
      if (changes[k] === undefined) delete changes[k];
    });

    try {
      await FinanceDB.updateTransaction(_editingId, changes);
      // recomputeMonthlySummary is called inside updateTransaction already,
      // but call it again if monthKey changed (skip for 'all' view)
      if (monthKey && monthKey !== _currentMonthKey) {
        await FinanceDB.recomputeMonthlySummary(monthKey);
      }
      if (_currentMonthKey && _currentMonthKey !== 'all') {
        await FinanceDB.recomputeMonthlySummary(_currentMonthKey);
      }
    } catch (err) {
      console.error('[TransactionsScreen] saveEdit failed:', err);
    }

    _closeTxnEditSheet();
    // Re-enable buttons now that sheet is closed
    if (txnSaveBtn)   { txnSaveBtn.disabled   = false; }
    if (txnDeleteBtn) { txnDeleteBtn.disabled = false; }

    await loadTransactions();
    _renderCategoryChips();
    _populateAccountFilter();

    // ── Bulk update: propagate name and/or category changes to all matching transactions ──
    const nameChanged     = _originalMerchantName &&
                            merchantName.toLowerCase().trim() !== _originalMerchantName.toLowerCase().trim();
    const categoryChanged = originalCategory !== categoryId;

    if (merchantName && (nameChanged || categoryChanged)) {
      try {
        // Save rule for future imports
        await FinanceDB.saveMerchantCategoryRule(merchantName, categoryId);

        // Find all other transactions that share the ORIGINAL merchant name
        const allTxns = await FinanceDB.getAllTransactions();
        const originalLower = (_originalMerchantName || '').toLowerCase().trim();
        const sameVendor = allTxns.filter(function (t) {
          return t.id !== _editingId &&
                 (t.merchantName || '').toLowerCase().trim() === originalLower;
        });

        if (sameVendor.length > 0) {
          // Build a human-readable description of what will change
          const changes = [];
          if (nameChanged)     changes.push('rename to "' + merchantName + '"');
          if (categoryChanged) changes.push('category → ' + _getCategoryName(categoryId));

          const confirmed = window.confirm(
            '📌 Apply to all "' + _originalMerchantName + '" transactions?\n\n' +
            'Found ' + sameVendor.length + ' other transaction' +
            (sameVendor.length !== 1 ? 's' : '') + ' from this vendor.\n\n' +
            'Changes: ' + changes.join(', ') + '.'
          );
          if (confirmed) {
            // Pass new name so updateTransactionsByMerchant renames them too
            await FinanceDB.updateTransactionsByMerchant(
              _originalMerchantName,
              categoryId,
              nameChanged ? merchantName : undefined
            );
            await loadTransactions();
            _renderCategoryChips();
            _populateAccountFilter();
          }
        }
      } catch (err) {
        console.warn('[TransactionsScreen] Bulk merchant update failed (non-fatal):', err);
      }
    }

    // Reset original name tracker
    _originalMerchantName = null;
  }

  // ─── Delete Transaction ──────────────────────────────────────────────────────

  /**
   * Confirms and deletes a transaction from DB, then refreshes.
   * @param {number} id
   */
  async function deleteTransaction(id) {
    // Re-enable buttons before showing confirm (so cancel doesn't leave them disabled)
    const txnSaveBtn2   = el('txn-edit-sheet-save');
    const txnDeleteBtn2 = el('txn-edit-sheet-delete');

    const confirmed = window.confirm('Delete this transaction? This cannot be undone.');
    if (!confirmed) {
      if (txnSaveBtn2)   { txnSaveBtn2.disabled   = false; }
      if (txnDeleteBtn2) { txnDeleteBtn2.disabled = false; }
      return;
    }

    _closeTxnEditSheet();

    try {
      await FinanceDB.deleteTransaction(id);
      // Don't call recomputeMonthlySummary for 'all' view — deleteTransaction handles it internally
      if (_currentMonthKey && _currentMonthKey !== 'all') {
        await FinanceDB.recomputeMonthlySummary(_currentMonthKey);
      }
    } catch (err) {
      console.error('[TransactionsScreen] deleteTransaction failed:', err);
    }

    await loadTransactions();
    _renderCategoryChips();
    _populateAccountFilter();
  }

  // ─── Search Bar ──────────────────────────────────────────────────────────────

  function _toggleSearchBar() {
    const bar = el('txn-search-bar');
    if (!bar) return;

    const isOpen = bar.classList.contains('open');
    if (isOpen) {
      bar.classList.remove('open');
      // Clear search when closing
      const input = el('txn-search-input');
      if (input) input.value = '';
      setSearchQuery('');
      applyFilters();
    } else {
      bar.classList.add('open');
      setTimeout(function () {
        const input = el('txn-search-input');
        if (input) input.focus();
      }, 300);
    }
  }

  // ─── Initialization ──────────────────────────────────────────────────────────

  /**
   * Initializes the transactions screen.
   * @param {object} [params] - Optional { monthKey, categoryId, accountId }
   */
  async function init(params) {
    console.log('[TransactionsScreen] init()', params);

    // Read and clear navigation params
    const navParams = params || window._navParams || {};
    window._navParams = {};

    // Ensure edit sheet is in DOM
    _ensureTxnEditSheet();

    // Load categories and accounts into maps
    try {
      const [categories, accounts] = await Promise.all([
        FinanceDB.getCategories(),
        FinanceDB.getAccounts(),
      ]);

      _categoriesMap = {};
      categories.forEach(function (c) { _categoriesMap[c.id] = c; });

      _accountsMap = {};
      accounts.forEach(function (a) { _accountsMap[a.id] = a; });
    } catch (err) {
      console.error('[TransactionsScreen] Failed to load categories/accounts:', err);
    }

    // Determine initial month — default to most recent, or 'all' if explicitly requested
    let initialMonth = navParams.monthKey || null;
    if (!initialMonth) {
      try {
        const months = await FinanceDB.getMonthsWithData();
        initialMonth = months.length > 0 ? months[months.length - 1] : null;
      } catch (err) {
        console.error('[TransactionsScreen] getMonthsWithData failed:', err);
      }
    }

    _currentMonthKey   = initialMonth || 'all';
    _currentCategoryId = navParams.categoryId || null;
    _currentAccountId  = navParams.accountId  || null;
    _currentSearch     = '';

    // Populate month selector
    await _populateMonthSelector();

    // Wire month selector change
    const monthSelect = el('txn-month-select');
    if (monthSelect) {
      // Remove old listener by replacing element clone
      const newSelect = monthSelect.cloneNode(true);
      monthSelect.parentNode.replaceChild(newSelect, monthSelect);
      newSelect.addEventListener('change', async function () {
        _currentMonthKey   = newSelect.value;
        _currentCategoryId = null;
        _currentAccountId  = null;
        _currentSearch     = '';
        // Clear search bar
        const searchInput = el('txn-search-input');
        if (searchInput) searchInput.value = '';
        const searchBar = el('txn-search-bar');
        if (searchBar) searchBar.classList.remove('open');

        await loadTransactions();
        _renderCategoryChips();
        _populateAccountFilter();
      });
    }

    // Wire account filter change
    const accountSelect = el('txn-account-select');
    if (accountSelect) {
      const newAccSelect = accountSelect.cloneNode(true);
      accountSelect.parentNode.replaceChild(newAccSelect, accountSelect);
      newAccSelect.addEventListener('change', function () {
        _currentAccountId = newAccSelect.value || null;
        applyFilters();
      });
    }

    // Wire search icon button
    const searchBtn = el('txn-search-btn');
    if (searchBtn) {
      const newSearchBtn = searchBtn.cloneNode(true);
      searchBtn.parentNode.replaceChild(newSearchBtn, searchBtn);
      newSearchBtn.addEventListener('click', _toggleSearchBar);
    }

    // Wire search input
    const searchInput = el('txn-search-input');
    if (searchInput) {
      const newSearchInput = searchInput.cloneNode(true);
      searchInput.parentNode.replaceChild(newSearchInput, searchInput);
      newSearchInput.addEventListener('input', function () {
        clearTimeout(_searchDebounce);
        _searchDebounce = setTimeout(function () {
          setSearchQuery(newSearchInput.value);
          applyFilters();
        }, 200);
      });
    }

    // Wire search clear button
    const searchClear = el('txn-search-clear');
    if (searchClear) {
      const newClear = searchClear.cloneNode(true);
      searchClear.parentNode.replaceChild(newClear, searchClear);
      newClear.addEventListener('click', function () {
        const inp = el('txn-search-input');
        if (inp) inp.value = '';
        setSearchQuery('');
        applyFilters();
      });
    }

    // Load transactions and render
    await loadTransactions();
    _renderCategoryChips();
    _populateAccountFilter();

    // Apply initial category filter from params (after chips are rendered)
    if (_currentCategoryId) {
      _updateChipActiveState(_currentCategoryId);
      applyFilters();
    }

    console.log('[TransactionsScreen] init() complete ✅');
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  const TransactionsScreen = {
    init:               init,
    loadTransactions:   loadTransactions,
    applyFilters:       applyFilters,
    renderList:         renderList,
    openEditSheet:      openEditSheet,
    saveEdit:           saveEdit,
    deleteTransaction:  deleteTransaction,
    setMonthFilter:     setMonthFilter,
    setCategoryFilter:  setCategoryFilter,
    setAccountFilter:   setAccountFilter,
    setSearchQuery:     setSearchQuery,
  };

  global.TransactionsScreen = TransactionsScreen;

}(window));

console.log('[TransactionsScreen] transactions.js loaded ✅');

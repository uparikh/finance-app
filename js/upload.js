/**
 * upload.js — Upload Screen Logic
 *
 * Manages all state and interactions for the upload screen:
 *   State 1: IDLE     — file picker, institution chips, recent uploads
 *   State 2: PARSING  — progress bar, status text
 *   State 3: REVIEW   — transaction list, edit sheet, save button
 *
 * Depends on: FinanceDB (db.js), PDFParser (parsers.js), navigateTo (router.js)
 * Exposes: global UploadScreen
 */

(function (global) {
  'use strict';

  // ─── Module State ────────────────────────────────────────────────────────────

  /** Parsed transactions waiting to be confirmed and saved */
  let pendingTransactions = [];

  /** The full parse result from PDFParser */
  let currentParseResult = null;

  /** Index of the transaction currently being edited in the bottom sheet */
  let editingIndex = -1;

  /** Current filter: 'all' | 'income' | 'expense' | 'transfer' */
  let currentFilter = 'all';

  /** Progress simulation timer handle */
  let progressTimer = null;

  // ─── DOM Helpers ─────────────────────────────────────────────────────────────

  function el(id) {
    return document.getElementById(id);
  }

  // ─── State Management ────────────────────────────────────────────────────────

  /**
   * Shows one of the three upload screen states, hides the others.
   * @param {'idle'|'parsing'|'review'} state
   */
  function showState(state) {
    const idle    = el('upload-idle');
    const parsing = el('upload-parsing');
    const review  = el('upload-review');

    if (!idle || !parsing || !review) {
      console.warn('[UploadScreen] State elements not found in DOM');
      return;
    }

    idle.style.display    = state === 'idle'    ? '' : 'none';
    parsing.style.display = state === 'parsing' ? '' : 'none';
    review.style.display  = state === 'review'  ? '' : 'none';

    // Show/hide the fixed save bar (injected into body)
    const saveBar = el('upload-save-bar-fixed');
    if (saveBar) {
      saveBar.style.display = state === 'review' ? 'flex' : 'none';
    }

    // Update header title and back button visibility
    const headerTitle  = el('upload-header-title');
    const backBtn      = el('upload-back-btn');
    const headerAction = el('upload-header-action');

    if (headerTitle) {
      headerTitle.textContent = state === 'review' ? 'Review Transactions' : 'Upload Statement';
    }
    if (backBtn) {
      backBtn.style.display = state === 'review' ? '' : 'none';
    }
    if (headerAction) {
      headerAction.style.display = state === 'idle' ? '' : 'none';
    }
  }

  /**
   * Returns true if the upload screen is currently in review state
   * (i.e. the user has pending transactions that haven't been saved yet).
   */
  function isInReviewState() {
    return pendingTransactions.length > 0;
  }

  // ─── Progress Simulation ─────────────────────────────────────────────────────

  /**
   * Simulates PDF parsing progress since PDF.js doesn't emit real progress.
   * Stages: 10% → 40% → 70% → 100%
   * @param {string} fileName
   * @returns {{ advance: function(number, string), complete: function(), cancel: function() }}
   */
  function createProgressSimulator(fileName) {
    const bar    = el('parsing-progress-fill');
    const status = el('parsing-status');
    const pct    = el('parsing-percent');

    function setProgress(percent, message) {
      if (bar)    bar.style.width = percent + '%';
      if (pct)    pct.textContent = percent + '%';
      if (status) status.textContent = message;
    }

    // Start at 10%
    setProgress(10, 'Reading PDF…');

    let currentPct = 10;

    // Slowly creep from 10 → 35% while waiting for text extraction
    const creepTimer = setInterval(function () {
      if (currentPct < 35) {
        currentPct += 1;
        setProgress(currentPct, 'Reading PDF…');
      }
    }, 80);

    return {
      advance: function (percent, message) {
        clearInterval(creepTimer);
        currentPct = percent;
        setProgress(percent, message);
      },
      complete: function () {
        clearInterval(creepTimer);
        setProgress(100, 'Done!');
      },
      cancel: function () {
        clearInterval(creepTimer);
      },
    };
  }

  // ─── File Handling ───────────────────────────────────────────────────────────

  /**
   * Called when the user selects a PDF file.
   * Transitions to parsing state, runs PDFParser, then shows review.
   * @param {File} file
   */
  async function handleFileSelect(file) {
    if (!file) return;

    // Validate file type
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      showUploadError('Please select a PDF file.');
      return;
    }

    // Validate file size (max 50 MB)
    if (file.size > 50 * 1024 * 1024) {
      showUploadError('File is too large. Please use a PDF under 50 MB.');
      return;
    }

    // Clear any previous error
    clearUploadError();

    // Switch to parsing state
    showState('parsing');

    // Update parsing header with file name
    const fileNameEl = el('parsing-file-name');
    if (fileNameEl) {
      fileNameEl.textContent = 'Extracting transactions from ' + file.name + '…';
    }

    const progress = createProgressSimulator(file.name);

    try {
      // Advance to 40% when text extraction starts
      await new Promise(r => setTimeout(r, 300));
      progress.advance(40, 'Extracting text from PDF…');

      // Run the parser
      const result = await PDFParser.parseStatement(file);

      // Advance to 70% when parsing starts
      progress.advance(70, 'Identifying transactions…');
      await new Promise(r => setTimeout(r, 200));

      // Advance to 90%
      progress.advance(90, 'Categorizing transactions…');
      await new Promise(r => setTimeout(r, 150));

      // Complete
      progress.complete();
      await new Promise(r => setTimeout(r, 300));

      // Check for failure
      if (!result || result.bank === 'unknown' || result.transactions.length === 0) {
        const errMsg = result && result.parseErrors && result.parseErrors.length > 0
          ? result.parseErrors[0]
          : 'No transactions found in this PDF.';

        showState('idle');
        showUploadError(
          '❌ Couldn\'t read this PDF. Make sure it\'s a statement from ' +
          'Ally, Capital One, Bilt, Discover, or Wells Fargo.'
        );
        console.warn('[UploadScreen] Parse failed:', errMsg);
        return;
      }

      // Store result and show review
      currentParseResult = result;
      pendingTransactions = result.transactions.slice(); // shallow copy
      currentFilter = 'all';

      renderReviewList(result);
      showState('review');

    } catch (err) {
      progress.cancel();
      console.error('[UploadScreen] handleFileSelect error:', err);
      showState('idle');
      showUploadError(
        '❌ Couldn\'t read this PDF. Make sure it\'s a statement from ' +
        'Ally, Capital One, Bilt, Discover, or Wells Fargo.'
      );
    }
  }

  // ─── Bulk Upload ─────────────────────────────────────────────────────────────

  /**
   * Processes multiple PDF files sequentially, then shows a combined review screen.
   * All transactions from all files are merged into one review list for the user to
   * inspect and edit before saving.
   * @param {File[]} files
   */
  async function handleBulkFiles(files) {
    if (!files || files.length === 0) return;

    showState('parsing');
    const statusEl = el('parsing-status');
    const progressFill = document.querySelector('#upload-parsing .progress-bar-fill');

    const allTransactions = [];
    const parseErrors = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const pct = Math.round(((i) / files.length) * 100);

      if (statusEl) statusEl.textContent = `Parsing ${i + 1} of ${files.length}: ${file.name}…`;
      if (progressFill) progressFill.style.width = pct + '%';

      try {
        const result = await PDFParser.parseStatement(file);

        if (!result || result.bank === 'unknown' || result.transactions.length === 0) {
          parseErrors.push(file.name + ': could not identify bank or no transactions found');
          continue;
        }

        allTransactions.push(...result.transactions);
        console.log('[UploadScreen] Bulk: parsed', result.transactions.length, 'from', file.name);

      } catch (err) {
        parseErrors.push(file.name + ': ' + err.message);
        console.error('[UploadScreen] Bulk: failed to parse', file.name, err);
      }
    }

    if (progressFill) progressFill.style.width = '100%';
    if (statusEl) statusEl.textContent = 'Ready to review…';

    // Reset file input
    const fi = el('pdf-file-input');
    if (fi) fi.value = '';

    await new Promise(r => setTimeout(r, 300));

    if (allTransactions.length === 0) {
      showState('idle');
      showUploadError('❌ None of the selected PDFs could be parsed. Make sure they are statements from Ally, Capital One, Bilt, Discover, or Wells Fargo.');
      return;
    }

    // Build a synthetic ParseResult combining all files
    const bulkResult = {
      bank: 'bulk',
      accountId: 'multiple',
      accountType: 'mixed',
      statementMonth: allTransactions[0] ? allTransactions[0].monthKey : '',
      transactions: allTransactions,
      parseErrors: parseErrors,
      parsedCount: allTransactions.length,
      confidence: 1,
    };

    // Show the review screen with all transactions combined
    currentParseResult = bulkResult;
    pendingTransactions = allTransactions.slice();
    currentFilter = 'all';

    // Update review summary to show bulk info
    const summaryEl = el('review-summary');
    if (summaryEl) {
      const failNote = parseErrors.length > 0
        ? ` <span style="color:var(--warning);">(${parseErrors.length} file(s) failed)</span>`
        : '';
      summaryEl.innerHTML = `
        <strong>${files.length} statements</strong> parsed —
        <strong>${allTransactions.length} transactions</strong> found${failNote}
      `;
    }

    renderReviewList(bulkResult);
    showState('review');
  }

  // ─── Error Display ───────────────────────────────────────────────────────────

  function showUploadError(message) {
    const zone = el('upload-zone');
    if (!zone) return;

    // Remove existing error
    const existing = zone.querySelector('.upload-error-msg');
    if (existing) existing.remove();

    const errEl = document.createElement('p');
    errEl.className = 'upload-error-msg';
    errEl.style.cssText = 'color: var(--danger); font-size: 13px; margin-top: 12px; font-weight: 500;';
    errEl.textContent = message;
    zone.appendChild(errEl);

    // Also reset the file input so the same file can be re-selected
    const fileInput = el('pdf-file-input');
    if (fileInput) fileInput.value = '';
  }

  function clearUploadError() {
    const zone = el('upload-zone');
    if (!zone) return;
    const existing = zone.querySelector('.upload-error-msg');
    if (existing) existing.remove();
  }

  // ─── Review List Rendering ───────────────────────────────────────────────────

  /**
   * Formats a date string 'YYYY-MM-DD' into a display label like 'Feb 15'.
   * @param {string} dateStr
   * @returns {string}
   */
  function formatDateLabel(dateStr) {
    if (!dateStr) return 'Unknown Date';
    try {
      // Parse as local date to avoid timezone shifts
      const [year, month, day] = dateStr.split('-').map(Number);
      const d = new Date(year, month - 1, day);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch (e) {
      return dateStr;
    }
  }

  /**
   * Formats a date string 'YYYY-MM-DD' into a full label like 'February 15, 2026'.
   * @param {string} dateStr
   * @returns {string}
   */
  function formatDateFull(dateStr) {
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
   * Formats an amount for display: +$1,234.56 (green) or -$47.99 (red).
   * @param {number} amount
   * @returns {{ text: string, className: string }}
   */
  function formatAmount(amount, isTransfer) {
    const abs = Math.abs(amount);
    const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (isTransfer) {
      return { text: '~$' + formatted, className: 'amount-transfer' };
    }
    if (amount >= 0) {
      return { text: '+$' + formatted, className: 'amount-positive' };
    } else {
      return { text: '-$' + formatted, className: 'amount-negative' };
    }
  }

  /**
   * Returns the category emoji for a given categoryId.
   * Falls back to '📦' if not found.
   * @param {string} categoryId
   * @returns {string}
   */
  function getCategoryEmoji(categoryId) {
    const emojiMap = {
      food:          '🍔',
      groceries:     '🛒',
      transport:     '🚗',
      shopping:      '🛍️',
      subscriptions: '📺',
      health:        '💊',
      travel:        '✈️',
      housing:       '🏠',
      entertainment: '🎬',
      utilities:     '💡',
      income:        '💰',
      transfer:      '🔄',
      other:         '📦',
      uncategorized: '📦',
    };
    return emojiMap[categoryId] || '📦';
  }

  /**
   * Returns the display name for a category ID.
   * @param {string} categoryId
   * @returns {string}
   */
  function getCategoryName(categoryId) {
    const nameMap = {
      food:          'Food & Dining',
      groceries:     'Groceries',
      transport:     'Transport',
      shopping:      'Shopping',
      subscriptions: 'Subscriptions',
      health:        'Health & Medical',
      travel:        'Travel',
      housing:       'Housing & Rent',
      entertainment: 'Entertainment',
      utilities:     'Utilities',
      income:        'Income',
      transfer:      'Transfer',
      other:         'Other',
      uncategorized: 'Uncategorized',
    };
    return nameMap[categoryId] || categoryId;
  }

  /**
   * Renders the transaction review list, grouped by date.
   * @param {object} parseResult
   */
  function renderReviewList(parseResult) {
    // Update summary header
    const summaryEl = el('review-summary');
    if (summaryEl) {
      const bankNames = {
        'ally':         'Ally Bank',
        'capital-one':  'Capital One',
        'bilt':         'Bilt Obsidian',
        'discover':     'Discover It',
        'wells-fargo':  'Wells Fargo',
      };
      const bankName = bankNames[parseResult.bank] || parseResult.bank;

      // Format month label from monthKey e.g. "2026-02" → "February 2026"
      let monthLabel = '';
      if (parseResult.statementMonth) {
        try {
          const [y, m] = parseResult.statementMonth.split('-').map(Number);
          const d = new Date(y, m - 1, 1);
          monthLabel = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        } catch (e) {
          monthLabel = parseResult.statementMonth;
        }
      }

      summaryEl.innerHTML =
        '<span style="font-size:20px;">✅</span> ' +
        '<div>' +
          '<div style="font-weight:700;font-size:16px;color:var(--text-primary);">' +
            bankName + (monthLabel ? ' — ' + monthLabel : '') +
          '</div>' +
          '<div style="font-size:13px;color:var(--text-secondary);margin-top:2px;">' +
            pendingTransactions.length + ' transaction' + (pendingTransactions.length !== 1 ? 's' : '') + ' found' +
          '</div>' +
        '</div>';
    }

    // Update save button text
    updateSaveButton();

    // Render the list
    _renderFilteredList();
  }

  /**
   * Renders the filtered transaction list into #review-transaction-list.
   */
  function _renderFilteredList() {
    const listEl = el('review-transaction-list');
    if (!listEl) return;

    // Apply filter
    let filtered = pendingTransactions;
    if (currentFilter === 'income') {
      filtered = pendingTransactions.filter(t => t.amount > 0 && t.categoryId !== 'transfer');
    } else if (currentFilter === 'expense') {
      filtered = pendingTransactions.filter(t => t.amount <= 0 && t.categoryId !== 'transfer');
    } else if (currentFilter === 'transfer') {
      filtered = pendingTransactions.filter(t => t.categoryId === 'transfer');
    }

    // Count uncategorized
    const uncatCount = pendingTransactions.filter(
      t => t.categoryId === 'other' || t.categoryId === 'uncategorized'
    ).length;

    // Show/hide warning banner
    const warningEl = el('uncategorized-warning');
    if (warningEl) {
      if (uncatCount > 0) {
        warningEl.style.display = '';
        warningEl.innerHTML =
          '<span>⚠️</span> ' +
          '<span>' + uncatCount + ' transaction' + (uncatCount !== 1 ? 's' : '') +
          ' need a category — tap Edit to fix</span>';
      } else {
        warningEl.style.display = 'none';
      }
    }

    if (filtered.length === 0) {
      listEl.innerHTML =
        '<div style="text-align:center;padding:32px 16px;color:var(--text-secondary);font-size:14px;">' +
        'No transactions match this filter.</div>';
      return;
    }

    // Sort by date descending (most recent first)
    const sorted = filtered.slice().sort(function (a, b) {
      return (b.date || '').localeCompare(a.date || '');
    });

    // Group by date
    const groups = {};
    const groupOrder = [];
    sorted.forEach(function (txn) {
      const dateKey = txn.date || 'Unknown';
      if (!groups[dateKey]) {
        groups[dateKey] = [];
        groupOrder.push(dateKey);
      }
      groups[dateKey].push(txn);
    });

    // Build HTML using a document fragment for performance
    const fragment = document.createDocumentFragment();

    groupOrder.forEach(function (dateKey) {
      // Date group header
      const header = document.createElement('div');
      header.className = 'date-group-header';
      header.textContent = formatDateLabel(dateKey);
      fragment.appendChild(header);

      // Transactions in this group
      groups[dateKey].forEach(function (txn) {
        // Find the real index in pendingTransactions for editing
        const realIndex = pendingTransactions.indexOf(txn);
        const isTransfer = txn.categoryId === 'transfer';
        const isUncategorized = txn.categoryId === 'other' || txn.categoryId === 'uncategorized';
        const amtInfo = formatAmount(txn.amount, isTransfer);
        const emoji = getCategoryEmoji(txn.categoryId);
        const catName = getCategoryName(txn.categoryId);

        const isHighCost = !txn.isIncome && !isTransfer && Math.abs(txn.amount) >= 150;
        const highCostBadge = isHighCost ? '<span class="high-cost-badge">⚠️ High</span>' : '';

        const item = document.createElement('div');
        item.className = 'review-txn-item' +
          (isUncategorized ? ' uncategorized' : '') +
          (isHighCost ? ' high-cost' : '') +
          (isTransfer ? ' txn-transfer' : '');
        item.innerHTML =
          '<div style="width:40px;height:40px;border-radius:10px;background:var(--bg-secondary);' +
          'display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;' +
          (isTransfer ? 'opacity:0.6;' : '') + '">' +
            emoji +
          '</div>' +
          '<div style="flex:1;min-width:0;">' +
            '<div class="review-txn-merchant"' + (isTransfer ? ' style="color:var(--text-secondary);"' : '') + '>' + _escapeHtml(txn.merchantName || txn.description || 'Unknown') + '</div>' +
            '<div class="review-txn-category">' + catName + '</div>' +
          '</div>' +
          '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0;">' +
            '<span class="review-txn-amount ' + amtInfo.className + '">' + amtInfo.text + highCostBadge + '</span>' +
            '<button class="review-txn-edit" data-index="' + realIndex + '" aria-label="Edit transaction">Edit</button>' +
          '</div>';

        fragment.appendChild(item);
      });
    });

    listEl.innerHTML = '';
    listEl.appendChild(fragment);

    // Wire up edit buttons (event delegation would also work but direct is fine for <200 items)
    listEl.querySelectorAll('.review-txn-edit').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const idx = parseInt(btn.getAttribute('data-index'), 10);
        openEditSheet(idx);
      });
    });
  }

  /**
   * Updates the save button text with the current transaction count.
   */
  function updateSaveButton() {
    const text = 'Save ' + pendingTransactions.length + ' Transaction' +
      (pendingTransactions.length !== 1 ? 's' : '');
    const saveBtn = el('save-btn');
    if (saveBtn) saveBtn.textContent = text;
    // Also update the fixed save bar button
    const saveBarSave = el('save-bar-save');
    if (saveBarSave) saveBarSave.textContent = text;
  }

  // ─── Edit Bottom Sheet ───────────────────────────────────────────────────────

  /**
   * Opens the edit bottom sheet for a specific transaction.
   * @param {number} index - Index in pendingTransactions
   */
  async function openEditSheet(index) {
    if (index < 0 || index >= pendingTransactions.length) return;

    editingIndex = index;
    const txn = pendingTransactions[index];

    // Populate form fields
    const nameInput   = el('edit-merchant-name');
    const amountInput = el('edit-amount');
    const dateInput   = el('edit-date');
    const notesInput  = el('edit-notes');

    if (nameInput)   nameInput.value   = txn.merchantName || txn.description || '';
    if (amountInput) amountInput.value = Math.abs(txn.amount).toFixed(2);
    if (dateInput)   dateInput.value   = formatDateFull(txn.date);
    if (notesInput)  notesInput.value  = txn.notes || '';

    // Set income/expense radio
    _setAmountType(txn.amount >= 0 ? 'income' : 'expense');

    // Populate category dropdown
    await _populateCategoryDropdown(txn.categoryId);

    // Show the sheet
    const backdrop = el('edit-sheet-backdrop');
    const panel    = el('edit-sheet-panel');
    if (backdrop) backdrop.classList.add('active');
    if (panel)    panel.classList.add('active');

    // Focus the merchant name input for accessibility
    setTimeout(function () {
      if (nameInput) nameInput.focus();
    }, 350);
  }

  /**
   * Sets the income/expense radio button state.
   * @param {'income'|'expense'} type
   */
  function _setAmountType(type) {
    const incomeOpt  = el('edit-type-income');
    const expenseOpt = el('edit-type-expense');
    if (!incomeOpt || !expenseOpt) return;

    incomeOpt.classList.remove('selected-income', 'selected-expense');
    expenseOpt.classList.remove('selected-income', 'selected-expense');

    if (type === 'income') {
      incomeOpt.classList.add('selected-income');
      incomeOpt.setAttribute('data-selected', 'true');
      expenseOpt.removeAttribute('data-selected');
    } else {
      expenseOpt.classList.add('selected-expense');
      expenseOpt.setAttribute('data-selected', 'true');
      incomeOpt.removeAttribute('data-selected');
    }
  }

  /**
   * Populates the category dropdown from FinanceDB.
   * @param {string} selectedId - Currently selected category ID
   */
  async function _populateCategoryDropdown(selectedId) {
    const select = el('edit-category-select');
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

      // If selectedId not found, default to 'other'
      if (!select.value && categories.length > 0) {
        const otherOpt = select.querySelector('option[value="other"]');
        if (otherOpt) otherOpt.selected = true;
      }
    } catch (err) {
      console.error('[UploadScreen] Failed to load categories:', err);
      // Fallback: add a basic set
      select.innerHTML =
        '<option value="food">🍔 Food & Dining</option>' +
        '<option value="groceries">🛒 Groceries</option>' +
        '<option value="transport">🚗 Transport</option>' +
        '<option value="shopping">🛍️ Shopping</option>' +
        '<option value="subscriptions">📺 Subscriptions</option>' +
        '<option value="health">💊 Health & Medical</option>' +
        '<option value="travel">✈️ Travel</option>' +
        '<option value="housing">🏠 Housing & Rent</option>' +
        '<option value="entertainment">🎬 Entertainment</option>' +
        '<option value="utilities">💡 Utilities</option>' +
        '<option value="income">💰 Income</option>' +
        '<option value="transfer">🔄 Transfer</option>' +
        '<option value="other">📦 Other</option>';
      const opt = select.querySelector('option[value="' + selectedId + '"]');
      if (opt) opt.selected = true;
    }
  }

  /**
   * Closes the edit bottom sheet without saving.
   */
  function closeEditSheet() {
    const backdrop = el('edit-sheet-backdrop');
    const panel    = el('edit-sheet-panel');
    if (backdrop) backdrop.classList.remove('active');
    if (panel)    panel.classList.remove('active');
    editingIndex = -1;
  }

  /**
   * Saves the edited transaction back to pendingTransactions and re-renders.
   */
  async function saveEdit() {
    if (editingIndex < 0 || editingIndex >= pendingTransactions.length) {
      closeEditSheet();
      return;
    }

    const nameInput   = el('edit-merchant-name');
    const amountInput = el('edit-amount');
    const dateInput   = el('edit-date');
    const notesInput  = el('edit-notes');
    const catSelect   = el('edit-category-select');
    const incomeOpt   = el('edit-type-income');

    const merchantName = nameInput   ? nameInput.value.trim()   : '';
    const amountRaw    = amountInput ? parseFloat(amountInput.value) : 0;
    const dateRaw      = dateInput   ? dateInput.value.trim()   : '';
    const notes        = notesInput  ? notesInput.value.trim()  : '';
    const categoryId   = catSelect   ? catSelect.value          : 'other';
    const isIncome     = incomeOpt   ? incomeOpt.hasAttribute('data-selected') : false;

    // Validate amount
    if (isNaN(amountRaw) || amountRaw < 0) {
      // Highlight the field
      if (amountInput) {
        amountInput.style.borderColor = 'var(--danger)';
        setTimeout(function () { amountInput.style.borderColor = ''; }, 2000);
      }
      return;
    }

    // Parse the date back to YYYY-MM-DD
    let parsedDate = pendingTransactions[editingIndex].date; // keep original if parse fails
    try {
      const d = new Date(dateRaw);
      if (!isNaN(d.getTime())) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        parsedDate = y + '-' + m + '-' + day;
      }
    } catch (e) { /* keep original */ }

    const storedAmount = isIncome ? Math.abs(amountRaw) : -Math.abs(amountRaw);
    const monthKey = parsedDate ? parsedDate.slice(0, 7) : '';

    // Capture original category BEFORE updating (for merchant rule comparison)
    const _origCatId = pendingTransactions[editingIndex]
      ? pendingTransactions[editingIndex].categoryId
      : null;

    // Update the transaction in place
    pendingTransactions[editingIndex] = Object.assign(
      {},
      pendingTransactions[editingIndex],
      {
        merchantName:      merchantName || pendingTransactions[editingIndex].merchantName,
        amount:            storedAmount,
        date:              parsedDate,
        monthKey:          monthKey,
        categoryId:        categoryId,
        notes:             notes,
        isIncome:          isIncome,
        isManuallyEdited:  true,
      }
    );

    closeEditSheet();

    // Re-render the list
    _renderFilteredList();
    updateSaveButton();

    // ── Merchant rule: save category for future imports ───────────────────
    if (merchantName && categoryId && _origCatId !== categoryId) {
      try {
        // Save rule for future imports
        await FinanceDB.saveMerchantCategoryRule(merchantName, categoryId);

        // Also update other pending transactions from the same vendor in this review
        const sameVendorInReview = pendingTransactions.filter(function (t, i) {
          return i !== editingIndex &&
                 (t.merchantName || '').toLowerCase().trim() === merchantName.toLowerCase().trim() &&
                 t.categoryId !== categoryId;
        });

        if (sameVendorInReview.length > 0) {
          const catNameMap = {
            food: 'Food & Dining', groceries: 'Groceries', transport: 'Transport',
            shopping: 'Shopping', subscriptions: 'Subscriptions', health: 'Health & Medical',
            travel: 'Travel', housing: 'Housing & Rent', entertainment: 'Entertainment',
            utilities: 'Utilities', income: 'Income', transfer: 'Transfer', other: 'Other',
          };
          const catName = catNameMap[categoryId] || categoryId;
          const confirmed = window.confirm(
            '📌 Update all "' + merchantName + '" in this import?\n\n' +
            'Found ' + sameVendorInReview.length + ' other transaction' +
            (sameVendorInReview.length !== 1 ? 's' : '') +
            ' from this vendor in this statement.\n\n' +
            'Change all to "' + catName + '"?'
          );
          if (confirmed) {
            pendingTransactions.forEach(function (t, i) {
              if (i !== editingIndex &&
                  (t.merchantName || '').toLowerCase().trim() === merchantName.toLowerCase().trim()) {
                pendingTransactions[i] = Object.assign({}, t, {
                  categoryId:       categoryId,
                  isManuallyEdited: true,
                });
              }
            });
            _renderFilteredList();
            updateSaveButton();
          }
        }
      } catch (err) {
        console.warn('[UploadScreen] Merchant rule save failed (non-fatal):', err);
      }
    }
  }

  // ─── Save All Transactions ───────────────────────────────────────────────────

  /**
   * Saves all pending transactions to IndexedDB, shows a toast, and navigates away.
   */
  async function saveAllTransactions() {
    if (pendingTransactions.length === 0) return;

    // ── Duplicate detection ──────────────────────────────────────────────────
    // Check if any month+account combination already has data in the DB.
    // This prevents accidentally importing the same statement twice.
    try {
      const monthsWithData = await FinanceDB.getMonthsWithData();
      const existingMonths = new Set(monthsWithData);

      // Collect unique month+account combos from pending transactions
      const pendingCombos = new Set();
      pendingTransactions.forEach(function (t) {
        if (t.monthKey && t.accountId) {
          pendingCombos.add(t.monthKey + '|' + t.accountId);
        }
      });

      // Check each combo against existing data
      const duplicates = [];
      for (const combo of pendingCombos) {
        const [monthKey, accountId] = combo.split('|');
        if (existingMonths.has(monthKey)) {
          // Check if this specific account already has transactions in this month
          try {
            const existing = await FinanceDB.getTransactionsByMonth(monthKey);
            const hasAccount = existing.some(function (t) { return t.accountId === accountId; });
            if (hasAccount) {
              duplicates.push({ monthKey: monthKey, accountId: accountId });
            }
          } catch (e) { /* ignore */ }
        }
      }

      if (duplicates.length > 0) {
        // Format duplicate info for the warning
        const dupLabels = duplicates.map(function (d) {
          try {
            const [y, m] = d.monthKey.split('-').map(Number);
            const date = new Date(y, m - 1, 1);
            const monthLabel = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            return monthLabel;
          } catch (e) { return d.monthKey; }
        });
        const uniqueLabels = [...new Set(dupLabels)];
        const confirmed = window.confirm(
          '⚠️ Duplicate Statement Detected\n\n' +
          'It looks like you\'ve already imported data for: ' + uniqueLabels.join(', ') + '.\n\n' +
          'Importing again will add duplicate transactions.\n\n' +
          'Continue anyway?'
        );
        if (!confirmed) {
          return; // User cancelled — don't save
        }
      }
    } catch (err) {
      console.warn('[UploadScreen] Duplicate check failed (non-fatal):', err);
      // Continue with save even if duplicate check fails
    }

    const saveBtn = el('save-btn');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
    }

    try {
      await FinanceDB.addTransactions(pendingTransactions);

      // Save ending balance if the parser extracted one
      if (currentParseResult &&
          currentParseResult.endingBalance !== null &&
          currentParseResult.endingBalance !== undefined &&
          currentParseResult.accountId &&
          currentParseResult.accountId !== 'multiple') {
        await FinanceDB.saveAccountBalance(
          currentParseResult.accountId,
          currentParseResult.endingBalance,
          currentParseResult.statementMonth || ''
        );
      }

      const count = pendingTransactions.length;
      showToast('✅ ' + count + ' transaction' + (count !== 1 ? 's' : '') + ' saved!');

      // Reset state
      pendingTransactions = [];
      currentParseResult = null;

      // Reload recent uploads
      await loadRecentUploads();

      // Navigate to dashboard after 1.5 seconds and re-initialize it
      setTimeout(function () {
        navigateTo('dashboard');
        showState('idle');
        // Re-initialize dashboard so it shows the newly uploaded data
        if (typeof DashboardScreen !== 'undefined' && DashboardScreen.init) {
          DashboardScreen.init().catch(function () {});
        }
        // Also call the global onScreenActivated if available
        if (typeof onScreenActivated === 'function') {
          onScreenActivated('dashboard');
        }
      }, 1500);

    } catch (err) {
      console.error('[UploadScreen] saveAllTransactions failed:', err);
      showToast('❌ Save failed. Please try again.');
      if (saveBtn) {
        saveBtn.disabled = false;
        updateSaveButton();
      }
    }
  }

  // ─── Toast Notification ──────────────────────────────────────────────────────

  /**
   * Shows a brief toast notification.
   * @param {string} message
   * @param {number} [duration=3000]
   */
  function showToast(message, duration) {
    duration = duration || 3000;
    let toast = el('upload-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'upload-toast';
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(function () {
      toast.classList.remove('show');
    }, duration);
  }

  // ─── Recent Uploads ──────────────────────────────────────────────────────────

  /**
   * Loads recent upload history from DB and renders it in the idle state.
   */
  async function loadRecentUploads() {
    const listEl = el('recent-uploads-list');
    if (!listEl) return;

    try {
      // Get all monthly summaries (each represents an import)
      const summaries = await FinanceDB.getAllMonthlySummaries();

      if (!summaries || summaries.length === 0) {
        listEl.innerHTML =
          '<p style="font-size:13px;color:var(--text-secondary);text-align:center;padding:16px 0;">' +
          'No uploads yet. Upload your first statement above.</p>';
        return;
      }

      // Show last 5, most recent first
      const recent = summaries.slice().reverse().slice(0, 5);

      // Get accounts for display names
      let accounts = [];
      try {
        accounts = await FinanceDB.getAccounts();
      } catch (e) { /* ignore */ }

      const accountMap = {};
      accounts.forEach(function (a) { accountMap[a.id] = a; });

      const fragment = document.createDocumentFragment();

      recent.forEach(function (summary) {
        // Format month label
        let monthLabel = summary.monthKey;
        try {
          const [y, m] = summary.monthKey.split('-').map(Number);
          const d = new Date(y, m - 1, 1);
          monthLabel = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        } catch (e) { /* keep raw */ }

        // Determine account name from breakdown
        let accountName = 'Statement';
        const accountIds = Object.keys(summary.accountBreakdown || {});
        if (accountIds.length > 0 && accountMap[accountIds[0]]) {
          accountName = accountMap[accountIds[0]].name;
        }

        const item = document.createElement('div');
        item.className = 'recent-upload-item';
        item.innerHTML =
          '<div class="recent-upload-icon">📄</div>' +
          '<div class="recent-upload-info">' +
            '<div class="recent-upload-name">' + _escapeHtml(accountName) + '</div>' +
            '<div class="recent-upload-meta">' +
              monthLabel + ' · ' + summary.transactionCount + ' transaction' +
              (summary.transactionCount !== 1 ? 's' : '') +
            '</div>' +
          '</div>' +
          '<button class="recent-upload-view" data-month="' + summary.monthKey + '" ' +
          'aria-label="View ' + monthLabel + ' transactions">View</button>';

        fragment.appendChild(item);
      });

      listEl.innerHTML = '';
      listEl.appendChild(fragment);

      // Wire up View buttons
      listEl.querySelectorAll('.recent-upload-view').forEach(function (btn) {
        btn.addEventListener('click', function () {
          const monthKey = btn.getAttribute('data-month');
          // Navigate to transactions screen with the month pre-selected
          navigateTo('transactions', monthKey ? { monthKey: monthKey } : {});
          if (typeof onScreenActivated === 'function') {
            onScreenActivated('transactions', monthKey ? { monthKey: monthKey } : {});
          }
        });
      });

    } catch (err) {
      console.error('[UploadScreen] loadRecentUploads failed:', err);
      listEl.innerHTML =
        '<p style="font-size:13px;color:var(--text-secondary);padding:8px 0;">Could not load recent uploads.</p>';
    }
  }

  // ─── Filter Buttons ──────────────────────────────────────────────────────────

  /**
   * Sets the active filter and re-renders the list.
   * @param {'all'|'income'|'expense'} filter
   */
  function setFilter(filter) {
    currentFilter = filter;

    // Update button active states
    ['all', 'income', 'expense', 'transfer'].forEach(function (f) {
      const btn = el('filter-btn-' + f);
      if (btn) {
        if (f === filter) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      }
    });

    _renderFilteredList();
  }

  // ─── Utility ─────────────────────────────────────────────────────────────────

  /**
   * Escapes HTML special characters to prevent XSS.
   * @param {string} str
   * @returns {string}
   */
  function _escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ─── Bottom Sheet Injection ──────────────────────────────────────────────────

  /**
   * Injects the edit bottom sheet into document.body (outside any transformed
   * ancestor) so that position:fixed works correctly on all browsers.
   * Safe to call multiple times — checks for existing element first.
   */
  function _ensureBottomSheet() {
    if (el('edit-sheet-backdrop')) return; // already injected

    // ── Fixed save bar (Fix 1) ──────────────────────────────────────────────
    // Injected into body so position:fixed works correctly on iOS Safari.
    if (!el('upload-save-bar-fixed')) {
      const saveBar = document.createElement('div');
      saveBar.id = 'upload-save-bar-fixed';
      saveBar.style.cssText = `
        display: none;
        position: fixed;
        bottom: calc(56px + 12px + env(safe-area-inset-bottom));
        left: 50%;
        transform: translateX(-50%);
        width: 100%;
        max-width: var(--app-max-width, 430px);
        padding: 12px 20px;
        background: var(--bg-primary);
        border-top: 0.5px solid var(--border);
        border-radius: 16px 16px 0 0;
        box-shadow: 0 -4px 20px rgba(0,0,0,0.08);
        gap: 12px;
        z-index: 40;
        align-items: center;
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
      `;
      saveBar.innerHTML =
        '<button id="save-bar-cancel" class="btn btn-ghost" style="flex:1;" aria-label="Cancel">Cancel</button>' +
        '<button id="save-bar-save" class="btn btn-primary" style="flex:2;" aria-label="Save transactions">Save Transactions</button>';
      document.body.appendChild(saveBar);
    }

    const html =
      '<div id="edit-sheet-backdrop" class="bottom-sheet-backdrop" aria-hidden="true"></div>' +
      '<div id="edit-sheet-panel" class="bottom-sheet-panel" role="dialog" aria-modal="true" aria-labelledby="edit-sheet-title">' +
        '<div class="bottom-sheet-handle" aria-hidden="true"></div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">' +
          '<h2 id="edit-sheet-title" style="font-size:18px;font-weight:700;color:var(--text-primary);margin:0;">Edit Transaction</h2>' +
          '<button id="edit-sheet-close" class="btn-icon" aria-label="Close edit sheet" style="font-size:20px;padding:6px;">✕</button>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label" for="edit-merchant-name">Merchant Name</label>' +
          '<input type="text" id="edit-merchant-name" class="form-input" placeholder="e.g. Netflix" autocomplete="off" autocorrect="off" spellcheck="false">' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label" for="edit-amount">Amount</label>' +
          '<div style="position:relative;margin-bottom:10px;">' +
            '<span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);font-size:15px;color:var(--text-secondary);pointer-events:none;">$</span>' +
            '<input type="number" id="edit-amount" class="form-input" placeholder="0.00" min="0" step="0.01" style="padding-left:28px;" inputmode="decimal">' +
          '</div>' +
          '<div class="radio-group">' +
            '<div id="edit-type-expense" class="radio-option selected-expense" role="radio" aria-checked="true" tabindex="0">💸 Expense</div>' +
            '<div id="edit-type-income" class="radio-option" role="radio" aria-checked="false" tabindex="0">💰 Income</div>' +
          '</div>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label" for="edit-date">Date</label>' +
          '<input type="text" id="edit-date" class="form-input" placeholder="e.g. February 15, 2026" autocomplete="off">' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label" for="edit-category-select">Category</label>' +
          '<div style="position:relative;">' +
            '<select id="edit-category-select" class="form-select"><option value="other">📦 Other</option></select>' +
            '<span style="position:absolute;right:14px;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--text-secondary);font-size:12px;">▼</span>' +
          '</div>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label" for="edit-notes">Notes <span style="font-weight:400;opacity:0.7;">(optional)</span></label>' +
          '<input type="text" id="edit-notes" class="form-input" placeholder="Add a note…" autocomplete="off">' +
        '</div>' +
        '<div style="display:flex;gap:12px;margin-top:8px;">' +
          '<button id="edit-sheet-cancel" class="btn btn-ghost" style="flex:1;" aria-label="Cancel edit">Cancel</button>' +
          '<button id="edit-sheet-save" class="btn btn-primary" style="flex:2;" aria-label="Save transaction edit">Save ✅</button>' +
        '</div>' +
      '</div>';

    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    while (wrapper.firstChild) {
      document.body.appendChild(wrapper.firstChild);
    }
  }

  // ─── Initialization ──────────────────────────────────────────────────────────

  /**
   * Initializes the upload screen.
   * Called by app.js whenever the upload screen becomes active.
   */
  async function init() {
    console.log('[UploadScreen] init()');

    // Inject bottom sheet into body (outside transformed ancestors)
    _ensureBottomSheet();

    // Ensure we start in idle state
    showState('idle');

    // ── Wire up file input ──────────────────────────────────────────────────
    const uploadZone = el('upload-zone');
    const fileInput  = el('pdf-file-input');

    if (uploadZone && fileInput) {
      // Remove old listeners by cloning (safe re-init)
      const newZone = uploadZone.cloneNode(true);
      uploadZone.parentNode.replaceChild(newZone, uploadZone);
      const newInput = el('pdf-file-input'); // re-query after clone

      // Tap/click on zone triggers file picker
      newZone.addEventListener('click', function (e) {
        // Don't trigger if clicking the error message
        if (e.target.classList.contains('upload-error-msg')) return;
        if (newInput) newInput.click();
      });

      // Keyboard accessibility
      newZone.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (newInput) newInput.click();
        }
      });

      // Drag and drop support
      newZone.addEventListener('dragover', function (e) {
        e.preventDefault();
        newZone.classList.add('drag-over');
      });
      newZone.addEventListener('dragleave', function () {
        newZone.classList.remove('drag-over');
      });
      newZone.addEventListener('drop', function (e) {
        e.preventDefault();
        newZone.classList.remove('drag-over');
        const files = e.dataTransfer && e.dataTransfer.files;
        if (files && files.length > 1) {
          handleBulkFiles(Array.from(files));
        } else if (files && files.length === 1) {
          handleFileSelect(files[0]);
        }
      });

      // File input change — supports single or multiple files
      if (newInput) {
        newInput.addEventListener('change', function () {
          if (newInput.files && newInput.files.length > 1) {
            handleBulkFiles(Array.from(newInput.files));
          } else if (newInput.files && newInput.files.length === 1) {
            handleFileSelect(newInput.files[0]);
          }
        });
      }
    }

    // ── Wire up back button ─────────────────────────────────────────────────
    const backBtn = el('upload-back-btn');
    if (backBtn) {
      backBtn.onclick = function () {
        pendingTransactions = [];
        currentParseResult = null;
        showState('idle');
        // Reset file input
        const fi = el('pdf-file-input');
        if (fi) fi.value = '';
      };
    }

    // ── Wire up filter buttons ──────────────────────────────────────────────
    ['all', 'income', 'expense', 'transfer'].forEach(function (f) {
      const btn = el('filter-btn-' + f);
      if (btn) {
        btn.onclick = function () { setFilter(f); };
      }
    });

    // ── Wire up fixed save bar (Fix 1) ──────────────────────────────────────
    const saveBarSave   = el('save-bar-save');
    const saveBarCancel = el('save-bar-cancel');
    if (saveBarSave)   saveBarSave.onclick   = saveAllTransactions;
    if (saveBarCancel) saveBarCancel.onclick = function () {
      pendingTransactions = [];
      currentParseResult = null;
      showState('idle');
      const fi = el('pdf-file-input');
      if (fi) fi.value = '';
    };

    // ── Wire up save button (in-page, kept for compatibility) ───────────────
    const saveBtn = el('save-btn');
    if (saveBtn) {
      saveBtn.onclick = saveAllTransactions;
    }

    // ── Wire up cancel button (in-page) ────────────────────────────────────
    const cancelBtn = el('review-cancel-btn');
    if (cancelBtn) {
      cancelBtn.onclick = function () {
        pendingTransactions = [];
        currentParseResult = null;
        showState('idle');
        const fi = el('pdf-file-input');
        if (fi) fi.value = '';
      };
    }

    // ── Wire up edit sheet close/cancel ────────────────────────────────────
    const sheetClose  = el('edit-sheet-close');
    const sheetCancel = el('edit-sheet-cancel');
    const backdrop    = el('edit-sheet-backdrop');

    if (sheetClose)  sheetClose.onclick  = closeEditSheet;
    if (sheetCancel) sheetCancel.onclick = closeEditSheet;
    if (backdrop)    backdrop.onclick    = closeEditSheet;

    // ── Swipe down to close edit sheet (Fix 4) ──────────────────────────────
    const panel = el('edit-sheet-panel');
    if (panel) {
      var touchStartY = 0;
      panel.addEventListener('touchstart', function (e) {
        touchStartY = e.touches[0].clientY;
      }, { passive: true });
      panel.addEventListener('touchend', function (e) {
        var dy = e.changedTouches[0].clientY - touchStartY;
        if (dy > 60) closeEditSheet(); // swipe down 60px+ closes sheet
      }, { passive: true });
    }

    // ── Wire up edit sheet save ─────────────────────────────────────────────
    const sheetSave = el('edit-sheet-save');
    if (sheetSave) sheetSave.onclick = saveEdit;

    // ── Wire up income/expense radio buttons ────────────────────────────────
    const incomeOpt  = el('edit-type-income');
    const expenseOpt = el('edit-type-expense');
    if (incomeOpt)  incomeOpt.onclick  = function () { _setAmountType('income'); };
    if (expenseOpt) expenseOpt.onclick = function () { _setAmountType('expense'); };

    // ── Load recent uploads ─────────────────────────────────────────────────
    await loadRecentUploads();

    console.log('[UploadScreen] init() complete ✅');
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  const UploadScreen = {
    init:                init,
    handleFileSelect:    handleFileSelect,
    renderReviewList:    renderReviewList,
    openEditSheet:       openEditSheet,
    saveEdit:            saveEdit,
    saveAllTransactions: saveAllTransactions,
    loadRecentUploads:   loadRecentUploads,
    showState:           showState,
    showToast:           showToast,
    isInReviewState:     isInReviewState,
  };

  global.UploadScreen = UploadScreen;

}(window));

console.log('[UploadScreen] upload.js loaded ✅');

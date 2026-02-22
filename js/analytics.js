/**
 * analytics.js — Analytics Screen Module
 *
 * Exposes a global `AnalyticsScreen` object that manages the fully functional
 * analytics screen: time range selector, overview card, income vs expenses
 * trend chart, category horizontal bar chart, savings rate chart, top merchants
 * ranked list, and a spending calendar heatmap.
 *
 * Dependencies (loaded before this script in index.html):
 *   - Chart.js (CDN)
 *   - db.js    → FinanceDB
 *   - router.js → navigateTo()
 *   - theme.js  → getCurrentTheme()
 */

(function (global) {
  'use strict';

  // ─── Private State ──────────────────────────────────────────────────────────

  /** @type {object[]} All monthly summaries from DB, sorted ascending */
  let _allSummaries = [];

  /** @type {object[]} All transactions from DB */
  let _allTransactions = [];

  /** @type {object[]} All categories from DB */
  let _allCategories = [];

  /** @type {number} Active time range in months (0 = all time) */
  let _activeRange = 6;

  /** @type {Chart|null} Income vs Expenses line chart */
  let _trendChart = null;

  /** @type {Chart|null} Category horizontal bar chart */
  let _categoryChart = null;

  /** @type {Chart|null} Savings rate bar chart */
  let _savingsChart = null;

  /** @type {number} Calendar year currently displayed */
  let _calendarYear = new Date().getFullYear();

  /** @type {number} Calendar month currently displayed (0-indexed) */
  let _calendarMonth = new Date().getMonth();

  /** @type {boolean} Prevents concurrent init calls */
  let _loading = false;

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Formats a number as a dollar amount with commas.
   * @param {number} amount
   * @returns {string}  e.g. "$5,200"
   */
  function formatCurrency(amount) {
    return '$' + Math.abs(amount).toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  }

  /**
   * Converts a monthKey like "2026-02" to a short label like "Feb".
   * @param {string} monthKey
   * @returns {string}
   */
  function monthKeyToShort(monthKey) {
    if (!monthKey) return '';
    const [year, month] = monthKey.split('-');
    const date = new Date(parseInt(year, 10), parseInt(month, 10) - 1, 1);
    return date.toLocaleDateString('en-US', { month: 'short' });
  }

  /**
   * Converts a monthKey like "2026-02" to a display label like "February 2026".
   * @param {string} monthKey
   * @returns {string}
   */
  function monthKeyToLabel(monthKey) {
    if (!monthKey) return '';
    const [year, month] = monthKey.split('-');
    const date = new Date(parseInt(year, 10), parseInt(month, 10) - 1, 1);
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  /**
   * Returns Chart.js-compatible explicit colors based on current theme.
   * Chart.js cannot read CSS variables directly.
   * @returns {{ gridColor: string, textColor: string }}
   */
  function getChartColors() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    return {
      gridColor: isDark ? '#2D2D4E' : '#E5E7EB',
      textColor: isDark ? '#94A3B8' : '#6B7280',
    };
  }

  /**
   * Builds a category lookup map from an array of category objects.
   * @param {object[]} categories
   * @returns {Object.<string, object>}
   */
  function buildCategoryMap(categories) {
    const map = {};
    categories.forEach(function (cat) {
      map[cat.id] = cat;
    });
    return map;
  }

  /**
   * Returns the cutoff monthKey for a given number of months back from now.
   * @param {number} months  0 = all time
   * @returns {string|null}  monthKey like "2025-08", or null for all time
   */
  function getCutoffMonthKey(range) {
    if (!range || range === 0) return null;
    const now = new Date();
    if (range === 'month') {
      // Current calendar month only
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      return y + '-' + m;
    }
    if (range === 'week') {
      // Last 7 days — return ISO date string for transaction date filtering
      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - 6);
      const y = cutoff.getFullYear();
      const m = String(cutoff.getMonth() + 1).padStart(2, '0');
      return y + '-' + m; // still use monthKey for summaries
    }
    // Numeric: number of months back
    const cutoff = new Date(now.getFullYear(), now.getMonth() - range + 1, 1);
    const y = cutoff.getFullYear();
    const m = String(cutoff.getMonth() + 1).padStart(2, '0');
    return y + '-' + m;
  }

  /** Returns a cutoff ISO date string (YYYY-MM-DD) for week filtering */
  function getCutoffDate(range) {
    if (range !== 'week') return null;
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - 6);
    return cutoff.toISOString().split('T')[0];
  }

  /**
   * Filters summaries to the active time range.
   * @param {object[]} summaries
   * @param {number|string} range  0 = all time, 'month' = current month, 'week' = last 7 days
   * @returns {object[]}
   */
  function filterSummaries(summaries, range) {
    const cutoff = getCutoffMonthKey(range);
    if (!cutoff) return summaries;
    return summaries.filter(function (s) { return s.monthKey >= cutoff; });
  }

  /**
   * Filters transactions to the active time range.
   * @param {object[]} transactions
   * @param {number|string} range
   * @returns {object[]}
   */
  function filterTransactions(transactions, range) {
    if (range === 'week') {
      // Filter by actual date for week view
      const cutoffDate = getCutoffDate(range);
      return transactions.filter(function (t) { return t.date && t.date >= cutoffDate; });
    }
    const cutoff = getCutoffMonthKey(range);
    if (!cutoff) return transactions;
    return transactions.filter(function (t) { return t.monthKey && t.monthKey >= cutoff; });
  }

  /**
   * Returns the color for a savings rate value.
   * @param {number} rate  percentage 0-100
   * @returns {string}
   */
  function getSavingsRateColor(rate) {
    if (rate >= 20) return '#10B981';
    if (rate >= 10) return '#F59E0B';
    return '#EF4444';
  }

  /**
   * Returns the CSS class for a savings badge.
   * @param {number} rate
   * @returns {string}
   */
  function getSavingsBadgeClass(rate) {
    if (rate >= 20) return 'good';
    if (rate >= 10) return 'ok';
    return 'bad';
  }

  /**
   * Returns the background color for a calendar day based on spend amount.
   * @param {number} amount
   * @returns {string}
   */
  function getDayColor(amount) {
    if (!amount || amount === 0) return 'var(--bg-secondary)';
    if (amount < 30)  return 'rgba(108,99,255,0.2)';
    if (amount < 75)  return 'rgba(108,99,255,0.4)';
    if (amount < 150) return 'rgba(108,99,255,0.65)';
    return 'rgba(239,68,68,0.7)';
  }

  // ─── DOM Helpers ────────────────────────────────────────────────────────────

  function el(id) {
    return document.getElementById(id);
  }

  function showEl(id) {
    const e = el(id);
    if (e) e.style.display = '';
  }

  function hideEl(id) {
    const e = el(id);
    if (e) e.style.display = 'none';
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  const AnalyticsScreen = {

    // ── init ──────────────────────────────────────────────────────────────────

    /**
     * Called when the analytics screen becomes active.
     * Loads all monthly summaries and transactions, renders with default range (6M).
     */
    init: async function () {
      // Use a generation counter instead of a boolean flag.
      // This allows re-entrant calls: if init() is called while a previous
      // init() is still running, the previous one will detect the generation
      // mismatch and abort, letting the new one complete.
      if (!AnalyticsScreen._generation) AnalyticsScreen._generation = 0;
      const myGeneration = ++AnalyticsScreen._generation;
      _loading = true;

      try {
        // Load all data in parallel
        let [summaries, transactions, categories] = await Promise.all([
          FinanceDB.getAllMonthlySummaries(),
          FinanceDB.getAllTransactions(),
          FinanceDB.getCategories(),
        ]);

        _allTransactions = transactions || [];
        _allCategories   = categories   || [];

        // If summaries are missing but transactions exist, recompute them
        if ((!summaries || summaries.length === 0) && _allTransactions.length > 0) {
          console.log('[AnalyticsScreen] Summaries missing — recomputing from transactions...');
          const monthKeys = [...new Set(_allTransactions.map(function (t) { return t.monthKey; }).filter(Boolean))];
          for (const mk of monthKeys) {
            await FinanceDB.recomputeMonthlySummary(mk);
          }
          summaries = await FinanceDB.getAllMonthlySummaries();
        }

        _allSummaries = summaries || [];

        if (_allSummaries.length === 0 && _allTransactions.length === 0) {
          AnalyticsScreen._showEmptyState();
          return;
        }

        // Show data, hide empty state
        hideEl('analytics-empty');
        showEl('analytics-data');

        // Update time range button UI
        AnalyticsScreen._updateRangeButtons(_activeRange);

        // iOS fix: after showing analytics-data, the browser needs time to
        // compute layout before canvas elements have non-zero dimensions.
        // The screen CSS transition takes ~250ms, so wait longer.
        await new Promise(function (resolve) { setTimeout(resolve, 350); });

        // If a newer init() call started while we were waiting, abort this one
        if (myGeneration !== AnalyticsScreen._generation) {
          console.log('[Analytics] init() aborted (superseded by newer call)');
          return;
        }

        // Also wait for Chart.js if not yet available
        let chartWaitMs = 0;
        while (typeof Chart === 'undefined' && chartWaitMs < 5000) {
          await new Promise(function (resolve) { setTimeout(resolve, 100); });
          chartWaitMs += 100;
        }

        // Render all sections with current range
        AnalyticsScreen.setTimeRange(_activeRange);

        // Default calendar to most recent month with data
        if (_allTransactions.length > 0) {
          const monthKeys = _allTransactions
            .map(function (t) { return t.monthKey; })
            .filter(Boolean)
            .sort();
          const latestKey = monthKeys[monthKeys.length - 1];
          if (latestKey) {
            const parts = latestKey.split('-');
            _calendarYear  = parseInt(parts[0], 10);
            _calendarMonth = parseInt(parts[1], 10) - 1;
          }
        }

        AnalyticsScreen.renderCalendar(_allTransactions, _calendarYear, _calendarMonth);

        // iOS safety net: re-render all charts after a delay.
        // Calls setTimeRange which has the correct fallback logic for empty ranges.
        const capturedGeneration = myGeneration;
        setTimeout(function () {
          if (capturedGeneration !== AnalyticsScreen._generation) return;
          const analyticsScreen = document.getElementById('screen-analytics');
          if (!analyticsScreen || !analyticsScreen.classList.contains('active')) return;
          console.log('[Analytics] Safety net: re-rendering via setTimeRange, allSummaries=', _allSummaries.length);
          AnalyticsScreen.setTimeRange(_activeRange);
        }, 800);

      } catch (err) {
        console.error('[AnalyticsScreen] init failed:', err);
      } finally {
        // Always reset loading so the next navigation can trigger init()
        _loading = false;
      }
    },

    // ── setTimeRange ──────────────────────────────────────────────────────────

    /**
     * Filters summaries to range, re-renders all charts.
     * @param {number} months  3 | 6 | 12 | 0 (all time)
     */
    setTimeRange: function (months) {
      _activeRange = months;
      AnalyticsScreen._updateRangeButtons(months);

      let filteredSummaries    = filterSummaries(_allSummaries, months);
      let filteredTransactions = filterTransactions(_allTransactions, months);
      const catMap             = buildCategoryMap(_allCategories);

      // If the selected range has no data but we have older data, show all available
      // (e.g. user has data from 2020 but selected 6M range from 2026)
      if (filteredSummaries.length === 0 && _allSummaries.length > 0 && months !== 0) {
        filteredSummaries    = _allSummaries;
        filteredTransactions = _allTransactions;
        console.log('[Analytics] No data in range', months, '— showing all', _allSummaries.length, 'months');
      }

      console.log('[Analytics] setTimeRange', months, 'summaries:', filteredSummaries.length, 'transactions:', filteredTransactions.length);

      AnalyticsScreen.renderOverviewCard(filteredSummaries);
      AnalyticsScreen.renderTrendChart(filteredSummaries);
      AnalyticsScreen.renderCategoryChart(filteredTransactions, _allCategories, catMap);
      AnalyticsScreen.renderSavingsRateChart(filteredSummaries);
      AnalyticsScreen.renderTopMerchants(filteredTransactions, catMap);
    },

    // ── renderOverviewCard ────────────────────────────────────────────────────

    /**
     * Computes totals, averages, savings rate and updates the overview card.
     * @param {object[]} summaries
     */
    renderOverviewCard: function (summaries) {
      const container = el('analytics-overview');
      if (!container) return;

      if (!summaries || summaries.length === 0) {
        container.innerHTML = '<p style="color:var(--text-secondary);font-size:14px;text-align:center;padding:16px 0;">No data for this period</p>';
        return;
      }

      const totalIncome   = summaries.reduce(function (s, m) { return s + (m.totalIncome   || 0); }, 0);
      const totalExpenses = summaries.reduce(function (s, m) { return s + (m.totalExpenses || 0); }, 0);
      const netSaved      = totalIncome - totalExpenses;
      const months        = summaries.length;
      const avgIncome     = months > 0 ? totalIncome   / months : 0;
      const avgSpend      = months > 0 ? totalExpenses / months : 0;
      const savingsRate   = totalIncome > 0 ? Math.round((netSaved / totalIncome) * 100) : 0;
      const badgeClass    = getSavingsBadgeClass(savingsRate);
      const netColor      = netSaved >= 0 ? 'var(--success)' : 'var(--danger)';
      const netIcon       = netSaved >= 0 ? '✅' : '⚠️';

      // Range label
      let rangeLabel = '';
      if (_activeRange === 0) {
        rangeLabel = 'All time';
      } else {
        const oldest = summaries[0];
        const newest = summaries[summaries.length - 1];
        if (oldest && newest) {
          rangeLabel = monthKeyToShort(oldest.monthKey) + ' – ' + monthKeyToLabel(newest.monthKey);
        }
      }

      container.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h3 style="font-size:16px;font-weight:700;color:var(--text-primary);">Overview</h3>
          <span style="font-size:12px;color:var(--text-secondary);">${rangeLabel}</span>
        </div>

        <div class="overview-row">
          <span class="overview-label">Total Income</span>
          <span class="overview-value" style="color:var(--success);">${formatCurrency(totalIncome)}</span>
        </div>
        <div class="overview-row">
          <span class="overview-label">Total Expenses</span>
          <span class="overview-value" style="color:var(--danger);">− ${formatCurrency(totalExpenses)}</span>
        </div>

        <div class="overview-divider"></div>

        <div class="overview-net-row">
          <span class="overview-net-label">Net Saved</span>
          <span class="overview-net-value" style="color:${netColor};">= ${formatCurrency(netSaved)} ${netIcon}</span>
        </div>

        <div class="overview-stats-grid">
          <div class="overview-stat-item">
            <div class="overview-stat-value">${formatCurrency(avgIncome)}</div>
            <div class="overview-stat-label">Avg/mo Income</div>
          </div>
          <div class="overview-stat-item">
            <div class="overview-stat-value">${formatCurrency(avgSpend)}</div>
            <div class="overview-stat-label">Avg/mo Spend</div>
          </div>
          <div class="overview-stat-item">
            <div class="overview-stat-value">
              <span class="savings-badge ${badgeClass}">${savingsRate}%</span>
            </div>
            <div class="overview-stat-label">Savings Rate</div>
          </div>
        </div>
      `;
    },

    // ── renderTrendChart ──────────────────────────────────────────────────────

    /**
     * Creates/updates the income vs expenses line chart.
     * @param {object[]} summaries  Sorted ascending by monthKey
     */
    renderTrendChart: function (summaries) {
      // iOS fix: destroy old chart and replace the canvas element entirely.
      // This prevents Chart.js from reusing a stale canvas context on iOS Safari.
      if (_trendChart) {
        _trendChart.destroy();
        _trendChart = null;
      }
      const trendOldEl = document.getElementById('trend-chart');
      console.log('[Analytics] renderTrendChart: el=', !!trendOldEl, 'summaries=', summaries ? summaries.length : 0);
      if (!trendOldEl) return;
      const trendContainer = trendOldEl.parentElement;
      if (!trendContainer) return;

      // Always restore the canvas element (never replace it with text — that destroys the canvas)
      trendContainer.innerHTML = '<canvas id="trend-chart" style="display:block;width:100%;height:220px;"></canvas>';
      const canvas = document.getElementById('trend-chart');

      if (!summaries || summaries.length === 0) {
        // Show message as a sibling element, not by replacing the canvas
        canvas.style.display = 'none';
        const msg = document.createElement('p');
        msg.style.cssText = 'text-align:center;color:var(--text-secondary);font-size:13px;padding:40px 0;';
        msg.textContent = 'Not enough data for this time range';
        trendContainer.appendChild(msg);
        return;
      }
      canvas.style.display = 'block';

      const { gridColor, textColor } = getChartColors();

      const monthLabels = summaries.map(function (s) { return monthKeyToShort(s.monthKey); });
      const incomeData  = summaries.map(function (s) { return s.totalIncome   || 0; });
      const expenseData = summaries.map(function (s) { return s.totalExpenses || 0; });

      _trendChart = new Chart(canvas, {
        type: 'line',
        data: {
          labels: monthLabels,
          datasets: [
            {
              label: 'Income',
              data: incomeData,
              borderColor: '#10B981',
              backgroundColor: 'rgba(16,185,129,0.1)',
              fill: true,
              tension: 0.4,
              pointRadius: 4,
              pointBackgroundColor: '#10B981',
              pointBorderColor: '#10B981',
            },
            {
              label: 'Expenses',
              data: expenseData,
              borderColor: '#6C63FF',
              backgroundColor: 'rgba(108,99,255,0.05)',
              fill: false,
              tension: 0.4,
              pointRadius: 4,
              pointBackgroundColor: '#6C63FF',
              pointBorderColor: '#6C63FF',
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function (ctx) {
                  return ' ' + ctx.dataset.label + ': ' + formatCurrency(ctx.raw);
                },
              },
            },
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: textColor },
            },
            y: {
              grid: { color: gridColor },
              ticks: {
                color: textColor,
                callback: function (v) {
                  return '$' + (v / 1000).toFixed(0) + 'k';
                },
              },
            },
          },
        },
      });
      // Force Chart.js to recalculate dimensions after creation
      requestAnimationFrame(function () { if (_trendChart) _trendChart.resize(); });

      // Render custom legend
      const legendEl = el('trend-chart-legend');
      if (legendEl) {
        legendEl.innerHTML = `
          <span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary);">
            <span style="width:12px;height:3px;background:#10B981;border-radius:2px;display:inline-block;"></span>Income
          </span>
          <span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary);">
            <span style="width:12px;height:3px;background:#6C63FF;border-radius:2px;display:inline-block;"></span>Expenses
          </span>
        `;
      }
    },

    // ── renderCategoryChart ───────────────────────────────────────────────────

    /**
     * Aggregates by category, creates horizontal bar chart.
     * @param {object[]} transactions
     * @param {object[]} categories
     * @param {Object.<string, object>} catMap
     */
    renderCategoryChart: function (transactions, categories, catMap) {
      // iOS fix: replace canvas element to get a fresh context
      if (_categoryChart) {
        _categoryChart.destroy();
        _categoryChart = null;
      }
      const container = el('category-chart-container');
      if (!container) return;
      container.innerHTML = '<canvas id="category-chart" style="display:block;width:100%;height:200px;"></canvas>';
      const canvas = document.getElementById('category-chart');

      if (!transactions || transactions.length === 0) return;

      // Aggregate by category (expenses only — negative amounts)
      const EXCLUDED = ['income', 'transfer'];
      const catTotals = {};
      transactions.forEach(function (t) {
        const amt = t.amount || 0;
        if (amt >= 0) return; // skip income
        const catId = t.categoryId || 'other';
        if (EXCLUDED.includes(catId)) return;
        catTotals[catId] = (catTotals[catId] || 0) + Math.abs(amt);
      });

      const entries = Object.entries(catTotals)
        .filter(function ([, amt]) { return amt > 0; })
        .sort(function ([, a], [, b]) { return b - a; });

      if (entries.length === 0) return;

      const { gridColor, textColor } = getChartColors();

      const categoryNames  = entries.map(function ([catId]) {
        const cat = catMap[catId];
        return cat ? (cat.emoji + ' ' + cat.name) : catId;
      });
      const categoryAmounts = entries.map(function ([, amt]) { return amt; });
      const categoryColors  = entries.map(function ([catId]) {
        const cat = catMap[catId];
        return cat ? cat.color : '#BDC3C7';
      });

      // Dynamic height based on category count
      const chartHeight = Math.max(200, entries.length * 44);
      if (container) container.style.height = chartHeight + 'px';

      _categoryChart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: categoryNames,
          datasets: [{
            data: categoryAmounts,
            backgroundColor: categoryColors,
            borderRadius: 6,
            borderSkipped: false,
          }],
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function (ctx) {
                  return ' ' + formatCurrency(ctx.raw);
                },
              },
            },
          },
          scales: {
            x: {
              grid: { color: gridColor },
              ticks: {
                color: textColor,
                callback: function (v) { return '$' + v.toLocaleString(); },
              },
            },
            y: {
              grid: { display: false },
              ticks: { color: textColor },
            },
          },
          onClick: function (event, elements) {
            if (elements && elements.length > 0) {
              const idx   = elements[0].index;
              const catId = entries[idx] && entries[idx][0];
              if (catId) {
                navigateTo('transactions');
                if (typeof onScreenActivated === 'function') {
                  onScreenActivated('transactions', { categoryId: catId });
                }
              }
            }
          },
        },
      });
      requestAnimationFrame(function () { if (_categoryChart) _categoryChart.resize(); });
    },

    // ── renderSavingsRateChart ────────────────────────────────────────────────

    /**
     * Creates savings rate bar chart with dynamic colors.
     * @param {object[]} summaries
     */
    renderSavingsRateChart: function (summaries) {
      // iOS fix: replace canvas element to get a fresh context
      if (_savingsChart) {
        _savingsChart.destroy();
        _savingsChart = null;
      }
      const savingsOld = el('savings-chart');
      if (!savingsOld) return;
      const savingsContainer = savingsOld.parentElement;
      if (!savingsContainer) return;
      savingsContainer.innerHTML = '<canvas id="savings-chart" style="display:block;width:100%;height:180px;"></canvas>';
      const canvas = document.getElementById('savings-chart');

      if (!summaries || summaries.length === 0) return;

      const { gridColor, textColor } = getChartColors();

      const monthLabels = summaries.map(function (s) { return monthKeyToShort(s.monthKey); });
      const rateData    = summaries.map(function (s) {
        if (!s.totalIncome || s.totalIncome === 0) return 0;
        return Math.max(0, Math.round((s.netSavings / s.totalIncome) * 100));
      });
      const barColors   = summaries.map(function (s) {
        const rate = s.totalIncome > 0 ? (s.netSavings / s.totalIncome) * 100 : 0;
        return getSavingsRateColor(rate);
      });

      _savingsChart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: monthLabels,
          datasets: [{
            data: rateData,
            backgroundColor: barColors,
            borderRadius: 6,
            borderSkipped: false,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function (ctx) {
                  return ' Savings Rate: ' + ctx.raw + '%';
                },
              },
            },
            annotation: {
              annotations: {
                targetLine: {
                  type: 'line',
                  yMin: 20,
                  yMax: 20,
                  borderColor: 'rgba(16,185,129,0.5)',
                  borderWidth: 1.5,
                  borderDash: [4, 4],
                },
              },
            },
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: textColor },
            },
            y: {
              min: 0,
              max: 100,
              grid: { color: gridColor },
              ticks: {
                color: textColor,
                callback: function (v) { return v + '%'; },
              },
            },
          },
        },
      });

      // Draw 20% reference line manually via afterDraw plugin
      // (annotation plugin not loaded — use a simpler approach via afterDraw)
      _savingsChart.options.plugins.afterDraw = undefined;
      requestAnimationFrame(function () { if (_savingsChart) _savingsChart.resize(); });
    },

    // ── renderTopMerchants ────────────────────────────────────────────────────

    /**
     * Aggregates by merchantName, renders top 10 list.
     * @param {object[]} transactions
     * @param {Object.<string, object>} catMap
     */
    renderTopMerchants: function (transactions, catMap) {
      const container = el('top-merchants-list');
      if (!container) return;

      if (!transactions || transactions.length === 0) {
        container.innerHTML = '<p style="color:var(--text-secondary);font-size:14px;text-align:center;padding:16px 0;">No transactions in this period</p>';
        return;
      }

      // Aggregate by merchantName (expenses only)
      const merchantTotals = {};
      const merchantCat    = {};
      transactions.forEach(function (t) {
        const amt = t.amount || 0;
        if (amt >= 0) return; // skip income
        const name = t.merchantName || t.description || 'Unknown';
        merchantTotals[name] = (merchantTotals[name] || 0) + Math.abs(amt);
        if (!merchantCat[name] && t.categoryId) {
          merchantCat[name] = t.categoryId;
        }
      });

      const sorted = Object.entries(merchantTotals)
        .sort(function ([, a], [, b]) { return b - a; })
        .slice(0, 10);

      if (sorted.length === 0) {
        container.innerHTML = '<p style="color:var(--text-secondary);font-size:14px;text-align:center;padding:16px 0;">No expense data in this period</p>';
        return;
      }

      container.innerHTML = sorted.map(function ([name, total], idx) {
        const catId = merchantCat[name] || 'other';
        const cat   = catMap[catId] || {};
        const emoji = cat.emoji || '📦';

        return `
          <div class="merchant-rank-item" data-merchant="${name.replace(/"/g, '&quot;')}" role="button" tabindex="0"
               aria-label="${name} ${formatCurrency(total)}">
            <span class="merchant-rank-num">${idx + 1}</span>
            <span class="merchant-rank-emoji">${emoji}</span>
            <span class="merchant-rank-name">${name}</span>
            <span class="merchant-rank-amount">${formatCurrency(total)}</span>
          </div>
        `;
      }).join('');

      // Wire up clicks → navigate to transactions filtered by merchant's category
      container.querySelectorAll('.merchant-rank-item').forEach(function (item) {
        item.addEventListener('click', function () {
          const merchant = item.getAttribute('data-merchant');
          const catId = merchantCat[merchant] || null;
          navigateTo('transactions');
          if (typeof onScreenActivated === 'function') {
            onScreenActivated('transactions', catId ? { categoryId: catId } : {});
          }
        });
        item.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') item.click();
        });
      });
    },

    // ── renderCalendar ────────────────────────────────────────────────────────

    /**
     * Renders the spending calendar for a given month.
     * @param {object[]} transactions
     * @param {number} year
     * @param {number} month  0-indexed (0=Jan, 11=Dec)
     */
    renderCalendar: function (transactions, year, month) {
      const container = el('spending-calendar');
      const monthLabel = el('calendar-month-label');
      if (!container) return;

      // Update month label
      const labelDate = new Date(year, month, 1);
      if (monthLabel) {
        monthLabel.textContent = labelDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      }

      // Build spend map: { 'YYYY-MM-DD': totalSpend }
      const spendMap = {};
      const monthKey = year + '-' + String(month + 1).padStart(2, '0');
      transactions.forEach(function (t) {
        if (!t.date) return;
        if (t.monthKey && t.monthKey !== monthKey) return;
        const amt = t.amount || 0;
        if (amt >= 0) return; // skip income
        const dateStr = t.date.length > 10 ? t.date.substring(0, 10) : t.date;
        spendMap[dateStr] = (spendMap[dateStr] || 0) + Math.abs(amt);
      });

      // Calendar grid
      const daysInMonth  = new Date(year, month + 1, 0).getDate();
      const firstDayOfWeek = new Date(year, month, 1).getDay(); // 0=Sun
      // Convert to Mon-first (0=Mon, 6=Sun)
      const startOffset = (firstDayOfWeek + 6) % 7;

      const today = new Date();
      const todayStr = today.getFullYear() + '-' +
        String(today.getMonth() + 1).padStart(2, '0') + '-' +
        String(today.getDate()).padStart(2, '0');

      const dayHeaders = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
      let html = '<div class="calendar-grid">';

      // Day headers
      dayHeaders.forEach(function (d) {
        html += '<div class="calendar-day-header">' + d + '</div>';
      });

      // Empty cells before first day
      for (let i = 0; i < startOffset; i++) {
        html += '<div class="calendar-day empty"></div>';
      }

      // Day cells
      for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
        const spend   = spendMap[dateStr] || 0;
        const bgColor = getDayColor(spend);
        const isToday = dateStr === todayStr;
        const todayClass = isToday ? ' today' : '';
        const textColor  = spend >= 75 ? '#ffffff' : 'var(--text-primary)';

        html += `
          <div class="calendar-day${todayClass}"
               style="background:${bgColor};color:${textColor};"
               data-date="${dateStr}"
               role="button"
               tabindex="0"
               aria-label="${dateStr}${spend > 0 ? ' $' + Math.round(spend) : ''}">
            ${day}
          </div>
        `;
      }

      html += '</div>';
      container.innerHTML = html;

      // Wire up day clicks → navigate to transactions for that month
      container.querySelectorAll('.calendar-day:not(.empty)').forEach(function (cell) {
        cell.addEventListener('click', function () {
          const date = cell.getAttribute('data-date');
          if (!date) return;
          // Derive monthKey from date string (YYYY-MM-DD → YYYY-MM)
          const mk = date.substring(0, 7);
          navigateTo('transactions');
          if (typeof onScreenActivated === 'function') {
            onScreenActivated('transactions', { monthKey: mk });
          }
        });
        cell.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') cell.click();
        });
      });
    },

    // ── navigateCalendarMonth ─────────────────────────────────────────────────

    /**
     * Navigates the calendar to the previous or next month.
     * @param {'prev'|'next'} direction
     */
    navigateCalendarMonth: function (direction) {
      if (direction === 'prev') {
        _calendarMonth--;
        if (_calendarMonth < 0) {
          _calendarMonth = 11;
          _calendarYear--;
        }
      } else {
        _calendarMonth++;
        if (_calendarMonth > 11) {
          _calendarMonth = 0;
          _calendarYear++;
        }
      }
      AnalyticsScreen.renderCalendar(_allTransactions, _calendarYear, _calendarMonth);
    },

    // ── _showEmptyState ───────────────────────────────────────────────────────

    /**
     * Shows the empty state and hides all data sections.
     * @private
     */
    _showEmptyState: function () {
      showEl('analytics-empty');
      hideEl('analytics-data');
    },

    // ── _updateRangeButtons ───────────────────────────────────────────────────

    /**
     * Updates the active state of time range buttons.
     * @param {number} activeMonths
     * @private
     */
    _updateRangeButtons: function (activeRange) {
      const selector = el('time-range-selector');
      if (!selector) return;
      selector.querySelectorAll('.segmented-btn').forEach(function (btn) {
        const range = btn.getAttribute('data-range');
        // Compare as string — handles both numeric ('3','6','12','0') and named ('week','month')
        const rangeVal = (range === 'week' || range === 'month') ? range : parseInt(range, 10);
        if (String(rangeVal) === String(activeRange)) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
    },

  }; // end AnalyticsScreen

  // ─── Theme Change Listener ──────────────────────────────────────────────────
  // Re-render charts with new colors when theme changes
  document.addEventListener('themeChanged', function () {
    const screen = document.getElementById('screen-analytics');
    if (screen && screen.classList.contains('active') && _allSummaries.length > 0) {
      // Re-render charts only (don't re-init which would conflict with generation counter)
      AnalyticsScreen.setTimeRange(_activeRange);
    }
  });


  // ─── MutationObserver: re-render trend chart when analytics screen becomes active ──
  // This catches the case where the screen transitions from hidden to visible
  // and the trend chart canvas has 0 dimensions at render time.
  function watchAnalyticsScreen() {
    const screen = document.getElementById('screen-analytics');
    if (!screen) {
      // Screen not in DOM yet — retry after a short delay
      setTimeout(watchAnalyticsScreen, 500);
      return;
    }
    const observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          const isActive = screen.classList.contains('active');
          if (isActive) {
            // Screen just became active.
            // Wait 1 second for init() to complete (DB query + 350ms wait + chart render).
            // Then check if the trend chart needs re-rendering.
            setTimeout(function () {
              if (!screen.classList.contains('active')) return; // user navigated away
              const trendCanvas = document.getElementById('trend-chart');
              const needsRender = _allSummaries.length > 0 && (
                _trendChart === null ||
                (trendCanvas && trendCanvas.offsetWidth === 0)
              );
              if (needsRender) {
                console.log('[Analytics] MutationObserver: re-rendering trend chart after delay');
                AnalyticsScreen.renderTrendChart(filterSummaries(_allSummaries, _activeRange));
              }
            }, 1000);
          }
        }
      });
    });
    observer.observe(screen, { attributes: true, attributeFilter: ['class'] });
  }
  // Start watching after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watchAnalyticsScreen);
  } else {
    setTimeout(watchAnalyticsScreen, 1000);
  }

  // ─── Export Global ──────────────────────────────────────────────────────────
  global.AnalyticsScreen = AnalyticsScreen;

})(window);

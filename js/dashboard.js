/**
 * dashboard.js — Dashboard Screen Module
 *
 * Exposes a global `DashboardScreen` object that manages the fully functional
 * dashboard: month navigation, summary card, donut chart, category bars,
 * trend bar chart, and recent transactions.
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

  /** @type {string[]} Sorted array of monthKeys that have data */
  let _availableMonths = [];

  /** @type {number} Index into _availableMonths for the currently displayed month */
  let _currentMonthIndex = -1;

  /** @type {Chart|null} Chart.js donut chart instance */
  let _donutChart = null;

  /** @type {Chart|null} Chart.js bar chart instance */
  let _trendChart = null;

  /** @type {Chart|null} Cumulative net saved line chart */
  let _cumulativeChart = null;

  /** @type {Chart|null} Credit score line chart */
  let _creditChart = null;

  /** @type {boolean} Prevents concurrent loadMonth calls */
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
   * Converts a monthKey to a short label like "Feb".
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
   * Formats a date string (ISO or YYYY-MM-DD) to "Feb 20" style.
   * @param {string} dateStr
   * @returns {string}
   */
  function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + (dateStr.length === 10 ? 'T00:00:00' : ''));
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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

  // ─── Skeleton Loaders ───────────────────────────────────────────────────────

  function showSkeletons() {
    const summaryCard = el('summary-card');
    if (summaryCard) {
      summaryCard.innerHTML = `
        <div class="skeleton" style="height:18px;width:120px;border-radius:6px;margin-bottom:12px;"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px;">
          <div><div class="skeleton" style="height:12px;width:50px;border-radius:4px;margin-bottom:6px;"></div><div class="skeleton" style="height:24px;width:70px;border-radius:4px;"></div></div>
          <div><div class="skeleton" style="height:12px;width:50px;border-radius:4px;margin-bottom:6px;"></div><div class="skeleton" style="height:24px;width:70px;border-radius:4px;"></div></div>
          <div><div class="skeleton" style="height:12px;width:50px;border-radius:4px;margin-bottom:6px;"></div><div class="skeleton" style="height:24px;width:70px;border-radius:4px;"></div></div>
        </div>
        <div class="skeleton" style="height:6px;border-radius:3px;"></div>
      `;
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  const DashboardScreen = {

    // ── init ──────────────────────────────────────────────────────────────────

    /**
     * Called when the dashboard screen becomes active.
     * Loads available months and renders the most recent month's data.
     */
    init: async function () {
      try {
        _availableMonths = await FinanceDB.getMonthsWithData();

        if (!_availableMonths || _availableMonths.length === 0) {
          DashboardScreen.showEmptyState();
          return;
        }

        // Default to the most recent month
        _currentMonthIndex = _availableMonths.length - 1;

        // Show data sections, hide empty state
        hideEl('dashboard-empty');
        showEl('dashboard-data');

        // Update month selector label and button states
        DashboardScreen._updateMonthSelector();

        // Show skeletons while loading
        showSkeletons();

        // Wait for Chart.js CDN to be available before rendering charts
        let chartWaitMs = 0;
        while (typeof Chart === 'undefined' && chartWaitMs < 5000) {
          await new Promise(function (resolve) { setTimeout(resolve, 100); });
          chartWaitMs += 100;
        }

        await DashboardScreen.loadMonth(_availableMonths[_currentMonthIndex]);
      } catch (err) {
        console.error('[DashboardScreen] init failed:', err);
      }
    },

    // ── loadMonth ─────────────────────────────────────────────────────────────

    /**
     * Loads all data for a specific month and updates all UI sections.
     * @param {string} monthKey  e.g. "2026-02"
     */
    loadMonth: async function (monthKey) {
      if (_loading) return;
      _loading = true;

      try {
        // Fetch data in parallel
        const [summary, transactions, categories] = await Promise.all([
          FinanceDB.getMonthlySummary(monthKey),
          FinanceDB.getTransactionsByMonth(monthKey),
          FinanceDB.getCategories(),
        ]);

        const catMap = buildCategoryMap(categories);

        // Render each section
        DashboardScreen.renderSummaryCard(summary || {
          totalIncome: 0,
          totalExpenses: 0,
          netSavings: 0,
          categoryBreakdown: {},
        });

        DashboardScreen.renderDonutChart(
          (summary && summary.categoryBreakdown) ? summary.categoryBreakdown : {},
          catMap
        );

        DashboardScreen.renderCategoryBars(
          (summary && summary.categoryBreakdown) ? summary.categoryBreakdown : {},
          catMap
        );

        // Sort transactions by date descending for recent list
        const sorted = (transactions || []).slice().sort(function (a, b) {
          return new Date(b.date) - new Date(a.date);
        });
        DashboardScreen.renderRecentTransactions(sorted.slice(0, 5), catMap);

        // Trend chart: get last 6 months of summaries
        const allSummaries = await FinanceDB.getAllMonthlySummaries();
        const last6 = allSummaries.slice(-6);
        DashboardScreen.renderTrendChart(last6);

        // Cumulative net saved chart: show all months, limit x-axis to 12 visible
        if (allSummaries.length >= 2) {
          DashboardScreen.renderCumulativeChart(allSummaries);
          const cumulCard = el('cumulative-card');
          if (cumulCard) cumulCard.style.display = '';
        }

        // Credit score chart
        try {
          const creditScores = await FinanceDB.getCreditScores();
          if (creditScores && creditScores.length >= 1) {
            DashboardScreen.renderCreditScoreChart(creditScores);
            const creditCard = el('credit-score-card');
            if (creditCard) creditCard.style.display = '';
          }
        } catch (e) { /* non-fatal */ }

        // Account balances
        DashboardScreen.renderAccountBalances();

      } catch (err) {
        console.error('[DashboardScreen] loadMonth failed:', err);
      } finally {
        _loading = false;
      }
    },

    // ── renderSummaryCard ─────────────────────────────────────────────────────

    /**
     * Updates the summary card with income/spent/saved numbers and progress bar.
     * @param {object} summary
     */
    renderSummaryCard: function (summary) {
      const card = el('summary-card');
      if (!card) return;

      const income   = summary.totalIncome   || 0;
      const spent    = summary.totalExpenses || 0;
      const saved    = summary.netSavings    != null ? summary.netSavings : (income - spent);
      const monthKey = _availableMonths[_currentMonthIndex] || '';

      const pct = income > 0 ? Math.round((spent / income) * 100) : 0;
      const barColor = pct > 90 ? '#EF4444' : pct > 75 ? '#F59E0B' : '#ffffff';

      card.innerHTML = `
        <div class="summary-card-grid">
          <div>
            <p class="summary-card-item-label">Income</p>
            <p class="summary-card-item-value">${formatCurrency(income)}</p>
          </div>
          <div>
            <p class="summary-card-item-label">Spent</p>
            <p class="summary-card-item-value">${formatCurrency(spent)}</p>
          </div>
          <div>
            <p class="summary-card-item-label">Saved</p>
            <p class="summary-card-item-value">${formatCurrency(saved)}</p>
          </div>
        </div>
        <div class="summary-progress-track">
          <div class="summary-progress-fill" style="width:${Math.min(pct, 100)}%;background:${barColor};"></div>
        </div>
        <p class="summary-progress-label">${pct}% spent</p>
      `;
    },

    // ── renderDonutChart ──────────────────────────────────────────────────────

    /**
     * Creates/updates the Chart.js doughnut chart.
     * Destroys previous instance before creating a new one.
     * @param {Object.<string, number>} categoryBreakdown
     * @param {Object.<string, object>} catMap
     */
    renderDonutChart: function (categoryBreakdown, catMap) {
      const legendEl = el('donut-legend');
      const centerAmountEl = el('donut-center-amount');
      const centerLabelEl  = el('donut-center-label');

      // iOS fix: replace canvas element to get a fresh context on every render
      if (_donutChart) {
        _donutChart.destroy();
        _donutChart = null;
      }
      const donutOld = el('donut-chart');
      if (!donutOld) return;
      const donutContainer = donutOld.parentElement;
      if (!donutContainer) return;
      donutContainer.innerHTML = '<canvas id="donut-chart" style="display:block;width:100%;height:220px;" aria-label="Spending by category donut chart" role="img"></canvas>';
      const canvas = document.getElementById('donut-chart');

      // Filter out income and transfer categories
      const EXCLUDED = ['income', 'transfer'];
      const entries = Object.entries(categoryBreakdown)
        .filter(function ([catId]) { return !EXCLUDED.includes(catId); })
        .filter(function ([, amt]) { return amt > 0; })
        .sort(function ([, a], [, b]) { return b - a; });

      const totalSpend = entries.reduce(function (sum, [, amt]) { return sum + amt; }, 0);

      if (centerAmountEl) centerAmountEl.textContent = formatCurrency(totalSpend);
      if (centerLabelEl)  centerLabelEl.textContent  = 'total spent';

      if (entries.length === 0) {
        // Show placeholder
        if (legendEl) legendEl.innerHTML = '<span style="color:var(--text-secondary);font-size:13px;">No spending data</span>';
        return;
      }

      const labels  = entries.map(function ([catId]) { return (catMap[catId] && catMap[catId].name) || catId; });
      const amounts = entries.map(function ([, amt]) { return amt; });
      const colors  = entries.map(function ([catId]) { return (catMap[catId] && catMap[catId].color) || '#BDC3C7'; });

      _donutChart = new Chart(canvas, {
        type: 'doughnut',
        data: {
          labels: labels,
          datasets: [{
            data: amounts,
            backgroundColor: colors,
            borderWidth: 0,
            hoverOffset: 8,
          }],
        },
        options: {
          cutout: '70%',
          plugins: { legend: { display: false } },
          responsive: true,
          maintainAspectRatio: true,
        },
      });

      // Build custom HTML legend
      if (legendEl) {
        legendEl.innerHTML = entries.map(function ([catId, amt]) {
          const cat   = catMap[catId] || {};
          const name  = cat.name  || catId;
          const color = cat.color || '#BDC3C7';
          return `
            <div class="donut-legend-item" data-category="${catId}" role="button" tabindex="0"
                 aria-label="View ${name} transactions">
              <span class="donut-legend-dot" style="background:${color};"></span>
              <span class="donut-legend-name">${name}</span>
              <span class="donut-legend-amount">${formatCurrency(amt)}</span>
            </div>
          `;
        }).join('');

        // Wire up legend item clicks → navigate to transactions
        legendEl.querySelectorAll('.donut-legend-item').forEach(function (item) {
          item.addEventListener('click', function () {
            const catId = item.getAttribute('data-category');
            navigateTo('transactions');
            if (typeof onScreenActivated === 'function') onScreenActivated('transactions');
          });
          item.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') item.click();
          });
        });
      }
    },

    // ── renderCategoryBars ────────────────────────────────────────────────────

    /**
     * Renders the top 5 category progress bars.
     * @param {Object.<string, number>} categoryBreakdown
     * @param {Object.<string, object>} catMap
     */
    renderCategoryBars: function (categoryBreakdown, catMap) {
      const container = el('category-bars');
      if (!container) return;

      const EXCLUDED = ['income', 'transfer'];
      const entries = Object.entries(categoryBreakdown)
        .filter(function ([catId]) { return !EXCLUDED.includes(catId); })
        .filter(function ([, amt]) { return amt > 0; })
        .sort(function ([, a], [, b]) { return b - a; })
        .slice(0, 5);

      const totalSpend = entries.reduce(function (sum, [, amt]) { return sum + amt; }, 0);

      if (entries.length === 0) {
        container.innerHTML = '<p style="color:var(--text-secondary);font-size:14px;text-align:center;padding:16px 0;">No spending data for this month</p>';
        return;
      }

      container.innerHTML = entries.map(function ([catId, amt]) {
        const cat   = catMap[catId] || {};
        const name  = cat.name  || catId;
        const emoji = cat.emoji || '📦';
        const color = cat.color || '#BDC3C7';
        const pct   = totalSpend > 0 ? Math.round((amt / totalSpend) * 100) : 0;
        const barW  = totalSpend > 0 ? ((amt / totalSpend) * 100).toFixed(1) : 0;

        return `
          <div class="category-bar-row" data-category="${catId}" role="button" tabindex="0"
               aria-label="View ${name} transactions">
            <div class="category-bar-header">
              <span class="category-bar-name">${emoji} ${name}</span>
              <span>
                <span class="category-bar-amount">${formatCurrency(amt)}</span>
                <span class="category-bar-pct">(${pct}%)</span>
              </span>
            </div>
            <div class="category-bar-track">
              <div class="category-bar-fill" style="width:${barW}%;background:${color};"></div>
            </div>
          </div>
        `;
      }).join('');

      // Wire up row clicks
      container.querySelectorAll('.category-bar-row').forEach(function (row) {
        row.addEventListener('click', function () {
          navigateTo('transactions');
          if (typeof onScreenActivated === 'function') onScreenActivated('transactions');
        });
        row.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') row.click();
        });
      });
    },

    // ── renderTrendChart ──────────────────────────────────────────────────────

    /**
     * Creates/updates the Chart.js bar chart showing last 6 months.
     * @param {object[]} monthlySummaries  Sorted ascending by monthKey
     */
    renderTrendChart: function (monthlySummaries) {
      // iOS fix: replace canvas element to get a fresh context on every render
      if (_trendChart) {
        _trendChart.destroy();
        _trendChart = null;
      }
      const trendOld = el('trend-chart');
      if (!trendOld) return;
      const trendContainer = trendOld.parentElement;
      if (!trendContainer) return;
      trendContainer.innerHTML = '<canvas id="trend-chart" style="display:block;width:100%;height:200px;"></canvas>';
      const canvas = document.getElementById('trend-chart');

      if (!monthlySummaries || monthlySummaries.length === 0) return;

      const { gridColor, textColor } = getChartColors();

      const monthLabels  = monthlySummaries.map(function (s) { return monthKeyToShort(s.monthKey); });
      const incomeData   = monthlySummaries.map(function (s) { return s.totalIncome   || 0; });
      const expenseData  = monthlySummaries.map(function (s) { return s.totalExpenses || 0; });

      _trendChart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: monthLabels,
          datasets: [
            {
              label: 'Income',
              data: incomeData,
              backgroundColor: '#10B981',
              borderRadius: 6,
            },
            {
              label: 'Expenses',
              data: expenseData,
              backgroundColor: '#6C63FF',
              borderRadius: 6,
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
          barPercentage: 0.6,
          categoryPercentage: 0.8,
          onClick: function (event, elements) {
            if (elements && elements.length > 0) {
              const idx = elements[0].index;
              const clickedMonthKey = monthlySummaries[idx] && monthlySummaries[idx].monthKey;
              if (clickedMonthKey) {
                const monthIdx = _availableMonths.indexOf(clickedMonthKey);
                if (monthIdx !== -1) {
                  _currentMonthIndex = monthIdx;
                  DashboardScreen._updateMonthSelector();
                  DashboardScreen.loadMonth(clickedMonthKey);
                }
              }
            }
          },
        },
      });
    },

    // ── renderCumulativeChart ─────────────────────────────────────────────────

    /**
     * Renders a scrollable cumulative net saved line chart on the dashboard.
     * Shows all months; limits visible window to 12 months; no dots; smooth line.
     * @param {object[]} allSummaries  All monthly summaries sorted ascending
     */
    renderCumulativeChart: function (allSummaries) {
      if (_cumulativeChart) {
        _cumulativeChart.destroy();
        _cumulativeChart = null;
      }

      const canvas      = el('dash-cumulative-chart');
      const innerEl     = el('dash-cumulative-inner');
      const yAxisCanvas = el('dash-cumulative-yaxis');
      if (!canvas || !innerEl || !yAxisCanvas) return;

      if (!allSummaries || allSummaries.length < 2) return;

      // Use explicit colors (Canvas 2D cannot read CSS variables)
      const isDark    = document.documentElement.getAttribute('data-theme') === 'dark';
      const textColor = isDark ? '#94A3B8' : '#6B7280';
      const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';

      const Y_AXIS_W = 52;
      const CHART_H  = 200;
      const PT_WIDTH = 56;

      // Build cumulative running total
      let running = 0;
      const labels = [];
      const data   = [];
      allSummaries.forEach(function (s) {
        running += (s.netSavings || 0);
        labels.push(monthKeyToShort(s.monthKey));
        data.push(Math.round(running * 100) / 100);
      });

      const lastVal   = data[data.length - 1] || 0;
      const lineColor = lastVal >= 0 ? '#10B981' : '#EF4444';
      const fillColor = lastVal >= 0 ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.10)';
      const dotColor  = lineColor;

      // Y-axis range with 12% padding
      const rawMin = Math.min.apply(null, data);
      const rawMax = Math.max.apply(null, data);
      const pad    = Math.max(Math.abs(rawMax - rawMin) * 0.12, 100);
      const minVal = rawMin - pad;
      const maxVal = rawMax + pad;

      // Chart width: at least 12 points visible, scroll for more
      const availW = (innerEl.parentElement ? innerEl.parentElement.offsetWidth : 0) || (window.innerWidth - Y_AXIS_W - 32);
      const ptW    = Math.max(PT_WIDTH, Math.floor(availW / Math.min(12, labels.length)));
      const chartW = Math.max(availW, labels.length * ptW);
      canvas.width  = chartW;
      canvas.height = CHART_H;
      yAxisCanvas.width  = Y_AXIS_W;
      yAxisCanvas.height = CHART_H;
      yAxisCanvas.style.height = CHART_H + 'px';
      innerEl.style.width  = chartW + 'px';
      innerEl.style.height = CHART_H + 'px';

      // Update outer wrapper height
      var outerWrapper = innerEl.parentElement && innerEl.parentElement.parentElement;
      if (outerWrapper) outerWrapper.style.height = CHART_H + 'px';

      // Scroll to most recent (rightmost)
      requestAnimationFrame(function () {
        var sw = innerEl.parentElement;
        if (sw) sw.scrollLeft = sw.scrollWidth;
      });

      // Draw sticky y-axis with explicit pixel colors
      function drawYAxis() {
        var ctx = yAxisCanvas.getContext('2d');
        ctx.clearRect(0, 0, Y_AXIS_W, CHART_H);
        ctx.fillStyle = textColor;
        ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'right';
        var steps  = 4;
        var top    = 12;
        var bottom = CHART_H - 24; // leave room for x-axis labels
        var h      = bottom - top;
        for (var i = 0; i <= steps; i++) {
          var val = minVal + (maxVal - minVal) * (i / steps);
          var y   = bottom - (h * i / steps);
          var abs = Math.abs(val);
          var lbl = (val < 0 ? '-' : '') + '$' + (abs >= 1000 ? (abs / 1000).toFixed(0) + 'k' : Math.round(abs));
          ctx.fillText(lbl, Y_AXIS_W - 4, y + 3);
        }
      }

      _cumulativeChart = new Chart(canvas, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: 'Cumulative Saved',
            data: data,
            borderColor: lineColor,
            backgroundColor: fillColor,
            fill: true,
            tension: 0.4,
            pointRadius: 4,
            pointHoverRadius: 7,
            pointBackgroundColor: dotColor,
            pointBorderColor: dotColor,
            borderWidth: 2.5,
          }],
        },
        options: {
          responsive: false,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function (ctx) {
                  var v = ctx.raw;
                  return ' ' + (v < 0 ? '-' : '+') + formatCurrency(Math.abs(v));
                },
              },
            },
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: textColor, maxRotation: 0, maxTicksLimit: 12 },
            },
            y: {
              min: minVal,
              max: maxVal,
              grid: { color: gridColor },
              ticks: { display: false },
            },
          },
          animation: {
            onComplete: function () { drawYAxis(); },
          },
        },
      });
    },

    // ── renderCreditScoreChart ────────────────────────────────────────────────

    /**
     * Renders a scrollable credit score line chart on the dashboard.
     * @param {object[]} scores  Sorted ascending by monthKey
     */
    renderCreditScoreChart: function (scores) {
      if (_creditChart) {
        _creditChart.destroy();
        _creditChart = null;
      }

      const canvas      = el('dash-credit-chart');
      const innerEl     = el('dash-credit-inner');
      const yAxisCanvas = el('dash-credit-yaxis');
      if (!canvas || !innerEl || !yAxisCanvas) return;
      if (!scores || scores.length === 0) return;

      const isDark    = document.documentElement.getAttribute('data-theme') === 'dark';
      const textColor = isDark ? '#94A3B8' : '#6B7280';
      const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';

      const Y_AXIS_W = 52;
      const CHART_H  = 180;
      const PT_WIDTH = 56;

      const labels = scores.map(function (s) { return monthKeyToShort(s.monthKey); });
      const data   = scores.map(function (s) { return s.score; });

      // Color each point by score range
      const pointColors = data.map(function (v) {
        if (v >= 750) return '#10B981';
        if (v >= 700) return '#F59E0B';
        return '#EF4444';
      });

      // Y-axis: 580–850 range (typical FICO range)
      const rawMin = Math.max(500, Math.min.apply(null, data) - 20);
      const rawMax = Math.min(850, Math.max.apply(null, data) + 20);

      const availW = (innerEl.parentElement ? innerEl.parentElement.offsetWidth : 0) || (window.innerWidth - Y_AXIS_W - 32);
      const ptW    = Math.max(PT_WIDTH, Math.floor(availW / Math.min(12, labels.length)));
      const chartW = Math.max(availW, labels.length * ptW);
      canvas.width  = chartW;
      canvas.height = CHART_H;
      yAxisCanvas.width  = Y_AXIS_W;
      yAxisCanvas.height = CHART_H;
      yAxisCanvas.style.height = CHART_H + 'px';
      innerEl.style.width  = chartW + 'px';
      innerEl.style.height = CHART_H + 'px';

      requestAnimationFrame(function () {
        var sw = innerEl.parentElement;
        if (sw) sw.scrollLeft = sw.scrollWidth;
      });

      function drawYAxis() {
        var ctx = yAxisCanvas.getContext('2d');
        ctx.clearRect(0, 0, Y_AXIS_W, CHART_H);
        ctx.fillStyle = textColor;
        ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'right';
        var steps = 4;
        var top = 12, bottom = CHART_H - 24, h = bottom - top;
        for (var i = 0; i <= steps; i++) {
          var val = rawMin + (rawMax - rawMin) * (i / steps);
          var y   = bottom - (h * i / steps);
          ctx.fillText(Math.round(val), Y_AXIS_W - 4, y + 3);
        }
      }

      _creditChart = new Chart(canvas, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: 'FICO Score',
            data: data,
            borderColor: '#6C63FF',
            backgroundColor: 'rgba(108,99,255,0.08)',
            fill: true,
            tension: 0.4,
            pointRadius: 5,
            pointHoverRadius: 8,
            pointBackgroundColor: pointColors,
            pointBorderColor: pointColors,
            borderWidth: 2.5,
          }],
        },
        options: {
          responsive: false,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function (ctx) {
                  return ' FICO: ' + ctx.raw;
                },
              },
            },
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: textColor, maxRotation: 0, maxTicksLimit: 12 },
            },
            y: {
              min: rawMin,
              max: rawMax,
              grid: { color: gridColor },
              ticks: { display: false },
            },
          },
          animation: {
            onComplete: function () { drawYAxis(); },
          },
        },
      });
    },

    // ── renderAccountBalances ─────────────────────────────────────────────────

    /**
     * Loads account balances from DB and renders the accounts card.
     * Only shows accounts that have a currentBalance set.
     */
    renderAccountBalances: async function () {
      const card = el('accounts-card');
      const list = el('accounts-list');
      const netWorthLabel = el('net-worth-label');
      if (!card || !list) return;

      try {
        const accounts = await FinanceDB.getAccountBalances();
        const withBalance = accounts.filter(function (a) {
          return a.currentBalance !== null && a.currentBalance !== undefined;
        });

        if (withBalance.length === 0) {
          card.style.display = 'none';
          return;
        }

        // Compute net worth: checking + savings balances minus credit card balances
        let netWorth = 0;
        withBalance.forEach(function (a) {
          if (a.type === 'credit') {
            netWorth -= a.currentBalance; // credit card balance is a liability
          } else {
            netWorth += a.currentBalance; // checking/savings are assets
          }
        });

        // Update net worth label
        if (netWorthLabel) {
          const sign = netWorth >= 0 ? '' : '-';
          netWorthLabel.textContent = 'Net: ' + sign + '$' + Math.abs(netWorth).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          netWorthLabel.style.color = netWorth >= 0 ? 'var(--success)' : 'var(--danger)';
        }

        // Render account rows
        list.innerHTML = '';
        withBalance.forEach(function (account) {
          const isCredit = account.type === 'credit';
          const balanceColor = isCredit ? 'var(--danger)' : 'var(--success)';
          const balanceSign = isCredit ? '-' : '';
          const balanceStr = balanceSign + '$' + account.currentBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          const asOf = account.balanceAsOf ? ' · ' + account.balanceAsOf : '';
          const typeLabel = account.type === 'checking' ? 'Checking' : account.type === 'savings' ? 'Savings' : 'Credit';

          const row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;padding:12px 0;border-bottom:0.5px solid var(--separator);gap:12px;';
          row.innerHTML =
            '<div style="width:36px;height:36px;border-radius:10px;background:' + (account.color || 'var(--accent)') + ';flex-shrink:0;"></div>' +
            '<div style="flex:1;min-width:0;">' +
              '<div style="font-size:15px;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (account.name || account.id) + '</div>' +
              '<div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">' + typeLabel + asOf + '</div>' +
            '</div>' +
            '<div style="font-size:16px;font-weight:700;color:' + balanceColor + ';flex-shrink:0;">' + balanceStr + '</div>';

          // Remove border from last row
          list.appendChild(row);
        });

        // Remove border from last row
        const rows = list.querySelectorAll('div');
        if (rows.length > 0) {
          rows[rows.length - 1].style.borderBottom = 'none';
        }

        card.style.display = '';
      } catch (err) {
        console.error('[DashboardScreen] renderAccountBalances failed:', err);
        card.style.display = 'none';
      }
    },

    // ── renderRecentTransactions ──────────────────────────────────────────────

    /**
     * Renders the last 5 transactions for the selected month.
     * @param {object[]} transactions  Already sorted descending by date, max 5
     * @param {Object.<string, object>} catMap
     */
    renderRecentTransactions: function (transactions, catMap) {
      const container = el('recent-transactions');
      if (!container) return;

      if (!transactions || transactions.length === 0) {
        container.innerHTML = '<p style="color:var(--text-secondary);font-size:14px;text-align:center;padding:16px 0;">No transactions this month</p>';
        return;
      }

      container.innerHTML = transactions.map(function (txn) {
        const cat    = catMap[txn.categoryId] || {};
        const emoji  = cat.emoji || '📦';
        const amt    = txn.amount || 0;
        const isPos  = amt >= 0;
        const amtStr = (isPos ? '+' : '-') + formatCurrency(amt);
        const color  = isPos ? 'var(--success)' : 'var(--danger)';
        const merchant = txn.merchantName || txn.description || 'Unknown';
        const dateStr  = formatDate(txn.date);

        return `
          <div class="recent-txn-row" role="button" tabindex="0" aria-label="${merchant} ${amtStr}">
            <div class="recent-txn-emoji">${emoji}</div>
            <div class="recent-txn-info">
              <div class="recent-txn-merchant">${merchant}</div>
              <div class="recent-txn-date">${dateStr}</div>
            </div>
            <div class="recent-txn-amount" style="color:${color};">${amtStr}</div>
          </div>
        `;
      }).join('');

      // Wire up row clicks → navigate to transactions
      container.querySelectorAll('.recent-txn-row').forEach(function (row) {
        row.addEventListener('click', function () {
          navigateTo('transactions');
          if (typeof onScreenActivated === 'function') onScreenActivated('transactions');
        });
        row.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') row.click();
        });
      });
    },

    // ── showEmptyState ────────────────────────────────────────────────────────

    /**
     * Shows the empty state and hides all data sections.
     */
    showEmptyState: function () {
      showEl('dashboard-empty');
      hideEl('dashboard-data');

      // Update month selector to show placeholder
      const label = el('month-selector-label');
      if (label) label.textContent = 'No data yet';

      const prevBtn = el('month-prev-btn');
      const nextBtn = el('month-next-btn');
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = true;
    },

    // ── navigateMonth ─────────────────────────────────────────────────────────

    /**
     * Navigates to the previous or next month that has data.
     * @param {'prev'|'next'} direction
     */
    navigateMonth: function (direction) {
      if (_availableMonths.length === 0) return;

      const newIndex = direction === 'prev'
        ? _currentMonthIndex - 1
        : _currentMonthIndex + 1;

      if (newIndex < 0 || newIndex >= _availableMonths.length) return;

      _currentMonthIndex = newIndex;
      DashboardScreen._updateMonthSelector();
      showSkeletons();
      DashboardScreen.loadMonth(_availableMonths[_currentMonthIndex]);
    },

    // ── _updateMonthSelector ──────────────────────────────────────────────────

    /**
     * Updates the month selector label and prev/next button disabled states.
     * @private
     */
    _updateMonthSelector: function () {
      const label   = el('month-selector-label');
      const prevBtn = el('month-prev-btn');
      const nextBtn = el('month-next-btn');

      if (label && _availableMonths[_currentMonthIndex]) {
        label.textContent = monthKeyToLabel(_availableMonths[_currentMonthIndex]);
      }

      if (prevBtn) prevBtn.disabled = (_currentMonthIndex <= 0);
      if (nextBtn) nextBtn.disabled = (_currentMonthIndex >= _availableMonths.length - 1);
    },

  }; // end DashboardScreen

  // ─── Theme Change Listener ──────────────────────────────────────────────────
  // Re-render charts when theme changes so colors update correctly.
  document.addEventListener('themeChanged', function () {
    // Only re-render if the dashboard is currently active
    const screen = document.getElementById('screen-dashboard');
    if (screen && screen.classList.contains('active')) {
      DashboardScreen.init();
    }
  });

  // ─── Export Global ──────────────────────────────────────────────────────────
  global.DashboardScreen = DashboardScreen;

})(window);

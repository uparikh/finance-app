/**
 * analytics.js — Analytics Screen Module
 *
 * Overview card with tappable metrics → drill-down charts:
 *   - Total Income    → line chart over time
 *   - Total Expenses  → line chart over time
 *   - Net Saved       → combined income/expense/net line chart
 *   - Avg/mo Income   → scrollable bar chart
 *   - Avg/mo Spend    → scrollable bar chart
 *   - Savings Rate    → scrollable bar chart
 *
 * Existing charts: category horizontal bar, savings rate bar, calendar heatmap.
 * Flicker fix: single render path, no safety-net setTimeout re-render.
 */

(function (global) {
  'use strict';

  // ─── Private State ──────────────────────────────────────────────────────────

  let _allSummaries    = [];
  let _allTransactions = [];
  let _allCategories   = [];
  let _activeRange     = 6;

  let _trendChart    = null;
  let _categoryChart = null;
  let _savingsChart  = null;
  let _drillChart    = null;   // chart inside the drill-down overlay

  let _calendarYear  = new Date().getFullYear();
  let _calendarMonth = new Date().getMonth();

  // Generation counter prevents stale async renders
  let _generation = 0;

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function formatCurrency(amount) {
    return '$' + Math.abs(amount).toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  }

  function formatCurrencyFull(amount) {
    return '$' + Math.abs(amount).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function monthKeyToShort(monthKey) {
    if (!monthKey) return '';
    const [year, month] = monthKey.split('-');
    const date = new Date(parseInt(year, 10), parseInt(month, 10) - 1, 1);
    return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  }

  function monthKeyToLabel(monthKey) {
    if (!monthKey) return '';
    const [year, month] = monthKey.split('-');
    const date = new Date(parseInt(year, 10), parseInt(month, 10) - 1, 1);
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  function getChartColors() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    return {
      gridColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
      textColor: isDark ? '#94A3B8' : '#6B7280',
      bgColor:   isDark ? '#1C1C2E' : '#FFFFFF',
    };
  }

  function buildCategoryMap(categories) {
    const map = {};
    categories.forEach(function (cat) { map[cat.id] = cat; });
    return map;
  }

  function getCutoffMonthKey(range) {
    if (!range || range === 0) return null;
    const now = new Date();
    if (range === 'month') {
      return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    }
    if (range === 'week') {
      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - 6);
      return cutoff.getFullYear() + '-' + String(cutoff.getMonth() + 1).padStart(2, '0');
    }
    const cutoff = new Date(now.getFullYear(), now.getMonth() - range + 1, 1);
    return cutoff.getFullYear() + '-' + String(cutoff.getMonth() + 1).padStart(2, '0');
  }

  function getCutoffDate(range) {
    if (range !== 'week') return null;
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - 6);
    return cutoff.toISOString().split('T')[0];
  }

  function filterSummaries(summaries, range) {
    const cutoff = getCutoffMonthKey(range);
    if (!cutoff) return summaries;
    return summaries.filter(function (s) { return s.monthKey >= cutoff; });
  }

  function filterTransactions(transactions, range) {
    if (range === 'week') {
      const cutoffDate = getCutoffDate(range);
      return transactions.filter(function (t) { return t.date && t.date >= cutoffDate; });
    }
    const cutoff = getCutoffMonthKey(range);
    if (!cutoff) return transactions;
    return transactions.filter(function (t) { return t.monthKey && t.monthKey >= cutoff; });
  }

  function getSavingsRateColor(rate) {
    if (rate >= 20) return '#10B981';
    if (rate >= 10) return '#F59E0B';
    return '#EF4444';
  }

  function getSavingsBadgeClass(rate) {
    if (rate >= 20) return 'good';
    if (rate >= 10) return 'ok';
    return 'bad';
  }

  function getDayColor(amount) {
    if (!amount || amount === 0) return 'var(--bg-secondary)';
    if (amount < 30)  return 'rgba(108,99,255,0.2)';
    if (amount < 75)  return 'rgba(108,99,255,0.4)';
    if (amount < 150) return 'rgba(108,99,255,0.65)';
    return 'rgba(239,68,68,0.7)';
  }

  function el(id) { return document.getElementById(id); }
  function showEl(id) { const e = el(id); if (e) e.style.display = ''; }
  function hideEl(id) { const e = el(id); if (e) e.style.display = 'none'; }

  // ─── Destroy a chart safely ──────────────────────────────────────────────────

  function destroyChart(chartRef) {
    if (chartRef) {
      try { chartRef.destroy(); } catch (e) { /* ignore */ }
    }
    return null;
  }

  // ─── Drill-Down Overlay ──────────────────────────────────────────────────────

  /**
   * Opens the drill-down overlay with a given title and renders a chart inside it.
   * @param {string} title
   * @param {function} renderFn  Called with the content container element
   */
  function openDrilldown(title, renderFn) {
    const overlay = el('analytics-drilldown');
    const titleEl = el('drilldown-title');
    const content = el('drilldown-content');
    const backBtn = el('drilldown-back-btn');
    if (!overlay || !content) return;

    // Destroy any previous drill chart
    _drillChart = destroyChart(_drillChart);

    // Set title
    if (titleEl) titleEl.textContent = title;

    // Clear content
    content.innerHTML = '';

    // Lock the parent screen's scroll to prevent scroll-through (Fix 11)
    const parentScreen = el('screen-analytics');
    if (parentScreen) {
      parentScreen._savedScrollTop = parentScreen.scrollTop;
      parentScreen.style.overflow = 'hidden';
    }

    // Show overlay
    overlay.style.display = 'flex';
    requestAnimationFrame(function () {
      overlay.style.transform = 'translateX(0)';
    });

    // Wire back button (replace to avoid duplicate listeners)
    if (backBtn) {
      const newBack = backBtn.cloneNode(true);
      backBtn.parentNode.replaceChild(newBack, backBtn);
      newBack.addEventListener('click', closeDrilldown);
    }

    // Give the DOM a frame to paint before rendering the chart
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        renderFn(content);
      });
    });
  }

  function closeDrilldown() {
    const overlay = el('analytics-drilldown');
    if (!overlay) return;
    overlay.style.transform = 'translateX(100%)';

    // Restore parent screen scroll
    const parentScreen = el('screen-analytics');
    if (parentScreen) {
      parentScreen.style.overflow = '';
      if (parentScreen._savedScrollTop !== undefined) {
        parentScreen.scrollTop = parentScreen._savedScrollTop;
      }
    }

    setTimeout(function () {
      overlay.style.display = 'none';
      _drillChart = destroyChart(_drillChart);
    }, 300);
  }

  // ─── Drill-Down Chart Builders ───────────────────────────────────────────────

  /**
   * Renders a line chart in the drill-down panel.
   * @param {HTMLElement} container
   * @param {object} opts  { labels, datasets, yFormat }
   */
  function renderDrillLineChart(container, opts) {
    const { gridColor, textColor } = getChartColors();

    // Time range selector
    const rangeBar = document.createElement('div');
    rangeBar.style.cssText = 'margin-bottom:16px;';
    rangeBar.innerHTML = `
      <div class="segmented-control" style="width:100%;">
        <button class="segmented-btn" data-drill-range="3">3M</button>
        <button class="segmented-btn active" data-drill-range="6">6M</button>
        <button class="segmented-btn" data-drill-range="12">12M</button>
        <button class="segmented-btn" data-drill-range="0">All</button>
      </div>
    `;
    container.appendChild(rangeBar);

    // Canvas wrapper
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:relative;height:280px;width:100%;';
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:100%;height:280px;';
    wrapper.appendChild(canvas);
    container.appendChild(wrapper);

    // Tooltip value display
    const tooltip = document.createElement('div');
    tooltip.style.cssText = `
      margin-top: 16px;
      padding: 12px 16px;
      background: var(--bg-secondary);
      border-radius: 12px;
      font-size: 14px;
      color: var(--text-primary);
      min-height: 44px;
      display: flex;
      align-items: center;
      gap: 8px;
    `;
    tooltip.innerHTML = '<span style="color:var(--text-secondary);">Tap a point to see details</span>';
    container.appendChild(tooltip);

    function buildChart(range) {
      _drillChart = destroyChart(_drillChart);

      const filtered = filterSummaries(_allSummaries, range);
      const labels   = filtered.map(function (s) { return monthKeyToShort(s.monthKey); });

      // Resize canvas
      canvas.width  = wrapper.offsetWidth || (window.innerWidth - 32);
      canvas.height = 280;

      _drillChart = new Chart(canvas, {
        type: 'line',
        data: {
          labels: labels,
          datasets: opts.datasets(filtered),
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: {
              display: opts.datasets(filtered).length > 1,
              labels: {
                color: textColor,
                font: { size: 12 },
                usePointStyle: true,
                pointStyle: 'line',
                boxWidth: 24,
                boxHeight: 3,
              },
            },
            tooltip: {
              enabled: false,
              external: function (ctx) {
                const items = ctx.tooltip.dataPoints;
                if (!items || items.length === 0) return;
                const label = items[0].label;
                const lines = items.map(function (item) {
                  const color = item.dataset.borderColor || '#6C63FF';
                  const val   = opts.yFormat ? opts.yFormat(item.raw) : formatCurrencyFull(item.raw);
                  return `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};margin-right:6px;flex-shrink:0;"></span>
                          <strong>${item.dataset.label}:</strong>&nbsp;${val}`;
                });
                tooltip.innerHTML = `
                  <div>
                    <div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px;">${label}</div>
                    ${lines.map(function (l) { return '<div style="display:flex;align-items:center;gap:4px;margin-bottom:2px;">' + l + '</div>'; }).join('')}
                  </div>
                `;
              },
            },
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: textColor, maxRotation: 0 },
            },
            y: {
              grid: { color: gridColor },
              ticks: {
                color: textColor,
                callback: function (v) {
                  return opts.yFormat ? opts.yFormat(v) : ('$' + (v / 1000).toFixed(0) + 'k');
                },
              },
            },
          },
          onClick: function (event, elements) {
            if (elements && elements.length > 0) {
              const idx   = elements[0].index;
              const items = _drillChart.data.datasets.map(function (ds) {
                const color = ds.borderColor || '#6C63FF';
                const val   = opts.yFormat ? opts.yFormat(ds.data[idx]) : formatCurrencyFull(ds.data[idx]);
                return `<div style="display:flex;align-items:center;gap:4px;margin-bottom:2px;">
                  <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0;"></span>
                  <strong>${ds.label}:</strong>&nbsp;${val}
                </div>`;
              });
              tooltip.innerHTML = `
                <div>
                  <div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px;">${_drillChart.data.labels[idx]}</div>
                  ${items.join('')}
                </div>
              `;
            }
          },
        },
      });
      requestAnimationFrame(function () { if (_drillChart) _drillChart.resize(); });
    }

    // Wire range buttons
    rangeBar.querySelectorAll('[data-drill-range]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        rangeBar.querySelectorAll('[data-drill-range]').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        const r = btn.getAttribute('data-drill-range');
        buildChart(r === '0' ? 0 : parseInt(r, 10));
      });
    });

    buildChart(6);
  }

  /**
   * Renders a scrollable bar chart in the drill-down panel.
   * @param {HTMLElement} container
   * @param {object} opts  { getData: fn(summaries) → {labels, values, colors}, yFormat, barColor }
   */
  function renderDrillBarChart(container, opts) {
    const { gridColor, textColor } = getChartColors();

    // Time range selector
    const rangeBar = document.createElement('div');
    rangeBar.style.cssText = 'margin-bottom:16px;';
    rangeBar.innerHTML = `
      <div class="segmented-control" style="width:100%;">
        <button class="segmented-btn" data-drill-range="3">3M</button>
        <button class="segmented-btn active" data-drill-range="6">6M</button>
        <button class="segmented-btn" data-drill-range="12">12M</button>
        <button class="segmented-btn" data-drill-range="0">All</button>
      </div>
    `;
    container.appendChild(rangeBar);

    // Scrollable canvas wrapper
    const scrollWrapper = document.createElement('div');
    scrollWrapper.style.cssText = 'overflow-x:auto;-webkit-overflow-scrolling:touch;';
    const innerWrapper = document.createElement('div');
    innerWrapper.style.cssText = 'position:relative;height:260px;min-width:100%;';
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;height:260px;';
    innerWrapper.appendChild(canvas);
    scrollWrapper.appendChild(innerWrapper);
    container.appendChild(scrollWrapper);

    // Tooltip
    const tooltip = document.createElement('div');
    tooltip.style.cssText = `
      margin-top: 16px;
      padding: 12px 16px;
      background: var(--bg-secondary);
      border-radius: 12px;
      font-size: 14px;
      color: var(--text-primary);
      min-height: 44px;
      display: flex;
      align-items: center;
    `;
    tooltip.innerHTML = '<span style="color:var(--text-secondary);">Tap a bar to see details</span>';
    container.appendChild(tooltip);

    function buildChart(range) {
      _drillChart = destroyChart(_drillChart);

      const filtered = filterSummaries(_allSummaries, range);
      const { labels, values, colors } = opts.getData(filtered);

      // Make chart wide enough to scroll if many bars
      const barWidth = Math.max(48, Math.floor((window.innerWidth - 32) / Math.max(labels.length, 1)));
      const chartWidth = Math.max(window.innerWidth - 32, labels.length * barWidth);
      canvas.width  = chartWidth;
      canvas.height = 260;
      innerWrapper.style.width = chartWidth + 'px';

      _drillChart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [{
            data: values,
            backgroundColor: colors || opts.barColor || '#6C63FF',
            borderRadius: 8,
            borderSkipped: false,
          }],
        },
        options: {
          responsive: false,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { enabled: false },
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: textColor, maxRotation: 0 },
            },
            y: {
              grid: { color: gridColor },
              ticks: {
                color: textColor,
                callback: function (v) {
                  return opts.yFormat ? opts.yFormat(v) : ('$' + (v / 1000).toFixed(0) + 'k');
                },
              },
            },
          },
          onClick: function (event, elements) {
            if (elements && elements.length > 0) {
              const idx = elements[0].index;
              const val = opts.yFormat ? opts.yFormat(values[idx]) : formatCurrencyFull(values[idx]);
              tooltip.innerHTML = `
                <div>
                  <span style="font-weight:600;">${labels[idx]}:</span>&nbsp;${val}
                </div>
              `;
            }
          },
        },
      });
    }

    rangeBar.querySelectorAll('[data-drill-range]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        rangeBar.querySelectorAll('[data-drill-range]').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        const r = btn.getAttribute('data-drill-range');
        buildChart(r === '0' ? 0 : parseInt(r, 10));
      });
    });

    buildChart(6);
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  const AnalyticsScreen = {

    // ── init ──────────────────────────────────────────────────────────────────

    init: async function () {
      const myGeneration = ++_generation;

      try {
        let [summaries, transactions, categories] = await Promise.all([
          FinanceDB.getAllMonthlySummaries(),
          FinanceDB.getAllTransactions(),
          FinanceDB.getCategories(),
        ]);

        _allTransactions = transactions || [];
        _allCategories   = categories   || [];

        if ((!summaries || summaries.length === 0) && _allTransactions.length > 0) {
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

        hideEl('analytics-empty');
        showEl('analytics-data');

        AnalyticsScreen._updateRangeButtons(_activeRange);

        // Wait for CSS transition + layout before rendering charts
        // (single wait — no safety-net re-render to prevent flicker)
        await new Promise(function (resolve) { setTimeout(resolve, 380); });

        if (myGeneration !== _generation) return; // superseded

        // Wait for Chart.js
        let waited = 0;
        while (typeof Chart === 'undefined' && waited < 5000) {
          await new Promise(function (resolve) { setTimeout(resolve, 100); });
          waited += 100;
        }

        if (myGeneration !== _generation) return;

        AnalyticsScreen.setTimeRange(_activeRange);

        // Default calendar to most recent month
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

      } catch (err) {
        console.error('[AnalyticsScreen] init failed:', err);
      }
    },

    // ── setTimeRange ──────────────────────────────────────────────────────────

    setTimeRange: function (months) {
      _activeRange = months;
      AnalyticsScreen._updateRangeButtons(months);

      const filteredSummaries    = filterSummaries(_allSummaries, months);
      const filteredTransactions = filterTransactions(_allTransactions, months);
      const catMap               = buildCategoryMap(_allCategories);

      AnalyticsScreen.renderOverviewCard(filteredSummaries);
      AnalyticsScreen.renderCategoryChart(filteredTransactions, _allCategories, catMap);
      AnalyticsScreen.renderSavingsRateChart(filteredSummaries);
      AnalyticsScreen.renderTopMerchants(filteredTransactions, catMap);
    },

    // ── renderOverviewCard ────────────────────────────────────────────────────

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

        <div class="overview-row overview-row-tappable" data-drill="income" role="button" tabindex="0"
             aria-label="View income history chart" style="cursor:pointer;">
          <span class="overview-label">Total Income</span>
          <span style="display:flex;align-items:center;gap:8px;">
            <span class="overview-value" style="color:var(--success);">${formatCurrency(totalIncome)}</span>
            <span style="font-size:12px;color:var(--text-secondary);">›</span>
          </span>
        </div>
        <div class="overview-row overview-row-tappable" data-drill="expenses" role="button" tabindex="0"
             aria-label="View expenses history chart" style="cursor:pointer;">
          <span class="overview-label">Total Expenses</span>
          <span style="display:flex;align-items:center;gap:8px;">
            <span class="overview-value" style="color:var(--danger);">− ${formatCurrency(totalExpenses)}</span>
            <span style="font-size:12px;color:var(--text-secondary);">›</span>
          </span>
        </div>

        <div class="overview-divider"></div>

        <div class="overview-net-row overview-row-tappable" data-drill="net" role="button" tabindex="0"
             aria-label="View net savings chart" style="cursor:pointer;">
          <span class="overview-net-label">Net Saved</span>
          <span style="display:flex;align-items:center;gap:8px;">
            <span class="overview-net-value" style="color:${netColor};">= ${formatCurrency(netSaved)} ${netIcon}</span>
            <span style="font-size:12px;color:var(--text-secondary);">›</span>
          </span>
        </div>

        <div class="overview-stats-grid" style="margin-top:16px;">
          <div class="overview-stat-item overview-row-tappable" data-drill="avg-income" role="button" tabindex="0"
               aria-label="View average income chart" style="cursor:pointer;">
            <div class="overview-stat-value">${formatCurrency(avgIncome)}</div>
            <div class="overview-stat-label">Avg/mo Income <span style="font-size:10px;">›</span></div>
          </div>
          <div class="overview-stat-item overview-row-tappable" data-drill="avg-spend" role="button" tabindex="0"
               aria-label="View average spend chart" style="cursor:pointer;">
            <div class="overview-stat-value">${formatCurrency(avgSpend)}</div>
            <div class="overview-stat-label">Avg/mo Spend <span style="font-size:10px;">›</span></div>
          </div>
          <div class="overview-stat-item overview-row-tappable" data-drill="savings-rate" role="button" tabindex="0"
               aria-label="View savings rate chart" style="cursor:pointer;">
            <div class="overview-stat-value">
              <span class="savings-badge ${badgeClass}">${savingsRate}%</span>
            </div>
            <div class="overview-stat-label">Savings Rate <span style="font-size:10px;">›</span></div>
          </div>
        </div>
      `;

      // Wire tappable rows
      container.querySelectorAll('.overview-row-tappable').forEach(function (row) {
        function handleTap() {
          const drill = row.getAttribute('data-drill');
          AnalyticsScreen._openDrilldown(drill);
        }
        row.addEventListener('click', handleTap);
        row.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleTap(); }
        });
      });
    },

    // ── _openDrilldown ────────────────────────────────────────────────────────

    _openDrilldown: function (type) {
      switch (type) {

        case 'income':
          openDrilldown('Total Income Over Time', function (container) {
            renderDrillLineChart(container, {
              datasets: function (filtered) {
                return [{
                  label: 'Income',
                  data: filtered.map(function (s) { return s.totalIncome || 0; }),
                  borderColor: '#10B981',
                  backgroundColor: 'rgba(16,185,129,0.1)',
                  fill: true,
                  tension: 0.4,
                  pointRadius: 5,
                  pointHoverRadius: 8,
                  pointBackgroundColor: '#10B981',
                }];
              },
            });
          });
          break;

        case 'expenses':
          openDrilldown('Total Expenses Over Time', function (container) {
            renderDrillLineChart(container, {
              datasets: function (filtered) {
                return [{
                  label: 'Expenses',
                  data: filtered.map(function (s) { return s.totalExpenses || 0; }),
                  borderColor: '#EF4444',
                  backgroundColor: 'rgba(239,68,68,0.08)',
                  fill: true,
                  tension: 0.4,
                  pointRadius: 5,
                  pointHoverRadius: 8,
                  pointBackgroundColor: '#EF4444',
                }];
              },
            });
          });
          break;

        case 'net':
          openDrilldown('Income, Expenses & Net Saved', function (container) {
            renderDrillLineChart(container, {
              datasets: function (filtered) {
                return [
                  {
                    label: 'Income',
                    data: filtered.map(function (s) { return s.totalIncome || 0; }),
                    borderColor: '#10B981',
                    backgroundColor: 'transparent',
                    tension: 0.4,
                    pointRadius: 4,
                    pointHoverRadius: 7,
                    pointBackgroundColor: '#10B981',
                  },
                  {
                    label: 'Expenses',
                    data: filtered.map(function (s) { return s.totalExpenses || 0; }),
                    borderColor: '#EF4444',
                    backgroundColor: 'transparent',
                    tension: 0.4,
                    pointRadius: 4,
                    pointHoverRadius: 7,
                    pointBackgroundColor: '#EF4444',
                  },
                  {
                    label: 'Net Saved',
                    data: filtered.map(function (s) { return (s.totalIncome || 0) - (s.totalExpenses || 0); }),
                    // Use white in dark mode, near-black in light mode
                    borderColor: (document.documentElement.getAttribute('data-theme') === 'dark') ? '#FFFFFF' : '#1A1A2E',
                    backgroundColor: 'transparent',
                    borderWidth: 2.5,
                    tension: 0.4,
                    pointRadius: 4,
                    pointHoverRadius: 7,
                    pointBackgroundColor: (document.documentElement.getAttribute('data-theme') === 'dark') ? '#FFFFFF' : '#1A1A2E',
                  },
                ];
              },
            });
          });
          break;

        case 'avg-income':
          openDrilldown('Average Monthly Income', function (container) {
            renderDrillBarChart(container, {
              getData: function (filtered) {
                return {
                  labels: filtered.map(function (s) { return monthKeyToShort(s.monthKey); }),
                  values: filtered.map(function (s) { return s.totalIncome || 0; }),
                  colors: filtered.map(function () { return 'rgba(16,185,129,0.8)'; }),
                };
              },
              barColor: 'rgba(16,185,129,0.8)',
            });
          });
          break;

        case 'avg-spend':
          openDrilldown('Average Monthly Spend', function (container) {
            renderDrillBarChart(container, {
              getData: function (filtered) {
                return {
                  labels: filtered.map(function (s) { return monthKeyToShort(s.monthKey); }),
                  values: filtered.map(function (s) { return s.totalExpenses || 0; }),
                  colors: filtered.map(function () { return 'rgba(239,68,68,0.75)'; }),
                };
              },
              barColor: 'rgba(239,68,68,0.75)',
            });
          });
          break;

        case 'savings-rate':
          openDrilldown('Monthly Savings Rate', function (container) {
            renderDrillBarChart(container, {
              getData: function (filtered) {
                return {
                  labels: filtered.map(function (s) { return monthKeyToShort(s.monthKey); }),
                  values: filtered.map(function (s) {
                    if (!s.totalIncome || s.totalIncome === 0) return 0;
                    return Math.round((s.netSavings / s.totalIncome) * 100);
                  }),
                  colors: filtered.map(function (s) {
                    const rate = s.totalIncome > 0 ? (s.netSavings / s.totalIncome) * 100 : 0;
                    return getSavingsRateColor(rate);
                  }),
                };
              },
              yFormat: function (v) { return v + '%'; },
            });
          });
          break;
      }
    },

    // ── renderCategoryChart ───────────────────────────────────────────────────

    renderCategoryChart: function (transactions, categories, catMap) {
      _categoryChart = destroyChart(_categoryChart);

      const container = el('category-chart-container');
      if (!container) return;
      // Replace canvas to get a fresh context (iOS fix)
      container.innerHTML = '<canvas id="category-chart" style="display:block;width:100%;height:200px;"></canvas>';
      const canvas = el('category-chart');

      if (!transactions || transactions.length === 0) return;

      const EXCLUDED = ['income', 'transfer'];
      const catTotals = {};
      transactions.forEach(function (t) {
        const amt = t.amount || 0;
        if (amt >= 0) return;
        const catId = t.categoryId || 'other';
        if (EXCLUDED.includes(catId)) return;
        catTotals[catId] = (catTotals[catId] || 0) + Math.abs(amt);
      });

      const entries = Object.entries(catTotals)
        .filter(function ([, amt]) { return amt > 0; })
        .sort(function ([, a], [, b]) { return b - a; });

      if (entries.length === 0) return;

      const { gridColor, textColor } = getChartColors();
      const chartHeight = Math.max(200, entries.length * 44);
      container.style.height = chartHeight + 'px';

      _categoryChart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: entries.map(function ([catId]) {
            const cat = catMap[catId];
            return cat ? (cat.emoji + ' ' + cat.name) : catId;
          }),
          datasets: [{
            data: entries.map(function ([, amt]) { return amt; }),
            backgroundColor: entries.map(function ([catId]) {
              const cat = catMap[catId];
              return cat ? cat.color : '#BDC3C7';
            }),
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
                label: function (ctx) { return ' ' + formatCurrency(ctx.raw); },
              },
            },
          },
          scales: {
            x: {
              grid: { color: gridColor },
              ticks: { color: textColor, callback: function (v) { return '$' + v.toLocaleString(); } },
            },
            y: {
              grid: { display: false },
              ticks: { color: textColor },
            },
          },
          onClick: function (event, elements) {
            if (elements && elements.length > 0) {
              const catId = entries[elements[0].index] && entries[elements[0].index][0];
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

    renderSavingsRateChart: function (summaries) {
      _savingsChart = destroyChart(_savingsChart);

      const savingsOld = el('savings-chart');
      if (!savingsOld) return;
      const savingsContainer = savingsOld.parentElement;
      if (!savingsContainer) return;
      savingsContainer.innerHTML = '<canvas id="savings-chart" style="display:block;width:100%;height:180px;"></canvas>';
      const canvas = el('savings-chart');

      if (!summaries || summaries.length === 0) return;

      const { gridColor, textColor } = getChartColors();

      _savingsChart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: summaries.map(function (s) { return monthKeyToShort(s.monthKey); }),
          datasets: [{
            data: summaries.map(function (s) {
              if (!s.totalIncome || s.totalIncome === 0) return 0;
              return Math.round((s.netSavings / s.totalIncome) * 100);
            }),
            backgroundColor: summaries.map(function (s) {
              const rate = s.totalIncome > 0 ? (s.netSavings / s.totalIncome) * 100 : 0;
              return getSavingsRateColor(rate);
            }),
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
                label: function (ctx) { return ' Savings Rate: ' + ctx.raw + '%'; },
              },
            },
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: textColor } },
            y: {
              min: 0,
              max: 100,
              grid: { color: gridColor },
              ticks: { color: textColor, callback: function (v) { return v + '%'; } },
            },
          },
        },
      });
      requestAnimationFrame(function () { if (_savingsChart) _savingsChart.resize(); });
    },

    // ── renderTopMerchants ────────────────────────────────────────────────────

    renderTopMerchants: function (transactions, catMap) {
      const container = el('top-merchants-list');
      if (!container) return;

      if (!transactions || transactions.length === 0) {
        container.innerHTML = '<p style="color:var(--text-secondary);font-size:14px;text-align:center;padding:16px 0;">No transactions in this period</p>';
        return;
      }

      const merchantTotals = {};
      const merchantCat    = {};
      transactions.forEach(function (t) {
        const amt = t.amount || 0;
        if (amt >= 0) return;
        const name = t.merchantName || t.description || 'Unknown';
        merchantTotals[name] = (merchantTotals[name] || 0) + Math.abs(amt);
        if (!merchantCat[name] && t.categoryId) merchantCat[name] = t.categoryId;
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

    renderCalendar: function (transactions, year, month) {
      const container  = el('spending-calendar');
      const monthLabel = el('calendar-month-label');
      if (!container) return;

      const labelDate = new Date(year, month, 1);
      if (monthLabel) {
        monthLabel.textContent = labelDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      }

      const spendMap = {};
      const monthKey = year + '-' + String(month + 1).padStart(2, '0');
      transactions.forEach(function (t) {
        if (!t.date) return;
        if (t.monthKey && t.monthKey !== monthKey) return;
        const amt = t.amount || 0;
        if (amt >= 0) return;
        const dateStr = t.date.length > 10 ? t.date.substring(0, 10) : t.date;
        spendMap[dateStr] = (spendMap[dateStr] || 0) + Math.abs(amt);
      });

      const daysInMonth    = new Date(year, month + 1, 0).getDate();
      const firstDayOfWeek = new Date(year, month, 1).getDay();
      const startOffset    = (firstDayOfWeek + 6) % 7;

      const today    = new Date();
      const todayStr = today.getFullYear() + '-' +
        String(today.getMonth() + 1).padStart(2, '0') + '-' +
        String(today.getDate()).padStart(2, '0');

      const dayHeaders = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
      let html = '<div class="calendar-grid">';
      dayHeaders.forEach(function (d) { html += '<div class="calendar-day-header">' + d + '</div>'; });
      for (let i = 0; i < startOffset; i++) { html += '<div class="calendar-day empty"></div>'; }

      for (let day = 1; day <= daysInMonth; day++) {
        const dateStr  = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
        const spend    = spendMap[dateStr] || 0;
        const bgColor  = getDayColor(spend);
        const isToday  = dateStr === todayStr;
        const txtColor = spend >= 75 ? '#ffffff' : 'var(--text-primary)';
        html += `<div class="calendar-day${isToday ? ' today' : ''}"
                      style="background:${bgColor};color:${txtColor};"
                      data-date="${dateStr}" role="button" tabindex="0"
                      aria-label="${dateStr}${spend > 0 ? ' $' + Math.round(spend) : ''}">${day}</div>`;
      }
      html += '</div>';
      container.innerHTML = html;

      container.querySelectorAll('.calendar-day:not(.empty)').forEach(function (cell) {
        cell.addEventListener('click', function () {
          const date = cell.getAttribute('data-date');
          if (!date) return;
          navigateTo('transactions');
          if (typeof onScreenActivated === 'function') {
            onScreenActivated('transactions', { monthKey: date.substring(0, 7) });
          }
        });
        cell.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') cell.click();
        });
      });
    },

    // ── navigateCalendarMonth ─────────────────────────────────────────────────

    navigateCalendarMonth: function (direction) {
      if (direction === 'prev') {
        _calendarMonth--;
        if (_calendarMonth < 0) { _calendarMonth = 11; _calendarYear--; }
      } else {
        _calendarMonth++;
        if (_calendarMonth > 11) { _calendarMonth = 0; _calendarYear++; }
      }
      AnalyticsScreen.renderCalendar(_allTransactions, _calendarYear, _calendarMonth);
    },

    // ── _showEmptyState ───────────────────────────────────────────────────────

    _showEmptyState: function () {
      showEl('analytics-empty');
      hideEl('analytics-data');
    },

    // ── _updateRangeButtons ───────────────────────────────────────────────────

    _updateRangeButtons: function (activeRange) {
      const selector = el('time-range-selector');
      if (!selector) return;
      selector.querySelectorAll('.segmented-btn').forEach(function (btn) {
        const range    = btn.getAttribute('data-range');
        const rangeVal = (range === 'week' || range === 'month') ? range : parseInt(range, 10);
        btn.classList.toggle('active', String(rangeVal) === String(activeRange));
      });
    },

  }; // end AnalyticsScreen

  // ─── Theme Change Listener ──────────────────────────────────────────────────
  document.addEventListener('themeChanged', function () {
    const screen = el('screen-analytics');
    if (screen && screen.classList.contains('active') && _allSummaries.length > 0) {
      AnalyticsScreen.setTimeRange(_activeRange);
    }
  });

  global.AnalyticsScreen = AnalyticsScreen;

})(window);

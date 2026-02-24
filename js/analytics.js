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

  let _trendChart      = null;
  let _categoryChart   = null;
  let _savingsChart    = null;
  let _cumulativeChart = null;
  let _drillChart      = null;   // chart inside the drill-down overlay
  let _detailChart     = null;   // chart inside the cumulative detail overlay

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

  // ─── Drill-Down Gesture State ────────────────────────────────────────────────
  var _drillGesture = {
    active:     false,
    startX:     0,
    startY:     0,
    lastX:      0,
    lastY:      0,
    startTime:  0,
    direction:  null, // 'horizontal' | 'vertical' | null
  };

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

    // Lock body scroll so the analytics page doesn't scroll behind the overlay
    // (iOS ignores position:fixed for scroll prevention without this)
    document.body.style.overflow = 'hidden';

    // Show overlay — start off-screen right, slide in
    overlay.style.transition = 'none';
    overlay.style.transform  = 'translateX(100%)';
    overlay.style.opacity    = '0';
    overlay.style.display    = 'flex';
    // Scroll content to top so chart is immediately visible
    content.scrollTop = 0;
    requestAnimationFrame(function () {
      overlay.style.transition = 'transform 0.32s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease';
      overlay.style.transform  = 'translateX(0)';
      overlay.style.opacity    = '1';
    });

    // Wire back button (replace to avoid duplicate listeners)
    if (backBtn) {
      const newBack = backBtn.cloneNode(true);
      backBtn.parentNode.replaceChild(newBack, backBtn);
      newBack.addEventListener('click', closeDrilldown);
    }

    // ── Swipe gesture: follow finger, spring back or dismiss (Fix 8 + B2) ──
    // Use addEventListener with passive:false so preventDefault() works on iOS

    // Edge width for swipe-back gesture — matches iOS native behavior (~28px from left edge)
    var EDGE_WIDTH = 28;

    // Find the header element inside the overlay (the drag handle zone)
    var overlayHeader = overlay.querySelector('.screen-header');

    function _isOnHeader(touch) {
      if (!overlayHeader) return false;
      var rect = overlayHeader.getBoundingClientRect();
      return touch.clientY >= rect.top && touch.clientY <= rect.bottom;
    }

    function _onTouchStart(e) {
      _drillGesture.active    = true;
      _drillGesture.startX    = e.touches[0].clientX;
      _drillGesture.startY    = e.touches[0].clientY;
      _drillGesture.lastX     = e.touches[0].clientX;
      _drillGesture.lastY     = e.touches[0].clientY;
      _drillGesture.startTime = Date.now();
      _drillGesture.direction = null;
      // Horizontal back-swipe: only from left edge (like iOS)
      _drillGesture.edgeSwipe   = e.touches[0].clientX <= EDGE_WIDTH;
      // Vertical pull-down: only when dragging the header bar
      _drillGesture.headerSwipe = _isOnHeader(e.touches[0]);
      overlay.style.transition = 'none';
    }

    function _onTouchMove(e) {
      if (!_drillGesture.active) return;
      var dx = e.touches[0].clientX - _drillGesture.startX;
      var dy = e.touches[0].clientY - _drillGesture.startY;
      _drillGesture.lastX = e.touches[0].clientX;
      _drillGesture.lastY = e.touches[0].clientY;

      if (!_drillGesture.direction) {
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
          _drillGesture.direction = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
        }
        return;
      }

      var w = overlay.offsetWidth  || window.innerWidth;
      var h = overlay.offsetHeight || window.innerHeight;

      if (_drillGesture.direction === 'horizontal' && dx > 0 && _drillGesture.edgeSwipe) {
        // Left-edge swipe-back: slide overlay right
        overlay.style.transform = 'translateX(' + dx + 'px)';
        overlay.style.opacity   = String(Math.max(0.3, 1 - dx / w));
        e.preventDefault();
      } else if (_drillGesture.direction === 'vertical' && dy > 0 && _drillGesture.headerSwipe) {
        // Header pull-down: anchor overlay to finger, slide down
        overlay.style.transform = 'translateY(' + dy + 'px)';
        overlay.style.opacity   = String(Math.max(0.3, 1 - dy / h));
        e.preventDefault();
      }
    }

    function _onTouchEnd(e) {
      if (!_drillGesture.active) return;
      _drillGesture.active = false;

      var dx      = _drillGesture.lastX - _drillGesture.startX;
      var dy      = _drillGesture.lastY - _drillGesture.startY;
      var elapsed = Date.now() - _drillGesture.startTime;
      var vx      = Math.abs(dx) / elapsed;
      var vy      = Math.abs(dy) / elapsed;
      var dir     = _drillGesture.direction;
      var w       = overlay.offsetWidth  || window.innerWidth;
      var h       = overlay.offsetHeight || window.innerHeight;

      // Horizontal dismiss only if it started as an edge swipe
      var dismissH = dir === 'horizontal' && dx > 0 && _drillGesture.edgeSwipe && (dx > w * 0.4 || vx > 0.4);
      // Vertical dismiss only if it started as a header swipe
      var dismissV = dir === 'vertical' && dy > 0 && _drillGesture.headerSwipe && (dy > h * 0.35 || vy > 0.35);

      overlay.style.transition = 'transform 0.28s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease';

      if (dismissH) {
        overlay.style.transform = 'translateX(100%)';
        overlay.style.opacity   = '0';
        _finishCloseDrilldown();
      } else if (dismissV) {
        overlay.style.transform = 'translateY(100%)';
        overlay.style.opacity   = '0';
        _finishCloseDrilldown();
      } else {
        // Spring back to full position
        overlay.style.transform = 'translateX(0) translateY(0)';
        overlay.style.opacity   = '1';
      }
    }

    // Store refs so we can remove them in closeDrilldownInstant
    overlay._touchStart = _onTouchStart;
    overlay._touchMove  = _onTouchMove;
    overlay._touchEnd   = _onTouchEnd;

    overlay.addEventListener('touchstart', _onTouchStart, { passive: true });
    overlay.addEventListener('touchmove',  _onTouchMove,  { passive: false }); // passive:false needed for preventDefault
    overlay.addEventListener('touchend',   _onTouchEnd,   { passive: true });

    // Wait for the slide-in animation to complete (320ms) before rendering the chart.
    // Rendering during the animation causes Chart.js to measure wrong canvas dimensions
    // because the overlay is still off-screen / partially translated.
    setTimeout(function () {
      content.scrollTop = 0;
      renderFn(content);
      // Ensure scroll is at top after chart DOM is built
      requestAnimationFrame(function () {
        content.scrollTop = 0;
      });
    }, 340);
  }

  /**
   * Finishes closing the drill-down after the animation completes.
   * Restores parent screen scroll immediately (Fix B3).
   */
  function _removeDrillGestureListeners(overlay) {
    if (!overlay) return;
    if (overlay._touchStart) overlay.removeEventListener('touchstart', overlay._touchStart);
    if (overlay._touchMove)  overlay.removeEventListener('touchmove',  overlay._touchMove);
    if (overlay._touchEnd)   overlay.removeEventListener('touchend',   overlay._touchEnd);
    overlay._touchStart = null;
    overlay._touchMove  = null;
    overlay._touchEnd   = null;
  }

  function _finishCloseDrilldown() {
    const overlay = el('analytics-drilldown');

    // Restore body scroll
    document.body.style.overflow = '';

    // Hide and clean up after animation
    setTimeout(function () {
      if (overlay) {
        overlay.style.display    = 'none';
        overlay.style.transform  = 'translateX(100%)';
        overlay.style.opacity    = '1'; // reset for next open
        overlay.style.transition = 'none';
        _removeDrillGestureListeners(overlay);
      }
      _drillChart = destroyChart(_drillChart);
    }, 320);
  }

  function closeDrilldown() {
    const overlay = el('analytics-drilldown');
    if (!overlay) return;
    overlay.style.transition = 'transform 0.28s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease';
    overlay.style.transform  = 'translateX(100%)';
    overlay.style.opacity    = '0';
    _finishCloseDrilldown();
  }

  /**
   * Closes the drill-down instantly (no animation) — used when switching tabs (Fix B1).
   */
  function closeDrilldownInstant() {
    const overlay = el('analytics-drilldown');
    if (!overlay) return;
    overlay.style.transition = 'none';
    overlay.style.transform  = 'translateX(100%)';
    overlay.style.opacity    = '1';
    overlay.style.display    = 'none';
    _removeDrillGestureListeners(overlay);
    _drillChart = destroyChart(_drillChart);
    document.body.style.overflow = '';
  }

  // ─── Drill-Down Chart Builders ───────────────────────────────────────────────

  /**
   * Renders a line chart in the drill-down panel.
   * @param {HTMLElement} container
   * @param {object} opts  { labels, datasets, yFormat }
   */
  /**
   * Renders a scrollable line chart with sticky y-axis (Fix 2).
   * Shows 6 months of data at a time; user can scroll to see more.
   * @param {HTMLElement} container
   * @param {object} opts  { datasets: fn(summaries), yFormat }
   */
  function renderDrillLineChart(container, opts) {
    const { gridColor, textColor } = getChartColors();
    const Y_AXIS_WIDTH = 52;
    const POINT_WIDTH  = 64; // px per data point — controls scroll density

    // Time range selector
    const rangeBar = document.createElement('div');
    rangeBar.style.cssText = 'margin-bottom:16px;';
    var _initRange = (typeof _activeRange !== 'undefined' ? _activeRange : 6);
    rangeBar.innerHTML = `
      <div class="segmented-control" style="width:100%;">
        <button class="segmented-btn${_initRange===3?' active':''}" data-drill-range="3">3M</button>
        <button class="segmented-btn${(_initRange===6||_initRange==='6')?' active':''}" data-drill-range="6">6M</button>
        <button class="segmented-btn${_initRange===12?' active':''}" data-drill-range="12">12M</button>
        <button class="segmented-btn${_initRange===0?' active':''}" data-drill-range="0">All</button>
      </div>
    `;
    container.appendChild(rangeBar);

    // Legend (for multi-dataset charts)
    const legendEl = document.createElement('div');
    legendEl.style.cssText = 'display:flex;gap:16px;flex-wrap:wrap;margin-bottom:8px;min-height:20px;';
    container.appendChild(legendEl);

    // Outer wrapper: flex row — sticky y-axis on left, scrollable chart on right
    const outerWrapper = document.createElement('div');
    outerWrapper.style.cssText = 'display:flex;align-items:stretch;height:260px;';

    // Sticky y-axis canvas
    const yAxisCanvas = document.createElement('canvas');
    yAxisCanvas.width  = Y_AXIS_WIDTH;
    yAxisCanvas.height = 260;
    yAxisCanvas.style.cssText = 'flex-shrink:0;width:' + Y_AXIS_WIDTH + 'px;height:260px;display:block;';
    outerWrapper.appendChild(yAxisCanvas);

    // Scrollable chart area
    const scrollWrapper = document.createElement('div');
    scrollWrapper.style.cssText = 'flex:1;overflow-x:auto;-webkit-overflow-scrolling:touch;';
    const innerWrapper = document.createElement('div');
    innerWrapper.style.cssText = 'position:relative;height:260px;min-width:100%;';
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;height:260px;';
    innerWrapper.appendChild(canvas);
    scrollWrapper.appendChild(innerWrapper);
    outerWrapper.appendChild(scrollWrapper);
    container.appendChild(outerWrapper);

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
      align-items: flex-start;
      flex-direction: column;
      gap: 4px;
    `;
    tooltip.innerHTML = '<span style="color:var(--text-secondary);">Tap a point to see details</span>';
    container.appendChild(tooltip);

    // Helper: draw sticky y-axis
    function drawYAxis(minVal, maxVal) {
      const ctx = yAxisCanvas.getContext('2d');
      ctx.clearRect(0, 0, Y_AXIS_WIDTH, 260);
      ctx.fillStyle = getChartColors().textColor;
      ctx.font = '10px -apple-system, sans-serif';
      ctx.textAlign = 'right';
      const steps = 5;
      const chartTop = 10, chartBottom = 240;
      const chartH = chartBottom - chartTop;
      for (var i = 0; i <= steps; i++) {
        var val = minVal + (maxVal - minVal) * (i / steps);
        var y   = chartBottom - (chartH * i / steps);
        var label = opts.yFormat ? opts.yFormat(Math.round(val)) :
          ('$' + (Math.abs(val) >= 1000 ? (val / 1000).toFixed(0) + 'k' : Math.round(val)));
        ctx.fillText(label, Y_AXIS_WIDTH - 4, y + 3);
      }
    }

    // Scroll-driven y-axis state — shared across buildChart calls
    var _scrollDatasets  = [];
    var _scrollPointWidth = POINT_WIDTH;
    var _yAxisRafId = null;

    /**
     * Redraws the sticky y-axis based on which data points are currently
     * visible in the scroll viewport. Called on every scroll event (rAF-throttled).
     */
    function _redrawYAxisForScroll() {
      if (!_drillChart || !_scrollDatasets.length) return;

      var scrollLeft   = scrollWrapper.scrollLeft;
      var visibleWidth = scrollWrapper.clientWidth;
      var totalPoints  = _scrollDatasets[0].data.length;
      var pw           = _scrollPointWidth;

      // Determine which point indices are currently visible
      // Each point occupies pw pixels; point i is centered at (i + 0.5) * pw
      var firstVisible = Math.max(0,             Math.floor(scrollLeft / pw));
      var lastVisible  = Math.min(totalPoints - 1, Math.ceil((scrollLeft + visibleWidth) / pw));

      // Collect values for visible points across all datasets
      var visibleVals = [];
      _scrollDatasets.forEach(function (ds) {
        for (var i = firstVisible; i <= lastVisible; i++) {
          if (ds.data[i] !== undefined) visibleVals.push(ds.data[i]);
        }
      });

      if (visibleVals.length === 0) return;

      var vMin = Math.min.apply(null, visibleVals);
      var vMax = Math.max.apply(null, visibleVals);
      var vPad = Math.max(Math.abs(vMax - vMin) * 0.12, 1);
      drawYAxis(vMin - vPad, vMax + vPad);
    }

    function buildChart(range) {
      _drillChart = destroyChart(_drillChart);

      // Remove previous scroll listener before rebuilding
      if (scrollWrapper._yAxisScrollHandler) {
        scrollWrapper.removeEventListener('scroll', scrollWrapper._yAxisScrollHandler);
        scrollWrapper._yAxisScrollHandler = null;
      }

      const filtered = filterSummaries(_allSummaries, range);
      const labels   = filtered.map(function (s) { return monthKeyToShort(s.monthKey); });
      const datasets = opts.datasets(filtered);

      // Compute all values for global y-axis range (used for Chart.js scale)
      var allVals = [];
      datasets.forEach(function (ds) { allVals = allVals.concat(ds.data || []); });
      var _rawMin = Math.min.apply(null, allVals);
      var _rawMax = Math.max.apply(null, allVals);
      var _pad    = Math.max(Math.abs(_rawMax - _rawMin) * 0.12, 1);
      var minVal  = _rawMin - _pad;
      var maxVal  = _rawMax + _pad;

      // Chart width: at least 6 points visible, scroll for more
      var availWidth = scrollWrapper.offsetWidth || (window.innerWidth - Y_AXIS_WIDTH - 32);
      var pointWidth = Math.max(POINT_WIDTH, Math.floor(availWidth / Math.min(6, labels.length)));
      var chartWidth = Math.max(availWidth, labels.length * pointWidth);
      canvas.width  = chartWidth;
      canvas.height = 260;
      innerWrapper.style.width = chartWidth + 'px';

      // Store for scroll-driven y-axis redraws
      _scrollDatasets   = datasets;
      _scrollPointWidth = pointWidth;

      // Scroll to show the most recent 6 months (rightmost)
      requestAnimationFrame(function () {
        scrollWrapper.scrollLeft = Math.max(0, scrollWrapper.scrollWidth - scrollWrapper.clientWidth);
      });

      // Build legend
      if (datasets.length > 1) {
        legendEl.innerHTML = datasets.map(function (ds) {
          return '<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--text-secondary);">' +
            '<span style="display:inline-block;width:20px;height:2px;background:' + (ds.borderColor || '#6C63FF') + ';border-radius:1px;"></span>' +
            ds.label + '</span>';
        }).join('');
      }

      _drillChart = new Chart(canvas, {
        type: 'line',
        data: { labels: labels, datasets: datasets },
        options: {
          responsive: false,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false }, // we draw our own legend above
            tooltip: { enabled: false },
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: textColor, maxRotation: 0 },
            },
            y: {
              min: minVal,
              max: maxVal,
              grid: { color: gridColor },
              ticks: { display: false }, // drawn on sticky canvas
            },
          },
          onClick: function (event, elements) {
            if (elements && elements.length > 0) {
              const idx   = elements[0].index;
              const items = _drillChart.data.datasets.map(function (ds) {
                const color = ds.borderColor || '#6C63FF';
                // Use signed format so negative net savings show correctly
                const rawVal = ds.data[idx];
                const val    = opts.yFormat
                  ? opts.yFormat(rawVal)
                  : ((rawVal < 0 ? '−' : '') + formatCurrencyFull(rawVal));
                return '<div style="display:flex;align-items:center;gap:6px;">' +
                  '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + color + ';flex-shrink:0;"></span>' +
                  '<strong>' + ds.label + ':</strong>&nbsp;' + val + '</div>';
              });
              tooltip.innerHTML =
                '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:4px;">' + _drillChart.data.labels[idx] + '</div>' +
                items.join('');
            }
          },
          animation: {
            onComplete: function () {
              // Initial y-axis draw after animation — use visible range
              _redrawYAxisForScroll();
            },
          },
        },
      });

      // ── Scroll-driven y-axis: redraw on every scroll (rAF-throttled) ──────
      function _onScroll() {
        if (_yAxisRafId) return; // already scheduled
        _yAxisRafId = requestAnimationFrame(function () {
          _yAxisRafId = null;
          _redrawYAxisForScroll();
        });
      }
      scrollWrapper._yAxisScrollHandler = _onScroll;
      scrollWrapper.addEventListener('scroll', _onScroll, { passive: true });
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

    buildChart(_initRange);
  }

  /**
   * Renders a scrollable bar chart with a sticky y-axis (Fix 6).
   * Layout: [sticky y-axis canvas | scrollable bars canvas]
   * @param {HTMLElement} container
   * @param {object} opts  { getData: fn(summaries) → {labels, values, colors}, yFormat, barColor }
   */
  function renderDrillBarChart(container, opts) {
    const { gridColor, textColor } = getChartColors();
    const Y_AXIS_WIDTH = 52; // px reserved for the sticky y-axis

    // Time range selector
    const rangeBar = document.createElement('div');
    rangeBar.style.cssText = 'margin-bottom:16px;';
    var _initRange2 = (typeof _activeRange !== 'undefined' ? _activeRange : 6);
    rangeBar.innerHTML = `
      <div class="segmented-control" style="width:100%;">
        <button class="segmented-btn${_initRange2===3?' active':''}" data-drill-range="3">3M</button>
        <button class="segmented-btn${(_initRange2===6||_initRange2==='6')?' active':''}" data-drill-range="6">6M</button>
        <button class="segmented-btn${_initRange2===12?' active':''}" data-drill-range="12">12M</button>
        <button class="segmented-btn${_initRange2===0?' active':''}" data-drill-range="0">All</button>
      </div>
    `;
    container.appendChild(rangeBar);

    // Outer wrapper: flex row — sticky y-axis on left, scrollable chart on right
    const outerWrapper = document.createElement('div');
    outerWrapper.style.cssText = 'display:flex;align-items:stretch;height:260px;';

    // Sticky y-axis canvas (fixed width, not scrollable)
    const yAxisCanvas = document.createElement('canvas');
    yAxisCanvas.width  = Y_AXIS_WIDTH;
    yAxisCanvas.height = 260;
    yAxisCanvas.style.cssText = 'flex-shrink:0;width:' + Y_AXIS_WIDTH + 'px;height:260px;display:block;';
    outerWrapper.appendChild(yAxisCanvas);

    // Scrollable bars area
    const scrollWrapper = document.createElement('div');
    scrollWrapper.style.cssText = 'flex:1;overflow-x:auto;-webkit-overflow-scrolling:touch;';
    const innerWrapper = document.createElement('div');
    innerWrapper.style.cssText = 'position:relative;height:260px;min-width:100%;';
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;height:260px;';
    innerWrapper.appendChild(canvas);
    scrollWrapper.appendChild(innerWrapper);
    outerWrapper.appendChild(scrollWrapper);
    container.appendChild(outerWrapper);

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

    // Helper: draw y-axis labels on the sticky canvas
    function drawYAxis(minVal, maxVal) {
      const ctx = yAxisCanvas.getContext('2d');
      ctx.clearRect(0, 0, Y_AXIS_WIDTH, 260);
      ctx.fillStyle = getChartColors().textColor;
      ctx.font = '10px -apple-system, sans-serif';
      ctx.textAlign = 'right';

      const steps = 5;
      const chartTop    = 10;
      const chartBottom = 240;
      const chartH      = chartBottom - chartTop;

      for (var i = 0; i <= steps; i++) {
        var val = minVal + (maxVal - minVal) * (i / steps);
        var y   = chartBottom - (chartH * i / steps);
        var label = opts.yFormat ? opts.yFormat(Math.round(val)) : ('$' + (Math.abs(val) >= 1000 ? (val / 1000).toFixed(0) + 'k' : Math.round(val)));
        ctx.fillText(label, Y_AXIS_WIDTH - 4, y + 3);
      }
    }

    function buildChart(range) {
      _drillChart = destroyChart(_drillChart);

      const filtered = filterSummaries(_allSummaries, range);
      const data = opts.getData(filtered);
      const { labels, values, colors } = data;

      // Compute min/max for y-axis with 12% padding so points aren't clipped
      var _bRawMin = Math.min.apply(null, values);
      var _bRawMax = Math.max.apply(null, values);
      var _bPad    = Math.max(Math.abs(_bRawMax - _bRawMin) * 0.12, 1);
      const minVal = _bRawMin - _bPad;
      const maxVal = _bRawMax + _bPad;

      // Make chart wide enough to scroll if many bars
      const availWidth = (window.innerWidth - Y_AXIS_WIDTH - 32);
      const barWidth   = Math.max(48, Math.floor(availWidth / Math.max(labels.length, 1)));
      const chartWidth = Math.max(availWidth, labels.length * barWidth);
      canvas.width  = chartWidth;
      canvas.height = 260;
      innerWrapper.style.width = chartWidth + 'px';

      // Build per-bar border styles for out-of-scale bars (Fix 3)
      var realRates  = data._realRates;
      var cap        = data._cap;
      var borderColors = [];
      var borderWidths = [];
      var borderDashes = [];
      var bgColors     = [];

      (colors || []).forEach(function (c, i) {
        var isOOS = realRates && cap && Math.abs(realRates[i]) > cap;
        if (isOOS) {
          // No fill — fully transparent background, dashed border only
          var baseColor = getSavingsRateColor(realRates[i]);
          bgColors.push('transparent');
          borderColors.push(baseColor);
          borderWidths.push(2);
          borderDashes.push([4, 3]);
        } else {
          bgColors.push(c || opts.barColor || '#6C63FF');
          borderColors.push('transparent');
          borderWidths.push(0);
          borderDashes.push([]);
        }
      });

      // If no per-bar styling needed, use simple colors
      if (!realRates) {
        bgColors = colors || opts.barColor || '#6C63FF';
      }

      _drillChart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [{
            data: values,
            backgroundColor: bgColors,
            borderColor: borderColors.length ? borderColors : undefined,
            borderWidth: borderWidths.length ? borderWidths : 0,
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
              min: minVal,
              max: maxVal,
              grid: { color: gridColor },
              ticks: {
                display: false, // drawn on sticky y-axis canvas
              },
            },
          },
          onClick: function (event, elements) {
            if (elements && elements.length > 0) {
              const idx = elements[0].index;
              if (opts.getTooltipContent) {
                // Custom tooltip (e.g. savings rate with out-of-scale note)
                tooltip.innerHTML = '<div>' + opts.getTooltipContent(idx, labels[idx]) + '</div>';
              } else {
                const val = opts.yFormat ? opts.yFormat(values[idx]) : formatCurrencyFull(values[idx]);
                tooltip.innerHTML = '<div><span style="font-weight:600;">' + labels[idx] + ':</span>&nbsp;' + val + '</div>';
              }
            }
          },
          animation: {
            onComplete: function () {
              drawYAxis(minVal, maxVal);
              // No additional drawing needed — opacity difference is sufficient
            },
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

    buildChart(_initRange2);
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  const AnalyticsScreen = {

    // ── init ──────────────────────────────────────────────────────────────────

    init: async function () {
      // Fix B1: If returning to analytics while drill-down is open, close it instantly
      closeDrilldownInstant();

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

      AnalyticsScreen.renderCumulativeSavingsChart(_allSummaries); // always uses ALL summaries for running total
      AnalyticsScreen._wireCumulativeCard();
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

    // ── _wireCumulativeCard ───────────────────────────────────────────────────

    /**
     * Wires the tap/click/keyboard handler on the cumulative chart card so it
     * opens the Google Stocks-style detail overlay.
     * Guards against double-binding with a flag.
     */
    _wireCumulativeCard: function () {
      const card = el('cumulative-chart-card');
      if (!card || card._drillWired) return;
      card._drillWired = true;

      function handleTap(e) {
        // Don't open if the tap was on the chart canvas itself
        if (e.target && e.target.tagName === 'CANVAS') return;
        AnalyticsScreen.openCumulativeDetail();
      }

      card.addEventListener('click', handleTap);
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); AnalyticsScreen.openCumulativeDetail(); }
      });
    },

    // ── openCumulativeDetail / closeCumulativeDetail / _renderCumulativeDetail

    openCumulativeDetail: function () {
      const overlay = el('cumulative-detail-overlay');
      if (!overlay) return;

      // Lock body scroll
      document.body.style.overflow = 'hidden';

      // Slide in
      overlay.style.transition = 'none';
      overlay.style.transform  = 'translateX(100%)';
      overlay.style.display    = 'flex';
      requestAnimationFrame(function () {
        overlay.style.transition = 'transform 0.32s cubic-bezier(0.4, 0, 0.2, 1)';
        overlay.style.transform  = 'translateX(0)';
      });

      // Wire back button (once)
      const backBtn = el('cumulative-detail-back');
      if (backBtn && !backBtn._wired) {
        backBtn._wired = true;
        backBtn.addEventListener('click', function () { AnalyticsScreen.closeCumulativeDetail(); });
      }

      // Wire range selector (once)
      const rangeSelector = el('cumdet-range-selector');
      if (rangeSelector && !rangeSelector._wired) {
        rangeSelector._wired = true;
        rangeSelector.querySelectorAll('[data-range]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            rangeSelector.querySelectorAll('[data-range]').forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            const r = btn.getAttribute('data-range');
            AnalyticsScreen._renderCumulativeDetail(r === '0' ? 0 : parseInt(r, 10));
          });
        });
      }

      // Swipe-to-dismiss (left-edge)
      var _g = { active: false, startX: 0, startY: 0, lastX: 0, direction: null, edgeSwipe: false };
      var EDGE_W = 28;
      function _ts(e) { _g.active = true; _g.startX = e.touches[0].clientX; _g.startY = e.touches[0].clientY; _g.lastX = _g.startX; _g.direction = null; _g.edgeSwipe = _g.startX <= EDGE_W; overlay.style.transition = 'none'; }
      function _tm(e) {
        if (!_g.active) return;
        var dx = e.touches[0].clientX - _g.startX, dy = e.touches[0].clientY - _g.startY;
        _g.lastX = e.touches[0].clientX;
        if (!_g.direction) { if (Math.abs(dx) > 8 || Math.abs(dy) > 8) _g.direction = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical'; return; }
        if (_g.direction === 'horizontal' && dx > 0 && _g.edgeSwipe) { overlay.style.transform = 'translateX(' + dx + 'px)'; overlay.style.opacity = String(Math.max(0.3, 1 - dx / (overlay.offsetWidth || window.innerWidth))); e.preventDefault(); }
      }
      function _te() {
        if (!_g.active) return; _g.active = false;
        var dx = _g.lastX - _g.startX, w = overlay.offsetWidth || window.innerWidth;
        overlay.style.transition = 'transform 0.28s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease';
        if (_g.direction === 'horizontal' && dx > 0 && _g.edgeSwipe && dx > w * 0.4) {
          overlay.style.transform = 'translateX(100%)'; overlay.style.opacity = '0';
          setTimeout(function () { overlay.style.display = 'none'; overlay.style.opacity = '1'; overlay.style.transition = 'none'; document.body.style.overflow = ''; }, 300);
        } else { overlay.style.transform = 'translateX(0)'; overlay.style.opacity = '1'; }
      }
      if (overlay._cumTS) { overlay.removeEventListener('touchstart', overlay._cumTS); overlay.removeEventListener('touchmove', overlay._cumTM); overlay.removeEventListener('touchend', overlay._cumTE); }
      overlay._cumTS = _ts; overlay._cumTM = _tm; overlay._cumTE = _te;
      overlay.addEventListener('touchstart', _ts, { passive: true });
      overlay.addEventListener('touchmove',  _tm, { passive: false });
      overlay.addEventListener('touchend',   _te, { passive: true });

      AnalyticsScreen._renderCumulativeDetail(12);
    },

    closeCumulativeDetail: function () {
      const overlay = el('cumulative-detail-overlay');
      if (!overlay) return;
      overlay.style.transition = 'transform 0.28s cubic-bezier(0.4, 0, 0.2, 1)';
      overlay.style.transform  = 'translateX(100%)';
      setTimeout(function () {
        overlay.style.display = 'none'; overlay.style.transition = 'none';
        document.body.style.overflow = '';
        if (_detailChart) { _detailChart.destroy(); _detailChart = null; }
      }, 300);
    },

    _renderCumulativeDetail: async function (rangeMonths) {
      try {
        const allSummaries = await FinanceDB.getAllMonthlySummaries();
        if (!allSummaries || allSummaries.length === 0) return;

        let filtered = allSummaries;
        if (rangeMonths > 0) filtered = allSummaries.slice(-rangeMonths);

        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const textColor = isDark ? '#94A3B8' : '#6B7280';
        const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
        const DPR = window.devicePixelRatio || 1;

        // Build cumulative data (carry forward running total from before the range)
        let baseRunning = 0;
        const startIdx = allSummaries.indexOf(filtered[0]);
        for (let i = 0; i < startIdx; i++) baseRunning += (allSummaries[i].netSavings || 0);

        let running = baseRunning;
        const labels = [], data = [], rawSavings = [];
        filtered.forEach(function (s) {
          running += (s.netSavings || 0);
          const mk = s.monthKey || '', parts = mk.split('-');
          const d = parts.length === 2 ? new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, 1) : null;
          labels.push(d ? d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }) : mk);
          data.push(Math.round(running * 100) / 100);
          rawSavings.push(Math.round((s.netSavings || 0) * 100) / 100);
        });

        const lastVal = data[data.length - 1] || 0, firstVal = data[0] || 0, change = lastVal - firstVal;
        const lineColor = lastVal >= 0 ? '#10B981' : '#EF4444';
        const fillColor = lastVal >= 0 ? 'rgba(16,185,129,0.10)' : 'rgba(239,68,68,0.08)';

        // Hero
        const heroVal = el('cumdet-hero-value'), heroChange = el('cumdet-hero-change'), heroRange = el('cumdet-hero-range');
        if (heroVal) { heroVal.textContent = (lastVal < 0 ? '-' : '') + '$' + Math.abs(lastVal).toLocaleString('en-US', { maximumFractionDigits: 0 }); heroVal.style.color = lastVal >= 0 ? 'var(--text-primary)' : '#EF4444'; }
        if (heroChange) { const sign = change >= 0 ? '+' : '-'; heroChange.textContent = sign + '$' + Math.abs(change).toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' (' + (rangeMonths > 0 ? 'last ' + rangeMonths + ' mo' : 'all time') + ')'; heroChange.style.color = change >= 0 ? '#10B981' : '#EF4444'; }
        if (heroRange) heroRange.textContent = labels.length > 0 ? labels[0] + ' – ' + labels[labels.length - 1] : '';

        // Stats
        const avgPerMonth = filtered.length > 0 ? Math.round(rawSavings.reduce(function (a, b) { return a + b; }, 0) / filtered.length) : 0;
        let bestIdx = 0, worstIdx = 0;
        rawSavings.forEach(function (v, i) { if (v > rawSavings[bestIdx]) bestIdx = i; if (v < rawSavings[worstIdx]) worstIdx = i; });
        const statTotal = el('cumdet-stat-total'), statAvg = el('cumdet-stat-avg'), statBest = el('cumdet-stat-best'), statBestL = el('cumdet-stat-best-label'), statWorst = el('cumdet-stat-worst'), statWorstL = el('cumdet-stat-worst-label');
        if (statTotal) { statTotal.textContent = (lastVal < 0 ? '-' : '+') + '$' + Math.abs(lastVal).toLocaleString('en-US', { maximumFractionDigits: 0 }); statTotal.style.color = lastVal >= 0 ? '#10B981' : '#EF4444'; }
        if (statAvg) { statAvg.textContent = (avgPerMonth < 0 ? '-' : '+') + '$' + Math.abs(avgPerMonth).toLocaleString('en-US', { maximumFractionDigits: 0 }); statAvg.style.color = avgPerMonth >= 0 ? '#10B981' : '#EF4444'; }
        if (statBest && rawSavings.length > 0) statBest.textContent = '+$' + Math.abs(rawSavings[bestIdx]).toLocaleString('en-US', { maximumFractionDigits: 0 });
        if (statBestL && filtered[bestIdx]) statBestL.textContent = labels[bestIdx] || filtered[bestIdx].monthKey;
        if (statWorst && rawSavings.length > 0) statWorst.textContent = (rawSavings[worstIdx] < 0 ? '-' : '') + '$' + Math.abs(rawSavings[worstIdx]).toLocaleString('en-US', { maximumFractionDigits: 0 });
        if (statWorstL && filtered[worstIdx]) statWorstL.textContent = labels[worstIdx] || filtered[worstIdx].monthKey;

        // Chart
        if (_detailChart) { _detailChart.destroy(); _detailChart = null; }
        const chartCanvas = el('cumdet-chart'), yAxisCanvas = el('cumdet-yaxis');
        if (!chartCanvas || !yAxisCanvas) return;
        const CHART_H = 260, Y_AXIS_W = 56;
        const containerW = chartCanvas.parentElement ? chartCanvas.parentElement.offsetWidth : (window.innerWidth - Y_AXIS_W - 32);
        chartCanvas.width = containerW; chartCanvas.height = CHART_H; chartCanvas.style.width = containerW + 'px'; chartCanvas.style.height = CHART_H + 'px';
        yAxisCanvas.width = Y_AXIS_W * DPR; yAxisCanvas.height = CHART_H * DPR; yAxisCanvas.style.width = Y_AXIS_W + 'px'; yAxisCanvas.style.height = CHART_H + 'px';
        const dMin = Math.min.apply(null, data), dMax = Math.max.apply(null, data), pad = Math.max(Math.abs(dMax - dMin) * 0.12, 200);
        const yMin = dMin - pad, yMax = dMax + pad;

        function drawDetailYAxis() {
          var ctx = yAxisCanvas.getContext('2d'); ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, yAxisCanvas.width, yAxisCanvas.height); ctx.scale(DPR, DPR); ctx.fillStyle = textColor; ctx.font = '11px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif'; ctx.textAlign = 'right';
          var steps = 5, top = 12, bottom = CHART_H - 24, h = bottom - top;
          for (var i = 0; i <= steps; i++) { var val = yMin + (yMax - yMin) * (i / steps), y = bottom - (h * i / steps), abs = Math.abs(val); ctx.fillText((val < 0 ? '-' : '') + '$' + (abs >= 1000 ? (abs / 1000).toFixed(1).replace('.0', '') + 'k' : Math.round(abs)), Y_AXIS_W - 4, y + 4); }
          ctx.restore();
        }

        _detailChart = new Chart(chartCanvas, {
          type: 'line',
          data: { labels: labels, datasets: [{ label: 'Cumulative Saved', data: data, borderColor: lineColor, backgroundColor: fillColor, fill: true, tension: 0.35, pointRadius: data.length <= 24 ? 4 : 2, pointHoverRadius: 7, pointBackgroundColor: lineColor, pointBorderColor: lineColor, borderWidth: 2.5 }] },
          options: {
            responsive: false, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            plugins: { legend: { display: false }, tooltip: { external: function (context) {
              const tooltipEl = el('cumdet-tooltip'); if (!tooltipEl) return;
              const tooltip = context.tooltip; if (tooltip.opacity === 0) { tooltipEl.style.display = 'none'; return; }
              const dp = tooltip.dataPoints && tooltip.dataPoints[0]; if (!dp) return;
              const v = dp.raw, sign = v >= 0 ? '+' : '-', monthly = rawSavings[dp.dataIndex], mSign = monthly >= 0 ? '+' : '-';
              tooltipEl.innerHTML = '<strong>' + dp.label + '</strong><br>Total: ' + sign + '$' + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 }) + '<br><span style="font-size:11px;color:' + (monthly >= 0 ? '#10B981' : '#EF4444') + ';">This month: ' + mSign + '$' + Math.abs(monthly).toLocaleString('en-US', { maximumFractionDigits: 0 }) + '</span>';
              tooltipEl.style.display = 'block';
              var left = tooltip.caretX + Y_AXIS_W + 8; if (left + 160 > containerW + Y_AXIS_W) left = tooltip.caretX + Y_AXIS_W - 168;
              tooltipEl.style.left = left + 'px'; tooltipEl.style.top = '8px';
            } } },
            scales: { x: { grid: { display: false }, ticks: { color: textColor, maxRotation: 0, autoSkip: true, maxTicksLimit: 12, font: { size: 11 } } }, y: { min: yMin, max: yMax, grid: { color: gridColor }, ticks: { display: false } } },
            animation: { onComplete: function () { drawDetailYAxis(); } },
          },
        });

        // Monthly breakdown list
        const listEl = el('cumdet-monthly-list');
        if (listEl) {
          listEl.innerHTML = filtered.slice().reverse().map(function (s, revIdx) {
            const origIdx = filtered.length - 1 - revIdx, savings = rawSavings[origIdx] || 0, cumVal = data[origIdx] || 0;
            const mk = s.monthKey || '', parts = mk.split('-');
            const d = parts.length === 2 ? new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, 1) : null;
            const mLabel = d ? d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : mk;
            const sColor = savings >= 0 ? '#10B981' : '#EF4444', sSign = savings >= 0 ? '+' : '-';
            return '<div style="display:flex;align-items:center;padding:10px 0;border-bottom:0.5px solid var(--separator);"><div style="flex:1;"><div style="font-size:14px;font-weight:600;color:var(--text-primary);">' + mLabel + '</div><div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">Cumulative: ' + (cumVal < 0 ? '-' : '+') + '$' + Math.abs(cumVal).toLocaleString('en-US', { maximumFractionDigits: 0 }) + '</div></div><div style="font-size:16px;font-weight:700;color:' + sColor + ';">' + sSign + '$' + Math.abs(savings).toLocaleString('en-US', { maximumFractionDigits: 0 }) + '</div></div>';
          }).join('');
        }
      } catch (err) {
        console.error('[AnalyticsScreen] _renderCumulativeDetail failed:', err);
      }
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
            const CAP = 150; // display cap in %

            // Add a legend note about the cap
            const capNote = document.createElement('p');
            capNote.style.cssText = 'font-size:11px;color:var(--text-secondary);margin-bottom:8px;';
            capNote.textContent = 'Bars capped at ' + CAP + '%. Empty bar (outline only) = not to scale.';
            container.appendChild(capNote);

            renderDrillBarChart(container, {
              getData: function (filtered) {
                var realRates = filtered.map(function (s) {
                  if (!s.totalIncome || s.totalIncome === 0) return 0;
                  return Math.round((s.netSavings / s.totalIncome) * 100);
                });

                // Store real rates for tooltip access
                container._realRates  = realRates;
                container._rateLabels = filtered.map(function (s) { return monthKeyToShort(s.monthKey); });

                return {
                  labels: container._rateLabels,
                  // Cap display values at ±CAP
                  values: realRates.map(function (r) {
                    return Math.max(-CAP, Math.min(CAP, r));
                  }),
                  colors: realRates.map(function (r) {
                    // Out-of-scale: use semi-transparent fill
                    var isOOS = Math.abs(r) > CAP;
                    var base  = getSavingsRateColor(r);
                    if (isOOS) {
                      // Return a special marker — handled in buildChart via borderDash
                      return base.replace(')', ',0.35)').replace('rgb(', 'rgba(').replace('#', 'rgba_hex_');
                    }
                    return base;
                  }),
                  // Pass real rates so buildChart can set borderDash per bar
                  _realRates: realRates,
                  _cap: CAP,
                };
              },
              yFormat: function (v) { return v + '%'; },
              // Custom tooltip: show real rate + out-of-scale note
              getTooltipContent: function (idx, label) {
                var real = container._realRates && container._realRates[idx];
                if (real === undefined) return label + ': ' + idx + '%';
                var isOOS = Math.abs(real) > CAP;
                return '<strong>' + label + ':</strong> ' + real + '%' +
                  (isOOS ? '<br><span style="font-size:11px;color:var(--warning);">⚠️ Not shown to scale (capped at ' + CAP + '%)</span>' : '');
              },
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

    // ── renderCumulativeSavingsChart ──────────────────────────────────────────

    /**
     * Renders the dynamic scrollable cumulative net saved chart on the analytics
     * home page. Uses the same layout as the old dashboard version:
     *   [sticky y-axis canvas | scrollable chart canvas]
     * The y-axis updates dynamically as the user scrolls (rAF-throttled).
     * @param {object[]} summaries  All monthly summaries sorted ascending
     */
    renderCumulativeSavingsChart: function (summaries) {
      _cumulativeChart = destroyChart(_cumulativeChart);

      const container = el('cumulative-chart-container');
      if (!container) return;

      if (!summaries || summaries.length < 2) {
        container.innerHTML = '<p style="text-align:center;color:var(--text-secondary);font-size:13px;padding:40px 0;">Need at least 2 months of data</p>';
        return;
      }

      // Replace container contents with the scrollable layout
      container.innerHTML =
        '<div style="display:flex;align-items:stretch;height:180px;">' +
          '<canvas id="cumulative-yaxis" style="flex-shrink:0;width:52px;height:180px;display:block;"></canvas>' +
          '<div id="cumulative-scroll-wrapper" style="flex:1;overflow-x:auto;-webkit-overflow-scrolling:touch;">' +
            '<div id="cumulative-inner" style="position:relative;height:180px;min-width:100%;">' +
              '<canvas id="cumulative-chart" style="display:block;height:180px;"></canvas>' +
            '</div>' +
          '</div>' +
        '</div>';

      const canvas      = el('cumulative-chart');
      const innerEl     = el('cumulative-inner');
      const yAxisCanvas = el('cumulative-yaxis');
      const scrollWrapper = el('cumulative-scroll-wrapper');
      if (!canvas || !innerEl || !yAxisCanvas || !scrollWrapper) return;

      const isDark    = document.documentElement.getAttribute('data-theme') === 'dark';
      const textColor = isDark ? '#94A3B8' : '#6B7280';
      const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';

      const Y_AXIS_W   = 52;
      const CHART_H    = 180;
      const MONTHS_VIS = 12;
      const DPR        = window.devicePixelRatio || 1;

      // Build cumulative running total
      let running = 0;
      const labels = [], data = [];
      summaries.forEach(function (s) {
        running += (s.netSavings || 0);
        labels.push(monthKeyToShort(s.monthKey));
        data.push(Math.round(running * 100) / 100);
      });

      const lastVal   = data[data.length - 1] || 0;
      const lineColor = lastVal >= 0 ? '#10B981' : '#EF4444';
      const fillColor = lastVal >= 0 ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.10)';

      // Sizing
      const parentW = scrollWrapper.offsetWidth || Math.max(200, window.innerWidth - Y_AXIS_W - 48);
      const ptW     = Math.floor(parentW / MONTHS_VIS);
      const chartW  = Math.max(parentW, labels.length * ptW);

      canvas.width  = chartW; canvas.height = CHART_H;
      canvas.style.width = chartW + 'px'; canvas.style.height = CHART_H + 'px';
      yAxisCanvas.width  = Y_AXIS_W * DPR; yAxisCanvas.height = CHART_H * DPR;
      yAxisCanvas.style.width = Y_AXIS_W + 'px'; yAxisCanvas.style.height = CHART_H + 'px';
      innerEl.style.width = chartW + 'px'; innerEl.style.height = CHART_H + 'px';

      // Compute visible range for y-axis
      function getVisibleRange(scrollLeft) {
        var sw = scrollWrapper.offsetWidth || parentW;
        var firstIdx = Math.max(0, Math.floor(scrollLeft / ptW) - 1);
        var lastIdx  = Math.min(data.length - 1, Math.ceil((scrollLeft + sw) / ptW));
        var vis = data.slice(firstIdx, lastIdx + 1);
        if (vis.length === 0) vis = data;
        var vMin = Math.min.apply(null, vis), vMax = Math.max.apply(null, vis);
        var pad  = Math.max(Math.abs(vMax - vMin) * 0.15, 200);
        return { minVal: vMin - pad, maxVal: vMax + pad };
      }

      var initScrollLeft = Math.max(0, chartW - parentW);
      var initRange = getVisibleRange(initScrollLeft);

      function drawYAxis(curMin, curMax) {
        var ctx = yAxisCanvas.getContext('2d');
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, yAxisCanvas.width, yAxisCanvas.height);
        ctx.scale(DPR, DPR); ctx.fillStyle = textColor;
        ctx.font = '11px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';
        ctx.textAlign = 'right';
        var steps = 4, top = 12, bottom = CHART_H - 24, h = bottom - top;
        for (var i = 0; i <= steps; i++) {
          var val = curMin + (curMax - curMin) * (i / steps);
          var y   = bottom - (h * i / steps);
          var abs = Math.abs(val);
          ctx.fillText((val < 0 ? '-' : '') + '$' + (abs >= 1000 ? (abs / 1000).toFixed(1).replace('.0', '') + 'k' : Math.round(abs)), Y_AXIS_W - 4, y + 4);
        }
        ctx.restore();
      }

      _cumulativeChart = new Chart(canvas, {
        type: 'line',
        data: { labels: labels, datasets: [{ label: 'Cumulative Saved', data: data, borderColor: lineColor, backgroundColor: fillColor, fill: true, tension: 0.4, pointRadius: 4, pointHoverRadius: 7, pointBackgroundColor: lineColor, pointBorderColor: lineColor, borderWidth: 2.5 }] },
        options: {
          responsive: false, maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (ctx) { var v = ctx.raw; return ' ' + (v < 0 ? '-' : '+') + formatCurrency(Math.abs(v)); }, title: function (items) { return items[0] ? items[0].label : ''; } } } },
          scales: {
            x: { grid: { display: false }, ticks: { color: textColor, maxRotation: 0, autoSkip: true, maxTicksLimit: MONTHS_VIS, font: { size: 11 } } },
            y: { min: initRange.minVal, max: initRange.maxVal, grid: { color: gridColor }, ticks: { display: false } },
          },
          animation: { onComplete: function () { drawYAxis(initRange.minVal, initRange.maxVal); } },
        },
      });

      // Scroll to most recent + wire dynamic y-axis
      requestAnimationFrame(function () {
        scrollWrapper.scrollLeft = scrollWrapper.scrollWidth;
        drawYAxis(initRange.minVal, initRange.maxVal);

        var scrollTimer = null;
        scrollWrapper.addEventListener('scroll', function () {
          clearTimeout(scrollTimer);
          scrollTimer = setTimeout(function () {
            var range = getVisibleRange(scrollWrapper.scrollLeft);
            if (_cumulativeChart) {
              _cumulativeChart.options.scales.y.min = range.minVal;
              _cumulativeChart.options.scales.y.max = range.maxVal;
              _cumulativeChart.update('none');
            }
            drawYAxis(range.minVal, range.maxVal);
          }, 60);
        }, { passive: true });
      });
    },

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

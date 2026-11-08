// Chart panel: range toggles, line chart, moving averages and compare.
// Uses TradingView Lightweight Charts v5 (global `LightweightCharts`, pinned in index.html).
import { api } from './api.js';
import { changeClass, formatChange, formatPrice, isMarketOpen } from './format.js';
import { createSearch } from './search.js';
import { store } from './storage.js';

const $ = (sel) => document.querySelector(sel);

const COLORS = {
  up: '#15803d',
  down: '#dc2626',
  main: '#2563eb', // accent, used while comparing
  compare: '#0891b2',
  ma50: '#d97706',
  ma200: '#7c3aed',
  grid: '#f1f2f4',
  text: '#6b7280',
};
const RANGES = ['1H', '1D', '1M', '1Y', '5Y', 'All'];
const RANGE_WORDS = { '1H': 'past hour', '1D': 'today', '1M': 'past month', '1Y': 'past year', '5Y': 'past 5 years', All: 'all time' };
const MA_RANGES = new Set(['1M', '1Y']); // daily data; 1H/1D show the toggles disabled
const LONG_RANGES = new Set(['5Y', 'All']); // weekly/monthly data; toggles hidden
const INTRADAY = new Set(['1min', '5min']);

const s = {
  symbol: null,
  name: '',
  range: RANGES.includes(store.get('range')) ? store.get('range') : '1D',
  ma50: !!store.get('ma50'),
  ma200: !!store.get('ma200'),
  compare: null, // { symbol, name }
  main: null, // /api/chart response for the selected symbol
  comp: null, // /api/chart response for the compare symbol
  compError: '',
  seq: 0,
  chart: null,
  series: null,
  view: null, // what's drawn: { visible, compBars, comparing, maAllowed, toMain }
  hovering: false,
  hoverT: null,
  pointerType: 'mouse',
  touching: false,
  getQuote: () => null,
  onHoverEnd: () => {},
};

// ------------------------------------------------------------ setup

export function init({ getQuote, onHoverEnd }) {
  s.getQuote = getQuote;
  s.onHoverEnd = onHoverEnd;
  setupTouch();

  document.querySelectorAll('.ranges button').forEach((btn) => {
    btn.addEventListener('click', () => setRange(btn.dataset.range));
  });

  const optBtn = $('#chart-options-btn');
  optBtn.addEventListener('click', () => {
    const panel = $('#chart-options');
    panel.hidden = !panel.hidden;
    optBtn.setAttribute('aria-expanded', String(!panel.hidden));
  });

  for (const n of ['ma50', 'ma200']) {
    const box = $(`#${n}`);
    box.checked = s[n];
    box.addEventListener('change', () => {
      s[n] = box.checked;
      store.set(n, s[n]);
      draw();
    });
  }

  createSearch($('#compare-search'), {
    placeholder: 'Compare with…',
    onSelect: (r) => setCompare(r),
  });
  $('#compare-clear').addEventListener('click', () => setCompare(null));

  renderControls();
}

function ensureChart() {
  if (s.chart) return s.chart;
  const LWC = window.LightweightCharts;
  if (!LWC) return null;
  s.chart = LWC.createChart($('#chart'), {
    autoSize: true,
    layout: {
      background: { type: 'solid', color: '#ffffff' },
      textColor: COLORS.text,
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      fontSize: 12,
    },
    grid: { vertLines: { visible: false }, horzLines: { color: COLORS.grid } },
    rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.08 } },
    timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: true },
    // Only a subtle vertical line with its date label; the price goes in the header.
    crosshair: {
      mode: LWC.CrosshairMode.Normal,
      horzLine: { visible: false, labelVisible: false },
      vertLine: { color: '#c7cbd1', width: 1, style: LWC.LineStyle.Solid, labelBackgroundColor: '#6b7280' },
    },
    // A calm, static chart: the range buttons control time, so no drag/zoom.
    // Touch is handled in setupTouch() so vertical swipes still scroll the page.
    handleScroll: false,
    handleScale: false,
  });
  const line = (color, width) =>
    s.chart.addSeries(LWC.LineSeries, {
      color,
      lineWidth: width,
      // The current price is already in the header, so no price label or line on the chart.
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerRadius: 3,
    });
  s.series = {
    ma200: line(COLORS.ma200, 1),
    ma50: line(COLORS.ma50, 1),
    compare: line(COLORS.compare, 2),
    main: line(COLORS.main, 2),
  };
  // Mouse hover (touch is handled separately below).
  s.chart.subscribeCrosshairMove((param) => {
    if (s.pointerType === 'touch') return;
    if (param.time === undefined || !param.point) endHover();
    else showHover(param.time);
  });
  return s.chart;
}

// ------------------------------------------------------------ hover / touch scrubbing

// The chart container uses `touch-action: pan-y`: vertical swipes scroll the page (the browser
// then sends pointercancel), horizontal drags and taps move the crosshair.
function setupTouch() {
  const el = $('#chart');
  const at = (e) => {
    if (!s.chart || !s.view) return;
    const x = e.clientX - el.getBoundingClientRect().left;
    const time = s.chart.timeScale().coordinateToTime(x);
    if (time === null) return;
    const bar = barAt(s.view.visible, time);
    s.chart.setCrosshairPosition(s.view.toMain(bar.c), bar.t, s.series.main);
    showHover(bar.t);
  };
  el.addEventListener(
    'pointerdown',
    (e) => {
      s.pointerType = e.pointerType;
      if (e.pointerType !== 'touch') return;
      s.touching = true;
      at(e);
    },
    true
  );
  el.addEventListener(
    'pointermove',
    (e) => {
      s.pointerType = e.pointerType;
      if (e.pointerType === 'touch' && s.touching) at(e);
    },
    true
  );
  const end = (e) => {
    if (e.pointerType !== 'touch') return;
    s.touching = false;
    // After the chart library's own tap handling, so its crosshair doesn't linger.
    setTimeout(() => {
      if (s.touching) return;
      s.chart?.clearCrosshairPosition();
      endHover();
    }, 0);
  };
  el.addEventListener('pointerup', end, true);
  el.addEventListener('pointercancel', end, true);
}

/** Last bar at or before time t (bars sorted by t). */
function barAt(bars, t) {
  let lo = 0;
  let hi = bars.length - 1;
  if (t <= bars[0].t) return bars[0];
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (bars[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return bars[lo];
}

/** Date for a bar: time for 1H/1D, full date for 1M/1Y, month and year for 5Y/All. */
function formatBarTime(t, interval = s.main?.interval) {
  const intraday = INTRADAY.has(interval);
  const opts = intraday
    ? { timeZone: 'UTC', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    : interval === '1day'
      ? { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }
      : { timeZone: 'UTC', month: 'short', year: 'numeric' };
  // Bar times are New York wall-clock time stored as UTC, so format in UTC.
  return new Date(t * 1000).toLocaleString('en-US', opts) + (intraday ? ' ET' : '');
}

/** Put the hovered point's price, change from the start of the range and date in the header. */
function showHover(t) {
  const v = s.view;
  if (!v) return;
  const bar = barAt(v.visible, t);
  const first = v.visible[0].c;
  const change = bar.c - first;
  s.hovering = true;
  s.hoverT = bar.t;
  $('#detail-price').textContent = formatPrice(bar.c);
  const ch = $('#detail-change');
  ch.textContent = `${formatChange(change, (change / first) * 100)} · ${formatBarTime(bar.t)}`;
  ch.className = `change ${changeClass(change)}`;
  if (v.comparing) renderLegend(v.visible, v.compBars, v.comparing, v.maAllowed, bar.t);
}

/** Restore the live price and today's change. */
function endHover() {
  if (!s.hovering) return;
  s.hovering = false;
  s.hoverT = null;
  s.onHoverEnd();
  const v = s.view;
  if (v) renderLegend(v.visible, v.compBars, v.comparing, v.maAllowed);
}

export function isHovering() {
  return s.hovering;
}

// ------------------------------------------------------------ public API

/** Show a ticker in the chart (called when the selection changes). */
export function show(symbol, name) {
  if (symbol === s.symbol) return;
  if (s.compare?.symbol === symbol) setCompare(null);
  s.symbol = symbol;
  s.name = name;
  s.main = null;
  clearSeries();
  load();
}

/** Called after every quote poll: refresh intraday charts while the market is open, and recolor. */
export function onQuotesUpdated() {
  if (!s.symbol) return;
  if ((s.range === '1H' || s.range === '1D') && isMarketOpen()) load({ quiet: true });
  else draw();
}

// ------------------------------------------------------------ state changes

// The chart library doesn't report a crosshair move when only the data changes,
// so drop any hover state ourselves before swapping data.
function resetHover() {
  s.chart?.clearCrosshairPosition();
  endHover();
}

function setRange(range) {
  if (!RANGES.includes(range) || range === s.range) return;
  resetHover();
  s.range = range;
  store.set('range', range);
  renderControls();
  load();
}

function setCompare(r) {
  if (r && r.symbol === s.symbol) return;
  resetHover();
  s.compare = r;
  s.comp = null;
  s.compError = '';
  renderControls();
  if (r) load();
  else draw();
}

// ------------------------------------------------------------ data

async function load({ quiet = false } = {}) {
  if (!s.symbol) return;
  const seq = ++s.seq;
  const { symbol, range } = s;
  const compareSymbol = s.compare?.symbol;
  if (!quiet) showMessage('Loading chart…');

  const fetchChart = (sym) => api(`/api/chart?symbol=${encodeURIComponent(sym)}&range=${range}`);
  const [main, comp] = await Promise.allSettled([
    fetchChart(symbol),
    compareSymbol ? fetchChart(compareSymbol) : Promise.resolve(null),
  ]);
  if (seq !== s.seq) return; // a newer request replaced this one

  if (main.status === 'rejected') {
    if (quiet && s.main) return; // keep showing the last good chart during background refreshes
    s.main = null;
    clearSeries();
    renderRangeChange();
    showMessage(main.reason?.message || "Couldn't load the chart.");
    return;
  }
  s.main = main.value;
  if (compareSymbol) {
    if (comp.status === 'fulfilled') {
      s.comp = comp.value;
      s.compError = '';
    } else if (!quiet || !s.comp) {
      s.comp = null;
      s.compError = comp.reason?.message || "Couldn't load compare data.";
    }
  }
  draw();
}

// ------------------------------------------------------------ drawing

function sma(bars, n) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].c;
    if (i >= n) sum -= bars[i - n].c;
    if (i >= n - 1) out.push({ t: bars[i].t, c: sum / n });
  }
  return out;
}

function draw() {
  renderControls();
  if (!s.main) return;
  const chart = ensureChart();
  if (!chart) {
    showMessage("The chart library couldn't load. Check your connection and refresh the page.");
    return;
  }

  const start = s.main.start;
  const visible = s.main.bars.filter((b) => b.t >= start);
  if (visible.length < 2) {
    clearSeries();
    renderRangeChange();
    showMessage('Not enough chart data for this range yet.');
    return;
  }
  hideMessage();

  const compBars = s.compare && s.comp ? s.comp.bars.filter((b) => b.t >= start) : [];
  const comparing = compBars.length >= 2;

  // While comparing, every line is % change from the start of the range.
  const base = visible[0].c;
  const toMain = comparing ? (v) => (v / base - 1) * 100 : (v) => v;
  const points = (bars, f) => bars.map((b) => ({ time: b.t, value: f(b.c) }));

  chart.applyOptions({
    localization: {
      priceFormatter: comparing ? (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}%` : (v) => formatPrice(v),
      timeFormatter: (t) => formatBarTime(t),
    },
    timeScale: { timeVisible: INTRADAY.has(s.main.interval), secondsVisible: false },
  });

  // When the data set changes (ticker, range or compare), empty every line first, so the
  // chart never briefly mixes, say, new weekly main data with old monthly compare data
  // (that left Lightweight Charts in a broken hover state).
  const key = `${s.symbol}|${s.range}|${comparing ? s.compare.symbol : ''}`;
  if (key !== s.drawnKey) {
    for (const series of Object.values(s.series)) series.setData([]);
    s.drawnKey = key;
  }

  s.series.main.applyOptions({ color: comparing ? COLORS.main : trendColor(visible) });
  s.series.main.setData(points(visible, toMain));

  const maAllowed = MA_RANGES.has(s.range);
  for (const n of [50, 200]) {
    const on = maAllowed && s[`ma${n}`];
    s.series[`ma${n}`].setData(on ? points(sma(s.main.bars, n).filter((b) => b.t >= start), toMain) : []);
  }

  if (comparing) {
    const cBase = compBars[0].c;
    s.series.compare.setData(points(compBars, (v) => (v / cBase - 1) * 100));
  } else {
    s.series.compare.setData([]);
  }

  chart.timeScale().fitContent();
  s.view = { visible, compBars, comparing, maAllowed, toMain };
  renderRangeChange(visible, comparing);
  renderLegend(visible, compBars, comparing, maAllowed, s.hovering ? s.hoverT : null);
}

function trendColor(visible) {
  let change = visible[visible.length - 1].c - visible[0].c;
  if (s.range === '1D') {
    const q = s.getQuote(s.symbol);
    if (q && typeof q.change === 'number') change = q.change; // match the header's daily change
  }
  return change < 0 ? COLORS.down : COLORS.up;
}

function clearSeries() {
  s.view = null;
  s.drawnKey = null;
  resetHover();
  if (!s.series) return;
  for (const series of Object.values(s.series)) series.setData([]);
  $('#chart-legend').hidden = true;
}

function showMessage(text) {
  const el = $('#chart-message');
  el.textContent = text;
  el.hidden = false;
}

function hideMessage() {
  $('#chart-message').hidden = true;
}

// ------------------------------------------------------------ controls & labels

function renderControls() {
  document.querySelectorAll('.ranges button').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.range === s.range));
  });
  const maAllowed = MA_RANGES.has(s.range);
  $('#ma50').disabled = !maAllowed;
  $('#ma200').disabled = !maAllowed;
  $('#ma-hint').hidden = maAllowed;
  $('#ma-options').hidden = LONG_RANGES.has(s.range);
  $('#compare-clear').hidden = !s.compare;
}

function renderRangeChange(visible, comparing) {
  const el = $('#range-change');
  el.textContent = '';
  el.className = 'range-change';
  // 1D change is already in the header; while comparing the legend shows the numbers.
  if (!visible || comparing || s.range === '1D') return;
  const first = visible[0].c;
  const last = visible[visible.length - 1].c;
  const change = last - first;
  const since = s.range === 'All' ? ` (since ${formatBarTime(visible[0].t)})` : '';
  el.textContent = `${formatChange(change, (change / first) * 100)} ${RANGE_WORDS[s.range]}${since}`;
  el.classList.add(change > 0 ? 'up' : change < 0 ? 'down' : 'muted');
}

/** Legend; while hovering (t set) the compare values are as of that point. */
function renderLegend(visible, compBars, comparing, maAllowed, t = null) {
  const legend = $('#chart-legend');
  legend.innerHTML = '';
  const add = (color, label, value) => {
    const span = document.createElement('span');
    const swatch = document.createElement('i');
    swatch.style.background = color;
    span.append(swatch, label);
    if (value) {
      const b = document.createElement('b');
      b.textContent = value;
      span.append(' ', b);
    }
    legend.append(span);
  };
  const pct = (bars) => {
    const end = t === null ? bars[bars.length - 1] : barAt(bars, t);
    const v = (end.c / bars[0].c - 1) * 100;
    return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`;
  };

  if (comparing) {
    add(COLORS.main, s.symbol, pct(visible));
    add(COLORS.compare, s.compare.symbol, pct(compBars));
  }
  if (maAllowed && s.ma50) add(COLORS.ma50, '50-day avg');
  if (maAllowed && s.ma200) add(COLORS.ma200, '200-day avg');
  if (s.compare && !comparing && s.compError) {
    const note = document.createElement('span');
    note.textContent = `Compare with ${s.compare.symbol}: ${s.compError}`;
    legend.append(note);
  }
  legend.hidden = legend.childElementCount === 0;
}

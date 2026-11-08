import { api, ApiError, setConfigMissingHandler, setUnauthorizedHandler } from './api.js';
import { changeClass, formatChange, formatPrice, formatTime, isMarketOpen } from './format.js';
import { createSearch } from './search.js';
import { store } from './storage.js';
import * as chart from './chart.js';

const $ = (sel) => document.querySelector(sel);

const POLL_OPEN_MS = 60 * 1000;
const POLL_CLOSED_MS = 15 * 60 * 1000;
const MAX_POLL_SYMBOLS = 50;

const state = {
  lists: [],
  listId: null,
  items: [], // [{ symbol, name }]
  quotes: new Map(), // symbol -> quote
  quoteErrors: new Map(), // symbol -> message
  selected: null, // { symbol, name }
  lastUpdated: null,
  pollTimer: null,
  pollSeq: 0,
  started: false,
};

// ------------------------------------------------------------ notices
let noticeTimer = null;
function notify(message) {
  const el = $('#notice');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (el.hidden = true), 6000);
}

// ------------------------------------------------------------ login gate
function showLogin() {
  if (configBlocked) return;
  stopPolling();
  state.started = false;
  $('#app').hidden = true;
  $('#login-screen').hidden = false;
  $('#login-password').value = '';
  $('#login-password').focus();
}

function showApp() {
  if (configBlocked) return;
  $('#login-screen').hidden = true;
  $('#app').hidden = false;
}

setUnauthorizedHandler(showLogin);

// Missing server settings: replace everything with one clear full-page message.
let configBlocked = false;
function showConfigMissing(missing) {
  configBlocked = true;
  stopPolling();
  state.started = false;
  $('#app').hidden = true;
  $('#login-screen').hidden = true;
  const ul = $('#config-missing');
  ul.innerHTML = '';
  for (const name of missing.length ? missing : ['(unknown setting)']) {
    const li = document.createElement('li');
    const code = document.createElement('code');
    code.textContent = name;
    li.append(code);
    ul.append(li);
  }
  $('#config-screen').hidden = false;
}
setConfigMissingHandler(showConfigMissing);

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button');
  const err = $('#login-error');
  err.textContent = '';
  btn.disabled = true;
  try {
    await api('/api/login', { method: 'POST', body: { password: $('#login-password').value } });
    showApp();
    await start();
  } catch (ex) {
    err.textContent = ex.message;
  } finally {
    btn.disabled = false;
  }
});

async function logout() {
  try {
    await api('/api/logout', { method: 'POST' });
  } catch {
    /* Even if this fails, show the login screen. */
  }
  showLogin();
}

// ------------------------------------------------------------ menus
function setupMenu(buttonSel, menuSel, onAction) {
  const btn = $(buttonSel);
  const menu = $(menuSel);
  const close = () => {
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = menu.hidden;
    document.querySelectorAll('.menu').forEach((m) => (m.hidden = true));
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  });
  menu.addEventListener('click', (e) => {
    const action = e.target.closest('button')?.dataset.action;
    if (!action) return;
    close();
    onAction(action);
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) {
      close();
      btn.focus();
    }
  });
}

setupMenu('#settings-btn', '#settings-menu', (action) => {
  if (action === 'logout') logout();
});

setupMenu('#list-menu-btn', '#list-menu', (action) => {
  if (action === 'new') createList();
  if (action === 'rename') renameList();
  if (action === 'delete') deleteList();
});

// ------------------------------------------------------------ name dialog
function askName(title, initial = '') {
  const dialog = $('#name-dialog');
  const input = $('#name-input');
  $('#name-dialog-title').textContent = title;
  input.value = initial;
  return new Promise((resolve) => {
    const finish = (value) => {
      dialog.removeEventListener('close', onClose);
      resolve(value);
    };
    const onClose = () => finish(dialog.returnValue === 'ok' ? input.value.trim() || null : null);
    dialog.addEventListener('close', onClose);
    $('#name-cancel').onclick = () => dialog.close('cancel');
    dialog.returnValue = '';
    dialog.showModal();
    input.select();
  });
}

// ------------------------------------------------------------ watchlists
function currentList() {
  return state.lists.find((l) => l.id === state.listId) || null;
}

function renderListSelect() {
  const select = $('#list-select');
  select.innerHTML = '';
  for (const l of state.lists) {
    const opt = document.createElement('option');
    opt.value = l.id;
    opt.textContent = l.name;
    select.append(opt);
  }
  select.value = String(state.listId);
}

async function loadLists(preferId) {
  const { watchlists } = await api('/api/watchlists');
  state.lists = watchlists;
  const wanted = preferId ?? store.get('listId');
  state.listId = (watchlists.find((l) => l.id === wanted) || watchlists[0]).id;
  store.set('listId', state.listId);
  renderListSelect();
}

async function loadItems() {
  const listId = state.listId;
  try {
    const { items } = await api(`/api/watchlists/${listId}/items`);
    if (listId !== state.listId) return; // switched lists meanwhile
    state.items = items;
  } catch (err) {
    if (err.status === 401) return;
    state.items = [];
    notify(`Couldn't load this watchlist. ${err.message}`);
  }
  renderRows();
  renderDetail();
}

$('#list-select').addEventListener('change', async (e) => {
  state.listId = Number(e.target.value);
  store.set('listId', state.listId);
  state.items = [];
  renderRows();
  await loadItems();
  refreshQuotes();
});

async function createList() {
  const name = await askName('New watchlist');
  if (!name) return;
  try {
    const { watchlist } = await api('/api/watchlists', { method: 'POST', body: { name } });
    await loadLists(watchlist.id);
    await loadItems();
    refreshQuotes();
  } catch (err) {
    notify(err.message);
  }
}

async function renameList() {
  const list = currentList();
  if (!list) return;
  const name = await askName('Rename watchlist', list.name);
  if (!name || name === list.name) return;
  try {
    await api(`/api/watchlists/${list.id}`, { method: 'PATCH', body: { name } });
    list.name = name;
    renderListSelect();
  } catch (err) {
    notify(err.message);
  }
}

async function deleteList() {
  const list = currentList();
  if (!list) return;
  if (state.lists.length <= 1) {
    notify("You can't delete your only watchlist.");
    return;
  }
  if (!confirm(`Delete “${list.name}”? This can't be undone.`)) return;
  try {
    await api(`/api/watchlists/${list.id}`, { method: 'DELETE' });
    await loadLists(null);
    await loadItems();
    refreshQuotes();
  } catch (err) {
    notify(err.message);
  }
}

// ------------------------------------------------------------ watchlist rows
function renderRows() {
  const ul = $('#rows');
  ul.innerHTML = '';
  for (const item of state.items) {
    const q = state.quotes.get(item.symbol);
    const li = document.createElement('li');
    li.className = 'row' + (state.selected?.symbol === item.symbol ? ' selected' : '');
    li.tabIndex = 0;
    li.innerHTML = `
      <div class="row-id"><div class="row-sym"></div><div class="row-name"></div></div>
      <div class="row-quote num"><div class="row-price"></div><div class="row-change"></div></div>
      <button class="row-remove" type="button">×</button>`;
    li.querySelector('.row-sym').textContent = item.symbol;
    li.querySelector('.row-name').textContent = item.name;
    li.querySelector('.row-price').textContent = q ? formatPrice(q.price) : '—';
    const ch = li.querySelector('.row-change');
    if (q) {
      ch.textContent = formatChange(q.change, q.changePercent);
      ch.className = `row-change ${changeClass(q.change)}`;
    } else if (state.quoteErrors.has(item.symbol)) {
      ch.textContent = 'Unavailable';
      ch.className = 'row-change muted';
      ch.title = state.quoteErrors.get(item.symbol);
    }
    const remove = li.querySelector('.row-remove');
    remove.setAttribute('aria-label', `Remove ${item.symbol} from list`);
    remove.title = 'Remove from list';
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      removeItem(item.symbol);
    });
    li.addEventListener('click', () => select(item, { scroll: true }));
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        select(item, { scroll: true });
      }
    });
    ul.append(li);
  }
  $('#list-empty').hidden = state.items.length > 0;
}

async function removeItem(symbol) {
  const listId = state.listId;
  const before = state.items;
  state.items = state.items.filter((i) => i.symbol !== symbol);
  renderRows();
  renderDetail();
  try {
    await api(`/api/watchlists/${listId}/items/${encodeURIComponent(symbol)}`, { method: 'DELETE' });
  } catch (err) {
    if (listId === state.listId) {
      state.items = before;
      renderRows();
      renderDetail();
    }
    notify(`Couldn't remove ${symbol}. ${err.message}`);
  }
}

async function addSelectedToList() {
  const sel = state.selected;
  if (!sel) return;
  const btn = $('#add-btn');
  btn.disabled = true;
  try {
    const { item } = await api(`/api/watchlists/${state.listId}/items`, {
      method: 'POST',
      body: { symbol: sel.symbol, name: sel.name },
    });
    if (!state.items.some((i) => i.symbol === item.symbol)) state.items.push(item);
    if (state.selected?.symbol === item.symbol) state.selected.name = item.name;
    renderRows();
    renderDetail();
    if (!state.quotes.has(item.symbol)) refreshQuotes();
  } catch (err) {
    notify(`Couldn't add ${sel.symbol}. ${err.message}`);
  } finally {
    btn.disabled = false;
  }
}
$('#add-btn').addEventListener('click', addSelectedToList);

// ------------------------------------------------------------ detail panel
function select(item, { scroll = false } = {}) {
  state.selected = { symbol: item.symbol, name: item.name };
  store.set('selected', state.selected);
  renderRows();
  renderDetail();
  if (!state.quotes.has(item.symbol)) fetchSingleQuote(item.symbol);
  if (scroll && window.matchMedia('(max-width: 760px)').matches) {
    $('.chart-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function renderDetail() {
  const sel = state.selected;
  $('#detail-empty').hidden = !!sel;
  $('#detail').hidden = !sel;
  if (!sel) return;
  const q = state.quotes.get(sel.symbol);
  $('#detail-name').textContent = sel.name || sel.symbol;
  $('#detail-symbol').textContent = sel.symbol;
  $('#detail-price').textContent = q ? formatPrice(q.price) : '—';
  const ch = $('#detail-change');
  if (q) {
    ch.textContent = formatChange(q.change, q.changePercent) + ' today';
    ch.className = `change ${changeClass(q.change)}`;
  } else {
    ch.textContent = state.quoteErrors.get(sel.symbol) || '';
    ch.className = 'change muted';
  }
  $('#add-btn').hidden = state.items.some((i) => i.symbol === sel.symbol);
  chart.show(sel.symbol, sel.name);
}

async function fetchSingleQuote(symbol) {
  try {
    const data = await api(`/api/quotes?symbols=${encodeURIComponent(symbol)}`);
    mergeQuotes(data, [symbol]);
  } catch (err) {
    if (err.status === 401) return;
    state.quoteErrors.set(symbol, err.message);
  }
  renderRows();
  renderDetail();
}

// ------------------------------------------------------------ quotes & polling
function pollSymbols() {
  // Current watchlist + the ticker being viewed. (Active alerts join in Phase 3.)
  const all = [...state.items.map((i) => i.symbol)];
  if (state.selected) all.push(state.selected.symbol);
  return [...new Set(all)];
}

function mergeQuotes(data, requested) {
  for (const [sym, q] of Object.entries(data.quotes || {})) {
    state.quotes.set(sym, q);
    state.quoteErrors.delete(sym);
  }
  for (const [sym, msg] of Object.entries(data.errors || {})) {
    if (requested.includes(sym)) state.quoteErrors.set(sym, msg);
  }
}

function stopPolling() {
  clearTimeout(state.pollTimer);
  state.pollTimer = null;
  state.pollSeq++;
}

function scheduleNext() {
  clearTimeout(state.pollTimer);
  state.pollTimer = setTimeout(refreshQuotes, isMarketOpen() ? POLL_OPEN_MS : POLL_CLOSED_MS);
}

async function refreshQuotes() {
  if (!state.started) return;
  const seq = ++state.pollSeq;
  clearTimeout(state.pollTimer);

  let symbols = pollSymbols();
  const note = $('#poll-note');
  note.textContent = '';
  if (symbols.length > MAX_POLL_SYMBOLS) {
    note.textContent = `Updating the first ${MAX_POLL_SYMBOLS} of ${symbols.length} tickers to stay within data limits.`;
    symbols = symbols.slice(0, MAX_POLL_SYMBOLS);
  }

  if (symbols.length) {
    try {
      const data = await api(`/api/quotes?symbols=${symbols.map(encodeURIComponent).join(',')}`);
      if (seq !== state.pollSeq) return; // a newer refresh started
      mergeQuotes(data, symbols);
      state.lastUpdated = new Date();
      if (data.rateLimited) note.textContent = 'Some prices hit the data limit and will update next round.';
    } catch (err) {
      if (seq !== state.pollSeq || err.status === 401) return;
      note.textContent = `Couldn't update prices (${err.message}) Will retry.`;
    }
  }
  renderUpdated();
  renderRows();
  renderDetail();
  chart.onQuotesUpdated();
  scheduleNext();
}

function renderUpdated() {
  const open = isMarketOpen();
  const when = state.lastUpdated ? `Last updated ${formatTime(state.lastUpdated)}` : 'Not updated yet';
  $('#last-updated').textContent = `${when} · Prices may be delayed${open ? '' : ' · Market closed'}`;
}

// Catch up right away when the tab comes back after a while.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !state.started) return;
  const age = state.lastUpdated ? Date.now() - state.lastUpdated.getTime() : Infinity;
  if (age > (isMarketOpen() ? POLL_OPEN_MS : POLL_CLOSED_MS)) refreshQuotes();
});

// ------------------------------------------------------------ boot
chart.init({ getQuote: (symbol) => state.quotes.get(symbol) });

createSearch($('#main-search'), {
  onSelect: (r) => select(r, { scroll: true }),
});

async function start() {
  try {
    await loadLists();
  } catch (err) {
    if (err.status === 401 || err.code === 'config_missing') return; // login/config screen already shown
    showApp();
    $('#last-updated').textContent = '';
    notify(`Couldn't load your watchlists. ${err.message}`);
    return;
  }
  showApp();
  state.started = true;
  state.selected = store.get('selected');
  await loadItems();
  refreshQuotes();
}

start().catch((err) => {
  console.error(err);
  if (!(err instanceof ApiError)) notify('Something went wrong while loading. Please refresh.');
});

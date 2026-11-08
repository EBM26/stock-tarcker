// Price alerts: the "Set alert" control in the chart panel, the Alerts tab,
// checking polled quotes in the browser, desktop notifications and a chime.
import { api } from './api.js';
import { formatPrice } from './format.js';
import { store } from './storage.js';

const $ = (sel) => document.querySelector(sel);

const s = {
  alerts: [], // rows from /api/alerts
  loaded: false,
  pending: new Set(), // alert ids with a trigger request in flight
  editing: false, // alert form open in the chart panel
  current: null, // { symbol, name } shown in the chart panel
  getQuote: () => null,
  getName: () => '',
  openSymbol: () => {},
  notify: () => {},
};

export function init({ getQuote, getName, openSymbol, notify }) {
  Object.assign(s, { getQuote, getName, openSymbol, notify });
  setupSound();
  renderNotificationMenuItem();
}

// ------------------------------------------------------------ data

export async function load() {
  try {
    const { alerts } = await api('/api/alerts');
    s.alerts = alerts;
    s.loaded = true;
  } catch (err) {
    if (err.status === 401) return;
    if (!s.loaded) s.notify(`Couldn't load alerts. ${err.message}`);
  }
  renderAll();
}

/** Symbols whose quotes must be polled so their alerts can fire. */
export function activeSymbols() {
  return [...new Set(s.alerts.filter((a) => a.status === 'active').map((a) => a.symbol))];
}

export function alertFor(symbol) {
  return s.alerts.find((a) => a.symbol === symbol) || null;
}

function isMet(direction, target, price) {
  return direction === 'above' ? price >= target : price <= target;
}

// ------------------------------------------------------------ checking

/** Called after quotes update. Fires any active alert whose price has been crossed. */
export function check() {
  for (const a of s.alerts) {
    if (a.status !== 'active' || s.pending.has(a.id)) continue;
    const q = s.getQuote(a.symbol);
    if (!q || typeof q.price !== 'number') continue;
    if (isMet(a.direction, a.target_price, q.price)) trigger(a, q.price);
  }
}

async function trigger(alert, price) {
  s.pending.add(alert.id);
  try {
    const { triggered } = await api(`/api/alerts/${alert.id}/trigger`, { method: 'POST', body: { price } });
    // Only the request that flipped the alert shows anything (prevents duplicates across devices).
    if (triggered) announce(alert, price);
  } catch (err) {
    if (err.status !== 401) console.warn('alert trigger failed', err);
  } finally {
    s.pending.delete(alert.id);
  }
  await load();
}

function announce(alert, price) {
  const verb = alert.direction === 'above' ? 'rose above' : 'fell below';
  const title = `${alert.symbol} ${verb} ${formatPrice(alert.target_price)}`;
  const body = `Now ${formatPrice(price)}${s.getName(alert.symbol) ? ` · ${s.getName(alert.symbol)}` : ''}`;
  s.notify(`🔔 ${title}. ${body}.`, { sticky: true });
  playChime();
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      const n = new Notification(title, { body, tag: `alert-${alert.id}` });
      n.onclick = () => {
        window.focus();
        s.openSymbol({ symbol: alert.symbol, name: s.getName(alert.symbol) || alert.symbol });
        n.close();
      };
    } catch (err) {
      console.warn('notification failed', err);
    }
  }
}

// ------------------------------------------------------------ notifications permission

function notificationState() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

/** Must be called from a click (browsers only allow the permission prompt then). */
export async function enableNotifications() {
  const st = notificationState();
  if (st === 'unsupported') {
    s.notify("This browser doesn't support desktop notifications. Alerts will still show here with a sound.");
  } else if (st === 'denied') {
    s.notify('Notifications are blocked for this site. Allow them in your browser’s site settings.');
  } else if (st === 'granted') {
    s.notify('Notifications are already on.');
  } else {
    unlockAudio();
    const result = await Notification.requestPermission();
    s.notify(result === 'granted' ? 'Notifications are on.' : 'Notifications were not enabled.');
  }
  store.set('notifPrompted', true);
  renderNotificationMenuItem();
  renderControl();
}

export function renderNotificationMenuItem() {
  const item = $('#notif-menu-item');
  const st = notificationState();
  item.textContent =
    st === 'granted' ? 'Notifications on ✓' : st === 'denied' ? 'Notifications blocked' : 'Enable notifications';
}

// ------------------------------------------------------------ sound (Web Audio, no file)

let audioCtx = null;

function unlockAudio() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch {
    audioCtx = null;
  }
}

// Browsers only allow audio after the user has interacted with the page.
function setupSound() {
  const once = () => {
    unlockAudio();
    document.removeEventListener('pointerdown', once);
    document.removeEventListener('keydown', once);
  };
  document.addEventListener('pointerdown', once);
  document.addEventListener('keydown', once);
}

function playChime() {
  if (!audioCtx) return;
  try {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    [880, 1318.5].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const t = now + i * 0.18;
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.4);
    });
  } catch {
    /* sound is a nice-to-have */
  }
}

// ------------------------------------------------------------ actions

async function save(symbol, direction, target) {
  const { alert } = await api('/api/alerts', {
    method: 'POST',
    body: { symbol, direction, target_price: target },
  });
  s.alerts = s.alerts.filter((a) => a.symbol !== symbol).concat(alert);
  s.editing = false;
  renderAll();
}

async function remove(alert) {
  try {
    await api(`/api/alerts/${alert.id}`, { method: 'DELETE' });
    s.alerts = s.alerts.filter((a) => a.id !== alert.id);
    renderAll();
  } catch (err) {
    s.notify(`Couldn't delete the alert. ${err.message}`);
  }
}

async function rearm(alert) {
  const q = s.getQuote(alert.symbol);
  if (q && isMet(alert.direction, alert.target_price, q.price)) {
    const ok = confirm(
      `${alert.symbol} is already ${alert.direction} ${formatPrice(alert.target_price)}, so this alert would fire right away. Re-arm anyway?`
    );
    if (!ok) return;
  }
  try {
    const { alert: updated } = await api(`/api/alerts/${alert.id}/rearm`, { method: 'POST' });
    s.alerts = s.alerts.map((a) => (a.id === updated.id ? updated : a));
    renderAll();
  } catch (err) {
    s.notify(`Couldn't re-arm the alert. ${err.message}`);
  }
}

// ------------------------------------------------------------ chart panel control

/** Show the alert control for the ticker in the chart panel. */
export function setCurrent(symbol, name) {
  if (s.current?.symbol !== symbol) s.editing = false;
  s.current = symbol ? { symbol, name } : null;
  renderControl();
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function linkButton(text, onClick) {
  return el('button', { type: 'button', className: 'link-btn', textContent: text, onclick: onClick });
}

function describe(a) {
  return `${a.direction === 'above' ? 'above' : 'below'} ${formatPrice(a.target_price)}`;
}

function renderControl() {
  const box = $('#alert-control');
  box.innerHTML = '';
  const cur = s.current;
  if (!cur) return;
  const existing = alertFor(cur.symbol);

  if (s.editing) {
    box.append(alertForm(cur, existing));
  } else if (existing?.status === 'active') {
    box.append(
      el('span', { className: 'status', textContent: `🔔 Alert when ${describe(existing)}` }),
      linkButton('Edit', () => {
        s.editing = true;
        renderControl();
      }),
      linkButton('Remove', () => remove(existing))
    );
  } else if (existing?.status === 'triggered') {
    box.append(
      el('span', {
        className: 'status',
        textContent: `Alert ${describe(existing)} triggered${existing.triggered_price ? ` at ${formatPrice(existing.triggered_price)}` : ''}`,
      }),
      linkButton('Re-arm', () => rearm(existing)),
      linkButton('Change', () => {
        s.editing = true;
        renderControl();
      })
    );
  } else {
    box.append(
      linkButton('Set alert', () => {
        s.editing = true;
        renderControl();
      })
    );
  }

  // One-time prompt, shown after the first alert is set.
  if (!s.editing && existing && !store.get('notifPrompted') && notificationState() === 'default') {
    box.append(
      el(
        'div',
        { className: 'prompt' },
        el('span', { textContent: 'Get a desktop notification when an alert fires?' }),
        linkButton('Enable notifications', () => enableNotifications()),
        linkButton('Not now', () => {
          store.set('notifPrompted', true);
          renderControl();
        })
      )
    );
  }
}

function alertForm(cur, existing) {
  const q = s.getQuote(cur.symbol);
  const select = el(
    'select',
    { ariaLabel: 'Direction' },
    el('option', { value: 'above', textContent: 'Price above' }),
    el('option', { value: 'below', textContent: 'Price below' })
  );
  const input = el('input', {
    type: 'number',
    step: 'any',
    min: '0',
    inputMode: 'decimal',
    required: true,
    ariaLabel: 'Target price',
    placeholder: 'Price',
  });
  if (existing) {
    select.value = existing.direction;
    input.value = existing.target_price;
  } else if (q?.price) {
    input.value = q.price < 1 ? q.price.toFixed(4) : q.price.toFixed(2);
  }
  const submit = el('button', { type: 'submit', className: 'btn btn-primary', textContent: 'Set' });
  const form = el(
    'form',
    {},
    select,
    input,
    submit,
    linkButton('Cancel', () => {
      s.editing = false;
      renderControl();
    })
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const target = Number(input.value);
    if (!Number.isFinite(target) || target <= 0) {
      s.notify('Enter a price greater than 0.');
      return;
    }
    const price = s.getQuote(cur.symbol)?.price;
    if (typeof price === 'number' && isMet(select.value, target, price)) {
      s.notify(`${cur.symbol} is already ${select.value} ${formatPrice(target)} (now ${formatPrice(price)}). Pick a different price.`);
      return;
    }
    unlockAudio();
    submit.disabled = true;
    try {
      await save(cur.symbol, select.value, target);
    } catch (err) {
      s.notify(`Couldn't save the alert. ${err.message}`);
      submit.disabled = false;
    }
  });
  setTimeout(() => input.focus(), 0);
  return form;
}

// ------------------------------------------------------------ Alerts tab

function fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function renderTab() {
  const active = s.alerts.filter((a) => a.status === 'active');
  const triggered = s.alerts.filter((a) => a.status === 'triggered');
  $('#alerts-empty').hidden = !s.loaded || s.alerts.length > 0;
  $('#alerts-active-section').hidden = active.length === 0;
  $('#alerts-triggered-section').hidden = triggered.length === 0;

  const row = (a, detailText, actions) => {
    const name = s.getName(a.symbol);
    const sym = el('button', {
      type: 'button',
      className: 'sym-link',
      textContent: a.symbol,
      title: `Open ${a.symbol}`,
      onclick: () => s.openSymbol({ symbol: a.symbol, name: name || a.symbol }),
    });
    return el(
      'li',
      { className: 'alert-row' },
      el('div', {}, sym, el('div', { className: 'detail', textContent: detailText })),
      el('div', { className: 'actions' }, ...actions)
    );
  };

  const activeUl = $('#alerts-active');
  activeUl.innerHTML = '';
  for (const a of active) {
    const q = s.getQuote(a.symbol);
    const now = q ? ` · now ${formatPrice(q.price)}` : '';
    activeUl.append(row(a, `When price is ${describe(a)}${now}`, [linkButton('Delete', () => remove(a))]));
  }

  const trigUl = $('#alerts-triggered');
  trigUl.innerHTML = '';
  for (const a of triggered) {
    const at = a.triggered_price ? ` at ${formatPrice(a.triggered_price)}` : '';
    trigUl.append(
      row(a, `${a.direction === 'above' ? 'Rose above' : 'Fell below'} ${formatPrice(a.target_price)}${at} · ${fmtWhen(a.triggered_at)}`, [
        linkButton('Re-arm', () => rearm(a)),
        linkButton('Delete', () => remove(a)),
      ])
    );
  }
}

function renderAll() {
  renderControl();
  renderTab();
}

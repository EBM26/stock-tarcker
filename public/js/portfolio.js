// Portfolio tab: holdings (symbol, shares, average cost) with live value and profit/loss.
import { api } from './api.js';
import { changeClass, formatMoney, formatPercent, formatPrice, formatShares } from './format.js';
import { createSearch } from './search.js';

const $ = (sel) => document.querySelector(sel);

const s = {
  holdings: [],
  loaded: false,
  editing: null, // holding being edited, or null when adding
  formSymbol: null, // { symbol, name } chosen in the add form
  search: null,
  getQuote: () => null,
  openSymbol: () => {},
  notify: () => {},
  onHoldingsChanged: () => {},
};

export function init({ getQuote, openSymbol, notify, onHoldingsChanged }) {
  Object.assign(s, { getQuote, openSymbol, notify, onHoldingsChanged });

  s.search = createSearch($('#holding-search'), {
    placeholder: 'Search ticker',
    onSelect: (r) => {
      const existing = s.holdings.find((h) => h.symbol === r.symbol);
      if (existing) {
        s.notify(`${r.symbol} is already in your portfolio, so you're editing it now.`);
        openForm(existing);
        return;
      }
      s.formSymbol = r;
      renderFormSymbol();
      $('#holding-shares').focus();
    },
  });

  $('#holding-add-btn').addEventListener('click', () => openForm(null));
  $('#holding-cancel').addEventListener('click', closeForm);
  $('#holding-form').addEventListener('submit', submitForm);
}

// ------------------------------------------------------------ data

export async function load() {
  try {
    const { holdings } = await api('/api/holdings');
    s.holdings = holdings;
    s.loaded = true;
  } catch (err) {
    if (err.status === 401) return;
    if (!s.loaded) s.notify(`Couldn't load your portfolio. ${err.message}`);
  }
  render();
}

export function symbols() {
  return s.holdings.map((h) => h.symbol);
}

// ------------------------------------------------------------ form

function openForm(holding) {
  s.editing = holding;
  s.formSymbol = holding ? { symbol: holding.symbol } : null;
  s.search.clear();
  $('#holding-shares').value = holding ? holding.shares : '';
  $('#holding-cost').value = holding ? holding.avg_cost : '';
  renderFormSymbol();
  $('#holding-form').hidden = false;
  $('#holding-add-btn').hidden = true;
  if (holding) $('#holding-shares').focus();
  else s.search.focus();
}

function closeForm() {
  s.editing = null;
  s.formSymbol = null;
  $('#holding-form').hidden = true;
  $('#holding-add-btn').hidden = false;
}

function renderFormSymbol() {
  const label = $('#holding-symbol');
  const chosen = s.formSymbol;
  // Editing: the ticker is fixed. Adding: show the search box until a ticker is chosen.
  $('#holding-search').hidden = !!s.editing || !!chosen;
  label.hidden = !chosen;
  label.textContent = chosen ? `${chosen.symbol}${chosen.name ? ` · ${chosen.name}` : ''}` : '';
  if (chosen && !s.editing) {
    const change = document.createElement('button');
    change.type = 'button';
    change.className = 'link-btn';
    change.textContent = 'Change';
    change.style.marginLeft = '10px';
    change.onclick = () => {
      s.formSymbol = null;
      renderFormSymbol();
      s.search.focus();
    };
    label.append(change);
  }
}

async function submitForm(e) {
  e.preventDefault();
  if (!s.formSymbol) {
    s.notify('Choose a ticker first.');
    return;
  }
  const shares = Number($('#holding-shares').value);
  const avgCost = Number($('#holding-cost').value);
  if (!(shares > 0)) return s.notify('Shares must be greater than 0.');
  if (!(avgCost >= 0)) return s.notify('Average cost must be 0 or more.');

  const btn = e.submitter || $('#holding-form button[type=submit]');
  btn.disabled = true;
  try {
    if (s.editing) {
      const { holding } = await api(`/api/holdings/${s.editing.id}`, {
        method: 'PATCH',
        body: { shares, avg_cost: avgCost },
      });
      s.holdings = s.holdings.map((h) => (h.id === holding.id ? holding : h));
    } else {
      const { holding } = await api('/api/holdings', {
        method: 'POST',
        body: { symbol: s.formSymbol.symbol, shares, avg_cost: avgCost },
      });
      s.holdings = [...s.holdings, holding].sort((a, b) => a.symbol.localeCompare(b.symbol));
      s.onHoldingsChanged(); // fetch a price for the new ticker
    }
    closeForm();
    render();
  } catch (err) {
    s.notify(`Couldn't save. ${err.message}`);
  } finally {
    btn.disabled = false;
  }
}

async function remove(h) {
  if (!confirm(`Remove ${h.symbol} from your portfolio?`)) return;
  try {
    await api(`/api/holdings/${h.id}`, { method: 'DELETE' });
    s.holdings = s.holdings.filter((x) => x.id !== h.id);
    if (s.editing?.id === h.id) closeForm();
    render();
  } catch (err) {
    s.notify(`Couldn't remove ${h.symbol}. ${err.message}`);
  }
}

// ------------------------------------------------------------ table

function td(text, className = '') {
  const cell = document.createElement('td');
  cell.className = className;
  cell.textContent = text;
  return cell;
}

/** Cell with a main value and a smaller second line (e.g. P/L $ and %). */
function td2(main, sub, colorClass) {
  const cell = td(main, `num ${colorClass}`);
  if (sub) {
    const span = document.createElement('span');
    span.className = 'sub';
    span.textContent = sub;
    cell.append(span);
  }
  return cell;
}

function linkButton(text, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'link-btn';
  b.textContent = text;
  b.onclick = onClick;
  return b;
}

export function render() {
  const body = $('#holdings-body');
  const foot = $('#holdings-foot');
  body.innerHTML = '';
  foot.innerHTML = '';
  $('#holdings-empty').hidden = !s.loaded || s.holdings.length > 0;
  $('#holdings-wrap').hidden = s.holdings.length === 0;

  const totals = { value: 0, cost: 0, today: 0 };
  const missing = [];

  for (const h of s.holdings) {
    const q = s.getQuote(h.symbol);
    const cost = h.shares * h.avg_cost;
    const tr = document.createElement('tr');

    const symCell = document.createElement('td');
    const symBtn = linkButton(h.symbol, () => s.openSymbol({ symbol: h.symbol, name: h.symbol }));
    symBtn.style.fontWeight = '600';
    symBtn.style.color = 'var(--text)';
    symBtn.title = `Open ${h.symbol}`;
    symCell.append(symBtn);
    tr.append(symCell, td(formatShares(h.shares), 'num'), td(formatMoney(h.avg_cost), 'num'));

    if (q && typeof q.price === 'number') {
      const value = h.shares * q.price;
      const pl = value - cost;
      const plPct = cost > 0 ? (pl / cost) * 100 : null;
      const today = typeof q.change === 'number' ? h.shares * q.change : null;
      totals.value += value;
      totals.cost += cost;
      if (today !== null) totals.today += today;
      tr.append(
        td(formatPrice(q.price), 'num'),
        td(formatMoney(value), 'num'),
        td2(formatMoney(pl, { signed: true }), formatPercent(plPct), changeClass(pl)),
        td(today === null ? '—' : formatMoney(today, { signed: true }), `num ${changeClass(today)}`)
      );
    } else {
      missing.push(h.symbol);
      tr.append(td('—', 'num muted'), td('—', 'num muted'), td('—', 'num muted'), td('—', 'num muted'));
    }

    const actions = document.createElement('td');
    actions.className = 'row-actions';
    actions.append(
      linkButton('Edit', () => openForm(h)),
      linkButton('Delete', () => remove(h))
    );
    tr.append(actions);
    body.append(tr);
  }

  if (s.holdings.length) {
    const priced = missing.length < s.holdings.length; // show "—" rather than $0.00 when no prices yet
    const pl = totals.value - totals.cost;
    const tr = document.createElement('tr');
    tr.append(
      td('Total'),
      td(''),
      td2(priced ? formatMoney(totals.cost) : '—', 'total cost', ''),
      td(''),
      td(priced ? formatMoney(totals.value) : '—', 'num'),
      priced
        ? td2(formatMoney(pl, { signed: true }), formatPercent(totals.cost > 0 ? (pl / totals.cost) * 100 : null), changeClass(pl))
        : td('—', 'num'),
      td(priced ? formatMoney(totals.today, { signed: true }) : '—', `num ${priced ? changeClass(totals.today) : ''}`),
      td('')
    );
    foot.append(tr);
  }

  $('#holdings-note').textContent = missing.length
    ? `No price yet for ${missing.join(', ')}; totals leave ${missing.length === 1 ? 'it' : 'them'} out.`
    : '';
}

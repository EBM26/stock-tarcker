// "Summarize outlook": upsides and risks from Gemini via the server. Runs only when clicked.
import { api } from './api.js';

const $ = (sel) => document.querySelector(sel);
const s = { symbol: null, seq: 0, busy: false, retryRefresh: false };

export function init() {
  $('#risk-btn').addEventListener('click', () => run(s.retryRefresh)); // "Try again" repeats a failed refresh
}

/** Reset to the button whenever a different ticker is shown. */
export function show(symbol) {
  if (symbol === s.symbol) return;
  s.symbol = symbol;
  s.seq++;
  s.busy = false;
  s.retryRefresh = false;
  $('#risk-body').hidden = true;
  $('#risk-body').innerHTML = '';
  setStatus('');
  const btn = $('#risk-btn');
  btn.hidden = false;
  btn.disabled = false;
  btn.textContent = 'Summarize outlook';
}

function setStatus(text) {
  const el = $('#risk-status');
  el.textContent = text;
  el.hidden = !text;
}

async function run(refresh) {
  if (!s.symbol || s.busy) return;
  const mySeq = ++s.seq;
  const symbol = s.symbol;
  s.busy = true;
  const btn = $('#risk-btn');
  btn.disabled = true;
  btn.textContent = 'Summarizing…';
  setStatus('Reading recent news and basic data. This can take up to a minute.');
  try {
    // Server retries Gemini when busy, so allow plenty of time.
    const data = await api('/api/risk-summary', { method: 'POST', body: { symbol, refresh }, timeoutMs: 120000 });
    if (mySeq !== s.seq) return;
    setStatus('');
    btn.hidden = true;
    s.retryRefresh = false;
    render(data);
  } catch (err) {
    if (mySeq !== s.seq || err.status === 401) return;
    s.retryRefresh = refresh;
    setStatus(err.message || "Couldn't create the summary.");
    btn.hidden = false;
    btn.textContent = $('#risk-body').hidden ? 'Summarize outlook' : 'Try again';
  } finally {
    if (mySeq === s.seq) {
      s.busy = false;
      btn.disabled = false;
    }
  }
}

const el = (tag, className, text) => Object.assign(document.createElement(tag), { className: className || '', textContent: text ?? '' });

function itemList(items, key, tagClass) {
  const ul = el('ul', 'risk-list');
  for (const r of items) {
    const li = el('li');
    const head = el('div', 'risk-head');
    head.append(el('span', `risk-tag ${tagClass(r[key])}`, r[key]), el('strong', '', r.title));
    li.append(head, el('p', '', r.detail));
    ul.append(li);
  }
  return ul;
}

function column(title, items, key, tagClass, emptyText) {
  const col = el('div', 'outlook-col');
  col.append(el('h4', '', title));
  col.append(items.length ? itemList(items, key, tagClass) : el('p', 'muted small', emptyText));
  return col;
}

function render({ summary, created_at: createdAt, legacy, refresh_error: refreshError }) {
  const body = $('#risk-body');
  body.innerHTML = '';

  body.append(el('p', 'risk-overview', summary.overview));

  if (legacy) {
    // Saved before upsides existed and couldn't be regenerated just now: show risks only.
    const col = column('Risks', summary.risks || [], 'level', (l) => `risk-${l}`, 'No notable risks in this data.');
    body.append(col);
  } else {
    // Upside first: it comes first when the columns stack on phones.
    const grid = el('div', 'outlook-grid');
    grid.append(
      column('Upside', summary.upsides, 'strength', () => 'up-tag', 'No clear upsides in this data.'),
      column('Risks', summary.risks, 'level', (l) => `risk-${l}`, 'No notable risks in this data.')
    );
    body.append(grid);
  }

  if (summary.watch.length) {
    body.append(el('h4', '', 'Watch for'));
    const ul = el('ul', 'watch-list');
    for (const w of summary.watch) ul.append(el('li', '', w));
    body.append(ul);
  }

  body.append(el('p', 'muted small', summary.data_note));

  const meta = el('p', 'muted small risk-meta');
  const when = createdAt ? new Date(createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  meta.append(`Generated ${when} · `);
  const refresh = el('button', 'link-btn', legacy ? 'Refresh for full outlook' : 'Refresh');
  refresh.type = 'button';
  refresh.addEventListener('click', () => {
    $('#risk-btn').hidden = true;
    run(true);
  });
  meta.append(refresh);
  body.append(meta);
  if (legacy && refreshError) setStatus(`Couldn't update to the full outlook yet: ${refreshError}`);
  body.hidden = false;
}

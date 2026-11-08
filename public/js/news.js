// Latest 5 headlines for the selected ticker (last 7 days), under the chart.
import { api } from './api.js';

const $ = (sel) => document.querySelector(sel);
let current = null;
let seq = 0;

export function timeAgo(ms, now = Date.now()) {
  if (!ms) return '';
  const min = Math.max(0, Math.round((now - ms) / 60000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

function message(text) {
  $('#news-list').innerHTML = '';
  const el = $('#news-message');
  el.textContent = text;
  el.hidden = !text;
}

export async function show(symbol) {
  if (symbol === current) return;
  current = symbol;
  const mySeq = ++seq;
  message('Loading news…');
  try {
    const { news } = await api(`/api/news?symbol=${encodeURIComponent(symbol)}`);
    if (mySeq !== seq) return;
    if (!news.length) return message('No news in the past week.');
    message('');
    const ul = $('#news-list');
    for (const n of news) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = n.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = n.headline;
      const meta = document.createElement('span');
      meta.className = 'news-meta';
      meta.textContent = [n.source, timeAgo(n.time)].filter(Boolean).join(' · ');
      li.append(a, meta);
      ul.append(li);
    }
  } catch (err) {
    if (mySeq !== seq || err.status === 401) return;
    current = null; // allow a retry next time this ticker is shown
    message(`Couldn't load news. ${err.message}`);
  }
}

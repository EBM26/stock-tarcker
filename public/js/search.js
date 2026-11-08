// Reusable ticker search box with autocomplete (also used later for compare and portfolio).
import { api } from './api.js';

const DEBOUNCE_MS = 300;
let uid = 0;

/**
 * @param {HTMLElement} container  element to render into
 * @param {{ placeholder?: string, onSelect: (r: {symbol: string, name: string}) => void }} opts
 */
export function createSearch(container, { placeholder = 'Search ticker or company', onSelect }) {
  const id = `search-${++uid}`;
  container.classList.add('search');
  container.innerHTML = `
    <input type="search" role="combobox" aria-autocomplete="list" aria-expanded="false"
      aria-controls="${id}-list" autocomplete="off" spellcheck="false" placeholder="${placeholder}">
    <ul id="${id}-list" class="search-results" role="listbox" hidden></ul>`;
  const input = container.querySelector('input');
  const list = container.querySelector('ul');

  const memo = new Map();
  let timer = null;
  let controller = null;
  let results = [];
  let active = -1;

  function close() {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  }

  function showInfo(text) {
    results = [];
    list.innerHTML = '';
    const li = document.createElement('li');
    li.className = 'info';
    li.textContent = text;
    list.append(li);
    list.hidden = false;
  }

  function render() {
    list.innerHTML = '';
    if (!results.length) return showInfo('No matching US stocks or ETFs.');
    results.forEach((r, i) => {
      const li = document.createElement('li');
      li.id = `${id}-opt-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === active));
      li.innerHTML = '<span class="sym"></span><span class="name"></span>';
      li.querySelector('.sym').textContent = r.symbol;
      li.querySelector('.name').textContent = r.name;
      li.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the input
      li.addEventListener('click', () => choose(i));
      list.append(li);
    });
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (active >= 0) input.setAttribute('aria-activedescendant', `${id}-opt-${active}`);
  }

  function choose(i) {
    const r = results[i];
    if (!r) return;
    input.value = '';
    close();
    input.blur();
    onSelect(r);
  }

  async function run(q) {
    const key = q.toUpperCase();
    if (memo.has(key)) {
      results = memo.get(key);
      active = results.length ? 0 : -1;
      return render();
    }
    controller?.abort();
    controller = new AbortController();
    showInfo('Searching…');
    try {
      const data = await api(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
      if (input.value.trim().toUpperCase() !== key) return; // stale
      results = data.results || [];
      memo.set(key, results);
      active = results.length ? 0 : -1;
      render();
    } catch (err) {
      if (err?.name === 'AbortError') return;
      showInfo(err.message || 'Search is unavailable right now.');
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 1) {
      controller?.abort();
      return close();
    }
    timer = setTimeout(() => run(q), DEBOUNCE_MS);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      close();
      return;
    }
    if (list.hidden || !results.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      active = (active + d + results.length) % results.length;
      render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(active >= 0 ? active : 0);
    }
  });

  input.addEventListener('blur', () => setTimeout(close, 100));
  input.addEventListener('focus', () => {
    if (input.value.trim() && results.length) render();
  });

  return { focus: () => input.focus(), clear: () => { input.value = ''; close(); } };
}

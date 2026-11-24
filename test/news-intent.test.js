'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function loadChronoPulse() {
  const elements = new Map();
  const intervals = [];
  const document = {
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, {
          innerHTML: '', textContent: '', value: '', listeners: {},
          classList: { toggle() {} },
          addEventListener(name, callback) { this.listeners[name] = callback; },
        });
      }
      return elements.get(id);
    },
  };
  const window = {};
  const context = {
    document,
    window,
    setInterval(callback, delay) { intervals.push({ callback, delay }); return intervals.length; },
  };
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInNewContext(`${script}\nthis.appState = state; this.runQuery = runQuery;`, context);
  return { context, elements, intervals };
}

test('ChronoPulse pages are synchronized and use the requested dark link colors', () => {
  const dist = fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8');
  assert.equal(dist, html);
  assert.match(html, /--accent:\s*#38bdf8/i);
  assert.match(html, /--accent-hover:\s*#7dd3fc/i);
  assert.match(html, /Europe\/Istanbul/);
  assert.match(html, /dateStyle:\s*"full",\s*timeStyle:\s*"medium"/);
});

test('clock and agenda/technology refresh timers are configured independently', () => {
  const { intervals } = loadChronoPulse();
  assert.deepEqual(intervals.map(({ delay }) => delay), [1000, 5 * 60 * 1000]);
});

test('agenda categories maintain the visible numbered list for detail follow-ups', () => {
  const { context, elements } = loadChronoPulse();
  const state = context.appState;
  assert.equal(state.agendaItems.length, 7);
  assert.match(elements.get('agenda-filters').innerHTML, /Ekonomi/);
  assert.equal(state.lastShownAgenda.length, 7);

  const answer = context.runQuery('2. gündem detayı');
  assert.match(answer, /Piyasalar ve Ekonomik Göstergeler/);
  assert.match(answer, /Ticaret, üretim ve finansal gelişmeler/);

  context.window.selectAgendaCat('Oyun');
  assert.equal(state.lastShownAgenda.length, 1);
  assert.equal(state.lastShownAgenda[0].cat, 'Oyun');
  assert.match(elements.get('agenda-list').innerHTML, /Oyun Dünyası ve Etkileşimli Medya/);
  assert.match(context.runQuery('1. gündem detayı'), /Oyun Dünyası ve Etkileşimli Medya/);
});

test('history filters and technology queries show their matching archive/stream', () => {
  const { context, elements } = loadChronoPulse();
  assert.equal(context.appState.historyItems.length, 4);
  assert.equal(context.appState.techItems.length, 3);

  context.window.selectHistoryCat('Antik Çağ');
  const historyList = elements.get('history-list').innerHTML;
  assert.match(historyList, /Yazı, Kent Devletleri/);
  assert.doesNotMatch(historyList, /Matbaa, Sanayi/);
  assert.match(context.runQuery('tarihçe'), /Var Olan Şeylerin Tarihçesi/);
  assert.match(context.runQuery('teknoloji'), /Otonom Ajanlar ve Çok Modlu Sistemler/);
  assert.match(elements.get('tech-list').innerHTML, /Yeni Nesil Çipler/);
});

test('manual refresh updates status and query submission renders the selected result', () => {
  const { context, elements } = loadChronoPulse();
  const refresh = elements.get('force-refresh-btn');
  refresh.listeners.click();
  assert.match(elements.get('sync-status').textContent, /Manuel yenilendi/);

  const input = context.document.getElementById('query-input');
  input.value = 'teknoloji';
  let prevented = false;
  elements.get('query-form').listeners.submit({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(input.value, '');
  assert.match(elements.get('query-output').innerHTML, /Gelişen Teknoloji/);
});

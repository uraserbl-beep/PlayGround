'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const newsIntent = require('../news-intent');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const inlineScript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]).join('\n');
const normalize = (value) => String(value || '').toLocaleLowerCase('tr-TR')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i');

function loadFunction(start, end, context = {}) {
  const startAt = inlineScript.indexOf(start);
  const endAt = inlineScript.indexOf(end, startAt);
  assert.notEqual(startAt, -1, `could not find ${start}`);
  assert.notEqual(endAt, -1, `could not find ${end}`);
  const functionName = start.slice('function '.length, start.indexOf('('));
  vm.runInNewContext(`${inlineScript.slice(startAt, endAt)}\nthis.testFunction = ${functionName};`, context);
  return context.testFunction;
}

test('FoVerse deployment HTML stays synchronized and preserves the requested link styling', () => {
  const dist = fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8');
  assert.equal(dist, html);
  assert.match(html, /--accent:#38bdf8/i);
  assert.match(html, /--accent-hover:#7dd3fc/i);
  assert.match(html, /\.answer a\{color:var\(--accent\)/);
  assert.match(html, /overflow-wrap:anywhere/);
  assert.match(html, /word-break:break-word/);
});

test('currency intent is excluded from live news search while news categories are searched', () => {
  const window = { FoVerseNewsIntent: newsIntent };
  const shouldSearch = loadFunction('function shouldSearch(', 'function resolveNumberedNewsFollowup', { window, normText: normalize });

  for (const query of ['Dolar kaç TL?', 'EUR/USD kuru nedir?', 'Japon yeni kuru']) {
    assert.equal(newsIntent.classifyIntent(query), 'CURRENCY');
    assert.equal(shouldSearch(query), false, query);
    assert.equal(newsIntent.searchQuery(query), '');
  }
  for (const query of ['Ekonomi gündemi', 'Oyun haberleri', 'Son dakika']) {
    assert.equal(newsIntent.classifyIntent(query), 'NEWS_CATEGORY');
    assert.equal(shouldSearch(query), true, query);
    assert.ok(newsIntent.searchQuery(query));
  }
  assert.equal(shouldSearch('Saat şu an kaç?'), false);
  assert.equal(shouldSearch('Twitter trendleri'), false);
});

test('numbered follow-up resolves against the most recently displayed result items', () => {
  const window = { FoVerseNewsIntent: newsIntent };
  const document = { querySelectorAll() { return []; } };
  const context = { window, document, lastShownItems: [
    { title: 'Birinci başlık' },
    { title: 'İstanbul’da yeni ulaşım düzenlemesi açıklandı' },
  ] };
  const resolveFollowup = loadFunction('function resolveNumberedNewsFollowup(', 'function buildSearchQuery', context);

  assert.equal(resolveFollowup('2. haber detayı'), 'Haber detayı İstanbul’da yeni ulaşım düzenlemesi açıklandı');
  assert.equal(resolveFollowup('1. haber'), 'Haber detayı Birinci başlık');
  assert.equal(resolveFollowup('merhaba'), '');
});

test('Istanbul clock is initialized immediately and refreshed every 30 seconds', () => {
  const clockLine = inlineScript.split('\n').find((line) => line.includes('function clock(){'));
  assert.ok(clockLine, 'clock implementation should be present');
  let tick = 0;
  let interval;
  const clockElement = { textContent: '' };
  const context = {
    $, Intl: { DateTimeFormat: class { format() { return `tick-${++tick}`; } } },
    setInterval(callback, delay) { interval = { callback, delay }; },
  };
  function $(id) { assert.equal(id, 'clock'); return clockElement; }
  vm.runInNewContext(clockLine, context);

  assert.match(clockElement.textContent, /tick-1 · Europe\/Istanbul \(UTC\+3\)/);
  assert.equal(interval.delay, 30000);
  interval.callback();
  assert.match(clockElement.textContent, /tick-2 · Europe\/Istanbul \(UTC\+3\)/);
});

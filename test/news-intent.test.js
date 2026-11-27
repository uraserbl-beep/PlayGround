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
  const makeElement = () => ({
    innerHTML: '', textContent: '', value: '', listeners: {}, style: {}, dataset: {},
    classList: {
      toggle() {}, add() {}, remove() {}, contains() { return false; },
    },
    addEventListener(name, callback) { this.listeners[name] = callback; },
    setAttribute() {}, appendChild() {}, remove() {}, focus() {}, click() {},
    play() { return Promise.resolve(); }, pause() {},
  });
  const document = {
    documentElement: { style: { setProperty() {} } },
    body: { dataset: {}, classList: { add() {}, remove() {} } },
    activeElement: null,
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement());
      return elements.get(id);
    },
    querySelectorAll() { return []; },
    createElement() { return makeElement(); },
  };
  const window = { addEventListener() {} };
  const context = {
    document,
    window,
    setInterval(callback, delay) { intervals.push({ callback, delay }); return intervals.length; },
  };
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  const script = scripts.find((candidate) => candidate.includes('const AGENDA_CATEGORIES'));
  assert.ok(script, 'the ChronoPulse inline script should be present');
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
  assert.match(html, /Tarih Arşivi · Tarih Öncesi → 2026/);
  assert.match(html, /Kavramların Tarihi/);
});

test('FoVerse prompt preserves the complete negative examples and Turkish style rules', () => {
  const rules = html.match(/const FO_VERSE_DIALOGUE_RULES=`([\s\S]*?)`;/)?.[1];
  assert.ok(rules, 'the complete FoVerse dialogue rules should be defined');
  for (const requiredText of [
    'BÖLÜM 6: NEGATİF VERİ SETİ (HALÜSİNASYON VE MANTIK KORUMASI)',
    'Sıfır Uydurma İlkesi: Sana verilen bilgi tabanında',
    'Yanlış Öncülü Düzeltme: Kullanıcı sorunun içinde',
    'Rol Tutarlılığı: Eğer bir oyun içi karakter (NPC)',
    'Örnek 1: Var Olmayan Bilgi / Uydurma Testi',
    '1982 yılında Nintendo\'nun çıkardığı \'Super Cyber Mario 2099\' oyunu hakkında bilgi verir misin?',
    'Örnek 2: Yanlış Tarih / Mantık Hatası Düzeltme',
    'İstanbul\'un fethinden sonra Fatih Sultan Mehmet Amerika\'yı keşfetti değil mi?',
    'Örnek 3: Güncel Veri Eksikliği (Dürüstlük Testi)',
    'Dün akşam oynanan şampiyonluk maçının skoru kaç kaç bitti?',
    'Örnek 4: Oyun İçi Evren (Lore) ve Gerçek Dünya Ayrımı',
    'Oyundaki kadim ejderha Ignis hangi gerçek dünya savaşında yer aldı?',
    'BÖLÜM 7: DOĞAL TÜRKÇE DİYALOG VE ÜSLUP KALIBI',
    'Cevapları en fazla 3-4 cümlelik akıcı paragraflar veya maddeler halinde ver.',
    'Bunun yanında',
    'İşin ilginç yanı',
    'Kısacası',
    'Oyuncuya bilgi verdikten sonra sohbeti canlı tutmak için ilgili kısa bir soru veya seçenek sun',
  ]) assert.ok(rules.includes(requiredText), `missing prompt text: ${requiredText}`);
  assert.match(html, /\+FO_VERSE_DIALOGUE_RULES/);
  assert.match(html, /const system=.*FO_VERSE_DIALOGUE_RULES/);
});

test('all inline scripts remain syntactically valid', () => {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length > 0, 'at least one inline script should be present');
  for (const [index, match] of scripts.entries()) {
    assert.doesNotThrow(() => new vm.Script(match[1]), `inline script ${index + 1} should parse`);
  }
});

test('clock and agenda/technology refresh timers are configured independently', () => {
  const { intervals } = loadChronoPulse();
  const delays = intervals.map(({ delay }) => delay);
  assert.ok(delays.includes(1000), 'the ChronoPulse clock should refresh every second');
  assert.ok(delays.includes(5 * 60 * 1000), 'agenda and technology should refresh every five minutes');
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
  assert.equal(context.appState.historyItems.length, 142);
  assert.equal(context.appState.techItems.length, 3);

  context.window.selectHistoryCat('Antik Çağ');
  const historyList = elements.get('history-list').innerHTML;
  assert.match(historyList, /Klasik Akdeniz ve Düşünce Gelenekleri/);
  assert.doesNotMatch(historyList, /Neolitik Dönüşüm/);
  assert.match(context.runQuery('tarihçe'), /Tarih Arşivi/);
  assert.match(context.runQuery('teknoloji'), /Otonom Ajanlar ve Çok Modlu Sistemler/);
  assert.match(context.runQuery('penisilin'), /Penisilinin Keşfi \(1928\)/);
  assert.equal(context.window.historySearchMatches('penisilin')[0].title, 'Penisilinin Keşfi (1928)');
  context.window.selectHistoryCat('Bilim, Teknoloji ve İcatlar');
  assert.match(elements.get('history-list').innerHTML, /DNA'nın Çift Sarmal Yapısı/);
  assert.match(elements.get('tech-list').innerHTML, /Yeni Nesil Çipler/);
  context.window.selectHistoryCat('Mitoloji ve Evrensel Kültür');
  assert.match(elements.get('history-list').innerHTML, /Yunan Mitolojisi/);
  assert.equal(context.window.historySearchMatches('mitoloji')[0].cat, 'Mitoloji ve Evrensel Kültür');
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

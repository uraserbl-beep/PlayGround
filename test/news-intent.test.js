'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const intent = require('../news-intent');

const exactPrompts = [
  'Selam gündemde ne var?',
  'Siyaset',
  'Dünyada neler olduğunu öğrenmek istiyorum',
];

test('exact live-news prompts are detected and mapped to topic queries', () => {
  for (const prompt of exactPrompts) assert.equal(intent.isNewsIntent(prompt), true, prompt);

  assert.equal(intent.topicFor(exactPrompts[0]).label, 'Güncel gündem');
  assert.equal(intent.topicFor(exactPrompts[1]).label, 'Siyaset gündemi');
  assert.equal(intent.topicFor(exactPrompts[2]).label, 'Dünya gündemi');

  assert.match(intent.searchQuery(exactPrompts[0]), /gündem/i);
  assert.match(intent.searchQuery(exactPrompts[1]), /siyaset/i);
  assert.match(intent.searchQuery(exactPrompts[2]), /dünya/i);
});

test('gaming and recipe intents have category-specific behavior', () => {
  assert.equal(intent.topicFor('Oyun gündeminde bugün ne var?').label, 'Oyun gündemi');
  assert.match(intent.searchQuery('Oyun gündeminde bugün ne var?'), /Steam|PlayStation|Xbox|Nintendo/);
  assert.doesNotMatch(intent.searchQuery('Oyun gündeminde bugün ne var?'), /Türkiye siyaset/i);

  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /tarif|recipe/i);
  assert.match(html, /Malzemeler/);
  assert.match(html, /Pratik hazırlık/);
  assert.match(html, /250 g makarna/);
  assert.match(html, /1 su bardağı kırmızı mercimek/);
  const recipeStart = html.indexOf('function localRecipe(query){');
  const recipeEnd = html.indexOf('function localAnswer(q){', recipeStart);
  assert.ok(recipeStart >= 0 && recipeEnd > recipeStart);
  const context = { normText: (value) => String(value).toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ç/g, 'c') };
  vm.runInNewContext(html.slice(recipeStart, recipeEnd) + '\nthis.localRecipe=localRecipe;', context);
  assert.match(context.localRecipe('Makarna tarifi'), /250 g makarna/);
  assert.match(html, /Yaklaşık 20 dakika kaynat|yaklaşık 20 dakika kaynat/i);
  assert.doesNotMatch(html.slice(html.indexOf("if(/(tarif|recipe"), html.indexOf("if(topicOf(t)==='gaming'")), /Biraz daha ayrıntı verir misin/);
});

test('topic failure copy is honest and never uses generic clarification prompts', () => {
  for (const prompt of exactPrompts) {
    const message = intent.failureMessage(prompt);
    assert.doesNotMatch(message, /Sorunu veya üzerinde çalıştığınız konuyu yazın/i);
    assert.doesNotMatch(message, /Biraz daha ayrıntı verir misin/i);
    assert.match(message, /canlı .*sonuçlarını alamadım/i);
  }
});

test('news detail requests are focused instead of generic topic searches', () => {
  assert.equal(intent.isNewsDetailRequest('Türkiyenin nato için önemli rol üstlenmesi haberi hakkında biraz daha detay verir misin?'), true);
  assert.equal(intent.detailSearchQuery('Türkiyenin nato için önemli rol üstlenmesi haberi hakkında biraz daha detay verir misin?'), 'Türkiyenin nato önemli rol üstlenmesi');
  assert.equal(intent.isNewsDetailRequest('8. Haber hakkında biraz daha detay verirmisin?'), true);
  assert.doesNotMatch(intent.searchQuery('Türkiyenin nato için önemli rol üstlenmesi haberi hakkında biraz daha detay verir misin?'), /gündem son dakika/i);

  assert.equal(intent.detailSearchQuery('SON DAKİKA | 3. Türkiye NATO Zirvesi Trump Türkiye hakkında detay'), 'Türkiye NATO Zirvesi Trump Türkiye');
  assert.deepEqual(intent.detailSearchQueries('SON DAKİKA | Türkiye NATO Zirvesi Trump Türkiye haberi hakkında detay'), ['Türkiye NATO Zirvesi Trump Türkiye', 'NATO Zirvesi Trump Türkiye']);
});

test('detail failure copy names the subject and avoids fabrication', () => {
  const message = intent.failureMessage('Haber detayı Türkiye NATO Zirvesi Trump Türkiye');
  assert.match(message, /Türkiye NATO Zirvesi Trump Türkiye/);
  assert.match(message, /doğrulayamadım|erişilemiyor/);
  assert.doesNotMatch(message, /doğrulanmış bilgi olarak|Soruyu|hangi haber/i);
});

test('numbered follow-up resolves the previous item title and searches it specifically', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const start = html.indexOf('function resolveNumberedNewsFollowup(query){');
  const end = html.indexOf('function buildSearchQuery(query){', start);
  assert.ok(start >= 0 && end > start);
  const context = {
    window: { FoVerseNewsIntent: intent },
    document: { querySelectorAll: () => [{ innerText: 'Güncel gündem başlıkları\n1. İlk haber\n8. Türkiye NATO ilişkilerinde yeni gelişme' }] },
  };
  vm.runInNewContext(html.slice(start, end) + '\nthis.resolveNumberedNewsFollowup=resolveNumberedNewsFollowup;', context);
  const resolved = context.resolveNumberedNewsFollowup('8. Haber hakkında biraz daha detay verir misin?');
  assert.equal(resolved, 'Haber detayı Türkiye NATO ilişkilerinde yeni gelişme');

  const queryStart = html.indexOf('function buildSearchQuery(query){');
  const queryEnd = html.indexOf('async function searchWeb(query)', queryStart);
  assert.ok(queryStart >= 0 && queryEnd > queryStart);
  vm.runInNewContext(html.slice(queryStart, queryEnd) + '\nthis.buildSearchQuery=buildSearchQuery;', context);
  assert.equal(context.buildSearchQuery(resolved), 'Türkiye NATO ilişkilerinde yeni gelişme');
});

test('client detail rendering is a short single-story response, not the general news list', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const start = html.indexOf('function localSearchAnswer(items,reason,query){');
  const end = html.indexOf('async function send(){', start);
  assert.ok(start >= 0 && end > start);
  const context = {
    window: { FoVerseNewsIntent: intent },
    esc: (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])),
  };
  vm.runInNewContext(html.slice(start, end) + '\nthis.localSearchAnswer=localSearchAnswer;', context);
  const items = [1, 2, 3, 4].map((number) => ({ title: `İlgili haber ${number}`, url: `https://example.com/${number}`, snippet: number === 1 ? '' : `Özet ${number}` }));
  const answer = context.localSearchAnswer(items, '', 'Haber detayı Türkiye NATO ilişkileri');
  assert.match(answer, /<h2>Haber detayı<\/h2>/);
  assert.doesNotMatch(answer, /Güncel gündem başlıkları/);
  assert.equal((answer.match(/<li>/g) || []).length, 3);
  assert.doesNotMatch(answer, /İlgili haber 4/);
  assert.doesNotMatch(answer, /İlgili haber 1<\/a><br>/);
});

test('high-contrast chat, news links and contrast styles are present', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /\.message\.ai \.answer/);
  assert.match(html, /color:#f3f4f6|color:#fff|#e5e7eb/i);
  assert.match(html, /\.answer a|answer.*a|target="_blank"/);
});

test('client HTML loads the reusable news module and wires topic fallback', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /<script src="\/news-intent\.js"><\/script>/);
  assert.match(html, /FoVerseNewsIntent\?\.isNewsIntent/);
  assert.match(html, /FoVerseNewsIntent\?\.searchQuery/);
  assert.match(html, /localSearchAnswer\(searchResult.*effectiveQuery/);
});

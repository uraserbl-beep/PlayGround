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

test('news memory numbers valid results sequentially and numbered follow-up returns title, summary, and source', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const start = html.indexOf('const sessionMemory={lastNewsList:[]};');
  const end = html.indexOf('function buildSearchQuery(query){', start);
  assert.ok(start >= 0 && end > start);
  const context = {
    window: { FoVerseNewsIntent: intent },
    esc: (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])),
  };
  vm.runInNewContext(html.slice(start, end) + '\nthis.sessionMemory=sessionMemory;this.rememberNewsList=rememberNewsList;this.numberedNewsItem=numberedNewsItem;this.numberedNewsAnswer=numberedNewsAnswer;this.resolveNumberedNewsFollowup=resolveNumberedNewsFollowup;', context);
  context.rememberNewsList([
    { title: '', url: 'https://example.com/invalid' },
    { title: 'Türkiye NATO ilişkilerinde yeni gelişme', snippet: 'Görüşme bugün yapıldı.', url: 'https://example.com/nato' },
  ]);
  assert.equal(context.sessionMemory.lastNewsList[0].number, 1);
  const item = context.numberedNewsItem('1. haber hakkında biraz daha detay verir misin?');
  assert.equal(item.title, 'Türkiye NATO ilişkilerinde yeni gelişme');
  const answer = context.numberedNewsAnswer(item);
  assert.match(answer, /Türkiye NATO ilişkilerinde yeni gelişme/);
  assert.match(answer, /Görüşme bugün yapıldı\./);
  assert.match(answer, /href="https:\/\/example\.com\/nato"/);
  assert.match(answer, /Kaynak:/);
  const resolved = context.resolveNumberedNewsFollowup('1. haber hakkında biraz daha detay verir misin?');
  assert.match(resolved, /Haber detayı Türkiye NATO ilişkilerinde yeni gelişme/);
  assert.match(resolved, /Kaynak: https:\/\/example\.com\/nato/);
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

test('priority intents, categories, and Istanbul clock are recognized', () => {
  assert.equal(intent.classifyIntent('Bugün dolar kaç TL?'), 'CURRENCY');
  assert.equal(intent.classifyIntent('Euro kaç lira?'), 'CURRENCY');
  assert.equal(intent.classifyIntent('İstanbul’da saat kaç?'), 'TIME');
  assert.equal(intent.classifyIntent('X trendleri ve Instagram gündemi'), 'SOCIAL');
  for (const prompt of ['Oyun gündemi', 'Ekonomi haberi', 'Siyaset haberleri', 'Teknoloji', 'Spor', 'Sağlık', 'Dünya', 'Son dakika']) {
    assert.equal(intent.classifyIntent(prompt), 'NEWS_CATEGORY', prompt);
  }

  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /Europe\/Istanbul/);
  assert.match(html, /setInterval\(clock,1000\)/);
  assert.match(html, /api\.frankfurter\.app\/latest\?from=/);
  assert.match(html, /#38bdf8/);
  assert.match(html, /#7dd3fc/);
});

test('numbered memory follow-up must not trigger live search', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /const needsSearch=intent==='NEWS_CATEGORY'\|\|intent==='SOCIAL'\|\|\(!numberedItem&&/);
  assert.match(html, /else if\(numberedItem\)answer=numberedNewsAnswer\(numberedItem\)/);
});

test('classic light chat, readable answers and news link colors are present', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /body\{[^}]*background:var\(--bg\)/);
  assert.match(html, /\.answer\{[^}]*font-size:15px;line-height:1\.65/);
  assert.match(html, /\.answer a\{color:#38bdf8/);
  assert.match(html, /\.answer a:hover\{color:#7dd3fc/);
  assert.doesNotMatch(html, /liveWallpaper|wallpaper-shade|wallpaper-toggle/);
});

test('client HTML loads the reusable news module and wires topic fallback', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /<script src="\/news-intent\.js"><\/script>/);
  assert.match(html, /FoVerseNewsIntent\?\.isNewsIntent/);
  assert.match(html, /FoVerseNewsIntent\?\.searchQuery/);
  assert.match(html, /localSearchAnswer\(searchResult.*effectiveQuery/);
});

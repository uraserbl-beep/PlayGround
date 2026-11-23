'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const intent = require('../news-intent');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const exactPrompts = [
  'Selam gündemde ne var?',
  'Siyaset',
  'Dünyada neler olduğunu öğrenmek istiyorum',
];

class FakeElement {
  constructor(id) {
    this.id = id;
    this.innerHTML = '';
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.dataset = {};
    this.handlers = {};
    this.attributes = {};
    this.classes = new Set();
    this.classList = {
      add: (name) => this.classes.add(name),
      remove: (name) => this.classes.delete(name),
      toggle: (name) => {
        if (this.classes.has(name)) {
          this.classes.delete(name);
          return false;
        }
        this.classes.add(name);
        return true;
      },
      contains: (name) => this.classes.has(name),
    };
  }

  addEventListener(type, handler) {
    this.handlers[type] = handler;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  focus() {
    this.focused = true;
  }
}

function createClient(fetchImpl = async () => { throw new Error('Unexpected fetch'); }) {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new FakeElement(id));
      return elements.get(id);
    },
  };
  const context = {
    document,
    fetch: fetchImpl,
    Intl,
    Date,
    setInterval() {},
    setTimeout() {},
    console,
  };
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'The dashboard should have its inline client script');
  vm.runInNewContext(script, context, { timeout: 1000 });
  return { elements, context, element: (id) => document.getElementById(id) };
}

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('exact live-news prompts are detected and mapped to topic queries', () => {
  for (const prompt of exactPrompts) assert.equal(intent.isNewsIntent(prompt), true, prompt);

  assert.equal(intent.topicFor(exactPrompts[0]).label, 'Güncel gündem');
  assert.equal(intent.topicFor(exactPrompts[1]).label, 'Siyaset gündemi');
  assert.equal(intent.topicFor(exactPrompts[2]).label, 'Dünya gündemi');

  assert.match(intent.searchQuery(exactPrompts[0]), /gündem/i);
  assert.match(intent.searchQuery(exactPrompts[1]), /siyaset/i);
  assert.match(intent.searchQuery(exactPrompts[2]), /dünya/i);
});

test('gaming news intent maps to a gaming-specific search query', () => {
  assert.equal(intent.topicFor('Oyun gündeminde bugün ne var?').label, 'Oyun gündemi');
  assert.match(intent.searchQuery('Oyun gündeminde bugün ne var?'), /Steam|PlayStation|Xbox|Nintendo/);
  assert.doesNotMatch(intent.searchQuery('Oyun gündeminde bugün ne var?'), /Türkiye siyaset/i);
});

test('topic failure copy is honest and avoids generic clarification prompts', () => {
  for (const prompt of exactPrompts) {
    const message = intent.failureMessage(prompt);
    assert.doesNotMatch(message, /Sorunu veya üzerinde çalıştığınız konuyu yazın/i);
    assert.doesNotMatch(message, /Biraz daha ayrıntı verir misin/i);
    assert.match(message, /canlı .*sonuçlarını alamadım/i);
  }
});

test('detail requests resolve to focused, non-generic search queries', () => {
  assert.equal(intent.isNewsDetailRequest('Türkiyenin nato için önemli rol üstlenmesi haberi hakkında biraz daha detay verir misin?'), true);
  assert.equal(intent.detailSearchQuery('Türkiyenin nato için önemli rol üstlenmesi haberi hakkında biraz daha detay verir misin?'), 'Türkiyenin nato önemli rol üstlenmesi');
  assert.equal(intent.isNewsDetailRequest('8. Haber hakkında biraz daha detay verirmisin?'), true);
  assert.doesNotMatch(intent.searchQuery('Türkiyenin nato için önemli rol üstlenmesi haberi hakkında biraz daha detay verir misin?'), /gündem son dakika/i);
  assert.equal(intent.detailSearchQuery('SON DAKİKA | 3. Türkiye NATO Zirvesi Trump Türkiye hakkında detay'), 'Türkiye NATO Zirvesi Trump Türkiye');
  assert.deepEqual(intent.detailSearchQueries('SON DAKİKA | Türkiye NATO Zirvesi Trump Türkiye haberi hakkında detay'), ['Türkiye NATO Zirvesi Trump Türkiye', 'NATO Zirvesi Trump Türkiye']);
});

test('detail failure copy names the subject and does not fabricate information', () => {
  const message = intent.failureMessage('Haber detayı Türkiye NATO Zirvesi Trump Türkiye');
  assert.match(message, /Türkiye NATO Zirvesi Trump Türkiye/);
  assert.match(message, /doğrulayamadım|erişilemiyor/);
  assert.doesNotMatch(message, /doğrulanmış bilgi olarak|Soruyu|hangi haber/i);
});

test('dashboard renders labeled demo stories and interactive category and 5N1K controls', () => {
  assert.match(html, /Durum raporu/);
  assert.match(html, /Kategorize Edilmiş Veri Akışı/);
  assert.match(html, /Yapay Zekâ Çıkarımı/);
  assert.match(html, /Proaktif Öneri/);
  assert.match(html, /Şeffaflık:<\/strong> Sarı <b>\[ÖRNEK VERİ\]<\/b> etiketi taşıyan tüm kayıtlar kurgusal arayüz testidir/);
  assert.match(html, /flex-wrap:wrap/);
  assert.match(html, /overflow-wrap:anywhere/);
  assert.match(html, /@media\(max-width:600px\)/);
  assert.match(html, /@media\(max-width:380px\)/);

  const { elements } = createClient();
  const feed = elements.get('feed');
  assert.equal((feed.innerHTML.match(/class="story"/g) || []).length, 4);
  assert.match(feed.innerHTML, /\[ÖRNEK VERİ\]/);
  assert.doesNotMatch(feed.innerHTML, /CANLI ARAMA/);
  assert.match(feed.innerHTML, /Kurgusal test kaydı/);
  assert.match(feed.innerHTML, /5N1K özeti/);
  assert.match(feed.innerHTML, /Kaynak: FoVerse test senaryosu/);

  elements.get('filters').handlers.click({
    target: { closest: () => ({ dataset: { category: 'Teknoloji' } }) },
  });
  assert.equal((feed.innerHTML.match(/class="story"/g) || []).length, 1);
  assert.match(feed.innerHTML, /Kent laboratuvarı/);
  assert.doesNotMatch(feed.innerHTML, /Bölgesel iklim/);
  assert.match(elements.get('filters').innerHTML, /data-category="Teknoloji" aria-pressed="true"/);

  const cardClasses = new Set();
  const card = { classList: { toggle(name) { if (cardClasses.has(name)) { cardClasses.delete(name); return false; } cardClasses.add(name); return true; } } };
  const button = new FakeElement('detail');
  button.closest = () => card;
  elements.get('feed').handlers.click({ target: { closest: () => button } });
  assert.equal(button.attributes['aria-expanded'], 'true');
  assert.match(button.textContent, /kapat/);
  assert.equal(cardClasses.has('open'), true);
  elements.get('feed').handlers.click({ target: { closest: () => button } });
  assert.equal(button.attributes['aria-expanded'], 'false');
  assert.equal(cardClasses.has('open'), false);
});

test('successful live search renders source links and keeps verification limits visible', async () => {
  const { elements, element } = createClient(async (url, options) => {
    assert.equal(url, '/api/search');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { query: 'yapay zekâ', count: 8 });
    return {
      ok: true,
      async json() {
        return { items: [{ title: 'Yapay zekâ haberi', snippet: 'Kaynak açıklaması', url: 'https://news.example/story' }] };
      },
    };
  });

  const query = element('query');
  query.value = 'yapay zekâ';
  elements.get('searchForm').handlers.submit({ preventDefault() {} });
  await tick();
  await tick();

  assert.match(elements.get('statusState').textContent, /Sonuçlar alındı/);
  assert.match(elements.get('feed').innerHTML, /Yapay zekâ haberi/);
  assert.match(elements.get('feed').innerHTML, /href="https:\/\/news\.example\/story"/);
  assert.match(elements.get('feed').innerHTML, /bağımsız doğrulama değildir/);
  assert.match(elements.get('inference').innerHTML, /ayrıca doğrulanmadı/);
  assert.equal(elements.get('searchButton').disabled, false);
});

test('quick text entry opens locally and produces category, 5N1K and an unverified inference', () => {
  const { elements, element } = createClient();
  assert.match(html, /Hızlı Veri Girişi/);
  assert.match(html, /dış ağ olmadan yalnızca cihaza ait tarayıcıda analiz edilir/i);

  elements.get('openAnalyze').handlers.click();
  assert.equal(elements.get('analyzeModal').classes.has('open'), true);
  assert.equal(elements.get('newsText').focused, true);

  element('newsText').value = 'Belediye yapay zekâ tabanlı trafik sistemi için yeni bir yazılım pilotu açıkladı.';
  elements.get('runAnalyze').handlers.click();

  assert.match(elements.get('analyzeResult').innerHTML, /\[Kategori\] Teknoloji/);
  assert.match(elements.get('analyzeResult').innerHTML, /5N1K özeti/);
  assert.match(elements.get('analyzeResult').innerHTML, /Yapay Zekâ Çıkarımı/);
  assert.match(elements.get('analyzeResult').innerHTML, /gerçek haber veya doğrulanmış veri olarak kabul edilmez/);
  assert.match(elements.get('feed').innerHTML, /\[KULLANICI METNİ\]/);
  assert.equal(elements.get('sourceState').textContent, 'Kaynak doğrulanmadı');

  elements.get('clearAnalyze').handlers.click();
  assert.equal(element('newsText').value, '');
  assert.equal(elements.get('analyzeResult').innerHTML, '');
});

test('quick text entry rejects text shorter than ten characters', () => {
  const { elements, element } = createClient();
  element('newsText').value = 'Kısa';
  elements.get('runAnalyze').handlers.click();
  assert.match(elements.get('analyzeResult').innerHTML, /Metin eksik/);
  assert.match(elements.get('analyzeResult').innerHTML, /en az 10 karakter/);
});

test('failed live search clearly falls back to explicitly labeled demo data', async () => {
  const { elements, element } = createClient(async () => { throw new Error('Servis kullanılamıyor'); });
  element('query').value = 'gündem';
  elements.get('searchForm').handlers.submit({ preventDefault() {} });
  await tick();
  await tick();

  assert.match(elements.get('statusState').textContent, /Canlı doğrulama yok/);
  assert.match(elements.get('sourceState').textContent, /Örnek veri gösteriliyor/);
  assert.match(elements.get('inference').innerHTML, /Canlı arama tamamlanamadı/);
  assert.match(elements.get('inference').innerHTML, /\[ÖRNEK VERİ\]/);
  assert.equal((elements.get('feed').innerHTML.match(/class="story"/g) || []).length, 4);
  assert.match(elements.get('feed').innerHTML, /\[ÖRNEK VERİ\]/);
  assert.equal(elements.get('searchButton').disabled, false);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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

test('topic failure copy is honest and never uses generic clarification prompts', () => {
  for (const prompt of exactPrompts) {
    const message = intent.failureMessage(prompt);
    assert.doesNotMatch(message, /Sorunu veya üzerinde çalıştığınız konuyu yazın/i);
    assert.doesNotMatch(message, /Biraz daha ayrıntı verir misin/i);
    assert.match(message, /canlı .*sonuçlarını alamadım/i);
  }
});

test('client HTML loads the reusable news module and wires topic fallback', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /<script src="\/news-intent\.js"><\/script>/);
  assert.match(html, /FoVerseNewsIntent\?\.isNewsIntent/);
  assert.match(html, /FoVerseNewsIntent\?\.searchQuery/);
  assert.match(html, /localSearchAnswer\(searchResult.*effectiveQuery/);
});

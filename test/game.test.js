'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'game.html'), 'utf8');

test('game page is self-contained and exposes the required controls', () => {
  assert.match(html, /<canvas id="game"/);
  assert.match(html, /id="primaryBtn"/);
  assert.match(html, /id="pauseBtn"/);
  assert.match(html, /id="score"/);
  assert.match(html, /id="best"/);
  assert.match(html, /localStorage/);
  assert.doesNotMatch(html, /<script[^>]+src=/i);
  assert.doesNotMatch(html, /https?:\/\//i);
});

test('inline game script parses without a browser', () => {
  const match = html.match(/<script>([\s\S]*?)<\/script>/i);
  assert.ok(match, 'expected an inline game script');
  assert.doesNotThrow(() => new Function(match[1]));
});

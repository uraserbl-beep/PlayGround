'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');

test('serves the search handler over HTTP instead of returning a route 404', async (t) => {
  const previousKey = process.env.GOOGLE_SEARCH_API_KEY;
  const previousCx = process.env.GOOGLE_SEARCH_CX;
  delete process.env.GOOGLE_SEARCH_API_KEY;
  delete process.env.GOOGLE_SEARCH_CX;
  const originalFetch = global.fetch;
  global.fetch = async (input, options) => {
    if (new URL(input).hostname === 'news.google.com') {
      return {
        ok: true,
        async text() {
          return '<rss><channel><item><title>Smoke test - Local fixture</title><link>https://example.com/smoke</link><description>Fixture result</description></item></channel></rss>';
        },
      };
    }
    return originalFetch(input, options);
  };

  const server = createServer();
  server.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    global.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.GOOGLE_SEARCH_API_KEY;
    else process.env.GOOGLE_SEARCH_API_KEY = previousKey;
    if (previousCx === undefined) delete process.env.GOOGLE_SEARCH_CX;
    else process.env.GOOGLE_SEARCH_CX = previousCx;
  }));

  const origin = `http://127.0.0.1:${server.address().port}`;
  const homeResponse = await fetch(`${origin}/`);
  assert.equal(homeResponse.status, 200);
  assert.match(homeResponse.headers.get('content-type'), /text\/html/);
  assert.match(await homeResponse.text(), /<!doctype html>/i);

  const pingResponse = await fetch(`${origin}/api/search?ping=1`);
  assert.equal(pingResponse.status, 200);
  assert.deepEqual(await pingResponse.json(), { ok: true, commit: 'ping-test', node: process.version });

  const response = await fetch(`${origin}/api/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'route smoke test' }),
  });
  assert.notEqual(response.status, 404);
  assert.ok([200, 502].includes(response.status));
  const payload = await response.json();
  if (response.status === 502) {
    assert.equal(payload.code, 'LIVE_SEARCH_UNAVAILABLE');
  } else {
    assert.ok(Array.isArray(payload.items));
  }

  const getResponse = await fetch(`${origin}/api/search?q=gundem`);
  assert.equal(getResponse.status, 200);
  assert.ok(Array.isArray((await getResponse.json()).items));

  const unknownRoute = await fetch(`${origin}/api/unknown`);
  assert.equal(unknownRoute.status, 404);
});

test('serves the Orbit Dash game page and its alias', async (t) => {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));

  const base = `http://127.0.0.1:${server.address().port}`;
  for (const route of ['/game', '/game.html']) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    const body = await response.text();
    assert.match(body, /Orbit Dash/);
    assert.match(body, /<canvas id="game"/);
  }

  const script = await fetch(`${base}/news-intent.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /javascript/);
  assert.match(await script.text(), /FoVerseNewsIntent/);

  const missing = await fetch(`${base}/game/missing`);
  assert.equal(missing.status, 404);
});

test('routes /api/chat through the local HTTP server', async (t) => {
  const names = ['GROQ_API_KEY', 'OPENROUTER_API_KEY', 'CUSTOM_LLM_API_KEY', 'CUSTOM_LLM_BASE_URL'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Hello' }),
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'CHAT_NOT_CONFIGURED');
});

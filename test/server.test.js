'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');

test('serves the search handler over HTTP instead of returning a route 404', async (t) => {
  const previousKey = process.env.GOOGLE_SEARCH_API_KEY;
  const previousCx = process.env.GOOGLE_SEARCH_CX;
  delete process.env.GOOGLE_SEARCH_API_KEY;
  delete process.env.GOOGLE_SEARCH_CX;

  const server = createServer();
  server.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    if (previousKey === undefined) delete process.env.GOOGLE_SEARCH_API_KEY;
    else process.env.GOOGLE_SEARCH_API_KEY = previousKey;
    if (previousCx === undefined) delete process.env.GOOGLE_SEARCH_CX;
    else process.env.GOOGLE_SEARCH_CX = previousCx;
  }));

  const origin = `http://127.0.0.1:${server.address().port}`;
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

  const methodResponse = await fetch(`${origin}/api/search`);
  assert.equal(methodResponse.status, 405);
  assert.equal(methodResponse.headers.get('allow'), 'POST');

  const unknownRoute = await fetch(`${origin}/api/unknown`);
  assert.equal(unknownRoute.status, 404);
});

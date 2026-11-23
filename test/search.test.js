'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const searchHandler = require('../api/search');

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    payload: undefined,
    status(code) { this.statusCode = code; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

async function invoke(body, method = 'POST') {
  const req = { method, body };
  const res = createResponse();
  await searchHandler(req, res);
  return res;
}

async function withCredentials(fn) {
  const previousKey = process.env.GOOGLE_SEARCH_API_KEY;
  const previousCx = process.env.GOOGLE_SEARCH_CX;
  process.env.GOOGLE_SEARCH_API_KEY = 'test-key';
  process.env.GOOGLE_SEARCH_CX = 'test-cx';
  try {
    return await fn();
  } finally {
    if (previousKey === undefined) delete process.env.GOOGLE_SEARCH_API_KEY;
    else process.env.GOOGLE_SEARCH_API_KEY = previousKey;
    if (previousCx === undefined) delete process.env.GOOGLE_SEARCH_CX;
    else process.env.GOOGLE_SEARCH_CX = previousCx;
  }
}

test('rejects non-POST requests without calling Google', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('fetch should not run'); };
  try {
    const res = await invoke({}, 'GET');
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.Allow, 'POST');
    assert.equal(res.headers['Cache-Control'], 'no-store');
  } finally {
    global.fetch = originalFetch;
  }
});

test('reports missing server credentials without calling Google', async () => {
  const previousKey = process.env.GOOGLE_SEARCH_API_KEY;
  const previousCx = process.env.GOOGLE_SEARCH_CX;
  delete process.env.GOOGLE_SEARCH_API_KEY;
  delete process.env.GOOGLE_SEARCH_CX;
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('fetch should not run'); };
  try {
    const res = await invoke({ query: 'latest news' });
    assert.equal(res.statusCode, 503);
    assert.match(res.payload.error, /yapılandırılmamış/);
  } finally {
    global.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.GOOGLE_SEARCH_API_KEY;
    else process.env.GOOGLE_SEARCH_API_KEY = previousKey;
    if (previousCx === undefined) delete process.env.GOOGLE_SEARCH_CX;
    else process.env.GOOGLE_SEARCH_CX = previousCx;
  }
});

test('rejects malformed, empty, and overlong queries', async () => {
  await withCredentials(async () => {
    const invalidJson = await invoke('{broken');
    assert.equal(invalidJson.statusCode, 400);
    const nullBody = await invoke(null);
    assert.equal(nullBody.statusCode, 400);
    const empty = await invoke({ query: '  ' });
    assert.equal(empty.statusCode, 400);
    const tooLong = await invoke({ query: 'x'.repeat(501) });
    assert.equal(tooLong.statusCode, 400);
  });
});

test('returns bounded, HTTP(S)-only Google results', async () => {
  await withCredentials(async () => {
    const originalFetch = global.fetch;
    let requestedUrl;
    global.fetch = async (url) => {
      requestedUrl = new URL(url);
      return {
        ok: true,
        async json() {
          return { items: [
            { title: 'A'.repeat(350), link: 'https://example.com/a', snippet: 'B'.repeat(1300) },
            { title: 'Unsafe', link: 'javascript:alert(1)', snippet: 'discard this' },
            { title: 'B', link: 'http://example.org/b', snippet: 'valid result' },
          ] };
        },
      };
    };
    try {
      const res = await invoke({ query: '  latest release  ', count: 99 });
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.items.length, 2);
      assert.equal(res.payload.items[0].title.length, 300);
      assert.equal(res.payload.items[0].snippet.length, 1200);
      assert.equal(res.payload.items[1].url, 'http://example.org/b');
      assert.equal(requestedUrl.searchParams.get('q'), 'latest release');
      assert.equal(requestedUrl.searchParams.get('num'), '8');
      assert.equal(requestedUrl.searchParams.get('key'), 'test-key');
    } finally {
      global.fetch = originalFetch;
    }
  });
});

test('maps upstream 403 access restrictions to a safe error', async () => {
  await withCredentials(async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => ({ ok: false, status: 403 });
    try {
      const res = await invoke({ query: 'test query' });
      assert.equal(res.statusCode, 502);
      assert.match(res.payload.error, /erişim kısıtı/);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

test('maps upstream 429 rate limits without retrying', async () => {
  await withCredentials(async () => {
    const originalFetch = global.fetch;
    let fetchCount = 0;
    global.fetch = async () => {
      fetchCount += 1;
      return { ok: false, status: 429 };
    };
    try {
      const res = await invoke({ query: 'test query' });
      assert.equal(res.statusCode, 503);
      assert.match(res.payload.error, /istek sınırına/);
      assert.equal(fetchCount, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

test('maps other upstream failures to a safe gateway error', async () => {
  await withCredentials(async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => ({ ok: false, status: 500 });
    try {
      const res = await invoke({ query: 'test query' });
      assert.equal(res.statusCode, 502);
      assert.match(res.payload.error, /yanıt veremiyor/);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

test('returns a gateway timeout when the upstream request aborts', async () => {
  await withCredentials(async () => {
    const originalFetch = global.fetch;
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    global.setTimeout = (callback) => {
      callback();
      return 1;
    };
    global.clearTimeout = () => {};
    global.fetch = async (_url, options) => {
      assert.equal(options.signal.aborted, true);
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    };
    try {
      const res = await invoke({ query: 'test query' });
      assert.equal(res.statusCode, 504);
      assert.match(res.payload.error, /zaman aşımına/);
    } finally {
      global.fetch = originalFetch;
      global.setTimeout = originalSetTimeout;
      global.clearTimeout = originalClearTimeout;
    }
  });
});

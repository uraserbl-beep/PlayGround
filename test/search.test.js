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

test('uses Google News RSS when server credentials are missing', async () => {
  const previousKey = process.env.GOOGLE_SEARCH_API_KEY;
  const previousCx = process.env.GOOGLE_SEARCH_CX;
  delete process.env.GOOGLE_SEARCH_API_KEY;
  delete process.env.GOOGLE_SEARCH_CX;
  const originalFetch = global.fetch;
  let requestedUrl;
  global.fetch = async (url) => {
    requestedUrl = new URL(url);
    return {
      ok: true,
      async text() { return '<rss><channel><item><title>Önemli gelişme - Örnek Kaynak</title><link>https://example.com/haber/1</link><description>Güncel haber özeti</description><pubDate>Mon, 23 Nov 2026 12:00:00 GMT</pubDate></item></channel></rss>'; },
    };
  };
  try {
    const res = await invoke({ query: 'Gündemde ne var' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.source, 'google_news_rss');
    assert.equal(requestedUrl.hostname, 'news.google.com');
    assert.equal(requestedUrl.searchParams.get('q'), 'Türkiye ve dünya gündem son dakika haberleri');
    assert.equal(res.payload.items[0].title, 'Önemli gelişme');
    assert.equal(res.payload.items[0].url, 'https://example.com/haber/1');
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

test('falls back to RSS after an upstream 403 access restriction', async () => {
  await withCredentials(async () => {
    const originalFetch = global.fetch;
    let calls = 0;
    global.fetch = async (url) => {
      calls += 1;
      if (String(url).includes('googleapis.com')) return { ok: false, status: 403 };
      return { ok: true, async text() { return '<rss><channel><item><title>Fallback haber - Kaynak</title><link>https://example.com/fallback</link><description>Özet</description></item></channel></rss>'; } };
    };
    try {
      const res = await invoke({ query: 'test query' });
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.source, 'google_news_rss');
      assert.equal(calls, 2);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

test('falls back to RSS after an upstream 429 rate limit', async () => {
  await withCredentials(async () => {
    const originalFetch = global.fetch;
    let fetchCount = 0;
    global.fetch = async (url) => {
      fetchCount += 1;
      if (String(url).includes('googleapis.com')) return { ok: false, status: 429 };
      return { ok: true, async text() { return '<rss><channel><item><title>Rate-limit fallback - Kaynak</title><link>https://example.com/fallback</link></item></channel></rss>'; } };
    };
    try {
      const res = await invoke({ query: 'test query' });
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.source, 'google_news_rss');
      assert.equal(fetchCount, 2);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

test('uses RSS after another upstream Google failure', async () => {
  await withCredentials(async () => {
    const originalFetch = global.fetch;
    global.fetch = async (url) => {
      if (String(url).includes('googleapis.com')) return { ok: false, status: 500 };
      return { ok: true, async text() { return '<rss><channel><item><title>Fallback - Kaynak</title><link>https://example.com/fallback</link></item></channel></rss>'; } };
    };
    try {
      const res = await invoke({ query: 'test query' });
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.source, 'google_news_rss');
    } finally {
      global.fetch = originalFetch;
    }
  });
});

test('returns a gateway error when both upstream sources abort', async () => {
  await withCredentials(async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    };
    try {
      const res = await invoke({ query: 'test query' });
      assert.equal(res.statusCode, 502);
      assert.equal(res.payload.code, 'LIVE_SEARCH_UNAVAILABLE');
    } finally {
      global.fetch = originalFetch;
    }
  });
});

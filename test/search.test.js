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
  const req = { method, body, query: method === 'GET' ? body : undefined };
  const res = createResponse();
  await searchHandler(req, res);
  return res;
}

test('RSS description that merely repeats the headline stays empty', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (input) => {
    if (new URL(input).hostname === 'news.google.com') {
      return { ok: true, async text() { return '<rss><channel><item><title>İsrail B planı gündemde - Örnek Haber</title><link>https://example.com/israil-b-plani</link><description>İsrail B planı gündemde</description></item></channel></rss>'; } };
    }
    throw new Error('Unexpected fetch');
  };
  try {
    const res = await invoke({ query: 'İsrail B planı haber detayı', count: 8 }, 'POST');
    assert.equal(res.statusCode, 200);
    const item = res.payload.items[0];
    assert.equal(item.title, 'İsrail B planı gündemde');
    assert.equal(item.source, 'Örnek Haber');
    assert.equal(item.snippet, '');
  } finally { global.fetch = originalFetch; }
});

test('RSS uses source tag and HTML-cleaned real description without fabricated fallbacks', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (input) => {
    if (new URL(input).hostname === 'news.google.com') {
      return { ok: true, async text() { return '<rss><channel><item><title>Türkiye NATO kararı | Resmi Gazete</title><source>AA</source><link>https://example.com/nato</link><description>&lt;b&gt;NATO açıklaması&lt;/b&gt; bugün yayımlandı.</description></item></channel></rss>'; } };
    }
    throw new Error('Unexpected fetch');
  };
  try {
    const res = await invoke({ query: 'NATO haberi', count: 8 }, 'POST');
    const item = res.payload.items[0];
    assert.equal(item.title, 'Türkiye NATO kararı');
    assert.equal(item.source, 'AA');
    assert.equal(item.snippet, 'NATO açıklaması bugün yayımlandı.');
  } finally { global.fetch = originalFetch; }
});

test('RSS title-only item leaves snippet and source empty', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, async text() { return '<rss><channel><item><title>Başlığa dayalı haber</title><link>https://example.com/baslik</link><description></description></item></channel></rss>'; } });
  try {
    const res = await invoke({ query: 'başlık haberi', count: 8 }, 'POST');
    const item = res.payload.items[0];
    assert.equal(item.snippet, '');
    assert.equal(item.source, '');
  } finally { global.fetch = originalFetch; }
});

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

test('returns the minimal ping response before search work', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('ping must not fetch'); };
  try {
    const res = await invoke({ ping: '1' }, 'GET');
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload, { ok: true, commit: 'ping-test', node: process.version });
  } finally {
    global.fetch = originalFetch;
  }
});

test('rejects unsupported methods without calling Google', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('fetch should not run'); };
  try {
    const res = await invoke({}, 'PUT');
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.Allow, 'GET, POST');
    assert.equal(res.headers['Cache-Control'], 'no-store');
  } finally {
    global.fetch = originalFetch;
  }
});

test('supports GET queries from the q parameter', async () => {
  const previousKey = process.env.GOOGLE_SEARCH_API_KEY;
  const previousCx = process.env.GOOGLE_SEARCH_CX;
  delete process.env.GOOGLE_SEARCH_API_KEY;
  delete process.env.GOOGLE_SEARCH_CX;
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    async text() { return '<rss><channel><item><title>Gündem haberi - Örnek</title><link>https://example.com/gundem</link></item></channel></rss>'; },
  });
  try {
    const res = await invoke({ q: 'gundem' }, 'GET');
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.source, 'google_news_rss');
    assert.equal(res.payload.query, 'Türkiye ve dünya gündem son dakika haberleri');
    assert.ok(Array.isArray(res.payload.items));
  } finally {
    global.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.GOOGLE_SEARCH_API_KEY;
    else process.env.GOOGLE_SEARCH_API_KEY = previousKey;
    if (previousCx === undefined) delete process.env.GOOGLE_SEARCH_CX;
    else process.env.GOOGLE_SEARCH_CX = previousCx;
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

test('uses keyless GDELT when Google Search and Google News RSS are unavailable', async () => {
  const previousKey = process.env.GOOGLE_SEARCH_API_KEY;
  const previousCx = process.env.GOOGLE_SEARCH_CX;
  process.env.GOOGLE_SEARCH_API_KEY = 'test-key';
  process.env.GOOGLE_SEARCH_CX = 'test-cx';
  const originalFetch = global.fetch;
  const requestedUrls = [];
  global.fetch = async (url) => {
    const parsedUrl = new URL(url);
    requestedUrls.push(parsedUrl);
    if (parsedUrl.hostname === 'www.googleapis.com' || parsedUrl.hostname === 'news.google.com') {
      return { ok: false, status: 503 };
    }
    if (parsedUrl.hostname === 'api.gdeltproject.org') {
      return {
        ok: true,
        async json() {
          return { articles: [{
            title: 'Güncel haber başlığı',
            url: 'https://example.com/news/1',
            domain: 'example.com',
            seendate: '20261123T120000Z',
            snippet: 'Haber özeti',
          }] };
        },
      };
    }
    throw new Error(`Unexpected upstream: ${parsedUrl.hostname}`);
  };
  try {
    const res = await invoke({ query: 'gündemde ne var', count: 3 });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.source, 'gdelt');
    assert.equal(res.payload.query, 'Türkiye ve dünya gündem son dakika haberleri');
    assert.deepEqual(requestedUrls.map((url) => url.hostname), ['www.googleapis.com', 'news.google.com', 'api.gdeltproject.org']);
    assert.equal(requestedUrls[2].searchParams.get('query'), res.payload.query);
    assert.equal(requestedUrls[2].searchParams.get('maxrecords'), '3');
    assert.equal(res.payload.items[0].title, 'Güncel haber başlığı');
    assert.equal(res.payload.items[0].source, 'example.com');
  } finally {
    global.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.GOOGLE_SEARCH_API_KEY;
    else process.env.GOOGLE_SEARCH_API_KEY = previousKey;
    if (previousCx === undefined) delete process.env.GOOGLE_SEARCH_CX;
    else process.env.GOOGLE_SEARCH_CX = previousCx;
  }
});

test('returns valid JSON for normal search through a native Vercel response', async () => {
  const previousKey = process.env.GOOGLE_SEARCH_API_KEY;
  const previousCx = process.env.GOOGLE_SEARCH_CX;
  delete process.env.GOOGLE_SEARCH_API_KEY;
  delete process.env.GOOGLE_SEARCH_CX;
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (new URL(url).hostname === 'news.google.com') {
      return {
        ok: true,
        async text() {
          return '<rss><channel><item><title>Native fallback - Yerel Kaynak</title><link>https://example.com/native</link><description>Native yanıt testi</description></item></channel></rss>';
        },
      };
    }
    throw new Error('Unexpected native test upstream');
  };
  try {
    let ended;
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      end(body) { ended = body; },
    };
    await searchHandler({ method: 'GET', query: { q: 'test' }, url: '/api/search?q=test' }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Content-Type'], 'application/json; charset=utf-8');
    assert.equal(typeof ended, 'string');
    const payload = JSON.parse(ended);
    assert.equal(payload.source, 'google_news_rss');
    assert.equal(payload.items[0].title, 'Native fallback');
  } finally {
    global.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.GOOGLE_SEARCH_API_KEY;
    else process.env.GOOGLE_SEARCH_API_KEY = previousKey;
    if (previousCx === undefined) delete process.env.GOOGLE_SEARCH_CX;
    else process.env.GOOGLE_SEARCH_CX = previousCx;
  }
});

test('returns gateway error when all upstream sources abort', async () => {
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

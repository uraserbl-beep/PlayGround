'use strict';

const MAX_QUERY_LENGTH = 500;
const MAX_RESULTS = 8;
const TIMEOUT_MS = 8000;

function reply(res, status, payload) {
  return res.status(status).set('Cache-Control', 'no-store').json(payload);
}

module.exports = async function searchHandler(req, res) {
  if (req.method !== 'POST') {
    res.set('Allow', 'POST');
    return reply(res, 405, { error: 'Only POST is supported.' });
  }

  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const searchEngineId = process.env.GOOGLE_SEARCH_CX;
  if (!apiKey || !searchEngineId) {
    return reply(res, 503, { error: 'Web araması sunucuda yapılandırılmamış.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return reply(res, 400, { error: 'Geçersiz istek gövdesi.' });
    }
  }
  const query = typeof body?.query === 'string' ? body.query.trim() : '';
  if (!query || query.length > MAX_QUERY_LENGTH) {
    return reply(res, 400, { error: 'Sorgu boş olamaz ve 500 karakteri aşamaz.' });
  }

  const count = Math.max(1, Math.min(MAX_RESULTS, Number.parseInt(body?.count, 10) || MAX_RESULTS));
  const params = new URLSearchParams({ key: apiKey, cx: searchEngineId, q: query, num: String(count) });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch('https://www.googleapis.com/customsearch/v1?' + params.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      return reply(res, 502, { error: 'Arama sağlayıcısı şu anda yanıt veremiyor.' });
    }

    const data = await response.json();
    const items = (Array.isArray(data.items) ? data.items : []).slice(0, count).map((item) => {
      let url = '';
      try {
        const parsed = new URL(item.link || '');
        if (parsed.protocol === 'https:' || parsed.protocol === 'http:') url = parsed.href;
      } catch {
        // Ignore malformed result URLs.
      }
      return {
        title: String(item.title || 'Kaynak').slice(0, 300),
        url,
        snippet: String(item.snippet || '').slice(0, 1200),
      };
    }).filter((item) => item.url);

    return reply(res, 200, { items });
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    return reply(res, timedOut ? 504 : 502, {
      error: timedOut ? 'Web araması zaman aşımına uğradı.' : 'Web araması şu anda kullanılamıyor.',
    });
  } finally {
    clearTimeout(timeout);
  }
};

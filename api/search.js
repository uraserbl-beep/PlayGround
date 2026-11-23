'use strict';

const MAX_QUERY_LENGTH = 500;
const MAX_RESULTS = 8;
const TIMEOUT_MS = 8000;

function reply(res, status, payload) {
  return res.status(status).set('Cache-Control', 'no-store').json(payload);
}

function cleanText(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildMeaningfulQuery(raw) {
  let query = String(raw || '').replace(/\s+/g, ' ').trim();
  const normalized = query.toLocaleLowerCase('tr-TR').replace(/[?!.]+$/g, '').trim();
  if (/^(gündemde ne var|gundemde ne var|gündem|gundem|günse|gunse|bugün neler oldu|bugun neler oldu|son gelişmeler|son gelismeler|haberler|güncel haberler|guncel haberler)$/.test(normalized)) {
    return 'Türkiye ve dünya gündem son dakika haberleri';
  }
  return query
    .replace(/^(lütfen\s+|lutfen\s+|please\s+|can you\s+|could you\s+)/i, '')
    .replace(/\b(arastir|araştır|araştırma|google'da bul|google da bul|kontrol et|kaynak getir|search the web|look up|get sources?)\b/gi, '')
    .replace(/[?!.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim().slice(0, MAX_QUERY_LENGTH);
}

function validHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
}

async function googleSearch(apiKey, cx, query, count) {
  const params = new URLSearchParams({ key: apiKey, cx, q: query, num: String(count), hl: 'tr', gl: 'tr' });
  const response = await fetch('https://www.googleapis.com/customsearch/v1?' + params.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json', 'User-Agent': 'Gemini-Search-App/1.0' },
  });
  if (!response.ok) throw new Error(`Google search failed: ${response.status}`);
  const data = await response.json();
  return (Array.isArray(data.items) ? data.items : []).slice(0, count).map((item) => ({
    title: cleanText(item.title || 'Kaynak').slice(0, 300),
    url: validHttpUrl(item.link),
    snippet: cleanText(item.snippet || '').slice(0, 1200),
    source: cleanText(item.displayLink || new URL(item.link).hostname).slice(0, 200),
    date: String(item.pagemap?.metatags?.[0]?.['article:published_time'] || item.pagemap?.metatags?.[0]?.date || '').slice(0, 100),
  })).filter((item) => item.url);
}

async function rssSearch(query, count) {
  const params = new URLSearchParams({ q: query, hl: 'tr', gl: 'TR', ceid: 'TR:tr' });
  const response = await fetch('https://news.google.com/rss/search?' + params.toString(), {
    method: 'GET',
    headers: { Accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8', 'User-Agent': 'Gemini-Search-App/1.0' },
  });
  if (!response.ok) throw new Error(`Google News RSS failed: ${response.status}`);
  const xml = await response.text();
  const items = [];
  const itemMatches = xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || [];
  for (const block of itemMatches) {
    const get = (tag) => block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] || '';
    const title = cleanText(get('title'));
    const url = validHttpUrl(cleanText(get('link')));
    if (!title || !url) continue;
    const sourceMatch = title.match(/\s+-\s+([^]+)$/);
    const source = cleanText(sourceMatch?.[1] || 'Google News');
    const headline = cleanText(sourceMatch ? title.slice(0, sourceMatch.index).trim() : title);
    items.push({
      title: headline.slice(0, 300),
      url,
      snippet: cleanText(get('description') || headline).slice(0, 1200),
      source,
      date: cleanText(get('pubDate')).slice(0, 100),
    });
    if (items.length >= count) break;
  }
  return items;
}

async function fetchWithTimeout(operation) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = async function searchHandler(req, res) {
  if (req.method !== 'POST') {
    res.set('Allow', 'POST');
    return reply(res, 405, { error: 'Only POST is supported.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return reply(res, 400, { error: 'Geçersiz istek gövdesi.' }); }
  }
  const rawQuery = typeof body?.query === 'string' ? body.query.trim() : '';
  if (!rawQuery || rawQuery.length > MAX_QUERY_LENGTH) {
    return reply(res, 400, { error: 'Sorgu boş olamaz ve 500 karakteri aşamaz.' });
  }
  const count = Math.max(1, Math.min(MAX_RESULTS, Number.parseInt(body?.count, 10) || MAX_RESULTS));
  const query = buildMeaningfulQuery(rawQuery);

  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const cx = process.env.GOOGLE_SEARCH_CX;

  if (apiKey && cx) {
    try {
      const items = await fetchWithTimeout((signal) => {
        const params = new URLSearchParams({ key: apiKey, cx, q: query, num: String(count), hl: 'tr', gl: 'tr' });
        return fetch('https://www.googleapis.com/customsearch/v1?' + params.toString(), {
          method: 'GET', headers: { Accept: 'application/json', 'User-Agent': 'Gemini-Search-App/1.0' }, signal,
        }).then(async (response) => {
          if (!response.ok) throw new Error(`Google search failed: ${response.status}`);
          const data = await response.json();
          return (Array.isArray(data.items) ? data.items : []).slice(0, count).map((item) => {
            const url = validHttpUrl(item.link);
            let source = cleanText(item.displayLink);
            try { if (!source) source = cleanText(new URL(url).hostname); } catch {}
            return {
              title: cleanText(item.title || 'Kaynak').slice(0, 300), url,
              snippet: cleanText(item.snippet || '').slice(0, 1200), source,
              date: cleanText(item.pagemap?.metatags?.[0]?.['article:published_time'] || item.pagemap?.metatags?.[0]?.date || '').slice(0, 100),
            };
          }).filter((item) => item.url);
        });
      });
      if (items.length) return reply(res, 200, { items, source: 'google', query });
    } catch (_) {
      // Fall through to keyless Google News RSS.
    }
  }

  try {
    const items = await fetchWithTimeout((signal) => {
      const params = new URLSearchParams({ q: query, hl: 'tr', gl: 'TR', ceid: 'TR:tr' });
      return fetch('https://news.google.com/rss/search?' + params.toString(), {
        method: 'GET', headers: { Accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8', 'User-Agent': 'Gemini-Search-App/1.0' }, signal,
      }).then(async (response) => {
        if (!response.ok) throw new Error(`Google News RSS failed: ${response.status}`);
        return rssSearchResult(await response.text(), count);
      });
    });
    if (items.length) return reply(res, 200, { items, source: 'google_news_rss', query });
  } catch (_) {
    // Return a clean fallback only after both sources are exhausted.
  }

  return reply(res, 502, {
    error: 'Canlı web araması şu anda kullanılamıyor; haber kaynağına ve yedek arama katmanına ulaşılamadı.',
    code: 'LIVE_SEARCH_UNAVAILABLE',
  });
};

function rssSearchResult(xml, count) {
  const items = [];
  const itemMatches = xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || [];
  for (const block of itemMatches) {
    const get = (tag) => block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] || '';
    const title = cleanText(get('title'));
    const url = validHttpUrl(cleanText(get('link')));
    if (!title || !url) continue;
    const sourceMatch = title.match(/\s+-\s+([^]+)$/);
    const source = cleanText(sourceMatch?.[1] || 'Google News');
    const headline = cleanText(sourceMatch ? title.slice(0, sourceMatch.index).trim() : title);
    items.push({
      title: headline.slice(0, 300), url,
      snippet: cleanText(get('description') || headline).slice(0, 1200),
      source,
      date: cleanText(get('pubDate')).slice(0, 100),
    });
    if (items.length >= count) break;
  }
  return items;
}

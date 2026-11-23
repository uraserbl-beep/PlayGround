'use strict';

const MAX_QUERY_LENGTH = 500;
const MAX_RESULTS = 8;
const TIMEOUT_MS = 5000;
const SOURCE_TIMEOUT_MS = 4000;

function reply(res, status, payload) {
  return res.status(status).set('Cache-Control', 'no-store').json(payload);
}

function cleanText(value) {
  let text = String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&(amp|#0*38);/gi, '&')
    .replace(/&(quot|#0*34);/gi, '"')
    .replace(/&(apos|#0*39);/gi, "'")
    .replace(/&(lt|#0*60);/gi, '<')
    .replace(/&(gt|#0*62);/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => { const n = Number(code); return Number.isInteger(n) ? String.fromCodePoint(n) : ''; })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => { const n = Number.parseInt(code, 16); return Number.isInteger(n) ? String.fromCodePoint(n) : ''; });
  return text.replace(/\s+/g, ' ').trim();
}

function normalizeItem(item) {
  if (!item) return null;
  const title = cleanText(item.title).slice(0, 300);
  const url = validHttpUrl(item.url);
  if (!title || !url) return null;
  const snippet = cleanText(item.snippet || title).slice(0, 1200) || title;
  let source = cleanText(item.source);
  try { if (!source) source = cleanText(new URL(url).hostname); } catch { source = ''; }
  return { title, url, snippet, source: source.slice(0, 200), date: cleanText(item.date).slice(0, 100) };
}

function dedupeAndSort(items) {
  const seen = new Set();
  return items.map(normalizeItem).filter(Boolean).filter((item) => {
    let key;
    try {
      const url = new URL(item.url);
      url.hash = '';
      url.searchParams.delete('utm_source'); url.searchParams.delete('utm_medium'); url.searchParams.delete('utm_campaign');
      key = `${url.origin}${url.pathname.replace(/\/$/, '')}`.toLocaleLowerCase('tr-TR');
    } catch { key = item.url.toLocaleLowerCase('tr-TR'); }
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => {
    const timestamp = (item) => {
      const value = Date.parse(item.date);
      return Number.isFinite(value) ? value : 0;
    };
    return timestamp(b) - timestamp(a);
  });
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
    headers: { Accept: 'application/json', 'User-Agent': 'FoVerse-AI-Search/1.0' },
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
    headers: { Accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8', 'User-Agent': 'FoVerse-AI-Search/1.0' },
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

async function fetchWithTimeout(operation, timeoutMs = SOURCE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

async function searchHandler(req, res) {
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
          method: 'GET', headers: { Accept: 'application/json', 'User-Agent': 'FoVerse-AI-Search/1.0' }, signal,
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
      const normalized = dedupeAndSort(items).slice(0, count);
      if (normalized.length) return reply(res, 200, { items: normalized, source: 'google', query });
    } catch (_) {
      // Fall through to keyless Google News RSS.
    }
  }

  try {
    const items = await fetchWithTimeout((signal) => {
      const params = new URLSearchParams({ q: query, hl: 'tr', gl: 'TR', ceid: 'TR:tr' });
      return fetch('https://news.google.com/rss/search?' + params.toString(), {
        method: 'GET', headers: { Accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8', 'User-Agent': 'FoVerse-AI-Search/1.0' }, signal,
      }).then(async (response) => {
        if (!response.ok) throw new Error(`Google News RSS failed: ${response.status}`);
        return rssSearchResult(await response.text(), count);
      });
    });
    const normalized = dedupeAndSort(items).slice(0, count);
    if (normalized.length) return reply(res, 200, { items: normalized, source: 'google_news_rss', query });
  } catch (_) {
    // Continue to the independent, keyless GDELT article API.
  }

  try {
    const items = await fetchWithTimeout((signal) => gdeltSearch(query, count, signal));
    const normalized = dedupeAndSort(items).slice(0, count);
    if (normalized.length) return reply(res, 200, { items: normalized, source: 'gdelt', query });
  } catch (_) {
    // Return a clean fallback only after all configured sources are exhausted.
  }

  return reply(res, 502, {
    error: 'Canlı web araması şu anda kullanılamıyor; haber kaynağına ve yedek arama katmanına ulaşılamadı.',
    code: 'LIVE_SEARCH_UNAVAILABLE',
  });
}

module.exports = searchHandler;

// Vercel invokes serverless functions in-process. Keep one stable JSON contract
// even if a runtime primitive or upstream response throws outside the source fallbacks.
module.exports.default = async function vercelSearchHandler(req, res) {
  try {
    await searchHandler(req, res);
  } catch (error) {
    if (!res.headersSent) {
      reply(res, 502, {
        error: 'Arama işlevinde beklenmeyen bir hata oluştu; kontrolsüz bir 500 hatasına dönüşmedi.',
        code: 'SEARCH_HANDLER_ERROR',
      });
    }
  }
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
  return dedupeAndSort(items).slice(0, count);
}

async function gdeltSearch(query, count, signal) {
  const params = new URLSearchParams({
    query,
    mode: 'ArtList',
    format: 'json',
    maxrecords: String(count),
    sort: 'HybridRel',
  });
  const response = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?${params}`, {
    method: 'GET',
    headers: { Accept: 'application/json', 'User-Agent': 'FoVerse-AI-Search/1.0' },
    signal,
  });
  if (!response.ok) throw new Error(`GDELT search failed: ${response.status}`);
  const data = await response.json();
  return (Array.isArray(data.articles) ? data.articles : []).slice(0, count).map((article) => {
    const url = validHttpUrl(article.url);
    let source = cleanText(article.domain);
    try { if (!source && url) source = cleanText(new URL(url).hostname); } catch {}
    return {
      title: cleanText(article.title || 'Kaynak').slice(0, 300),
      url,
      snippet: cleanText(article.snippet || '').slice(0, 1200),
      source: source.slice(0, 200),
      date: cleanText(article.seendate || article.datetime || '').slice(0, 100),
    };
  }).filter((item) => item.title && item.url);
}

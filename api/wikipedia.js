'use strict';

const TIMEOUT_MS = 3500;
const MAX_CONTEXT_CHARS = 5000;

function needsWikipediaContext(question) {
  const text = String(question || '').toLocaleLowerCase('tr-TR');
  return /\b(what is|who is|where is|when was|how does|how do|explain|define|meaning of|history of|tell me about|what are|kimdir|nedir|nerede|ne zaman|nasıl çalışır|nasıl calisir|açıkla|acikla|anlamı|anlami|tarihi|hakkında|hakkinda|bilgi ver|tanımı|tanimi)\b/i.test(text);
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'FoVerse-AI/1.0 (encyclopedic context)' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Wikipedia returned HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function getWikipediaContext(question, env = process.env) {
  if (!needsWikipediaContext(question)) return null;
  const language = /^[a-z]{2,3}(?:-[a-z]{2})?$/i.test(env.WIKIPEDIA_LANG || 'tr') ? (env.WIKIPEDIA_LANG || 'tr') : 'tr';
  const base = `https://${language}.wikipedia.org`;
  try {
    const searchUrl = new URL(`${base}/w/api.php`);
    searchUrl.search = new URLSearchParams({ action: 'query', list: 'search', srsearch: question, srlimit: '1', format: 'json', origin: '*' }).toString();
    const search = await fetchJson(searchUrl);
    const title = search?.query?.search?.[0]?.title;
    if (!title) return null;

    try {
      const summaryUrl = `${base}/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`;
      const summary = await fetchJson(summaryUrl);
      if (typeof summary.extract === 'string' && summary.extract.trim()) {
        return {
          title: String(summary.title || title).slice(0, 250),
          extract: summary.extract.trim().slice(0, MAX_CONTEXT_CHARS),
          url: typeof summary.content_urls?.desktop?.page === 'string' ? summary.content_urls.desktop.page : `${base}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
        };
      }
    } catch (_) {
      // MediaWiki extract below is the fallback when the REST summary is unavailable.
    }

    const extractUrl = new URL(`${base}/w/api.php`);
    extractUrl.search = new URLSearchParams({ action: 'query', prop: 'extracts', titles: title, explaintext: '1', exintro: '1', exchars: String(MAX_CONTEXT_CHARS), format: 'json', formatversion: '2' }).toString();
    const data = await fetchJson(extractUrl);
    const page = data?.query?.pages?.[0];
    if (typeof page?.extract !== 'string' || !page.extract.trim()) return null;
    return {
      title: String(page.title || title).slice(0, 250),
      extract: page.extract.trim().slice(0, MAX_CONTEXT_CHARS),
      url: `${base}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    };
  } catch (_) {
    return null;
  }
}

module.exports = { getWikipediaContext, needsWikipediaContext };

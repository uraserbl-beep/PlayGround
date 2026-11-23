'use strict';

(function exposeNewsIntent(root) {
  const normalize = (value) => String(value || '')
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/\s+/g, ' ')
    .trim();

  const topics = [
    { label: 'Siyaset gündemi', query: 'Türkiye siyaset haberleri son dakika', terms: ['siyaset', 'politika'] },
    { label: 'Ekonomi gündemi', query: 'Türkiye ekonomi haberleri son dakika', terms: ['ekonomi', 'finans', 'borsa'] },
    { label: 'Dünya gündemi', query: 'Dünya gündem haberleri son dakika', terms: ['dunya'] },
    { label: 'Türkiye gündemi', query: 'Türkiye gündem haberleri son dakika', terms: ['turkiye'] },
    { label: 'Teknoloji gündemi', query: 'Teknoloji haberleri son dakika', terms: ['teknoloji'] },
    { label: 'Spor gündemi', query: 'Spor haberleri son dakika', terms: ['spor'] },
    { label: 'Güncel gündem', query: 'Türkiye ve dünya gündem son dakika haberleri', terms: ['gundem', 'haber', 'son dakika', 'ne var', 'neler oldu', 'neler oluyor', 'guncel'] },
  ];

  function topicFor(query) {
    const normalized = normalize(query);
    return topics.find((topic) => topic.terms.some((term) => normalized.includes(normalize(term)))) || null;
  }

  function isNewsIntent(query) {
    return topicFor(query) !== null;
  }

  function isNewsDetailRequest(query) {
    const normalized = normalize(query);
    const detailSignal = /(?:detay|detaylandir|detayli|ayrint|hakkinda|acikla|bilgi ver|biraz daha)/.test(normalized);
    const newsSignal = /(?:haber|madde|baslik|konu|nato|turkiye)/.test(normalized);
    const numberedFollowup = /^\s*[1-9]\d?\s*[.)]?\s*(?:haber|madde|baslik)/.test(normalized);
    return detailSignal && (newsSignal || numberedFollowup);
  }

  function detailSearchQuery(query) {
    return String(query || '')
      .replace(/\b(?:biraz|daha|fazla|kisa|kısaca|lutfen|lütfen)\b/gi, ' ')
      .replace(/(?:detaylandir(?:ir)? misin|detaylandir|detaylarini? (?:ver|anlat)|detayli (?:bilgi|aciklama) (?:ver|anlat)|biraz daha detay (?:verir misin|verirmisin|anlatir misin)|detay verir misin|detay verirmisin|detay(?:ı|i)?|aciklar misin|bilgi verir misin|hakk(?:ında|inda)|hakkindaki)/gi, ' ')
      .replace(/\b(?:haberi|haberini|haber|maddeyi|maddesini|madde|konuyu)\b/gi, ' ')
      .replace(/^\s*\d{1,2}\s*[.)]?\s*/, '')
      .replace(/[?!.]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);
  }

  function searchQuery(query) {
    if (isNewsDetailRequest(query)) return detailSearchQuery(query);
    return topicFor(query)?.query || '';
  }

  function failureMessage(query) {
    const topic = topicFor(query)?.label || 'Güncel gündem';
    return `Şu anda ${topic.toLocaleLowerCase('tr-TR')} için canlı haber sonuçlarını alamadım. Kaynaklara erişemediğim için güncel gelişmeleri doğrulanmış bilgi olarak aktaramıyorum.`;
  }

  const api = { isNewsIntent, isNewsDetailRequest, detailSearchQuery, topicFor, searchQuery, failureMessage };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FoVerseNewsIntent = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

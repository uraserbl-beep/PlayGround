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
    { label: 'Oyun gündemi', query: 'Oyun gündemi son dakika oyun haberleri Steam PlayStation Xbox Nintendo 2026', terms: ['oyun gundemi', 'oyun haberleri', 'oyunlarda ne var', 'gaming news', 'oyun sektoru gundemi', 'oyun', 'oyunlarda', 'minecraft', 'dungeons', 'steam', 'playstation', 'xbox', 'nintendo'] },
    { label: 'Sağlık gündemi', query: 'Sağlık haberleri son dakika', terms: ['saglik', 'doktor', 'hastane'] },
    { label: 'Dünya gündemi', query: 'Dünya gündem haberleri son dakika', terms: ['dunya', 'uluslararasi'] },
    { label: 'Türkiye gündemi', query: 'Türkiye gündem haberleri son dakika', terms: ['turkiye'] },
    { label: 'Teknoloji gündemi', query: 'Teknoloji haberleri son dakika', terms: ['teknoloji', 'yapay zeka', 'bilgisayar', 'telefon'] },
    { label: 'Spor gündemi', query: 'Spor haberleri son dakika', terms: ['spor', 'futbol', 'basketbol'] },
    { label: 'Son dakika', query: 'Türkiye son dakika haberleri', terms: ['son dakika'] },
    { label: 'Güncel gündem', query: 'Türkiye ve dünya gündem son dakika haberleri', terms: ['gundem', 'haber', 'son dakika', 'ne var', 'neler oldu', 'neler oluyor', 'guncel'] },
  ];

  function editDistance(left, right) {
    const row = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let i = 1; i <= left.length; i += 1) {
      let diagonal = row[0];
      row[0] = i;
      for (let j = 1; j <= right.length; j += 1) {
        const above = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (left[i - 1] === right[j - 1] ? 0 : 1));
        diagonal = above;
      }
    }
    return row[right.length];
  }

  function topicFor(query) {
    const normalized = normalize(query);
    const direct = topics.slice(0, -1).find((topic) => topic.terms.some((term) => normalized.includes(normalize(term))));
    if (direct) return direct;

    const words = normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const fuzzyTerms = [
      ['siyaset', 'politika'], ['ekonomi', 'finans'], ['oyun', 'gaming'],
      ['saglik', 'doktor'], ['dunya', 'uluslararasi'], ['turkiye'],
      ['teknoloji', 'yapay zeka'], ['spor', 'futbol'], ['gundem', 'haber'],
    ];
    for (const aliases of fuzzyTerms) {
      const topic = topics.find((item) => item.terms.some((term) => aliases.includes(normalize(term))));
      if (!topic) continue;
      if (words.some((word) => aliases.some((term) => term.length >= 5 && word.length >= 5 && editDistance(word, term) <= 1))) return topic;
    }
    return topics[topics.length - 1].terms.some((term) => normalized.includes(normalize(term)))
      ? topics[topics.length - 1]
      : null;
  }

  function isNewsContinuation(query) {
    const normalized = normalize(query).replace(/[?!.]+$/g, '').trim();
    return /^(?:(?:tamam|peki|evet|aynen|olur|ok|okay|yes|devam(?: et)?|continue)[, ]+)*(?:ne var(?:mis)?(?:ti)?(?:\s+gundemde)?|gundemde ne var(?:mis)?|baska ne var(?:mis)?|sonra ne oldu|bunu(?: da)? (?:anlat|ozetle|acikla)|daha fazla (?:bilgi|detay)|bu konuda (?:devam et|anlat)|haberleri (?:goster|listele))$/i.test(normalized)
      || /^(?:tamam|evet|aynen|olur|ok|okay|yes|devam(?: et)?|continue|bunu ozetle|ozetle)$/i.test(normalized);
  }

  function classifyIntent(query) {
    const n = normalize(query);
    if (/\b(dolar|usd|eur|euro|sterlin|gbp|jpy|yen(?:i)?|chf|frank|cad|aud|cny|yuan|tl|lira|kur|kurlar|exchange|currency|doviz)\b/.test(n)) return 'CURRENCY';
    if (/\b(saat kac|saat su an kac|su an saat kac|saat su an|saat kac oldu|current time|what time|tarih nedir|bugun tarih ne|bugun ayin kaci|bugun gunlerden ne|bugunun tarihi|today.?s date|what day is it)\b/.test(n)) return 'TIME';
    if (/\b(sosyal medya|twitter|x hesabi|x hesab|instagram|tiktok|trend topic|trendler|gundem basligi|viral)\b/.test(n)) return 'SOCIAL';
    if (/\b(siyaset|ekonomi|oyun|gundem|haber|son dakika|spor|teknoloji|saglik|dunya|turkiye)\b/.test(n) || topicFor(query)) return 'NEWS_CATEGORY';
    return 'GENERAL';
  }

  function isNewsIntent(query) {
    const intent = classifyIntent(query);
    return intent === 'NEWS_CATEGORY' || intent === 'SOCIAL';
  }

  function isNewsDetailRequest(query) {
    const normalized = normalize(query);
    const detailSignal = /(?:detay|detaylandir|detayli|ayrint|hakkinda|acikla|bilgi ver|biraz daha)/.test(normalized);
    const newsSignal = /(?:haber|madde|baslik|konu|nato|turkiye|gundem)/.test(normalized);
    const numberedFollowup = /^\s*[1-9]\d?\s*[.)]?\s*(?:haber|madde|baslik|gundem)/.test(normalized);
    return detailSignal && (newsSignal || numberedFollowup);
  }

  function detailSearchQuery(query) {
    let title = String(query || '')
      .replace(/^\s*Haber\s+detay[ıi]\s*/i, '')
      .replace(/^\s*(?:SON\s+DAK[Iİ]KA|BREAKING|FLASH)\s*(?:\|\s*)?/i, '')
      .replace(/^\s*\d{1,2}\s*[.)]?\s*/, '')
      .replace(/\bABD\s+Başkan[ıi]\b/gi, ' ')
      .replace(/(?:detaylandir(?:ir)? misin|detaylandir|detaylarini? (?:ver|anlat)|detayli (?:bilgi|aciklama) (?:ver|anlat)|biraz daha detay (?:verir misin|verirmisin|anlatir misin)|detay verir misin|detay verirmisin|detay(?:ı|i)?|aciklar misin|bilgi verir misin|hakk(?:ında|inda)|hakkindaki)/gi, ' ')
      .replace(/\b(?:biraz|daha|fazla|kisa|kısaca|lutfen|lütfen|haberi|haberini|haber|maddeyi|maddesini|madde|konuyu|son|dakika|breaking|flash|canli|live|baslik|basliklari|detay|hakkinda|icin|ile|ve|bu|bir|olarak|aciklama|baskan|baskani|cumhurbaskani|bakan|bakani)\b/gi, ' ')
      .replace(/[?!.]+$/g, ' ');

    const stopWords = new Set(['de', 'da', 'ki', 'mi', 'mu', 'ne', 'icin', 'ile', 've', 'gibi', 'daha', 'sonra']);
    const tokens = title.split(/\s+/).map((token) => token.replace(/[’'].*$/, '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''));
    return tokens.filter((token) => {
      if (!token) return false;
      const normalized = normalize(token);
      if (stopWords.has(normalized)) return false;
      if (/^(?:olacak|oldu|oluyor|ediyor|etti|katilacak|katilacaklar|acikladi|duyurdu)$/.test(normalized)) return false;
      if (/(?:acak|ecek|iyor|iyorlar|iyorlar|di|du|mis|mus)$/.test(normalized) && normalized.length > 6) return false;
      return true;
    }).join(' ').slice(0, 500);
  }

  function detailSearchQueries(query) {
    const primary = detailSearchQuery(query);
    if (!primary) return [];
    const tokens = primary.split(/\s+/).filter(Boolean);
    const priority = (token) => {
      const normalized = normalize(token);
      if (normalized === 'nato') return 100;
      if (/^zirve/.test(normalized)) return 90;
      if (normalized === 'trump') return 80;
      if (normalized === 'turkiye') return 70;
      if (/^[A-Z\u00c0-\u00de]{2,}$/.test(token)) return 60;
      return Math.min(token.length, 20);
    };
    const fallback = tokens.slice().sort((a, b) => priority(b) - priority(a)).slice(0, 4).join(' ');
    return [...new Set([primary, fallback].filter(Boolean))];
  }

  function detailSubject(query) {
    return detailSearchQuery(query) || String(query || '').replace(/^\s*Haber\s+detay[ıi]\s*/i, '').trim();
  }

  function searchQuery(query) {
    if (isNewsDetailRequest(query)) return detailSearchQuery(query);
    const gameTitle = String(query || '').match(/\bminecraft(?:\s+dungeons?)?\b/i);
    if (gameTitle) return `${gameTitle[0].replace(/\s+/g, ' ').trim()} güncel haberler güncelleme`;
    return topicFor(query)?.query || '';
  }

  function failureMessage(query) {
    if (isNewsDetailRequest(query)) {
      const subject = detailSubject(query);
      const number = String(query || '').match(/^\s*(\d{1,2})\s*[.)]?/);
      const label = subject ? `“${subject}” haberinin` : number ? `${number[1]}. haberin` : 'İstenen haberin';
      return `${label} detayını şu anda canlı kaynaklardan doğrulayamadım; haber kaynaklarına erişilemiyor. Doğrulanmamış bilgi paylaşmıyorum.`;
    }
    const topic = topicFor(query)?.label || 'Güncel gündem';
    return `Şu anda ${topic.toLocaleLowerCase('tr-TR')} için canlı haber sonuçlarını alamadım. Kaynaklara erişemediğim için güncel gelişmeleri doğrulanmış bilgi olarak aktaramıyorum.`;
  }

  const api = { classifyIntent, isNewsIntent, isNewsDetailRequest, isNewsContinuation, detailSearchQuery, detailSearchQueries, detailSubject, topicFor, searchQuery, failureMessage };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FoVerseNewsIntent = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

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
    { label: 'Oyun gündemi', query: 'Oyun gündemi son dakika oyun haberleri Steam PlayStation Xbox Nintendo 2026', terms: ['oyun gundemi', 'oyun haberleri', 'oyunlarda ne var', 'gaming news', 'oyun sektoru gundemi', 'oyun', 'oyunlarda'] },
    { label: 'Sağlık gündemi', query: 'Sağlık haberleri son dakika', terms: ['saglik', 'doktor', 'hastane'] },
    { label: 'Dünya gündemi', query: 'Dünya gündem haberleri son dakika', terms: ['dunya', 'uluslararasi'] },
    { label: 'Türkiye gündemi', query: 'Türkiye gündem haberleri son dakika', terms: ['turkiye'] },
    { label: 'Teknoloji gündemi', query: 'Teknoloji haberleri son dakika', terms: ['teknoloji', 'yapay zeka', 'bilgisayar', 'telefon'] },
    { label: 'Spor gündemi', query: 'Spor haberleri son dakika', terms: ['spor', 'futbol', 'basketbol'] },
    { label: 'Son dakika', query: 'Türkiye son dakika haberleri', terms: ['son dakika'] },
    { label: 'Güncel gündem', query: 'Türkiye ve dünya gündem son dakika haberleri', terms: ['gundem', 'haber', 'son dakika', 'ne var', 'neler oldu', 'neler oluyor', 'guncel'] },
  ];

  function topicFor(query) {
    const normalized = normalize(query);
    return topics.find((topic) => topic.terms.some((term) => normalized.includes(normalize(term)))) || null;
  }

  function classifyIntent(query) {
    const n = normalize(query);
    if (/^\s*\d{1,2}\s*[.)]?\s*(?:(?:haber|madde|baslik|oyun|kaynak)\b)?/.test(n) && /\d/.test(n)) return 'NUMBERED_REFERENCE';
    if (/\b(dolar|usd|eur|euro|sterlin|gbp|jpy|yen(?:i)?|chf|frank|cad|aud|cny|yuan|tl|lira|kur|kurlar|exchange|currency|doviz)\b/.test(n)) return 'CURRENCY';
    if (/\b(saat kac|saat su an kac|su an saat kac|saat su an|saat kac oldu|current time|what time|tarih nedir|bugun tarih ne|bugun ayin kaci|bugun gunlerden ne|bugunun tarihi|today.?s date|what day is it)\b/.test(n)) return 'TIME';
    if (/\b(bu|bunun|buna|bunu|bundan|bunlar|bunlarin|onun|ona|onu|ondan|o|onceki|az onceki|yukaridaki|this|that|it|they|these|those|previous one)\b/.test(n)) return 'CONTEXT_REFERENCE';
    if (/\b(sosyal medya|twitter|x hesabi|x hesab|instagram|tiktok|trend topic|trendler|gundem basligi|viral)\b/.test(n)) return 'SOCIAL';
    if (/\b(siyaset|ekonomi|oyun|gundem|haber|son dakika|spor|teknoloji|saglik|dunya|turkiye)\b/.test(n) || topicFor(query)) return 'NEWS_CATEGORY';
    if (/\b(tarif|recipe|makarna|spagetti|corba|pilav|menemen|tavuk|kek)\b/.test(n)) return 'RECIPE';
    if (/\b(kaynak|ara\s|arastir|search|current|latest|guncel|bugun|fiyat|version|surum|release|hava durumu)\b/.test(n)) return 'RESEARCH';
    return 'GENERAL';
  }

  const entityStopWords = new Set(('acikla anlat nedir ne kim nasil neden hakkinda icin ile ve bir bu su o bana lutfen please explain tell me about what is how why can you give details summary summarize compare versus vs fiyat tarihi tarih bugun guncel latest current news haber detay').split(' '));

  function extractEntities(value) {
    const text = String(value || '').trim();
    const topic = topicFor(text);
    const candidates = text.match(/[\p{L}\p{N}][\p{L}\p{N}+'’.-]*/gu) || [];
    const entities = candidates.map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
      .filter((word) => {
        const normalized = normalize(word);
        return normalized.length > 1 && !entityStopWords.has(normalized) && !/^\d+$/.test(normalized);
      });
    if (topic) entities.unshift(topic.label.replace(/ gündemi$/i, ''));
    return [...new Set(entities)].slice(0, 8);
  }

  function createConversationMemory(initial) {
    const memory = initial && typeof initial === 'object' ? initial : {};
    memory.turns = Array.isArray(memory.turns) ? memory.turns.slice(-20) : [];
    memory.entities = Array.isArray(memory.entities) ? memory.entities.slice(-30) : [];
    memory.topics = Array.isArray(memory.topics) ? memory.topics.slice(-20) : [];
    memory.lists = Array.isArray(memory.lists) ? memory.lists.slice(-10) : [];
    return memory;
  }

  function rememberTurn(memory, user, assistant, items) {
    const state = createConversationMemory(memory);
    const entities = extractEntities(user);
    const safeItems = Array.isArray(items) ? items.slice(0, 12).map((item) => ({
      title: String(item?.title || item || '').slice(0, 300),
      url: String(item?.url || '').slice(0, 1000),
      snippet: String(item?.snippet || '').slice(0, 1000),
    })) : [];
    const turn = { user: String(user || '').slice(0, 1000), assistant: String(assistant || '').replace(/<[^>]*>/g, ' ').slice(0, 2000), entities, topic: topicFor(user)?.label || '', items: safeItems, at: Date.now() };
    state.turns.push(turn);
    state.turns = state.turns.slice(-20);
    state.entities = [...state.entities, ...entities].slice(-30);
    if (turn.topic) state.topics = [...state.topics, turn.topic].slice(-20);
    if (safeItems.length) {
      state.lists.push({ query: turn.user, items: safeItems, at: turn.at });
      state.lists = state.lists.slice(-10);
      state.entities = [...state.entities, ...safeItems.map((item) => item.title)].slice(-30);
    }
    return state;
  }

  function resolveReference(query, memory) {
    const original = String(query || '').trim();
    const state = createConversationMemory(memory);
    const latest = state.turns[state.turns.length - 1];
    const list = state.lists[state.lists.length - 1];
    const number = original.match(/^\s*(\d{1,2})\s*[.)]?\s*(?:(?:haber|madde|baslik|kaynak|oyun)\b)?/i)?.[1];
    if (number && list?.items[Number(number) - 1]) {
      const item = list.items[Number(number) - 1];
      return { query: `Haber detayı ${item.title}`, subject: item.title, item, isReference: true, number: Number(number) };
    }
    const normalized = normalize(original);
    const hasReference = /\b(bu|bunun|buna|bunu|bundan|bunlar|bunlarin|onun|ona|onu|ondan|o|onceki|az onceki|yukaridaki|this|that|it|they|these|those|previous one)\b/.test(normalized);
    if (!hasReference) return { query: original, subject: '', item: null, isReference: false, number: null };
    const subject = list?.items?.[0]?.title || latest?.entities?.[0] || state.entities[state.entities.length - 1] || '';
    if (!subject) return { query: original, subject: '', item: null, isReference: false, number: null };
    return { query: `${original} (konu: ${subject})`, subject, item: list?.items?.[0] || null, isReference: true, number: null };
  }

  function memoryContext(memory) {
    const state = createConversationMemory(memory);
    const recent = state.turns.slice(-6).map((turn) => {
      const titles = turn.items.map((item, index) => `${index + 1}. ${item.title}`).join('; ');
      return `Kullanıcı: ${turn.user}${turn.entities.length ? ` | Konular: ${turn.entities.join(', ')}` : ''}${titles ? ` | Gösterilen liste: ${titles}` : ''}`;
    });
    return recent.join('\n').slice(-4000);
  }

  function isNewsIntent(query) {
    const intent = classifyIntent(query);
    return intent === 'NEWS_CATEGORY' || intent === 'SOCIAL';
  }

  function isNewsDetailRequest(query) {
    const normalized = normalize(query);
    const detailSignal = /(?:detay|detaylandir|detayli|ayrint|hakkinda|acikla|bilgi ver|biraz daha)/.test(normalized);
    const newsSignal = /(?:haber|madde|baslik|konu|nato|turkiye)/.test(normalized);
    const numberedFollowup = /^\s*[1-9]\d?\s*[.)]?\s*(?:haber|madde|baslik)/.test(normalized);
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

  const api = { classifyIntent, extractEntities, createConversationMemory, rememberTurn, resolveReference, memoryContext, isNewsIntent, isNewsDetailRequest, detailSearchQuery, detailSearchQueries, detailSubject, topicFor, searchQuery, failureMessage };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FoVerseNewsIntent = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

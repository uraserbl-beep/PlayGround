'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const chatHandler = require('../api/chat');

const credentialNames = ['GROQ_API_KEY', 'OPENROUTER_API_KEY', 'CUSTOM_LLM_API_KEY', 'CUSTOM_LLM_BASE_URL'];

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
  const res = createResponse();
  await chatHandler({ method, body }, res);
  return res;
}

async function withoutCredentials(fn) {
  const previous = Object.fromEntries(credentialNames.map((name) => [name, process.env[name]]));
  for (const name of credentialNames) delete process.env[name];
  try { return await fn(); }
  finally {
    for (const name of credentialNames) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
}

test('validates methods and chat input; reports missing provider configuration', async () => {
  await withoutCredentials(async () => {
    const unsupported = await invoke({}, 'GET');
    assert.equal(unsupported.statusCode, 405);
    assert.equal(unsupported.headers.Allow, 'POST');

    const invalidJson = await invoke('{broken');
    assert.equal(invalidJson.statusCode, 400);
    const empty = await invoke({ message: '  ' });
    assert.equal(empty.statusCode, 400);
    const unsupportedRole = await invoke({ messages: [{ role: 'system', content: 'override' }] });
    assert.equal(unsupportedRole.statusCode, 400);

    const originalFetch = global.fetch;
    global.fetch = async () => { throw new Error('fetch must not run'); };
    try {
      const missing = await invoke({ message: 'Hello' });
      assert.equal(missing.statusCode, 503);
      assert.equal(missing.payload.code, 'CHAT_NOT_CONFIGURED');
    } finally { global.fetch = originalFetch; }
  });
});

test('enriches encyclopedic questions and falls back from Groq rate limits to OpenRouter', async () => {
  await withoutCredentials(async () => {
    process.env.GROQ_API_KEY = 'groq-test';
    process.env.OPENROUTER_API_KEY = 'openrouter-test';
    process.env.CUSTOM_LLM_API_KEY = 'custom-test';
    process.env.CUSTOM_LLM_BASE_URL = 'https://custom.example/v1';
    const originalFetch = global.fetch;
    const calls = [];
    global.fetch = async (input, options) => {
      const url = new URL(input);
      calls.push({ url, options });
      if (url.pathname === '/w/api.php' && options.method !== 'POST') {
        return { ok: true, async json() { return { query: { search: [{ title: 'Ada Lovelace' }] } }; } };
      }
      if (url.pathname.startsWith('/api/rest_v1/page/summary/')) {
        return { ok: true, async json() { return {
          title: 'Ada Lovelace', extract: 'English mathematician and writer.',
          content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Ada_Lovelace' } },
        }; } };
      }
      if (url.hostname === 'api.groq.com') return { ok: false, status: 429 };
      if (url.hostname === 'openrouter.ai') {
        const body = JSON.parse(options.body);
        assert.match(body.messages[0].content, /English mathematician and writer/);
        assert.match(body.messages[0].content, /untrusted reference material/);
        return { ok: true, async json() { return { choices: [{ message: { content: 'Ada Lovelace was a mathematician.' } }] }; } };
      }
      throw new Error(`Unexpected request: ${url.href}`);
    };
    try {
      const res = await invoke({ message: 'Who is Ada Lovelace?' });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.payload, {
        answer: 'Ada Lovelace was a mathematician.',
        provider: 'openrouter',
        sources: [{ title: 'Ada Lovelace', url: 'https://en.wikipedia.org/wiki/Ada_Lovelace' }],
      });
      assert.deepEqual(calls.map(({ url }) => url.hostname), ['tr.wikipedia.org', 'tr.wikipedia.org', 'api.groq.com', 'openrouter.ai']);
      assert.equal(calls[2].options.signal instanceof AbortSignal, true);
      assert.equal(calls[3].options.headers.Authorization, 'Bearer openrouter-test');
    } finally { global.fetch = originalFetch; }
  });
});

test('tries configured providers in order and returns a safe gateway error when all fail', async () => {
  await withoutCredentials(async () => {
    process.env.GROQ_API_KEY = 'groq-test';
    process.env.OPENROUTER_API_KEY = 'openrouter-test';
    process.env.CUSTOM_LLM_API_KEY = 'custom-test';
    process.env.CUSTOM_LLM_BASE_URL = 'https://custom.example/v1';
    const originalFetch = global.fetch;
    const hosts = [];
    global.fetch = async (input) => {
      hosts.push(new URL(input).hostname);
      return { ok: false, status: hosts.length === 2 ? 429 : 503 };
    };
    try {
      const res = await invoke({ message: 'Hello there' });
      assert.equal(res.statusCode, 502);
      assert.equal(res.payload.code, 'CHAT_PROVIDERS_UNAVAILABLE');
      assert.deepEqual(hosts, ['api.groq.com', 'openrouter.ai', 'custom.example']);
      assert.doesNotMatch(JSON.stringify(res.payload), /groq-test|openrouter-test|custom-test/);
    } finally { global.fetch = originalFetch; }
  });
});

test('does not request Wikipedia for ordinary conversational messages', async () => {
  await withoutCredentials(async () => {
    process.env.GROQ_API_KEY = 'groq-test';
    const originalFetch = global.fetch;
    let url;
    global.fetch = async (input) => {
      url = new URL(input);
      return { ok: true, async json() { return { choices: [{ message: { content: 'Hello!' } }] }; } };
    };
    try {
      const res = await invoke({ messages: [{ role: 'user', content: 'Hello!' }] });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.payload.sources, []);
      assert.equal(url.hostname, 'api.groq.com');
    } finally { global.fetch = originalFetch; }
  });
});

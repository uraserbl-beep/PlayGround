'use strict';

const REQUEST_TIMEOUT_MS = 12000;

async function requestCompletion({ url, apiKey, model, messages, headers = {}, timeoutMs = REQUEST_TIMEOUT_MS }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...headers,
      },
      body: JSON.stringify({ model, messages, temperature: 0.7 }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const error = new Error(`Provider returned HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('Provider returned no completion');
    return content.trim();
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { requestCompletion };

'use strict';

const { requestCompletion } = require('./openai-compatible');

module.exports = {
  name: 'openrouter',
  isConfigured(env = process.env) { return Boolean(env.OPENROUTER_API_KEY); },
  complete(messages, env = process.env, timeoutMs) {
    return requestCompletion({
      url: 'https://openrouter.ai/api/v1/chat/completions',
      apiKey: env.OPENROUTER_API_KEY,
      model: env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct',
      messages,
      timeoutMs,
      headers: { 'HTTP-Referer': env.APP_URL || 'https://foverse.ai', 'X-Title': 'FoVerse AI' },
    });
  },
};

'use strict';

const { requestCompletion } = require('./openai-compatible');

module.exports = {
  name: 'custom',
  isConfigured(env = process.env) { return Boolean(env.CUSTOM_LLM_API_KEY && env.CUSTOM_LLM_BASE_URL); },
  complete(messages, env = process.env, timeoutMs) {
    const baseUrl = env.CUSTOM_LLM_BASE_URL.replace(/\/+$/, '');
    const url = /\/chat\/completions$/i.test(baseUrl) ? baseUrl : `${baseUrl}/chat/completions`;
    return requestCompletion({
      url,
      apiKey: env.CUSTOM_LLM_API_KEY,
      model: env.CUSTOM_LLM_MODEL || 'default',
      messages,
      timeoutMs,
    });
  },
};

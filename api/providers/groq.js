'use strict';

const { requestCompletion } = require('./openai-compatible');

module.exports = {
  name: 'groq',
  isConfigured(env = process.env) { return Boolean(env.GROQ_API_KEY); },
  complete(messages, env = process.env, timeoutMs) {
    return requestCompletion({
      url: 'https://api.groq.com/openai/v1/chat/completions',
      apiKey: env.GROQ_API_KEY,
      model: env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      messages,
      timeoutMs,
    });
  },
};

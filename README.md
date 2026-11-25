# PlayGround

<!-- omgithub:readme:start -->
## 🚀 Build, play, and remix with OMGithub

**Created using [OMGithub.com](https://go.ondev.store/).**

[![OMGithub](https://img.shields.io/badge/OMGithub-Open%20project-orange?style=for-the-badge)](https://go.ondev.store/uraserbl-beep/PlayGround)
[![GitHub](https://img.shields.io/badge/GitHub-Source-181717?logo=github&style=for-the-badge)](https://github.com/uraserbl-beep/PlayGround)

- 🎮 [Open the project](https://go.ondev.store/uraserbl-beep/PlayGround).
- ✨ [Remix this project](https://go.ondev.store/uraserbl-beep/PlayGround?remix=1).
- 💻 [Explore the source](https://github.com/uraserbl-beep/PlayGround).
- 🛠️ [Check build runs](https://github.com/uraserbl-beep/PlayGround/actions).
- 🐛 [Report an issue](https://github.com/uraserbl-beep/PlayGround/issues).
- 👤 [Explore the creator's projects](https://go.ondev.store/uraserbl-beep).
- 🌍 [Create with OMGithub](https://go.ondev.store/).
<!-- omgithub:readme:end -->

## Web search setup

The `/api/search` handler uses Google Custom Search. Configure these environment variables on a Node/serverless deployment that supports the `api/` directory:

- `GOOGLE_SEARCH_API_KEY`
- `GOOGLE_SEARCH_CX`

The credentials stay on the server and are never sent to the browser. The endpoint accepts POST requests, limits queries to 500 characters and results to 8, and applies an 8-second upstream timeout. For the local app and API server, run `./start.sh` or `node server.js` (port 3000 by default; override with `PORT`). The repository's preview/start command now launches this server so the UI and `/api/search` share the same origin. Use `node --test test/search.test.js test/server.test.js` to validate both the handler and its HTTP route. Static-only hosting does not run this endpoint; deploy it to a Node/serverless host configured to route `/api/search` to `api/search.js`, or use the local server. An external preview launcher may use its own routing configuration, which this repository cannot change.

## Chat API setup

`POST /api/chat` accepts either `{ "message": "..." }` or `{ "messages": [{ "role": "user", "content": "..." }] }`. It validates and bounds the input, optionally adds Wikipedia context for encyclopedic questions, and tries configured providers in this order:

1. Groq (`GROQ_API_KEY`, optional `GROQ_MODEL`)
2. OpenRouter (`OPENROUTER_API_KEY`, optional `OPENROUTER_MODEL`, `APP_URL`)
3. A custom OpenAI-compatible endpoint (`CUSTOM_LLM_API_KEY`, `CUSTOM_LLM_BASE_URL`, optional `CUSTOM_LLM_MODEL`)

If a provider fails, times out, or is rate-limited, the next configured provider is tried. If none are configured the endpoint returns `503` with `CHAT_NOT_CONFIGURED`; if all configured providers fail it returns `502` with `CHAT_PROVIDERS_UNAVAILABLE`. Successful responses include the answering `provider` and any Wikipedia `sources`. Set `WIKIPEDIA_LANG` to change the Wikipedia language (default `tr`). Copy `.env.example` to `.env` for local development and keep real keys out of version control.

The local server routes both `/api/search` and `/api/chat`, so the same UI and API origin applies. Run `npm test` to validate search, chat, provider fallback, Wikipedia context, and local HTTP routing.

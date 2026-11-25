'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const searchHandler = require('./api/search');
const chatHandler = require('./api/chat');

const PORT = Number(process.env.PORT) || 3000;
const MAX_BODY_BYTES = 16 * 1024;

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(payload));
}

async function readBody(req, res) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      sendJson(res, 413, { error: 'İstek gövdesi çok büyük.' });
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function createServer() {
  return http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;

    if (pathname === '/api/search' || pathname === '/api/search/' || pathname === '/api/chat' || pathname === '/api/chat/') {
      const handler = pathname.startsWith('/api/chat') ? chatHandler : searchHandler;
      const body = await readBody(req, res);
      if (body === null) return;

      const handlerResponse = {
        statusCode: 200,
        headers: {},
        status(code) { this.statusCode = code; return this; },
        set(name, value) { this.headers[name] = value; return this; },
        json(payload) {
          res.writeHead(this.statusCode, {
            ...this.headers,
            'Content-Type': 'application/json; charset=utf-8',
          });
          res.end(JSON.stringify(payload));
          return this;
        },
      };

      await handler({ method: req.method, body, url: req.url, query: Object.fromEntries(new URL(req.url, 'http://localhost').searchParams) }, handlerResponse);
      return;
    }

    if (pathname === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
      return;
    }

    if (pathname === '/assets/cosmic-black-hole-space-live-wallpaper.mp4' && (req.method === 'GET' || req.method === 'HEAD')) {
      const filePath = path.join(__dirname, 'assets', 'cosmic-black-hole-space-live-wallpaper.mp4');
      fs.stat(filePath, (err, stat) => {
        if (err) return sendJson(res, 404, { error: 'Video not found.' });
        const headers = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=86400' };
        const range = req.headers.range;
        if (!range) {
          res.writeHead(200, { ...headers, 'Content-Length': stat.size });
          if (req.method === 'HEAD') return res.end();
          fs.createReadStream(filePath).pipe(res);
          return;
        }
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match) {
          res.writeHead(416, { ...headers, 'Content-Range': `bytes */${stat.size}` });
          return res.end();
        }
        const start = match[1] ? Number(match[1]) : 0;
        const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
        if (!Number.isFinite(start) || start >= stat.size || end < start) {
          res.writeHead(416, { ...headers, 'Content-Range': `bytes */${stat.size}` });
          return res.end();
        }
        res.writeHead(206, { ...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${stat.size}` });
        if (req.method === 'HEAD') return res.end();
        fs.createReadStream(filePath, { start, end }).pipe(res);
      });
      return;
    }

    sendJson(res, 404, { error: 'Not found.' });
  });
}

if (require.main === module) {
  createServer().listen(PORT, '0.0.0.0', () => {
    console.log(`PlayGround server listening on port ${PORT}`);
  });
}

module.exports = { createServer };

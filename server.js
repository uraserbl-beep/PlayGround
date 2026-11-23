'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const searchHandler = require('./api/search');

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

    if (pathname === '/api/search' || pathname === '/api/search/') {
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

      await searchHandler({ method: req.method, body }, handlerResponse);
      return;
    }

    if (pathname === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
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

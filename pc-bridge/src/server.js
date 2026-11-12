'use strict';
const http = require('http');
const crypto = require('crypto');
const { Chatbox } = require('./chatbox');
const { lanAddresses } = require('./config');

/** Constant-time token comparison to avoid trivial timing leaks on the LAN. */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function json(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Create the HTTP server that the Android client talks to.
 *
 * Routes:
 *   GET  /api/health                 -> server + config summary (no auth)
 *   GET  /api/info                   -> LAN addresses + limits (no auth)
 *   POST /api/say    { text, sfx? }  -> send a chatbox message
 *   POST /api/typing { on }          -> toggle typing indicator
 *   GET  /api/history                -> recent messages
 *   GET  /                           -> tiny web UI (same feature set)
 */
function createServer(cfg, chatbox, log = console) {
  const history = [];
  const startedAt = Date.now();

  const requireAuth = (req, res) => {
    if (!cfg.requireToken) return true;
    const header = req.headers['authorization'] || '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
    const provided = bearer || req.headers['x-aost-token'] || '';
    if (!provided || !safeEqual(provided, cfg.token)) {
      json(res, 401, { ok: false, error: 'unauthorized', hint: 'Send Authorization: Bearer <token>' });
      return false;
    }
    return true;
  };

  const pushHistory = (entry) => {
    history.push(entry);
    if (history.length > cfg.historySize) history.shift();
  };

  const server = http.createServer(async (req, res) => {
    // Permissive CORS: this is a LAN tool, and the browser UI is served from here.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-AOST-Token');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
    const route = url.pathname.replace(/\/+$/, '') || '/';

    try {
      if (route === '/api/health' && req.method === 'GET') {
        return json(res, 200, {
          ok: true,
          uptimeMs: Date.now() - startedAt,
          osc: { host: cfg.oscHost, port: cfg.oscPort },
          stats: chatbox.stats,
        });
      }

      if (route === '/api/info' && req.method === 'GET') {
        return json(res, 200, {
          ok: true,
          name: 'AndroidOSCText bridge',
          version: require('../package.json').version,
          addresses: lanAddresses(),
          port: cfg.httpPort,
          limits: { maxChars: cfg.maxChars, maxLines: cfg.maxLines, minIntervalMs: cfg.minIntervalMs },
          requiresToken: cfg.requireToken,
        });
      }

      if (route === '/api/say' && req.method === 'POST') {
        if (!requireAuth(req, res)) return;
        const raw = await readBody(req);
        let payload = {};
        try { payload = raw ? JSON.parse(raw) : {}; } catch {
          return json(res, 400, { ok: false, error: 'invalid JSON body' });
        }
        const text = payload.text;
        if (typeof text !== 'string' || !text.trim()) {
          return json(res, 400, { ok: false, error: 'field "text" is required' });
        }
        const result = await chatbox.send(text, {
          sendNow: payload.sendNow ?? cfg.sendNow,
          sfx: payload.sfx ?? cfg.sfx,
        });
        pushHistory({ at: Date.now(), text: result.text, chars: Array.from(result.text).length });
        return json(res, 200, { ok: true, ...result });
      }

      if (route === '/api/typing' && req.method === 'POST') {
        if (!requireAuth(req, res)) return;
        const raw = await readBody(req);
        let payload = {};
        try { payload = raw ? JSON.parse(raw) : {}; } catch { /* default off */ }
        const on = await chatbox.setTyping(!!payload.on);
        return json(res, 200, { ok: true, typing: on });
      }

      if (route === '/api/history' && req.method === 'GET') {
        if (!requireAuth(req, res)) return;
        return json(res, 200, { ok: true, items: history.slice(-50) });
      }

      if (route === '/' && req.method === 'GET') {
        const page = require('./webui').render(cfg);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(page);
      }

      return json(res, 404, { ok: false, error: 'not found', path: route });
    } catch (err) {
      log.error('[http] ' + req.method + ' ' + route + ' failed:', err.message);
      return json(res, 500, { ok: false, error: err.message });
    }
  });

  return { server, history };
}

module.exports = { createServer };

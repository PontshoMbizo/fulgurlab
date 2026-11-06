// fulgurlab simulation server: HTTP API in front of headless Scilab/Xcos.
//
//   POST /api/simulate   netlist JSON -> { ok, scopes, elapsedMs } | { ok:false, error, issues?, log? }
//   POST /api/validate   netlist JSON -> { ok, issues }
//   GET  /api/health     -> { ok, scilab }
//   GET  /*              static files from web/dist (if built), so one container serves everything
//
// Env: PORT (8080), HOST (0.0.0.0), CORS_ORIGINS (comma list, or *), STATIC_DIR,
//      plus the runner's SCILAB_BIN / SIM_TIMEOUT_MS / SIM_CONCURRENCY.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateNetlist, NetlistError } from './netlist.js';
import { simulate, SimulationError, config } from './runner.js';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const STATIC_DIR = resolve(process.env.STATIC_DIR || join(here, '../../web/dist'));
const ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_BODY = 512 * 1024;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

function cors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return;
  if (ORIGINS.includes('*') || ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', ORIGINS.includes('*') ? '*' : origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
}

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'Cache-Control': 'no-store' });
  res.end(data);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('request too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')); }
      catch { reject(Object.assign(new Error('body is not valid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

let scilabVersion = null;
async function health() {
  if (scilabVersion === null) {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(config.scilab, ['-version'], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 });
    const m = String(r.stdout || '').match(/(\d{4}\.\d+\.\d+|\d+\.\d+\.\d+)/);
    scilabVersion = r.error ? false : (m ? m[1] : 'unknown');
  }
  return { ok: scilabVersion !== false, scilab: scilabVersion || null, concurrency: config.concurrency };
}

async function serveStatic(req, res) {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = normalize(join(STATIC_DIR, rel));
  if (!file.startsWith(STATIC_DIR)) return send(res, 403, { error: 'forbidden' });
  try {
    const st = await stat(file);
    if (!st.isFile()) throw new Error('not a file');
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch {
    // SPA fallback
    try {
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      res.end(await readFile(join(STATIC_DIR, 'index.html')));
    } catch { send(res, 404, { error: 'not found (build web/ or use the Vite dev server)' }); }
  }
}

export const server = createServer(async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const path = new URL(req.url, 'http://x').pathname;
  try {
    if (path === '/api/health' && req.method === 'GET') return send(res, 200, await health());

    if ((path === '/api/simulate' || path === '/api/validate') && req.method === 'POST') {
      const body = await readJson(req);
      let net;
      try { net = validateNetlist(body); }
      catch (e) {
        if (e instanceof NetlistError) return send(res, path === '/api/validate' ? 200 : 422, { ok: false, error: 'The diagram has problems', issues: e.issues });
        throw e;
      }
      if (path === '/api/validate') return send(res, 200, { ok: true, issues: [] });
      try {
        const r = await simulate(net);
        return send(res, 200, { ok: true, scopes: r.scopes, elapsedMs: r.elapsedMs });
      } catch (e) {
        if (e instanceof SimulationError) return send(res, 422, { ok: false, error: e.message, log: e.log });
        throw e;
      }
    }

    if (path.startsWith('/api/')) return send(res, 404, { error: 'no such endpoint' });
    if (req.method === 'GET') return serveStatic(req, res);
    return send(res, 405, { error: 'method not allowed' });
  } catch (e) {
    console.error(e);
    return send(res, e.status || 500, { ok: false, error: e.status ? e.message : 'internal error' });
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, HOST, () => console.log(`fulgurlab server on http://${HOST}:${PORT} (scilab: ${config.scilab}, concurrency ${config.concurrency})`));
}

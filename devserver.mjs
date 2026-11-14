// Minimal static dev server for saltline/ — binds 0.0.0.0:8080.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = join(import.meta.dirname, 'saltline');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let file = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
    // extensionless path → index.html (also a gentle 404 fallback)
    let data;
    try {
      data = await readFile(file);
      if (Buffer.isBuffer(data) && (await stat(file)).isDirectory()) throw new Error('dir');
    } catch {
      file = join(ROOT, 'index.html');
      data = await readFile(file);
    }
    res.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*'
    });
    res.end(data);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + e.message);
  }
}).listen(process.env.PORT || 8080, '0.0.0.0', () =>
  console.log(`SALTLINE dev server → http://0.0.0.0:${process.env.PORT || 8080}`)
);

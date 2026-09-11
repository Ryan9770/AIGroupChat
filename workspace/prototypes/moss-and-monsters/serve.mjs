import http from 'node:http';
import { readFile } from 'node:fs/promises';

const port = Number(process.env.PORT || 4179);
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/game.js', ['game.js', 'text/javascript; charset=utf-8']],
]);

http.createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (path === '/favicon.ico') { response.writeHead(204); response.end(); return; }
  const entry = files.get(path);
  if (!entry) { response.writeHead(404); response.end('Not found'); return; }
  try {
    const content = await readFile(new URL(entry[0], import.meta.url));
    response.writeHead(200, { 'Content-Type': entry[1], 'Cache-Control': 'no-store' });
    response.end(content);
  } catch {
    response.writeHead(503); response.end('Prototype files are not ready.');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Moss & Monsters: http://127.0.0.1:${port}`);
});

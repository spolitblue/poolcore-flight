/* Local static server for POOLCORE FLIGHT (no deps).
   Usage: node lib/serve.js [port]   (default 8123)
   Serve the project root (../..) so index.html + css/js/lib resolve. */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const port = +(process.argv[2] || 8123);
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.json': 'application/json', '.mjs': 'text/javascript', '.map': 'application/json',
};
http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  let f = path.normalize(path.join(root, p));
  if (!f.startsWith(path.normalize(root))) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': mime[path.extname(f).toLowerCase()] || 'application/octet-stream' });
    res.end(d);
  });
}).listen(port, () => {
  console.log('POOLCORE FLIGHT server:  http://127.0.0.1:' + port + '/index.html');
});

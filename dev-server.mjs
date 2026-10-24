// Servidor local para probar todo sin Vercel: node dev-server.mjs  (o npm run dev)
// Sirve /public y ejecuta los mismos archivos de /api que corre Vercel.
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.PERMITIR_FECHA ??= '1'; // en local se puede probar otro día con ?fecha=AAAA-MM-DD

const RAIZ = fileURLToPath(new URL('.', import.meta.url));
const PUBLICA = join(RAIZ, 'public');
const PUERTO = Number(process.env.PORT || 3000);
process.env.SITE_URL ??= `http://localhost:${PUERTO}`; // así og:image etc. apuntan acá y no a producción

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function leerCuerpo(req) {
  const trozos = [];
  for await (const t of req) trozos.push(t);
  const texto = Buffer.concat(trozos).toString();
  try {
    return texto ? JSON.parse(texto) : {};
  } catch {
    return {};
  }
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/') {
    // Igual que el rewrite "/" -> "/api/index" de vercel.json: así local y producción resuelven
    // {{SITE_URL}} de la misma forma (si no, public/plantilla.html se vería con el placeholder crudo).
    const modulo = await import('./api/index.js');
    return modulo.default(req, res);
  }

  if (url.pathname.startsWith('/api/')) {
    // Admite subcarpetas (api/practica/nueva.js), igual que Vercel.
    const nombre = url.pathname.slice(5).split('/').map((t) => t.replace(/[^a-z0-9-]/gi, '')).filter(Boolean).join('/');
    let modulo;
    try {
      modulo = await import(`./api/${nombre}.js`);
    } catch {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      return res.end('{"error":"no_existe"}');
    }
    req.query = Object.fromEntries(url.searchParams);
    if (req.method === 'POST') req.body = await leerCuerpo(req);
    return modulo.default(req, res);
  }

  const ruta = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\]?\.\.)+/, '');
  const archivo = join(PUBLICA, ruta === '/' || ruta === '\\' ? 'index.html' : ruta);
  if (!archivo.startsWith(PUBLICA)) {
    res.statusCode = 403;
    return res.end();
  }
  try {
    const contenido = await readFile(archivo);
    res.setHeader('Content-Type', TIPOS[extname(archivo)] ?? 'application/octet-stream');
    res.end(contenido);
  } catch {
    res.statusCode = 404;
    res.end('No encontrado');
  }
});

servidor.listen(PUERTO, () => console.log(`Listo en http://localhost:${PUERTO}`));

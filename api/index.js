// Sirve la página principal (public/plantilla.html) con la URL del sitio ya resuelta en las meta de
// Open Graph/Twitter: SITE_URL, o un fallback razonable si no está seteada (ver README). Es la única
// página que necesita esto; el resto de /public se sirve tal cual, como archivos estáticos.
// vercel.json redirige "/" acá (y dev-server.mjs hace lo mismo en local), así que public/plantilla.html
// no se sirve directo: si se pidiera tal cual, se verían los {{SITE_URL}} sin resolver.
import { readFile } from 'node:fs/promises';

const PLANTILLA = new URL('../public/plantilla.html', import.meta.url);
const FALLBACK = 'https://crack-del-dia.vercel.app';

export default async function handler(req, res) {
  const siteUrl = (process.env.SITE_URL || FALLBACK).replace(/\/+$/, '');
  const html = (await readFile(PLANTILLA, 'utf8')).replaceAll('{{SITE_URL}}', siteUrl);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(html);
}

/** Check built local links, including anchors, and emit a sitemap from actual output. */
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
const dist = resolve(import.meta.dirname, '../dist');
async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((e) => e.isDirectory() ? walk(join(directory, e.name)) : [join(directory, e.name)]))).flat();
}
const files = await walk(dist);
const html = files.filter((f) => f.endsWith('.html'));
const cache = new Map(await Promise.all(html.map(async (f) => [f, await readFile(f, 'utf8')])));
const origin = 'https://openentitlement.dev';
const routeFor = (file) => '/' + relative(dist, file).replace(/index\.html$/, '');
const errors = [];
for (const [file, content] of cache) {
  for (const match of content.matchAll(/(?:href|src)=["']([^"']+)["']/g)) {
    const href = match[1].replaceAll('&amp;', '&');
    if (/^(?:data:|mailto:|tel:|javascript:)/.test(href)) continue;
    const url = new URL(href, origin + routeFor(file));
    if (url.origin !== origin) continue;
    const path = decodeURIComponent(url.pathname);
    let target = resolve(dist, '.' + path);
    try {
      if ((await stat(target)).isDirectory()) target = join(target, 'index.html');
      await stat(target);
    } catch { errors.push(`${routeFor(file)} → ${href} (missing file)`); continue; }
    if (url.hash && cache.has(target)) {
      const id = decodeURIComponent(url.hash.slice(1));
      if (id && !Array.from(cache.get(target).matchAll(/id=["']([^"']+)["']/g), (m) => m[1]).includes(id))
        errors.push(`${routeFor(file)} → ${href} (missing anchor)`);
    }
  }
}
if (errors.length) throw new Error('Broken site links:\n' + [...new Set(errors)].join('\n'));
console.log(`Verified local links and anchors across ${html.length} HTML pages.`);

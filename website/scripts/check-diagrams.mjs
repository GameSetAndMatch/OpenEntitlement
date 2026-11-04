/** Exercise built diagrams without JavaScript, at mobile/desktop sizes in both themes. */
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';
const dist = resolve(import.meta.dirname, '../dist');
const browser = await chromium.launch();
try {
  for (const theme of ['light', 'dark']) {
    for (const width of [390, 1280]) {
      const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width, height: 900 } });
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        let path = resolve(dist, '.' + decodeURIComponent(url.pathname));
        if (!path.startsWith(dist + sep)) return route.fulfill({ status: 404 });
        try {
          if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html');
          let body = await readFile(path);
          const type = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml' }[extname(path)] ?? 'application/octet-stream';
          if (type === 'text/html') body = Buffer.from(body.toString().replace(/data-theme="[^"]*"/, `data-theme="${theme}"`));
          await route.fulfill({ body, contentType: type });
        } catch { await route.fulfill({ status: 404 }); }
      });
      const page = await context.newPage();
      for (const name of ['01-data-model', '03-resolution']) {
        await page.goto(`https://docs.test/specification/${name}/`);
        assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
        const diagrams = page.locator('img[src^="/diagrams/"]');
        assert.equal(await diagrams.count(), 1, `${name}: diagram missing`);
        assert.equal(await page.locator('pre').filter({ hasText: /erDiagram|flowchart/ }).count(), 0);
        assert.ok(await diagrams.evaluate((img) => img.complete && img.naturalWidth > 0 && img.clientHeight > 20), `${name}: broken diagram`);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: horizontal overflow at ${width}px`);
      }
      await context.close();
    }
  }
  console.log('Both specification diagrams render without JavaScript in light/dark themes at 390px and 1280px.');
} finally { await browser.close(); }

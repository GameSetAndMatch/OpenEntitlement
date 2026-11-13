/**
 * The homepage has one way in: every primary action leads to the quickstart, and the quickstart ends
 * with the command to run and the exact output it prints. Checked on the built site in a real browser.
 */
import assert from 'node:assert/strict';
import {readFile, stat} from 'node:fs/promises';
import {extname, resolve, sep} from 'node:path';
import {chromium} from 'playwright';

const dist = resolve(import.meta.dirname, '../dist');
const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json'};
const QUICKSTART = '/docs/quickstart/';

const browser = await chromium.launch();
try {
  for (const width of [390, 1280]) {
    const page = await browser.newPage({viewport: {width, height: 900}});
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'site.test') return route.abort();
      let path = resolve(dist, '.' + decodeURIComponent(url.pathname));
      if (path !== dist && !path.startsWith(dist + sep)) return route.fulfill({status: 404});
      try {
        if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html');
        await route.fulfill({body: await readFile(path), contentType: types[extname(path)] ?? 'application/octet-stream'});
      } catch { await route.fulfill({status: 404}); }
    });

    await page.goto('https://site.test/');
    // Every primary-styled action on the homepage goes to the same place.
    const primaries = page.locator('.hero .sl-link-button.primary, .landing-primary');
    assert.equal(await primaries.count(), 2);
    assert.deepEqual([...new Set(await primaries.evaluateAll((links) => links.map((l) => l.getAttribute('href'))))], [QUICKSTART]);
    // The code example leads to the quickstart that runs it, not to a side path.
    assert.equal(await page.locator('.landing-code-more a').getAttribute('href'), QUICKSTART);

    await page.locator('.hero .sl-link-button.primary').click();
    await page.waitForURL(`https://site.test${QUICKSTART}`);
    assert.equal(await page.getByRole('heading', {level: 1}).innerText(), 'Quickstart');

    // The page ends with the command and its exact output: the last two code blocks.
    const blocks = await page.locator('main .expressive-code pre').evaluateAll((pres) => pres.map((pre) => ({
      language: pre.dataset.language,
      text: [...pre.querySelectorAll('.ec-line')].map((line) => line.textContent).join('\n').trim(),
    })));
    const [command, output] = blocks.slice(-2);
    assert.equal(command.language, 'sh');
    assert.match(command.text, /^node --conditions=source quickstart\.ts$/m);
    assert.equal(output.text, 'hooli 3 PLAN\nacme 250 OVERRIDE');
    // Copy buttons are what the docs_code_copied event listens to.
    assert.equal(await page.locator('main .expressive-code .copy button').count(), blocks.length);
    // Only what main runs today: no package install and no unreleased Product-scoped OEREP paths.
    const text = await page.locator('main').innerText();
    assert.doesNotMatch(text, /pip install|npm install @openentitlement|\/products\//);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `overflow at ${width}`);
    await page.close();
  }
  console.log('Quickstart path: every homepage primary action opens the quickstart, which ends with its command and exact output.');
} finally { await browser.close(); }

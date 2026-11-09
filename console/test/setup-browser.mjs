import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { chromium } from 'playwright';
import { configFromEnv } from '../server/config.ts';
import { startServer } from '../server/main.ts';

const service = await startServer({ ...configFromEnv({}), port: 0 });
let browser;
try {
  browser = await chromium.launch();
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const badRequests = [];
    page.on('request', request => {
      if (new URL(request.url()).pathname === '/api/organizations/') badRequests.push(request.url());
    });
    // Make the former race deterministic: an accidental empty-org request fails last.
    await page.route('**/api/organizations/', async route => {
      await new Promise(resolve => setTimeout(resolve, 200));
      await route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"invalid organization"}' });
    });
    await page.goto(service.url);
    await page.getByRole('heading', { name: 'Set up your workspace' }).waitFor();
    await page.getByRole('button', { name: /Refresh/ }).click();
    // Wait for the lists requested by Refresh to complete, then for any delayed failure.
    await page.waitForLoadState('networkidle');
    assert.equal(badRequests.length, 0, 'Refresh must not load an empty organization');
    assert.equal(await page.getByRole('heading', { name: 'Set up your workspace' }).isVisible(), true);
    assert.equal(await page.getByRole('alert').count(), 0);
    await page.getByRole('button', { name: 'Configuration', exact: true }).click();
    await page.getByRole('heading', { name: 'YAML configuration' }).waitFor();
    const code = page.getByLabel('Read-only YAML configuration');
    const shown = await code.textContent();
    assert.deepEqual(parse(shown).plans, []);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: 'Copy YAML', exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), shown);
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download YAML', exact: true }).click();
    const download = await pending;
    assert.equal(download.suggestedFilename(), 'openentitlement.snapshot.yaml');
    assert.equal(await readFile(await download.path(), 'utf8'), shown);
    await page.getByRole('button', { name: 'Organizations', exact: true }).click();
    await page.getByRole('heading', { name: 'Set up your workspace' }).waitFor();
    await page.close();
  }
  console.log('Fresh setup + Refresh regression passed at desktop and mobile widths');
} finally { await browser?.close(); await service.close(); }

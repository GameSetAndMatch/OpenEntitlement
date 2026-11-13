/**
 * Website analytics, checked on the built site in a real browser:
 * - a maintainer opens any page with ?oe_internal=1 and their browser is marked internal (the
 *   `$internal_or_test_user` person property the project's test-account filter excludes), the
 *   parameter is removed from the address bar, and ?oe_internal=0 undoes it;
 * - ordinary visits never set it;
 * - anywhere but openentitlement.dev (local previews, CI, self-hosted copies) nothing is sent.
 * PostHog is stubbed: requests to its hosts are recorded and answered locally.
 */
import assert from 'node:assert/strict';
import {readFile, stat} from 'node:fs/promises';
import {extname, resolve, sep} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {chromium} from 'playwright';

const dist = resolve(import.meta.dirname, '../dist');
const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json'};

function decode(request) {
  const body = request.postDataBuffer();
  if (!body?.length) return [];
  let text;
  if (body[0] === 0x1f && body[1] === 0x8b) text = gunzipSync(body).toString(); // gzip, with or without ?compression=
  else {
    text = body.toString();
    if (text.startsWith('data=')) text = Buffer.from(decodeURIComponent(text.slice(5)), 'base64').toString();
  }
  const parsed = JSON.parse(text);
  return (Array.isArray(parsed) ? parsed : parsed.batch ?? [parsed]).filter((e) => e && e.event);
}

async function site(browser, host) {
  // posthog-js drops events from headless browsers (user agent and client hints), so present an ordinary one.
  const context = await browser.newContext({userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'});
  await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'userAgentData', {get: () => undefined}));
  const events = [];
  let posthogRequests = 0;
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname.endsWith('posthog.com')) {
      posthogRequests++;
      if (request.method() === 'POST' && url.pathname.startsWith('/e')) events.push(...decode(request));
      return route.fulfill({status: 200, contentType: url.pathname.endsWith('.js') ? 'text/javascript' : 'application/json', body: url.pathname.endsWith('.js') ? '' : '{}'});
    }
    if (url.hostname !== host) return route.abort();
    let path = resolve(dist, '.' + decodeURIComponent(url.pathname));
    if (path !== dist && !path.startsWith(dist + sep)) return route.fulfill({status: 404});
    try {
      if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html');
      await route.fulfill({body: await readFile(path), contentType: types[extname(path)] ?? 'application/octet-stream'});
    } catch { await route.fulfill({status: 404}); }
  });
  const page = await context.newPage();
  return {context, page, events, requests: () => posthogRequests};
}

const internalFlags = (events) => events.filter((e) => e.event === '$set' || e.properties?.$set).map((e) => (e.$set ?? e.properties?.$set)?.$internal_or_test_user).filter((v) => v !== undefined);

async function until(check, what) {
  for (let i = 0; i < 100; i++) { if (check()) return; await new Promise((r) => setTimeout(r, 100)); }
  assert.fail(`timed out waiting for ${what}`);
}

// posthog-js drops events from automated browsers (navigator.webdriver), so hide that flag.
const browser = await chromium.launch({args: ['--disable-blink-features=AutomationControlled']});
try {
  // Production host: the opt-in link marks the browser internal once and cleans the address bar.
  {
    const {context, page, events} = await site(browser, 'openentitlement.dev');
    await page.goto('https://openentitlement.dev/docs/?oe_internal=1&utm_source=x#top');
    await until(() => internalFlags(events).length > 0, 'the internal marker');
    assert.deepEqual(internalFlags(events), [true]);
    assert.equal(page.url(), 'https://openentitlement.dev/docs/?utm_source=x#top');
    await page.goto('https://openentitlement.dev/');
    await until(() => events.filter((e) => e.event === '$pageview').length >= 2, 'two pageviews');
    assert.deepEqual(internalFlags(events), [true], 'later pages do not set the marker again');
    await page.goto('https://openentitlement.dev/?oe_internal=0');
    await until(() => internalFlags(events).length > 1, 'the marker being cleared');
    assert.deepEqual(internalFlags(events), [true, false]);
    assert.equal(page.url(), 'https://openentitlement.dev/');
    await context.close();
  }
  // An ordinary visit is never marked.
  {
    const {context, page, events} = await site(browser, 'openentitlement.dev');
    await page.goto('https://openentitlement.dev/');
    await until(() => events.some((e) => e.event === '$pageview'), 'a pageview');
    assert.deepEqual(internalFlags(events), []);
    await context.close();
  }
  // Copying a code block is recorded once, with the page, the block's language and its first line.
  {
    const {context, page, events} = await site(browser, 'openentitlement.dev');
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {origin: 'https://openentitlement.dev'});
    await page.goto('https://openentitlement.dev/docs/quickstart/');
    await until(() => events.some((e) => e.event === '$pageview'), 'a pageview');
    await page.locator('.expressive-code .copy button').first().click();
    await until(() => events.some((e) => e.event === 'docs_code_copied'), 'the copy event');
    const copied = events.filter((e) => e.event === 'docs_code_copied');
    assert.equal(copied.length, 1);
    assert.equal(copied[0].properties.path, '/docs/quickstart/');
    assert.equal(copied[0].properties.language, 'sh');
    assert.match(copied[0].properties.first_line, /^\S/);
    await context.close();
  }
  // Any other host (a local preview, CI, a self-hosted copy of the docs) sends nothing, even with the link.
  {
    const {context, page, requests} = await site(browser, 'docs.example.test');
    await page.goto('https://docs.example.test/?oe_internal=1');
    await page.waitForTimeout(1500);
    assert.equal(requests(), 0);
    await context.close();
  }
  console.log('Website analytics: ?oe_internal=1 marks the browser internal once and is removed from the address bar; =0 clears it; copying a code block sends docs_code_copied; other hosts send nothing.');
} finally { await browser.close(); }

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
    assert.doesNotMatch(await page.locator('aside').textContent(), /in-memory|postgres|OEREP/);
    assert.equal(await page.getByText(/^Storage:/).count(), 0);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.locator('.settings');
    assert.match(await settings.textContent(), /Storage.*in-memory/);
    assert.match(await settings.textContent(), /Protocol.*OEREP v1/);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: /Refresh/ }).click();
    // Wait for the lists requested by Refresh to complete, then for any delayed failure.
    await page.waitForLoadState('networkidle');
    assert.equal(badRequests.length, 0, 'Refresh must not load an empty organization');
    assert.equal(await page.getByRole('heading', { name: 'Set up your workspace' }).isVisible(), true);
    assert.equal(await page.getByRole('alert').count(), 0);
    await page.getByRole('link', { name: 'Tiers', exact: true }).click();
    await page.getByRole('heading', { name: 'Tier comparison' }).waitFor();
    assert.equal(new URL(page.url()).hash, '#/tiers');
    assert.equal(await page.getByRole('heading', { name: 'Set up your workspace' }).count(), 0);
    await page.reload();
    await page.getByRole('heading', { name: 'Tier comparison' }).waitFor();
    await page.getByRole('link', { name: 'Audit', exact: true }).click();
    assert.equal(new URL(page.url()).hash, '#/audit');
    assert.equal(await page.getByRole('heading', { name: 'Set up your workspace' }).count(), 0);
    await page.goBack();
    await page.getByRole('heading', { name: 'Tier comparison' }).waitFor();
    await page.getByRole('link', { name: 'Configuration', exact: true }).click();
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
    await page.getByRole('link', { name: 'Organizations', exact: true }).click();
    await page.getByRole('heading', { name: 'Set up your workspace' }).waitFor();
    await page.close();
  }
  const created = await fetch(service.url + '/api/plans/checkbox-test', {
    method: 'PUT', headers: { 'content-type': 'application/json', 'x-oe-actor': 'browser-test' },
    body: JSON.stringify({ name: 'Checkbox test', reason: 'test unlimited control' }),
  });
  assert.equal(created.status, 200);
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(service.url);
    const input = page.getByLabel('seat_max', { exact: true });
    const checkbox = page.getByRole('checkbox', { name: 'Unlimited seat_max', exact: true });
    await input.fill('-5');
    assert.equal(await input.inputValue(), '-5');
    assert.equal(await input.getAttribute('aria-invalid'), 'true');
    const inlineError = await page.getByRole('alert').textContent();
    const invalid = await fetch(service.url + '/api/plans/checkbox-test/values', {
      method: 'PUT', headers: { 'content-type': 'application/json', 'x-oe-actor': 'browser-test' },
      body: JSON.stringify({ values: { 'seat_max': -5 }, reason: 'negative value regression' }),
    });
    assert.equal(invalid.status, 422);
    assert.equal((await invalid.json()).message, inlineError);
    await page.getByRole('button', { name: 'Save entitlements', exact: true }).click();
    assert.equal(await page.getByRole('dialog').count(), 0);
    await input.fill('1.5');
    assert.equal(await input.inputValue(), '1.5');
    assert.equal(await input.getAttribute('aria-invalid'), 'true');
    await input.fill('25');
    assert.equal(await input.getAttribute('aria-invalid'), 'false');
    await checkbox.check();
    assert.equal(await input.isDisabled(), true);
    assert.equal(await input.inputValue(), '∞');
    assert.equal(await input.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(237, 241, 244)');
    await checkbox.focus(); await page.keyboard.press('Space');
    assert.equal(await input.isEnabled(), true);
    assert.equal(await input.inputValue(), '25');
    assert.equal(await page.getByRole('checkbox', { name: 'Unlimited project_max', exact: true }).count(), 0);
    const toggle = page.getByRole('switch', { name: 'sso_enabled', exact: true });
    assert.equal(await toggle.getAttribute('aria-checked'), 'false');
    assert.match(await toggle.textContent(), /Disabled.*Feature access not included/);
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-checked'), 'true');
    assert.match(await toggle.textContent(), /Enabled.*Feature access included/);
    assert.equal(await toggle.locator('.toggle-track').evaluate(el => el.getBoundingClientRect().width), 44);
    await toggle.focus(); await page.keyboard.press('Space');
    assert.equal(await toggle.getAttribute('aria-checked'), 'false');
    await page.close();
  }
  const controlled=await startServer({...configFromEnv({OE_CATALOG:new URL('../../deploy/catalog.environment.example.yaml',import.meta.url).pathname,MCP_INSTALLED:'False'}),port:0});
  try{
    const created=await fetch(controlled.url+'/api/plans/pro',{method:'PUT',headers:{'content-type':'application/json','x-oe-actor':'browser-test'},body:JSON.stringify({name:'Pro',reason:'Prepare environment control regression'})});assert.equal(created.status,200);
    for(const width of [1280,390]){const page=await browser.newPage({viewport:{width,height:900}});await page.goto(controlled.url);await page.getByRole('heading',{name:'Review what the tier includes'}).waitFor();
      const toggle=page.getByRole('switch',{name:'mcp_enabled',exact:true});assert.equal(await toggle.isDisabled(),true);assert.equal(await toggle.getAttribute('aria-checked'),'false');
      for(const [key,value] of [['max_mcp_calls','100'],['mcp_mode','read'],['max_connections','3']]){const input=page.getByLabel(key,{exact:true});assert.equal(await input.isDisabled(),key==='max_connections');assert.equal(await input.inputValue(),value);}
      assert.equal(await page.getByRole('switch',{name:'internal_enabled'}).count(),0);assert.match(await page.locator('main').innerText(),/MCP_INSTALLED=False/);assert.match(await page.locator('main').innerText(),/Frozen to the Catalog default/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.close();}
  }finally{await controlled.close();}
  console.log('Setup, YAML copy/download, and Unlimited checkbox tests passed at desktop and mobile widths');
} finally { await browser?.close(); await service.close(); }

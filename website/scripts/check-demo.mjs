/** Product scenes must explain the UI without JavaScript or an interactive playground. */
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {chromium} from 'playwright';
const dist=resolve(import.meta.dirname,'../dist');
const browser=await chromium.launch();
try {
 for(const theme of ['light','dark'])for(const width of [390,1280]){
  const page=await browser.newPage({javaScriptEnabled:false,viewport:{width,height:1000}});
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname!=='scenes.test')return route.abort();
   let path=resolve(dist,'.'+decodeURIComponent(url.pathname));
   if(path!==dist&&!path.startsWith(dist+sep))return route.fulfill({status:404});
   try{if((await stat(path)).isDirectory())path=resolve(path,'index.html');let body=await readFile(path);if(extname(path)==='.html')body=Buffer.from(body.toString().replace(/data-theme="[^"]*"/,`data-theme="${theme}"`));await route.fulfill({body,contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(path)]??'application/octet-stream'});}catch{await route.fulfill({status:404});}
  });
  await page.goto('https://scenes.test/');
  assert.equal(await page.locator('.product-scene').count(),3);
  for(const title of ['Define what you offer.','Package it into Tiers.','Explain every exception.','One question from your application.','Open source. Yours to run.'])assert.equal(await page.getByRole('heading',{name:title,exact:true}).isVisible(),true);
  assert.equal(await page.locator('.product-scenes astro-island').count(),0);
  assert.equal(await page.getByRole('button',{name:/demo|catalog|create/i}).count(),0);
  // One primary action in the hero and one at the close; no collapsed explanations or link cards.
  assert.equal(await page.locator('.hero .sl-link-button.primary').count(),1);
  assert.equal(await page.locator('main details, main .sl-link-card').count(),0);
  // Each product screen is the one way into its docs page, and every homepage action is named for analytics.
  assert.deepEqual(await page.locator('.scene-link').evaluateAll(a=>a.map(l=>[l.getAttribute('href'),l.dataset.phCta])),[['/docs/privilege-catalog/','scene_catalog'],['/docs/tiers/','scene_tiers'],['/docs/acme-workspace/#4-assign-organizations','scene_exception']]);
  assert.equal(await page.locator('.landing-close-actions a[data-ph-cta]').count(),2);
  assert.deepEqual(await page.locator('.hero .actions a').evaluateAll(a=>a.map(l=>l.dataset.phCta)),['hero_get_started','hero_specification']);
  const tier=page.locator('.product-scene').nth(1);
  assert.equal(await tier.locator('input[aria-label="seat_max"]').inputValue(),'∞');
  assert.equal(await tier.locator('[role=switch][aria-label="export_enabled"]').getAttribute('aria-checked'),'true');
  const customer=page.locator('.product-scene').nth(2);
  assert.match(await customer.innerText(),/40/);
  assert.match(await customer.innerText(),/Business includes 25/);
  assert.match(await customer.innerText(),/10,000/);
  assert.match(await customer.innerText(),/MCP_INSTALLED=false/);
  assert.equal(await page.locator('.product-scenes input').evaluateAll(inputs=>inputs.every(input=>input.closest('[inert]'))),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`overflow at ${width}/${theme}`);
  for(let i=0;i<12;i++){await page.keyboard.press('Tab');assert.equal(await page.locator('.product-screen :focus').count(),0);}
  await page.screenshot({path:`/tmp/oe-product-scenes-${width}-${theme}.png`,fullPage:true});
  await page.close();
 }
 console.log('Product scenes render without JavaScript at mobile/desktop sizes in both themes; unlimited, boolean, override and environment examples verified.');
}finally{await browser.close();}

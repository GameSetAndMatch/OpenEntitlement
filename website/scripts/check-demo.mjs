import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {chromium} from 'playwright';
const dist=resolve(import.meta.dirname,'../dist');
const browser=await chromium.launch();
try {
 for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:1000}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname!=='demo.test')return route.abort();
   let path=resolve(dist,'.'+decodeURIComponent(url.pathname));
   if(path!==dist&&!path.startsWith(dist+sep))return route.fulfill({status:404});
   try{if((await stat(path)).isDirectory())path=resolve(path,'index.html');await route.fulfill({body:await readFile(path),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(path)]??'application/octet-stream'});}catch{await route.fulfill({status:404});}
  });
  await page.goto('https://demo.test/');
  const demo=page.getByRole('region',{name:'Interactive Privilege Catalog'});
  await demo.getByRole('button',{name:'Edit Catalog',exact:true}).waitFor();
  assert.equal(await page.locator('details').getAttribute('open'),null);
  await page.screenshot({path:`/tmp/oe-landing-initial-${width}.png`,fullPage:true});
  await demo.getByRole('button',{name:'Edit Catalog',exact:true}).click();
  await demo.getByRole('button',{name:'Edit Seats',exact:true}).click();
  await demo.getByLabel('seat_max',{exact:true}).fill('7');
  await demo.getByRole('button',{name:'Save privilege',exact:true}).click();
  assert.equal(await demo.getByRole('button',{name:'Save privilege',exact:true}).count(),0);
  await demo.getByLabel('Filter by tag').selectOption('capacity');
  assert.equal(await demo.getByText('MCP access',{exact:true}).count(),0);
  await demo.getByLabel('Filter by tag').selectOption('');
  await demo.getByRole('button',{name:'Tiers',exact:true}).click();
  await demo.getByLabel('Override export_enabled',{exact:true}).check();
  await demo.getByRole('switch',{name:'export_enabled',exact:true}).click();
  assert.equal(await demo.getByRole('switch',{name:'export_enabled',exact:true}).getAttribute('aria-checked'),'false');
  await demo.getByLabel('Unlimited seat_max',{exact:true}).check();
  assert.equal(await demo.getByLabel('seat_max',{exact:true}).inputValue(),'∞');
  assert.equal(await demo.getByLabel('seat_max',{exact:true}).isDisabled(),true);
  await demo.getByLabel('Unlimited seat_max',{exact:true}).uncheck();
  await demo.getByLabel('seat_max',{exact:true}).fill('-5');
  assert.equal(await demo.getByLabel('seat_max',{exact:true}).getAttribute('aria-invalid'),'true');
  await demo.getByLabel('seat_max',{exact:true}).fill('25');
  assert.equal(await demo.getByRole('switch',{name:'mcp_enabled',exact:true}).isDisabled(),true);
  await demo.getByRole('button',{name:'Organization',exact:true}).click();
  const results=demo.getByRole('region',{name:'Resolved values'});
  assert.match(await results.innerText(),/40/);
  await demo.getByLabel('seat_max',{exact:true}).fill('60');
  assert.match(await results.innerText(),/60/);
  await demo.getByLabel('Override seat_max',{exact:true}).uncheck();
  assert.match(await results.innerText(),/25/);
  await demo.getByLabel('Globex tier').selectOption('enterprise');
  assert.match(await results.innerText(),/∞ Unlimited/);
  await demo.getByRole('button',{name:'Reset demo'}).click();
  assert.match(await results.innerText(),/40/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`overflow at ${width}`);
  assert.deepEqual(errors,[]);
  await page.screenshot({path:`/tmp/oe-landing-demo-${width}.png`,fullPage:true});
  await page.close();
 }
 console.log('Landing demo: desktop/mobile controls, validation, inheritance, environment restriction and reset passed.');
}finally{await browser.close();}

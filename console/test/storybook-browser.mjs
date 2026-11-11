/** Run compiled component stories and their play functions in Chromium. */
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {chromium} from 'playwright';
import {assertFormLayout} from './form-layout.mjs';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'../build/storybook');
const server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!path.startsWith(root+sep))throw new Error();const file=path.endsWith(sep)?path+'index.html':path;const body=await readFile(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[extname(file)]??'application/octet-stream');res.end(body);}catch{res.writeHead(404).end();}});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
try{browser=await chromium.launch();const page=await browser.newPage();const failures=[];page.on('pageerror',e=>failures.push(e.message));
 for(const story of ['finite','unlimited','invalid-negative','boolean-access','required-enum','inheritance','environment-override','frozen-default']){
  await page.goto(`${origin}/iframe.html?id=catalog-typed-value--${story}&viewMode=story`);
  await page.locator('#storybook-root').locator('input,select,button').first().waitFor();
  if(story==='unlimited')await page.waitForFunction(()=>!document.querySelector('input[aria-label="max_exports"]').disabled);
  if(story==='invalid-negative')assert.match(await page.getByRole('alert').innerText(),/0 or greater/);
  if(story==='environment-override'){assert.equal(await page.getByRole('switch').isDisabled(),true);assert.match(await page.getByRole('note').innerText(),/MCP_INSTALLED=False/);}
  if(story==='boolean-access')await page.getByRole('switch',{checked:true}).waitFor();
  assert.equal(await page.locator('#error-stack').isVisible(),false,`Story ${story} must render without errors`);
 }
 for(const story of ['grouped-and-tagged','authoring','nested-groups']){await page.goto(`${origin}/iframe.html?id=privilege-catalog--${story}&viewMode=story`);await page.getByLabel('Filter by tag').waitFor();assert.equal(await page.getByText('Internal privilege',{exact:true}).count(),0);if(story==='grouped-and-tagged')await page.waitForFunction(()=>document.querySelector('select')?.value==='integration');}
 await page.waitForFunction(()=>document.querySelector('select')?.value==='enterprise');
 await page.getByText('MCP access',{exact:true}).waitFor();
 assert.equal(await page.getByText('Reports',{exact:true}).count(),0);
 assert.equal(await page.getByText('Scheduled exports',{exact:true}).count(),0);
 assert.equal(await page.locator('#error-stack').isVisible(),false);
 for(const width of [1280,390,360]){
  await page.setViewportSize({width,height:900});
  for(const story of ['key-from-title','negative-integer','enum-choices','overlong-pasted-choice','boolean-for-administrator']){
   await page.goto(`${origin}/iframe.html?id=privilege-catalog-privilege-form--${story}&viewMode=story`);
   await page.locator('#storybook-root[data-play-complete="true"]').waitFor({timeout:20000}).catch(()=>{throw new Error(`Story privilege-form--${story} did not finish its play function at ${width}px`);});
   await assertFormLayout(page);
  }
  await page.goto(`${origin}/iframe.html?id=privilege-catalog--one-form-at-a-time&viewMode=story`);
  await page.locator('#storybook-root[data-play-complete="true"]').waitFor({timeout:20000}).catch(()=>{throw new Error(`Story privilege-catalog--one-form-at-a-time did not finish at ${width}px`);});
  for(const story of ['folders-and-new-groups','long-name-collisions','save-failure']){
   await page.goto(`${origin}/iframe.html?id=catalog-group-picker--${story}&viewMode=story`);
   await page.locator('#storybook-root[data-play-complete="true"]').waitFor({timeout:20000}).catch(()=>{throw new Error(`Story group-picker--${story} did not finish its play function at ${width}px`);});
   await assertFormLayout(page);
  }
  await page.goto(`${origin}/iframe.html?id=workspace-switcher--switch-and-create&viewMode=story`);
  await page.locator('#storybook-root[data-play-complete="true"]').waitFor({timeout:20000}).catch(()=>{throw new Error(`Story workspace-switcher--switch-and-create did not finish at ${width}px`);});
  await page.goto(`${origin}/iframe.html?id=workspace-switcher--long-name&viewMode=story`);
  await page.locator('#storybook-root[data-play-complete="true"]').waitFor({timeout:20000});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`A long workspace name widens the page at ${width}px`);
 }
 await page.setViewportSize({width:1280,height:720});
 for(const story of ['personal-allowance','cloud-pro']){await page.goto(`${origin}/iframe.html?id=organizations-user-entitlements--${story}&viewMode=story`);await page.getByRole('heading',{name:'User entitlements',exact:true}).waitFor();if(story==='personal-allowance'){try{await page.getByRole('row',{name:/AI tokens.*2050.*SUBJECT_GRANT/}).waitFor({timeout:10000});}catch(e){console.error(await page.locator('body').innerText());throw e;}}else await page.getByRole('note').waitFor();assert.equal(await page.locator('#error-stack').isVisible(),false);}
 for(const story of ['inline-labels','save-failure']){await page.goto(`${origin}/iframe.html?id=catalog-privilege-tags--${story}&viewMode=story`);if(story==='inline-labels'){await page.getByRole('button',{name:'Remove tag Operations'}).waitFor();await page.waitForFunction(()=>!document.querySelector('details').open);}else{await page.getByRole('alert').waitFor();}assert.equal(await page.locator('#error-stack').isVisible(),false);}
 assert.deepEqual(failures,[]);console.log('Compiled Storybook stories rendered successfully in Chromium');
}finally{await browser?.close();await new Promise(ok=>server.close(ok));}

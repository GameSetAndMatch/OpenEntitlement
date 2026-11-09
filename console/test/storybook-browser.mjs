/** Run compiled component stories and their play functions in Chromium. */
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {chromium} from 'playwright';
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
  if(story==='environment-override'){assert.equal(await page.getByLabel('max_exports',{exact:true}).isDisabled(),true);assert.match(await page.getByRole('note').innerText(),/MAX_EXPORTS=7/);}
  if(story==='boolean-access')await page.getByRole('switch',{checked:true}).waitFor();
  assert.equal(await page.locator('#error-stack').isVisible(),false,`Story ${story} must render without errors`);
 }
 assert.deepEqual(failures,[]);console.log('Eight compiled Storybook stories rendered successfully in Chromium');
}finally{await browser?.close();await new Promise(ok=>server.close(ok));}

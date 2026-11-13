/** The console against the Python service: real OIDC sign-in, Workspace creation, switcher, Product selector, sign-out. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import {resolve} from 'node:path';
import pg from 'pg';
import {chromium} from 'playwright';
import {startDevIssuer} from '../dev/issuer.ts';
if(!process.env.OE_PG_DSN)throw new Error('OE_PG_DSN is required; this test creates its own disposable database');
const root=resolve(import.meta.dirname,'../..');
async function port(){const s=createServer();await new Promise(ok=>s.listen(0,'127.0.0.1',ok));const p=s.address().port;await new Promise(ok=>s.close(ok));return p;}
const admin=new pg.Client({connectionString:process.env.OE_PG_DSN});await admin.connect();
const name='oe_python_browser_'+randomBytes(8).toString('hex');
let browser,issuer,service,database=false;const logs=[];
try{
 await admin.query(`CREATE DATABASE ${name}`);database=true;
 const url=new URL(process.env.OE_PG_DSN);url.pathname='/'+name;
 const appPort=await port(),app=`http://localhost:${appPort}`;issuer=await startDevIssuer(await port(),app);
 service=spawn('uv',['run','--project',resolve(root,'sdk-python'),'--locked','openentitlement-service'],{cwd:root,env:{...process.env,DATABASE_URL:url.href,PORT:String(appPort),OE_HOST:'127.0.0.1',OE_APP_URL:app,OE_OIDC_ISSUER:issuer.url,OE_OIDC_LOCAL_HTTP:'true',OE_PLATFORM_ADMIN_SUBJECT:'local-admin',OE_CONSOLE_DIR:resolve(root,'console/web/dist')}});
 service.stdout.on('data',d=>logs.push(String(d)));service.stderr.on('data',d=>logs.push(String(d)));
 const exited=new Promise(ok=>service.once('exit',ok));
 for(let i=0;;i++){
  if(service.exitCode!==null)throw new Error('The Python service exited');
  try{if((await fetch(app+'/healthz')).ok)break;}catch{/* starting */}
  if(i>120)throw new Error('The Python service did not start');await new Promise(ok=>setTimeout(ok,500));
 }
 void exited;
 browser=await chromium.launch();
 const pageErrors=[];
 async function signIn(identity){const context=await browser.newContext();const p=await context.newPage();p.setDefaultTimeout(10000);p.on('pageerror',e=>pageErrors.push(e.message));
  await p.goto(app+'/app/');await p.getByRole('link',{name:'Sign in',exact:true}).click();await p.locator('[name=login]').fill(identity);await p.locator('[name=password]').fill('local');await p.getByRole('button',{name:/sign.in/i}).click();if(p.url().includes('interaction'))await p.getByRole('button',{name:/continue/i}).click();
  await p.getByRole('heading',{name:'Create a workspace',exact:true}).waitFor();return p;}
 async function csrfHeaders(p){const session=await (await p.request.get(app+'/api/session')).json();return {origin:app,'x-oe-csrf':session.csrf};}

 // Sign in, create a Workspace: it starts with one Product, so there is no Product selector.
 const page=await signIn('local-admin');
 await page.getByLabel('Workspace name').fill('Acme product');await page.locator('form.workspace-create').getByRole('button',{name:'Create workspace'}).click();
 await page.getByRole('heading',{name:'Privilege Catalog',exact:true}).waitFor();
 const workspaceId=await page.evaluate(()=>localStorage.getItem('oe.workspace'));assert.ok(workspaceId);
 const workspace=await (await page.request.get(app+`/api/workspaces/${workspaceId}`)).json();
 assert.deepEqual(workspace.products.map(p=>[p.key,p.name,p.role]),[['acme_product','Acme product','Owner']]);
 assert.equal(await page.getByRole('combobox',{name:'Product'}).count(),0,'One Product: no selector');

 // The console reopens the last Workspace; the switcher lists it.
 await page.reload();const switcher=page.getByRole('button',{name:'Workspace: Acme product',exact:true});await switcher.waitFor();
 await switcher.click();const menu=page.getByRole('menu',{name:'Workspaces'});assert.equal(await menu.getByRole('menuitemradio',{name:/Acme product/}).getAttribute('aria-checked'),'true');await page.keyboard.press('Escape');

 // A second Product shows the selector; the choice is remembered per Workspace.
 const created=await page.request.post(app+`/api/workspaces/${workspaceId}/products`,{headers:await csrfHeaders(page),data:{key:'storage',name:'Storage'}});assert.equal(created.status(),201);
 await page.reload();const selector=page.getByRole('combobox',{name:'Product'});await selector.waitFor();
 assert.deepEqual(await selector.locator('option').allInnerTexts(),['Acme product','Storage']);
 await selector.selectOption({label:'Storage'});await page.reload();assert.equal(await page.getByRole('combobox',{name:'Product'}).locator('option:checked').innerText(),'Storage');

 // A change without the CSRF token is refused as a Problem Details response.
 const refused=await page.request.post(app+'/api/workspaces',{headers:{origin:app},data:{name:'No token'}});assert.equal(refused.status(),403);assert.equal((await refused.json()).type,'https://openentitlement.dev/problems/csrf-rejected');

 // Another Account cannot see the Workspace, and creates its own.
 const userPage=await signIn('local-user');
 assert.equal((await userPage.request.get(app+`/api/workspaces/${workspaceId}`)).status(),404);
 await userPage.getByLabel('Workspace name').fill('Another business');await userPage.locator('form.workspace-create').getByRole('button',{name:'Create workspace'}).click();
 const own=userPage.getByRole('button',{name:'Workspace: Another business',exact:true});await own.waitFor();await own.click();
 assert.equal(await userPage.getByRole('menuitemradio',{name:/Acme product/}).count(),0);await userPage.keyboard.press('Escape');
 assert.equal(await userPage.getByRole('combobox',{name:'Product'}).count(),0);

 // The Platform administrator sees every Workspace in the switcher.
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.reload();await page.getByRole('button',{name:'Workspace: Acme product',exact:true}).click();
 await page.getByRole('menuitemradio',{name:/Another business/}).waitFor();await page.keyboard.press('Escape');

 // Sign out returns to the sign-in page, and the session no longer works.
 await userPage.getByRole('button',{name:'Sign out',exact:true}).click();await userPage.getByRole('link',{name:'Sign in',exact:true}).waitFor();
 assert.equal((await userPage.request.get(app+'/api/session')).status(),401);
 assert.deepEqual(pageErrors,[]);
 console.log('Python service browser regression passed');
}catch(e){console.error(logs.join(''));throw e;}
finally{await browser?.close();if(service&&service.exitCode===null){service.kill('SIGTERM');await new Promise(ok=>service.once('exit',ok));}await issuer?.close();if(database)await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);await admin.end();}

/** The console against the Python service: real OIDC sign-in, Workspace creation, switcher, Product selector, sign-out. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import {resolve} from 'node:path';
import pg from 'pg';
import {chromium} from 'playwright';
import {startDevIssuer} from '../dev/issuer.ts';
import {assertFormLayout} from './form-layout.mjs';
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

 // Catalog: inline nested Groups, a Tag, strict integer values, and a record edit.
 await page.getByRole('button',{name:'Define privilege',exact:true}).click();
 await page.getByLabel('Title',{exact:true}).fill('Seats');
 await page.getByLabel('Value type').selectOption('integer');
 await page.getByLabel('seats',{exact:true}).fill('5');
 await page.locator('details.group-picker > summary').click();
 await page.getByRole('button',{name:'+ New group',exact:true}).click();
 await page.getByLabel('Name of the new group').fill('Product');
 await page.getByLabel('Name of the new group').press('Enter');
 await page.locator('details.group-picker > summary',{hasText:'Product'}).waitFor();
 await page.locator('details.group-picker > summary').click();
 await page.getByRole('button',{name:'New group inside Product',exact:true}).click();
 await page.getByLabel('Name of the new group inside Product').fill('Limits');
 await page.getByLabel('Name of the new group inside Product').press('Enter');
 await page.locator('details.group-picker > summary',{hasText:'Product › Limits'}).waitFor();
 await page.getByText('Add tags',{exact:true}).click();
 await page.getByLabel('Find or add a tag').fill('Enterprise');
 await page.getByRole('button',{name:'Add “Enterprise”',exact:true}).click();
 await page.getByRole('button',{name:'Remove tag Enterprise',exact:true}).waitFor();
 await page.getByRole('button',{name:'Save privilege',exact:true}).click();
 await page.getByRole('button',{name:'Edit Seats',exact:true}).waitFor();
 await page.reload();await page.getByRole('button',{name:'Edit Seats',exact:true}).click();
 await page.getByLabel('seats',{exact:true}).fill('10');
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await page.getByRole('button',{name:'Edit Seats',exact:true}).waitFor();
 const catalogPath=app+`/api/workspaces/${workspaceId}/products/${workspace.products[0].id}/catalog`;
 const catalog=(await (await page.request.get(catalogPath)).json());
 assert.equal(catalog.catalog.privileges[0].default,10);
 assert.equal(catalog.catalog.privileges[0].groupId,'limits');
 assert.deepEqual(catalog.catalog.privileges[0].tags,['enterprise']);
 assert.equal(catalog.catalog.groups.find(g=>g.id==='limits').parentId,'product');
 assert.equal(catalog.catalog.tags[0].id,'enterprise');assert.equal(catalog.versions.privileges.seats,2);

 // Inline metadata saves must not replace the version of an open Privilege draft.
 await page.getByRole('button',{name:'Edit Seats',exact:true}).click();
 const concurrent=await page.request.put(catalogPath,{headers:await csrfHeaders(page),data:{kind:'privileges',entry:{...catalog.catalog.privileges[0],default:11},version:2}});
 assert.equal(concurrent.status(),200);
 await page.getByText('Add tags',{exact:true}).click();
 await page.getByLabel('Find or add a tag').fill('Concurrent test');
 await page.getByRole('button',{name:'Add “Concurrent test”',exact:true}).click();
 await page.getByRole('button',{name:'Remove tag Concurrent test',exact:true}).waitFor();
 await page.getByLabel('seats',{exact:true}).fill('12');
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'changed elsewhere'}).waitFor();
 assert.equal((await (await page.request.get(catalogPath)).json()).catalog.privileges[0].default,11);
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.getByRole('button',{name:'Refresh workspace',exact:true}).click();
 await page.getByRole('button',{name:'Edit Seats',exact:true}).waitFor();

 // Tiers: the guided creation saves the Tier with its standard variant in one request, then offers a trial and a grace period.
 const productPath=app+`/api/workspaces/${workspaceId}/products/${workspace.products[0].id}`;
 const tierRequests=[];page.on('request',r=>{if(r.url().startsWith(productPath+'/tiers')&&r.method()!=='GET')tierRequests.push(`${r.method()} ${r.url().slice(productPath.length)}`);});
 await page.getByRole('link',{name:'Tiers',exact:true}).click();
 await page.getByRole('heading',{name:'Create your first tier',exact:true}).waitFor();
 await page.getByRole('button',{name:'Create tier',exact:true}).click();
 await page.getByLabel('Name',{exact:true}).fill('Pro');assert.equal(await page.getByLabel('ID',{exact:true}).inputValue(),'pro');
 await page.getByLabel('Override seats').check();await page.getByLabel('seats',{exact:true}).fill('20');
 await page.getByRole('button',{name:'Review tier',exact:true}).click();
 const review=page.getByRole('region',{name:'Review Pro'});assert.match(await review.getByRole('row').filter({hasText:'seats'}).innerText(),/20\s+Set for this tier/);
 await review.getByRole('button',{name:'Create tier',exact:true}).click();
 const ready=page.getByRole('region',{name:'Pro is ready'});await ready.waitFor();
 assert.deepEqual(tierRequests,['POST /tiers'],'One request creates the Tier and its standard variant');
 await ready.getByRole('button',{name:'Add a free trial',exact:true}).click();assert.equal(await page.getByLabel('Name',{exact:true}).inputValue(),'Pro trial');
 await page.getByRole('button',{name:'Save variant',exact:true}).click();await ready.getByText('Added: Pro trial').waitFor();
 await ready.getByRole('button',{name:'Add a grace period',exact:true}).click();assert.equal(await page.getByLabel('Purpose').inputValue(),'grace');
 await page.getByLabel('Grace period (days)').fill('5');await page.getByRole('button',{name:'Save variant',exact:true}).click();
 await ready.getByText('Added: Pro grace period · 5 days').waitFor();await ready.getByRole('button',{name:'Done',exact:true}).click();
 const proPanel=page.locator('.tier-panel').filter({has:page.getByRole('heading',{name:'Pro',exact:true})});
 await proPanel.getByText('Pro standard',{exact:true}).waitFor();await proPanel.getByText('5 days of past-due grace',{exact:true}).waitFor();
 // Grace days and rank are edited on the Tier; each save names the version it was made from.
 await proPanel.getByRole('button',{name:'Edit tier',exact:true}).click();assert.equal(await page.getByLabel('Rank').inputValue(),'0');
 await page.getByLabel('Past-due grace period').fill('3');await page.getByRole('button',{name:'Save tier',exact:true}).click();
 await proPanel.getByText('3 days of past-due grace',{exact:true}).waitFor();
 let tiersView=await (await page.request.get(productPath+'/tiers')).json();
 assert.deepEqual(tiersView.tiers.map(t=>[t.id,t.gracePeriodDays,t.version]),[['pro',3,3]]);
 assert.deepEqual(tiersView.variants.map(v=>[v.id,v.kind,v.values]),[['pro_grace_period','grace',{}],['pro_standard','standard',{seats:20}],['pro_trial','trial',{}]]);
 // The status policy is per Product and lives beside its Tiers.
 const policy=page.getByRole('region',{name:'When a contract lapses'});
 await policy.getByLabel('Contract ended').selectOption({label:'Fallback to Pro standard'});await policy.getByRole('button',{name:'Save status policy',exact:true}).click();
 await policy.getByRole('button',{name:'Save status policy',exact:true}).waitFor({state:'hidden'});
 tiersView=await (await page.request.get(productPath+'/tiers')).json();
 assert.deepEqual(tiersView.policy,{pastDue:{action:'readOnly'},ended:{action:'fallback',variantId:'pro_standard'}});
 // Archive and restore from the Tier's edit form; an archived Tier keeps its variants.
 await proPanel.getByRole('button',{name:'Edit tier',exact:true}).click();await assertFormLayout(page);await page.getByRole('button',{name:'Archive tier',exact:true}).click();
 await proPanel.getByText(/^Archived/).waitFor();
 tiersView=await (await page.request.get(productPath+'/tiers')).json();assert.ok(tiersView.tiers[0].archivedAt);assert.equal(tiersView.variants.length,3);
 // An archived Tier is not offered as a new fallback; the one the policy already uses stays listed.
 assert.deepEqual(await policy.getByLabel('Past due, after grace').locator('option').allInnerTexts(),['Read-only']);
 assert.deepEqual(await policy.getByLabel('Contract ended').locator('option').allInnerTexts(),['Read-only','Fallback to Pro standard']);
 await proPanel.getByRole('button',{name:'Edit tier',exact:true}).click();await page.getByRole('button',{name:'Restore tier',exact:true}).click();
 await proPanel.getByText(/^Archived/).waitFor({state:'hidden'});
 // The status policy falls back to one of its variants, so it cannot be deleted.
 await proPanel.getByRole('button',{name:'Edit tier',exact:true}).click();await page.getByRole('button',{name:'Delete tier',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'The status policy falls back to pro_standard'}).waitFor();
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 // The Catalog sees the new variants: a Privilege without a default asks for a value in each.
 await page.getByRole('link',{name:'Privilege Catalog',exact:true}).click();await page.getByRole('button',{name:'Edit Seats',exact:true}).waitFor();
 assert.deepEqual((await (await page.request.get(catalogPath)).json()).variants.map(v=>v.tierId),['pro','pro','pro']);

 // Organizations: Workspace-wide, with one Tier variant per Product and Organization terms that need a reason.
 const organizationsPath=app+`/api/workspaces/${workspaceId}/organizations`;
 async function reason(){const dialog=page.getByRole('dialog');await dialog.getByRole('textbox').fill('Signed contract');await dialog.getByRole('button',{name:'Confirm',exact:true}).click();await dialog.waitFor({state:'hidden'});}
 const saveOrganization=page.getByRole('button',{name:'Save organization',exact:true});
 await page.getByRole('link',{name:'Organizations',exact:true}).click();
 await page.getByRole('heading',{name:'Add your first customer',exact:true}).waitFor();
 await page.getByRole('button',{name:'Add organization',exact:true}).click();await assertFormLayout(page);
 await page.getByLabel('Name',{exact:true}).fill('Acme');assert.equal(await page.getByLabel('ID',{exact:true}).inputValue(),'acme');
 assert.deepEqual(await page.getByLabel('Tier variant').locator('option').allInnerTexts(),['Pro standard','Pro trial'],'Grace variants are not given');
 await page.getByLabel('Override seats').check();await page.getByLabel('seats',{exact:true}).fill('25');
 await saveOrganization.click();await reason();await saveOrganization.waitFor({state:'hidden'});
 const acmeCard=page.locator('.workspace-card').filter({hasText:'Acme'});await acmeCard.getByText('Pro standard · Active').waitFor();
 await acmeCard.click();
 // The SDK resolved the values; each names its source in glossary terms.
 assert.match(await page.getByRole('row').filter({hasText:'Seats'}).innerText(),/25\s+Organization terms\s+Standard/);
 let organizationsView=(await (await page.request.get(organizationsPath)).json()).organizations;
 assert.deepEqual(organizationsView.map(o=>[o.id,o.products[0].variantId,o.products[0].terms]),[['acme','pro_standard',{seats:25}]]);
 // Changing the variant clears the terms; switching back before saving keeps them.
 await page.getByRole('button',{name:'Edit organization',exact:true}).click();
 await page.getByLabel('Tier variant').selectOption({label:'Pro trial'});assert.equal(await page.getByLabel('Override seats').isChecked(),false);
 await page.getByLabel('Tier variant').selectOption({label:'Pro standard'});assert.equal(await page.getByLabel('seats',{exact:true}).inputValue(),'25');
 // A contract status change alone saves without a reason.
 await page.getByLabel('Contract status').selectOption('ended');
 await saveOrganization.click();await saveOrganization.waitFor({state:'hidden'});assert.equal(await page.getByRole('dialog').count(),0);
 await acmeCard.getByText('Pro standard · Ended').waitFor();
 // The ended contract falls back to Pro standard (the status policy), without the Organization terms.
 assert.match(await page.getByRole('row').filter({hasText:'Seats'}).innerText(),/20\s+Pro standard\s+Standard/);
 // The Tier is in use: it cannot be deleted.
 await page.getByRole('link',{name:'Tiers',exact:true}).click();
 await proPanel.getByRole('button',{name:'Edit tier',exact:true}).click();await page.getByRole('button',{name:'Delete tier',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'Customers use this Tier'}).waitFor();
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 // Once Pro is archived, Acme keeps Pro standard, and no other Pro variant is offered.
 await proPanel.getByRole('button',{name:'Edit tier',exact:true}).click();await page.getByRole('button',{name:'Archive tier',exact:true}).click();
 await proPanel.getByText(/^Archived/).waitFor();
 await page.getByRole('link',{name:'Organizations',exact:true}).click();await acmeCard.click();
 await page.getByRole('button',{name:'Edit organization',exact:true}).click();
 assert.deepEqual(await page.getByLabel('Tier variant').locator('option').allInnerTexts(),['Pro standard']);
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.getByRole('link',{name:'Tiers',exact:true}).click();
 await proPanel.getByRole('button',{name:'Edit tier',exact:true}).click();await page.getByRole('button',{name:'Restore tier',exact:true}).click();
 await proPanel.getByText(/^Archived/).waitFor({state:'hidden'});
 organizationsView=(await (await page.request.get(organizationsPath)).json()).organizations;
 assert.deepEqual(organizationsView[0].products[0].values.find(v=>v.privilege==='seats'),{privilege:'seats',value:20,source:'variant',sourceName:'Pro standard',error:null});
 await page.getByRole('link',{name:'Privilege Catalog',exact:true}).click();await page.getByRole('button',{name:'Edit Seats',exact:true}).waitFor();

 // The console reopens the last Workspace; the switcher lists it.
 await page.reload();const switcher=page.getByRole('button',{name:'Workspace: Acme product',exact:true});await switcher.waitFor();
 await switcher.click();const menu=page.getByRole('menu',{name:'Workspaces'});assert.equal(await menu.getByRole('menuitemradio',{name:/Acme product/}).getAttribute('aria-checked'),'true');await page.keyboard.press('Escape');

 // A second Product shows the selector; the choice is remembered per Workspace.
 const created=await page.request.post(app+`/api/workspaces/${workspaceId}/products`,{headers:await csrfHeaders(page),data:{key:'storage',name:'Storage'}});assert.equal(created.status(),201);
 await page.reload();const selector=page.getByRole('combobox',{name:'Product'});await selector.waitFor();
 assert.deepEqual(await selector.locator('option').allInnerTexts(),['Acme product','Storage']);
 await selector.selectOption({label:'Storage'});await page.getByRole('heading',{name:'Define your first privilege',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Edit Seats',exact:true}).count(),0);await page.reload();await page.getByRole('combobox',{name:'Product'}).waitFor();await page.waitForFunction(()=>document.querySelector('.product-selector select option:checked')?.textContent==='Storage');
 // Organizations are Workspace-wide: Storage has no Tiers, yet Acme is listed there and can be renamed.
 await page.getByRole('link',{name:'Organizations',exact:true}).click();
 const storageCard=page.locator('.workspace-card').filter({hasText:'Acme'});await storageCard.getByText('No tier in this Product').waitFor();
 await storageCard.click();await page.getByRole('button',{name:'Edit organization',exact:true}).click();
 assert.equal(await page.getByLabel('Tier variant').count(),0,'No variant to give in a Product without Tiers');
 await page.getByLabel('Name',{exact:true}).fill('Acme Corp');await saveOrganization.click();await saveOrganization.waitFor({state:'hidden'});
 await page.locator('.workspace-card').filter({hasText:'Acme Corp'}).waitFor();
 organizationsView=(await (await page.request.get(organizationsPath)).json()).organizations;
 assert.deepEqual(organizationsView.map(o=>[o.name,o.version,o.products.length]),[['Acme Corp',2,1]]);
 await page.getByRole('link',{name:'Privilege Catalog',exact:true}).click();

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

/** The console against the Python service: real OIDC sign-in, Workspace creation, switcher, Product selector, Catalog, Tiers, Organizations, application users, Settings (Members, invitations, Cloud service tier), sign-out. */
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
 service=spawn('uv',['run','--project',resolve(root,'sdk-python'),'--locked','openentitlement-service'],{cwd:root,env:{...process.env,DATABASE_URL:url.href,PORT:String(appPort),OE_HOST:'127.0.0.1',OE_APP_URL:app,OE_OIDC_ISSUER:issuer.url,OE_OIDC_LOCAL_HTTP:'true',OE_PLATFORM_ADMIN_SUBJECT:'local-admin',OE_DEPLOYMENT_MODE:'saas',OE_CONSOLE_DIR:resolve(root,'console/web/dist')}});
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
 // Requiring a value asks for every existing variant's value in the same save, each sent with that variant's version.
 await page.getByRole('button',{name:'Define privilege',exact:true}).click();
 await page.getByLabel('Title',{exact:true}).fill('Projects');await page.getByLabel('Value type').selectOption('integer');
 await page.getByRole('checkbox',{name:'Require a value in every Tier variant'}).check();
 await page.getByText('3 variants need a value. One value applies to every variant unless you set each one.',{exact:true}).waitFor();
 await page.getByRole('spinbutton',{name:'Value for every variant'}).fill('3');
 await page.getByRole('checkbox',{name:'Set per variant'}).check();await page.getByRole('spinbutton',{name:'Value for Pro trial'}).fill('1');
 await page.getByRole('button',{name:'Save privilege',exact:true}).click();await page.getByRole('button',{name:'Edit Projects',exact:true}).waitFor();
 assert.deepEqual(Object.fromEntries((await (await page.request.get(productPath+'/tiers')).json()).variants.map(v=>[v.id,v.values.projects])),{pro_grace_period:3,pro_standard:3,pro_trial:1});

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
 // Cloud Pro has Organization entitlements only: no application users.
 await page.getByText('User entitlements require Cloud Enterprise.',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Add user',exact:true}).count(),0);
 let organizationsView=(await (await page.request.get(organizationsPath)).json()).organizations;
 assert.deepEqual(organizationsView.map(o=>[o.id,o.products[0].variantId,o.products[0].terms]),[['acme','pro_standard',{seats:25}]]);
 // Changing the variant clears the terms; switching back before saving keeps them.
 await page.getByRole('button',{name:'Edit organization',exact:true}).click();
 await page.getByLabel('Tier variant').selectOption({label:'Pro trial'});assert.equal(await page.getByLabel('Override seats').isChecked(),false);await page.getByText('Saving clears 1 term: Seats',{exact:true}).waitFor();
 await page.getByLabel('Tier variant').selectOption({label:'Pro standard'});assert.equal(await page.getByLabel('seats',{exact:true}).inputValue(),'25');assert.equal(await page.getByText(/^Saving clears/).count(),0);
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

 // Cloud Pro allows one Product; the Platform administrator moves the Workspace to Enterprise in Settings › Service.
 const tooMany=await page.request.post(app+`/api/workspaces/${workspaceId}/products`,{headers:await csrfHeaders(page),data:{key:'storage',name:'Storage'}});
 assert.equal(tooMany.status(),409);assert.equal((await tooMany.json()).type,'https://openentitlement.dev/problems/product-limit');
 // The real audit API supplies readable snapshots and expandable before/after values.
 await page.goto(app+'/app/#settings/audit-log');
 await page.getByRole('heading',{name:'Audit log',exact:true,level:1}).waitFor();
 await page.locator('article details summary').first().click();
 await page.locator('article details[open] dd').first().waitFor();
 assert.match(await page.locator('article').first().innerText(), /@/);
 await page.goto(app+'/app/#settings/service');await page.getByRole('heading',{name:'Service',exact:true,level:1}).waitFor();
 const tier=page.getByLabel('Cloud service tier');assert.equal(await tier.inputValue(),'pro');
 await tier.selectOption('enterprise');await page.getByRole('button',{name:'Save Cloud service tier',exact:true}).click();
 await page.getByText('Changes saved',{exact:true}).waitFor();await page.getByRole('button',{name:'Save Cloud service tier',exact:true}).waitFor({state:'hidden'});
 assert.equal(await page.getByLabel('Cloud service tier').inputValue(),'enterprise');
 assert.equal((await (await page.request.get(app+`/api/workspaces/${workspaceId}`)).json()).hosting.tier,'enterprise');
 await page.getByRole('link',{name:'Back to workspace'}).click();await page.getByRole('heading',{name:'Privilege Catalog',exact:true,level:1}).waitFor();

 // Application users on Cloud Enterprise: Personal terms and Grants, resolved by the SDK, each change with a reason.
 await page.getByRole('link',{name:'Organizations',exact:true}).click();await acmeCard.click();
 await page.getByRole('button',{name:'Edit organization',exact:true}).click();await page.getByLabel('Contract status').selectOption('active');
 await saveOrganization.click();await saveOrganization.waitFor({state:'hidden'});await acmeCard.getByText('Pro standard · Active').waitFor();
 const saveUser=page.getByRole('button',{name:'Save user entitlements',exact:true});
 await page.getByRole('button',{name:'Add user',exact:true}).click();await assertFormLayout(page);
 await page.getByLabel('User display name').fill('Alice');await page.getByLabel('Subject ID').fill('idp|alice');
 await page.getByLabel('Grant seats',{exact:true}).check();await page.getByLabel('grant_seats',{exact:true}).fill('5');
 await saveUser.click();await reason();await saveUser.waitFor({state:'hidden'});
 await page.locator('.workspace-card').filter({hasText:'Alice'}).click();
 const aliceSeats=page.getByRole('row').filter({hasText:'Seats'}).filter({hasText:'+ Grant 5'});
 assert.match(await aliceSeats.innerText(),/30\s+Organization terms 25 \+ Grant 5/);
 await page.getByRole('button',{name:'Edit user entitlements',exact:true}).click();
 await page.getByLabel('Override seats',{exact:true}).check();await page.getByLabel('seats',{exact:true}).fill('40');
 await saveUser.click();await reason();await saveUser.waitFor({state:'hidden'});
 await page.locator('.workspace-card').filter({hasText:'Alice'}).click();
 assert.match(await aliceSeats.innerText(),/45\s+Personal terms 40 \+ Grant 5/);
 organizationsView=(await (await page.request.get(organizationsPath)).json()).organizations;
 assert.deepEqual(organizationsView[0].products[0].users.map(u=>[u.subjectId,u.variantId,u.terms,u.grants,u.state]),[['idp|alice','pro_standard',{seats:40},{seats:5},'active']]);
 // The removal reason travels in the body, never in the address (ADR-0010 Q13).
 const removal=page.waitForRequest(r=>r.method()==='DELETE'&&r.url().includes('/users/'));
 await page.getByRole('button',{name:'Remove user exceptions',exact:true}).click();await reason();
 const removed=await removal;assert.doesNotMatch(removed.url(),/reason|Signed/);assert.deepEqual(removed.postDataJSON(),{reason:'Signed contract'});
 await page.getByText('No personal exceptions. Every user inherits the Organization’s values.').waitFor();
 const removalEntry=(await (await page.request.get(app+`/api/workspaces/${workspaceId}/audit`)).json()).entries[0];
 assert.deepEqual([removalEntry.targetKind,removalEntry.targetId,removalEntry.action,removalEntry.actorEmail,removalEntry.reason],['Application user','acme/idp|alice','removed','admin@example.test','Signed contract']);
 assert.deepEqual((await (await page.request.get(organizationsPath)).json()).organizations[0].products[0].users,[]);
 await page.getByRole('link',{name:'Privilege Catalog',exact:true}).click();await page.getByRole('button',{name:'Edit Seats',exact:true}).waitFor();

 // A second Product shows the selector; the choice is remembered per Workspace.
 const created=await page.request.post(app+`/api/workspaces/${workspaceId}/products`,{headers:await csrfHeaders(page),data:{key:'storage',name:'Storage'}});assert.equal(created.status(),201);
 await page.reload();const selector=page.getByRole('combobox',{name:'Product'});await selector.waitFor();
 assert.deepEqual(await selector.locator('option').allInnerTexts(),['Acme product','Storage']);
 // Switching Product with an unsaved Privilege draft asks first; keeping it stays on this Product with the draft.
 await page.getByRole('button',{name:'Edit Seats',exact:true}).click();await page.getByLabel('seats',{exact:true}).fill('13');
 await selector.selectOption({label:'Storage'});
 const discard=page.getByRole('dialog').filter({hasText:'Discard your changes?'});await discard.waitFor();
 await discard.getByRole('button',{name:'Keep editing',exact:true}).click();await discard.waitFor({state:'hidden'});
 assert.equal(await selector.locator('option:checked').innerText(),'Acme product');assert.equal(await page.getByLabel('seats',{exact:true}).inputValue(),'13');
 await selector.selectOption({label:'Storage'});await discard.getByRole('button',{name:'Discard',exact:true}).click();
await page.getByRole('heading',{name:'Define your first privilege',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Edit Seats',exact:true}).count(),0);await page.reload();await page.getByRole('combobox',{name:'Product'}).waitFor();await page.waitForFunction(()=>document.querySelector('.product-selector select option:checked')?.textContent==='Storage');
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
 // Settings → Configuration exports the selected Product only. Both Products define seats; a hidden Privilege never appears.
 const storageId=(await (await page.request.get(app+`/api/workspaces/${workspaceId}`)).json()).products.find(p=>p.key==='storage').id;
 const define=(path,entry)=>page.request.put(path,{headers:csrf,data:{kind:'privileges',entry:{description:'',tags:[],...entry},version:0}});
 const csrf=await csrfHeaders(page);
 assert.equal((await define(app+`/api/workspaces/${workspaceId}/products/${storageId}/catalog`,{key:'seats',title:'Seats',type:'integer',visibility:'editable',default:100})).status(),200);
 assert.equal((await define(catalogPath,{key:'internal_beta',title:'Internal beta',type:'boolean',visibility:'hidden',default:true})).status(),200);
 await page.getByRole('link',{name:'Settings',exact:true}).click();await page.getByRole('link',{name:'Configuration',exact:true}).click();
 const storageYaml=await page.getByLabel('Storage YAML',{exact:true}).innerText();
 assert.match(storageYaml,/key: storage\n/);assert.match(storageYaml,/default: 100\n/);assert.doesNotMatch(storageYaml,/pro_standard|default: 11\n/);
 await selector.selectOption({label:'Acme product'});
 const acmeYaml=await page.getByLabel('Acme product YAML',{exact:true}).innerText();
 assert.match(acmeYaml,/key: acme_product\n/);assert.match(acmeYaml,/pro_standard/);assert.match(acmeYaml,/id: acme\n/);assert.doesNotMatch(acmeYaml,/default: 100\n|internal_beta/);
 const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download YAML',exact:true}).click()]);
 assert.equal(download.suggestedFilename(),'acme_product.yaml');
 // Settings → API keys: a key for the selected Product, its secret shown once; it evaluates that Product only, until revoked.
 await page.getByRole('link',{name:'API keys',exact:true}).click();
 const keys=page.getByRole('region',{name:'API keys for Acme product'});await keys.waitFor();
 await keys.getByLabel('Key name').fill('Billing app');await keys.getByRole('button',{name:'Create API key',exact:true}).click();
 const secret=await page.getByLabel('Save this secret securely').inputValue();assert.match(secret,/^oek_/);
 await keys.getByText('Billing app',{exact:true}).waitFor();
 const evaluate=(product,key=secret)=>page.request.post(app+`/oerep/v1/products/${product}/privileges/resolve`,{headers:{authorization:`Bearer ${key}`},data:{context:{organizationId:'acme'}}});
 const evaluated=await evaluate('acme_product');assert.equal(evaluated.status(),200);
 assert.equal((await evaluated.json()).privileges.find(p=>p.privilege==='seats').value,25);
 assert.equal((await evaluate('storage')).status(),403,'A key evaluates its own Product only');
 await page.reload();await keys.getByText('Billing app',{exact:true}).waitFor();assert.equal(await page.getByLabel('Save this secret securely').count(),0,'The secret is shown once');
 await keys.getByRole('button',{name:'Revoke Billing app',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click();
 await keys.getByText('Billing app',{exact:true}).waitFor({state:'hidden'});
 assert.equal((await evaluate('acme_product')).status(),401,'A revoked key is refused');
 // A key name typed for one Product is discarded with it, not carried into the next Product.
 await keys.getByLabel('Key name').fill('Draft app');await selector.selectOption({label:'Storage'});
 await page.getByRole('dialog').filter({hasText:'Discard your changes?'}).getByRole('button',{name:'Discard',exact:true}).click();
 const storageKeys=page.getByRole('region',{name:'API keys for Storage'});await storageKeys.waitFor();assert.equal(await storageKeys.getByLabel('Key name').inputValue(),'');
 await selector.selectOption({label:'Acme product'});await keys.waitFor();
 // An invitation draft on Members asks before a Product switch discards it.
 await page.getByRole('link',{name:'Members',exact:true}).click();await page.getByLabel('Email address').fill('draft@example.test');
 const sidebarProduct=page.getByRole('combobox',{name:'Product',exact:true});
 await sidebarProduct.selectOption({label:'Storage'});
 const discardInvite=page.getByRole('dialog').filter({hasText:'Discard your changes?'});
 await discardInvite.getByRole('button',{name:'Keep editing',exact:true}).click();await discardInvite.waitFor({state:'hidden'});
 assert.equal(await sidebarProduct.locator('option:checked').innerText(),'Acme product');assert.equal(await page.getByLabel('Email address').inputValue(),'draft@example.test');
 await sidebarProduct.selectOption({label:'Storage'});await discardInvite.getByRole('button',{name:'Discard',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.product-selector select option:checked')?.textContent==='Storage');
 assert.equal(await page.getByLabel('Email address').inputValue(),'');await sidebarProduct.selectOption({label:'Acme product'});
 await page.getByRole('link',{name:'Back to workspace',exact:false}).click();await page.getByRole('button',{name:'Edit Seats',exact:true}).waitFor();

 // A change without the CSRF token is refused as a Problem Details response.
 const refused=await page.request.post(app+'/api/workspaces',{headers:{origin:app},data:{name:'No token'}});assert.equal(refused.status(),403);assert.equal((await refused.json()).type,'https://openentitlement.dev/problems/csrf-rejected');

 // Another Account cannot see the Workspace, and creates its own.
 const userPage=await signIn('local-user');
 assert.equal((await userPage.request.get(app+`/api/workspaces/${workspaceId}`)).status(),404);
 await userPage.getByLabel('Workspace name').fill('Another business');await userPage.locator('form.workspace-create').getByRole('button',{name:'Create workspace'}).click();
 const own=userPage.getByRole('button',{name:'Workspace: Another business',exact:true});await own.waitFor();await own.click();
 assert.equal(await userPage.getByRole('menuitemradio',{name:/Acme product/}).count(),0);await userPage.keyboard.press('Escape');
 assert.equal(await userPage.getByRole('combobox',{name:'Product'}).count(),0);

 // A downgrade is refused while the Workspace has two Products, naming them.
 await page.goto(app+'/app/#settings/service');await page.getByLabel('Cloud service tier').selectOption('pro');await page.getByRole('button',{name:'Save Cloud service tier',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'Acme product, Storage'}).waitFor();await page.getByRole('button',{name:'Cancel',exact:true}).click();

 // Members: the Owner invites the other Account as Manager of Storage with a single-use link.
 await page.getByRole('link',{name:'Members',exact:true}).click();await page.getByRole('heading',{name:'Members',exact:true,level:1}).waitFor();
 assert.equal(await page.getByLabel('Role for admin@example.test',{exact:true}).inputValue(),'Owner');
 await page.getByLabel('Email address').fill('user@example.test');await page.getByLabel('Role',{exact:true}).selectOption('Manager');await page.getByLabel('Invite to product').selectOption({label:'Storage'});
 await page.getByRole('button',{name:'Create invitation link',exact:true}).click();const inviteUrl=await page.getByLabel('Invitation link (expires in 7 days)').inputValue();
 assert.match(inviteUrl,new RegExp(`/app/#invite=${workspaceId}\\.`));
 await userPage.evaluate(url=>{location.hash=new URL(url).hash;},inviteUrl);await userPage.getByRole('button',{name:'Join workspace',exact:true}).click();
 await userPage.getByRole('heading',{name:'You have a workspace invitation'}).waitFor({state:'hidden'});await userPage.getByText('Workspace joined',{exact:true}).waitFor();
 assert.equal((await userPage.request.post(app+'/api/invitations/accept',{headers:await csrfHeaders(userPage),data:{token:inviteUrl.split('#invite=')[1]}})).status(),404,'An invitation link works once');
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));const userStorage=page.getByLabel('Role for user@example.test in Storage');await userStorage.waitFor();
 assert.equal(await userStorage.inputValue(),'Manager');assert.equal(await page.getByLabel('Role for user@example.test in Acme product').inputValue(),'');
 // The Manager sees the Owner and the members of Storage only, and changing their own Role refreshes their access.
 await userPage.goto(app+'/app/#settings/members');await userPage.getByRole('button',{name:'Workspace: Acme product',exact:true}).waitFor();
 await userPage.getByLabel('Role for user@example.test').waitFor();assert.equal(await userPage.getByLabel('Role for admin@example.test').count(),0);
 assert.deepEqual(await userPage.locator('.member-email').allInnerTexts(),['admin@example.test','user@example.test']);
 // As Storage's Manager, they administer Storage's API keys.
 await userPage.getByRole('link',{name:'API keys',exact:true}).click();await userPage.getByRole('region',{name:'API keys for Storage'}).waitFor();
 await userPage.getByRole('link',{name:'Members',exact:true}).click();
 await userPage.getByLabel('Role for user@example.test').selectOption('User');await userPage.getByText('Your role: User.',{exact:true}).waitFor();
 assert.equal(await userPage.getByRole('link',{name:'API keys',exact:true}).count(),0,'A User has no API keys page');
 assert.equal(await userPage.getByLabel('Email address').count(),0);
 // Layout: the Members and Service pages never overflow, and role selects are not clipped, down to phone width.
 for(const width of [1280,768,390]){await page.setViewportSize({width,height:900});
  for(const hash of ['members','service']){await page.goto(app+'/app/#settings/'+hash);await page.locator('.settings-page').waitFor();if(hash==='members')await page.getByLabel('Role for user@example.test in Storage').waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll('.settings-row')].every(r=>r.scrollWidth<=r.clientWidth+1&&r.getBoundingClientRect().right<=innerWidth)),true,`${hash} overflows at ${width}px`);
   assert.equal(await page.evaluate(()=>[...document.querySelectorAll('.settings-page select')].every(el=>el.scrollWidth<=el.clientWidth+1)),true,`A select on ${hash} is clipped at ${width}px`);}}
 await page.setViewportSize({width:1280,height:720});
 // Removing a member asks to confirm, without a reason; they lose access to the Workspace.
 await page.goto(app+'/app/#settings/members');await page.getByRole('button',{name:'Remove user@example.test',exact:true}).click();
 const dialog=page.getByRole('dialog');assert.equal(await dialog.getByRole('textbox').count(),0);await dialog.getByRole('button',{name:'Confirm',exact:true}).click();
 await page.getByRole('button',{name:'Remove user@example.test',exact:true}).waitFor({state:'hidden'});
 assert.equal((await userPage.request.get(app+`/api/workspaces/${workspaceId}`)).status(),404);
 await userPage.evaluate(()=>window.dispatchEvent(new Event('focus')));await userPage.getByRole('button',{name:'Workspace: Another business',exact:true}).waitFor();

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

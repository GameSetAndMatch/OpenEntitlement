import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { AuditEntries, AuditLog, type AuditPage } from './audit-log.tsx';
const meta={title:'Workspace/Audit log',component:AuditEntries} satisfies Meta<typeof AuditEntries>;
export default meta;
type Story=StoryObj<typeof meta>;
export const Changes:Story={args:{entries:[{id:'1',at:'2026-11-13T12:00:00Z',actorEmail:'alice@acme.test',action:'changed',targetKind:'Organization',targetName:'Acme',aspect:'terms',reason:'Renewal',changes:[{field:'terms.seats',title:'Seats',before:10,after:20}]}]},play:async({canvasElement})=>{const c=within(canvasElement);await userEvent.click(c.getByText('Show 1 change'));await expect(c.getByText('10 → 20')).toBeVisible();await expect(c.getByText(/alice@acme.test changed Organization/)).toBeVisible();canvasElement.dataset.playComplete='true';}};
export const French:Story={args:{...Changes.args,language:'fr'},play:async({canvasElement})=>{const c=within(canvasElement);await userEvent.click(c.getByText('Afficher 1 changement'));await expect(c.getByText('10 → 20')).toBeVisible();canvasElement.dataset.playComplete='true';}};
// A Tier variant is compared by its ID and shown by its name then; two variants may share a name.
const named=[
  {id:'2',at:'2026-11-13T12:05:00Z',actorEmail:'alice@acme.test',action:'revoked',targetKind:'API key',targetName:'Billing app',aspect:null,reason:null,changes:[]},
  {id:'1',at:'2026-11-13T12:00:00Z',actorEmail:'alice@acme.test',action:'changed',targetKind:'Organization',targetName:'Acme',aspect:'tier',reason:null,changes:[{field:'variant',before:'pro_standard',after:'basic_standard',beforeName:'Pro standard',afterName:'Pro standard'},{field:'terms.seats',title:'Seats',before:50,after:5}]},
];
export const VariantNamesAndApiKeys:Story={args:{entries:named},play:async({canvasElement})=>{const c=within(canvasElement);await expect(c.getByText(/alice@acme.test revoked API key Billing app/)).toBeVisible();await userEvent.click(c.getByText('Show 2 changes'));await expect(c.getByText('Pro standard → Pro standard')).toBeVisible();await expect(c.getByText('50 → 5')).toBeVisible();canvasElement.dataset.playComplete='true';}};
export const VariantNamesAndApiKeysFrench:Story={args:{entries:named,language:'fr'},play:async({canvasElement})=>{const c=within(canvasElement);await expect(c.getByText(/alice@acme.test a révoqué la clé API Billing app/)).toBeVisible();await userEvent.click(c.getByText('Afficher 2 changements'));await expect(c.getByText('Pro standard → Pro standard')).toBeVisible();canvasElement.dataset.playComplete='true';}};

// A focus refresh while "Load more" is pending wins: the older continuation is dropped, not appended.
const entry=(id:string,targetName:string)=>({id,at:'2026-11-13T12:00:00Z',actorEmail:'alice@acme.test',action:'created',targetKind:'Organization',targetName,aspect:null,reason:null,changes:[]});
function json(body:AuditPage){return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});}
export const RefreshDuringLoadMore:StoryObj<typeof AuditLog>={
  render:()=><AuditLog workspaceId="ws"/>,
  beforeEach:()=>{
    const original=window.fetch;let firstPages=0;let releaseMore:()=>void=()=>{};
    const pending=new Promise<void>(ok=>{releaseMore=ok;});
    (window as unknown as {releaseMore:()=>void}).releaseMore=releaseMore;
    window.fetch=(async(input:RequestInfo|URL)=>{
      const url=String(input);
      if(url.includes('before=')){await pending;return json({entries:[entry('old','Stale continuation')],next:null});}
      firstPages+=1;
      return firstPages===1?json({entries:[entry('a','First page')],next:5}):json({entries:[entry('b','Refreshed page')],next:null});
    }) as typeof fetch;
    return()=>{window.fetch=original;};
  },
  play:async({canvasElement})=>{
    const c=within(canvasElement);
    await userEvent.click(await c.findByRole('button',{name:'Load more'}));
    window.dispatchEvent(new Event('focus'));
    await c.findByText(/Refreshed page/);
    (window as unknown as {releaseMore:()=>void}).releaseMore();
    await new Promise(ok=>setTimeout(ok,50));
    await waitFor(()=>expect(c.queryByText(/Stale continuation/)).toBeNull());
    await expect(c.queryByText(/First page/)).toBeNull();
    await expect(c.queryByRole('button',{name:'Load more'})).toBeNull();
    canvasElement.dataset.playComplete='true';
  },
};

// "Load more" clicked while a refresh is pending: the refresh lands first, the continuation is dropped and the button works again.
export const LoadMoreDuringRefresh:StoryObj<typeof AuditLog>={
  render:()=><AuditLog workspaceId="ws"/>,
  beforeEach:()=>{
    const original=window.fetch;let firstPages=0;
    const gate=()=>{let open:()=>void=()=>{};const shut=new Promise<void>(ok=>{open=ok;});return{shut,open};};
    const refresh=gate(),more=gate();
    Object.assign(window,{openRefresh:refresh.open,openMore:more.open});
    window.fetch=(async(input:RequestInfo|URL)=>{
      const url=String(input);
      if(url.includes('before=')){await more.shut;return json({entries:[entry('old','Stale continuation')],next:null});}
      firstPages+=1;
      if(firstPages===1)return json({entries:[entry('a','First page')],next:5});
      await refresh.shut;return json({entries:[entry('b','Refreshed page')],next:7});
    }) as typeof fetch;
    return()=>{window.fetch=original;};
  },
  play:async({canvasElement})=>{
    const c=within(canvasElement),w=window as unknown as {openRefresh:()=>void;openMore:()=>void};
    await c.findByText(/First page/);
    window.dispatchEvent(new Event('focus'));
    await userEvent.click(c.getByRole('button',{name:'Load more'}));
    w.openRefresh();
    await c.findByText(/Refreshed page/);
    w.openMore();
    await new Promise(ok=>setTimeout(ok,50));
    await expect(c.queryByText(/Stale continuation/)).toBeNull();
    await waitFor(()=>expect(c.getByRole('button',{name:'Load more'})).toBeEnabled());
    canvasElement.dataset.playComplete='true';
  },
};

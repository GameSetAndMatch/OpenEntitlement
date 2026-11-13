import {useState} from 'react';
import type {Meta,StoryObj} from '@storybook/react-vite';
import {expect,userEvent,within} from 'storybook/test';
import {ProductApiKeys,type ProductApiKey} from './product-api-keys.tsx';
const billing:ProductApiKey={id:'k1',name:'Billing app',preview:'oek_…a1b2',createdAt:'2026-11-12T10:00:00Z'};
/** Records each callback so the play function can check what the page would send. */
function Example({keys:initial}:{keys:ProductApiKey[]}){
 const [keys,setKeys]=useState(initial),[name,setName]=useState(''),[secret,setSecret]=useState(''),[log,setLog]=useState<string[]>([]);
 const add=(entry:string)=>setLog(l=>[...l,entry]);
 return <div className="settings-page"><ProductApiKeys product={{key:'analytics',name:'Analytics'}} keys={keys} name={name} secret={secret} locked={false} onName={setName}
  onCreate={()=>{add(`create ${name}`);setKeys([{id:'k2',name,preview:'oek_…c3d4',createdAt:'2026-11-13T10:00:00Z'},...keys]);setSecret('oek_w.secret');setName('');}}
  onRevoke={k=>{add(`revoke ${k.name}`);setKeys(keys.filter(x=>x.id!==k.id));}} onCopy={(_text,done)=>add(done)}/>
  <ol aria-label="Sent">{log.map((l,i)=><li key={i}>{l}</li>)}</ol></div>;
}
const meta={title:'Workspace/Product API keys',component:Example} satisfies Meta<typeof Example>;
export default meta;
type Story=StoryObj<typeof meta>;
const sent=(c:ReturnType<typeof within>)=>within(c.getByRole('list',{name:'Sent'})).queryAllByRole('listitem').map(li=>li.textContent);
// A Manager creates a key for the Product, sees its secret once, and revokes the older key.
export const CreateAndRevoke:Story={args:{keys:[billing]},play:async({canvasElement})=>{
 const c=within(canvasElement);
 await expect(c.getByRole('region',{name:'API keys for Analytics'})).toBeInTheDocument();
 await expect(c.getByText('analytics')).toBeInTheDocument();
 await expect(c.queryByLabelText('Save this secret securely')).not.toBeInTheDocument();
 await userEvent.type(c.getByLabelText('Key name'),'Mobile app');
 await userEvent.click(c.getByRole('button',{name:'Create API key'}));
 await expect(c.getByLabelText('Save this secret securely')).toHaveValue('oek_w.secret');
 await expect(c.getByText('Mobile app')).toBeInTheDocument();
 await userEvent.click(c.getByRole('button',{name:'Revoke Billing app'}));
 await expect(c.queryByText('Billing app')).not.toBeInTheDocument();
 await expect(sent(c)).toEqual(['create Mobile app','revoke Billing app']);
 canvasElement.dataset.playComplete='true';
}};

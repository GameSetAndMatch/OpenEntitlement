import {useState} from 'react';
import type {Meta,StoryObj} from '@storybook/react-vite';
import {expect,userEvent,within} from 'storybook/test';
import {ProductMembers,type MemberRoleChange,type NewInvitation,type ProductMember} from './product-members.tsx';
import type {ProductSummary} from './product-selector.tsx';
const analytics:ProductSummary={id:'a',key:'analytics',name:'Analytics',role:'Owner'},storage:ProductSummary={id:'s',key:'storage',name:'Storage',role:'Owner'};
const members:ProductMember[]=[
 {id:'o',email:'owner@acme.test',owner:true,role:'Owner',products:[]},
 {id:'m',email:'manager@acme.test',owner:false,role:'Manager',products:[{productId:'a',role:'Manager'},{productId:'s',role:'User'}]},
 {id:'u',email:'user@acme.test',owner:false,role:'User',products:[{productId:'a',role:'User'}]},
];
/** Records each callback so the play functions can check what the page would send. */
function Example({products,owner,viewer}:{products:ProductSummary[];owner:boolean;viewer:string}){
 const [log,setLog]=useState<string[]>([]),[link,setLink]=useState('');
 const add=(entry:string)=>setLog(l=>[...l,entry]);
 return <div className="settings-page"><ProductMembers description="Your role: Owner." members={members} products={products} viewer={viewer} owner={owner} locked={false} link={link}
  onRole={(m:ProductMember,c:MemberRoleChange)=>add(`role ${m.email} ${c.role??'none'} ${c.productId??'-'}`)}
  onRemove={(m:ProductMember)=>add(`remove ${m.email}`)}
  onInvite={async(i:NewInvitation)=>{add(`invite ${i.email} ${i.role} ${i.productId??'-'}`);setLink('https://console.test/app/#invite=token');return true;}}/>
  <ol aria-label="Sent">{log.map((l,i)=><li key={i}>{l}</li>)}</ol></div>;
}
const meta={title:'Workspace/Product members',component:Example} satisfies Meta<typeof Example>;
export default meta;
type Story=StoryObj<typeof meta>;
const sent=(c:ReturnType<typeof within>)=>within(c.getByRole('list',{name:'Sent'})).queryAllByRole('listitem').map(li=>li.textContent);
// An Owner of a Workspace with two Products sets a Role per Product and invites to either Product.
export const OwnerOfTwoProducts:Story={args:{products:[analytics,storage],owner:true,viewer:'o'},play:async({canvasElement})=>{
 const c=within(canvasElement);
 await expect(c.getByLabelText('Role for owner@acme.test')).toHaveValue('Owner');
 await expect(c.queryByLabelText('Role for owner@acme.test in Analytics')).not.toBeInTheDocument();
 await expect(c.getByLabelText('Role for user@acme.test in Storage')).toHaveValue('');
 await userEvent.selectOptions(c.getByLabelText('Role for manager@acme.test in Storage'),'');
 await userEvent.selectOptions(c.getByLabelText('Role for user@acme.test in Analytics'),'Owner');
 await userEvent.selectOptions(c.getByLabelText('Role for owner@acme.test'),'Manager of Storage');
 await userEvent.click(c.getByRole('button',{name:'Remove user@acme.test'}));
 await userEvent.type(c.getByLabelText('Email address'),'new@acme.test');
 await userEvent.selectOptions(c.getByLabelText('Invite to product'),'s');
 await userEvent.click(c.getByRole('button',{name:'Create invitation link'}));
 await expect(c.getByLabelText('Invitation link (expires in 7 days)')).toHaveValue('https://console.test/app/#invite=token');
 await expect(c.getByLabelText('Email address')).toHaveValue('');
 await userEvent.type(c.getByLabelText('Email address'),'boss@acme.test');
 await userEvent.selectOptions(c.getByLabelText('Role'),'Owner');
 await expect(c.queryByLabelText('Invite to product')).not.toBeInTheDocument();
 await userEvent.click(c.getByRole('button',{name:'Create invitation link'}));
 await expect(sent(c)).toEqual(['role manager@acme.test none s','role user@acme.test Owner -','role owner@acme.test Manager s','remove user@acme.test','invite new@acme.test User s','invite boss@acme.test Owner -']);
 canvasElement.dataset.playComplete='true';
}};
// A Manager of one Product sees Owners as text, cannot invite Owners, and needs no Product choice.
export const ManagerOfOneProduct:Story={args:{products:[{...analytics,role:'Manager'}],owner:false,viewer:'m'},play:async({canvasElement})=>{
 const c=within(canvasElement);
 await expect(c.queryByLabelText('Role for owner@acme.test')).not.toBeInTheDocument();
 await expect(c.queryByRole('button',{name:'Remove owner@acme.test'})).not.toBeInTheDocument();
 await expect(c.getByText('You')).toBeInTheDocument();
 await expect(within(c.getByLabelText('Role')).queryByRole('option',{name:'Owner'})).not.toBeInTheDocument();
 await expect(within(c.getByLabelText('Role for user@acme.test')).queryByRole('option',{name:'Owner'})).not.toBeInTheDocument();
 await userEvent.selectOptions(c.getByLabelText('Role for user@acme.test'),'Manager');
 await userEvent.type(c.getByLabelText('Email address'),'new@acme.test');
 await userEvent.click(c.getByRole('button',{name:'Create invitation link'}));
 await expect(sent(c)).toEqual(['role user@acme.test Manager a','invite new@acme.test User a']);
 canvasElement.dataset.playComplete='true';
}};

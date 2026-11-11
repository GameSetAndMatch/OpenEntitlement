import {useState} from 'react';
import type {Meta,StoryObj} from '@storybook/react-vite';
import {expect,userEvent,within} from 'storybook/test';
import {WorkspaceSwitcher,workspaceInitial} from './workspace-switcher.tsx';
const workspaces=[{id:'acme',name:'Acme product',role:'Owner'},{id:'globex',name:'Globex internal tools',role:'User'},{id:'umbrella',name:'élan analytics',role:'Owner'}];
function Example(){
 const [current,setCurrent]=useState('acme'),[created,setCreated]=useState(0);
 return <aside style={{position:'static',width:224,height:360}}><WorkspaceSwitcher workspaces={workspaces} current={workspaces.find(w=>w.id===current)!} onSelect={setCurrent} onCreate={()=>setCreated(n=>n+1)}/><p role="status">{created?'Create requested':''}</p></aside>;
}
const meta={title:'Workspace/Switcher',component:Example} satisfies Meta<typeof Example>;
export default meta;
type Story=StoryObj<typeof meta>;
export const SwitchAndCreate:Story={play:async({canvasElement})=>{
 const c=within(canvasElement);
 await expect(workspaceInitial(' élan')).toBe('É');
 const trigger=c.getByRole('button',{name:'Workspace: Acme product'});
 await userEvent.click(trigger);
 await expect(c.getByRole('menuitemradio',{name:/Acme product/})).toHaveFocus();
 await userEvent.keyboard('{ArrowDown}{Enter}');
 await expect(c.getByRole('button',{name:'Workspace: Globex internal tools'})).toHaveFocus();
 await userEvent.click(c.getByRole('button',{name:'Workspace: Globex internal tools'}));
 await userEvent.keyboard('{End}{Enter}');
 await expect(c.getByRole('status')).toHaveTextContent('Create requested');
 await expect(c.queryByRole('menu')).not.toBeInTheDocument();
 canvasElement.dataset.playComplete='true';
}};

// A long name must truncate, not widen the page (the phone layout is a wrapping row).
const long={id:'long',name:'Northwind Traders international entitlement operations',role:'Owner'};
export const LongName:Story={render:()=><div style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:8,width:'100%'}}><WorkspaceSwitcher workspaces={[long,...workspaces]} current={long} onSelect={()=>{}} onCreate={()=>{}}/><a href="#tiers">Tiers</a></div>,play:async({canvasElement})=>{
 const c=within(canvasElement);
 await expect(c.getByRole('button',{name:`Workspace: ${long.name}`})).toBeVisible();
 canvasElement.dataset.playComplete='true';
}};

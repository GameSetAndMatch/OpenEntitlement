import {useState} from 'react';
import type {Meta,StoryObj} from '@storybook/react-vite';
import {expect,userEvent,within} from 'storybook/test';
import {ProductSelector,pickProduct,type ProductSummary} from './product-selector.tsx';
const products:ProductSummary[]=[{id:'a',key:'analytics',name:'Analytics',role:'Owner'},{id:'s',key:'storage',name:'Storage',role:'Owner',archivedAt:'2026-11-13T09:30:00Z'}];
function Example({list}:{list:ProductSummary[]}){
 const [current,setCurrent]=useState(pickProduct(list,'missing'));
 return <aside style={{position:'static',width:224}}><ProductSelector products={list} current={current} onSelect={setCurrent}/><p role="status">{list.find(p=>p.id===current)?.key}</p></aside>;
}
const meta={title:'Workspace/Product selector',component:Example} satisfies Meta<typeof Example>;
export default meta;
type Story=StoryObj<typeof meta>;
export const SeveralProducts:Story={args:{list:products},play:async({canvasElement})=>{
 const c=within(canvasElement);
 const select=c.getByRole('combobox',{name:'Product'});
 await expect(select).toHaveValue('a');
 await expect(c.getByRole('option',{name:'Storage (archived)'})).toBeInTheDocument();
 await userEvent.selectOptions(select,'s');
 await expect(c.getByRole('status')).toHaveTextContent('storage');
 canvasElement.dataset.playComplete='true';
}};
// With one Product there is nothing to choose, so the selector is hidden.
export const OneProduct:Story={args:{list:products.slice(0,1)},play:async({canvasElement})=>{
 const c=within(canvasElement);
 await expect(c.queryByRole('combobox',{name:'Product'})).not.toBeInTheDocument();
 await expect(c.getByRole('status')).toHaveTextContent('analytics');
 canvasElement.dataset.playComplete='true';
}};

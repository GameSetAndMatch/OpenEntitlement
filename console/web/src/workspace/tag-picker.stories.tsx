import {useState} from 'react';
import type {Meta,StoryObj} from '@storybook/react-vite';
import {expect,userEvent,within} from 'storybook/test';
import type {Tag} from '../../../server/workspace/model.ts';
import {TagPicker} from './tag-picker.tsx';
function Example({failure=false}:{failure?:boolean}){
 const [tags,setTags]=useState<Tag[]>([{id:'capacity',name:'Capacity',description:''},{id:'access',name:'Access',description:''}]);
 const [selected,setSelected]=useState(['capacity']);
 return <form onSubmit={e=>{e.preventDefault();throw new Error('Tag entry must not submit the Privilege form');}}><TagPicker tags={tags} selected={selected} onChange={setSelected} onCreate={async tag=>{if(failure)throw new Error('Could not save tag');setTags(current=>[...current,tag]);return true;}}/></form>;
}
const meta={title:'Catalog/Privilege tags',component:Example,tags:['autodocs']} satisfies Meta<typeof Example>;
export default meta;
type Story=StoryObj<typeof meta>;
export const InlineLabels:Story={play:async({canvasElement})=>{
 const c=within(canvasElement);
 await userEvent.click(c.getByText('Add tags',{exact:true}));
 await userEvent.click(c.getByRole('checkbox',{name:'Access'}));
 await expect(c.getByRole('button',{name:'Remove tag Access'})).toBeVisible();
 const input=c.getByLabelText('Find or add a tag');
 await userEvent.type(input,'Operations');await userEvent.keyboard('{Enter}');
 await expect(c.getByRole('button',{name:'Remove tag Operations'})).toBeVisible();
 await userEvent.type(input,'operations');await userEvent.keyboard('{Enter}');
 await expect(c.getAllByRole('checkbox',{name:'Operations'})).toHaveLength(1);
 await userEvent.click(c.getByRole('button',{name:'Remove tag Capacity'}));
 await expect(c.queryByRole('button',{name:'Remove tag Capacity'})).not.toBeInTheDocument();
 await userEvent.click(input);await userEvent.keyboard('{Escape}');
 await expect(canvasElement.querySelector('details.tag-picker')).not.toHaveAttribute('open');
 await expect(c.getByText('Add tags',{exact:true})).toHaveFocus();
}};
export const SaveFailure:Story={args:{failure:true},play:async({canvasElement})=>{
 const c=within(canvasElement);await userEvent.click(c.getByText('Add tags',{exact:true}));await userEvent.type(c.getByLabelText('Find or add a tag'),'Operations');await userEvent.click(c.getByRole('button',{name:'Add “Operations”'}));await expect(c.getByRole('alert')).toHaveTextContent('Could not save tag');await expect(c.queryByRole('button',{name:'Remove tag Operations'})).not.toBeInTheDocument();
}};

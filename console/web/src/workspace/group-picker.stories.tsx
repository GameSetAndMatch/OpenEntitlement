import {useState} from 'react';
import type {Meta,StoryObj} from '@storybook/react-vite';
import {expect,userEvent,within} from 'storybook/test';
import type {Group} from '../../../server/workspace/model.ts';
import {GroupPicker} from './group-picker.tsx';

function Example({failure=false}:{failure?:boolean}){
 const [groups,setGroups]=useState<Group[]>([{id:'product',name:'Product',description:''},{id:'analytics',name:'Analytics',description:'',parentId:'product'}]);
 const [selected,setSelected]=useState<string>();
 const [created,setCreated]=useState<Group[]>([]);
 return <form className="form" onSubmit={e=>{e.preventDefault();throw new Error('Group entry must not submit the Privilege form');}}>
  <fieldset className="form-section"><legend>Organize</legend>
   <GroupPicker groups={groups} takenIds={[...groups.map(g=>g.id),'legacy_hidden']} selected={selected} onChange={setSelected}
    onCreate={async group=>{if(failure)throw new Error('Could not save group');setGroups(g=>[...g,group]);setCreated(c=>[...c,group]);return true;}}/>
  </fieldset>
  <output className="sr-only" data-testid="created">{JSON.stringify(created)}</output>
 </form>;
}
const meta={title:'Catalog/Group picker',component:Example} satisfies Meta<typeof Example>;
export default meta;
type Story=StoryObj<typeof meta>;
const done=(canvasElement:HTMLElement)=>{canvasElement.dataset.playComplete='true';};

export const FoldersAndNewGroups:Story={play:async({canvasElement})=>{
 const c=within(canvasElement),summary=()=>canvasElement.querySelector('summary')!,details=()=>canvasElement.querySelector('details')!;
 await expect(summary()).toHaveTextContent('No group');
 // Choose an existing nested folder.
 await userEvent.click(summary());
 await userEvent.click(c.getByRole('button',{name:'Analytics'}));
 await expect(summary()).toHaveTextContent('Product › Analytics');
 await expect(details()).not.toHaveAttribute('open');
 // New group inside a folder, named in place, then selected.
 await userEvent.click(summary());
 await userEvent.click(c.getByRole('button',{name:'New group inside Product'}));
 await expect(c.getByRole('textbox',{name:'Name of the new group inside Product'})).toHaveFocus();
 await userEvent.keyboard('Exports{Enter}');
 await expect(summary()).toHaveTextContent('Product › Exports');
 await expect(c.getByTestId('created')).toHaveTextContent('"id":"exports","name":"Exports","description":"","parentId":"product"');
 // Escape cancels the new name without closing the picker.
 await userEvent.click(summary());
 await userEvent.click(c.getByRole('button',{name:'+ New group'}));
 await userEvent.keyboard('Billing{Escape}');
 await expect(c.queryByRole('textbox',{name:'Name of the new group'})).not.toBeInTheDocument();
 await expect(details()).toHaveAttribute('open');
 // A top-level group whose ID is taken gets a suffix.
 await userEvent.click(c.getByRole('button',{name:'+ New group'}));
 await userEvent.keyboard('Legacy hidden{Enter}');
 await expect(summary()).toHaveTextContent('Legacy hidden');
 await expect(c.getByTestId('created')).toHaveTextContent('"id":"legacy_hidden_1"');
 // Back to no group; Escape closes and returns focus.
 await userEvent.click(summary());
 await userEvent.click(c.getByRole('button',{name:'No group'}));
 await expect(summary()).toHaveTextContent('No group');
 await userEvent.click(summary());await userEvent.keyboard('{Escape}');
 await expect(details()).not.toHaveAttribute('open');
 await expect(summary()).toHaveFocus();
 done(canvasElement);
}};

export const SaveFailure:Story={args:{failure:true},play:async({canvasElement})=>{
 const c=within(canvasElement),summary=canvasElement.querySelector('summary')!;
 await userEvent.click(summary);
 await userEvent.click(c.getByRole('button',{name:'+ New group'}));
 await userEvent.keyboard('Billing{Enter}');
 await expect(c.getByRole('alert')).toHaveTextContent('Could not save group');
 await expect(summary).toHaveTextContent('No group');
 await expect(c.getByRole('textbox',{name:'Name of the new group'})).toHaveValue('Billing');
 done(canvasElement);
}};

import {useState} from 'react';
import type {Meta,StoryObj} from '@storybook/react-vite';
import {expect,userEvent,within} from 'storybook/test';
import {TierAvailability} from './tier-availability.tsx';
import type {TierRow} from './product-catalog.ts';
function Example({initial}:{initial:TierRow}){
 const [tier,setTier]=useState(initial),[last,setLast]=useState('');
 return <form className="panel form" onSubmit={e=>e.preventDefault()}><TierAvailability tier={tier} busy={false} onArchive={()=>{setTier({...tier,archivedAt:'2026-11-13T10:00:00Z'});setLast('archived');}} onRestore={()=>{const {archivedAt:_archived,...rest}=tier;setTier(rest);setLast('restored');}} onDelete={()=>setLast('delete requested')}/><p role="status">{last}</p></form>;
}
const meta={title:'Workspace/Tier availability',component:Example} satisfies Meta<typeof Example>;
export default meta;
type Story=StoryObj<typeof meta>;
export const ArchiveAndRestore:Story={args:{initial:{id:'pro',name:'Pro',rank:1,gracePeriodDays:0}},play:async({canvasElement})=>{
 const c=within(canvasElement);
 await userEvent.click(c.getByRole('button',{name:'Archive tier'}));
 await expect(c.getByText(/Archived\. Organizations on Pro keep it/)).toBeInTheDocument();
 await userEvent.click(c.getByRole('button',{name:'Restore tier'}));
 await expect(c.getByRole('status')).toHaveTextContent('restored');
 await userEvent.click(c.getByRole('button',{name:'Delete tier'}));
 await expect(c.getByRole('status')).toHaveTextContent('delete requested');
 canvasElement.dataset.playComplete='true';
}};

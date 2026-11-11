import type {Meta,StoryObj} from '@storybook/react-vite';
import {expect,userEvent,within} from 'storybook/test';
import {Catalog} from './catalog.tsx';
import {emptyData} from '../../../server/workspace/model.ts';
const data=emptyData();
data.groups=[{id:'integration',name:'Integrations',description:'Connect to other tools.'}];
data.tags=[{id:'enterprise',name:'Enterprise',description:''},{id:'integration',name:'Integration',description:''}];
data.privileges=[{key:'mcp_enabled',name:'MCP access',description:'Use the MCP integration.',type:'boolean',default:true,envVariable:'MCP_INSTALLED',groupId:'integration',tags:['enterprise','integration']},{key:'seats',name:'Seats',description:'Licensed seats.',type:'integer',default:10,tags:['enterprise']},{key:'internal_enabled',name:'Internal privilege',description:'',type:'boolean',default:false,hidden:true}];
const meta={title:'Privilege Catalog',component:Catalog,args:{workspace:{id:'example',name:'Example product',role:'Platform administrator',data,revision:1,environment:{mcp_enabled:{variable:'MCP_INSTALLED',configuredValue:'False',value:false}}},save:async()=>true,canEdit:false,busy:false},tags:['autodocs']} satisfies Meta<typeof Catalog>;
export default meta;
type Story=StoryObj<typeof meta>;
export const GroupedAndTagged:Story={play:async({canvasElement})=>{const canvas=within(canvasElement);await expect(canvas.getByText('MCP access')).toBeVisible();await expect(canvas.queryByText('Internal privilege')).not.toBeInTheDocument();await expect(canvas.getByRole('note')).toHaveTextContent('MCP_INSTALLED=False');await userEvent.selectOptions(canvas.getByLabelText('Filter by tag'),'integration');await expect(canvas.queryByText('Seats')).not.toBeInTheDocument();}};
export const Authoring:Story={args:{canEdit:true}};
export const OneFormAtATime:Story={args:{canEdit:true},play:async({canvasElement})=>{
 const canvas=within(canvasElement);
 await userEvent.click(canvas.getByRole('button',{name:'Edit Seats'}));
 // While a form is open it is the only thing on the page: no list, no filter, no other Edit buttons.
 await expect(canvas.getAllByRole('heading',{level:2}).map(h=>h.textContent)).toEqual(['Edit Seats']);
 await expect(canvas.queryByRole('button',{name:/^Edit /})).not.toBeInTheDocument();
 await expect(canvas.queryByLabelText('Filter by tag')).not.toBeInTheDocument();
 await userEvent.click(canvas.getByRole('button',{name:'Cancel'}));
 await expect(canvas.getByRole('button',{name:'Edit Seats'})).toBeVisible();
 canvasElement.dataset.playComplete='true';
}};

const nested=structuredClone(data);
nested.groups=[{id:'product',name:'Product',description:''},{id:'integration',name:'Integrations',description:'',parentId:'product'},{id:'analytics',name:'Analytics',description:'',parentId:'product'},{id:'scheduled',name:'Scheduled',description:'',parentId:'integration'}];
nested.privileges.push({key:'reports',name:'Reports',description:'',type:'boolean',default:true,groupId:'analytics',tags:['integration']},{key:'scheduled',name:'Scheduled exports',description:'',type:'boolean',default:true,groupId:'scheduled',tags:['integration']});
export const NestedGroups:Story={args:{workspace:{...meta.args.workspace,data:nested}},play:async({canvasElement})=>{
 const canvas=within(canvasElement),root=canvas.getByRole('heading',{name:'Product'}).closest('section')!;
 await expect(within(root).getByText('MCP access')).toBeVisible();
 await expect(within(root).getByText('Reports',{exact:true})).toBeVisible();
 const child=canvas.getByRole('heading',{name:'Integrations'}).closest('section')!;
 await expect(within(child).getByText('Scheduled exports')).toBeVisible();
 await expect(within(child).queryByText('Reports',{exact:true})).not.toBeInTheDocument();
 await userEvent.selectOptions(canvas.getByLabelText('Filter by tag'),'integration');
 for(const title of ['MCP access','Reports','Scheduled exports'])await expect(canvas.getByText(title,{exact:true})).toBeVisible();
 await expect(canvas.queryByText('Seats',{exact:true})).not.toBeInTheDocument();
 await userEvent.selectOptions(canvas.getByLabelText('Filter by tag'),'enterprise');
 await expect(canvas.getByText('MCP access')).toBeVisible();
 await expect(canvas.queryByText('Reports',{exact:true})).not.toBeInTheDocument();
 await expect(canvas.queryByText('Scheduled exports')).not.toBeInTheDocument();
}};

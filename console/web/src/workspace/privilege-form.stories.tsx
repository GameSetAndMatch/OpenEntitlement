import type {Meta,StoryObj} from '@storybook/react-vite';
import {expect,fn,userEvent,within} from 'storybook/test';
import {PrivilegeForm,freshPrivilege} from './privilege-form.tsx';
import type {Privilege} from '../../../server/workspace/privilege-definition.ts';

/** The runner waits for this marker, so a story whose play throws never passes silently. */
const done=(canvasElement:HTMLElement)=>{canvasElement.dataset.playComplete='true';};
const meta={title:'Privilege Catalog/Privilege form',component:PrivilegeForm,args:{
 initial:freshPrivilege(),editing:false,groups:[{id:'product',name:'Product',description:''}],tags:[{id:'enterprise',name:'Enterprise',description:''}],
 envEditable:false,busy:false,onSave:fn(async()=>true),onCreateTag:fn(async()=>true),onCreateGroup:fn(async()=>true),onCancel:fn(),
}} satisfies Meta<typeof PrivilegeForm>;
export default meta;
type Story=StoryObj<typeof meta>;

export const KeyFromTitle:Story={play:async({canvasElement})=>{
 const canvas=within(canvasElement),title=canvas.getByRole('textbox',{name:'Title'}),key=canvas.getByRole('textbox',{name:'Key'});
 await userEvent.type(title,'Maximum Exports per Month');
 await expect(key).toHaveValue('maximum_exports_per_month');
 await userEvent.clear(title);await userEvent.type(title,'Accès API (v2)');
 await expect(key).toHaveValue('acces_api_v2');
 await userEvent.clear(title);await userEvent.type(title,'2FA required');
 await expect(key).toHaveValue('privilege_2fa_required');
 await userEvent.clear(key);await userEvent.type(key,'custom_key');
 await userEvent.type(title,'!');
 await expect(key).toHaveValue('custom_key');
 await userEvent.clear(key);await userEvent.clear(title);await userEvent.type(title,'Seats');
 await expect(key).toHaveValue('seats');
 // Group and Tags come last: they organize, they do not define the Privilege.
 const legends=[...canvasElement.querySelectorAll('legend')].map(l=>l.textContent?.split(' ')[0]);
 await expect(legends).toEqual(['Basics','Value','Organize']);
 await expect(canvas.queryByRole('textbox',{name:/Environment prerequisite/})).not.toBeInTheDocument();
 done(canvasElement);
}};

const integer:Privilege={key:'temperature_offset',title:'Temperature offset',description:'',type:'integer',visibility:'editable',tags:[],default:0};
export const NegativeInteger:Story={args:{initial:integer},play:async({canvasElement,args})=>{
 const canvas=within(canvasElement),minimum=canvas.getByRole('spinbutton',{name:/^Minimum/});
 await userEvent.type(minimum,'-10');
 await expect(minimum).toHaveValue(-10);
 await expect(minimum).toBeValid();
 const value=canvas.getByRole('spinbutton',{name:'temperature_offset'});
 await userEvent.clear(value);await userEvent.type(value,'-5');
 await expect(canvas.queryByRole('alert')).not.toBeInTheDocument();
 await userEvent.click(canvas.getByRole('checkbox',{name:/Allow unlimited/}));
 await expect(canvas.getByRole('checkbox',{name:/Allow unlimited/})).toBeChecked();
 const group=canvasElement.querySelector('details.group-picker > summary') as HTMLElement;
 await userEvent.click(group);
 await userEvent.click(canvas.getByRole('button',{name:'New group inside Product'}));
 await userEvent.keyboard('Climate{Enter}');
 await expect(args.onCreateGroup).toHaveBeenCalledWith({id:'climate',name:'Climate',description:'',parentId:'product'});
 await expect(group).toHaveTextContent('Product › Climate');
 await userEvent.click(canvas.getByRole('button',{name:'Save privilege'}));
 await expect(args.onSave).toHaveBeenCalledWith(expect.objectContaining({key:'temperature_offset',minimum:-10,default:-5,unlimited:true,groupId:'climate'}));
 done(canvasElement);
}};

const plan:Privilege={key:'plan_level',title:'Plan level',description:'',type:'enum',visibility:'editable',tags:[],enum:['standard'],default:'standard'};
export const EnumChoices:Story={args:{initial:plan},play:async({canvasElement,args})=>{
 const canvas=within(canvasElement);
 await expect(canvas.getByRole('textbox',{name:'Choice 1'})).toHaveValue('standard');
 await userEvent.click(canvas.getByRole('textbox',{name:'Choice 1'}));
 await userEvent.keyboard('{End}{Enter}');
 await expect(canvas.getByRole('textbox',{name:'Choice 2'})).toHaveFocus();
 await userEvent.keyboard('premium{Enter}enterprise');
 await expect(canvas.getByRole('textbox',{name:'Choice 3'})).toHaveValue('enterprise');
 await userEvent.click(canvas.getByRole('button',{name:'+ Add choice'}));
 await expect(canvas.getByRole('textbox',{name:'Choice 4'})).toHaveFocus();
 await userEvent.keyboard('premium');
 await expect(canvas.getByRole('alert')).toHaveTextContent('already in the list');
 await userEvent.keyboard('{Control>}a{/Control}{Backspace}{Backspace}');
 await expect(canvas.queryByRole('textbox',{name:'Choice 4'})).not.toBeInTheDocument();
 await expect(canvas.getByRole('textbox',{name:'Choice 3'})).toHaveFocus();
 await userEvent.click(canvas.getByRole('button',{name:'Remove choice 1'}));
 await expect(canvas.getByRole('textbox',{name:'Choice 1'})).toHaveValue('premium');
 await userEvent.click(canvas.getByRole('button',{name:'+ Add choice'}));
 await userEvent.click(canvas.getByRole('button',{name:'Save privilege'}));
 await expect(args.onSave).toHaveBeenCalledWith(expect.objectContaining({enum:['premium','enterprise'],default:'premium'}));
 done(canvasElement);
}};

const mcp:Privilege={key:'mcp_enabled',title:'MCP access',description:'',type:'boolean',visibility:'editable',tags:[],default:false};
export const BooleanForAdministrator:Story={args:{initial:mcp,editing:true,envEditable:true},play:async({canvasElement})=>{
 const canvas=within(canvasElement),env=canvas.getByRole('textbox',{name:/Environment prerequisite/});
 await expect(env).not.toHaveAttribute('placeholder');
 await expect(canvas.getByRole('textbox',{name:'Key'})).toBeDisabled();
 done(canvasElement);
}};

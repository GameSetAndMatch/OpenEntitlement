import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { Field, ValuesEditor } from './fields.tsx';
import type { Privilege, Value } from '../../../server/workspace/model.ts';
const limit: Privilege = { key: 'max_exports', name: 'Maximum exports', description: 'Exports each organization may create.', featureId: 'exports', type: 'integer', minimum: 0, unlimited: true, default: 5 };
function Controlled(args: React.ComponentProps<typeof Field>) {
  const [value,setValue] = useState(args.value);
  return <form style={{maxWidth:480}}><Field {...args} value={value} onChange={setValue}/></form>;
}
const meta = { title: 'Catalog/Typed value', component: Field, render: args => <Controlled {...args}/>, args: {def:limit,value:5,onChange:()=>{}}, tags:['autodocs'] } satisfies Meta<typeof Field>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Finite: Story = {};
export const Unlimited: Story = { args: {value:{unlimited:true}}, play: async ({canvasElement}) => {
  const canvas=within(canvasElement);
  await expect(canvas.getByLabelText('max_exports')).toBeDisabled();
  await expect(canvas.getByLabelText('max_exports')).toHaveValue('∞');
  await userEvent.click(canvas.getByLabelText('Unlimited max_exports'));
  await expect(canvas.getByLabelText('max_exports')).toBeEnabled();
}};
export const InvalidNegative: Story = { args:{value:-5}, play:async({canvasElement})=>{
  await expect(within(canvasElement).getByRole('alert')).toHaveTextContent('0 or greater');
}};
export const BooleanAccess: Story = {args:{def:{...limit,key:'export_enabled',name:'Export access',type:'boolean',default:false},value:false},play:async({canvasElement})=>{
  const control=within(canvasElement).getByRole('switch');
  await userEvent.click(control);
  await expect(control).toHaveAttribute('aria-checked','true');
  await expect(control).toHaveTextContent('Feature access included');
}};
export const RequiredEnum: Story = {args:{def:{key:'retention',name:'Retention',description:'How long exports are retained.',type:'string',enum:['30d','365d']},value:undefined}};
export const Inheritance: Story = {render:()=>{
  const [values,setValues]=useState<Record<string,Value>>({});
  return <ValuesEditor definitions={[limit,{key:'retention',name:'Retention',description:'Choose this value in every variant.',type:'string',enum:['30d','365d']}]} base={{}} values={values} onChange={setValues}/>;
}};

export const EnvironmentOverride: Story = {render:()=> <ValuesEditor definitions={[{...limit,key:"mcp_enabled",name:"MCP access",type:"boolean",default:true}]} base={{mcp_enabled:true}} values={{mcp_enabled:true}} onChange={()=>{}} environment={{mcp_enabled:{variable:"MCP_INSTALLED",configuredValue:"False",value:false}}}/>,play:async({canvasElement})=>{
  const canvas=within(canvasElement);await expect(canvas.getByRole("switch")).toBeDisabled();await expect(canvas.getByRole("switch")).toHaveAttribute("aria-checked","false");await expect(canvas.getByRole("note")).toHaveTextContent("MCP_INSTALLED=False");
}};

export const FrozenDefault: Story = {render:()=> <ValuesEditor definitions={[{...limit,frozen:true}]} base={{max_exports:100}} values={{max_exports:250}} onChange={()=>{}}/>};

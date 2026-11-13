import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { AuditEntries } from './audit-log.tsx';
const meta={title:'Workspace/Audit log',component:AuditEntries} satisfies Meta<typeof AuditEntries>;
export default meta;
type Story=StoryObj<typeof meta>;
export const Changes:Story={args:{entries:[{id:'1',at:'2026-11-13T12:00:00Z',actorEmail:'alice@acme.test',action:'changed',targetKind:'Organization',targetName:'Acme',aspect:'terms',reason:'Renewal',changes:[{field:'terms.seats',title:'Seats',before:10,after:20}]}]},play:async({canvasElement})=>{const c=within(canvasElement);await userEvent.click(c.getByText('Show 1 changes'));await expect(c.getByText('10 → 20')).toBeVisible();await expect(c.getByText(/alice@acme.test changed Organization/)).toBeVisible();canvasElement.dataset.playComplete='true';}};
export const French:Story={args:{...Changes.args,language:'fr'},play:async({canvasElement})=>{const c=within(canvasElement);await userEvent.click(c.getByText('Afficher 1 changements'));await expect(c.getByText('10 → 20')).toBeVisible();canvasElement.dataset.playComplete='true';}};

import { useState } from "react";
import { Field,Group,Item } from "./settings-group.tsx";
import type { ProductSummary } from "./product-selector.tsx";

/** A member as the Python service lists them: only the Roles in Products the viewer manages (ADR-0008). */
export interface ProductMember { id: string; email: string; owner: boolean; role: string; products: { productId: string; role: "Manager" | "User" }[] }
/** Owner of the Workspace, or a Role in one Product; a null Role removes the member from that Product. */
export type MemberRoleChange = { role: "Owner" | "Manager" | "User" | null; productId?: string };
export interface NewInvitation { email: string; role: "Owner" | "Manager" | "User"; productId?: string }

const ADMINISTERS = new Set(["Owner", "Platform administrator"]);
/** Whether the viewer manages the Product's members: its Managers, Owners and Platform administrators. */
export const managesMembers = (p: ProductSummary) => ADMINISTERS.has(p.role) || p.role === "Manager";

/**
 * Members with their Role in each Product the viewer manages, and the invitation form.
 * A member's Role is its control: one select per Product. Choosing Owner makes them Owner of the
 * whole Workspace; choosing a Product Role for an Owner ends their being Owner.
 */
export function ProductMembers({ description, members, products, viewer, owner, locked, link, onRole, onRemove, onInvite }: {
  description: string; members: ProductMember[]; products: ProductSummary[]; viewer: string; owner: boolean; locked: boolean; link: string;
  onRole: (member: ProductMember, change: MemberRoleChange) => void;
  onRemove: (member: ProductMember) => void;
  onInvite: (invitation: NewInvitation) => Promise<boolean>;
}) {
  const managed = products.filter(managesMembers);
  const several = products.length > 1;
  const [email, setEmail] = useState(""), [role, setRole] = useState<NewInvitation["role"]>("User"), [product, setProduct] = useState("");
  const invitedProduct = managed.find(p => p.id === product)?.id ?? managed[0]?.id;
  const roleSelect = (m: ProductMember, p: ProductSummary) => {
    const value = m.owner ? "Owner" : m.products.find(r => r.productId === p.id)?.role ?? "";
    const label = several ? `Role for ${m.email} in ${p.name}` : `Role for ${m.email}`;
    return <select key={p.id} className="fit" disabled={locked} aria-label={label} value={value} onChange={e => {
      const next = e.target.value;
      onRole(m, next === "Owner" ? { role: "Owner" } : { role: next === "" ? null : next as "Manager" | "User", productId: p.id });
    }}>
      {owner && <option>Owner</option>}
      <option>Manager</option><option>User</option>
      {!m.owner && (several || value === "") && <option value="">No role</option>}
    </select>;
  };
  return <>
    <Group description={description}>
      {members.map(m => <Item key={m.id} label={<span className="member"><span className="member-mark" aria-hidden="true">{m.email.slice(0, 1).toUpperCase()}</span><span className="member-email">{m.email}</span>{m.id === viewer && <span className="member-you">You</span>}</span>}>
        {m.owner && !owner ? <span className="settings-value">Owner</span> : managed.map(p => roleSelect(m, p))}
        {(owner || !m.owner) && <button className="btn-quiet danger" disabled={locked} aria-label={`Remove ${m.email}`} onClick={() => onRemove(m)}>Remove</button>}
      </Item>)}
    </Group>
    <Group title="Invite a member" description="They get a link that expires in 7 days.">
      <form aria-label="Invite a member" onSubmit={e => {
        e.preventDefault();
        void onInvite({ email, role, ...(role === "Owner" ? {} : { productId: invitedProduct }) }).then(done => { if (done) setEmail(""); });
      }}>
        <div className="settings-row settings-inline">
          <input type="email" required aria-label="Email address" placeholder="name@company.com" value={email} onChange={e => setEmail(e.target.value)} />
          <select className="fit" aria-label="Role" value={role} onChange={e => setRole(e.target.value as NewInvitation["role"])}>{(owner ? ["User", "Manager", "Owner"] : ["User", "Manager"]).map(r => <option key={r}>{r}</option>)}</select>
          {role !== "Owner" && managed.length > 1 && <select className="fit" aria-label="Invite to product" value={invitedProduct} onChange={e => setProduct(e.target.value)}>{managed.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
          <button className="btn" disabled={locked}>Create invitation link</button>
        </div>
      </form>
      {link && <Field label="Invitation link (expires in 7 days)" hint="Share it with the invited person. They must sign in with that verified email address."><input readOnly value={link} onFocus={e => e.target.select()} /></Field>}
    </Group>
  </>;
}

import { Field,Group,Item,Row } from "./settings-group.tsx";

/** A Product's API key as the Python service lists it: never its secret. */
export interface ProductApiKey { id: string; name: string; preview: string; createdAt: string }

/**
 * The selected Product's API keys (OPE-42): its Managers and the Workspace's Owners create one per application,
 * see its secret once, and revoke it. A key evaluates only this Product, at `/oerep/v1/products/{key}`.
 */
export function ProductApiKeys({product,keys,name,secret,locked,onName,onCreate,onRevoke,onCopy}:{
  product:{key:string;name:string};keys:ProductApiKey[];name:string;secret:string;locked:boolean;
  onName:(name:string)=>void;onCreate:()=>void;onRevoke:(key:ProductApiKey)=>void;onCopy:(text:string,done:string)=>void;
}){
  return <Group title={`API keys for ${product.name}`} description="Your application evaluates this Product with these keys. A key evaluates no other Product.">
    <Item label="Product key" description="Your application names the Product with it when it evaluates."><code className="settings-value">{product.key}</code><button className="btn-quiet" onClick={()=>onCopy(product.key,"Product key copied")}>Copy</button></Item>
    {keys.map(k=><Item key={k.id} label={k.name} description={<><code>{k.preview}</code> · Created {new Date(k.createdAt).toLocaleDateString()}</>}><button className="btn-quiet danger" disabled={locked} aria-label={`Revoke ${k.name}`} onClick={()=>onRevoke(k)}>Revoke</button></Item>)}
    <form aria-label="Create an API key" onSubmit={e=>{e.preventDefault();onCreate();}}>
      <Row label="Key name" description="Create one key per application. Its secret is shown only once.">{[<input key="name" required maxLength={200} value={name} onChange={e=>onName(e.target.value)}/>,<button key="create" className="btn" disabled={locked}>Create API key</button>]}</Row>
    </form>
    {secret&&<Field label="Save this secret securely" hint="It will not be shown again."><input readOnly type="password" value={secret} onFocus={e=>e.target.select()}/></Field>}
    {secret&&<Item label="Copy the secret to your application’s configuration."><button className="btn" onClick={()=>onCopy(secret,"API key copied")}>Copy key</button></Item>}
  </Group>;
}

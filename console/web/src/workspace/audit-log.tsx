import { useEffect, useRef, useState } from 'react';
import { request } from './client.ts';
export interface AuditEntry {
  id:string; at:string; actorEmail:string; action:string; targetKind:string; targetName:string;
  aspect:string|null; reason:string|null;
  changes:{field:string; title?:string|null; before:unknown; after:unknown; beforeName?:string|null; afterName?:string|null; productName?:string|null}[];
}
export interface AuditPage {entries:AuditEntry[]; next:number|null}
const frActions:Record<string,string>={created:'a créé',changed:'a modifié',archived:'a archivé',restored:'a restauré',deleted:'a supprimé',removed:'a retiré',invited:'a invité',joined:'a rejoint',revoked:'a révoqué'};
const frKinds:Record<string,string>={'Workspace':'l’espace de travail','Product':'le produit','Privilege':'le privilège','Group':'le groupe','Tag':'le tag','Tier':'le niveau','Tier variant':'la variante','Status policy':'la politique de statut','Organization':'l’organisation','Application user':'l’utilisateur applicatif','Member':'le membre','API key':'la clé API'};
function value(v:unknown,fr:boolean):string {return v==null?'—':typeof v==='boolean'?(v?(fr?'Oui':'Yes'):(fr?'Non':'No')):typeof v==='object'?JSON.stringify(v):String(v);}
export function AuditEntries({entries,language='en'}:{entries:AuditEntry[];language?:string}){
  const fr=language.startsWith('fr');
  return <section className="panel">{!entries.length&&<p>{fr?'Aucun changement enregistré.':'No changes recorded yet.'}</p>}{entries.map(e=><article key={e.id}>
    <p>{e.actorEmail} {fr?(frActions[e.action]??e.action):e.action} {fr?(frKinds[e.targetKind]??e.targetKind):e.targetKind} {e.targetName}{e.aspect?(fr?` · ${{terms:'conditions',tier:'niveau',role:'rôle',serviceTier:'offre de service'}[e.aspect]??e.aspect}`:`’s ${{serviceTier:'service tier'}[e.aspect]??e.aspect}`):''}</p>
    <time dateTime={e.at}>{new Date(e.at).toLocaleString(language)}</time>
    {e.reason&&<p>{fr?'Motif':'Reason'}: {e.reason}</p>}
    {!!e.changes.length&&<details><summary>{fr?`Afficher ${e.changes.length} changement${e.changes.length===1?'':'s'}`:`Show ${e.changes.length} change${e.changes.length===1?'':'s'}`}</summary><dl>{e.changes.map((c,i)=><div key={i}><dt>{c.title??c.field}{c.productName?` · ${c.productName}`:''}</dt><dd>{c.beforeName??value(c.before,fr)} → {c.afterName??value(c.after,fr)}</dd></div>)}</dl></details>}
  </article>)}</section>;
}
interface LegacyEntry {id:string;at:string;actor:string;action:string;reason:string|null}
function normalize(p:AuditPage|LegacyEntry[]):AuditPage {return Array.isArray(p)?{entries:p.map(e=>({...e,actorEmail:e.actor,targetKind:'',targetName:'',aspect:null,changes:[]})),next:null}:p;}
export function AuditLog({workspaceId,language='en'}:{workspaceId:string;language?:string}){
  const [page,setPage]=useState<AuditPage>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  // A refresh starts a new generation and ends it when its page arrives: "Load more" from an older page is dropped.
  const generation=useRef(0);
  useEffect(()=>{let active=true;async function load(){const mine=++generation.current;try{const p=await request<AuditPage|LegacyEntry[]>(`/api/workspaces/${workspaceId}/audit`);if(active&&mine===generation.current){generation.current+=1;setBusy(false);setPage(normalize(p));setError('');}}catch(e){if(active&&mine===generation.current){generation.current+=1;setBusy(false);setPage(undefined);setError((e as Error).message);}}}void load();window.addEventListener('focus',load);return()=>{active=false;generation.current+=1;window.removeEventListener('focus',load);};},[workspaceId]);
  async function more(){if(!page?.next||busy)return;const mine=generation.current,shown=page;setBusy(true);try{const p=normalize(await request<AuditPage|LegacyEntry[]>(`/api/workspaces/${workspaceId}/audit?before=${shown.next}`));if(mine!==generation.current)return;setPage({entries:[...shown.entries,...p.entries],next:p.next});setError('');}catch(e){if(mine===generation.current)setError((e as Error).message);}finally{if(mine===generation.current)setBusy(false);}}
  return <>{error&&<p role="alert">{error}</p>}{page?<><AuditEntries entries={page.entries} language={language}/>{page.next&&<button disabled={busy} onClick={()=>void more()}>{language.startsWith('fr')?'Afficher plus':'Load more'}</button>}</>:!error&&<p role="status">{language.startsWith('fr')?'Chargement…':'Loading…'}</p>}</>;
}

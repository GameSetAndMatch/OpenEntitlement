import type {TierRow} from "./product-catalog.ts";

/** Archive, restore or delete a Tier, from its edit form (ADR-0008). */
export function TierAvailability({tier,busy,onArchive,onRestore,onDelete}:{tier:TierRow;busy:boolean;onArchive:()=>void;onRestore:()=>void;onDelete:()=>void}){
  const archived=Boolean(tier.archivedAt);
  return <fieldset className="form-section tier-availability"><legend>Availability</legend>
    <p>{archived
      ?`Archived. Organizations on ${tier.name} keep it with all its variants. It can't be given to new Organizations or suggested as an upgrade.`
      :`Archive ${tier.name} to stop giving it to new Organizations. Current Organizations keep it. Only a Tier no Organization uses can be deleted.`}</p>
    <div className="tier-availability-actions">
      {archived
        ?<button type="button" className="btn" disabled={busy} onClick={onRestore}>Restore tier</button>
        :<button type="button" className="btn" disabled={busy} onClick={onArchive}>Archive tier</button>}
      <button type="button" className="btn-quiet danger" disabled={busy} onClick={onDelete}>Delete tier</button>
    </div>
  </fieldset>;
}

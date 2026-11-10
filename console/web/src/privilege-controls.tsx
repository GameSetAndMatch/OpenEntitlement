import { environmentMessage, type EnvironmentOverride } from "../../server/environment.ts";
export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={`toggle ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}>
      <span className="toggle-track" aria-hidden="true"><span className="knob" /></span>
      <span className="toggle-copy"><span className="toggle-text">{checked ? "Enabled" : "Disabled"}</span><small>{checked ? "Feature access included" : "Feature access not included"}</small></span>
    </button>
  );
}

/** Edits one privilege value with the right control for its type (spec §1.1, §1.2). */
export function EnvironmentNotice({binding,frozen=false}:{binding?:EnvironmentOverride;frozen?:boolean}){return binding||frozen?<p className="environment-notice" role="note">{binding?environmentMessage(binding):"Frozen to the Catalog default. This value cannot be changed manually."}</p>:null;}

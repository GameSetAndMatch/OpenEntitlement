import { useState } from "react";
import type { Meta, Plan } from "./api.ts";
import { configurationYaml } from "./configuration-export.ts";
import { useToast } from "./ui.tsx";

export function ConfigurationPanel({ meta, plans }: { meta: Meta; plans: Plan[] }) {
  const yaml = configurationYaml(meta, plans);
  const [copying, setCopying] = useState(false);
  const toast = useToast();
  async function copy() {
    setCopying(true);
    try { await navigator.clipboard.writeText(yaml); toast("YAML copied"); }
    catch { toast("Could not copy. Select the YAML below or download the file.", "err"); }
    finally { setCopying(false); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([yaml], { type: "application/yaml;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "openentitlement.snapshot.yaml";
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="panel configuration-panel" aria-labelledby="configuration-title">
    <div className="section-title"><h2 id="configuration-title">YAML configuration</h2><div className="row"><button className="btn" disabled={copying} onClick={() => void copy()}>{copying ? "Copying…" : "Copy YAML"}</button><button className="btn" onClick={download}>Download YAML</button></div></div>
    <p>Read-only snapshot of this instance’s catalog and tier defaults, using the current model’s <code>plans</code> field. Refresh to load changes made elsewhere.</p>
    <p>Assignments, overrides, grants, contracts, and usage are not included. This is not a backup or an importable configuration file; YAML import is not supported yet.</p>
    {!meta.capabilities.inspection && <p role="status" className="notice">This provider does not expose tier defaults. Only the catalog is included.</p>}
    <pre className="configuration-code" tabIndex={0} aria-label="Read-only YAML configuration"><code>{yaml}</code></pre>
  </section>;
}

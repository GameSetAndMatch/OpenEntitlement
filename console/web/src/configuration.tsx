import type { Meta, Plan } from "./api.ts";
import { configurationYaml } from "./configuration-export.ts";

export function ConfigurationPanel({ meta, plans }: { meta: Meta; plans: Plan[] }) {
  const yaml = configurationYaml(meta, plans);
  function download() {
    const url = URL.createObjectURL(new Blob([yaml], { type: "application/yaml;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "openentitlement.snapshot.yaml";
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="panel configuration-panel" aria-labelledby="configuration-title">
    <div className="section-title"><h2 id="configuration-title">YAML configuration</h2><button className="btn" onClick={download}>Download YAML</button></div>
    <p>Read-only snapshot of this instance’s catalog and tier defaults, using the current model’s <code>plans</code> field.</p>
    <p>Assignments, overrides, grants, contracts, and usage are not included. This is not a backup or an importable configuration file; YAML import is not supported yet.</p>
    {!meta.capabilities.inspection && <p role="status" className="notice">This provider does not expose tier defaults. Only the catalog is included.</p>}
    <pre className="configuration-code" tabIndex={0} aria-label="Read-only YAML configuration"><code>{yaml}</code></pre>
  </section>;
}

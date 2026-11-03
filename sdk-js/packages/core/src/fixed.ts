/** The fixed provider for self-hosted installs: everything on, nothing overridable (spec §6.4). */

import { validateValue, type Catalog, type PrivilegeDefinition } from "./catalog.ts";
import { Reason, type ResolutionDetails } from "./details.ts";
import { InvalidArgument } from "./errors.ts";
import type { Capabilities, Provider } from "./provider.ts";
import { UNLIMITED } from "./values.ts";

export class FixedProvider implements Provider {
  readonly metadata = { name: "fixed" };
  readonly capabilities: Capabilities = { overrides: false, grants: false, mutations: false, planCatalog: false, fixed: true };
  readonly #values = new Map<string, unknown>();

  /** `values` sets the fixed value per privilege key (validated). */
  constructor(catalog: Catalog, values: Record<string, unknown> = {}) {
    const configured = new Map(Object.entries(values));
    for (const p of catalog.privileges) {
      if (configured.has(p.key)) {
        const v = configured.get(p.key);
        configured.delete(p.key);
        const problem = validateValue(p, v);
        if (problem) throw new InvalidArgument(`fixed value: ${problem}`);
        this.#values.set(p.key, v);
      } else if (p.valueType === "boolean") this.#values.set(p.key, true);
      else if (p.valueType === "enum") this.#values.set(p.key, p.options[p.options.length - 1]);
      else if (p.unlimitedAllowed) this.#values.set(p.key, UNLIMITED);
      else throw new InvalidArgument(`${p.key} does not allow UNLIMITED; configure a fixed value for it (Requirement 6.4.2)`);
    }
    if (configured.size > 0) throw new InvalidArgument(`unknown privileges in fixed values: ${[...configured.keys()].join(", ")}`);
  }

  async resolve(privilege: PrivilegeDefinition): Promise<ResolutionDetails> {
    return { privilege: privilege.key, value: this.#values.get(privilege.key), reason: Reason.FIXED, grants: [], staleOverrides: [] };
  }
}

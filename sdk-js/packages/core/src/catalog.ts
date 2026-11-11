/** The catalog: features and privileges declared in application code (spec §1.1). */

import { InvalidArgument } from "./errors.ts";
import { decodeValue, isInt, isUnlimited, UNLIMITED, type Value } from "./values.ts";

export const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

export type ValueType = "boolean" | "integer" | "enum";

export interface PrivilegeDefinition {
  readonly key: string;
  readonly valueType: ValueType;
  readonly default: Value;
  readonly unlimitedAllowed: boolean;
  readonly options: readonly string[];
  /** Filled in by the catalog. */
  readonly feature: string;
}

export interface FeatureDefinition {
  readonly code: string;
  readonly name: string;
  readonly description?: string;
  readonly privileges: readonly PrivilegeDefinition[];
  readonly gate?: string;
}

type PrivilegeInput = Omit<PrivilegeDefinition, "feature">;

export function boolean(key: string, opts: { default?: boolean } = {}): PrivilegeInput {
  return { key, valueType: "boolean", default: opts.default ?? false, unlimitedAllowed: false, options: [] };
}

export function integer(key: string, opts: { default?: number | typeof UNLIMITED; unlimitedAllowed?: boolean } = {}): PrivilegeInput {
  return { key, valueType: "integer", default: opts.default ?? 0, unlimitedAllowed: opts.unlimitedAllowed ?? false, options: [] };
}

export function enumeration(key: string, options: readonly string[], opts: { default?: string } = {}): PrivilegeInput {
  return { key, valueType: "enum", default: opts.default ?? options[0] ?? "", unlimitedAllowed: false, options: [...options] };
}

export function feature(
  code: string,
  name: string,
  privileges: readonly PrivilegeInput[],
  opts: { description?: string; gate?: string } = {},
): FeatureDefinition {
  return { code, name, privileges: privileges.map((p) => ({ ...p, feature: code })), ...opts };
}

/** Return an error message if `value` is invalid for the privilege (Requirement 1.5.6). */
export function validateValue(p: PrivilegeDefinition, value: unknown): string | undefined {
  switch (p.valueType) {
    case "boolean":
      return typeof value === "boolean" ? undefined : `${p.key} expects a boolean`;
    case "integer":
      if (isUnlimited(value)) return p.unlimitedAllowed ? undefined : `${p.key} does not allow UNLIMITED`;
      return isInt(value) ? undefined : `${p.key} expects an integer or UNLIMITED`;
    case "enum":
      return typeof value === "string" && p.options.includes(value) ? undefined : `${p.key} expects one of ${JSON.stringify(p.options)}`;
  }
}

export function gateKey(f: FeatureDefinition): string {
  return f.gate ?? f.privileges[0]!.key;
}

/** A validated set of features (Requirement 1.1.7: validated eagerly). */
export class Catalog {
  readonly #features = new Map<string, FeatureDefinition>();
  readonly #privileges = new Map<string, PrivilegeDefinition>();

  constructor(features: Iterable<FeatureDefinition>) {
    for (const f of features) this.#add(f);
  }

  #add(f: FeatureDefinition): void {
    if (!KEY_PATTERN.test(f.code)) throw new InvalidArgument(`invalid feature code "${f.code}"`);
    if (this.#features.has(f.code)) throw new InvalidArgument(`duplicate feature code "${f.code}"`);
    if (!f.name) throw new InvalidArgument(`feature "${f.code}" needs a name`);
    if (f.privileges.length === 0) throw new InvalidArgument(`feature "${f.code}" declares no privileges`);
    if (f.privileges.length > 1 && f.gate === undefined)
      throw new InvalidArgument(`feature "${f.code}" has several privileges and must name a gate`);
    if (f.gate !== undefined && !f.privileges.some((p) => p.key === f.gate))
      throw new InvalidArgument(`gate "${f.gate}" is not a privilege of feature "${f.code}"`);
    const seen = new Set<string>();
    const attached: PrivilegeDefinition[] = [];
    for (const p of f.privileges) {
      if (!KEY_PATTERN.test(p.key)) throw new InvalidArgument(`invalid privilege key "${p.key}"`);
      if (this.#privileges.has(p.key) || seen.has(p.key)) throw new InvalidArgument(`duplicate privilege key "${p.key}"`);
      seen.add(p.key);
      if (p.valueType === "enum" && (p.options.length === 0 || new Set(p.options).size !== p.options.length))
        throw new InvalidArgument(`enum "${p.key}" needs non-empty, unique options`);
      if (p.valueType !== "integer" && p.unlimitedAllowed)
        throw new InvalidArgument(`"${p.key}": only integer privileges may allow UNLIMITED`);
      const problem = validateValue(p, p.default);
      if (problem) throw new InvalidArgument(`invalid default: ${problem}`);
      attached.push(Object.freeze({ ...p, options: Object.freeze([...p.options]), feature: f.code }));
    }
    const gate = attached.find((p) => p.key === gateKey(f))!;
    if (gate.valueType === "enum") throw new InvalidArgument(`gate "${gate.key}" must be boolean or integer`);
    const frozen = Object.freeze({ ...f, privileges: Object.freeze(attached) });
    this.#features.set(f.code, frozen);
    for (const p of attached) this.#privileges.set(p.key, p);
  }

  privilege(key: string): PrivilegeDefinition | undefined {
    return this.#privileges.get(key);
  }

  feature(code: string): FeatureDefinition | undefined {
    return this.#features.get(code);
  }

  get features(): FeatureDefinition[] {
    return [...this.#features.values()];
  }

  get privileges(): PrivilegeDefinition[] {
    return [...this.#privileges.values()];
  }

  /** Load the JSON catalog format used by the conformance suite. */
  static fromJSON(data: { features: Array<Record<string, any>> }): Catalog {
    return new Catalog(
      data.features.map((f) => ({
        code: f.code,
        name: f.name,
        description: f.description,
        gate: f.gate,
        privileges: (f.privileges as Array<Record<string, any>>).map((p) => {
          const valueType = p.valueType as ValueType;
          const fallback = valueType === "boolean" ? false : valueType === "integer" ? 0 : (p.options?.[0] ?? "");
          return {
            key: p.key,
            valueType,
            default: p.default === undefined ? fallback : (decodeValue(p.default) as Value),
            unlimitedAllowed: Boolean(p.unlimitedAllowed),
            options: p.options ?? [],
            feature: f.code,
          };
        }),
      })),
    );
  }
}

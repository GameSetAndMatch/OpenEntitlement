/** Value types: UNLIMITED, limits, JSON encoding (spec §1.2). */

class UnlimitedValue {
  readonly unlimited = true as const;
  /** JSON.stringify(UNLIMITED) === '{"unlimited":true}' (Requirement 1.2.3). */
  toJSON(): { unlimited: true } {
    return { unlimited: true };
  }
  toString(): string {
    return "UNLIMITED";
  }
  [Symbol.toPrimitive](hint: string): string {
    if (hint === "number") throw new TypeError("UNLIMITED is not a number; use fits()/isUnlimited()");
    return "UNLIMITED";
  }
}

/**
 * The distinct "no limit" value (Requirement 1.2.1). Not a number, not null, not Infinity:
 * a frozen singleton that serializes to {"unlimited": true}. Compare with `isUnlimited` or `===`.
 */
export const UNLIMITED: Unlimited = Object.freeze(new UnlimitedValue());
export type Unlimited = UnlimitedValue;

/** An integer privilege value. */
export type Limit = number | Unlimited;
/** Any privilege value. */
export type Value = boolean | number | string | Unlimited;

export function isUnlimited(value: unknown): value is Unlimited {
  return value === UNLIMITED;
}

export function isInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

/** UNLIMITED + n = UNLIMITED (Requirement 1.2.4). */
export function addLimit(limit: Limit, amount: number): Limit {
  return isUnlimited(limit) ? UNLIMITED : limit + amount;
}

/** Whether a finite total fits within a limit (Requirement 1.2.4). */
export function fits(total: number, limit: Limit): boolean {
  return isUnlimited(limit) || total <= limit;
}

export function encodeValue(value: unknown): unknown {
  return isUnlimited(value) ? { unlimited: true } : value;
}

export function decodeValue(raw: unknown): unknown {
  if (raw !== null && typeof raw === "object") {
    const keys = Object.keys(raw);
    if (keys.length === 1 && (raw as { unlimited?: unknown }).unlimited === true) return UNLIMITED;
    throw new TypeError(`not an OpenEntitlement value: ${JSON.stringify(raw)}`);
  }
  return raw;
}

/** Recursively encode UNLIMITED (and Dates as ISO strings) into plain JSON. */
export function encodeJson(obj: unknown): unknown {
  if (isUnlimited(obj)) return { unlimited: true };
  if (obj instanceof Date) return obj.toISOString();
  if (Array.isArray(obj)) return obj.map(encodeJson);
  if (obj !== null && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = encodeJson(v);
    return out;
  }
  return obj;
}

/** Locks that serialize `guard` per (organization, privilege) (spec §5.3). */

/** Requirement 5.2.3: organization and privilege, never subject or resource. */
export function lockKey(organizationId: string, privilege: string): string {
  return `oe:${organizationId}:${privilege}`;
}

export interface Lock<Tx = unknown> {
  readonly domain: string;
  /** Run `fn(tx)` holding exclusive ownership of `key`; `tx` is lock-specific (or undefined). */
  run<R>(key: string, fn: (tx: Tx) => Promise<R>): Promise<R>;
}

/**
 * Serializes within ONE process only (Requirement 5.3.2): a promise chain per key.
 * Multi-instance deployments must use a shared lock, e.g. `PostgresAdvisoryLock`.
 */
export class InProcessLock implements Lock<undefined> {
  readonly domain = "process";
  readonly #tails = new Map<string, Promise<void>>();

  async run<R>(key: string, fn: (tx: undefined) => Promise<R>): Promise<R> {
    const prev = this.#tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    const tail = prev.then(() => mine);
    this.#tails.set(key, tail);
    await prev;
    try {
      return await fn(undefined);
    } finally {
      release();
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    }
  }
}

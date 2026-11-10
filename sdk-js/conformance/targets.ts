/** Conformance targets: one per provider. */

import { capabilityTags, InMemoryProvider } from "@openentitlement/core";
import type { Counter, Seeder, Target, World } from "./steps.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The sleep in count() widens the race window, so a missing lock would show as overshoot. */
class MemoryCounter implements Counter {
  n = 0;
  async count() {
    const n = this.n;
    await sleep(2);
    return n;
  }
  async increment() {
    this.n += 1; // atomic in JS: only an unserialized check-then-act can overshoot
  }
  async value() {
    return this.n;
  }
}

export const memoryTarget: Target = {
  name: "in-memory",
  tags: capabilityTags(new InMemoryProvider().capabilities),
  async setup(w: World) {
    w.makeClient(new InMemoryProvider());
    w.seeder = w.client!.admin as unknown as Seeder;
  },
  async counter() {
    return new MemoryCounter();
  },
};

export const fixedTarget: Target = {
  name: "fixed",
  tags: new Set(["fixed"]),
  async setup() {
    throw new Error("fixed targets do not seed plans");
  },
  async counter() {
    return new MemoryCounter();
  },
};

// ------------------------------------------------------------------ Postgres

export async function postgresTarget(dsn: string): Promise<Target> {
  const { default: pg } = await import("pg");
  const { PostgresProvider, PostgresAdvisoryLock, migrate } = await import("@openentitlement/core/postgres");
  const pool = new pg.Pool({ connectionString: dsn, max: 25 });
  await migrate(pool);
  await pool.query("create table if not exists oe_conformance_counter (org text primary key, n integer not null)");
  return {
    name: "postgres",
    tags: capabilityTags(new PostgresProvider({ pool }).capabilities),
    async setup(w: World) {
      await pool.query("truncate oe_audit, oe_grant, oe_override, oe_assignment, oe_plan_value, oe_plan, oe_conformance_counter restart identity cascade");
      w.makeClient(new PostgresProvider({ pool }), new PostgresAdvisoryLock({ pool }));
      w.seeder = w.client!.admin as unknown as Seeder;
    },
    async counter(org: string) {
      await pool.query("insert into oe_conformance_counter (org, n) values ($1, 0) on conflict (org) do update set n = 0", [org]);
      return {
        async count(tx: any) {
          const { rows } = await tx.query("select n from oe_conformance_counter where org = $1", [org]);
          await sleep(2);
          return Number(rows[0].n);
        },
        async increment(tx: any) {
          await tx.query("update oe_conformance_counter set n = n + 1 where org = $1", [org]);
        },
        async value() {
          const { rows } = await pool.query("select n from oe_conformance_counter where org = $1", [org]);
          return Number(rows[0].n);
        },
      };
    },
    async teardown() {
      await pool.end();
    },
  };
}

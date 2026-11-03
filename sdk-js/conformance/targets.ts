/** Conformance targets: one per provider. */

import { capabilityTags, InMemoryProvider, UNLIMITED, type Catalog, type Plan } from "@openentitlement/core";
import { StripeEntitlementsProvider } from "@openentitlement/stripe";
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

// ------------------------------------------------------------------ Stripe (fake account)

class FakeStripe {
  plans = new Map<string, Plan>();
  values = new Map<string, Map<string, unknown>>();
  customers = new Map<string, string>(); // org -> plan
  readonly catalog: Catalog;
  constructor(catalog: Catalog) {
    this.catalog = catalog;
  }
  lookupKeys(planId: string): string[] {
    const keys: string[] = [];
    for (const [k, v] of this.values.get(planId) ?? []) {
      const p = this.catalog.privilege(k)!;
      if (p.valueType === "boolean") {
        if (v === true) keys.push(k);
      } else keys.push(v === UNLIMITED ? `${k}:unlimited` : `${k}:${String(v)}`);
    }
    return keys;
  }
  transport = async (url: string) => {
    const org = new URL(url).searchParams.get("customer")!.replace(/^cus_/, "");
    const plan = this.customers.get(org);
    const data = (plan ? this.lookupKeys(plan) : []).map((k, i) => ({ id: `ent_${i}`, object: "entitlements.active_entitlement", lookup_key: k }));
    return { status: 200, body: JSON.stringify({ object: "list", data, has_more: false }) };
  };
}

export const stripeTarget: Target = {
  name: "stripe",
  tags: new Set(),
  async setup(w: World) {
    const fake = new FakeStripe(w.catalog);
    w.makeClient(
      new StripeEntitlementsProvider({
        apiKey: "sk_test_conformance",
        customerFor: (org) => (fake.customers.has(org) ? `cus_${org}` : undefined),
        transport: fake.transport,
        cacheTtl: 0,
      }),
    );
    const unsupported = async () => {
      throw new Error("Stripe has no overrides/grants; scenario should have been skipped");
    };
    w.seeder = {
      async upsertPlan(plan: Plan) {
        fake.plans.set(plan.id, plan);
      },
      async setPlanValue(planId: string, privilege: string, value: unknown) {
        if (!fake.values.has(planId)) fake.values.set(planId, new Map());
        fake.values.get(planId)!.set(privilege, value);
      },
      async assignPlan(org: string, planId: string | null) {
        if (planId === null) fake.customers.delete(org);
        else fake.customers.set(org, planId);
      },
      createOverride: unsupported,
      createGrant: unsupported,
    };
  },
  async counter() {
    return new MemoryCounter();
  },
};

// ------------------------------------------------------------------ Postgres

export async function postgresTarget(dsn: string): Promise<Target> {
  const { default: pg } = await import("pg");
  const { PostgresProvider, PostgresAdvisoryLock, migrate } = await import("@openentitlement/postgres");
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

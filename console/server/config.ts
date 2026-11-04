/** Console configuration: which provider sits behind the console, chosen by environment. */

import { readFileSync } from "node:fs";
import {
  AuditLog,
  Catalog,
  createClient,
  decodeValue,
  FixedProvider,
  InMemoryProvider,
  type EntitlementClient,
  type Lock,
  type Provider,
} from "@openentitlement/core";

export interface ConsoleConfig {
  port: number;
  host?: string;
  /** memory | postgres | fixed */
  provider: string;
  catalogPath: string;
  /** Seed demo data into an empty in-memory provider. */
  seedDemo: boolean;
  /** Bearer token required on /api/* when set. */
  adminToken?: string;
  /** Bearer token required on /oerep/* when set. */
  evalToken?: string;
  databaseUrl?: string;
  /** JSON {privilegeKey: value} for the fixed provider. */
  fixedValues?: Record<string, unknown>;
  staticDir: string;
}

const here = new URL(".", import.meta.url);

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ConsoleConfig {
  const provider = env.OE_PROVIDER ?? "memory";
  if (env.OE_ADMIN_TOKEN && env.OE_ADMIN_TOKEN === env.OE_EVAL_TOKEN) throw new Error("admin and evaluation tokens must differ");
  return {
    port: Number(env.PORT ?? 8787),
    host: env.OE_HOST ?? "127.0.0.1",
    provider,
    catalogPath: env.OE_CATALOG ?? new URL("../../spec/assets/catalog.json", here).pathname,
    seedDemo: (env.OE_SEED ?? (provider === "memory" ? "demo" : "none")) === "demo",
    ...(env.OE_ADMIN_TOKEN ? { adminToken: env.OE_ADMIN_TOKEN } : {}),
    ...(env.OE_EVAL_TOKEN ? { evalToken: env.OE_EVAL_TOKEN } : {}),
    ...(env.DATABASE_URL ? { databaseUrl: env.DATABASE_URL } : {}),
    ...(env.OE_FIXED_VALUES ? { fixedValues: JSON.parse(env.OE_FIXED_VALUES) } : {}),
    staticDir: env.OE_STATIC_DIR ?? new URL("../web/dist/", here).pathname,
  };
}

export interface Runtime {
  client: EntitlementClient;
  catalog: Catalog;
  /** In-process audit forwarder (mirrors what reaches mutation hooks). */
  audit: AuditLog;
  close(): Promise<void>;
}

export async function buildRuntime(cfg: ConsoleConfig): Promise<Runtime> {
  const catalog = Catalog.fromJSON(JSON.parse(readFileSync(cfg.catalogPath, "utf8")));
  const audit = new AuditLog();
  let provider: Provider;
  let lock: Lock<any> | undefined;
  let close = async () => {};

  switch (cfg.provider) {
    case "memory":
      provider = new InMemoryProvider();
      break;
    case "postgres": {
      if (!cfg.databaseUrl) throw new Error("OE_PROVIDER=postgres needs DATABASE_URL");
      const { default: pg } = await import("pg");
      const { PostgresProvider, PostgresAdvisoryLock } = await import("@openentitlement/postgres");
      const pool = new pg.Pool({ connectionString: cfg.databaseUrl });
      provider = new PostgresProvider({ pool, autoMigrate: true });
      lock = new PostgresAdvisoryLock({ pool });
      close = () => pool.end();
      break;
    }
    case "fixed":
      provider = new FixedProvider(
        catalog,
        Object.fromEntries(Object.entries(cfg.fixedValues ?? {}).map(([k, v]) => [k, decodeValue(v)])),
      );
      break;
    default:
      throw new Error(`unknown OE_PROVIDER "${cfg.provider}" (memory | postgres | fixed)`);
  }

  try { await provider.initialize?.(); } catch (error) { await close(); throw error; }
  const client = createClient({ provider, catalog, mutationHooks: [audit], ...(lock ? { lock } : {}) });
  if (cfg.seedDemo) await seedDemo(client);
  return { client, catalog, audit, close };
}

/** Demo data: the conformance plans plus a few customers in interesting states. */
export async function seedDemo(client: EntitlementClient): Promise<void> {
  const plans = JSON.parse(readFileSync(new URL("../../spec/assets/plans.json", here), "utf8"));
  const meta = { actor: "seed", reason: "demo data" };
  const a = client.admin;
  for (const p of plans.plans) {
    const { values, ...plan } = p;
    await a.upsertPlan(plan, meta);
    for (const [k, v] of Object.entries(values)) await a.setPlanValue(p.id, k, decodeValue(v), meta);
  }
  await a.assignPlan("acme", "business", { ...meta, channel: "contract" });
  await a.createOverride({ organizationId: "acme", privilege: "seats.max", value: 250 }, { actor: "sales@demo", reason: "MSA #42: 250 seats" });
  await a.createOverride({ organizationId: "acme", privilege: "sso.connections.max", value: 10 }, { actor: "sales@demo", reason: "MSA #42: 10 IdPs" });
  await a.assignPlan("globex", "pro", { ...meta, channel: "card" });
  await a.createGrant({ organizationId: "globex", privilege: "api_calls.monthly", amount: 50_000 }, { actor: "support@demo", reason: "launch-week goodwill" });
  await a.createGrant({ organizationId: "globex", subjectId: "hank", privilege: "api_calls.monthly", amount: 5_000 }, { actor: "support@demo", reason: "personal pack" });
  await a.assignPlan("initech", "pro_trial", { ...meta, channel: "card" });
  await a.createOverride({ organizationId: "initech", privilege: "projects.max", value: 8 }, { actor: "sales@demo", reason: "trial extension: 8 projects" });
  await a.assignPlan("hooli", "free", meta);
  await a.assignPlan("umbrella", "enterprise", { ...meta, channel: "contract" });
  await a.createOverride({ organizationId: "umbrella", privilege: "projects.max", value: 5000, planFamily: "enterprise" }, { actor: "sales@demo", reason: "MSA #77" });
  await a.assignPlan("umbrella", "business", { actor: "billing@demo", reason: "downgrade at renewal" }); // leaves a stale override
}

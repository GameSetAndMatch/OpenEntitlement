/** Console configuration: which provider sits behind the console, chosen by environment. */

import {standaloneCatalog} from "./workspace/privilege-definition.ts";
import {environmentOverride,type EnvironmentOverrides} from "./environment.ts";
import {withEnvironmentOverrides} from "./environment-provider.ts";
import {parseDocument} from "yaml";
import { ContractStore } from "./contracts-store.ts";
import { readFileSync } from "node:fs";
import {
  AuditLog,
  Catalog,
  createClient,
  decodeValue,
  FixedProvider,
  InMemoryProvider,
  validateValue,
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
  environment?:EnvironmentOverrides;
  env?:NodeJS.ProcessEnv;
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
    seedDemo: env.OE_SEED === "demo",
    ...(env.OE_ADMIN_TOKEN ? { adminToken: env.OE_ADMIN_TOKEN } : {}),
    ...(env.OE_EVAL_TOKEN ? { evalToken: env.OE_EVAL_TOKEN } : {}),
    ...(env.DATABASE_URL
      ? { databaseUrl: env.DATABASE_URL }
      : env.PGHOST
        ? { databaseUrl: `postgresql://${encodeURIComponent(env.PGUSER ?? "oe")}:${encodeURIComponent(env.PGPASSWORD ?? "")}@${env.PGHOST}:${env.PGPORT ?? "5432"}/${encodeURIComponent(env.PGDATABASE ?? "oe")}` }
        : {}),
    ...(env.OE_FIXED_VALUES ? { fixedValues: JSON.parse(env.OE_FIXED_VALUES) } : {}),
    env:{...env},
    staticDir: env.OE_STATIC_DIR ?? new URL("../web/dist/", here).pathname,
  };
}

export interface Runtime {
  client: EntitlementClient;
  catalog: Catalog;
  /** In-process audit forwarder (mirrors what reaches mutation hooks). */
  audit: AuditLog;
  contracts: ContractStore;
  environment?:EnvironmentOverrides;
  catalogSource?:any;
  close(): Promise<void>;
}

export async function buildRuntime(cfg: ConsoleConfig): Promise<Runtime> {
  const document=parseDocument(readFileSync(cfg.catalogPath,"utf8"),{uniqueKeys:true});
  if(document.errors.length)throw new Error("Invalid Catalog YAML/JSON");
  const source=standaloneCatalog(document.toJS({maxAliasCount:0})) as {features:Array<Record<string,any>>};
  const catalog = Catalog.fromJSON(source);
  const environment:EnvironmentOverrides={...cfg.environment};
  const frozen:Record<string,unknown>={};
  for(const f of source.features)for(const p of f.privileges){
    if(p.hidden!==undefined&&typeof p.hidden!=="boolean"||f.hidden!==undefined&&typeof f.hidden!=="boolean")throw new Error("Catalog hidden must be a boolean");
    if(p.frozen!==undefined&&typeof p.frozen!=="boolean"||f.frozen!==undefined&&typeof f.frozen!=="boolean")throw new Error("Catalog frozen must be a boolean");
    if(p.frozen||f.frozen)frozen[p.key]=catalog.privilege(p.key)!.default;
    if(p.envVariable!==undefined){const def=catalog.privilege(p.key)!;environment[p.key]=environmentOverride(p.key,p.envVariable,def.valueType,value=>validateValue(def,value),cfg.env??process.env);}
  }
  const audit = new AuditLog();
  let provider: Provider;
  let lock: Lock<any> | undefined;
  let close = async () => {};
  let contracts = new ContractStore();

  switch (cfg.provider) {
    case "memory":
      provider = new InMemoryProvider();
      break;
    case "postgres": {
      if (!cfg.databaseUrl) throw new Error("OE_PROVIDER=postgres needs DATABASE_URL or PGHOST connection fields");
      const { default: pg } = await import("pg");
      const { PostgresProvider, PostgresAdvisoryLock } = await import("@openentitlement/postgres");
      const pool = new pg.Pool({ connectionString: cfg.databaseUrl });
      contracts = new ContractStore(pool);
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

  try { await provider.initialize?.(); await contracts.initialize(); } catch (error) { await close(); throw error; }
  const client = createClient({ provider:withEnvironmentOverrides(provider,environment,frozen), catalog, mutationHooks: [audit], ...(lock ? { lock } : {}) });
  if (cfg.seedDemo) await seedDemo(client);
  return { client, catalog, audit, contracts, environment, catalogSource:source, close };
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
  await a.createOverride({ organizationId: "acme", privilege: "seat_max", value: 250 }, { actor: "sales@demo", reason: "MSA #42: 250 seats" });
  await a.createOverride({ organizationId: "acme", privilege: "sso_connection_max", value: 10 }, { actor: "sales@demo", reason: "MSA #42: 10 IdPs" });
  await a.assignPlan("globex", "pro", { ...meta, channel: "card" });
  await a.createGrant({ organizationId: "globex", privilege: "api_calls_monthly", amount: 50_000 }, { actor: "support@demo", reason: "launch-week goodwill" });
  await a.createGrant({ organizationId: "globex", subjectId: "hank", privilege: "api_calls_monthly", amount: 5_000 }, { actor: "support@demo", reason: "personal pack" });
  await a.assignPlan("initech", "pro_trial", { ...meta, channel: "card" });
  await a.createOverride({ organizationId: "initech", privilege: "project_max", value: 8 }, { actor: "sales@demo", reason: "trial extension: 8 projects" });
  await a.assignPlan("hooli", "free", meta);
  await a.assignPlan("umbrella", "enterprise", { ...meta, channel: "contract" });
  await a.createOverride({ organizationId: "umbrella", privilege: "project_max", value: 5000, planFamily: "enterprise" }, { actor: "sales@demo", reason: "MSA #77" });
  await a.assignPlan("umbrella", "business", { actor: "billing@demo", reason: "downgrade at renewal" }); // leaves a stale override
}

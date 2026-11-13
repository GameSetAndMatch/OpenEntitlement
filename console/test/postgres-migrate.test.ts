import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { migrate } from "@openentitlement/core/postgres";

// Service instances (and test files run in parallel) may start together on a fresh database. Each migrates the schema:
// without serializing, two concurrent CREATE TABLE IF NOT EXISTS fail with 23505 on pg_type_typname_nsp_index.
test("concurrent schema migrations on a fresh database all succeed", { skip: !process.env.OE_PG_DSN }, async () => {
  const admin = new pg.Client({ connectionString: process.env.OE_PG_DSN });
  await admin.connect();
  try {
    for (let round = 0; round < 5; round++) {
      const name = "oe_migrate_" + randomBytes(6).toString("hex");
      await admin.query(`CREATE DATABASE ${name}`);
      const url = new URL(process.env.OE_PG_DSN!); url.pathname = "/" + name;
      const pools = Array.from({ length: 6 }, () => new pg.Pool({ connectionString: url.toString() }));
      try {
        const results = await Promise.allSettled(pools.map(pool => migrate(pool)));
        assert.deepEqual(results.filter(r => r.status === "rejected").map(r => String((r as PromiseRejectedResult).reason)), []);
      } finally {
        await Promise.all(pools.map(pool => pool.end()));
        await admin.query(`DROP DATABASE ${name}`);
      }
    }
  } finally { await admin.end(); }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { configFromEnv } from "../server/config.ts";
import { startServer } from "../server/main.ts";

test("PG fields preserve reserved password characters and DATABASE_URL takes precedence", () => {
  for (const password of ["strong#password", "literal%23", "a/b@c:d", "#%/@:"]) {
    const cfg = configFromEnv({ PGHOST: "localhost", PGPORT: "5433", PGUSER: "oe", PGPASSWORD: password, PGDATABASE: "oe" });
    // Client construction uses the actual driver parser, without opening a connection.
    const client = new pg.Client({ connectionString: cfg.databaseUrl });
    assert.equal(client.password, password);
    assert.equal(client.host, "localhost");
    assert.equal(client.port, 5433);
  }
  const url = "postgresql://explicit:pass@database:5432/explicit";
  assert.equal(configFromEnv({ DATABASE_URL: url, PGHOST: "ignored", PGPASSWORD: "ignored" }).databaseUrl, url);
  assert.equal(configFromEnv({}).databaseUrl, undefined);
  assert.equal(configFromEnv({}).seedDemo, false);
  assert.equal(configFromEnv({ OE_SEED: "demo" }).seedDemo, true);
});

test("Postgres service starts with reserved characters in raw PG password", { skip: !process.env.OE_PG_DSN }, async () => {
  const admin = new pg.Client({ connectionString: process.env.OE_PG_DSN });
  const name = "oe_pw_" + randomUUID().replaceAll("-", "");
  const password = "test#%/@:password";
  await admin.connect();
  let createdRole = false, createdDb = false;
  let running: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    await admin.query(`CREATE ROLE ${name} LOGIN PASSWORD '${password}'`); createdRole = true;
    await admin.query(`CREATE DATABASE ${name} OWNER ${name}`); createdDb = true;
    const cfg = configFromEnv({ OE_PROVIDER: "postgres", PGHOST: admin.host, PGPORT: String(admin.port), PGUSER: name, PGPASSWORD: password, PGDATABASE: name, OE_ADMIN_TOKEN: "config-test-admin", OE_EVAL_TOKEN: "config-test-eval", PORT: "0" });
    running = await startServer(cfg);
    const response = await fetch(running.url + "/api/plans", { headers: { authorization: "Bearer config-test-admin" } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), []);
  } finally {
    await running?.close();
    if (createdDb) await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
    if (createdRole) await admin.query(`DROP ROLE ${name}`);
    await admin.end();
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { cspSources, telemetryFromEnv } from "../server/telemetry.ts";
import { startServer } from "../server/main.ts";
import { configFromEnv } from "../server/config.ts";

test("telemetry is off unless a PostHog project key is configured", () => {
  assert.equal(telemetryFromEnv({}), undefined);
  assert.deepEqual(cspSources(undefined), { connect: "", worker: "" });
  assert.deepEqual(telemetryFromEnv({ OE_POSTHOG_KEY: "phc_abc123" }), { key: "phc_abc123", host: "https://us.i.posthog.com" });
  assert.deepEqual(telemetryFromEnv({ OE_POSTHOG_KEY: "phc_abc123", OE_POSTHOG_HOST: "https://eu.i.posthog.com/" }), { key: "phc_abc123", host: "https://eu.i.posthog.com" });
});

test("telemetry rejects secrets and unsafe hosts", () => {
  assert.throws(() => telemetryFromEnv({ OE_POSTHOG_KEY: "phx_personal_api_key" }), /project API key/);
  assert.throws(() => telemetryFromEnv({ OE_POSTHOG_KEY: "phc_abc", OE_POSTHOG_HOST: "http://us.i.posthog.com" }), /https origin/);
  assert.throws(() => telemetryFromEnv({ OE_POSTHOG_KEY: "phc_abc", OE_POSTHOG_HOST: "https://user@evil.example/path" }), /https origin/);
});

test("the CSP only widens to the ingestion host when telemetry is on", () => {
  const sources = cspSources({ key: "phc_abc", host: "https://us.i.posthog.com" });
  assert.equal(sources.connect, " https://us.i.posthog.com");
  assert.equal(sources.worker, " blob:");
});

test("/telemetry.json tells the browser nothing when telemetry is off", async () => {
  const service = await startServer({ ...configFromEnv({}), port: 0, seedDemo: false });
  try {
    const response = await fetch(service.url + "/telemetry.json");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {});
  } finally {
    await service.close();
  }
});

test("/telemetry.json exposes only the public project key and host when on", async () => {
  process.env.OE_POSTHOG_KEY = "phc_testkey";
  try {
    const service = await startServer({ ...configFromEnv({}), port: 0, seedDemo: false });
    try {
      const body = await (await fetch(service.url + "/telemetry.json")).json();
      assert.deepEqual(body, { posthog: { key: "phc_testkey", host: "https://us.i.posthog.com" } });
    } finally {
      await service.close();
    }
  } finally {
    delete process.env.OE_POSTHOG_KEY;
  }
});

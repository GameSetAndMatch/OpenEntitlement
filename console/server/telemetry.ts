/**
 * Opt-in product analytics and error tracking with PostHog.
 *
 * Off unless OE_POSTHOG_KEY is set. Self-hosted installations send nothing anywhere by default;
 * an operator who sets the key sends their own installation's events to their own PostHog project.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

export interface TelemetryConfig {
  /** PostHog project API key (phc_…). Public by design: it can only ingest events. */
  key: string;
  /** Ingestion host, e.g. https://us.i.posthog.com or https://eu.i.posthog.com. */
  host: string;
}

export function telemetryFromEnv(env: NodeJS.ProcessEnv = process.env): TelemetryConfig | undefined {
  const key = env.OE_POSTHOG_KEY?.trim();
  if (!key) return undefined;
  if (!/^phc_[A-Za-z0-9]+$/.test(key)) throw new Error("OE_POSTHOG_KEY must be a PostHog project API key (phc_…)");
  const host = (env.OE_POSTHOG_HOST?.trim() || "https://us.i.posthog.com").replace(/\/+$/, "");
  const url = new URL(host);
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username)
    throw new Error("OE_POSTHOG_HOST must be an https origin, e.g. https://us.i.posthog.com");
  return { key, host: url.origin };
}

/** Extra Content-Security-Policy sources the browser needs when telemetry is on; empty when off. */
export function cspSources(cfg: TelemetryConfig | undefined): { connect: string; worker: string } {
  if (!cfg) return { connect: "", worker: "" };
  // Session replay compresses recordings in a blob: worker; events go to the ingestion host.
  return { connect: ` ${cfg.host}`, worker: " blob:" };
}

/** GET /telemetry.json: what the browser bundle should load. Never includes anything secret. */
export function serveTelemetryConfig(req: IncomingMessage, res: ServerResponse, cfg: TelemetryConfig | undefined): boolean {
  if (req.method !== "GET" || new URL(req.url ?? "/", "http://local").pathname !== "/telemetry.json") return false;
  const body = JSON.stringify(cfg ? { posthog: { key: cfg.key, host: cfg.host } } : {});
  res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(body);
  return true;
}

type ErrorSink = {
  capture(error: unknown, properties?: Record<string, unknown>): void;
  event(distinctId: string, event: string, properties?: Record<string, unknown>): void;
  shutdown(): Promise<void>;
};
const noop: ErrorSink = { capture() {}, event() {}, async shutdown() {} };

/** Server-side exception tracking. Loads posthog-node only when telemetry is configured. */
export async function serverErrors(cfg: TelemetryConfig | undefined, service: string): Promise<ErrorSink> {
  if (!cfg) return noop;
  const { PostHog } = await import("posthog-node");
  const client = new PostHog(cfg.key, { host: cfg.host, enableExceptionAutocapture: true });
  return {
    capture(error, properties) {
      client.captureException(error, `service:${service}`, { service, ...properties });
    },
    event(distinctId, event, properties) {
      client.capture({ distinctId, event, properties: { service, ...properties } });
    },
    shutdown: () => client.shutdown(),
  };
}

let activeSink: ErrorSink = noop;
/** Install the process-wide error sink (call once at startup). */
export function setErrorSink(sink: ErrorSink): void {
  activeSink = sink;
}
/** Report an unexpected server error. A no-op unless telemetry is configured. */
export function reportError(error: unknown, properties?: Record<string, unknown>): void {
  try {
    activeSink.capture(error, properties);
  } catch {
    // Telemetry must never break request handling.
  }
}

/**
 * Record a product step (workspace created, API key created…) for journey funnels.
 * distinctId is the Account ID, the same ID the browser identifies with, so server and
 * browser events join into one person. Never pass emails, names or entitlement values.
 */
export function productEvent(distinctId: string, event: string, properties?: Record<string, unknown>): void {
  try {
    activeSink.event(distinctId, event, properties);
  } catch {
    // Telemetry must never break request handling.
  }
}

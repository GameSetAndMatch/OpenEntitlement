/**
 * Opt-in PostHog for the console: product analytics, error tracking, session replay,
 * heatmaps, dead/rage clicks and web vitals. The server decides (GET /telemetry.json);
 * when it reports nothing, PostHog is never downloaded.
 */

type PostHog = typeof import("posthog-js/dist/module.full.no-external.js").posthog;
let client: PostHog | undefined;

export async function initTelemetry(): Promise<void> {
  try {
    const response = await fetch("/telemetry.json", { credentials: "same-origin" });
    if (!response.ok) return;
    const config = (await response.json()) as { posthog?: { key: string; host: string } };
    if (!config.posthog) return;
    // The "full, no-external" build bundles replay, heatmaps and exception capture, so a strict
    // Content-Security-Policy only has to allow the ingestion host, never third-party scripts.
    const { posthog } = await import("posthog-js/dist/module.full.no-external.js");
    posthog.init(config.posthog.key, {
      api_host: config.posthog.host,
      defaults: "2026-08-30",
      person_profiles: "identified_only",
      capture_exceptions: true,
      enable_heatmaps: true,
      capture_dead_clicks: true,
      capture_performance: { web_vitals: true, network_timing: true },
      session_recording: { maskAllInputs: true, maskTextSelector: "[data-ph-mask]" },
    });
    client = posthog;
  } catch {
    // Analytics must never break the console.
  }
}

/** Associate events with the signed-in Account (not its email or name). */
export function identify(accountId: string): void {
  client?.identify(accountId);
}

export function resetIdentity(): void {
  client?.reset();
}

/**
 * PostHog for openentitlement.dev (US cloud, project 724077): product analytics,
 * error tracking, session replay, heatmaps, dead/rage clicks, web vitals and surveys.
 * The project API key is public by design: it can only send events.
 */
import posthog from 'posthog-js';

const POSTHOG_KEY = 'phc_uQox4WDrtUyubbgjzogAVEyn7TynQpfCa4Aprn5fNbmH';

// Only the production site reports; local previews and CI builds stay silent.
if (location.hostname === 'openentitlement.dev' || location.hostname.endsWith('.openentitlement.dev')) {
  posthog.init(POSTHOG_KEY, {
    api_host: 'https://us.i.posthog.com',
    ui_host: 'https://us.posthog.com',
    defaults: '2026-08-30',
    person_profiles: 'identified_only',
    capture_exceptions: true,
    enable_heatmaps: true,
    capture_dead_clicks: true,
    capture_performance: { web_vitals: true, network_timing: true },
    session_recording: { maskAllInputs: true },
  });
  trackJourney();
}

/** Named steps for the acquisition funnel; pageviews and clicks are captured automatically. */
function trackJourney(): void {
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const path = location.pathname;
    // Expressive Code's copy button on every code block (install commands, snippets).
    const copy = target.closest('.expressive-code .copy button');
    if (copy) {
      const block = copy.closest('.expressive-code');
      const language = block?.querySelector('pre')?.getAttribute('data-language') ?? undefined;
      const firstLine = block?.querySelector('.ec-line')?.textContent?.trim().slice(0, 80);
      posthog.capture('docs_code_copied', { path, language, first_line: firstLine });
      return;
    }
    const cta = target.closest<HTMLElement>('[data-ph-cta]');
    if (cta) posthog.capture('cta_clicked', { path, cta: cta.dataset.phCta });
    const link = target.closest<HTMLAnchorElement>('a[href]');
    if (!link) return;
    const url = new URL(link.href, location.href);
    if (url.hostname === location.hostname) return;
    const destination =
      url.hostname === 'github.com' ? 'github'
      : url.hostname.endsWith('docker.com') ? 'docker'
      : url.hostname === 'pypi.org' ? 'pypi'
      : url.hostname.endsWith('npmjs.com') ? 'npm'
      : 'other';
    posthog.capture('outbound_link_clicked', { path, destination, href: url.origin + url.pathname });
  }, { capture: true });
}

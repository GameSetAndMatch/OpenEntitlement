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
    // Runs before the first pageview, so that pageview already carries the cleaned address.
    loaded: markInternalBrowser,
  });
  trackJourney();
}

/**
 * Maintainers open any page with ?oe_internal=1 once per browser to leave the website numbers:
 * it sets the `$internal_or_test_user` person property, which the project's test-account filter
 * excludes. ?oe_internal=0 undoes it. Only that flag is stored, on this browser's anonymous ID;
 * the parameter is then removed from the address bar so it is not shared by copying a link.
 */
function markInternalBrowser(ph: Pick<typeof posthog, 'setInternalOrTestUser' | 'setPersonProperties'>): void {
  const url = new URL(location.href);
  const value = url.searchParams.get('oe_internal');
  if (value === null) return;
  if (value === '1') ph.setInternalOrTestUser();
  else if (value === '0') ph.setPersonProperties({ $internal_or_test_user: false });
  url.searchParams.delete('oe_internal');
  history.replaceState(history.state, '', url.pathname + url.search + url.hash);
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
    // Names are stable identifiers set in markup (Starlight hero actions use frontmatter attrs), never labels.
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

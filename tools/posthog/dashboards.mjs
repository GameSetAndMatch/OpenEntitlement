#!/usr/bin/env node
/**
 * Create or update OpenEntitlement's PostHog dashboards: the website acquisition funnel and the
 * console activation funnel, with supporting trends. Idempotent: dashboards and insights are
 * matched by name and updated in place.
 *
 *   POSTHOG_PERSONAL_API_KEY=phx_... node tools/posthog/dashboards.mjs
 *
 * Environment:
 *   POSTHOG_PERSONAL_API_KEY  required; a personal API key with dashboard and insight write scopes
 *   POSTHOG_PROJECT_ID        default 724077
 *   POSTHOG_APP_HOST          default https://us.posthog.com
 *   DRY_RUN=1                 print the definitions without calling the API
 */

const key = process.env.POSTHOG_PERSONAL_API_KEY;
const project = process.env.POSTHOG_PROJECT_ID ?? "724077";
const host = (process.env.POSTHOG_APP_HOST ?? "https://us.posthog.com").replace(/\/+$/, "");
const dryRun = process.env.DRY_RUN === "1";
if (!key && !dryRun) throw new Error("Set POSTHOG_PERSONAL_API_KEY (or DRY_RUN=1)");

const range = { date_from: "-30d" };
const event = (name, properties = [], extra = {}) => ({ kind: "EventsNode", event: name, name, properties, ...extra });
const prop = (key, value, operator = "exact") => ({ key, value, operator, type: "event" });
const viz = (source) => ({ kind: "InsightVizNode", source });
const funnel = (series, windowDays = 14) =>
  viz({ kind: "FunnelsQuery", series, dateRange: range, funnelsFilter: { funnelVizType: "steps", funnelWindowInterval: windowDays, funnelWindowIntervalUnit: "day" } });
const trend = (series, { breakdown, interval = "day", display } = {}) =>
  viz({
    kind: "TrendsQuery",
    series,
    interval,
    dateRange: range,
    ...(breakdown ? { breakdownFilter: { breakdown, breakdown_type: "event" } } : {}),
    ...(display ? { trendsFilter: { display } } : {}),
  });

const dashboards = [
  {
    name: "Website acquisition",
    description: "openentitlement.dev: how visitors move from the homepage to installing or starring the project.",
    insights: [
      {
        name: "Acquisition funnel: homepage → docs → quickstart → copy → GitHub/Docker",
        description: "Where visitors drop off before trying OpenEntitlement. 14-day conversion window.",
        query: funnel([
          event("$pageview", [prop("$pathname", "/")], { custom_name: "Homepage" }),
          event("$pageview", [prop("$pathname", "/docs/", "icontains")], { custom_name: "Any docs page" }),
          event("$pageview", [prop("$pathname", "/docs/quickstart/")], { custom_name: "Quickstart" }),
          event("docs_code_copied", [], { custom_name: "Copied a code block" }),
          event("outbound_link_clicked", [prop("destination", ["github", "docker", "pypi", "npm"])], { custom_name: "Went to GitHub, Docker, PyPI or npm" }),
        ]),
      },
      {
        name: "Homepage conversion: homepage → call to action → quickstart",
        description: "Does the landing page move people to the quickstart? 1-day window.",
        query: funnel([
          event("$pageview", [prop("$pathname", "/")], { custom_name: "Homepage" }),
          event("cta_clicked", [prop("path", "/")], { custom_name: "Clicked a call to action or scene" }),
          event("$pageview", [prop("$pathname", "/docs/quickstart/")], { custom_name: "Quickstart" }),
        ], 1),
      },
      {
        name: "Calls to action by name",
        description: "Hero, scene and closing actions on the homepage (cta_clicked.cta).",
        query: trend([event("cta_clicked")], { breakdown: "cta", display: "ActionsBarValue" }),
      },
      {
        name: "Dead clicks by page",
        description: "Clicks that did nothing: places where visitors expect a link or control.",
        query: trend([event("$dead_click")], { breakdown: "$pathname", display: "ActionsBarValue" }),
      },
      {
        name: "Daily visitors",
        query: trend([event("$pageview", [], { math: "dau", custom_name: "Unique visitors" })]),
      },
      {
        name: "Top pages",
        query: trend([event("$pageview", [], { math: "dau" })], { breakdown: "$pathname", display: "ActionsBarValue" }),
      },
      {
        name: "Copied code by page",
        description: "Which instructions people actually run.",
        query: trend([event("docs_code_copied")], { breakdown: "path", display: "ActionsBarValue" }),
      },
      {
        name: "Outbound clicks by destination",
        query: trend([event("outbound_link_clicked")], { breakdown: "destination", display: "ActionsBarValue" }),
      },
      {
        name: "Paths from the homepage",
        query: viz({ kind: "PathsQuery", dateRange: range, pathsFilter: { includeEventTypes: ["$pageview"], startPoint: "/", stepLimit: 5 } }),
      },
      {
        name: "Website errors",
        query: trend([event("$exception", [prop("$host", "openentitlement.dev")])]),
      },
    ],
  },
  {
    name: "Console activation",
    description: "Hosted console: how a signed-in Account gets to its first API evaluation. Server events use the Account ID as distinct ID.",
    insights: [
      {
        name: "Activation funnel: sign-in → Workspace → Catalog → Tier → Organization → API key → first evaluation",
        description: "Each step is recorded by the server after a successful, audited change. 30-day conversion window.",
        query: funnel(
          [
            event("$identify", [], { custom_name: "Signed in" }),
            event("workspace_created", [], { custom_name: "Created a Workspace" }),
            event("workspace_changed", [prop("section", ["catalog", "privileges"])], { custom_name: "Defined a Privilege" }),
            event("workspace_changed", [prop("section", ["tiers", "variants"])], { custom_name: "Created a Tier or variant" }),
            event("workspace_changed", [prop("section", "organizations")], { custom_name: "Added an Organization" }),
            event("api_key_created", [], { custom_name: "Created an API key" }),
            event("api_evaluation_served", [], { custom_name: "First evaluation from an application" }),
          ],
          30,
        ),
      },
      {
        name: "Weekly active Accounts",
        query: trend([event("workspace_changed", [], { math: "dau", custom_name: "Accounts making changes" })], { interval: "week" }),
      },
      {
        name: "Changes by section",
        description: "Which parts of the console people use.",
        query: trend([event("workspace_changed")], { breakdown: "section", display: "ActionsBarValue" }),
      },
      {
        name: "Team growth: invitations sent and accepted",
        query: trend([event("member_invited"), event("invitation_accepted")], { interval: "week" }),
      },
      {
        name: "Workspace retention",
        description: "Of Accounts that created a Workspace, how many keep changing it week after week.",
        query: viz({
          kind: "RetentionQuery",
          dateRange: { date_from: "-8w" },
          retentionFilter: {
            targetEntity: { id: "workspace_created", name: "workspace_created", type: "events" },
            returningEntity: { id: "workspace_changed", name: "workspace_changed", type: "events" },
            period: "Week",
            totalIntervals: 8,
          },
        }),
      },
      {
        name: "Console and service errors",
        query: trend([event("$exception")], { breakdown: "service" }),
      },
    ],
  },
];

async function api(method, path, body) {
  const response = await fetch(`${host}/api/projects/${project}${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : undefined;
}

async function all(path) {
  const results = [];
  for (let next = path; next; ) {
    const page = await api("GET", next);
    results.push(...page.results);
    next = page.next ? page.next.slice(page.next.indexOf(`/api/projects/${project}`) + `/api/projects/${project}`.length) : undefined;
  }
  return results;
}

if (dryRun) {
  console.log(JSON.stringify(dashboards, null, 2));
  process.exit(0);
}

const existingDashboards = await all("/dashboards/?limit=100");
for (const definition of dashboards) {
  let dashboard = existingDashboards.find((d) => d.name === definition.name && !d.deleted);
  dashboard = dashboard
    ? await api("PATCH", `/dashboards/${dashboard.id}/`, { description: definition.description })
    : await api("POST", "/dashboards/", { name: definition.name, description: definition.description });
  const existingInsights = await all(`/insights/?limit=100&dashboards=[${dashboard.id}]`);
  for (const insight of definition.insights) {
    const body = { name: insight.name, description: insight.description ?? "", query: insight.query, dashboards: [dashboard.id] };
    const current = existingInsights.find((i) => i.name === insight.name && !i.deleted);
    const saved = current ? await api("PATCH", `/insights/${current.id}/`, body) : await api("POST", "/insights/", body);
    console.log(`${current ? "updated" : "created"}  ${definition.name} / ${saved.name}`);
  }
  console.log(`dashboard: ${host}/project/${project}/dashboard/${dashboard.id}`);
}

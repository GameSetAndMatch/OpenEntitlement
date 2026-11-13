#!/usr/bin/env node
/**
 * Create or update OpenEntitlement's PostHog dashboards: the website acquisition funnel and the
 * console activation funnel, with supporting trends. This file is the source of truth for the
 * insights it names: dashboards and insights are matched by name, and only definitions that differ
 * from PostHog are written, so a rerun leaves matching insights untouched.
 *
 *   POSTHOG_PERSONAL_API_KEY=phx_... node tools/posthog/dashboards.mjs
 *   POSTHOG_PERSONAL_API_KEY=phx_... DIFF=1 node tools/posthog/dashboards.mjs   # report, write nothing
 *
 * Environment:
 *   POSTHOG_PERSONAL_API_KEY  a personal API key with dashboard and insight scopes (read for DIFF=1, write otherwise)
 *   POSTHOG_PROJECT_ID        default 724077
 *   POSTHOG_APP_HOST          default https://us.posthog.com
 *   DIFF=1                    compare each definition with PostHog and print unchanged/changed/missing; writes nothing
 *   SNAPSHOT=path.json        with DIFF=1, compare with a saved snapshot ({ insights: [{ dashboard, name, description, query }] })
 *                             instead of the API; no key needed (see fixtures/)
 *   DRY_RUN=1                 print the definitions without calling the API
 */

const key = process.env.POSTHOG_PERSONAL_API_KEY;
const project = process.env.POSTHOG_PROJECT_ID ?? "724077";
const host = (process.env.POSTHOG_APP_HOST ?? "https://us.posthog.com").replace(/\/+$/, "");
const dryRun = process.env.DRY_RUN === "1";
const diffOnly = process.env.DIFF === "1";
const snapshot = process.env.SNAPSHOT;
if (snapshot && !diffOnly) throw new Error("SNAPSHOT is only read with DIFF=1");
if (!key && !dryRun && !snapshot) throw new Error("Set POSTHOG_PERSONAL_API_KEY (or DRY_RUN=1, or DIFF=1 with SNAPSHOT)");

const range = { date_from: "-30d" };
const event = (name, properties = [], extra = {}) => ({ kind: "EventsNode", event: name, name, properties, ...extra });
const prop = (key, value, operator = "exact") => ({ key, value, operator, type: "event" });
const viz = (source) => ({ kind: "InsightVizNode", source });
// Funnels, retention and console errors leave out internal and test traffic: the project's test-account
// filter (the "Internal / Test users" cohort, set by the website's ?oe_internal=1 link, plus local hosts).
const excludeInternal = { filterTestAccounts: true };
const funnel = (series, windowDays = 14) =>
  viz({
    kind: "FunnelsQuery",
    series,
    dateRange: range,
    funnelsFilter: { funnelVizType: "steps", funnelWindowInterval: windowDays, funnelWindowIntervalUnit: "day" },
    ...excludeInternal,
  });
const trend = (series, { breakdown, interval = "day", display, ...extra } = {}) =>
  viz({
    kind: "TrendsQuery",
    series,
    interval,
    dateRange: range,
    ...(breakdown ? { breakdownFilter: { breakdown, breakdown_type: "event" } } : {}),
    ...(display ? { trendsFilter: { display } } : {}),
    ...extra,
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
        description:
          "Of people who created a Workspace in a given week, the share who saved at least one change to any Workspace in each later week. Counts people (signed-in Accounts), not Workspaces.",
        query: viz({
          kind: "RetentionQuery",
          dateRange: { date_from: "-8w" },
          retentionFilter: {
            targetEntity: { id: "workspace_created", name: "workspace_created", type: "events" },
            returningEntity: { id: "workspace_changed", name: "workspace_changed", type: "events" },
            period: "Week",
            totalIntervals: 8,
          },
          ...excludeInternal,
        }),
      },
      {
        name: "Console and service errors",
        description: "Console browser errors and server exceptions, by service. Website errors are excluded; they have their own insight.",
        // "is not" keeps server exceptions, which have no $host.
        query: trend([event("$exception", [prop("$host", ["openentitlement.dev"], "is_not")])], { breakdown: "service", ...excludeInternal }),
      },
    ],
  },
];

/**
 * Defaults PostHog adds when it saves a query. A key PostHog holds but this file omits counts as a
 * change, because a write replaces the whole query, unless it is one of these values. `undefined`
 * accepts any value.
 */
const serverDefaults = {
  version: undefined,
  explicitDate: false,
  excludeIncompletePeriods: false,
  properties: [],
  layout: "vertical",
  exclusions: [],
  showLegend: false,
  legendPosition: "bottom",
  funnelOrderType: "ordered",
  showAnnotations: true,
  showValuesOnSeries: false,
  funnelStepReference: "total",
  breakdownAttributionType: "first_touch",
  hideIncompleteConversionWindowPeriods: false,
  aggregationType: "count",
  cohortLabelStartIndex: 0,
  aggregationPropertyType: "event",
};
const isServerDefault = (key, value) =>
  Object.hasOwn(serverDefaults, key) && (serverDefaults[key] === undefined || JSON.stringify(serverDefaults[key]) === JSON.stringify(value));

/** Paths where `current` (PostHog) differs from `desired` (this file), ignoring PostHog's own defaults. */
function differences(desired, current, path) {
  if (Array.isArray(desired)) {
    if (!Array.isArray(current) || current.length !== desired.length) return [path];
    return desired.flatMap((item, i) => differences(item, current[i], `${path}[${i}]`));
  }
  if (desired && typeof desired === "object") {
    if (!current || typeof current !== "object" || Array.isArray(current)) return [path];
    const extra = Object.keys(current).filter((k) => !Object.hasOwn(desired, k) && !isServerDefault(k, current[k]));
    return [...Object.keys(desired).flatMap((k) => differences(desired[k], current[k], `${path}.${k}`)), ...extra.map((k) => `${path}.${k}`)];
  }
  return Object.is(desired, current) ? [] : [path];
}

/** What would change if `insight` were written over `current`: field paths, or undefined when missing. */
function insightChanges(insight, current) {
  if (!current) return undefined;
  return [
    ...differences(insight.name, current.name, "name"),
    ...differences(insight.description ?? "", current.description ?? "", "description"),
    ...differences(insight.query, current.query, "query"),
  ];
}

function report(dashboardName, insight, changes) {
  const label = `${dashboardName} / ${insight.name}`;
  if (!changes) return console.log(`missing    ${label}`), true;
  if (changes.length) return console.log(`changed    ${label}  (${changes.join(", ")})`), true;
  console.log(`unchanged  ${label}`);
  return false;
}

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

if (snapshot) {
  const { readFileSync } = await import("node:fs");
  const saved = JSON.parse(readFileSync(snapshot, "utf8")).insights;
  for (const definition of dashboards)
    for (const insight of definition.insights) {
      const current = saved.find((i) => i.dashboard === definition.name && i.name === insight.name);
      if (current) report(definition.name, insight, insightChanges(insight, current));
      else console.log(`unknown    ${definition.name} / ${insight.name}  (not in snapshot)`);
    }
  process.exit(0);
}

let pending = 0;
const existingDashboards = await all("/dashboards/?limit=100");
for (const definition of dashboards) {
  let dashboard = existingDashboards.find((d) => d.name === definition.name && !d.deleted);
  if (diffOnly) {
    if (!dashboard) console.log(`missing    ${definition.name}`);
    else if ((dashboard.description ?? "") !== definition.description) console.log(`changed    ${definition.name}  (description)`);
  } else if (!dashboard) {
    dashboard = await api("POST", "/dashboards/", { name: definition.name, description: definition.description });
  } else if ((dashboard.description ?? "") !== definition.description) {
    dashboard = await api("PATCH", `/dashboards/${dashboard.id}/`, { description: definition.description });
  }
  const existingInsights = dashboard ? await all(`/insights/?limit=100&dashboards=[${dashboard.id}]`) : [];
  for (const insight of definition.insights) {
    const current = existingInsights.find((i) => i.name === insight.name && !i.deleted);
    const changes = insightChanges(insight, current);
    const differs = report(definition.name, insight, changes);
    if (diffOnly || !differs) continue;
    pending++;
    const body = { name: insight.name, description: insight.description ?? "", query: insight.query, dashboards: [dashboard.id] };
    await (current ? api("PATCH", `/insights/${current.id}/`, body) : api("POST", "/insights/", body));
  }
  if (dashboard) console.log(`dashboard: ${host}/project/${project}/dashboard/${dashboard.id}`);
}
if (!diffOnly) console.log(pending ? `wrote ${pending} insight(s)` : "no changes");

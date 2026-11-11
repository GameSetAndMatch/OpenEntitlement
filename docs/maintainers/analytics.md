# Product analytics with PostHog

OpenEntitlement uses [PostHog](https://posthog.com) (US cloud, project 724077) to understand how people discover and adopt the project, and where they get stuck. The goal is to read the user journey as funnels and improve the steps where people drop off.

## Where it runs

| Surface | When it reports | What it captures |
|---|---|---|
| openentitlement.dev (docs and homepage) | Only on the production hostname; local previews and CI builds stay silent | Pageviews, clicks (autocapture), browser errors, session replay, heatmaps, dead and rage clicks, web vitals, surveys, plus the journey events below |
| Console and service (`console/`) | Only when the operator sets `OE_POSTHOG_KEY`; self-hosted installs report nothing by default | The same browser features, server-side exceptions, and the activation events below |

The `phc_` project key is public by design: it can only send events. It lives in `website/src/scripts/posthog.ts` for the website, and in the `OE_POSTHOG_KEY` environment variable for the console. Personal API keys (`phx_`) are secrets and never belong in the repository.

## Privacy rules

- Self-hosted installations send nothing unless their operator configures their own key.
- Session replay masks every form input.
- The console identifies people by Account ID only, never by email or name.
- Events never include entitlement values, customer terms or Catalog contents. They carry IDs, section names and counts.
- The console's Content-Security-Policy widens only to the configured ingestion host. The browser loads PostHog's self-contained "full, no-external" bundle, so no third-party scripts are allowed.

## Event catalog

### Website acquisition

| Event | Sent when | Properties |
|---|---|---|
| `$pageview` | Every page load (automatic) | `$pathname` |
| `docs_code_copied` | The copy button of any code block is clicked | `path`, `language`, `first_line` |
| `outbound_link_clicked` | A link to another site is clicked | `path`, `destination` (`github`, `docker`, `pypi`, `npm`, `other`), `href` |
| `cta_clicked` | A call to action is clicked: an element with `data-ph-cta="<name>"`, or a homepage hero action (named `hero_<label>`, e.g. `hero_get_started`). Homepage names: `hero_get_started`, `hero_read_the_specification`, `scene_catalog`, `scene_tiers`, `scene_exception`, `close_get_started`, `close_github` | `path`, `cta` |

### Console activation

These are sent by the server after a successful, audited change, so ad blockers cannot hide them. `distinct_id` is the Account ID, the same ID the browser identifies with, so browser and server events join into one person.

| Event | Sent when | Properties |
|---|---|---|
| `$identify` | The browser loads a signed-in session | — |
| `workspace_created` | An Account creates a Workspace | `workspace_id` |
| `workspace_changed` | A Catalog, Group, Tag, Tier, variant, Organization, user-entitlement, policy or hosting change is saved | `workspace_id`, `section`, `method` |
| `member_invited`, `invitation_accepted`, `member_role_changed`, `member_removed` | Membership changes | `workspace_id`, `role` |
| `api_key_created`, `api_key_revoked` | Evaluation keys change | `workspace_id`, `scope` |
| `console_evaluation_run` | Someone tests an evaluation in the console | `workspace_id` |
| `api_evaluation_served` | An application evaluates with a Workspace API key: once per Workspace per server process, attributed to the Account that created the key | `workspace_id` |
| `$exception` | An unexpected server error (HTTP 500) or browser error | `service`, `route` |

## Dashboards

`tools/posthog/dashboards.mjs` creates or updates two dashboards, matched by name so it is safe to rerun:

- **Website acquisition:** the funnel homepage → docs → quickstart → copied a code block → GitHub, Docker, PyPI or npm; homepage conversion (homepage → call to action → quickstart); calls to action by name; dead clicks by page; daily visitors; top pages; copied code by page; outbound clicks; paths from the homepage; website errors.
- **Console activation:** the funnel signed in → created a Workspace → defined a Privilege → created a Tier or variant → added an Organization → created an API key → first evaluation; weekly active Accounts; changes by section; invitations; Workspace retention; errors by service.

```sh
POSTHOG_PERSONAL_API_KEY=phx_... node tools/posthog/dashboards.mjs
DRY_RUN=1 node tools/posthog/dashboards.mjs   # print the definitions only
```

The personal API key needs the `dashboard:write` and `insight:write` scopes. When you add a journey event, add it to this catalog and, if it marks a funnel step, to the script.

## Project settings to check in PostHog

Session replay, heatmaps, web vitals, exception autocapture and surveys can each be switched off in the project settings, which overrides the code. Keep them enabled. Add `openentitlement.dev` and the hosted console's domain to the authorized URLs used for heatmaps and the toolbar.

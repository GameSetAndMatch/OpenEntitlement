# Product analytics with PostHog

OpenEntitlement uses [PostHog](https://posthog.com) (US cloud, project 724077) to understand how people discover and adopt the project, and where they get stuck. The goal is to read the user journey as funnels and improve the steps where people drop off.

## Where it runs

| Surface | When it reports | What it captures |
|---|---|---|
| openentitlement.dev (docs and homepage) | Only on the production hostname; local previews, CI builds and copies of the docs hosted elsewhere stay silent | Pageviews, clicks (autocapture), browser errors, session replay, heatmaps, dead and rage clicks, web vitals, surveys, plus the journey events below |
| Console and service (`console/`) | Only when the operator sets `OE_POSTHOG_KEY`; self-hosted installs report nothing by default | The same browser features, server-side exceptions, and the activation events below |

The `phc_` project key is public by design: it can only send events. It lives in `website/src/scripts/posthog.ts` for the website, and in the `OE_POSTHOG_KEY` environment variable for the console. Personal API keys (`phx_`) are secrets and never belong in the repository.

## Privacy rules

- Self-hosted installations send nothing unless their operator configures their own key.
- Session replay masks every form input.
- Website visitors stay anonymous. The internal-browser link below stores one flag on the browser's anonymous ID and nothing else.
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
| `$set` with `$internal_or_test_user` | A maintainer opens a page with `?oe_internal=1` (`true`) or `?oe_internal=0` (`false`); see [Leave your own visits out](#leave-your-own-visits-out) | — |
| `cta_clicked` | An element with `data-ph-cta="<name>"` is clicked. Names are stable identifiers, never labels; Starlight hero actions set them through frontmatter `attrs`. Homepage names: `hero_get_started`, `hero_specification`, `scene_catalog`, `scene_tiers`, `scene_exception`, `code_quickstart`, `close_get_started`, `close_github` | `path`, `cta` |

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

## Leave your own visits out

Internal and test traffic is left out by the project's test-account filter. It combines two rules: people in the "Internal / Test users" cohort (person property `$internal_or_test_user = true`) and events from local hosts (`localhost`, `127.0.0.1`, `0.0.0.0`, `[::1]`). New insights apply it by default.

- **Website:** open any page of openentitlement.dev once with `?oe_internal=1`, for example `https://openentitlement.dev/?oe_internal=1`. That browser's anonymous ID gets `$internal_or_test_user = true` and its visits leave the numbers. The parameter is removed from the address bar straight away. Repeat it in each browser or profile, and after clearing site data, because the mark follows the browser's anonymous ID. `?oe_internal=0` undoes it.
- **Console:** set `$internal_or_test_user = true` on the Account's person in PostHog. Look the person up by Account ID, not by email.

Events sent before a browser is marked stay in the numbers.

## Dashboards

`tools/posthog/dashboards.mjs` is the source of truth for the two dashboards and their insights. Dashboards and insights are matched by name. A run writes only the insights whose definition differs from PostHog, so rerunning it leaves matching insights untouched. Change an insight in the script, not in PostHog; a change made only in PostHog is undone by the next run.

- **Website acquisition:** the funnel homepage → docs → quickstart → copied a code block → GitHub, Docker, PyPI or npm; homepage conversion (homepage → call to action → quickstart); calls to action by name; dead clicks by page; daily visitors; top pages; copied code by page; outbound clicks; paths from the homepage; website errors.
- **Console activation:** the funnel signed in → created a Workspace → defined a Privilege → created a Tier or variant → added an Organization → created an API key → first evaluation; weekly active Accounts; changes by section; invitations; Workspace retention; console and service errors (website errors excluded).

The funnels, Workspace retention and console errors leave out internal and test traffic (see above).

```sh
POSTHOG_PERSONAL_API_KEY=phx_... node tools/posthog/dashboards.mjs           # write what differs
POSTHOG_PERSONAL_API_KEY=phx_... DIFF=1 node tools/posthog/dashboards.mjs    # report unchanged, changed or missing; write nothing
DRY_RUN=1 node tools/posthog/dashboards.mjs                                   # print the definitions only
```

The personal API key needs the `dashboard:write` and `insight:write` scopes, or read scopes for `DIFF=1`. The diff ignores defaults PostHog adds when it saves a query, such as `version` or the funnel layout; any other field that PostHog holds and the script lacks counts as a change, because a write replaces the whole query.

`node --test tools/posthog/*.test.mjs` runs the diff against `tools/posthog/fixtures/ope-49-insights.json`, a snapshot of the insights fixed by hand in OPE-49 (names, descriptions and queries only), and fails if the script would change them. When you change one of those insights, update the snapshot from PostHog in the same PR.

When you add a journey event, add it to this catalog and, if it marks a funnel step, to the script.

## Project settings to check in PostHog

Session replay, heatmaps, web vitals, exception autocapture and surveys can each be switched off in the project settings, which overrides the code. Keep them enabled. Add `openentitlement.dev` and the hosted console's domain to the authorized URLs used for heatmaps and the toolbar.

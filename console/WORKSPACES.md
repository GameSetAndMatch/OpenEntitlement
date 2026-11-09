# Workspace service (development preview)

This is the shared, multitenant control plane. An account can own or join multiple workspaces. Each workspace owns its catalog, tiers, variants and Organizations. The existing standalone console remains available through `npm start`; it does not become a hosted service simply by using PostgreSQL.

## Run locally

Use Node 24 LTS and PostgreSQL 17. Create a dedicated database and login role that owns it. The runtime role must **not** be a superuser or have BYPASSRLS. Do not point this preview at an existing production database.

```sh
npm ci --prefix console
npm --prefix console run build
export DATABASE_URL='postgresql://workspace_user:your_password@localhost:5432/workspaces'
export OE_APP_URL=http://localhost:18789
export OE_OIDC_ISSUER=http://localhost:18790
export OE_OIDC_LOCAL_HTTP=true
export OE_PLATFORM_ADMIN_SUBJECT=local-admin
npm --prefix console run dev:issuer
```

In another terminal with the same environment, run:

```sh
npm --prefix console run start:workspace
```

Open <http://localhost:18789/app/>. The loopback development identity provider accepts `local-admin` or `local-user`, with any non-empty password. These are test identities, not Google accounts. Do not expose this development issuer publicly. The local administrator can inspect every workspace; the other account starts with none.

Define groups and features in **Catalog**, then add typed privileges with flat keys such as `max_exports`. Group nesting changes presentation, never the evaluation key. Boolean, integer and string values (including string enums) use the same validator in the browser and server. Integer limits can explicitly allow unlimited.

A privilege either supplies a catalog default or requires an explicit value in every variant. For an existing catalog, set that value in all existing variants before removing its default. Create a tier, add its standard/trial/grace variants, then assign an Organization. A variant’s tier and purpose are fixed after creation; create a new variant to change either. Organization terms replace inherited values. Every mutation requires a reason and records the authenticated account in audit history.

**Configuration** displays a downloadable YAML snapshot of the selected workspace. It excludes memberships, credentials and sessions. It is an export, not a startup configuration import.

## Identity and access

For a real provider, configure `OE_OIDC_ISSUER`, `OE_OIDC_CLIENT_ID`, optionally `OE_OIDC_CLIENT_SECRET`, and an HTTPS `OE_APP_URL`. Register `${OE_APP_URL}/auth/callback` as the redirect URI. Disable `OE_OIDC_LOCAL_HTTP`. The issuer must support discovery, authorization code with PKCE and verified email through UserInfo. `OE_SIGNUP_DOMAINS` optionally restricts verified email domains (comma separated).

Accounts are identified by verified issuer and subject. `OE_PLATFORM_ADMIN_SUBJECT` bootstraps that subject under the configured issuer as a platform administrator. It is not an email-based role. Changing this setting does not revoke previously persisted administrator roles; role revocation tooling is not yet included.

Owners manage catalog, commercial values and access. Managers invite/remove Users or Managers; Users read. The final Owner cannot be removed or demoted. Invitations accepted by existing members leave their role unchanged and report that explicitly; an Owner must change roles through membership controls. Invitations are single-use, seven-day links bound to the invited verified email. The UI creates a link for manual sharing; it does not send email.

HTTP-only session cookies, state, nonce, PKCE, signature verification, same-origin checks and session-bound CSRF protect interactive requests. Evaluation keys are shown once, hashed at rest, revocable, and bound to exactly one workspace. A key can call `POST /api/evaluate` with `organizationId`, `privilege`, and optional deterministic `now`; it cannot administer the console.

PostgreSQL FORCE RLS protects entitlement state and audit rows with transaction-local workspace context. Global identity, directory, memberships, invitations and key lookup use explicit application authorization. Runtime superuser/BYPASSRLS roles are rejected. Updates serialize with row locks and reject stale revisions instead of overwriting concurrent changes.

## Payment status

A tier can define grace days. Before setting an Organization past due, create that tier's grace variant. The server snapshots a grace deadline on the transition; repeated past-due updates on the same tier do not extend it. Moving to a different tier starts that tier’s grace window (zero days restricts immediately). Reactivation ends that past-due episode; a later past-due transition starts a new window. During grace the grace variant's values apply; original assignment and negotiated terms remain stored. Reactivation restores them. At the deadline, the workspace's configured read-only or fallback-variant policy applies. Ended contracts bypass grace. The application must enforce the returned `readOnly` flag; evaluation does not delete or modify application data.

This preview has no payment webhook adapter, automatic trial expiration, grant authoring, self-hosted file reconciliation, or bridge to the existing OEREP SDK transports. Its workspace API is a separate control-plane slice; existing standalone data is not automatically migrated. Production operation still needs a production identity provider, operational hardening and a deployment/recovery plan.

## Component development and regression tests

```sh
npm --prefix console run storybook
npm --prefix console run build:storybook
npm --prefix console run test:storybook
```

Storybook reuses the application Field, ValuesEditor and boolean Toggle. Stories cover finite/unlimited values, negative validation, boolean access, required enums and inherited/required tier values. The compiled stories run in Chromium with their interaction assertions.

The service CI runs the HTTP/database tests and full browser regression. Both database tests create disposable databases and restricted roles; `OE_PG_DSN` must name a test cluster administrator that can create/drop them. Never use a production cluster for these tests.

```sh
OE_PG_DSN=postgresql://oe:oe@localhost:5432/oe npm --prefix console test
OE_PG_DSN=postgresql://oe:oe@localhost:5432/oe npm --prefix console run test:workspaces
```

The browser regression signs in through real OIDC and creates a catalog, tier, variant and Organization, verifies inline validation/infinity, YAML visibility and isolation between two accounts. API tests also cover invitations, CSRF, roles, keys, last-Owner protection, RLS, revision conflicts and restart persistence. The existing `test:setup` checks the standalone console separately.

Audit records currently store full before/after workspace snapshots for each configuration change. History has no retention policy in this preview; plan database capacity and retention before production use.

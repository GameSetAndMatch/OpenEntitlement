# Organization and user entitlements

User scope is a hosted-service capability, not a proprietary protocol extension. OEREP and both SDKs retain their existing subject model.

One Workspace contains a Privilege Catalog and entitled Organizations. An application user (identified by `subjectId` within an `organizationId`) inherits Organization values. Explicit Personal terms replace inherited values; positive integer grants add an allowance. Personal terms bind to the Organization's assigned tier variant and become inert when that assignment changes. Grants remain personal allowances across tier changes; grace and fallback suspend them. Grace and fallback policies take precedence; environment prerequisites and frozen defaults remain final restrictions. Evaluating entitlements never records consumption or grants application authorization.

Self-hosted Workspace installations support user scope. Cloud Pro supports Organization scope; Cloud Enterprise adds user scope. A platform administrator manages the Cloud service tier; Workspace owners cannot enable it through their own Catalog. Cloud service tiers are distinct from the customer-defined Tiers inside a Workspace. No billing integration, certification or production-readiness claim is implied.

The implementation will cover authenticated/audited editing, API-key evaluation, revision conflicts, scope isolation, persistence, reusable controls and browser regression. Application users are not OpenEntitlement console Accounts or membership Roles. Usage remains application-owned.


## API

For a session-authenticated Owner, `PUT /api/workspaces/:id/subjects` accepts `entry: {organizationId, subjectId, name, terms, grants}` with `revision` and a non-empty `reason`. The server binds terms to the current assigned variant. `DELETE` at the same endpoint accepts `entry: {organizationId, subjectId}` plus revision/reason, restoring inheritance. No authentication Account is provisioned. Unknown subjects simply inherit.

Both `POST /api/evaluate` (Workspace-scoped bearer key) and `POST /api/workspaces/:id/evaluate` (session) accept `organizationId`, `privilege`, optional `subjectId` and optional RFC 3339 `now`. A Cloud Pro subject request returns 403 instead of ignoring the subject. Hosting capabilities are returned as `hosting` on Workspace reads/mutations. Only a Platform administrator can `PUT .../hosting` with `entry: {tier: "pro" | "enterprise"}` and revision/reason. This manually managed fact is not a payment integration.

The current Workspace JSON configuration is capped at 900 KB, including subject records, and uses full-state audited writes. It is a development preview rather than a large-directory storage design. See the [project review](../docs/research/2026-11-project-review.md) for remaining scaling and transport work.

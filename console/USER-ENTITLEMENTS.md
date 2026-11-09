# Organization and user entitlements

Implementation in progress. User scope is a hosted-service capability, not a proprietary protocol extension. OEREP and both SDKs retain their existing subject model.

One Workspace contains a Privilege Catalog and entitled Organizations. An application user (identified by `subjectId` within an `organizationId`) inherits Organization values. Explicit user terms replace inherited values; positive integer grants add an allowance. User terms and grants bind to the Organization's assigned tier variant and become inert when that assignment changes. Grace and fallback policies take precedence; environment prerequisites and frozen defaults remain final restrictions. Evaluating entitlements never records consumption or grants application authorization.

Self-hosted Workspace installations support user scope. Cloud Pro supports Organization scope; Cloud Enterprise adds user scope. A platform administrator manages the Cloud service tier; Workspace owners cannot enable it through their own Catalog. Cloud service tiers are distinct from the customer-defined Tiers inside a Workspace. No billing integration, certification or production-readiness claim is implied.

The implementation will cover authenticated/audited editing, API-key evaluation, revision conflicts, scope isolation, persistence, reusable controls and browser regression. Application users are not OpenEntitlement console Accounts or membership Roles. Usage remains application-owned.

# OpenEntitlement glossary

Shared domain language for the authoring model and service. Compatibility terms identify older protocol concepts without redefining their released behavior.

## Entitlement model

| Term | Definition |
|---|---|
| **Privilege** | One typed entitlement value: a boolean permission, integer allowance or string-enum choice. |
| **Product** | A commercial offering within a Workspace, with its own Privilege Catalog, Tiers and Tier variants. Preferred over project. |
| **Product key** | The identifier that names a Product in evaluation requests and API keys. It never changes; the Product's name can. |
| **Privilege Catalog** | The definitions, defaults and metadata of one Product's Privileges. Preferred over Feature Catalog for the authoring surface. |
| **Group** | A hierarchical container for Privileges. A Privilege can belong to at most one Group. |
| **Tag** | A reusable label independent of Group hierarchy. A Privilege may have several Tags. |
| **Visibility** | Whether a Privilege is editable, read-only or hidden in normal controls. |
| **Read-only Privilege** | A visible, locked Privilege whose Catalog default supplies its value. |
| **Hidden Privilege** | A Privilege omitted from normal controls that still has an effective value. |
| **Environment prerequisite** | An install condition that can veto a boolean Privilege but cannot grant it. |
| **Tier** | A reusable commercial level of one Product, such as Basic, Business or Enterprise. Preferred over Plan in new authoring language. |
| **Tier variant** | A Tier's standard, trial or grace conditions and default Privilege values. |
| **Archived** | A Tier or Product that its current Organizations keep, but that can no longer be given to another Organization. |
| **Trial** | A time-limited variant of a Tier, not a commercial Tier itself. |
| **Grace period** | A bounded period of defined rights after a qualifying contract-status change. |
| **Status policy** | What a Product's Organizations get once their past-due grace period ends or their contract ends: their values read-only, or a fallback Tier variant of the same Product. |
| **Organization** | An entitled customer managed within a Workspace. Distinct from the Workspace, Account and technical Tenant. |
| **Application user** | An Organization-scoped Subject, identified by the Subject ID the application sends, whose entitlement values may inherit or have personal terms/grants. Not a console Account or membership Role. |
| **Organization terms** | An Organization's own values that replace its Tier variant's values; they belong to that variant. Preferred over own terms. |
| **Personal terms** | An Application user's own values that replace their Organization's values; they belong to the assigned Tier variant. Preferred over user terms. |
| **Cloud service tier** | OpenEntitlement hosted capabilities (Pro or Enterprise), set by a Platform administrator; distinct from customer-defined Tiers. Cloud Pro allows one Product, Enterprise any number. |
| **Subject** | A person, service account or other actor to whom an entitlement may apply. |
| **Resource** | An application object that may be subject to an entitlement. |
| **Contract** | The link between agreed commercial terms and an Organization's entitled rights. |
| **Assignment** | The association between an Organization and its current Tier variant in one Product. |
| **Override** | A scoped replacement for an inherited commercial value. Distinct from a restrictive environment prerequisite. |
| **Grant** | An additive allowance for a scope, rather than a replacement value. |
| **Unlimited** | An explicit absence of a numeric cap, not a missing value, null or an arbitrary large number. |
| **Resolved value** | The effective entitlement value after applying the relevant precedence rules. |
| **Usage** | Consumption measured by the application or a metering system. |
| **Consumption dashboard** | A view combining entitlement limits with reported usage and its freshness. |

## Control plane and identity

| Term | Definition |
|---|---|
| **Workspace** | A business's control plane for its Products, Organizations, members and records. The customer OpenEntitlement bills. |
| **Tenant** | A technical isolation context in shared infrastructure. Not the preferred name for a Workspace or an Organization. |
| **Account** | A person's sign-in identity, which may participate in multiple Workspaces. |
| **Member** | An Account's membership in a Workspace. |
| **Invitation** | A single-use link, valid for seven days, that lets one verified email join a Workspace as Owner or with a Role in one Product. |
| **Role** | A member's administrative authority within a Product, or the whole Workspace for an Owner. |
| **Owner** | A Role with full administration of the whole Workspace and every Product. |
| **Manager** | A Role that administers one Product and its members. |
| **User** | A Role with read access to one Product. |
| **Platform administrator** | An operator with authority across Workspaces, distinct from an Organization's entitled users. |
| **Permission** | Authority to perform an administrative/application action; separate from commercial entitlement. |

## Interoperability and commercial context

| Term | Definition |
|---|---|
| **OEREP** | OpenEntitlement Remote Evaluation Protocol, the shared contract for remote entitlement decisions. |
| **Provider** | An implementation that resolves entitlement values from a source of truth. |
| **Remote provider** | A provider that obtains decisions from a remote entitlement service. |
| **Connector** | An integration that translates explicitly mapped external facts or operations across systems. |
| **Conformance** | Demonstrated agreement with the relevant semantic and protocol requirements. |
| **Control plane** | Administration of definitions, commercial facts, membership and policies. |
| **Data plane** | Application-facing evaluation of entitlement decisions. |
| **Quote-to-Cash** | The commercial flow from a quote/order through agreed rights, billing, collection and renewal. |
| **Deployment** | Where and how software runs, independent of its commercial Tier. |
| **Problem type** | The stable URI that identifies one kind of error in an RFC 9457 Problem Details response, such as `https://openentitlement.dev/problems/validation-failed`. Clients branch on it, not on the human-readable title or detail. |

## OEREP v1 compatibility language

| Term | Definition |
|---|---|
| **Feature** | The v1 grouping of one or more Privileges with a gate. Not the preferred new authoring entity. |
| **Gate** | The Privilege used to decide whether a v1 Feature is enabled. |
| **Plan** | The v1 named set of Privilege values. |
| **Family** | Related v1 Plans that share override-binding identity. |
| **Stale override** | A retained override whose binding no longer matches its active commercial context. |
| **Pool** | An Organization-wide allowance shared by relevant usage. |
| **Subject allowance** | A scoped allowance available to one Subject. |
| **Fixed provider** | A provider whose installed values are not commercially editable through its mutation interface. |
| **Guard** | An application operation that coordinates evaluation with counting and acting. |

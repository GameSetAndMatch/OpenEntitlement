# OpenEntitlement glossary

Shared domain language for the authoring model and service. Compatibility terms identify older protocol concepts without redefining their released behavior.

## Entitlement model

| Term | Definition |
|---|---|
| **Privilege** | One typed entitlement value: a boolean permission, integer allowance or string-enum choice. |
| **Privilege Catalog** | The definitions, defaults and metadata of a product's Privileges. Preferred over Feature Catalog for the authoring surface. |
| **Group** | A hierarchical container for Privileges. A Privilege can belong to at most one Group. |
| **Tag** | A reusable label independent of Group hierarchy. A Privilege may have several Tags. |
| **Visibility** | Whether a Privilege is editable, read-only or hidden in normal controls. |
| **Read-only Privilege** | A visible, locked Privilege whose Catalog default supplies its value. |
| **Hidden Privilege** | A Privilege omitted from normal controls that still has an effective value. |
| **Environment prerequisite** | An install condition that can veto a boolean Privilege but cannot grant it. |
| **Tier** | A reusable commercial level, such as Basic, Business or Enterprise. Preferred over Plan in new authoring language. |
| **Tier variant** | A Tier's standard, trial or grace conditions and default Privilege values. |
| **Trial** | A time-limited variant of a Tier, not a commercial Tier itself. |
| **Grace period** | A bounded period of defined rights after a qualifying contract-status change. |
| **Organization** | An entitled customer managed within a Workspace. Distinct from the Workspace, Account and technical Tenant. |
| **Subject** | A person, service account or other actor to whom an entitlement may apply. |
| **Resource** | An application object that may be subject to an entitlement. |
| **Contract** | The link between agreed commercial terms and an Organization's entitled rights. |
| **Assignment** | The association between an Organization and its current commercial offer. |
| **Override** | A scoped replacement for an inherited commercial value. Distinct from a restrictive environment prerequisite. |
| **Grant** | An additive allowance for a scope, rather than a replacement value. |
| **Unlimited** | An explicit absence of a numeric cap, not a missing value, null or an arbitrary large number. |
| **Resolved value** | The effective entitlement value after applying the relevant precedence rules. |
| **Usage** | Consumption measured by the application or a metering system. |
| **Consumption dashboard** | A view combining entitlement limits with reported usage and its freshness. |

## Control plane and identity

| Term | Definition |
|---|---|
| **Workspace** | A business's control plane for its Catalog, Tiers, Organizations, members and records. |
| **Tenant** | A technical isolation context in shared infrastructure. Not the preferred name for a Workspace or an Organization. |
| **Account** | A person's sign-in identity, which may participate in multiple Workspaces. |
| **Member** | An Account's membership in a Workspace. |
| **Role** | A member's administrative authority within a Workspace. |
| **Owner** | A Role with full Workspace administration, including membership management. |
| **Manager** | A Role with delegated membership management. |
| **User** | A Role with read access to the Workspace. |
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

# ACME: from a Workspace to a personal entitlement

ACME builds a document-assistant SaaS. It sells Business and Enterprise offers to other companies. Its sales team negotiates some Organization limits; a few customers need personal allowances. The same product can be self-hosted without a billing provider.

This guide describes the Workspace preview. Python authoring and the TypeScript/Zod interface in this change are available from the source checkout until the corresponding SDK versions are released. Package documentation is not evidence that an unpublished version can already be installed from PyPI/npm.

## 1. Create the Workspace

Sign in to the [Workspace console](../../console/WORKSPACES.md) and create **ACME Document Assistant**. A Workspace contains the Privilege Catalog, Groups, Tags, Tiers, Tier variants, Organizations, application-user exceptions, members and audit history. Console members administer the product; they are not the product's entitled users.

The same account can join other Workspaces, but their Catalogs, Organizations and evaluation keys remain separate. ACME's customers, such as Globex, are **Organizations inside this Workspace**.

## 2. Define the Privilege Catalog in Python

The SDK's models are Pydantic `BaseModel`s, with typed validation, `model_validate_json()`, `model_dump_json()` and `model_json_schema()`. Pydantic is the core's only required dependency ([ADR-0006](../../ADR-0006.md)); Python 3.11 or later is required:

```sh
pip install openentitlement-sdk
```

From the source checkout, run `uv sync --project sdk-python --locked` and the executable [ACME Catalog example](../../sdk-python/examples/acme_catalog.py). The code below defines real models; it does not write to a server. The [Privilege class source](../../sdk-python/packages/openentitlement/src/openentitlement/privileges.py) shows the BaseModel fields and validators:

```python
from openentitlement import (
    Privilege, IntegerPrivilege, BooleanPrivilege,
    PrivilegeCatalog, Group, Tag,
)

# Privilege is the shared BaseModel: key, title, description,
# visibility, group_id and tags. Use a typed subclass for its value.
seats: Privilege = IntegerPrivilege(
    key="seat_max",
    title="Seats",
    description="Maximum licensed seats per Organization.",
    default=5,
    minimum=0,
    unlimited=True,
    group_id="collaboration",
    tags=["licensed"],
)
catalog = PrivilegeCatalog(
    groups=[Group(id="collaboration", title="Collaboration")],
    tags=[Tag(id="licensed", title="Licensed")],
    privileges=[seats],
)
payload = catalog.model_dump_json(exclude_none=True)
assert '"groupId":"collaboration"' in payload  # JSON is camelCase
assert PrivilegeCatalog.model_validate_json(payload) == catalog
```

Python attributes and keyword arguments are snake_case (`group_id`). The JSON, JSON Schema and FastAPI responses use camelCase (`groupId`, `parentId`, `envOverride`). Validation accepts either spelling.

Use `seat_max`, not a path such as `seat.max`. One Privilege has **at most one Group**, while `tags` can contain multiple existing Tags. A Group can have a parent; nesting never changes a Privilege key. `IntegerPrivilege(key="seat_max", title="Seats", default=-5)` raises a validation error. Boolean defaults reject strings such as `"false"`; this is strict validation, not coercion.

`BooleanPrivilege` alone accepts `env_override` (`envOverride` in JSON). `MCP_INSTALLED=false` can veto `mcp_enabled`, but `true` cannot grant commercially denied access. Installer/platform settings own that binding. `read_only` uses a Catalog default; `hidden` still evaluates while being omitted from normal controls. An editable Privilege without a default requires a value in every Tier variant. See the [complete Catalog contract](../../console/PRIVILEGE-CATALOG.md).

In the console, define the same Groups and Tags, then the Privileges. Python and Zod validate the same authoring JSON shape; **printing a Catalog does not import it into the Workspace**. The Configuration page exports a sanitized YAML snapshot; it is not an import mechanism.

## 3. Build ACME's commercial offers

Create reusable **Business** and **Enterprise** Tiers, then their variants. These are ACME's offers, not OpenEntitlement Cloud subscription tiers.

| Privilege | Catalog default | Business standard | Enterprise standard |
| --- | --- | --- | --- |
| `seat_max` | 5 | 25 | Unlimited |
| `ai_tokens` | 1,000 | 10,000 | 50,000 |
| `mcp_enabled` | Disabled | Disabled | Enabled, subject to installation |
| `retention` | 30d | 30d | 365d |

A Tier can have standard, trial and grace variants; a trial/grace condition is not another Tier. For example, a Business trial could allow 5,000 tokens, and its grace variant 1,000. Configure grace days on the Tier and the post-grace policy at the bottom of the Tiers page. Grace/fallback suspend negotiated personal terms and grants. A read-only status is returned for the application to enforce; no customer documents are deleted.

These allowances contain no embedded time window. If ACME sells tokens per month, ACME's application or metering integration owns the month boundary, counting, resets and idempotency.

## 4. Assign Organizations

Add **Globex**, ID `globex`, to Business standard. Its contract negotiates `seat_max=40`; other values inherit. A second Organization can use the same product offers with different terms. Do not clone a Tier for each deal.

The Organization's effective seats become 40: Catalog 5 → Business 25 → Organization terms 40. Its ordinary token allowance remains 10,000.

## 5. Add application-user exceptions

Select Globex, then **Add user**. Enter Alice's application ID `idp|alice` and a display name. Give Alice `ai_tokens=15,000` in personal terms and an additional grant of 2,000. Her resolved allowance is 17,000; Bob inherits 10,000. This does not provision accounts, assign Roles, purchase seats, or consume tokens.

Alice's identity is `(Workspace, globex, idp|alice)`. Another Organization can use the same subject ID without inheriting her exceptions. Personal terms bind to the assigned Tier variant; switching variant retains but deactivates those terms. Grants remain scoped to Alice across variant changes. Removing Alice's exceptions restores inheritance and is audited.

For **OpenEntitlement Cloud**, Pro supports Organization scope, and Enterprise adds user scope. Platform administrators set this service capability; Workspace Owners cannot unlock it by defining an ACME Tier called Enterprise. A Cloud downgrade preserves records but rejects user evaluation with 403. Self-hosted Workspace installations support user scope. This is packaging, not an assertion of enterprise compliance or a new protocol restriction.

## 6. Evaluate from Python

Create a Workspace evaluation key in Settings. Put it in your application's secret manager/environment, not its Catalog. The Workspace preview has its own endpoint; do not point `RemoteProvider` at it and assume it speaks OEREP:

```python
import json
import os
from urllib.request import Request, urlopen

base_url = "http://localhost:18789"
request = Request(
    f"{base_url}/api/evaluate",
    data=json.dumps({
        "organizationId": "globex",
        "subjectId": "idp|alice",
        "privilege": "ai_tokens",
    }).encode(),
    headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {os.environ['OE_EVAL_KEY']}",
    },
)
with urlopen(request, timeout=10) as response:
    decision = json.load(response)
assert decision["value"] == 17_000
assert decision["reason"] == "SUBJECT_GRANT"
```

Omit `subjectId` to evaluate Globex's Organization value. Unknown users inherit; a user directory record is only required for an exception. On Cloud Pro, sending a subject ID explicitly fails rather than silently returning an Organization value. The caller authenticates its users and supplies trusted Organization/subject IDs. A backend key must never be embedded in a public browser.

Entitlements answer what was purchased or granted. ACME's authorization still decides whether Alice may read a particular document. Apply both checks; user entitlements do not replace RBAC/ABAC.

## TypeScript equivalent

Zod ships with the core SDK; its authoring subpath needs no extra install:

```sh
npm install @openentitlement/core
```

```ts
import { PrivilegeCatalogSchema } from '@openentitlement/core/authoring';

const catalog = PrivilegeCatalogSchema.parse({
  groups: [{ id: 'collaboration', title: 'Collaboration' }],
  tags: [{ id: 'licensed', title: 'Licensed' }],
  privileges: [{
    key: 'seat_max', type: 'integer', title: 'Seats',
    default: 5, minimum: 0, unlimited: true,
    groupId: 'collaboration', tags: ['licensed'],
  }],
});
```

Under [ADR-0006](../../ADR-0006.md), the core SDKs depend only on widely adopted validation libraries: Pydantic in Python and Zod in TypeScript. Database drivers stay optional extras. [OpenFeature's Python SDK](https://github.com/open-feature/python-sdk) and [contrib repository](https://github.com/open-feature/python-sdk-contrib) are useful references for separating core APIs from optional providers; no provider compatibility is implied here.

## Keys are flat

Privilege keys and feature codes match `^[a-z][a-z0-9_]*$`, such as `seat_max`. Dotted keys like `seat.max` are rejected: they are not valid identifiers in Python or most languages, and they add no structure. Organize Privileges with Groups and Tags instead. Renaming a key you already use requires migrating its Tier values, terms, grants and application checks together.

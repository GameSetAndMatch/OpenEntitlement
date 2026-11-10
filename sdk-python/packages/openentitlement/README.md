# OpenEntitlement Python SDK

A vendor-neutral API for product entitlements: feature access, numeric limits, plan defaults, customer overrides and grants. Includes in-memory, fixed-value and remote HTTP providers. Requires Python 3.10 or later.

```bash
pip install openentitlement-sdk
```

Read the [quickstart](https://openentitlement.dev/docs/quickstart/), [Python SDK guide](https://github.com/open-entitlement/OpenEntitlement/blob/main/sdk-python/README.md), and [specification](https://openentitlement.dev/docs/specification/). PostgreSQL and Stripe providers are available as separate packages.


The PyPI distribution is **openentitlement-sdk**; Python imports remain `openentitlement`.

```python
from openentitlement import Catalog, FixedProvider, create_client, feature, integer

catalog = Catalog([feature("seats", "Seats", [integer("seat_max")])])
client = create_client(FixedProvider(catalog, {"seat_max": 25}), catalog)
assert client.get_limit("seat_max", {"organizationId": "acme"}) == 25
```

Privilege keys are flat (`seat_max`). Groups and Tags are separate Catalog metadata, rather than segments encoded into a dotted key. See the [Privilege Catalog guide](https://github.com/open-entitlement/OpenEntitlement/blob/main/console/PRIVILEGE-CATALOG.md) for typed definitions. Existing dotted identifiers remain supported by the v1 SDK for compatibility; no automatic key renaming occurs.


For strict **Pydantic** authoring, install `openentitlement-sdk[authoring]` and import typed models from `openentitlement.authoring`:

```python
from openentitlement.authoring import IntegerPrivilege, Privilege

seats: Privilege = IntegerPrivilege(
    key="seat_max", title="Seats", description="Licensed seats per Organization.",
    default=5, minimum=0, unlimited=True,
)
print(seats.model_dump_json(exclude_none=True))
```

Follow the [ACME Workspace case study](https://openentitlement.dev/docs/acme-workspace/) for Workspaces, a Privilege Catalog, Groups and Tags, Tiers and variants, Organizations and user-specific terms/grants. The Workspace control-plane preview has its own evaluation API; existing `RemoteProvider` targets the OEREP service. The standard-library dataclasses remain available from `openentitlement` for dependency-free authoring/evaluation.

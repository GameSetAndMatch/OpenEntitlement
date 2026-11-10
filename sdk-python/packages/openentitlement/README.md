# OpenEntitlement Python SDK

A vendor-neutral API for product entitlements: feature access, numeric limits, plan defaults, customer overrides and grants. Includes in-memory, fixed-value and remote HTTP providers. Requires Python 3.11 or later and Pydantic 2.

```bash
pip install openentitlement-sdk
```

Read the [quickstart](https://openentitlement.dev/docs/quickstart/), [Python SDK guide](https://github.com/open-entitlement/OpenEntitlement/blob/main/sdk-python/README.md), and [specification](https://openentitlement.dev/docs/specification/). The PostgreSQL provider and lock are in `openentitlement.postgres`; install them with `pip install "openentitlement-sdk[postgres]"`.


The PyPI distribution is **openentitlement-sdk**; Python imports remain `openentitlement`.

```python
from openentitlement import Catalog, FixedProvider, create_client, feature, integer

catalog = Catalog([feature("seats", "Seats", [integer("seat_max")])])
client = create_client(FixedProvider(catalog, {"seat_max": 25}), catalog)
assert client.get_limit("seat_max", {"organization_id": "acme"}) == 25
```

Privilege keys are flat (`seat_max`). Groups and Tags are separate Catalog metadata, rather than segments encoded into a dotted key. See the [Privilege Catalog guide](https://github.com/open-entitlement/OpenEntitlement/blob/main/console/PRIVILEGE-CATALOG.md) for typed definitions. Dotted identifiers are rejected. Use nested Groups and Tags to organize flat keys; no automatic key renaming occurs.


Every model is a **Pydantic** model: snake_case attributes, camelCase JSON and JSON Schema, and validation that accepts either spelling. Pydantic is the only required dependency. The strict Privilege Catalog models are exported from `openentitlement`:

```python
from openentitlement import IntegerPrivilege, Privilege

seats: Privilege = IntegerPrivilege(
    key="seat_max", title="Seats", description="Licensed seats per Organization.",
    default=5, minimum=0, unlimited=True,
)
print(seats.model_dump_json(exclude_none=True))  # camelCase JSON
```

The models work directly as FastAPI request and response types: see [Use with FastAPI](https://openentitlement.dev/docs/python/#use-with-fastapi).

Follow the [ACME Workspace case study](https://openentitlement.dev/docs/acme-workspace/) for Workspaces, a Privilege Catalog, Groups and Tags, Tiers and variants, Organizations and user-specific terms/grants. The Workspace control-plane preview has its own evaluation API; existing `RemoteProvider` targets the OEREP service.

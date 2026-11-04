---
title: Python SDK
description: Evaluate entitlements from Python using the synchronous reference SDK.
---

The Python SDK is synchronous and uses `urllib` from the standard library for remote evaluation.

## Use the source workspace

Requires Python ≥3.10 and [uv](https://docs.astral.sh/uv/). From the repository root:

```sh
cd sdk-python
uv sync
```

Save the example as `sdk-python/example.py` and run `uv run python example.py`. Start the [demo service](/docs/quickstart/) first.

```python
import json
import os
from pathlib import Path
from openentitlement import Catalog, RemoteProvider, create_client

catalog = Catalog.from_dict(json.loads(
    (Path(__file__).resolve().parent.parent / 'spec/assets/catalog.json').read_text()
))
client = create_client(
    catalog=catalog,
    provider=RemoteProvider(
        'http://localhost:8787',
        token=os.environ.get('OE_EVAL_TOKEN'),
        timeout=5.0,
    ),
)
context = {'organization_id': 'acme'}
print(client.get_limit('seats.max', context))  # 250
print(client.is_enabled('sso', context))      # True
print(client.get_details('seats.max', context).to_dict())
```

## Use idiomatic names

Python uses snake_case: `get_limit`, `is_enabled`, `get_enum`, `get_details`, `require_within`, and `required_plan`. Wire JSON retains the specification's camelCase names.

```python
client.require_within('projects.max', 4, 1, {'organization_id': 'globex'})
```

For a shared pool with a subject allowance, usage is `{'pool': 4, 'subject': 0}`. The `pool` count is required. Invalid input raises `InvalidArgument`.

A remote failure resolves to the privilege's local default with reason `ERROR`. Use timezone-aware datetimes when providing `now` directly to the remote provider. The client normalizes naive datetimes as UTC.

For atomic check-and-act, see [Guards & usage](/docs/guards/). [Full Python SDK source](https://github.com/GameSetAndMatch/openentitlement/tree/main/sdk-python).

# openentitlement-postgres

PostgreSQL provider and advisory lock for OpenEntitlement.

```bash
pip install openentitlement-postgres
```

Install PostgreSQL client libraries (`libpq`) or use `pip install "psycopg[binary]"` for a self-contained client installation. A running PostgreSQL database is required to use this provider.

See the [Python SDK guide](https://github.com/GameSetAndMatch/openentitlement/blob/main/sdk-python/README.md) for configuration and examples, and the [documentation](https://openentitlement.dev/docs/) for the entitlement model.

This is an optional provider adapter, not a Tier variant. It depends on the core `openentitlement-sdk` distribution; Python imports remain `openentitlement`. See the [Python-first ACME case study](https://openentitlement.dev/docs/acme-workspace/) for Workspaces, Catalogs, Groups, Tags, Tiers and Organization/user scope.

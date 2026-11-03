"""Conformance targets: one per provider. Third-party providers add a Target and reuse the steps."""

from __future__ import annotations

import os
import threading
import time
from typing import Any, Optional

from openentitlement import UNLIMITED, Capabilities, InMemoryProvider, Plan, ValueType

FIXED_CAPS = Capabilities(fixed=True)


class Target:
    name = "abstract"
    capabilities: Capabilities = Capabilities()

    def setup(self, world: Any) -> None:  # called by 'Given the standard plans'
        raise NotImplementedError

    def counter(self, org: str) -> Any:
        return _MemoryCounter()

    def teardown(self) -> None:
        return None


class _MemoryCounter:
    """Usage store for guard scenarios. The sleeps widen the race window so a missing lock shows."""

    def __init__(self) -> None:
        self._n = 0
        self._inc = threading.Lock()

    def count(self, tx: Any) -> int:
        n = self._n
        time.sleep(0.002)
        return n

    def increment(self, tx: Any) -> None:
        with self._inc:  # atomic, so only an unserialized check-then-act can overshoot
            self._n += 1

    def value(self) -> int:
        return self._n


class MemoryTarget(Target):
    name = "in-memory"
    capabilities = InMemoryProvider.capabilities

    def setup(self, world: Any) -> None:
        world.make_client(InMemoryProvider())
        world.seeder = world.client.admin


class FixedTarget(Target):
    """Only runs @fixed scenarios; the 'Given a fixed provider' step builds the client."""

    name = "fixed"
    capabilities = FIXED_CAPS

    def setup(self, world: Any) -> None:
        raise AssertionError("fixed targets do not seed plans")


# ------------------------------------------------------------------------- Postgres


class PostgresTarget(Target):
    name = "postgres"

    def __init__(self, dsn: str):
        import openentitlement_postgres as oep

        self._oep = oep
        self.dsn = dsn
        self.capabilities = oep.PostgresProvider.capabilities
        oep.migrate(dsn)
        import psycopg

        with psycopg.connect(dsn) as c:
            c.execute("create table if not exists oe_conformance_counter (org text primary key, n integer not null)")

    def setup(self, world: Any) -> None:
        import psycopg

        with psycopg.connect(self.dsn) as c:
            c.execute(
                "truncate oe_audit, oe_grant, oe_override, oe_assignment, oe_plan_value, oe_plan,"
                " oe_conformance_counter restart identity cascade"
            )
        world.make_client(
            self._oep.PostgresProvider(self.dsn), lock=self._oep.PostgresAdvisoryLock(self.dsn)
        )
        world.seeder = world.client.admin

    def counter(self, org: str) -> Any:
        return _PgCounter(self.dsn, org)


class _PgCounter:
    def __init__(self, dsn: str, org: str):
        import psycopg

        self.dsn, self.org = dsn, org
        with psycopg.connect(dsn) as c:
            c.execute(
                "insert into oe_conformance_counter (org, n) values (%s, 0) on conflict (org) do update set n = 0",
                (org,),
            )

    def count(self, tx: Any) -> int:
        row = tx.execute("select n from oe_conformance_counter where org = %s", (self.org,)).fetchone()
        time.sleep(0.002)
        return int(row[0])

    def increment(self, tx: Any) -> None:
        time.sleep(0.002)
        tx.execute("update oe_conformance_counter set n = n + 1 where org = %s", (self.org,))

    def value(self) -> int:
        import psycopg

        with psycopg.connect(self.dsn) as c:
            return int(c.execute("select n from oe_conformance_counter where org = %s", (self.org,)).fetchone()[0])


# ------------------------------------------------------------------------- Stripe (fake account)


class _FakeStripe:
    """Plays the Stripe account: plans become products whose features follow the lookup-key convention."""

    def __init__(self, catalog: Any):
        self.catalog = catalog
        self.plans: dict[str, Plan] = {}
        self.values: dict[str, dict[str, Any]] = {}
        self.customers: dict[str, str] = {}  # org -> plan id
        self.lock = threading.Lock()

    def lookup_keys(self, plan_id: str) -> list[str]:
        keys = []
        for key, v in self.values.get(plan_id, {}).items():
            priv = self.catalog.privilege(key)
            if priv.value_type is ValueType.BOOLEAN:
                if v is True:
                    keys.append(key)
            elif v is UNLIMITED:
                keys.append(f"{key}:unlimited")
            else:
                keys.append(f"{key}:{v}")
        return keys

    def transport(self, url: str, headers: Any) -> tuple[int, bytes]:
        import json
        import urllib.parse

        q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
        org = q["customer"][0].removeprefix("cus_")
        with self.lock:
            plan = self.customers.get(org)
            keys = self.lookup_keys(plan) if plan else []
        data = [{"id": f"ent_{i}", "object": "entitlements.active_entitlement", "lookup_key": k} for i, k in enumerate(keys)]
        return 200, json.dumps({"object": "list", "data": data, "has_more": False}).encode()


class _StripeSeeder:
    def __init__(self, fake: _FakeStripe):
        self.fake = fake

    def upsert_plan(self, plan: Plan, *, actor: str, reason: str) -> None:
        self.fake.plans[plan.id] = plan

    def set_plan_value(self, plan_id: str, privilege: str, value: Any, *, actor: str, reason: str) -> None:
        self.fake.values.setdefault(plan_id, {})[privilege] = value

    def assign_plan(self, org: str, plan_id: Optional[str], *, actor: str, reason: str, channel: Optional[str] = None) -> None:
        with self.fake.lock:
            if plan_id is None:
                self.fake.customers.pop(org, None)
            else:
                self.fake.customers[org] = plan_id

    def create_override(self, *a: Any, **k: Any) -> None:
        raise AssertionError("Stripe has no overrides; scenario should have been skipped")

    create_grant = create_override


class StripeTarget(Target):
    name = "stripe"

    def __init__(self) -> None:
        from openentitlement_stripe import StripeEntitlementsProvider

        self._cls = StripeEntitlementsProvider
        self.capabilities = StripeEntitlementsProvider.capabilities

    def setup(self, world: Any) -> None:
        fake = _FakeStripe(world.catalog)
        provider = self._cls(
            "sk_test_conformance",
            customer_for=lambda org: f"cus_{org}" if org in fake.customers else None,
            transport=fake.transport,
            cache_ttl=0,
        )
        world.make_client(provider)
        world.seeder = _StripeSeeder(fake)


def all_targets() -> list[Target]:
    targets: list[Target] = [MemoryTarget(), FixedTarget(), StripeTarget()]
    dsn = os.environ.get("OE_PG_DSN")
    if dsn:
        targets.append(PostgresTarget(dsn))
    return targets

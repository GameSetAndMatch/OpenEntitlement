"""Conformance targets: one per provider. Third-party providers add a Target and reuse the steps."""

from __future__ import annotations

import os
import threading
import time
from typing import Any

from openentitlement import Capabilities, InMemoryProvider

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


def all_targets() -> list[Target]:
    targets: list[Target] = [MemoryTarget(), FixedTarget()]
    dsn = os.environ.get("OE_PG_DSN")
    if dsn:
        targets.append(PostgresTarget(dsn))
    return targets

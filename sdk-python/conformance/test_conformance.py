"""Run spec/assets/gherkin against every available target.

    uv run pytest conformance                         # in-memory, fixed, Stripe (fake account)
    OE_PG_DSN=postgresql://... uv run pytest conformance   # + Postgres
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from gherkin import Scenario, parse  # noqa: E402
from steps import World, run_step  # noqa: E402
from targets import Target, all_targets  # noqa: E402

from openentitlement import Catalog  # noqa: E402

SPEC = Path(__file__).resolve().parents[2] / "spec" / "assets"
CATALOG = Catalog.from_dict(json.loads((SPEC / "catalog.json").read_text()))
PLANS = json.loads((SPEC / "plans.json").read_text())
SCENARIOS = [s for f in sorted((SPEC / "gherkin").glob("*.feature")) for s in parse(f)]
TARGETS = all_targets()
CAPABILITY_TAGS = {"overrides", "grants", "mutations", "plan-catalog", "fixed"}


def applies(target: Target, scenario: Scenario) -> bool:
    caps = target.capabilities.tags()
    needed = scenario.tags & CAPABILITY_TAGS
    if ("fixed" in caps) != ("fixed" in needed):
        return False
    return needed <= caps


@pytest.mark.parametrize("target", TARGETS, ids=lambda t: t.name)
@pytest.mark.parametrize("scenario", SCENARIOS, ids=lambda s: s.id)
def test_scenario(target: Target, scenario: Scenario) -> None:
    if not applies(target, scenario):
        pytest.skip(f"{target.name} lacks {sorted(scenario.tags & CAPABILITY_TAGS)}")
    world = World(target=target, catalog=CATALOG, plans_fixture=PLANS)
    try:
        for st in scenario.steps:
            run_step(world, st.keyword, st.text)
            if st.keyword == "Given" and world.error is not None:
                raise world.error
        assert world.error_consumed, f"unasserted error: {world.error!r}"
    finally:
        target.teardown()


def test_every_scenario_runs_somewhere() -> None:
    for s in SCENARIOS:
        assert any(applies(t, s) for t in TARGETS), f"no target runs {s.id}"

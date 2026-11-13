"""Service layer: typed problems."""
from __future__ import annotations

import pytest

from openentitlement_service.services.problems import Problem


class Conflict(Problem):
    slug = "revision-conflict"
    status = 409
    title = "Revision conflict"


def test_a_problem_carries_its_type_status_and_parameters() -> None:
    problem = Conflict("Someone else changed this Tier.", expectedVersion=3)
    assert (problem.type, problem.status, dict(problem.params)) == (
        "https://openentitlement.dev/problems/revision-conflict",
        409,
        {"expectedVersion": 3},
    )


@pytest.mark.parametrize("member", ["type", "title", "status", "detail", "instance"])
def test_parameters_never_replace_standard_members(member: str) -> None:
    with pytest.raises(ValueError, match="standard members"):
        Conflict("Someone else changed this Tier.", **{member: "x"})


def test_every_problem_type_has_a_page_on_the_website() -> None:
    from pathlib import Path

    from openentitlement_service.services import problems

    pages = Path(__file__).resolve().parents[3] / "website" / "src" / "content" / "docs" / "problems"
    slugs = {c.slug for c in vars(problems).values() if isinstance(c, type) and issubclass(c, Problem) and c is not Problem}
    assert sorted(s for s in slugs if not (pages / f"{s}.md").is_file()) == []
    index = (pages / "index.md").read_text()
    assert sorted(s for s in slugs if f"(/problems/{s}/)" not in index) == []

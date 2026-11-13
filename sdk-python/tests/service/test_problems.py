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

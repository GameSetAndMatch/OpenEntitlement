"""The service README names the route dependencies that exist."""
import re
from pathlib import Path

from openentitlement_service.interfaces.http import dependencies

README = Path(__file__).parents[2] / "packages" / "service" / "README.md"


def test_the_readme_names_existing_route_dependencies() -> None:
    named = re.findall(r"`(\w+): (\w+)`", README.read_text(encoding="utf-8"))
    assert named, "The README shows how a route takes its Workspace transaction"
    assert [annotation for _, annotation in named if not hasattr(dependencies, annotation)] == []

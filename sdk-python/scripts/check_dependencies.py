"""Check each distribution against its own declared runtime dependencies."""
from pathlib import Path
import subprocess
import sys

packages = Path(__file__).resolve().parents[1] / "packages"
for project in sorted(packages.glob("*/pyproject.toml")):
    print(f"Checking dependencies: {project.parent.name}", flush=True)
    subprocess.run([sys.executable, "-m", "deptry", "."], cwd=project.parent, check=True)

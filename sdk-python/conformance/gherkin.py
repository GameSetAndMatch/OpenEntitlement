"""A minimal Gherkin parser: Feature, Background, Scenario, Scenario Outline, Examples, tags.

Dependency-free so any provider author can run the suite without extra tooling.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Step:
    keyword: str  # Given | When | Then (And/But resolved to the previous keyword)
    text: str
    line: int


@dataclass
class Scenario:
    feature: str
    name: str
    tags: set[str]
    steps: list[Step]
    path: str
    line: int

    @property
    def id(self) -> str:
        return f"{Path(self.path).stem}:{self.line}:{self.name}"


@dataclass
class _Outline:
    name: str
    tags: set[str]
    line: int
    steps: list[Step] = field(default_factory=list)
    examples: list[tuple[set[str], list[str], list[list[str]]]] = field(default_factory=list)


def _cells(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def parse(path: Path) -> list[Scenario]:
    feature_name, feature_tags = "", set()
    background: list[Step] = []
    items: list[_Outline] = []
    pending_tags: set[str] = set()
    current: _Outline | None = None
    in_background = False
    last_kw = "Given"
    for n, raw in enumerate(path.read_text().splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("@"):
            pending_tags |= {t[1:] for t in line.split()}
            continue
        if line.startswith("Feature:"):
            feature_name, feature_tags, pending_tags = line[8:].strip(), pending_tags, set()
            continue
        if line.startswith("Background:"):
            in_background, current = True, None
            continue
        m = re.match(r"^(Scenario Outline|Scenario Template|Scenario|Example):\s*(.*)$", line)
        if m:
            in_background = False
            current = _Outline(m.group(2), feature_tags | pending_tags, n)
            items.append(current)
            pending_tags = set()
            continue
        if line.startswith("Examples:") or line.startswith("Scenarios:"):
            assert current is not None, f"{path}:{n}: Examples outside a scenario"
            current.examples.append((pending_tags, [], []))
            pending_tags = set()
            continue
        if line.startswith("|"):
            assert current is not None and current.examples, f"{path}:{n}: table outside Examples"
            tags, header, rows = current.examples[-1]
            if not header:
                header.extend(_cells(line))
            else:
                rows.append(_cells(line))
            continue
        m = re.match(r"^(Given|When|Then|And|But|\*)\s+(.*)$", line)
        if not m:
            raise SyntaxError(f"{path}:{n}: cannot parse {line!r}")
        kw = m.group(1)
        kw = last_kw if kw in ("And", "But", "*") else kw
        last_kw = kw
        step = Step(kw, m.group(2), n)
        (background if in_background else current.steps).append(step)  # type: ignore[union-attr]

    out: list[Scenario] = []
    for it in items:
        if not it.examples:
            out.append(Scenario(feature_name, it.name, it.tags, background + it.steps, str(path), it.line))
            continue
        for ex_tags, header, rows in it.examples:
            for i, row in enumerate(rows):
                values = dict(zip(header, row, strict=False))

                def sub(text: str, values: dict[str, str] = values) -> str:
                    return re.sub(r"<([^<>]+)>", lambda m: values.get(m.group(1), m.group(0)), text)

                steps = [Step(s.keyword, sub(s.text), s.line) for s in it.steps]
                name = f"{it.name} [{', '.join(f'{k}={v}' for k, v in values.items())}]"
                out.append(Scenario(feature_name, name, it.tags | ex_tags, background + steps, str(path), it.line + i))
    return out

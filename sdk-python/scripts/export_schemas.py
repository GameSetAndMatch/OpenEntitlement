"""Generate the shared Privilege Catalog JSON Schema from the Pydantic models.

The Pydantic models in ``openentitlement.privileges`` are canonical. This script
writes ``spec/schemas/privilege-catalog.schema.json``, the cross-language
contract that the TypeScript Zod schemas and the shared fixtures in
``spec/assets/catalog-fixtures/`` are checked against.

    uv run python scripts/export_schemas.py           # rewrite the committed file
    uv run python scripts/export_schemas.py --check   # fail if it is out of date

The generator describes the JSON wire format rather than every Python
convenience:

- optional fields are omitted, never ``null``, so ``Optional[X] = None`` is
  emitted as ``X`` without a ``null`` alternative or ``"default": null``;
- single-value (``Literal``) fields such as the ``type`` discriminator and
  ``{"unlimited": true}`` are required, as the discriminated union needs them;
- field titles derived from Python names are dropped.

Rules that JSON Schema cannot express (trimmed titles, unique Tags and enum
choices, bounds between fields, required defaults, cross-references and Group
cycles) stay in the models; fixtures mark them with ``needsModelValidation``.
"""

from __future__ import annotations

import argparse
import difflib
import json
import sys
from pathlib import Path
from typing import Any

from pydantic.json_schema import GenerateJsonSchema, JsonSchemaValue
from pydantic_core import core_schema

from openentitlement.privileges import PrivilegeCatalog

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "spec" / "schemas" / "privilege-catalog.schema.json"
SCHEMA_ID = "https://openentitlement.dev/schemas/privilege-catalog.schema.json"


class CatalogJsonSchema(GenerateJsonSchema):
    def str_schema(self, schema: core_schema.StringSchema) -> JsonSchemaValue:
        result = super().str_schema(schema)
        # Rust regex uses a strict end anchor; Python/ECMA-262 $ also matches before
        # a final newline. Make the exported JSON pattern preserve the model rule.
        if result.get("pattern", "").endswith("$"):
            result["pattern"] += r"(?![\s\S])"
        return result

    def nullable_schema(self, schema: core_schema.NullableSchema) -> JsonSchemaValue:
        return self.generate_inner(schema["schema"])

    def default_schema(self, schema: core_schema.WithDefaultSchema) -> JsonSchemaValue:
        if schema.get("default", ...) is None:
            return self.generate_inner(schema["schema"])
        return super().default_schema(schema)

    def field_title_should_be_set(self, schema: Any) -> bool:
        return False

    def generate(self, schema: core_schema.CoreSchema, mode: Any = "validation") -> JsonSchemaValue:
        result = super().generate(schema, mode=mode)
        for definition in [result, *result.get("$defs", {}).values()]:
            properties = definition.get("properties", {})
            literals = [name for name, prop in properties.items() if "const" in prop]
            if literals:
                definition["required"] = list(dict.fromkeys([*definition.get("required", []), *literals]))
        return {"$schema": self.schema_dialect, "$id": SCHEMA_ID, **result}


def render() -> str:
    schema = PrivilegeCatalog.model_json_schema(by_alias=True, schema_generator=CatalogJsonSchema)
    return json.dumps(schema, indent=2, ensure_ascii=False) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="fail if the committed schema is out of date")
    args = parser.parse_args()
    expected = render()
    if args.check:
        current = TARGET.read_text(encoding="utf-8") if TARGET.exists() else ""
        if current != expected:
            sys.stdout.writelines(
                difflib.unified_diff(
                    current.splitlines(keepends=True),
                    expected.splitlines(keepends=True),
                    str(TARGET.relative_to(ROOT)),
                    "generated",
                )
            )
            print("\nRun: uv run --project sdk-python python sdk-python/scripts/export_schemas.py", file=sys.stderr)
            return 1
        return 0
    TARGET.write_text(expected, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""The shared Privilege Catalog contract: Pydantic, the committed JSON Schema and fixtures agree.

The TypeScript counterpart is sdk-js/test/catalog-contract.test.ts, run on the same fixtures.
"""

import importlib.util
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from pydantic import ValidationError

from openentitlement.privileges import PrivilegeCatalog

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = ROOT / "spec" / "schemas" / "privilege-catalog.schema.json"
FIXTURES = ROOT / "spec" / "assets" / "catalog-fixtures"
VALID = sorted((FIXTURES / "valid").glob("*.json"))
INVALID = sorted((FIXTURES / "invalid").glob("*.json"))
SCHEMA = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
VALIDATOR = Draft202012Validator(SCHEMA)


def _fixture(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _pydantic_accepts(catalog: object) -> bool:
    # Python deliberately accepts field names as well as the camelCase wire aliases.
    try:
        PrivilegeCatalog.model_validate(catalog)
    except ValidationError:
        return False
    return True


def test_committed_schema_matches_the_pydantic_models():
    spec = importlib.util.spec_from_file_location("export_schemas", ROOT / "sdk-python" / "scripts" / "export_schemas.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert SCHEMA_PATH.read_text(encoding="utf-8") == module.render(), (
        "Regenerate with: uv run --project sdk-python python sdk-python/scripts/export_schemas.py"
    )


def test_schema_is_valid_json_schema_2020_12():
    Draft202012Validator.check_schema(SCHEMA)
    assert SCHEMA["$schema"] == "https://json-schema.org/draft/2020-12/schema"


def test_fixture_sets_are_present():
    assert len(VALID) >= 10 and len(INVALID) >= 15


@pytest.mark.parametrize("path", VALID, ids=lambda p: p.stem)
def test_valid_fixture_is_accepted_by_pydantic_and_json_schema(path):
    catalog = _fixture(path)["catalog"]
    assert _pydantic_accepts(catalog)
    assert not list(VALIDATOR.iter_errors(catalog))
    model = PrivilegeCatalog.model_validate(catalog)
    serialized = json.loads(model.model_dump_json())
    assert VALIDATOR.is_valid(serialized)
    assert PrivilegeCatalog.model_validate(serialized) == model


@pytest.mark.parametrize("path", INVALID, ids=lambda p: p.stem)
def test_invalid_fixture_is_rejected_by_pydantic_and_json_schema(path):
    fixture = _fixture(path)
    assert _pydantic_accepts(fixture["catalog"]) == fixture.get("pythonConvenience", False)
    # Some rules (cross-references, cycles, unique items, bounds between fields) need the models.
    schema_accepts = VALIDATOR.is_valid(fixture["catalog"])
    assert schema_accepts == fixture.get("needsModelValidation", False)

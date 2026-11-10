# Privilege Catalog fixtures

Shared cases for the Privilege Catalog authoring contract ([RFC-0002](../../../docs/rfcs/0002-privilege-catalog.md)). The wire validators and the generated [JSON Schema](../../schemas/privilege-catalog.schema.json) must agree on them.

- `valid/*.json`: Catalogs every implementation accepts.
- `invalid/*.json`: Catalogs every implementation rejects.

Each file is an object:

| Field | Meaning |
|---|---|
| `description` | The rule the case exercises |
| `catalog` | The Catalog JSON, with camelCase keys |
| `pythonConvenience` | Invalid wire cases only. `true` for a deliberate Python field-name convenience (snake_case); Python accepts it while Zod and JSON Schema reject it. |
| `needsModelValidation` | Invalid cases only. `true` when the JSON Schema alone accepts the Catalog because the rule cannot be expressed in JSON Schema: trimmed titles, unique Tags and enum choices, minimum ≤ maximum, defaults within bounds, required defaults, unique identifiers, known references and acyclic Groups. The SDK models must still reject it. |

## Source of truth

The Pydantic models in `openentitlement.privileges` are canonical. `sdk-python/scripts/export_schemas.py` generates `spec/schemas/privilege-catalog.schema.json` from them; edit the models, then run:

```sh
uv run --project sdk-python python sdk-python/scripts/export_schemas.py
```

The generator describes the JSON wire format: optional fields are omitted rather than `null`, and single-value fields (the `type` discriminator, `{"unlimited": true}`) are required.

## Checks

- `sdk-python/tests/test_catalog_contract.py`: the committed schema equals a fresh export; every fixture is accepted or rejected by Pydantic (preserving the explicitly marked Python field-name convenience) and by the JSON Schema (`jsonschema`, Draft 2020-12).
- `sdk-js/test/catalog-contract.test.ts`: every fixture is accepted or rejected by the Zod `PrivilegeCatalogSchema`, and `z.toJSONSchema(PrivilegeCatalogSchema)` agrees structurally with the committed schema (ignoring titles, descriptions and `oneOf`/`anyOf` spelling).

Malformed Unlimited objects (empty, numeric, null, false and extra keys), explicit null members and trailing-newline identifiers are covered explicitly. Valid fixtures also roundtrip through ordinary Pydantic JSON serialization and validate against the generated schema.

Add a fixture whenever a rule changes; each new case runs in both languages automatically.

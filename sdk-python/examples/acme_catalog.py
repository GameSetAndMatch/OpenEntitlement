"""ACME authoring example: uv run --project sdk-python python sdk-python/examples/acme_catalog.py.

Prints a validated Privilege Catalog. It does not create a Workspace or publish
values; use the authenticated Workspace console to manage those records.
"""

from openentitlement import (
    BooleanPrivilege,
    Group,
    IntegerPrivilege,
    PrivilegeCatalog,
    StringEnumPrivilege,
    Tag,
)


def acme_catalog() -> PrivilegeCatalog:
    return PrivilegeCatalog(
        groups=[
            Group(id="collaboration", title="Collaboration", description="Seats and shared work."),
            Group(id="ai", title="AI", description="AI assistance and allowances."),
        ],
        tags=[Tag(id="licensed", title="Licensed"), Tag(id="usage", title="Usage allowance")],
        privileges=[
            IntegerPrivilege(
                key="seat_max",
                title="Seats",
                description="Maximum licensed seats per Organization.",
                default=5,
                unlimited=True,
                group_id="collaboration",
                tags=["licensed"],
            ),
            IntegerPrivilege(
                key="ai_tokens",
                title="AI tokens",
                description="Allowance evaluated against application-reported usage.",
                default=1000,
                group_id="ai",
                tags=["licensed", "usage"],
            ),
            BooleanPrivilege(
                key="mcp_enabled",
                title="MCP access",
                description="Use the MCP connector when it is installed.",
                default=False,
                env_override="MCP_INSTALLED",
                group_id="ai",
                tags=["licensed"],
            ),
            StringEnumPrivilege(
                key="retention",
                title="Retention",
                description="Document retention policy.",
                enum=["30d", "365d"],
                default="30d",
                group_id="collaboration",
            ),
        ],
    )


if __name__ == "__main__":
    print(acme_catalog().model_dump_json(indent=2, exclude_none=True))

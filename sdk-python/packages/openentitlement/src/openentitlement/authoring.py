"""Compatibility import path for the Privilege Catalog models.

The models live in ``openentitlement.privileges`` and are exported from
``openentitlement``. Pydantic is a core dependency (ADR-0006), so no extra is needed.
"""

from .privileges import (
    BooleanPrivilege,
    Group,
    IntegerPrivilege,
    Privilege,
    PrivilegeCatalog,
    StringEnumPrivilege,
    Tag,
    TypedPrivilege,
    Unlimited,
    Visibility,
)

__all__ = [
    "BooleanPrivilege",
    "Group",
    "IntegerPrivilege",
    "Privilege",
    "PrivilegeCatalog",
    "StringEnumPrivilege",
    "Tag",
    "TypedPrivilege",
    "Unlimited",
    "Visibility",
]

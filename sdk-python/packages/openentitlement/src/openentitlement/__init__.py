"""OpenEntitlement: a vendor-neutral entitlements API (Python reference SDK)."""

from .catalog import Catalog, FeatureDefinition, PrivilegeDefinition, ValueType, boolean, enum, feature, integer
from .client import SPEC_VERSION, AdminClient, EntitlementClient, EvaluationError, GuardResult, create_client
from .details import (
    ErrorCode,
    EvaluationContext,
    GrantApplied,
    Reason,
    ResolutionDetails,
    Usage,
    UsageBreakdown,
    pool_usage,
)
from .errors import (
    Conflict,
    EntitlementDenied,
    EntitlementLimitExceeded,
    FeatureNotEntitled,
    InvalidArgument,
    InvalidValue,
    NotFound,
    NotSupported,
    OpenEntitlementError,
    ProviderNotReady,
    TypeMismatch,
    to_http_problem,
)
from .facts import Assignment, FactSource, Grant, Override, Plan, Scope
from .fixed import FixedProvider
from .hooks import AuditLog, Hook, HookContext, MutationContext, MutationHook
from .lock import InProcessLock, Lock, lock_key
from .memory import InMemoryProvider
from .provider import (
    AbstractProvider,
    AuditEvent,
    Capabilities,
    FactsProvider,
    GrantInput,
    MutationMeta,
    Mutations,
    OverrideInput,
    Provider,
    ProviderMetadata,
)
from .remote import RemoteProvider
from .resolver import check_within, resolve_from_facts, suggest_plan_from_facts
from .values import UNLIMITED, Limit, Unlimited, Value, decode_value, encode_json, encode_value, fits, is_unlimited

__version__ = "0.2.0"

from .privileges import BooleanPrivilege, Group, IntegerPrivilege, Privilege, PrivilegeCatalog, StringEnumPrivilege, Tag, Visibility

__all__ = [
    "PrivilegeCatalog", "Privilege", "BooleanPrivilege", "IntegerPrivilege", "StringEnumPrivilege", "Visibility", "Group", "Tag",
    "AbstractProvider",
    "AdminClient",
    "Assignment",
    "AuditEvent",
    "AuditLog",
    "Capabilities",
    "Catalog",
    "Conflict",
    "EntitlementClient",
    "EntitlementDenied",
    "EntitlementLimitExceeded",
    "ErrorCode",
    "EvaluationContext",
    "EvaluationError",
    "FactSource",
    "FactsProvider",
    "FeatureDefinition",
    "FeatureNotEntitled",
    "FixedProvider",
    "Grant",
    "GrantApplied",
    "GrantInput",
    "GuardResult",
    "Hook",
    "HookContext",
    "InMemoryProvider",
    "InProcessLock",
    "InvalidArgument",
    "InvalidValue",
    "Limit",
    "Lock",
    "MutationContext",
    "MutationHook",
    "MutationMeta",
    "Mutations",
    "NotFound",
    "NotSupported",
    "OpenEntitlementError",
    "Override",
    "OverrideInput",
    "Plan",
    "PrivilegeDefinition",
    "Provider",
    "ProviderMetadata",
    "ProviderNotReady",
    "Reason",
    "RemoteProvider",
    "ResolutionDetails",
    "SPEC_VERSION",
    "Scope",
    "TypeMismatch",
    "UNLIMITED",
    "Unlimited",
    "Usage",
    "UsageBreakdown",
    "Value",
    "ValueType",
    "boolean",
    "check_within",
    "create_client",
    "decode_value",
    "encode_json",
    "encode_value",
    "enum",
    "feature",
    "fits",
    "integer",
    "is_unlimited",
    "lock_key",
    "pool_usage",
    "resolve_from_facts",
    "suggest_plan_from_facts",
    "to_http_problem",
]

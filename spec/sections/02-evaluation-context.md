# 2. Evaluation context

## Overview

The evaluation context identifies *who* is being evaluated and *when*. It deliberately carries no roles, permissions, or flag state ([§9](09-interoperability.md)).

```ts
type EvaluationContext = {
  organizationId: string;   // the entitled party: the customer account, tenant, or workspace
  subjectId?: string;       // optional: a user (or service account) within the organization
  resourceId?: string;      // optional: a resource within the organization (a project, a workspace)
  now?: Instant;            // optional: the instant at which to evaluate
};
```

### 2.1. Fields

#### Requirement 2.1.1

> The evaluation context MUST contain a non-empty `organizationId`. If it doesn't, resolution MUST return reason `ERROR` with error code `INVALID_CONTEXT`.

#### Requirement 2.1.2

> The evaluation context MAY contain a `subjectId`, a `resourceId`, or both. Each one, when present, MUST be a non-empty string.

#### Requirement 2.1.3

> If `now` is absent, the SDK MUST evaluate at the instant of invocation, read from an injectable clock. SDKs MUST let the application provide that clock.

Determinism under test, replay, and "what will this customer have next Monday?" all come from `now`.

#### Requirement 2.1.4

> `subjectId` and `resourceId` are scoped to the `organizationId`. Two organizations MAY use the same `subjectId` for different subjects, and implementations MUST NOT conflate them.

### 2.2. Merging

#### Requirement 2.2.1

> A client MAY be created with a default context. The context used for an evaluation MUST be the default context merged with the invocation context, with invocation fields taking precedence.

This mirrors OpenFeature's [Requirement 3.2.3](https://openfeature.dev/specification/sections/evaluation-context), reduced to two levels: client and invocation. A typical pattern binds `organizationId` once per request and passes `subjectId` per call.

### 2.3. Separation

#### Requirement 2.3.1

> An implementation MUST NOT read roles, permissions, or feature-flag state from the evaluation context. Unknown context fields MUST NOT change resolution.

#### Requirement 2.3.2

> Only fields defined in this section MAY influence resolution.

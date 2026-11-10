---
title: Specification overview
description: The shared entitlement model, evaluation semantics, JSON encoding, and remote protocol.
---

OpenEntitlement defines how an application describes product capabilities and resolves an organization's entitlement to them. The goal is a contract that implementations can share independently of billing vendors or storage engines.

The current specification is **v0.1.0, experimental**. OEREP v1 is a draft. This overview explains the structure; the linked numbered requirements define the behavior.

## Four parts of the contract

1. **Model:** features, typed privileges, plans, assignments, overrides, and grants. [Data model](/specification/01-data-model/).
2. **Meaning:** resolution precedence, time boundaries, shared pools, defaults, and upgrade suggestions. [Resolution](/specification/03-resolution/).
3. **Application API:** the operations and details SDKs expose. [Evaluation API](/specification/04-evaluation-api/).
4. **Transport:** how clients exchange context and resolution details over HTTP and JSON. [OEREP](/specification/10-remote-evaluation/).

The reference service, SDKs, and providers implement these contracts. Another implementation can use a different database or runtime while preserving the specified meaning.

## A worked decision

Consider an integer privilege `project_max` that allows unlimited values and defaults to zero. An organization has:

- A plan value of **50**.
- An active organization override of **80**, bound to its current plan family.
- An active organization grant of **20**.

The effective entitlement is **100**, with reason `GRANT`: the override replaces 50 with 80, then the grant adds 20. It is not 150; the plan and override do not add together.

If the override expires, the value becomes **70**. If the grant expires while the override remains active, it becomes **80**. An override tied to a different plan family is retained as stale and does not apply.

If the base value is `UNLIMITED`, adding a grant leaves it unlimited. On the wire, unlimited is exactly `{"unlimited":true}`.

## Equivalent shape is not equivalent behavior

A JSON response with the right fields can still be wrong if it applies another subject's grant, changes override precedence, or silently uses a default tenant for invalid context. Compatibility requires the semantics as well as the schema.

The [shared conformance scenarios](https://github.com/GameSetAndMatch/openentitlement/tree/main/spec/assets/gherkin) exercise the numbered requirements across implementations. The [implementer guide](/docs/implementing/) explains the expected evidence.

## Adoption and change

Pin the specification and implementation revision used for evaluation. Minor draft versions may change incompatibly. A proposal that changes resolution needs worked examples and shared tests, plus a compatibility explanation for existing callers.

Read [project status](/docs/project/) for current implementation and deployment boundaries. Usage metering, periodic resets, payments, and reservations remain outside this draft.

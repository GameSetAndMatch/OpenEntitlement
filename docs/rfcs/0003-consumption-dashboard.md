# RFC-0003: Read-only consumption dashboard

- **Status:** proposed; usage-data source is not connected
- **Date:** 2026-11-09
- **Boundary:** [ADR-0004](../../ADR-0004.md), [VISION.md](../../VISION.md)

## Problem and current evidence

Organizations should be able to compare entitlement limits with actual application usage. The current service resolves limits and accepts application-provided `current` usage when checking a request; the administrative check handler calls `client.requireWithin(...)`. The SDK's count/check/act path and usage-store ownership remain in the application. No service-owned actual-usage history is established by this interface. An evaluation count or a user's simulator input is not customer consumption.

This is a data-source requirement, not permission to build a billing/metering engine. The dashboard must not infer zero usage, consumption windows or progress from entitlement facts alone.

## Small first slice once data is available

Show one row per visible integer Privilege and Organization: effective limit and source, reported usage, remaining allowance when computable, observation time and optional application-supplied measurement window/unit. Show unlimited limits explicitly. Missing usage is **Usage not reported**; stale usage is labeled and must not imply enforcement freshness. Boolean/string-enum values are not numeric consumption.

Use a read-only application/metering adapter or clearly labeled imported snapshot. Enforce Workspace scope and preserve source identity. The application decides what was counted, per-user/per-Organization subject, unit, reset boundary and idempotency. Avoid automatic resets, reservations, quota deductions or per-evaluation counters in OE.

The view should reuse existing typed/resolution components, accessible tables and meaningful browser scenarios. A usage bar is useful only when a finite positive limit and compatible current usage are known. Do not fabricate chart history or silently normalize units.

## Open prerequisite

Select an actual usage source and verify its account/Organization/Privilege identifiers, units, timestamps, freshness and read permissions. There is not yet a connected source to populate a real consumption dashboard. Until then, the project should keep the source requirement visible rather than release a dashboard that presents simulations or missing data as actual usage.

No normative protocol change, write ingestion API or billing feature is accepted by this RFC.

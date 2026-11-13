# RFC-0006: Allowances that reset per period

- **Status:** proposed (2026-11-13). The direction is approved; the open questions below are the owner's. Built after the Python switch-over (OPE-45).
- **Date:** 2026-11-13
- **Related:** [ADR-0011](../../ADR-0011.md) (Tier minimums and Minimum commitments), [RFC-0005](0005-product-scoped-evaluation.md) (Product-scoped OEREP), [PRD.md](../../PRD.md)

## Why

Some allowances are amounts per period, such as "10M tokens a week". An integer Privilege today is only an amount: `token_max: 10000000` does not say whether it is per day, per week, per month or for the life of the contract. The application that counts usage has to know that from somewhere else, and two applications can read the same value differently.

## Proposal

- An integer Privilege may have an optional **reset period**: `day`, `week` or `month`. Without one, the Privilege means what it means today.
- The period belongs to the Privilege in the Product's Privilege Catalog, not to a Tier or an Organization.
- The protocol returns the period with the value, so an application reads the amount and its period from the same response.
- Usage stays the application's. The service does not count, store or reset usage; it says what the allowance is and how often it resets. Read-only evaluation still consumes nothing.

For example, `token_max` is an integer Privilege with reset period `week`. The Business Tier gives 10,000,000. The application counts the tokens each Organization used in the current week and compares the count with 10,000,000.

This RFC does not change OEREP until it is accepted. The exact Catalog field, response field, JSON Schema, OpenAPI and conformance scenarios are written when it is implemented, together, in both SDKs and the shared conformance suite.

## Open questions for the owner

### 1. Period boundaries and time zone

When does a day, a week or a month start, and in which time zone?

**Recommendation:** calendar boundaries in UTC. A day starts at 00:00 UTC, a week on Monday at 00:00 UTC (ISO 8601), a month on the 1st at 00:00 UTC. One rule for every Organization keeps the service, every SDK and every application in agreement, and a per-Organization time zone can be added later without breaking it.

### 2. Rolling or calendar window

Is "10M tokens a week" the current calendar week, or the last seven days at any moment?

**Recommendation:** calendar windows. The application can count usage per window and start again at each boundary. A rolling window needs a usage history for every moment, which the application owns and the protocol cannot describe with one period name. The response can then also tell the application where the current window starts and ends for the request's evaluation time, so the application and the service agree on it.

### 3. How Grants and Organization terms combine with a period

Is a Grant of 1M tokens on a weekly allowance added every week, or once?

**Recommendation:** every value of a periodic Privilege is an amount per that Privilege's period. Organization terms replace the per-period amount, as overrides do today. A Grant adds to the per-period amount for every period in which it is active (by its start and expiry), so 10M plus a Grant of 1M is 11M each week while the Grant lasts. A Grant has no period of its own. A one-off top-up that is used up once is a different concept and stays out of scope.

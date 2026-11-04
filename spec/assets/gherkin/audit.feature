@mutations
Feature: Mutations, hooks and audit
  # spec §6.3, §7.2, §7.3: every change is attributed, justified, and observable.

  Background:
    Given the standard plans
    And the clock is "2026-06-15T12:00:00Z"
    And organization "acme" is on plan "pro"

  @spec-6.3.3 @spec-7.2.3 @spec-7.3.1 @spec-7.3.2
  Scenario: Changing a plan value records before and after
    When "pricing-team" sets plan "pro" "seats.max" to 25 because "Q3 repackaging"
    Then an audit event records update of planValue "pro:seats.max"
    And its before is 20
    And its after is 25
    And its actor is "pricing-team"
    And its reason is "Q3 repackaging"
    And its time is "2026-06-15T12:00:00Z"

  @spec-7.3.2
  Scenario: Setting a value for the first time is a create
    When "pricing-team" sets plan "legacy" "sso.connections.max" to 1 because "backfill"
    Then an audit event records create of planValue "legacy:sso.connections.max"
    And its before is null
    And its after is 1

  @spec-7.3.1
  Scenario: Unlimited is encoded in audit payloads
    When "pricing-team" sets plan "pro" "seats.max" to unlimited because "promo"
    Then an audit event records update of planValue "pro:seats.max"
    And its after is {"unlimited": true}

  @spec-7.3.3
  Scenario: Plan assignments are audited
    When organization "acme" moves to plan "business"
    Then an audit event records update of assignment "acme"
    And its before includes {"planId": "pro"}
    And its after includes {"planId": "business"}

  @spec-7.3.3
  Scenario: Removing a plan is a delete
    When organization "acme" loses its plan
    Then an audit event records delete of assignment "acme"
    And its after is null

  @overrides @spec-7.3.1
  Scenario: Override creation and deletion are audited
    When I try to create an override "o1" setting "seats.max" to 500 for organization "acme"
    And override "o1" is deleted
    Then an audit event records create of override "o1"
    And its after includes {"value": 500, "planFamily": "pro"}
    And an audit event records delete of override "o1"
    And its before includes {"value": 500}
    And its after is null

  @grants @spec-7.3.1
  Scenario: Grant creation and revocation are audited
    When I try to grant 500 "api_calls.monthly" to organization "acme" as "g1"
    And grant "g1" is revoked
    Then an audit event records create of grant "g1"
    And an audit event records revoke of grant "g1"
    And its after marks it revoked at "2026-06-15T12:00:00Z"

  @spec-6.3.2
  Scenario: Mutations without a reason are rejected
    When "pricing-team" sets plan "pro" "seats.max" to 25 without a reason
    Then the operation fails with "INVALID_ARGUMENT"
    And no audit event was recorded

  @spec-6.3.4
  Scenario: Mutations on missing entities fail without side effects
    When override "nope" is deleted
    Then the operation fails with "NOT_FOUND"
    And no audit event was recorded

  @spec-7.2.2
  Scenario: A before hook can veto a change
    Given a mutation hook that vetoes every change
    When "pricing-team" sets plan "pro" "seats.max" to 25 because "Q3 repackaging"
    Then the operation fails with "VETOED"
    And no audit event was recorded
    When I resolve "seats.max" for organization "acme"
    Then the value is 20

  @spec-1.3.2 @spec-6.3.4
  Scenario: A plan cannot become its own variant
    When I try to make plan "pro" a variant of "pro"
    Then the operation fails with "INVALID_ARGUMENT"
    When I read the limit of "seats.max" for organization "acme"
    Then the value is 20

  @spec-1.3.2 @spec-6.3.4
  Scenario: A base plan with variants cannot become a variant
    When I try to make plan "pro" a variant of "business"
    Then the operation fails with "INVALID_ARGUMENT"
    When I read the limit of "seats.max" for organization "acme"
    Then the value is 20

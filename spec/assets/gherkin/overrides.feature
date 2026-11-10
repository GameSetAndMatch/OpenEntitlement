@overrides
Feature: Overrides
  # spec §1.5, §3.1.5-3.1.9: per-subject replacement values bound to a plan family.

  Background:
    Given the standard plans
    And the clock is "2026-06-15T12:00:00Z"
    And organization "acme" is on plan "pro"

  @spec-1.5.2 @spec-3.1.6
  Scenario: An override replaces the plan value
    Given an override "o1" sets "seat_max" to 500 for organization "acme"
    When I resolve "seat_max" for organization "acme"
    Then the value is 500
    And the reason is "OVERRIDE"
    And the override is "o1"
    And the plan value is 20

  @spec-1.5.2
  Scenario: An override may be lower than the plan value (a contractual cap)
    Given an override "o1" sets "seat_max" to 12 for organization "acme"
    When I resolve "seat_max" for organization "acme"
    Then the value is 12
    And the reason is "OVERRIDE"

  @spec-1.5.4 @spec-3.1.9 @spec-6.2.1
  Scenario: An override goes stale, not deleted, when the plan family changes
    Given an override "o1" sets "seat_max" to 500 for organization "acme"
    When organization "acme" moves to plan "business"
    And I resolve "seat_max" for organization "acme"
    Then the value is 100
    And the reason is "PLAN"
    And no override applies
    And the stale overrides are "o1"

  @spec-1.5.4
  Scenario: A stale override applies again when the organization returns to its family
    Given an override "o1" sets "seat_max" to 500 for organization "acme"
    When organization "acme" moves to plan "business"
    And organization "acme" moves to plan "pro"
    And I resolve "seat_max" for organization "acme"
    Then the value is 500
    And the override is "o1"
    And there are no stale overrides

  @spec-1.3.3 @spec-1.5.4
  Scenario: Overrides set during a trial survive conversion to the paid plan
    Given organization "acme" is on plan "pro_trial"
    And an override "o1" sets "project_max" to 8 for organization "acme"
    When organization "acme" moves to plan "pro"
    And I resolve "project_max" for organization "acme"
    Then the value is 8
    And the reason is "OVERRIDE"

  @spec-1.5.3
  Scenario: An override for an organization without a plan needs an explicit family
    Given organization "beta" has no plan
    When I try to create an override "o9" setting "seat_max" to 5 for organization "beta"
    Then the operation fails with "INVALID_ARGUMENT"

  @spec-3.1.9
  Scenario: Overrides are stale while the organization has no plan
    Given an override "o1" sets "seat_max" to 500 for organization "acme"
    When organization "acme" loses its plan
    And I resolve "seat_max" for organization "acme"
    Then the value is 1
    And the reason is "DEFAULT"
    And the stale overrides are "o1"

  @spec-1.5.5
  Scenario: Deleting an override reverts to the plan value
    Given an override "o1" sets "seat_max" to 500 for organization "acme"
    When override "o1" is deleted
    And I resolve "seat_max" for organization "acme"
    Then the value is 20
    And the reason is "PLAN"
    And there are no stale overrides

  @spec-3.1.5
  Scenario Outline: Overrides apply only inside their dates
    Given an override "o1" sets "seat_max" to 500 for organization "acme" from "2026-06-01T00:00:00Z" until "2026-07-01T00:00:00Z"
    And the clock is "<now>"
    When I resolve "seat_max" for organization "acme"
    Then the value is <value>

    Examples:
      | now                  | value |
      | 2026-05-31T23:59:59Z | 20    |
      | 2026-06-01T00:00:00Z | 500   |
      | 2026-06-30T23:59:59Z | 500   |
      | 2026-07-01T00:00:00Z | 20    |

  @spec-2.1.3
  Scenario: The context can evaluate at another instant
    Given an override "o1" sets "seat_max" to 500 for organization "acme" from "2026-09-01T00:00:00Z"
    When I resolve "seat_max" for organization "acme" at "2026-09-02T00:00:00Z"
    Then the value is 500

  @spec-3.1.6
  Scenario Outline: The most specific override wins
    Given an override "org" sets "seat_max" to 100 for organization "acme"
    And an override "sub" sets "seat_max" to 200 for subject "u1" of organization "acme"
    And an override "res" sets "seat_max" to 300 for resource "r1" of organization "acme"
    And an override "both" sets "seat_max" to 400 for subject "u1" and resource "r1" of organization "acme"
    When I resolve "seat_max" for <scope>
    Then the value is <value>
    And the override is "<override>"

    Examples:
      | scope                                                | value | override |
      | organization "acme"                                  | 100   | org      |
      | subject "u2" of organization "acme"                  | 100   | org      |
      | subject "u1" of organization "acme"                  | 200   | sub      |
      | resource "r1" of organization "acme"                 | 300   | res      |
      | subject "u2" and resource "r1" of organization "acme" | 300   | res      |
      | subject "u1" and resource "r1" of organization "acme" | 400   | both     |

  @spec-2.1.4
  Scenario: Overrides never leak across organizations
    Given organization "globex" is on plan "pro"
    And an override "o1" sets "seat_max" to 500 for subject "u1" of organization "acme"
    When I resolve "seat_max" for subject "u1" of organization "globex"
    Then the value is 20
    And the reason is "PLAN"

  @spec-1.5.7
  Scenario: Overlapping overrides for the same scope are rejected
    Given an override "o1" sets "seat_max" to 500 for organization "acme" from "2026-06-01T00:00:00Z" until "2026-08-01T00:00:00Z"
    When I try to create an override "o2" setting "seat_max" to 600 for organization "acme" from "2026-07-01T00:00:00Z"
    Then the operation fails with "CONFLICT"

  @spec-1.5.7
  Scenario: Back-to-back overrides do not overlap
    Given an override "o1" sets "seat_max" to 500 for organization "acme" from "2026-06-01T00:00:00Z" until "2026-07-01T00:00:00Z"
    When I try to create an override "o2" setting "seat_max" to 600 for organization "acme" from "2026-07-01T00:00:00Z"
    Then the operation succeeds

  @spec-1.5.6
  Scenario: Override values are validated
    When I try to create an override "o1" setting "project_max" to unlimited for organization "acme"
    Then the operation fails with "INVALID_VALUE"

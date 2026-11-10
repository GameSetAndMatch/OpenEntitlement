Feature: Limit checks
  # spec §3.3, §4.2.4, §8.1.1: requireWithin and the downgrade rule.

  Background:
    Given the standard plans
    And the clock is "2026-06-15T12:00:00Z"
    And organization "acme" is on plan "pro"

  @spec-3.3.3 @spec-4.2.4
  Scenario Outline: requireWithin passes up to the limit and fails beyond it
    When I require <requested> more "project_max" with current <current> for organization "acme"
    Then the check <outcome>

    Examples:
      | current | requested | outcome |
      | 0       | 5         | passes  |
      | 4       | 1         | passes  |
      | 5       | 1         | fails   |
      | 3       | 3         | fails   |

  @spec-8.1.1
  Scenario: A failed check reports what a UI needs
    When I require 1 more "project_max" with current 5 for organization "acme"
    Then the check fails
    And the denial code is "entitlement_limit_exceeded"
    And the denial reports limit 5, current 5 and requested 1

  @plan-catalog @spec-3.4.1 @spec-3.4.3
  Scenario Outline: A failed check names the lowest plan that would allow it
    When I require <requested> more "project_max" with current <current> for organization "acme"
    Then the check fails
    And the required plan is "<plan>"

    Examples:
      | current | requested | plan     |
      | 5       | 1         | business |
      | 49      | 1         | business |

  @plan-catalog @spec-3.4.2
  Scenario: No required plan when no public plan is big enough
    When I require 1 more "project_max" with current 50 for organization "acme"
    Then the check fails
    And there is no required plan

  @spec-3.3.1
  Scenario Outline: Over the limit, decrements and no-ops always pass (the downgrade rule)
    Given organization "acme" is on plan "free"
    When I require <requested> more "project_max" with current 40 for organization "acme"
    Then the check passes

    Examples:
      | requested |
      | 0         |
      | -1        |
      | -39       |

  @spec-3.3.1
  Scenario: Over the limit, any increment fails
    Given organization "acme" is on plan "free"
    When I require 1 more "project_max" with current 40 for organization "acme"
    Then the check fails

  @spec-3.3.5
  Scenario: requireWithin on a boolean privilege is a type mismatch
    When I require 1 more "sso_enabled" with current 0 for organization "acme"
    Then the operation fails with "TYPE_MISMATCH"

  @spec-3.3.2
  Scenario: Negative usage is an invalid argument
    When I require 1 more "project_max" with current -1 for organization "acme"
    Then the operation fails with "INVALID_ARGUMENT"

  @spec-3.3.6 @spec-3.1.2
  Scenario: Unknown privileges fail closed
    When I require 1 more "does_not_exist" with current 0 for organization "acme"
    Then the check fails

  @spec-1.8.2
  Scenario: Seats count purchased quantity
    Given organization "acme" is on plan "free"
    When I require 1 more "seat_max" with current 3 for organization "acme"
    Then the check fails

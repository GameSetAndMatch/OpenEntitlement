@grants
Feature: Grants
  # spec §1.6, §3.1.7: additive, dated quota independent of the plan.

  Background:
    Given the standard plans
    And the clock is "2026-06-15T12:00:00Z"
    And organization "acme" is on plan "pro"

  @spec-3.1.7
  Scenario: A grant stacks on the plan value
    Given a grant "g1" adds 500 "api_calls_monthly" for organization "acme"
    When I resolve "api_calls_monthly" for organization "acme"
    Then the value is 100500
    And the reason is "GRANT"
    And the plan value is 100000
    And the grants are "g1"

  @overrides @spec-3.1.7
  Scenario: A grant stacks on an override
    Given an override "o1" sets "seat_max" to 40 for organization "acme"
    And a grant "g1" adds 5 "seat_max" for organization "acme"
    When I resolve "seat_max" for organization "acme"
    Then the value is 45
    And the reason is "GRANT"
    And the override is "o1"
    And the plan value is 20

  @spec-3.1.7
  Scenario: A grant stacks on the default when there is no plan
    Given organization "beta" has no plan
    And a grant "g1" adds 2 "project_max" for organization "beta"
    When I resolve "project_max" for organization "beta"
    Then the value is 2
    And the reason is "GRANT"

  @spec-3.1.7
  Scenario: Several grants add up
    Given a grant "g1" adds 500 "api_calls_monthly" for organization "acme"
    And a grant "g2" adds 250 "api_calls_monthly" for organization "acme"
    When I resolve "api_calls_monthly" for organization "acme"
    Then the value is 100750
    And the grants are "g1, g2"

  @spec-3.1.7
  Scenario Outline: Grants apply only inside their dates
    Given a grant "g1" adds 500 "api_calls_monthly" for organization "acme" from "2026-06-10T00:00:00Z" until "2026-06-20T00:00:00Z"
    And the clock is "<now>"
    When I resolve "api_calls_monthly" for organization "acme"
    Then the value is <value>

    Examples:
      | now                  | value  |
      | 2026-06-09T00:00:00Z | 100000 |
      | 2026-06-10T00:00:00Z | 100500 |
      | 2026-06-20T00:00:00Z | 100000 |

  @spec-3.1.7
  Scenario: A subject's grant applies only to that subject
    Given a grant "g1" adds 100 "api_calls_monthly" for subject "alice" of organization "acme"
    When I resolve "api_calls_monthly" for subject "alice" of organization "acme"
    Then the value is 100100
    And the grants are "g1"

  @spec-3.1.7
  Scenario: Other subjects and the organization do not see a subject's grant
    Given a grant "g1" adds 100 "api_calls_monthly" for subject "alice" of organization "acme"
    When I resolve "api_calls_monthly" for subject "bob" of organization "acme"
    Then the value is 100000
    And no grants apply

  @spec-1.6.3
  Scenario: Grants survive plan changes
    Given a grant "g1" adds 7 "seat_max" for organization "acme"
    When organization "acme" moves to plan "business"
    And I resolve "seat_max" for organization "acme"
    Then the value is 107
    And the reason is "GRANT"

  @spec-1.6.4
  Scenario: A revoked grant stops applying
    Given a grant "g1" adds 500 "api_calls_monthly" for organization "acme"
    When grant "g1" is revoked
    And I resolve "api_calls_monthly" for organization "acme"
    Then the value is 100000
    And the reason is "PLAN"
    And no grants apply

  @spec-1.6.2
  Scenario Outline: Grants are only for integer privileges with positive amounts
    When I try to grant <amount> "<privilege>" to organization "acme"
    Then the operation fails with "INVALID_VALUE"

    Examples:
      | privilege         | amount |
      | sso_enabled       | 1      |
      | report_retention | 1      |
      | seat_max         | 0      |
      | seat_max         | -3     |

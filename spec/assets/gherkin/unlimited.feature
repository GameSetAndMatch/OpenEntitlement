Feature: Unlimited
  # spec §1.2: UNLIMITED is a distinct value, never an integer or null.

  Background:
    Given the standard plans
    And the clock is "2026-06-15T12:00:00Z"

  @spec-1.2.1 @spec-1.2.3 @spec-4.3.3
  Scenario: Unlimited resolves as a distinct value and encodes as an object
    Given organization "acme" is on plan "business"
    When I resolve "api_calls_monthly" for organization "acme"
    Then the value is unlimited
    And the reason is "PLAN"
    And the details encode the value as {"unlimited": true}

  @spec-1.2.4 @spec-3.3.3
  Scenario: Every finite request fits within unlimited
    Given organization "acme" is on plan "business"
    When I require 1000000000 more "api_calls_monthly" with current 999999999999 for organization "acme"
    Then the check passes

  @grants @spec-1.2.4 @spec-3.1.7
  Scenario: Grants on top of unlimited stay unlimited and keep the base reason
    Given organization "acme" is on plan "business"
    And a grant "g1" adds 500 "api_calls_monthly" for organization "acme"
    When I resolve "api_calls_monthly" for organization "acme"
    Then the value is unlimited
    And the reason is "PLAN"
    And the grants are "g1"

  @mutations @spec-1.2.5
  Scenario: Unlimited is rejected where the privilege does not allow it
    When "pricing-team" sets plan "pro" "project_max" to unlimited because "try it"
    Then the operation fails with "INVALID_VALUE"

  @mutations @spec-1.5.6
  Scenario Outline: Plan values are validated against the privilege type
    When "pricing-team" sets plan "pro" "<privilege>" to <value> because "typo"
    Then the operation fails with "INVALID_VALUE"

    Examples:
      | privilege         | value  |
      | seat_max         | -1     |
      | seat_max         | true   |
      | sso_enabled       | 1      |
      | report_retention | "30d"  |

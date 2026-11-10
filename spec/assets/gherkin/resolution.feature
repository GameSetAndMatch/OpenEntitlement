Feature: Resolution
  # spec §3.1: plan values, defaults, errors, and channel independence.

  Background:
    Given the standard plans
    And the clock is "2026-06-15T12:00:00Z"

  @spec-3.1.4 @spec-3.1.8 @spec-4.2.7 @spec-4.3.1 @spec-4.4.1
  Scenario: The plan value applies
    Given organization "acme" is on plan "pro"
    When I resolve "seat_max" for organization "acme"
    Then the value is 20
    And the reason is "PLAN"
    And the plan value is 20
    And no override applies
    And no grants apply
    And there are no stale overrides

  @spec-3.1.3 @spec-3.1.8
  Scenario: An organization without a plan gets the privilege default
    Given organization "acme" has no plan
    When I resolve "seat_max" for organization "acme"
    Then the value is 1
    And the reason is "DEFAULT"
    And there is no plan value

  @spec-3.1.3
  Scenario: A plan that sets no value falls back to the privilege default
    Given organization "acme" is on plan "legacy"
    When I resolve "sso_connection_max" for organization "acme"
    Then the value is 0
    And the reason is "DEFAULT"
    And there is no plan value

  @spec-3.1.2
  Scenario: Unknown privileges resolve to an error, never throw
    Given organization "acme" is on plan "pro"
    When I read the limit of "does_not_exist" for organization "acme"
    Then the reason is "ERROR"
    And the error code is "PRIVILEGE_NOT_FOUND"
    And the value is 0

  @spec-2.1.1
  Scenario: A context without an organization is invalid
    When I resolve "seat_max" for organization ""
    Then the reason is "ERROR"
    And the error code is "INVALID_CONTEXT"
    And the value is 1

  @spec-1.4.2
  Scenario Outline: The payment channel never changes resolution
    Given organization "acme" is on plan "business" paid by "<channel>"
    When I resolve "seat_max" for organization "acme"
    Then the value is 100
    And the reason is "PLAN"

    Examples:
      | channel     |
      | card        |
      | contract    |
      | marketplace |

  @spec-1.3.3
  Scenario: A trial resolves to its own values, like any plan
    Given organization "acme" is on plan "pro_trial"
    When I resolve "project_max" for organization "acme"
    Then the value is 5
    And the reason is "PLAN"

  @spec-1.1.3 @spec-4.2.5
  Scenario: Enum privileges resolve to one of their options
    Given organization "acme" is on plan "business"
    When I read the option of "report_retention" for organization "acme"
    Then the value is "365d"
    And the reason is "PLAN"

  @spec-4.2.5
  Scenario: Reading an option from a non-enum privilege is a type mismatch
    Given organization "acme" is on plan "business"
    When I read the option of "seat_max" for organization "acme"
    Then the reason is "ERROR"
    And the error code is "TYPE_MISMATCH"
    And the value is ""

  @spec-4.2.7
  Scenario: The generic resolve reports unknown privileges without a value
    When I resolve "does_not_exist" for organization "acme"
    Then the reason is "ERROR"
    And the error code is "PRIVILEGE_NOT_FOUND"
    And there is no value

  @spec-4.2.3
  Scenario: Reading a limit from a non-integer privilege is a type mismatch
    Given organization "acme" is on plan "business"
    When I read the limit of "sso_enabled" for organization "acme"
    Then the reason is "ERROR"
    And the error code is "TYPE_MISMATCH"
    And the value is 0

  @mutations @spec-1.3.5
  Scenario: Plan values are data and change at runtime
    Given organization "acme" is on plan "pro"
    When "pricing-team" sets plan "pro" "seat_max" to 25 because "Q3 repackaging"
    And I resolve "seat_max" for organization "acme"
    Then the value is 25
    And the reason is "PLAN"

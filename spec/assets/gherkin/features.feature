Feature: Feature enablement
  # spec §3.2, §4.2.1, §4.2.2: isEnabled evaluates the feature's gate.

  Background:
    Given the standard plans
    And the clock is "2026-06-15T12:00:00Z"

  @spec-1.1.6 @spec-3.2.1 @spec-4.2.1
  Scenario Outline: A boolean gate decides whether the feature is enabled
    Given organization "acme" is on plan "<plan>"
    When I check feature "sso" for organization "acme"
    Then the value is <enabled>
    And the reason is "PLAN"

    Examples:
      | plan     | enabled |
      | pro      | false   |
      | business | true    |

  @spec-1.1.6 @spec-3.2.1 @spec-4.2.1
  Scenario Outline: An integer gate is enabled when its value is above zero or unlimited
    Given organization "acme" is on plan "<plan>"
    When I check feature "api" for organization "acme"
    Then the value is <enabled>

    Examples:
      | plan     | enabled |
      | free     | true    |
      | business | true    |

  @spec-3.2.1
  Scenario: An integer gate at zero is disabled
    Given organization "acme" has no plan
    When I check feature "projects" for organization "acme"
    Then the value is false
    And the reason is "DEFAULT"

  @spec-3.2.2
  Scenario: Unknown features are disabled with an error
    Given organization "acme" is on plan "business"
    When I check feature "teleportation" for organization "acme"
    Then the value is false
    And the reason is "ERROR"
    And the error code is "FEATURE_NOT_FOUND"

  @plan-catalog @spec-3.4.1 @spec-3.4.2
  Scenario: A locked feature names the plan that unlocks it
    Given organization "acme" is on plan "pro"
    When I check feature "sso" for organization "acme"
    Then the value is false
    And the required plan is "business"

  @plan-catalog @spec-3.4.2
  Scenario: Non-public plans and variants are never suggested
    Given organization "acme" is on plan "business"
    When I require 101 more "seats.max" with current 0 for organization "acme"
    Then the check fails
    And there is no required plan

  @spec-4.2.2 @spec-8.1.2
  Scenario: requireEnabled throws FeatureNotEntitled
    Given organization "acme" is on plan "free"
    When I require feature "reports" for organization "acme"
    Then the check fails
    And the denial code is "feature_not_entitled"

  @spec-4.2.2
  Scenario: requireEnabled passes for an enabled feature
    Given organization "acme" is on plan "pro"
    When I require feature "reports" for organization "acme"
    Then the check passes

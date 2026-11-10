@fixed
Feature: Fixed provider
  # spec §6.4: self-hosted installs, where everything is on and nothing can be overridden.

  Background:
    Given a fixed provider configured with {"project_max": 10000, "sso_connection_max": 100}

  @spec-6.4.1 @spec-3.1.1
  Scenario Outline: Everything is on
    When I resolve "<privilege>" for organization "anyone"
    Then the value is <value>
    And the reason is "FIXED"
    And no grants apply

    Examples:
      | privilege         | value     |
      | sso_enabled       | true      |
      | seat_max         | unlimited |
      | project_max      | 10000     |
      | report_retention | "365d"    |

  @spec-6.4.3 @spec-6.3.6
  Scenario: Nothing can be overridden
    When I try to create an override "o1" setting "seat_max" to 5 for organization "anyone"
    Then the operation fails with "NOT_SUPPORTED"

  @spec-6.4.2
  Scenario: A finite-only privilege needs a configured value
    When I create a fixed provider configured with {"sso_connection_max": 100}
    Then the operation fails with "INVALID_ARGUMENT"

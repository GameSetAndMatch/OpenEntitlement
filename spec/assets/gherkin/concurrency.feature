Feature: Serialized check-then-act
  # spec §5.2: guard is linearizable per (organization, privilege).

  Background:
    Given the standard plans
    And the clock is "2026-06-15T12:00:00Z"
    And organization "acme" is on plan "pro"

  @spec-5.2.1 @spec-5.2.2
  Scenario: Concurrent guarded creations never exceed the limit
    When 20 concurrent guarded requests each add 1 "project_max" for organization "acme"
    Then exactly 5 succeed
    And the usage counter is 5

  @spec-5.2.1
  Scenario: A failed guard does not act
    When 1 concurrent guarded requests each add 6 "project_max" for organization "acme"
    Then exactly 0 succeed
    And the usage counter is 0

  @spec-5.3.3
  Scenario: Guard reports its lock domain
    When 1 concurrent guarded requests each add 1 "project_max" for organization "acme"
    Then exactly 1 succeed
    And the lock domain is reported

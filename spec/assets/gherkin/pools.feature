@grants
Feature: Shared pools and personal allowances
  # spec §3.3.3, §3.3.4: organization pool plus subject-scoped grants, drawn subject-first.

  Background:
    Given the standard plans
    And the clock is "2026-06-15T12:00:00Z"
    And organization "acme" is on plan "free"
    And a grant "alice-pack" adds 100 "api_calls.monthly" for subject "alice" of organization "acme"

  @spec-3.3.4
  Scenario: Pool usage follows the draw order
    When I compute the pool usage of {"alice": 150, "bob": 300} with allowances {"alice": 100}
    Then the pool usage is 350

  @spec-3.3.4
  Scenario: Unattributed usage goes straight to the pool
    When I compute the pool usage of {"alice": 50} with allowances {"alice": 100} and 25 unattributed
    Then the pool usage is 25

  @spec-3.3.3
  Scenario: The subject draws from its own allowance first
    When I require 100 more "api_calls.monthly" with pool usage 1000 and subject usage 0 for subject "alice" of organization "acme"
    Then the check passes

  @spec-3.3.3
  Scenario: Once the allowance is used up, the subject draws from the pool
    When I require 1 more "api_calls.monthly" with pool usage 1000 and subject usage 100 for subject "alice" of organization "acme"
    Then the check fails

  @spec-3.3.3
  Scenario: Allowance and pool add up
    When I require 650 more "api_calls.monthly" with pool usage 350 and subject usage 100 for subject "alice" of organization "acme"
    Then the check passes

  @spec-3.3.3
  Scenario: A subject without an allowance only sees the pool
    When I require 651 more "api_calls.monthly" with pool usage 350 and subject usage 0 for subject "bob" of organization "acme"
    Then the check fails

  @spec-3.3.3
  Scenario: An overdrawn pool does not block a remaining allowance
    When I require 40 more "api_calls.monthly" with pool usage 5000 and subject usage 60 for subject "alice" of organization "acme"
    Then the check passes

  @spec-3.3.3
  Scenario: An organization-wide grant joins the pool for everyone
    Given a grant "org-pack" adds 500 "api_calls.monthly" for organization "acme"
    When I require 500 more "api_calls.monthly" with current 1000 for subject "bob" of organization "acme"
    Then the check passes

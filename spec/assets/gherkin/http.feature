Feature: HTTP mapping of denials
  # spec §8.2: one 403 shape, distinguishable from RBAC, with what a UI needs to upsell.

  Background:
    Given the standard plans
    And the clock is "2026-06-15T12:00:00Z"
    And organization "acme" is on plan "pro"

  @spec-8.2.1
  Scenario: A limit denial maps to a 403 problem
    When I require 1 more "projects.max" with current 5 for organization "acme"
    Then the HTTP status is 403
    And the HTTP problem includes {"error": "entitlement_required", "code": "entitlement_limit_exceeded", "feature": "projects", "privilege": "projects.max", "limit": 5, "current": 5, "requested": 1}

  @plan-catalog @spec-8.2.1
  Scenario: The problem carries the required plan
    When I require 1 more "projects.max" with current 5 for organization "acme"
    Then the HTTP problem includes {"requiredPlan": "business"}

  @spec-8.2.1
  Scenario: A feature denial omits limit fields
    Given organization "acme" is on plan "free"
    When I require feature "reports" for organization "acme"
    Then the HTTP status is 403
    And the HTTP problem includes {"error": "entitlement_required", "code": "feature_not_entitled", "feature": "reports", "privilege": "reports.enabled"}
    And the HTTP problem has no "limit"

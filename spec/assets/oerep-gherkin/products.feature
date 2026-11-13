Feature: Product-bound OEREP 0.1 transport
  Scenario Outline: Credentials are checked before Product and Privilege
    Given two Products with the same Privilege key
    When a provider requests "<action>" using "<binding>"
    Then the transport status is <status>
    Examples:
      | action  | binding         | status |
      | resolve | missing-key     | 401    |
      | bulk    | missing-key     | 401    |
      | upgrade | missing-key     | 401    |
      | resolve | wrong-product   | 403    |
      | bulk    | wrong-product   | 403    |
      | upgrade | wrong-product   | 403    |
      | resolve | missing-product | 403    |
      | bulk    | missing-product | 403    |
      | upgrade | missing-product | 403    |
      | resolve | missing-keyname | 404    |
      | upgrade | missing-keyname | 404    |

  Scenario: Providers isolate Product decisions and caches
    Given two Products with the same Privilege key
    When both providers resolve their Product twice with a cache
    Then their values stay 5 and 99

  Scenario: No assignment retains Product Grants
    Given two Products with the same Privilege key
    When a provider resolves an unassigned Organization with a retained Grant
    Then its value is 3 with reason GRANT

  Scenario: Upgrade candidates belong to the Product and are not archived
    Given two Products with the same Privilege key
    When a provider asks for upgrades before and after archiving Pro
    Then the upgrades are pro and null

  Scenario: Bulk resolves the authorized Product Catalog
    Given two Products with the same Privilege key
    When a provider resolves the Product in bulk
    Then its seats value is 5

"""OpenEntitlement reference service (ADR-0009).

Three layers, dependencies pointing inward:

- ``interfaces``: the HTTP API (FastAPI). No business rules, no database access.
- ``services``: the service layer. Operations, rules, typed problems and the repository
  protocols it needs. Imports neither FastAPI, FastMCP nor SQLAlchemy (checked by import-linter).
- ``repositories``: implementations of those protocols, in memory and on Postgres.
"""

# Component availability (implementation in progress)

Deployment configuration may remove access, independently of commercial tiers. For example, Business includes MCP, but a self-hosted installation without its MCP pod must still deny MCP access. Conversely, installing the pod must not unlock Business features for Basic customers.

The operator explicitly maps feature IDs to boolean environment variables:

```yaml
services:
  openentitlement:
    environment:
      OE_FEATURE_ENV_GATES: '{"mcp":"MCP_INSTALLED"}'
      MCP_INSTALLED: 'false'
```

Bindings are controlled by the server process, never a workspace member. Only mapped boolean variables are exposed as availability diagnostics; unrelated process environment is not sent to clients. Values are loaded at startup, so restart the service after changing them. Unset mapped variables deny availability; invalid non-boolean values stop startup.

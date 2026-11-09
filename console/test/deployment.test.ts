import assert from 'node:assert/strict';
import {test} from 'node:test';
import {deploymentFromEnv} from '../server/deployment.ts';
test('operator gates are boolean, explicit and fail closed when unset',()=>{
  const config={OE_FEATURE_ENV_GATES:'{"mcp":"MCP_INSTALLED"}'};
  assert.equal(deploymentFromEnv({...config,MCP_INSTALLED:'False'}).mcp!.available,false);
  assert.equal(deploymentFromEnv({...config,MCP_INSTALLED:'true'}).mcp!.available,true);
  assert.equal(deploymentFromEnv(config).mcp!.available,false);
  assert.throws(()=>deploymentFromEnv({...config,MCP_INSTALLED:'probably'}),/must be true/);
  assert.throws(()=>deploymentFromEnv({OE_FEATURE_ENV_GATES:'[]'}),/must be an object/);
});

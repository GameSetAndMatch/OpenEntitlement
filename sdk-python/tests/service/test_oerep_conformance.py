"""Shared RFC-0005 Gherkin cases, through both RemoteProviders against the Python HTTP service.

The local HTTP listener forwards to ASGI on the test event loop, so both SDKs exercise their real
HTTP stacks and Postgres (when configured) stays on its owning event loop.
"""
import asyncio
import json
import shutil
import subprocess
import sys
from contextlib import asynccontextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from uuid import UUID

import pytest
from openentitlement import Catalog, RemoteProvider
from openentitlement.details import EvaluationContext
from openentitlement.remote import OerepProblem
from openentitlement_service.services.organizations import ApplicationUserRecord
from test_http_oerep import _assign, _key
from test_http_organizations import _offer
from test_http_tiers import _client

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'sdk-python/conformance'))
from gherkin import parse  # noqa: E402

SCENARIOS = parse(ROOT / 'spec/assets/oerep-gherkin/products.feature')
pytestmark = pytest.mark.anyio


@asynccontextmanager
async def listener(client):
    loop = asyncio.get_running_loop()

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            body = self.rfile.read(int(self.headers['Content-Length']))
            response = asyncio.run_coroutine_threadsafe(
                client.post(self.path, content=body, headers=dict(self.headers)), loop
            ).result(timeout=15)
            self.send_response(response.status_code)
            self.send_header('Content-Type', response.headers['content-type'])
            self.end_headers()
            self.wfile.write(response.content)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f'http://127.0.0.1:{server.server_port}'
    finally:
        await asyncio.to_thread(server.shutdown)
        server.server_close()
        thread.join()


async def invoke(sdk, url, product, token, action='resolve', key='seats', organization='acme', subject=None, cache=False):
    def run():
        if sdk == 'typescript':
            proc = subprocess.run(
                ['node', '--conditions=source', 'test/oerep-driver.ts'], cwd=ROOT / 'sdk-js',
                input=json.dumps(dict(url=url, product=product, token=token, action=action, key=key,
                                     organization=organization, subject=subject, cache=cache)),
                text=True, capture_output=True, timeout=20,
            )
            assert proc.returncode == 0, proc.stderr
            return json.loads(proc.stdout)
        catalog = Catalog.from_dict({'features': [{'code': 'test', 'name': 'Test', 'privileges': [
            {'key': key, 'valueType': 'integer', 'default': 0}
        ]}]})
        p = catalog.privilege(key)
        provider = RemoteProvider(url, product=product, token=token, cache_ttl=10 if cache else None)
        ctx = EvaluationContext(organization_id=organization, subject_id=subject)
        try:
            if action == 'upgrade':
                result = provider.suggest_plan(p, 50, ctx)
            elif action == 'bulk':
                result = [d.to_dict() for d in provider.resolve_all([p], ctx).values()]
            else:
                result = provider.resolve(p, ctx).to_dict()
                if cache:
                    result = provider.resolve(p, ctx).to_dict()
            return {'status': 200, 'result': result}
        except OerepProblem as error:
            return {'status': error.status, 'type': error.type}
    return await asyncio.to_thread(run)


@pytest.mark.parametrize('sdk', ['python', 'typescript'])
@pytest.mark.parametrize('scenario', SCENARIOS, ids=lambda s: s.name)
async def test_product_transport(store, sdk, scenario):
    if sdk == 'typescript' and (not shutil.which('node') or not (ROOT / 'sdk-js/node_modules').exists()):
        pytest.skip('requires Node and npm ci in sdk-js')
    async with _client(store) as (client, product):
        await _offer(client, product)
        await _assign(client, product, 'acme', 'basic_standard')
        workspace = product.split('/products/')[0]
        other = (await client.post(workspace + '/products', json={'key': 'storage', 'name': 'Storage'})).json()
        storage = workspace + '/products/' + other['id']
        await _offer(client, storage)
        await _assign(client, storage, 'globex', 'pro_standard')
        # Different value for the same key in the other Product.
        variants = (await client.get(storage + '/tiers')).json()['variants']
        standard = next(v for v in variants if v['id'] == 'basic_standard')
        assert (await client.put(storage + '/tiers/basic/variants/basic_standard', json={
            'name': standard['name'], 'kind': 'standard', 'values': {'seats': 99}, 'version': standard['version']
        })).status_code == 200
        # Acme already exists Workspace-wide: add its Storage assignment.
        assert (await client.put(workspace + '/organizations/acme/products/' + other['id'], json={
            'variantId': 'basic_standard', 'version': 0, 'reason': 'Storage contract'
        })).status_code == 200
        product_key = (await client.get(product)).json()['key']
        token = (await _key(client, product))['secret']
        storage_token = (await _key(client, storage))['secret']
        async with listener(client) as url:
            when = next(s.text for s in scenario.steps if s.keyword == 'When')
            if when.startswith('a provider requests'):
                import re
                action, binding = re.findall(r'"([^"]+)"', when)
                requested = 'storage' if binding == 'wrong-product' else 'missing' if binding == 'missing-product' else product_key
                result = await invoke(sdk, url, requested, 'invalid' if binding == 'missing-key' else token,
                                      action, key='unknown' if binding == 'missing-keyname' else 'seats')
                status = int(scenario.steps[-1].text.rsplit(' ', 1)[-1])
                assert result['status'] == status
                assert result['type'].endswith({401: '/api-key-invalid', 403: '/product-forbidden', 404: '/not-found'}[status])
            elif when.startswith('both providers'):
                results = [await invoke(sdk, url, p, t, cache=True) for p, t in [(product_key, token), ('storage', storage_token)]]
                assert [r['result']['value'] for r in results] == [5, 99]
            elif 'retained Grant' in when:
                # A retained fact without an assignment is a valid evaluation case in RFC-0005.
                async with store.transaction(UUID(workspace.rsplit('/', 1)[-1])) as repos:
                    await repos.organizations.save_user(ApplicationUserRecord(
                        workspace_id=UUID(workspace.rsplit('/', 1)[-1]), product_id=UUID(product.rsplit('/', 1)[-1]),
                        organization_id='globex', subject_id='alice', name='Alice', variant_id='basic_standard',
                        terms={}, grants={'seats': 3}, version=1,
                    ), expected_version=0)
                result = await invoke(sdk, url, product_key, token, organization='globex', subject='alice')
                assert (result['result']['value'], result['result']['reason']) == (3, 'GRANT')
            elif when == 'a provider resolves the Product in bulk':
                result = await invoke(sdk, url, product_key, token, 'bulk')
                assert result['status'] == 200 and result['result'][0]['value'] == 5
            elif when == 'a provider asks for upgrades before and after archiving Pro':
                assert (await invoke(sdk, url, product_key, token, 'upgrade'))['result'] == 'pro'
                assert (await client.post(product + '/tiers/pro/archive', json={'version': 1})).status_code == 200
                assert (await invoke(sdk, url, product_key, token, 'upgrade'))['result'] is None
            else:
                raise AssertionError(f'unsupported shared step: {when}')

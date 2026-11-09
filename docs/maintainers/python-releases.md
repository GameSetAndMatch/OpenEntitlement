# Publishing the Python SDK

The `Python distributions` workflow builds and checks the core SDK and its PostgreSQL and Stripe adapters. Pull requests and main-branch pushes validate packages without publishing. A published GitHub release tagged `python-v<version>` publishes through PyPI Trusted Publishing. JavaScript releases use a different tag namespace.

## One-time setup

In [PyPI account publishing](https://pypi.org/manage/account/publishing/), add a pending GitHub publisher for **each** new project:

| PyPI project name | GitHub owner | Repository | Workflow filename | Environment |
|---|---|---|---|---|
| `openentitlement-sdk` | `GameSetAndMatch` | `openentitlement-sdk` | `publish-python.yml` | `pypi` |
| `openentitlement-postgres` | `GameSetAndMatch` | `openentitlement-sdk` | `publish-python.yml` | `pypi-postgres` |
| `openentitlement-stripe` | `GameSetAndMatch` | `openentitlement-sdk` | `publish-python.yml` | `pypi-stripe` |

For a project already owned by your account, configure its publisher in that project's settings instead. Pending publishers do not reserve names. Verify availability before the first release. No PyPI password or API token belongs in repository secrets.

PyPI rejects reusing the same pending publisher identity for multiple new project names. Separate environments distinguish the three publishers while keeping the repository and workflow fixed.

Create GitHub environments named `pypi`, `pypi-postgres`, and `pypi-stripe` under repository Settings → Environments. Restrict deployments to the `python-v*` **tag** pattern and configure required reviewers if appropriate for the repository. Each environment name must match its PyPI publisher exactly.

Official references: [creating a project through Trusted Publishing](https://docs.pypi.org/trusted-publishers/creating-a-project-through-oidc/), [publishing with a trusted publisher](https://docs.pypi.org/trusted-publishers/using-a-publisher/).

## Release

1. Update all three package versions in `sdk-python/packages/*/pyproject.toml`, the adapters' exact core dependency, and the core `__version__`. Refresh `sdk-python/uv.lock`, document changes, and merge after CI passes.
2. Publish a GitHub release from the tested main-branch commit with the matching tag, for example `python-v0.1.1`. Merely pushing a tag or saving a draft release does not publish packages.
3. Review the workflow's built artifacts and approve the `pypi` environment deployment if required. The workflow rejects a version/tag mismatch and release commits outside main's history.
4. Confirm all three projects and versions on PyPI. Test installation into a clean environment, for example `pip install openentitlement-sdk==0.1.1`.

The workflow builds wheels and source distributions, checks metadata with Twine, then imports installed wheels outside the source checkout on Python 3.10. It checks a real limit evaluation, the typing marker and bundled PostgreSQL schema. The existing CI remains responsible for the full SDK and conformance suite; release only a commit that has passed it.

Publishing is not atomic across projects. If one matrix job fails, fix its publisher configuration and rerun **failed jobs only**; do not rebuild and overwrite an existing version. PyPI files are immutable. For a defective published artifact, bump the version and release again. Do not delete and reuse a version.

## Troubleshooting publication

A successful main-branch build does not publish. Confirm a published `python-v<version>` release and the publish jobs themselves. If PyPI reports `invalid-publisher`, compare the exact case-sensitive repository name (`GameSetAndMatch/OpenEntitlement`), workflow filename and environment against the pending publisher. Recreate entries after a repository rename; GitHub URL redirects do not change an OIDC claim. The core distribution is `openentitlement-sdk`, but its import remains `openentitlement`. PostgreSQL and Stripe packages are optional adapters, not Tier variants.

The failed `python-v0.1.0` release used the previous distribution name; do not rerun it after changing the pending publisher. Merge this naming change and publish `python-v0.1.1` from the tested main commit.

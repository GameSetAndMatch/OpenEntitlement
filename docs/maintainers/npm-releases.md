# TypeScript quality checks and npm releases

The TypeScript SDK libraries publish to npm as `@openentitlement/core`, `@openentitlement/postgres`, and `@openentitlement/stripe`. The running service/administration app is private in npm metadata and is distributed as a Docker image, not a public npm app package.

## Developer checks

From the repository root, install both Node workspaces, then the shared Git hooks:

```sh
npm ci --prefix sdk-js
npm ci --prefix console
uv sync --project sdk-python --locked
uv run --project sdk-python pre-commit install
node sdk-js/scripts/check-quality.mjs
```

The shared Commitizen hook checks new commit messages. The TypeScript hook runs ESLint, strict TypeScript checks, and Knip dependency checks for the SDK and console. ESLint allows explicit `any` for the SDK's generic provider/transaction interfaces; the compiler remains strict. Tests run in CI and can be run locally with `npm test --prefix sdk-js` and `npm test --prefix console`. PostgreSQL tests need `OE_PG_DSN` as described in the SDK guide. No code is automatically formatted or committed by these checks.

## One-time npm setup

Create an npm account and obtain publishing rights to the `@openentitlement` scope (normally an npm organization named `openentitlement`). The GitHub organization does not automatically grant the npm scope. If the scope is unavailable, choose a different scope and update all package names/dependencies/imports before release.

npm Trusted Publishing is configured in each existing package's settings. For packages that do not yet exist, an authorized maintainer must first bootstrap each package from the tested packed artifact using their own npm login/2FA, or an explicitly configured supported npm onboarding process. Do not assume PyPI's pending-publisher setup applies to npm. Never upload empty placeholder packages or store a maintainer's password in GitHub.

For all three packages, configure GitHub Actions as the Trusted Publisher:

| Field | Value |
|---|---|
| GitHub owner | `GameSetAndMatch` |
| Repository | `openentitlement` |
| Workflow filename | `publish-npm.yml` |
| Environment | `npm` |
| Allowed action | direct `npm publish` |

Create the matching GitHub `npm` environment and restrict deployments to `npm-v*` tags. Configure reviewer approval if needed. The publish job uses OIDC rather than an npm token and publishes only downloaded, tested tarballs. The workflow uses a modern npm CLI and GitHub-hosted runners. See [npm's current Trusted Publishing documentation](https://docs.npmjs.com/trusted-publishers/) for setup constraints and publisher validation expiry.

## Release

1. Update all three package versions and adapter dependencies, refresh `sdk-js/package-lock.json`, and merge after CI passes.
2. Publish a GitHub release tagged `npm-v0.1.0` (or the matching version) from the tested main commit. A tag push alone does not publish.
3. The workflow validates source/version, runs quality checks and tests, builds JavaScript and declarations, packs the three packages, and tests installation outside the workspace. Then each package publishes using its own Trusted Publisher.
4. Stable releases use the npm `latest` tag; GitHub prereleases use `next`. Verify installation and provenance after publication.

Publication across packages is not atomic. On an authentication failure, correct configuration and rerun failed jobs only. Do not overwrite a published version or change an already-published tarball; bump versions for artifact fixes. Test registry installation after all adapters and core are published.

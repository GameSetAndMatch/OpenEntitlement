# Service container and Docker Hub releases

The image `olivierbelhumeur/openentitlement` contains the reference HTTP service and built administration console. It runs as the unprivileged `node` user and supports memory, fixed and PostgreSQL providers.

## One-time publishing setup

1. Create a Docker Hub repository named `openentitlement` under `olivierbelhumeur`. Choose public visibility for the public reference image.
2. Create a Docker Hub access token with read/write permission for publishing.
3. In GitHub repository Settings → Environments, create `dockerhub`. Add the secret `DOCKERHUB_TOKEN`. Restrict deployments to the main branch and `service-v*` tags; optionally require a reviewer.
4. Merge this workflow. Main-branch changes build/test the image and publish `edge` plus a commit-SHA tag. PRs only build/test; they never log in or push.

For versioned releases, update `console/package.json` and its lockfile, merge after CI passes, then publish a GitHub release tagged `service-v0.1.0` (or the matching version). The workflow checks the tag and requires a commit in main history. Stable releases publish the version, SHA and `latest`; prereleases do not update `latest`. Merely pushing a tag does not publish a versioned release. Python/npm releases use separate tag prefixes.

Publishing builds Linux amd64 and arm64 images, with BuildKit provenance and SBOM metadata. The PR smoke test exercises the runner's native architecture. Multi-platform publication still needs a successful GitHub Actions run. [Official Docker workflow documentation](https://docs.docker.com/build/ci/github-actions/multi-platform/).

## Local demo

Before the first publication, build from the repository root:

```sh
docker build -t openentitlement:local .
docker run --rm --name openentitlement -p 127.0.0.1:8787:8787 openentitlement:local
```

Once published, substitute `olivierbelhumeur/openentitlement:edge`. Open http://localhost:8787 to inspect Free, Pro, trial and Business organizations. In-memory data resets on restart. The anonymous demo port is bound to loopback to keep it local.

## Persistent service

Create an environment file outside Git:

```dotenv
OE_PROVIDER=postgres
DATABASE_URL=postgresql://USER:PASSWORD@DATABASE_HOST:5432/DATABASE
OE_ADMIN_TOKEN=REPLACE_WITH_A_RANDOM_ADMIN_TOKEN
OE_EVAL_TOKEN=REPLACE_WITH_A_DIFFERENT_RANDOM_SERVICE_TOKEN
OE_SEED=none
```

Run with a published version or substitute your local image before publication:

```sh
docker run --rm --name openentitlement \
  --env-file /secure/path/openentitlement.env \
  -p 127.0.0.1:8787:8787 \
  olivierbelhumeur/openentitlement:0.1.0
```

The PostgreSQL host must be reachable from inside the container; `localhost` means the container itself. The server migrates its tables and starts without demo plans. Configure the admin token in the console connection settings, then create plans and assignments. Keep database data in persistent storage and arrange backups. Use `OE_SEED=demo` only for empty disposable demo databases.

Mount a custom catalog read-only and set `OE_CATALOG` to its container path if needed. Use a TLS reverse proxy for remote hosting. Evaluation tokens cover the service instance; your backend must authorize organization access. Pin a version or image digest for deployments, as `edge` and `latest` move. See the [service guide](../../console/README.md) for API and provider details.

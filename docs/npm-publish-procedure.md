# Docuscan npm Publish Procedure

This is the production publish flow for all public SDK packages under `@docuscan/*`.

## 1. Preconditions

1. npm scope exists and you have publish rights:
- `@docuscan`
2. Node and pnpm match workspace expectations:
- `node -v` (recommended Node 20+)
- `pnpm -v` (workspace uses pnpm 10)
3. npm auth is configured:
- `npm whoami`
- If not logged in: `npm login --scope=@docuscan`
4. If your account enforces 2FA, keep OTP ready for publish.

## 2. Release Validation (Must Pass)

Run from repository root:

```bash
pnpm release:verify
```

This runs typecheck, lint, tests, build, e2e, perf gates, and size gates.

## 3. Versioning Strategy

Use one aligned version for all publishable packages in `packages/*`.

Example:

```bash
pnpm -r --filter './packages/**' exec npm version 0.2.0 --no-git-tag-version
```

Then rebuild once:

```bash
pnpm build
```

## 4. Dry Run (Mandatory)

```bash
pnpm publish:dry-run
```

Confirm package contents and entrypoints are correct, especially:
- `@docuscan/sdk-headless` subpath exports:
  - `/core`
  - `/webgl-warp`
  - `/enhance`
  - `/hybrid-corner` (preferred)
  - `/ml-fallback`

## 5. Publish

```bash
pnpm publish:npm
```

If prompted for OTP, enter npm 2FA code.

Notes:
- `publishConfig.access=public` is already set in each package.
- `pnpm -r` publishes in dependency-safe order.

## 6. Post-Publish Verification

1. Check metadata:

```bash
npm view @docuscan/sdk-headless version
npm view @docuscan/sdk-react version
```

2. Smoke install in a temp directory:

```bash
mkdir -p /tmp/docuscan-publish-check && cd /tmp/docuscan-publish-check
npm init -y
npm i @docuscan/sdk-headless @docuscan/sdk-react
node -e "import('@docuscan/sdk-headless').then(() => console.log('headless ok'))"
```

3. Verify subpath imports:

```bash
node -e "import('@docuscan/sdk-headless/core').then(() => console.log('core ok'))"
node -e "import('@docuscan/sdk-headless/hybrid-corner').then(() => console.log('hybrid corner ok'))"
node -e "import('@docuscan/sdk-headless/ml-fallback').then(() => console.log('ml fallback ok'))"
```

## 7. Rollback / Mitigation

If a bad release ships:

1. Immediately deprecate affected versions:

```bash
npm deprecate @docuscan/sdk-headless@0.2.0 "Broken release, use >=0.2.1"
```

2. Publish a fixed patch (recommended) rather than relying on unpublish.

## 8. Publishable Packages

The publish workflow targets all packages in `packages/*`:

1. `@docuscan/core-engine`
2. `@docuscan/warp-cpu`
3. `@docuscan/warp-webgl`
4. `@docuscan/worker-runtime`
5. `@docuscan/runtime-web`
6. `@docuscan/sdk-headless`
7. `@docuscan/sdk-react`

# Document Auto Capture npm Publish Procedure

This repository publishes only two public packages:

1. `js-document-autocapture`
2. `react-document-autocapture`

Internal `@document-autocapture/*` packages are workspace-only and non-publishable.

## 1. Preconditions

- Node 20+ and pnpm 10+
- npm login completed (`npm whoami`)
- clean working tree

## 2. Full Validation

From repo root:

```bash
pnpm release:verify
```

Includes:

- brand check
- no-onnx policy
- lint/typecheck/tests/build
- e2e + perf + size gates

## 3. Versioning

Update only the two public package versions:

```bash
pnpm --filter js-document-autocapture exec npm version 0.2.0 --no-git-tag-version
pnpm --filter react-document-autocapture exec npm version 0.2.0 --no-git-tag-version
pnpm build
```

## 4. Dry Run

```bash
pnpm publish:dry-run
```

Verify output includes expected exports, especially:

- `js-document-autocapture` (single entry point)
- `react-document-autocapture` (ESM + CJS)

## 5. Publish

```bash
pnpm publish:npm
```

Publish order is headless first, then react.

## 6. Post-Publish Smoke Check

```bash
npm view js-document-autocapture version
npm view react-document-autocapture version

mkdir -p /tmp/document-autocapture-publish-check && cd /tmp/document-autocapture-publish-check
npm init -y
npm i js-document-autocapture react-document-autocapture react react-dom
node -e "import('js-document-autocapture').then(() => console.log('headless ok'))"
node -e "import('react-document-autocapture').then(() => console.log('react ok'))"
```

## 7. Rollback

If a bad version ships, deprecate immediately:

```bash
npm deprecate js-document-autocapture@0.2.0 "Broken release, use >=0.2.1"
```

Then publish a fixed patch.

# React integration (`/react`)

This route demonstrates direct `@docuscan/sdk-react` hook usage in a browser page:

- live camera preview
- start / stop / capture controls
- real-time guidance + detection/source chips
- latest capture preview
- copyable install and usage snippets

## Run locally

```bash
pnpm --filter @docuscan/demo-react dev
```

Open:

- `http://localhost:4173/react`

## Package usage shown

```bash
pnpm add @docuscan/sdk-react @docuscan/sdk-headless
```

The page config uses ML primary (`doc-corner-v2`) with strict warp validation and PNG capture defaults.

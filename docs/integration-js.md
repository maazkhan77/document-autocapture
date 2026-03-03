# Vanilla JS integration (`/js`)

This route demonstrates imperative `@docuscan/sdk-headless` usage without React hooks.

Mount API:

- `mount(container: HTMLElement): () => Promise<void>`
- wires events: `frame`, `detection`, `guidance`, `capture`, `warning`, `error`
- cleanup always calls `stop()` then `destroy()`

## Run locally

```bash
pnpm --filter @docuscan/demo-react dev
```

Open:

- `http://localhost:4173/js`

## Package usage shown

```bash
pnpm add @docuscan/sdk-headless
```

The sample uses ML primary (`doc-corner-v2`) and falls back to CV when ML misses/rejects.

# Frontend UX Research and Applied Decisions

Generated: 2026-02-28

## 1. Product UI References Reviewed

1. [Linear](https://linear.app)
2. [Stripe Dashboard](https://dashboard.stripe.com)
3. [Vercel Dashboard](https://vercel.com/dashboard)
4. [Notion](https://www.notion.so)

Patterns taken from these products:
- primary task is always visible on first screen
- dense top status bar instead of large hero blocks
- side inspector/tabs for advanced controls
- minimal spacing and controlled visual hierarchy for operator workflows

## 2. React + Web Platform References

1. React docs: [Keeping Components Pure](https://react.dev/learn/keeping-components-pure)
2. React docs: [Choosing the State Structure](https://react.dev/learn/choosing-the-state-structure)
3. web.dev: [Responsive Web Design Basics](https://web.dev/responsive-web-design-basics/)
4. MDN: [object-fit](https://developer.mozilla.org/en-US/docs/Web/CSS/object-fit)
5. WAI-ARIA APG: [Tabs Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)

## 3. What Was Implemented in Demo UI

1. Removed large hero and excess vertical spacing.
2. Replaced multi-section scrolling page with single compact workspace:
- left: live camera + core capture actions
- right: tabbed sidebar (`Captures`, `Controls`, `Events`, `Insights`)
3. Kept `Captures` tab default so capture output is always visible.
4. Added ARIA tab roles (`tablist`, `tab`, `tabpanel`) for accessibility.
5. Reduced camera blur risk by:
- switching preview rendering to `object-fit: contain`
- setting high-clarity default constraints (`ideal 1920x1080`)
6. Kept advanced tooling but moved it out of primary scan flow.

## 4. Resulting UX Rule (Locked for Demo)

No-scroll-first scanner workflow on desktop:
- scanner view, status, and capture output must fit in one viewport
- secondary diagnostics remain one click away in sidebar tabs

# Project memory

## Product intent & audience

- Web app with a marketing landing page (`landingpage.tsx`) promoting a scanning/inspection product.
- Landing page includes feature sections: "Comprehensive scanning" (feature cards) and "How it works" (step list).
- Feature domain includes "Issue Inspection"; product likely involves automated scanning/detection of issues.
- Target audience: end users evaluating a scanning/inspection tool.

## Brand personality & voice

- Production-quality, polished presentation expected on the landing page.
- Feature descriptions use concise benefit-oriented copy with per-card icons.

## Visual design & UX direction

- Feature sections rendered as card grids with Lucide React icons per card.
- "How it works" rendered as an ordered steps list.
- Avoid repeating the same icon across multiple cards; each card should have a distinct, semantically appropriate Lucide icon.
- Keep section copy and layout stable when adding new features; don't restructure unrelated sections.

## Decisions, constraints & rationale

- Tech stack: Vite + React (JSX), Tailwind CSS, React hooks, Lucide React icons.
- No additional UI/icon packages unless explicitly requested.
- When adding features, verify JSX syntax (parentheses, indentation) to prevent compile errors that break the preview.
- Rationale for cleanup pass: repeated icons and stray whitespace reduce production polish; fixing them alongside syntax errors keeps the landing page consistent.

## Open questions & assumptions

- Exact product domain (property, automotive, general inspection) not yet confirmed; inferred from "Issue Inspection" and "Comprehensive scanning" labels.
- Whether additional pages beyond the landing page exist is unknown.
- Icon set preference beyond "distinct per card" is not yet specified.

<!-- DEMO RESPONSE - REPLACE WITH YOUR ACTUAL RESPONSE -->
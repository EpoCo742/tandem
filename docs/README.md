# Tandem design package

Working name: **Tandem** (placeholder). Produced 2026-09-03 from `research-prompt.txt`.

| File | Audience | Purpose |
|---|---|---|
| `01-research-findings.md` | you | What exists, what is possible, vendor policy on credentials, effort, cost, risks, open questions, sources |
| `02-architecture.md` | humans (engineers, stakeholders) | Concept, principles, containers, ledger, turn broker, governance, versioning, context, compile pipeline, roadmap. Mermaid diagrams throughout |
| `03-technical-design-spec.md` | Claude Code / implementing engineers | Locked defaults, repo layout, full SQL schema, event catalogue, broker state machine, policy engine, provider adapters, canvas tools, API, prompts, tests, milestones with acceptance criteria |
| `04-executive-deck.html` | all audiences | 13-slide concept deck. Also published as a claude.ai artifact |
| `05-poc-plan.md` | you + Claude Code | Decisions of 2026-09-03 and the consolidated single-process POC: Copilot first, sponsor mode, SQLite, embedded Hocuspocus, demo script |

Published artifacts (private until shared; HTML sources in `docs/html/`, regenerated from the Markdown by a small Python build script):

- Deck: https://claude.ai/code/artifact/6d90880e-8729-4118-bc02-376293235ec9
- Research findings: https://claude.ai/code/artifact/0e2f5624-8554-46fa-abd4-3031d863605c
- Architecture: https://claude.ai/code/artifact/510c6db8-8260-44c5-ba43-3431fd5435a7
- Technical spec: https://claude.ai/code/artifact/98ee551b-36ee-496e-9c56-617ca8cd8320
- POC plan: https://claude.ai/code/artifact/ec11b562-c5b7-4014-bb85-bc01a147e3b0

Recommended reading order: research findings, then architecture, then the spec, then the POC plan.

To start building: open a new Claude Code session in an empty repo and give it `03-technical-design-spec.md` plus `05-poc-plan.md` with the instruction "Implement POC step P0 following the POC plan's consolidation map."

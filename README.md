# Tandem

Working name for a shared AI session product: two to five software architects share one AI conversation and one versioned artifact canvas, each funding their turns with their own AI credentials, and compile the result into a design document.

This repository holds the research, design package, and (soon) the proof-of-concept code.

## Layout

| Path | Contents |
|---|---|
| `research-prompt.txt` | The original brief |
| `docs/` | Design package: research findings, architecture, technical spec, executive deck, POC plan. See `docs/README.md` for reading order and published artifact links |
| `docs/html/` | Rendered HTML versions of the Markdown docs, used for the published artifacts |
| `tools/build-docs.py` | Regenerates `docs/html/` from the Markdown (`python tools/build-docs.py`; needs `pip install markdown`) |

## Status

2026-09-03: research and design complete; POC decisions recorded in `docs/05-poc-plan.md` (GitHub Copilot first, sponsor mode, hybrid governance, single-process SQLite deployment). Code starts with POC step P0.

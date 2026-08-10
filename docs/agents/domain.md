# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root, or
- **`CONTEXT-MAP.md`** at the repo root if it exists — it points at one `CONTEXT.md` per context. Read each one relevant to the topic.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill creates them lazily when terms or decisions actually get resolved.

## File structure

Single-context repo (this repo):

```
/
├── CONTEXT.md          ← does not exist yet, created lazily if needed
├── docs/adr/           ← does not exist yet
├── data/trips/         ← the data contract (each trip = one JSON)
├── photos/<tripId>/    ← per-trip photo directories
└── scripts/            ← validate_trips.py (the one test seam)
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding.

## Domain vocabulary in use (informal, until CONTEXT.md exists)

- **行程 (trip)**: one JSON in `data/trips/` + one `photos/<id>/` dir; the site's top-level unit
- **播报 (actual)**: `day.actual` — real-life update (photo + one-liner) overriding the plan during travel
- **计划行程 (plan)**: the Feishu-derived itinerary shown when no `actual` exists
- **报平安**: the site's core scenario — parents open the link and see where the couple is today

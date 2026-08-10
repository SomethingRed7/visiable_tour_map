# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues (repo `SomethingRed7/visiable_tour_map`).

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."` with a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment**: `gh issue comment <number> --body "..."`
- **Labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

## ⚠️ This machine has no `gh` CLI

`gh` is **not installed** on this machine (2026-08). Use the curl fallback from the `github-issues` skill:

- Token source: `~/.git-credentials` (`https://<user>:<token>@github.com`), NOT `~/.hermes/.env` (no GITHUB_TOKEN there)
- Endpoints: `POST /repos/{owner}/{repo}/issues` (create), `PATCH` (edit), `POST .../issues/N/comments`, `POST .../issues/N/labels`, `DELETE .../issues/N/labels/{name}`
- Infer repo from `git remote -v`: `https://github.com/SomethingRed7/visiable_tour_map.git`

## Pull requests as a triage surface

**PRs as a request surface: no.**

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments` (or the curl equivalent).

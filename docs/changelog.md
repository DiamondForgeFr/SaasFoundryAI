# Changelog

All notable changes to SaaSFoundryAI are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

#### CLI commands

- **`sf modules`** ([#60](https://github.com/DiamondForgeFr/SaaSFoundryAI/issues/60)) — `list`, `info`, and `match` catalogued modules (email, storage, analytics) with weighted keyword scoring.
- **`sf skill`** ([#61](https://github.com/DiamondForgeFr/SaaSFoundryAI/issues/61)) — `install`, `update`, `uninstall` skill bundles; `sf uninstall --all` for full cleanup. Includes stale-version
  detection and per-bundle `.version` manifests.
- **`sf feedback`** ([#62](https://github.com/DiamondForgeFr/SaaSFoundryAI/issues/62)) — `request` new modules, `bug` to report issues, `list` community requests, `vote` with 👍 / 👎 / comment.
  Deduplication and preference tracking built in.
- **`sf tools`** — manage multi-account credentials for Atlassian, Notion, Figma, and other external services.

#### Non-interactive mode

- `sf new --non-interactive` with full flag surface for scripted scaffolding ([#58](https://github.com/DiamondForgeFr/SaaSFoundryAI/issues/58)).
- `sf update` flags: `--dry-run`, `--conflict-strategy theirs|ours|manual`, `--accept-template-updates` ([#59](https://github.com/DiamondForgeFr/SaaSFoundryAI/issues/59)).

#### Workflow system

- 7-status complexity-adaptive workflow: `Backlog → Ready → In progress → AI testing → Human testing → In review → Done`.
- 4 complexity levels (bug / low / medium / complex) with adaptive ceremony — analyze depth, plan approval gates, adversarial review for complex tickets.
- Smart tool detection for GitHub Projects, Jira, Notion, and Linear based on local credentials.
- GitHub Projects CLI helper (`github-projects-cli.sh`) with sub-issue linking via GraphQL.
- Workflow enforcement: subtask closure as you go + parent-transition gating ([#79](https://github.com/DiamondForgeFr/SaaSFoundryAI/issues/79)).

#### Skills ecosystem

- **`sf-workflow`** — unified successor of the former `sf-workflow-apex` + `sf-workflow-apex-free` skills. Behavior now scales by complexity tag.
- **`sf-tool-saasfoundry`** ([#18](https://github.com/DiamondForgeFr/SaaSFoundryAI/issues/18)) — catalogue-aware anti-reinvention guardrails, feedback orchestration, and discovery helpers for `sf new`
  / `sf update`.
- Module catalogue schema with enriched metadata ([#60](https://github.com/DiamondForgeFr/SaaSFoundryAI/issues/60)).
- Project awareness helper (`read-project.sh`) for skill consumers ([#106](https://github.com/DiamondForgeFr/SaaSFoundryAI/issues/106)).
- Anti-reinvention scoring that classifies user intent against the catalogue ([#123](https://github.com/DiamondForgeFr/SaaSFoundryAI/issues/123)).

#### Infrastructure

- Split pre-commit / pre-push hooks for faster commits (~15s) and heavier tests on push (~2-3 min) ([#33](https://github.com/DiamondForgeFr/SaaSFoundryAI/issues/33)).
- Codecov integration with coverage badge in README ([#33](https://github.com/DiamondForgeFr/SaaSFoundryAI/issues/33)).
- On-disk project schema cache with `cache-clear` escape hatch ([#137](https://github.com/DiamondForgeFr/SaaSFoundryAI/issues/137)).
- Scaffolded GitHub Projects CLI sync + drift guard ([#138](https://github.com/DiamondForgeFr/SaaSFoundryAI/issues/138)).

### Changed

- Workflow configuration consolidated in `.saasfoundry.json` (previously split with the deprecated `.saasfoundry-workflow.json`).
- `getAvailableModules` now routes through the module catalogue for enriched metadata ([#60](https://github.com/DiamondForgeFr/SaaSFoundryAI/issues/60)).

### Fixed

- Generalize non-interactive missing-values error message ([#59](https://github.com/DiamondForgeFr/SaaSFoundryAI/issues/59)).
- `_cache_fresh` now branches on `OSTYPE` so GNU `stat` returns the right field ([#135](https://github.com/DiamondForgeFr/SaaSFoundryAI/issues/135)).

## [1.0.0-beta]

Initial beta release. The generator scaffolds production-ready SaaS projects with:

- **Backend**: NestJS 11 + Prisma 7 (driver adapters) + PostgreSQL 16 + JWT + Passport + Zod 4.
- **Frontend**: React 19 + React Router v7 + Vite 7 + TailwindCSS 4 + Radix UI (unified) + ShadCN UI + React Query + React Hook Form + Zod 4 + i18next.
- **Infra**: Docker multi-stage builds + Nginx + dedicated `saasfoundry-network`.
- **Topologies**: monorepo and multirepo.
- **Optional modules**: email (MailerSend), storage (S3), analytics (Umami).

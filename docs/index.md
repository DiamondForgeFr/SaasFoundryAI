---
layout: home
hero:
  name: SaaSFoundry
  text: Production SaaS, built for human + AI teams.
  tagline: Scaffold a professional NestJS + React + PostgreSQL project in minutes — then ship features with guardrails that keep every contributor, human or AI, on the same workflow.
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started/installation
    - theme: alt
      text: Read the philosophy
      link: /workflow/introduction
    - theme: alt
      text: GitHub
      link: https://github.com/DiamondForgeFr/SaaSFoundry

features:
  - icon: 🚀
    title: Day-one velocity
    details:
      Generate a full monorepo — NestJS 11, React 19, PostgreSQL 16, Prisma 7, Docker, CI, hooks, tests, i18n, auth — with `sf new`. You write the first business feature on day one, not week two.

  - icon: 🎯
    title: Focus on what makes your product different
    details: Boilerplate is solved once, at the generator level. You skip the weeks of wiring and spend your time on the features only your product needs.

  - icon: 🤝
    title: One workflow — humans and AI, side by side
    details:
      A 7-status lifecycle (Backlog → Ready → In progress → AI testing → Human testing → In review → Done) applies to every ticket, whoever picks it up. Your AI agent works the board exactly like a
      developer.

  - icon: 🛡️
    title: Guardrails that protect code quality
    details: Conventional commits, pre-commit + pre-push validation, structured tickets, PR gates. Drift is caught before it merges — whether the author is human, AI, or both.

  - icon: 🧠
    title: Token-efficient by design
    details:
      Every ticket is tagged bug / low / medium / complex. The AI scales its ceremony to match — minimal analysis on a typo, full adversarial review on a critical change. You pay for rigor, not
      theatre.

  - icon: 🧩
    title: Grow with `sf update`
    details: Email, storage, analytics and more ship as composable modules. Add them later, receive upstream improvements without rewriting, and stay aligned with the latest scaffold.
---

## Built for teams that care about code quality — with or without AI

SaaSFoundry is not an AI wrapper. It is a **professional scaffold + workflow contract** that works perfectly well with a team of humans only, and **scales gracefully when AI agents join the team**.

Whether you are a freelancer starting a new client project, a CTO bootstrapping a product, or a team bringing Claude Code into an existing engineering workflow — SaaSFoundry gives you the same thing:
a codebase and a process your whole team can trust.

### The core idea

Traditional engineering workflows put all the guardrails at the pull request. That works when a reviewer can mentally simulate what the author intended. It breaks down the moment part of the work is
done by an AI agent that has no memory of prior decisions.

**SaaSFoundry inverts the model: the guardrails live in the workflow itself.** By the time a pull request exists, the code has already been planned, reviewed, tested, and validated — by both humans
and automation.

```text
Backlog → Ready → In progress → AI testing → Human testing → In review → Done
```

Every ticket moves through the same seven statuses. The rigor at each step **scales with the ticket's complexity tag**, so you pay for ceremony only when it matters.

| Complexity     | Style            | What the AI does                                      |
| -------------- | ---------------- | ----------------------------------------------------- |
| 🐛 **bug**     | Direct fix       | Skip analyze/plan. Regression test mandatory.         |
| 🟢 **low**     | Oneshot          | Minimal analysis, mental plan, no approval needed.    |
| 🟡 **medium**  | Structured       | 2–4 exploration agents, detailed plan, approval gate. |
| 🔴 **complex** | Full adversarial | 6–10 agents, comprehensive plan, OWASP-grade review.  |

Result: trivial work stays lightweight, critical work gets the rigor it deserves, and **token spend tracks the value of the task**.

## Your tools, not another silo

Your AI agent does not invent its own task tracker. It uses the tool **you** already use:

| Tool            | When to pick it                                         |
| --------------- | ------------------------------------------------------- |
| GitHub Projects | Default. Native to the repo, free, sub-issues built in. |
| Jira            | Mature PM surface, sprints, custom fields.              |
| Notion          | Doc-adjacent, great for product + engineering orgs.     |
| Linear          | Fast, opinionated cycles for startups.                  |

You get human-readable tickets, standard board columns, and a paper trail a non-technical stakeholder can follow. **Your AI agent creates sub-issues, moves statuses, opens PRs and leaves comments —
exactly like a developer would.** Human checkpoints sit at the natural transitions (Ready, Human testing, In review), so a person always confirms before code leaves the team's hands.

## How it works

```bash
# 1. Generate a production-ready project
sf new my-saas          # choose topology, modules, workflow tool

# 2. Ship your first ticket end-to-end
sf workflow              # walk through Backlog → Done for a real ticket

# 3. Stay current as SaaSFoundry evolves
sf update                # receive upstream improvements, add modules, resolve conflicts
```

Every command respects the same `.saasfoundry.json` configuration — so the workflow your team follows today is the workflow your AI agent follows tomorrow.

## Ready to try?

- **[Install SaaSFoundry →](/getting-started/installation)** — two commands, 60 seconds.
- **[Ship your first ticket →](/getting-started/first-project)** — a complete walk-through with a real example.
- **[Read the philosophy →](/workflow/introduction)** — why this workflow exists and how it stays honest.

---

::: tip Dogfooded end to end SaaSFoundry is built using its own workflow. Every feature you see here was shipped through the same 7-status lifecycle your generated projects will use. If it breaks for
us, we notice before it breaks for you. :::

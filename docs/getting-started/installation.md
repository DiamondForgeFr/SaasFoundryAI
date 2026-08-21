# Installation

## Start here — give this line to your AI assistant

> Install the SaaSFoundryAI skill from https://github.com/DiamondForgeFr/SaasFoundryAI

Move into the folder you want to work in, hand that line to Claude Code — or any assistant that can read a link and run commands — and describe your product in your own words. The assistant installs
the skill and takes it from there: scaffolding, modules, workflow, tickets. **Nothing below this section is required to get started.**

::: details What your assistant does with that line

```bash
# Installs the tool-saasfoundry skill at user scope, into ~/.claude/skills/tool-saasfoundry/
npx saasfoundryai-cli@beta skill install --yes --force

# Use --project instead to commit the skill with the repo and share it with the team
```

`npx` means the CLI never has to be installed first. From there the skill reads `.saasfoundry.json` when there is one, drives `sf` **non-interactively**, and never answers the interactive prompts on
your behalf. Full contract in [Skills System](/guide/skills-system) and [`sf skill`](/cli/sf-skill).

:::

The rest of this page is for the terminal path — installing the CLI yourself and driving it by hand. It is a supported, first-class route, not a fallback.

## What is SaaSFoundryAI?

SaaSFoundryAI is an **AI-assisted collaborative development platform** that scaffolds production-ready SaaS projects. It's not an AI-powered app itself, but a platform designed for **Human + AI
collaboration**.

::: info AI Collaboration

SaaSFoundryAI generates projects optimized for development with Claude Code (Anthropic's AI coding assistant). The generated projects include Claude-powered skills that assist with git operations,
workflow management, and development tasks.

:::

## Prerequisites

### 1. Node.js and Package Manager

- **Node.js** >= 22.13.0 — but see the note below: Node 24 is what `.nvmrc` pins
- **npm** >= 11 (not yarn or pnpm — see below)
- **Git**

::: warning npm 11 is required, and Node 22 does not ship it

Generated projects declare `engines.npm >= 11` and enforce it through `devEngines`. Node 22 bundles npm 10.9.x, so `npm install` in a fresh project fails with:

```
npm error EBADDEVENGINES Invalid semver version ">=11.0.0" does not match "10.9.2"
```

The whole npm 10 line crashes on the generated workspace graph (`Cannot read properties of null (reading 'edgesOut')`), which is why the floor exists. Generated projects therefore pin `.nvmrc` to
**24.19.0**, which bundles npm 11.

If you stay on Node 22, upgrade npm yourself: `npm install -g npm@11`.

:::

::: tip Why not yarn or pnpm

Generated projects ship a `package-lock.json` and declare npm through `devEngines`. yarn and pnpm are not tested against the scaffolds and will not resolve the same tree.

:::

### 2. Claude Code (Terminal Version)

**Required for AI-assisted development**

Claude Code is Anthropic's official CLI for Claude AI. It provides AI assistance directly in your terminal.

**Installation:**

```bash
# Using npm
npm install -g @anthropic-ai/claude-code

# Or using brew (macOS)
brew install anthropic/tap/claude-code
```

**Verify installation:**

```bash
claude --version
```

See: [Claude Code Documentation](https://docs.anthropic.com/claude-code)

### 3. cmux (Recommended for macOS)

**Optional but highly recommended**

cmux is a terminal multiplexer with an integrated browser, perfect for full-stack development.

**Why cmux?**

- ✅ **Split panes** - Work on API, web, and docs simultaneously
- ✅ **Integrated browser** - See changes instantly without switching apps
- ✅ **Claude integration** - AI assistance across all panes
- ✅ **Session management** - Save and restore your workspace

**Installation (macOS only):**

```bash
brew install cmux
```

**Launch your project with cmux:**

```bash
cd my-saas-project
cmux
```

See: [cmux Documentation](https://cmux.dev)

## Prefer a terminal? Install the CLI

If you would rather run the commands yourself, install SaaSFoundryAI globally using your preferred package manager:

::: code-group

```bash [npm]
npm install -g saasfoundryai-cli
```

```bash [yarn]
yarn global add saasfoundryai-cli
```

```bash [pnpm]
pnpm add -g saasfoundryai-cli
```

:::

## Verify Installation

```bash
sf --version
```

You should see the version number printed.

## Recommended Workflow

### With your AI assistant

1. **Install Claude Code** (and cmux on macOS, if you want the integrated browser)
2. **Hand it the line** at the top of this page, from the folder you want to work in
3. **Describe your product** — the assistant resolves the rest and runs `sf new` for you
4. **Keep going in the same conversation** — modules, workflow, tickets, all through the skill

### From the terminal

1. **Install tools**: Node.js, Claude Code, SaaSFoundryAI (and cmux on macOS)
2. **Create project**: `sf new`
3. **Launch your AI in the project**: `cd my-project && claude` (or `cmux` on macOS)
4. **Work with AI**: Use Claude skills for git, workflow, and development tasks

## Next Steps

- [Quick Start](/getting-started/quick-start) - Create your first project, with an assistant or from the terminal
- [First Project](/getting-started/first-project) - Detailed walkthrough
- [Skills System](/guide/skills-system) - Learn about AI-powered skills

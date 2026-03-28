# Installation

## What is SaaSFoundry?

SaaSFoundry is an **AI-assisted collaborative development platform** that scaffolds production-ready SaaS projects. It's not an AI-powered app itself, but a platform designed for **Human + AI
collaboration**.

::: info AI Collaboration SaaSFoundry generates projects optimized for development with Claude Code (Anthropic's AI coding assistant). The generated projects include Claude-powered skills that assist
with git operations, workflow management, and development tasks. :::

## Prerequisites

### 1. Node.js and Package Manager

- **Node.js** >= 20.19.0
- **npm**, **yarn**, or **pnpm**
- **Git**

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

## Install SaaSFoundry CLI

Install SaaSFoundry globally using your preferred package manager:

::: code-group

```bash [npm]
npm install -g saasfoundry
```

```bash [yarn]
yarn global add saasfoundry
```

```bash [pnpm]
pnpm add -g saasfoundry
```

:::

## Verify Installation

```bash
sf --version
```

You should see the version number printed.

## Recommended Workflow

### For macOS Developers

1. **Install all tools**: Node.js, Claude Code, cmux, SaaSFoundry
2. **Create project**: `sf new`
3. **Launch cmux**: `cd my-project && cmux`
4. **Work with AI**: Use Claude Code in cmux panes for AI-assisted development

### For Other Platforms

1. **Install tools**: Node.js, Claude Code, SaaSFoundry
2. **Create project**: `sf new`
3. **Launch Claude Code**: `cd my-project && claude`
4. **Work with AI**: Use Claude skills for git, workflow, and development tasks

## Next Steps

- [Quick Start](/getting-started/quick-start) - Create your first project
- [First Project](/getting-started/first-project) - Detailed walkthrough
- [Skills System](/guide/skills-system) - Learn about AI-powered skills

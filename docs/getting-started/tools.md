# Development Tools

SaaSFoundry is designed for **AI-assisted collaborative development**. Here's the recommended toolset for the best experience.

## AI Collaboration Model

SaaSFoundry generates projects optimized for Human + AI development:

```
┌─────────────┐
│   Human     │ ← You write requirements, review code, make decisions
└──────┬──────┘
       │
       ↓
┌─────────────┐
│ Claude Code │ ← AI implements features, manages git, handles workflow
└──────┬──────┘
       │
       ↓
┌─────────────┐
│ SaaSFoundry │ ← Generated project with Claude-powered skills
│   Project   │
└─────────────┘
```

**Key Point**: SaaSFoundry is not AI-powered itself. It's a **platform that creates projects optimized for AI collaboration**.

## Required Tools

### 1. Claude Code (Terminal)

**What it is**: Anthropic's official CLI for Claude AI

**Why you need it**: Provides AI assistance for:

- Writing and reviewing code
- Git operations (commits, PRs, merges)
- Workflow management (issues, tickets, subtasks)
- Error fixing and refactoring

**Installation**:

```bash
# npm
npm install -g @anthropic-ai/claude-code

# Homebrew (macOS)
brew install anthropic/tap/claude-code
```

**Usage**:

```bash
cd my-saas-project
claude
# Claude Code launches and reads project context
# Use natural language to request code changes
```

**Learn more**: [Claude Code Documentation](https://docs.anthropic.com/claude-code)

### 2. Node.js >= 20.19.0

**Why this version**: Required for:

- Prisma 7 (driver adapters)
- Vite 7 (frontend bundling)
- NestJS 11 (backend framework)

**Installation**:

```bash
# Using nvm (recommended)
nvm install 20
nvm use 20

# Or download from nodejs.org
```

## Recommended Tools

### cmux (macOS Only)

**What it is**: Terminal multiplexer with integrated browser

**Why it's recommended**:

- ✅ **Work on multiple aspects simultaneously**

  - API development in one pane
  - Frontend in another
  - Database in another
  - Claude Code in all panes

- ✅ **Integrated browser**

  - See frontend changes instantly
  - No need to switch apps
  - Browser shares pane space with terminal

- ✅ **Session management**
  - Save your entire workspace
  - Restore instantly when switching projects

**Installation** (macOS only):

```bash
brew install cmux
```

**Example workflow with cmux**:

```bash
cd my-saas-project
cmux

# cmux launches with multiple panes:
# ┌─────────────┬─────────────┐
# │ API (dev)   │ Web (dev)   │
# ├─────────────┼─────────────┤
# │ Claude Code │  Browser    │
# └─────────────┴─────────────┘
```

**Learn more**: [cmux.dev](https://cmux.dev)

## Typical Development Setup

### macOS Setup (Recommended)

```bash
# 1. Install Claude Code
brew install anthropic/tap/claude-code

# 2. Install cmux
brew install cmux

# 3. Install SaaSFoundry
npm install -g saasfoundry-cli

# 4. Create project
sf new

# 5. Launch development environment
cd my-project
cmux
```

**In cmux**:

- **Top-left pane**: `cd apps/api && npm run dev` (API server)
- **Top-right pane**: `cd apps/web && npm run dev` (Frontend)
- **Bottom-left pane**: `claude` (AI assistant)
- **Bottom-right pane**: Browser → http://localhost:5173

### Other Platforms Setup

```bash
# 1. Install Claude Code
npm install -g @anthropic-ai/claude-code

# 2. Install SaaSFoundry
npm install -g saasfoundry-cli

# 3. Create project
sf new

# 4. Launch development
cd my-project
claude
```

**In separate terminals**:

- Terminal 1: `cd apps/api && npm run dev`
- Terminal 2: `cd apps/web && npm run dev`
- Terminal 3: `claude` (AI assistant)
- Browser: http://localhost:5173

## Claude Code Skills

Generated projects include Claude-powered skills in `.claude/skills/`:

### Git Skills

- `/commit` - Quick commit with minimal message
- `/pr` - Create PR with auto-generated description
- `/merge` - Context-aware conflict resolution

### Workflow Skills

- `sf-workflow` - Complexity-adaptive workflow (bug / low / medium / complex), auto-triggered on workflow keywords
- Project management integration via `sf-tool-*` skills — **GitHub Projects is the adapter shipping today**; Jira, Notion, Linear and ClickUp adapters are on the roadmap

### Utility Skills

- `/fix-errors` - Fix all ESLint and TypeScript errors
- `/fix-grammar` - Fix grammar while preserving formatting

See: [Skills System Guide](/guide/skills-system)

## IDE Integration (Optional)

Claude Code works in any terminal, but can also integrate with IDEs:

### VS Code

- Use integrated terminal for Claude Code
- Split panes for code + Claude

### Cursor

- Built-in Claude integration
- Use SaaSFoundry CLI via terminal

### Other IDEs

- Use external terminal with Claude Code
- No special integration needed

## Docker (Development)

SaaSFoundry includes Docker Compose for development services:

```bash
# Start PostgreSQL (in-memory for speed)
npm run db:dev

# Or manually
docker-compose -f docker-compose.db.yml up -d
```

**Why Docker for dev?**

- ✅ Consistent environment across team
- ✅ No need to install PostgreSQL locally
- ✅ tmpfs (in-memory) for fast I/O
- ✅ Easy cleanup (`docker-compose down`)

## Troubleshooting

### Claude Code not found

```bash
# Verify installation
claude --version

# If not found, reinstall
npm install -g @anthropic-ai/claude-code
```

### cmux not available

cmux is macOS only. For other platforms:

- Use tmux (Linux/macOS)
- Use Windows Terminal (Windows)
- Use separate terminal tabs/windows

### Node version issues

```bash
# Check version
node --version

# Should be >= 20.19.0
# If not, use nvm to upgrade
nvm install 20
nvm use 20
```

## Next Steps

- [Quick Start](/getting-started/quick-start) - Create your first project
- [Skills System](/guide/skills-system) - Learn Claude-powered skills
- [Workflow System](/guide/workflow-system) - AI-assisted project management

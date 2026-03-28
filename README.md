<div align="center">

[![Open Source](https://img.shields.io/badge/Open%20Source-2D3748?style=for-the-badge&logo=github&logoColor=white)](https://github.com/DiamondForgeFr/SaaSFoundry)
[![License](https://img.shields.io/badge/License-MIT-2D3748?style=for-the-badge&logo=opensourceinitiative&logoColor=white)](LICENSE)
[![npm version](https://img.shields.io/npm/v/saasfoundry-cli?style=for-the-badge&logo=npm&label=CLI&color=CB3837)](https://www.npmjs.com/package/saasfoundry-cli)
[![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://reactjs.org/)
[![NestJS](https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white)](https://nestjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-2D3748?style=for-the-badge&logo=prisma&logoColor=white)](https://www.prisma.io/)
[![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)

</div>

<div align="center">
  <br /><br />
  <img src="https://raw.githubusercontent.com/DiamondForgeFr/SaaSFoundry/refs/heads/master/docs/assets/logo.png" alt="SaaSFoundry Logo" width="300"/>
  <br /><br />
</div>

# 🌟 What is SaaSFoundry?

SaaSFoundry is a comprehensive, production-ready CLI for building modern SaaS applications. Far beyond a simple boilerplate, it's a complete ecosystem with modular architecture, automated workflows,
and integrated best practices. This open-source project provides a robust foundation for startups, freelancers, and developers looking to create scalable, secure, and maintainable SaaS solutions with
TypeScript full-stack development.

### 🎯 Key Features

- **Full-Stack Development Platform**

  - [NestJS 11 Backend](scaffolds/blueprints/api/README.md) with modular design
  - [React 19 Frontend](scaffolds/blueprints/web/README.md) with React Router v7
  - Monorepo or Multi-repo architecture support
  - Docker containerization with multi-stage builds
  - Automated deployment workflows
  - CLI-based project configuration and scaffolding (`sf new`, `sf update`)
  - End-to-end testing infrastructure with Playwright

- **Modular Architecture**

  - **Email Service** - MailerSend integration for transactional emails
  - **S3 Storage** - AWS S3 integration for file uploads and management
  - **Analytics** - Umami analytics integration for privacy-focused tracking
  - Install modules during project creation OR add them later with `sf update`
  - Three-way merge system for safe template updates

- **Security First**

  - JWT authentication with Passport
  - Role-based access control (RBAC)
  - Granular permissions management
  - Secure API endpoints with Zod validation

- **Developer Experience**

  - Pre-built React hooks for API integration
  - React Query for data fetching and caching
  - Comprehensive Git hooks with Husky (commitlint, pre-push checks)
  - Prisma 7 with driver adapters and multi-file schemas
  - Path aliases and optimized imports
  - i18next for internationalization

- **Production Ready**
  - Version management with automated tagging
  - GitHub Actions deployment pipeline
  - Health monitoring endpoints
  - Winston logging with daily rotation
  - PostgreSQL 16 with Docker support
  - Nginx reverse proxy configuration
  - Automated OpenAPI documentation generation

## 🔧 Prerequisites

To fully leverage SaaSFoundry's capabilities, the following tools are strongly recommended:

### 🐳 Docker

Docker is essential for running databases, tests, and containerized deployments:

```bash
# Install Docker on macOS (using Homebrew)
brew install --cask docker

# Install Docker on Ubuntu
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Verify installation
docker --version
```

### 📊 Node Version Manager (NVM)

NVM enables seamless switching between Node.js versions:

```bash
# Install NVM
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.3/install.sh | bash

#  Auto-switch node version based on .nvmrc (add to your .zshrc or .bashrc)
autoload -U add-zsh-hook
load-nvmrc() {
  local node_version="$(nvm version)"
  local nvmrc_path="$(nvm_find_nvmrc)"

  if [ -n "$nvmrc_path" ]; then
    local nvmrc_node_version=$(nvm version "$(cat "${nvmrc_path}")")

    if [ "$nvmrc_node_version" = "N/A" ]; then
      nvm install
    elif [ "$nvmrc_node_version" != "$node_version" ]; then
      nvm use
    fi
  fi
}
add-zsh-hook chpwd load-nvmrc
load-nvmrcexport PATH="$HOME/.local/bin:$PATH"
```

### 🌈 Peacock (Optional)

Peacock is a Visual Studio Code extension that helps identify and distinguish projects by colorizing your workspace:

```bash
# For VS Code
# Install from VS Code marketplace: "johnpapa.vscode-peacock"

# For other compatible IDEs (like Cursor)
# Check the respective marketplace for Peacock or similar workspace colorizing extensions
```

This extension is particularly useful when working with multiple repositories simultaneously, offering visual differentiation between frontend and backend workspaces.

After installing these tools, you'll be ready to fully utilize all SaaSFoundry features, including containerized development environments and proper Node.js version management across projects.

## 🚀 Quick Start

### Creating a New Project

```bash
# Execute directly (no global install needed)
npx saasfoundry-cli@beta new

# OR install the CLI globally
npm install -g saasfoundry-cli@beta
sf new       # or: saasfoundry new
```

The CLI will guide you through:

- **Project structure** - Monorepo (default) or Multi-repo
- **Database setup** - Docker (recommended), Manual, or AWS RDS credentials
- **Optional modules**:
  - Email service (MailerSend)
  - S3 Storage (AWS S3)
  - Analytics (Umami)

### Adding Modules to Existing Projects

```bash
# Add modules to an existing SaaSFoundry project
cd your-project
sf update

# The CLI will:
# 1. Detect installed modules from .saasfoundry.json
# 2. Show available modules to install
# 3. Safely merge updates using three-way comparison
# 4. Update dependencies and environment files
```

### Getting Started

- [Backend Documentation](scaffolds/blueprints/api/README.md)
- [Frontend Documentation](scaffolds/blueprints/web/README.md)

Each component has its own README with specific instructions and best practices.

## 🛠️ Project Structure

### 🏗️ Architecture Options

<div align="center">
<table>
<tr>
<th>
<h3>📦 Monorepo (Default)</h3>
<p><i>Recommended for most projects</i></p>
</th>
</tr>
<tr>
<td>

```
yourproject/
├── 📂 apps/
│   ├── 📂 api/              # NestJS Backend
│   │   ├── 🔵 src/
│   │   │   ├── common/      # filters, services
│   │   │   ├── configs/     # db, env, test
│   │   │   └── modules/     # features
│   │   ├── 🔵 docs/         # Generated API documentation
│   │   ├── 🔵 prisma/
│   │   ├── 🔵 scripts/      # db, tag manager, test init
│   │   └── 🔵 tests/
│   │
│   └── 📂 web/              # React Frontend
│       ├── 🟠 src/
│       │   ├── components   # layout, nav, ui (shadcn, custom)
│       │   ├── pages        # private / public
│       │   ├── locales      # auth.yml, common.yml...
│       │   ├── hooks        # api / ui / ...
│       │   └── router       # guard, routes, lazy-pages...
│       ├── 🟠 public/
│       └── 🟠 tests/
│
├── 📂 infra/
│   ├── dev-services/        # Docker compose
│   ├── db/                  # Database
│   └── s3/                  # MinIO (optional)
│
├── .saasfoundry.json        # Manifest
├── turbo.json               # Monorepo config
└── package.json
```

</td>
</tr>
</table>
</div>

> **💡 Tip**: Monorepo provides shared tooling and simplified dependency management with Turborepo.

<div align="center">
<table>
<tr>
<th>
<h3>🔀 Multi-repository</h3>
<p><i>For separate deployments</i></p>
</th>
</tr>
<tr>
<td>

```
📂 apps/
├── 📂 yourproject-api/      # NestJS Backend API
│   ├── 🔵 src/
│   │   ├── common/          # filters, services...
│   │   ├── configs/         # Api docs, db, env, test...
│   │   └── modules/         # controllers, services, tests...
│   ├── 🔵 docs/             # Generated API documentation
│   ├── 🔵 logs/             # API logs
│   ├── 🔵 scripts/          # db, tag manager, test init
│   ├── 🔵 prisma/
│   ├── 🔵 tests/
│   ├── 🔵 docker-compose.yml  # Production deployment
│   ├── 🔵 docker-compose.dev-services.yml  # Local dev (DB + S3)
│   └── .saasfoundry.json    # Manifest
│
└── 📂 yourproject-web/      # React Frontend
    ├── 🟠 src/
    │   ├── components       # layout, nav, ui (shadcn, custom)
    │   ├── pages            # private / public
    │   ├── locales          # auth.yml, common.yml...
    │   ├── router           # guard, routes, lazy-pages...
    │   ├── hooks            # api / ui / ...
    │   └── utils
    ├── 🟠 public/
    ├── 🟠 scripts/          # tag manager
    ├── 🟠 tests/
    └── .saasfoundry.json    # Manifest
```

</td>
</tr>
</table>
</div>

> **💡 Tip**: Multi-repo allows independent deployment cycles and version control. Dev services (DB, S3) are embedded in the API via `docker-compose.dev-services.yml` for easy local development.

## 🧩 Optional Modules

SaaSFoundry includes optional modules that can be added during project creation or later with `sf update`:

### 📧 Email Service (MailerSend)

- Transactional email integration
- Pre-configured templates for auth flows (verification, password reset, invitations)
- Easy-to-use service layer in NestJS
- Test mode for development

### 📦 S3 Storage (AWS S3)

- File upload and management
- Organization logo uploads (multi-tenancy ready)
- Pre-built API endpoints and React hooks
- Works with AWS S3 or MinIO (local development)

### 📊 Analytics (Umami)

- Privacy-focused analytics
- Self-hosted or cloud options
- Pre-integrated in React app
- GDPR compliant

### 🔄 Update System

The CLI tracks your project with a `.saasfoundry.json` manifest:

```json
{
  "version": "1.0.0-beta",
  "structure": "monorepo",
  "modules": {
    "emailService": "mailersend",
    "s3Setup": "docker",
    "includeAnalytics": true
  },
  "fileHashes": { ... }
}
```

When running `sf update`:

1. **Detects** installed modules and CLI version
2. **Regenerates** project structure in temp directory
3. **Compares** three versions (base, current, target)
4. **Merges** changes safely:
   - Unchanged user files → preserved
   - Unchanged template, modified locally → kept as-is
   - Changed template, unchanged locally → auto-updated
   - Both changed → conflict saved as `.saasfoundry.new`

This ensures your customizations are never lost during updates.

## 💡 Why SaaSFoundry?

### For Startups

- **Time to Market**: Start with a production-grade development platform
- **Scalability**: Built for growth from day one
- **Cost-Effective**: Open-source ecosystem with no licensing fees

### For Freelancers

- **Professional Grade**: Enterprise-level architecture
- **Flexibility**: Adapt to any business requirement
- **Maintainability**: Well-structured, documented codebase

### For Developers

- **Best Practices**: Built-in industry standards and workflows
- **Developer Experience**: Streamlined development with integrated tools
- **Community**: Open-source collaboration and ecosystem

## 🤖 AI-First Development

SaaSFoundry is designed as a **hybrid development platform** that combines professional-grade tooling with AI-assisted workflows. Generated projects come pre-configured for both traditional team
development and AI-powered coding with Claude Code.

### ✨ Built for Claude Code

Every SaaSFoundry project includes:

#### 📝 CLAUDE.md Context Files

- **Project-specific context** for immediate AI understanding
- **Architecture documentation** with tech stack, conventions, and patterns
- **Module system documentation** for dynamic feature installation
- **Git workflow guidelines** with conventional commits and branching strategy

#### 🛠️ Pre-configured Development Environment

- **Path aliases** optimized for AI code generation
- **Validation schemas** (Zod) for type-safe AI-generated code
- **Modular structure** that AI can navigate and extend easily
- **Consistent naming conventions** across backend and frontend

#### 🔄 Professional Workflows + AI

- **Git hooks** (Husky) enforce code quality on AI-generated commits
- **Automated tests** validate AI changes (unit, E2E, integration)
- **CI/CD pipelines** run checks on every AI-assisted PR
- **Type safety** (TypeScript + Prisma) catches AI mistakes early
- **ESLint + Prettier** auto-format AI-generated code

### 🎯 Claude Code Skills System

SaaSFoundry projects come with a comprehensive **skills library** that enhances AI capabilities with specialized workflows and integrations.

#### 📦 Core Skills (Always Installed)

**Git Workflows:**

- **`sf-git-commit`** - Create commits with conventional commit messages
- **`sf-git-create-pr`** - Generate PR with auto-generated title and description
- **`sf-git-fix-pr-comments`** - Automatically implement PR review feedback
- **`sf-git-merge`** - Intelligent branch merging with conflict resolution

**Code Quality:**

- **`sf-utils-fix-errors`** - Fix all ESLint and TypeScript errors in parallel
- **`sf-utils-fix-grammar`** - Fix grammar and spelling while preserving formatting

**Development Workflows:**

- **`sf-utils-oneshot`** - Ultra-fast feature implementation (Explore → Code → Test)
- **`sf-workflow-apex`** - APEX methodology with adversarial review _(API only)_
- **`sf-workflow-apex-free`** - APEX methodology (Analyze-Plan-Execute-Validate) _(API only)_

#### 🚀 Advanced Skills (Optional - Requires Configuration)

These skills integrate with external services and require API tokens:

**Documentation & Research:**

- **`sf-tool-context7`** - Fetch up-to-date library documentation (React, Vite, Prisma, etc.)
  - Prevents hallucinated APIs and deprecated patterns
  - Real-time access to latest framework docs

**Project Management:**

- **`sf-tool-atlassian`** - Jira/Confluence integration

  - Create tickets, update status, sync documentation
  - Track AI-generated features in your workflow

- **`sf-tool-notion`** - Notion workspace integration
  - Create pages, databases, and views
  - Document architecture decisions and feature specs

**Design Integration:**

- **`sf-tool-figma`** - Figma design system integration
  - Read designs and components
  - Generate code from Figma mockups
  - Maintain design-code consistency

#### ⚙️ Skills Configuration

**During project creation (`sf new`):**

```bash
sf new
# ... project setup questions ...

📚 Advanced Skills (Optional)
? Select advanced skills to install
  ◯ Context7 - Up-to-date library documentation
  ◯ Atlassian - Jira/Confluence integration
  ◯ Notion - Notion workspace integration
  ◯ Figma - Figma design system integration

# For each selected skill, browser opens to generate API token
# You can skip and configure later when Claude prompts you
```

**Adding skills later (`sf update`):**

```bash
sf update

# Detects available skills not yet installed
? Which modules would you like to add?
  ◯ Advanced Skill: Context7
  ◉ Advanced Skill: Notion
  ◯ Advanced Skill: Figma

# Prompts for credentials only for newly selected skills
```

#### 🔐 Credential Management

- Each skill stores credentials in its own `.env` file (`.claude/skills-optional/tool-{name}/.env`)
- Credentials are **never** committed to git (`.gitignore` protected)
- No global config - skills are project-scoped
- When Claude needs a skill without credentials, it prompts you to configure it

### 🚀 Quick Start for AI Development

#### 1. **Connect Claude Code**

```bash
# After generating your project
cd your-project
code .  # or cursor .

# Claude Code will automatically load CLAUDE.md
# You can start asking questions immediately
```

#### 2. **Common AI Development Commands**

```bash
# Add a new module
"Add email service with MailerSend"

# Implement features
"Create a new user profile endpoint with avatar upload"
"Use oneshot to implement dark mode toggle"

# Fix and improve
"Fix all TypeScript errors"  # Triggers utils-fix-errors skill
"Add validation to the login form"

# Git workflows
"Commit these changes"  # Triggers git-commit skill
"Create a PR for this feature"  # Triggers git-create-pr skill

# Advanced skills (if configured)
"Get the latest React Router v7 documentation"  # Uses tool-context7
"Create a Jira ticket for this bug"  # Uses tool-atlassian
"Generate code from this Figma design"  # Uses tool-figma
```

#### 3. **AI-Assisted Workflows**

**Feature Development:**

1. Ask Claude to implement the feature
2. AI generates code following project conventions
3. Git hooks validate commit message format
4. Pre-push hooks run tests automatically
5. CI/CD validates the changes
6. Claude can create the PR with proper description

**Code Review:**

1. Claude reads PR comments from GitHub
2. Implements requested changes
3. Runs tests to validate fixes
4. Updates PR with new commits

### 🎯 Best Practices

#### ✅ DO

- **Use CLAUDE.md** - Keep it updated with project decisions
- **Leverage skills** - Core skills are always available, configure advanced skills as needed
- **Trust the guards** - Let tests and CI/CD catch issues
- **Iterate with AI** - Use AI for rapid prototyping, then refine
- **Review AI code** - Especially for security-sensitive areas
- **Configure Context7** - Avoid hallucinated APIs with up-to-date library docs

#### ❌ DON'T

- **Skip tests** - AI-generated code must pass all tests
- **Bypass hooks** - Don't use `--no-verify` on AI commits
- **Ignore types** - TypeScript errors indicate AI misunderstandings
- **Over-rely** - Review critical business logic carefully
- **Forget context** - Update CLAUDE.md when architecture changes

### 📚 AI + Traditional Dev Harmony

SaaSFoundry ensures AI assistance **enhances** rather than replaces professional practices:

| Traditional Practice | AI Enhancement                                        |
| -------------------- | ----------------------------------------------------- |
| Code reviews         | AI implements PR feedback automatically               |
| Testing              | AI generates test cases, humans verify coverage       |
| Documentation        | AI drafts docs, humans ensure accuracy                |
| Refactoring          | AI suggests improvements, humans approve              |
| Debugging            | AI identifies patterns, humans understand root causes |

### 🔐 Security & Quality

All AI-generated code passes through:

- **Zod validation** - Runtime type checking
- **ESLint rules** - Code quality standards
- **Unit tests** - Business logic verification
- **E2E tests** - User flow validation
- **TypeScript** - Compile-time type safety
- **Git hooks** - Pre-commit and pre-push checks
- **CI/CD** - Automated deployment validation

### 📖 Learning Path

1. **Start small** - Use AI for simple features first
2. **Understand patterns** - Learn from AI-generated code
3. **Customize CLAUDE.md** - Add project-specific context
4. **Create skills** - Build custom AI workflows
5. **Share learnings** - Document successful AI patterns

---

**Ready to build with AI?** Generated projects include everything you need to start coding with Claude immediately - no setup required.

## 🤝 Contributing

We welcome contributions! Whether you're fixing bugs, improving documentation, or adding new features, your help is appreciated.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Commit Message Guidelines

We follow conventional commits for better versioning and changelog generation. While you can bypass checks with `--no-verify`, we encourage following these guidelines:

- `feat:` New features
- `fix:` Bug fixes
- `docs:` Documentation changes
- `style:` Code style changes
- `refactor:` Code refactoring
- `test:` Adding tests
- `chore:` Maintenance tasks

## 📚 Documentation

Detailed documentation is available at [saasfoundry.diamondforge.fr](https://saasfoundry.diamondforge.fr) (coming soon).

📦 Available on npm: [saasfoundry-cli](https://www.npmjs.com/package/saasfoundry-cli)

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built as a complete SaaS acceleration platform
- Powered by [NestJS](https://nestjs.com) and [React](https://reactjs.org)
- Supported by the open-source community

---

<div align="center">
  Made with ❤️ by the SaaSFoundry Team
</div>

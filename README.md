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

SaaSFoundry is a comprehensive, production-ready CLI for building modern SaaS applications. Far beyond a simple boilerplate, it's a complete ecosystem with modular architecture, automated
workflows, and integrated best practices. This open-source project provides a robust foundation for startups, freelancers, and developers looking to create scalable, secure,
and maintainable SaaS solutions with TypeScript full-stack development.

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
│   └── 🔵 docker-compose.yml
│
├── 📂 yourproject-db/       # PSQL database
│   └── 🟢 docker-compose.db.yml
│
├── 📂 yourproject-s3/       # S3 storage (optional)
│   └── 🟡 docker-compose.s3.yml
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
    ├── 🟠 tests/
    └── .saasfoundry.json
```

</td>
</tr>
</table>
</div>

> **💡 Tip**: Multi-repo allows independent deployment cycles and version control for each component.

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

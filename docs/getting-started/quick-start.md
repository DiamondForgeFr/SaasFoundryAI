# Quick Start

Get up and running with SaaSFoundryAI in 5 minutes — with an assistant, or from the terminal.

## Create a project with your AI assistant

> Install the SaaSFoundryAI skill from https://github.com/DiamondForgeFr/SaasFoundryAI

Hand that line to your assistant, move into the folder you want to work in, and say what you want in your own words:

> _"I want a SaaS with a client portal, file uploads and transactional email."_

The skill asks only what it cannot infer from that, then runs a single non-interactive `sf new …` for you — you never see the prompts below. Setup details are in
[Installation](/getting-started/installation).

## Create a project from the terminal

Prefer to drive it yourself? Every answer the assistant would have gathered is a prompt in the CLI:

```bash
sf new
```

Answer the interactive prompts:

1. **Project name**: `my-saas-app`
2. **Project structure**: Monorepo (recommended)
3. **Email service**: Choose MailerSend or none
4. **S3 storage**: Choose manual, Docker, or credentials
5. **Database**: Choose Docker (easiest for development)
6. **Analytics**: Include Umami analytics (optional)

## Start Development

```bash
cd my-saas-app
npm install
npm run dev
```

Your app will be running at:

- API: http://localhost:3000
- Web: http://localhost:5173

## What's Next?

- [Installation](/getting-started/installation) - The assistant path in full, plus the CLI install
- [First Project](/getting-started/first-project) - Detailed walkthrough
- [Project Structure](/guide/project-structure) - Understand the codebase
- [CLI Commands](/cli/sf-new) - Learn all available commands

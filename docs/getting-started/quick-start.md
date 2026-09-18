# Quick Start

Get up and running with SaaSFoundryAI in 5 minutes — with an assistant, or from the terminal.

## Create a project with your AI assistant

> Install the SaaSFoundryAI skill from https://github.com/DiamondForgeFr/SaasFoundryAI

The one-line user-scope bootstrap currently targets Claude Code. Hand it to Claude from the folder you want to work in and say what you want in your own words:

> _"I want a SaaS with a client portal, file uploads and transactional email."_

The skill asks only what it cannot infer from that, then runs a single non-interactive `sf new …` for you. With another coding-agent host, use the terminal path once and select its registered profile.
The three supported starting situations are explained in [Installation](/getting-started/installation).

## Create a project from the terminal

Prefer to drive it yourself? Every answer the assistant would have gathered is a prompt in the CLI:

```bash
sf new
```

Answer the interactive prompts:

1. **Installation profile**: Full for a new product; Harness for an existing repository you keep
2. **Coding-agent profiles**: Select one or several tools that will work in the project
3. **Project name**: `my-saas-app`
4. **Project structure**: Monorepo (recommended)
5. **Email service**: Choose MailerSend or none
6. **S3 storage**: Choose manual, Docker, or credentials
7. **Database**: Choose Docker (easiest for development)
8. **Analytics**: Include Umami analytics (optional)

## Start Development

```bash
cd my-saas-app
npm install
npm run dev
```

Your app will be running at:

- API: http://localhost:3500
- Web: http://localhost:5173

Verify the installed agent declaration:

```bash
sf agents list
sf agents doctor <profile-id>
```

## What's Next?

- [Installation](/getting-started/installation) - The assistant path in full, plus the CLI install
- [First Project](/getting-started/first-project) - Detailed walkthrough
- [Project Structure](/guide/project-structure) - Understand the codebase
- [CLI Commands](/cli/sf-new) - Learn all available commands

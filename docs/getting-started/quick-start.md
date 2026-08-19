# Quick Start

Get up and running with SaaSFoundryAI in 5 minutes.

## Create a Project

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

- [First Project](/getting-started/first-project) - Detailed walkthrough
- [Project Structure](/guide/project-structure) - Understand the codebase
- [CLI Commands](/cli/sf-new) - Learn all available commands

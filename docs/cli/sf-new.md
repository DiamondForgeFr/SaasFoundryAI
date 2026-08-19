# sf new

Create a new SaaSFoundryAI project with interactive prompts, or scripted scaffolding via flags.

## Usage

```bash
sf new [options]
```

## Options

| Flag                                           | Description                                                     | Default |
| ---------------------------------------------- | --------------------------------------------------------------- | ------- |
| `--non-interactive`                            | Fail if any required value is missing instead of prompting      | -       |
| `--project-name <name>`                        | Project name (kebab-case)                                       | -       |
| `--project-description <description>`          | Project description                                             | -       |
| `--structure <structure>`                      | Project structure: `monorepo` or `multirepo`                    | -       |
| `--main-branch <branch>`                       | Main branch name: `main` or `master`                            | -       |
| `--setup-repo <setup>`                         | Repository setup: `local` or `existing`                         | -       |
| `--monorepo-url <url>`                         | Monorepo remote URL (monorepo + existing)                       | -       |
| `--backend-repo-url <url>`                     | Backend repo URL (multirepo + existing)                         | -       |
| `--frontend-repo-url <url>`                    | Frontend repo URL (multirepo + existing)                        | -       |
| `--db-setup <setup>`                           | Database: `docker`, `credentials`, or `manual`                  | -       |
| `--db-type <type>`                             | Database type: `postgresql` or `sql`                            | -       |
| `--email-service <service>`                    | Email service: `none` or `mailersend`                           | -       |
| `--s3-setup <setup>`                           | S3 storage: `docker`, `credentials`, or `manual`                | -       |
| `--analytics / --no-analytics`                 | Include (or skip) the analytics module                          | -       |
| `--advanced-skills <skills>`                   | Comma-separated: `context7,atlassian,notion,figma`              | -       |
| `--srs-enable / --no-srs-enable`               | Enable the [SRS module](/modules/srs) (pluggable spec system)   | -       |
| `--srs-backend <backend>`                      | SRS backend: `notion` (Confluence + local-markdown on roadmap)  | -       |
| `--srs-parent-page-input <url>`                | SRS root page URL (or ID) on the chosen backend                 | -       |
| `--srs-ingest-enable / --no-srs-ingest-enable` | Ingest existing notes on first open (one-shot)                  | -       |
| `--srs-ingest-parent-input <url>`              | Source parent page for ingestion (URL or ID)                    | -       |
| `--workflow <config> / --no-workflow`          | Workflow preset, `none`, or skip workflow entirely              | -       |
| `--start-services / --no-start-services`       | Auto-start dev services (DB + MinIO) after setup                | -       |
| `--start-apps <mode>`                          | Apps to start after setup: `all`, `backend`, `frontend`, `none` | -       |

## Examples

```bash
# Interactive wizard
sf new
```

```bash
# Scripted scaffold (monorepo, postgres via docker, no analytics)
sf new --non-interactive \
  --project-name my-saas \
  --structure monorepo \
  --setup-repo local \
  --db-setup docker \
  --db-type postgresql \
  --email-service none \
  --no-analytics \
  --start-services --start-apps all
```

```bash
# With SRS enabled (Notion backend, empty SRS root)
sf new --non-interactive \
  --project-name my-saas \
  --structure monorepo \
  --setup-repo local \
  --db-setup docker --db-type postgresql \
  --email-service none --no-analytics \
  --advanced-skills notion \
  --srs-enable \
  --srs-backend notion \
  --srs-parent-page-input "https://www.notion.so/your-workspace/SRS-root-abc123"
```

## Notes

See `sf new --help` for the full flag surface (database credentials, MailerSend keys, S3 credentials, Atlassian/Notion/Figma tokens). Most flags are only validated when the relevant module is enabled.

## See Also

- [CLI Commands](/cli/sf-new)
- [Getting Started](/getting-started/quick-start)

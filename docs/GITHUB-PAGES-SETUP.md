# Publishing the documentation

GitHub Pages is configured for this repository with **GitHub Actions** as its source. The `Deploy Documentation` workflow builds both languages and publishes the static site at
`https://diamondforgefr.github.io/SaasFoundryAI/`.

## Publish a validated revision

1. Merge the documentation change into `develop` through its reviewed pull request.
2. Open **Actions → Deploy Documentation → Run workflow** and select `develop`.
3. Wait for both the `build` and `deploy` jobs to succeed.
4. Check the [English home](https://diamondforgefr.github.io/SaasFoundryAI/), [French home](https://diamondforgefr.github.io/SaasFoundryAI/fr/), and an installation guide in each language.

The `github-pages` environment currently permits deployments **only from `develop`**. A feature branch can build successfully but its deploy job will be rejected by that protection rule. Do not weaken
the rule just to preview a pull request; use `npm run docs:dev` or `npm run docs:preview` for review instead.

The workflow is intentionally manual while the first publication and review are completed. If publication should later follow merges automatically, add a `push` trigger for the chosen publishing
branch in `.github/workflows/deploy-docs.yml` and review the branch policy together. Avoid triggering from both `develop` and `master`: an older push could replace newer documentation.

## Read it locally

```bash
npm run docs:dev     # http://localhost:5176
npm run docs:build   # static output in docs-dist
npm run docs:preview
```

The dev server uses **5176** so a generated project's web app can use 5173 at the same time. The CLI also bundles this documentation: `sf docs` serves it offline from the root of a local server.

## Base path

The Pages workflow gets the correct base path from `actions/configure-pages`. For the repository site it builds with `/SaasFoundryAI/` (respect the repository's casing). Local and packaged builds
default to `/`. If a custom domain is configured later, the action supplies `/` without a source edit. The favicon, canonical links and locale alternates use the same base.

To reproduce the repository-site build locally:

```bash
SF_DOCS_BASE=/SaasFoundryAI/ npm run docs:build
```

## Custom domain later

1. Point the chosen subdomain's DNS `CNAME` to `diamondforgefr.github.io`.
2. Enter that domain under **Settings → Pages → Custom domain**, verify DNS, and enable HTTPS.
3. Keep a matching `CNAME` file in `docs/public/` if required by the Pages deployment configuration, then verify another workflow run and all links.

Do not announce a placeholder hostname before it is registered and configured.

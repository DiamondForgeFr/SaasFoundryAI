# Publishing the documentation

## Where it stands today

**The site has never been deployed.** It builds — `npm run docs:build` completes in a few seconds — but nothing has ever published it, and three things had to be true before anything could:

|                    |                                                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| GitHub Pages       | **not enabled** on this repository — `gh api repos/DiamondForgeFr/SaasFoundryAI/pages` returns 404          |
| the base path      | said `/SaaSFoundryAI/` while the repository is `SaasFoundryAI` — fixed, see below                           |
| the deploy trigger | fired on `master` and on `v*`, so the v1 cut would have run a deploy that could only fail — now manual only |

The near-term answer for users is **not** this site: the built documentation ships inside the npm package and `sf docs` opens it with no network (#626). Publishing online comes after.

## Read it locally

```bash
npm run docs:dev     # http://localhost:5176
npm run docs:build   # static output in docs/.vitepress/dist
npm run docs:preview
```

The dev server runs on **5176**, set in `docs/.vitepress/config.mts`. That is deliberate: 5173 is the port a _generated project's_ web app uses, and the two should be able to run side by side.

## Turning publication on

1. Repository **Settings** → **Pages** → **Source** → **GitHub Actions**. This is manual and owner-only; no workflow can do it.
2. Run `Deploy Documentation` once from the Actions tab (`workflow_dispatch`) and confirm it succeeds.
3. Only then, restore the `push` trigger in `.github/workflows/deploy-docs.yml` — the commented block is right there — so the cut publishes the docs along with the release.

## The base path, and why it is `/`

`base` is `/` rather than a repository subpath. That serves the two things this documentation is actually for: the copy bundled in the npm package, served from the root of a local static server, and a
custom domain later.

**A `github.io/<repo>/` project site is the one shape that would need a subpath back.** If that becomes the plan, set `base: '/SaasFoundryAI/'` — note the casing, which is `SaasFoundryAI`, not
`SaaSFoundryAI` — and fix the favicon `href` in the same file, which carries the same prefix.

## Custom domain

1. Configure DNS:

   ```
   CNAME: docs.example.com → diamondforgefr.github.io
   ```

2. **Settings** → **Pages** → **Custom domain**, enter the domain, and check **Enforce HTTPS**.
3. Add a `CNAME` file to `docs/public/` holding the domain, or GitHub drops the setting on the next deploy.

With a custom domain, `base: '/'` is already correct and needs no change.

> The CLI has printed `https://docs.saasfoundry.io (coming soon)` since before any of this existed. That name is not registered or configured anywhere — pick the domain deliberately when publication
> actually happens, rather than inheriting it from a placeholder.

# GitHub Pages Setup

## Enable GitHub Pages

To enable automatic documentation deployment:

1. Go to repository **Settings** → **Pages**
2. Under **Source**, select **GitHub Actions**
3. Save

That's it! The documentation will automatically deploy on:

- Every push to `master` branch
- Every version tag (`v*`)
- Manual workflow trigger

## URLs

- **Production**: https://diamondforgefr.github.io/SaaSFoundryAI/
- **Local dev**: http://localhost:5173 (run `npm run docs:dev`)

## Custom Domain (Optional)

To use a custom domain like `docs.saasfoundry.dev`:

1. Buy domain and configure DNS:

   ```
   CNAME: docs.saasfoundry.dev → diamondforgefr.github.io
   ```

2. In repository **Settings** → **Pages** → **Custom domain**, enter:

   ```
   docs.saasfoundry.dev
   ```

3. Check **Enforce HTTPS**

GitHub will automatically generate SSL certificates via Let's Encrypt.

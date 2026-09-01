# sf docs

Open the SaaSFoundryAI documentation, served from your own installation. No network needed.

The documentation you are reading travels inside the npm package. `sf docs` starts a small local server on a free port and opens it — on a plane, behind a corporate proxy, or before any site has been
published anywhere.

## Usage

```bash
sf docs [--port <port>] [--no-open]
```

## Options

| Flag            | Description                             | Default              |
| --------------- | --------------------------------------- | -------------------- |
| `--port <port>` | Serve on a specific port                | first free from 5177 |
| `--no-open`     | Print the URL without opening a browser | opens                |

## What it prints

```
  📚 SaaSFoundryAI documentation  v1.0.0

     served from this installation — no network needed

     http://localhost:5177

     Ctrl+C to stop
```

The version is the CLI's own. That matters more than it looks: it tells you whether you are reading the documentation for the version you are running, or for a different one you happen to have
installed elsewhere.

## Why it is local

Every `npx saasfoundryai-cli …` line in these pages used to sit beside a link to a site that had never been deployed. Someone who installed the CLI got no documentation at all — the published package
carried `dist`, `bin` and `scaffolds`, and the built site was not among them.

Shipping it inside the package makes the documentation exist for anyone who has the CLI, and makes it **impossible for a release to carry documentation older than itself**: the site is rebuilt as part
of packing, not as a step someone has to remember.

An online copy will come later. This is not a stopgap for it — a local copy stays useful once the site exists, because it is the one that always matches the binary in front of you.

## Ports

It takes the first free port from 5177, so two of them can run side by side, and neither collides with a generated project's web app (5173) nor with the documentation dev server used by contributors
(5176).

## See also

- [`sf status`](/cli/sf-status) — what this project is and whether it can run
- [`sf resume`](/cli/sf-resume) — finish a setup that stopped one step short

# sf resume

Finish a setup that stopped one step short.

`sf new` writes every file, then runs the post-setup steps: install dependencies, start the dev services, apply the database schema, generate the ORM client. When one of those fails, the project on
disk is complete minus one step — and finishing it by hand meant three commands, one needing a Docker network name derived from the project, another a path that depends on the topology. `sf` knew all
of that; it ran them the first time.

## Usage

```bash
sf resume [--dry-run]
```

Run it from the project root — the directory holding `.saasfoundry.json`.

## Options

| Flag        | Description                           | Default |
| ----------- | ------------------------------------- | ------- |
| `--dry-run` | Report what would run, change nothing | -       |

## What it does

| Step             | What it checks                                                                          |
| ---------------- | --------------------------------------------------------------------------------------- |
| `dependencies`   | Installs only what is missing — the root workspace in a monorepo, api and web otherwise |
| `dev services`   | Starts the database container, unless something already answers on its port             |
| `storage`        | Starts the MinIO containers, unless the console port already answers                    |
| `database setup` | Applies the schema, SQL functions, triggers and datasets                                |
| `ORM client`     | Regenerates the Prisma client                                                           |

Every step that does nothing **says why**. A step that goes quiet is indistinguishable from one that ran.

::: danger It will never reset a database that holds data

`db:setup:dev` is `prisma db push --force-reset`. "Finish the setup" must never mean "reset the database you have been working in", so the destructive step is refused outright when the database
already holds tables — and refused as well when the table count cannot be read at all. An unreadable database is not an empty one.

:::

## Idempotent by design

Running it on a healthy project is safe and does nothing. `docker compose up -d` succeeds on a container that is already running, so starting unconditionally would report work where none was needed —
and "nothing to finish" is the answer this command owes a project that is already fine.

Storage is checked independently from the database: a MinIO that will not start is no reason to leave the schema unapplied, which is why `sf new` starts the two separately too.

## Examples

```bash
# See what it would do, change nothing
sf resume --dry-run
```

```bash
# Finish the setup
sf resume
```

Typical output on a project whose storage never came up:

```
🔧 Finishing the setup of "my-app"

  · dependencies      already installed
  · dev services      already answering on 5436
  ✓ storage           storage containers up
  · database setup    already set up
  · ORM client        already generated
```

## When you will be told to run it

`sf new` prints it. When a post-setup step fails, the closing screen names the step, gives the command that finishes that one step, and points at `sf resume` for all of them at once.

## See also

- [`sf status`](/cli/sf-status) — report whether the project can actually run, without changing anything
- [`sf new`](/cli/sf-new) — create the project in the first place

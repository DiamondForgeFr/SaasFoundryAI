# Published beta fixture

This directory contains one immutable, source-only project generated from the published `saasfoundry-cli@1.0.0-beta` npm artifact. It is deliberately a **multirepo** fixture. The published prompt
disabled its monorepo choice, so no authentic beta monorepo fixture exists.

## Provenance

The source npm tarball is pinned by all available registry identities:

- package: `saasfoundry-cli@1.0.0-beta`
- integrity: `sha512-DDUIM7+rPrtsOCwZVjasSiUlEG7cmTelxMN0wxT0JEUffWXmwSl4mdccVdVw574RoFxydBBEn0yYto3Dtfs34A==`
- shasum: `4dd553bf5c026dfc7502e3d54f8bbc53746b6cf8`
- git head: `1a682d7ecfa76edcc20af0604da962b06a9c92a7`
- tarball SHA-256: `b1abb454495a6a0732f3187beb94298a2c3c79d5f98c376949c577736a1c633b`

`multirepo.fixture.json.gz` is a gzip-compressed JSON document. It stores only regular files with canonical relative POSIX paths, mode `0644` or `0755`, raw size, SHA-256 and canonical base64 content.
`treeSha256` commits to the sorted entry sequence using this exact UTF-8 frame for each entry:

```text
<path>\0<decimal-mode>\0<size>\0<sha256>\n
```

`multirepo.metadata.json` records the capture environment, generation answers, fixture/archive hashes, counts and every removed path. The SHA inventory is a human-reviewable projection of the same
entries. The transcript records the published command's observable output and the injected answer object.

## Capture method

The beta command offered no non-interactive flags. The refresh tool loads the published `newCommand` export and supplies the recorded answers through that package's own Inquirer instance. This skips
terminal UI rendering only. The published builders, transformations, `npm install` calls and Git initialization all execute unchanged from the verified npm tarball. The published `bin/sf.js` was only
a Commander dispatcher to this export.

The generated nested Git repositories, dependency trees, build products, logs and tool caches are removed. Lockfiles and sanitized environment templates stay in the fixture. The beta generator created
five random JWT secrets in the API `.env`; refresh replaces only those values with fixed, visibly non-secret fixture sentinels. Metadata records a deterministic redacted-before hash, the exact after
hash, and the reason. No other source content is rewritten. The published web scaffold's `playwright-report/index.html` and `test-results/.last-run.json` remain because they were part of the shipped
source inventory and the legacy recognizer's verified baseline.

## Manual refresh

Refresh is a deliberate maintainer operation. The tool refuses CI and requires an explicit acknowledgement before any dependency network access.

The SaaSFoundry CLI maintainers own this directory. One directory represents one exact published release; never replace `1.0.0-beta` with output from another version. Add a sibling version directory
when future lifecycle coverage needs another release. The committed gzip bundle is the source of truth: although the source tarball is immutable, its historical dependency ranges and the live npm
registry can make a future reconstruction differ. Review that drift instead of assuming a refresh is reproducible across dates.

From a previously downloaded tarball:

```bash
npx tsx scripts/refresh-previous-release-fixture.ts \
  --tarball /absolute/path/saasfoundry-cli-1.0.0-beta.tgz \
  --allow-network
```

Or download only the exact pinned version:

```bash
npx tsx scripts/refresh-previous-release-fixture.ts \
  --package-version 1.0.0-beta \
  --allow-network
```

The script rejects any other version and verifies the tarball's SHA-512 integrity, SHA-1 shasum and SHA-256 before executing it. It uses a temporary home, an empty npm configuration, an environment
allowlist and disabled dependency lifecycle scripts. It stages and validates all four generated artifacts before replacing the prior set, with automatic rollback on a handled failure. Review all four
output files and require a no-diff second refresh from the same host/toolchain before accepting a provenance change.

If the command is interrupted outside its handled rollback path, restore the four tracked artifacts with Git, verify that no `.sf-fixture-artifacts-*` sibling directory remains, then rerun the
refresh. Never hand-edit only one generated artifact: the gzip, metadata, SHA inventory and transcript form one review unit.

Normal CI never runs this refresh command, resolves an npm tag or regenerates the project. It verifies and extracts the committed gzip document offline. The subsequent lifecycle may restore
dependencies from the committed lockfiles; that does not alter or regenerate the fixture.

## Monorepo limitation

Do not force `isMonorepo: true`, patch the old prompt or call the beta's internal monorepo builder. Such output was unreachable through the published product and the current legacy-adoption contract
correctly rejects it. Monorepo lifecycle coverage uses a supported generator baseline outside this historical fixture.

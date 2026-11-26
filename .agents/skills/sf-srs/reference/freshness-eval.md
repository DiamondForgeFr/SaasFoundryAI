# Freshness eval: details

Read from `SKILL.md`, "Evaluate freshness", when you interpret a drift report, change its inputs or review it with an AI pass.

`sf srs eval` scores SRS drift against the codebase in batch, the complement of the conversational hook: the hook catches a new decision at conversation time, the eval catches the silent drift that
already happened.

```bash
sf srs eval [--path <dir>] [--root-page <id>] [--threshold <pct>] [--json] [--review-packet <path>]
```

- `--path` defaults to the working directory, with the rules of `draft --from codebase`: it honours `.gitignore` and skips `node_modules`, `dist`, `coverage` and `.git`.
- `--root-page` defaults to `tools.srs.rootPage.id` in `.saasfoundry.json`.
- `--threshold` is the minimum overall freshness score, 80 by default.
- `--json` prints the full `FreshnessReport` instead of the human summary.

Exit codes: 0 overall score at or above the threshold (FRESH), or no FR to evaluate; 1 below it (DRIFT); 2 bad input (missing `--root-page`, malformed manifest, invalid `--path`); 3
`tools.srs.backend` missing from the manifest; 4 unknown backend; 5 adapter runtime error (`init()`, `listChildren` or scanner failure).

## Findings (v1)

| Finding kind      | Trigger                                                                                                                           | Severity |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `fr-without-code` | An FR page exists but no scanner finding (endpoint, ui-flow, entity or test) matches its area token                               | error    |
| `orphan-area`     | A scanner area carries implementation findings (endpoint, ui-flow, entity) but no FR page exists for it                           | error    |
| `code-without-fr` | An implementation finding is outside the matched set but its area already carries other matches (or mismatches a hint filter)     | warn     |
| `fr-untested`     | An FR is mapped to code findings in its area but no test coverage is detected (no `endpoint.hasTests`, no test finding, no hints) | warn     |

The overall score is the unweighted mean of FR coverage, endpoint coverage and test coverage, each a percentage. UR, DS, TC and NFR are reported with `score: null` and a note: deeper drift on them
needs the adapter to preserve table-row cells on `fetchPage`, which is a follow-up.

## Three-layer matcher

The eval is AI-augmented by design: the CLI runs the deterministic checks so that agent tokens go only to the semantic review tooling cannot do. No LLM is ever invoked from the tool, so cost for
non-agent users stays at zero.

- **L1, deterministic.** `eval-srs` matches every FR against all scanner findings whose `area` overlaps, not only endpoints: `ui-flow`, `entity` and `test` findings count too, so frontend-only,
  data-only and test-driven FRs are recognised without human intervention.
- **L2, declarative hints on the FR page.** Two optional fields of `SrsFrEntry` narrow the match: `implementationKind` (`endpoint`, `ui-flow`, `entity` or `mixed`) filters implementation findings to
  the declared kind (tests always count), and `areaHints` (`string[]`) adds area tokens, handy when the scanner area and the FR id diverge (FR area `billing`, code area `payments`). Both are optional
  and unset today.
- **L3, AI review packet.** `sf srs eval --review-packet .srs-audit/review-packet.json` writes, per FR, its deterministic `status` (`matched`, `untested` or `unmatched`), the matched files and
  `promptHints` summarising the gaps. Feed the packet into your context and propose the matches the script missed (an FR titled "Invoices" that belongs to code area `billing`), the reclassifications
  (an FR that looks matched but covers other behaviour), and the UR / DS / TC / NFR items the report does not compute yet. Never edit the FR page silently: propose each change through the
  conversational hook (`apply-update`), with the user.

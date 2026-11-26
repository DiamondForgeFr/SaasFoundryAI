# Milestone Guardrail

A project that chains SRS to tickets and never declares what a version contains cannot say when to cut: nobody frames a release until they are already trying to ship one, and by then the scope is
whatever happens to be finished. The guardrail applies only when `.saasfoundry.json` declares a workflow tool (without one there is no board to scope), and it informs without blocking: a milestone
reports where a release stands and asks for an acknowledgement to continue on an incomplete one, and refuses nothing. A gate that blocks a hotfix behind an unfinished milestone gets disabled for good,
and it would contradict the standing decision that the tag is a joint call.

## When to raise it

- The user talks about releasing, cutting, tagging or shipping a version, or asks what is left before one: run `scripts/plan-milestone.sh --version-named "<what they called it>"`. Once they have said
  it aloud, the ticket-count threshold does not apply.
- A version Epic was just spawned from the SRS: the scope exists in the product and not yet on the board.
- Tickets accumulate with no milestone and none is open. `plan-milestone.sh` decides whether that has crossed the threshold; do not eyeball it.

Raise it only then. A guardrail that greets on every turn gets ignored, then disabled.

## Steps

1. Read the board and the SRS: `scripts/plan-milestone.sh [--version-named "<name>"]`. It gathers tickets, milestones, sub-issue relationships and the versions the SRS declares, and returns candidates
   with the evidence each grouping rests on. The SRS read degrades to nothing on a missing module, a missing network or an adapter error, so a slow remote page never turns a proposal into an error.
2. Check `shouldPropose` before saying anything. `true`: raise it, quoting `trigger`. `false`: say nothing about milestones, including when candidates come with it (a milestone is already open and the
   move is to re-scope it, because a second one is how a board ends up with three overlapping releases), and answer a direct question with `reason`. With `--version-named`, a `false` that remains
   means nothing is groundable: ask what they want in the release instead of proposing a scope you invented. Without the flag, the script judges a young board on ticket count alone, and someone who
   just said "I want to ship an MVP" gets a quoted threshold while the right candidate sits unused in the output.
3. Propose from the candidates, never around them. Each carries `evidence`: a sub-issue relationship, a milestone linking several Epics, an SRS version page, or an admission of being a leftover pile.
   A grouping that cites none is a guess with a confident tone: ask instead.
4. Name the release yourself. `name` is always `null`, because the script never invents a version number: choosing one is a decision. Propose a name from what the user said and say what it rests on,
   and never derive one from an SRS page title.
5. Read `droppedCandidates` and `notes` before presenting. The cap puts things below the fold (on this project's own board the release Epic was in the dropped set, #551), and an Epic left out of
   `candidates` is named in one of them (covered by a milestone, or no sub-issue on the board). When `notes` says the board was truncated, every count is a floor and a grouping may miss tickets.
6. Create only on approval: `workflow-cli.sh milestone create <name>`, then `workflow-cli.sh milestone assign` per ticket, then `workflow-cli.sh milestone associate` for an SRS version page.

Done when the user approved a name and a scope and `workflow-cli.sh milestone show <name>` lists its tickets.

Say it in their words: a milestone is a version of the product. Grouping the features of a release bounds the work, turns a vague ambition into steps and makes progress readable; `MVP`, `v1` and `v2`
are the vocabulary, and "milestone" is the tracker's word.

## Reading the candidates

- `scopeSize` is what a release contains, which a milestone records and people read after the release; `openCount` is what is left, the question when re-scoping a release in flight. Use the one the
  conversation is about.
- An `srs-version` candidate is the strongest evidence there is: a version the product declared is a scope somebody decided, and it is the only source whose trigger ignores the ticket-count threshold.
  Its `scopeSize` counts FR pages in the SRS, not tickets: the release is framed and not necessarily spawned yet.
- An Epic is proposed while its children carry no milestone, whatever its status. A closed Epic is a finished scope (`epicDone: true`), ranked after the open ones so the board's history does not push
  the next release below the fold. An Epic whose children all carry a milestone is covered, not proposed, and `notes` names it with the milestone (#560).
- A release spanning several Epics is one `epic-union` candidate (#561). Epics are united only through a milestone the board shows linking them: the Epic, some of its children, or its SRS version page
  (`srsVersion`) carries it. Two Epics that are merely both open are never merged. The union's `parts` (one per Epic, plus one for tickets that carry the milestone outside any Epic) each hold
  `scopeSizePartial: true`: quote the union's own `scopeSize`, the sum, when framing a release, and never a part's. `undeclaredCount` is what `milestone assign` would still add. Separate `epic`
  candidates are separate because no milestone links them: when the user says they ship together, that is theirs to record with `milestone assign`, not a grouping to present as derived.
- Prose-claimed membership is refused, not offered: an Epic body that lists `#NNN` under "pulled into this Epic" or "tracked on #488" is a sentence, not a link the board can verify. When a
  human-written scope names tickets the candidate lacks, say so and offer to `milestone assign` them, so the next run sees the link.
- "The SRS declares no version pages" usually means the features hold their FRs directly and `sf srs normalize` has not run, not that the product has no versions. `notes` tells that apart from "the
  SRS could not be read", which is a gap in the evidence.

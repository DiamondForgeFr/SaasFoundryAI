# Intake: read the code, then challenge the intent

Phases 1 and 2 of "The zero-to-project flow" in `SKILL.md`. They run before `sf new`, in a folder that already holds code, and they come first because `sf new --profile full` creates `<projectName>/`
under the current folder: run over a POC, the experiment and the generated project become siblings in a folder nobody organised, and the POC gets extended into production by accident. Filing the POC
into `POC/` makes it a reference and the boundary visible from the first day (`my-thing/POC/` beside `my-thing/my-project/`).

## Read the code

Reading and moving are two steps; only reading always applies. The profile question decides the move, so ask it before proposing one:

| The user's answer                       | Profile   | Read | Move                                                                      |
| --------------------------------------- | --------- | ---- | ------------------------------------------------------------------------- |
| "it's a throwaway POC, I'll rewrite it" | `full`    | yes  | yes, into `POC/`, so the scaffold lands beside the experiment             |
| "it exists and I'm building on it"      | `harness` | yes  | no: `sf new --profile harness` installs in place and creates no directory |

`read-poc.sh` reads any codebase and writes nothing; "POC" is its name for historical reasons, so read a live project with it too.

1. Read it: `scripts/read-poc.sh <dir>`. Its `recognisable` field decides whether there is anything to read; do not list the folder and infer.
2. Say what it is: turn the evidence into a reading (what it does, what it proves, which parts are the experiment and which scaffolding), each claim traced to the report (a manifest, README prose,
   entry points, dependencies). When `recognisable` is `false`, report `reason` and what is there, and ask the user what it is: a folder of loose files has no purpose to read, and a confident reading
   of it is worse than saying so. `false` is a finding, and the script still exits 0. `git.ownRepo: false` with `isRepo: true` means the POC sits inside somebody else's repository.
3. Confirm the reading: show it and let the user correct it; their correction is the reading. Done when the user has confirmed it.

On `harness` the reading ends the step: go to "Challenge the intent", then run `sf new --profile harness` in place. Never run `plan-poc-move.sh` there: there is nothing to move, and offering it to
someone who keeps their repository proposes relocating everything they have.

```bash
# 1. Read what is there. Nothing is written.
scripts/read-poc.sh .

# 2. Confirm the reading with the user, then seed the challenge from it.
scripts/read-poc.sh . | scripts/plan-challenge.sh
scripts/record-intake.sh --out intake.json

# 3. Install the AI layer in place. No directory is created, nothing moves.
sf new --profile harness --non-interactive ...
```

On `full`, continue:

4. Propose the move: `scripts/read-poc.sh <dir> | scripts/plan-poc-move.sh`. Show the entries that move, the resulting tree and the `warnings` (they never block). `moves` lists whole top-level
   entries, dotfiles and `.git` included, which keeps the move reversible (`undo` says how, and the repository keeps a clean tree and its full history at the new location). When the plan is `refused`,
   relay `refusals` verbatim, stop, and let the user decide: each guards work that exists in no other copy, and a different destination to dodge "already exists" or a parent folder to dodge "inside
   another repository" is a workaround.
5. Move on approval: `scripts/move-poc.sh <dir> --confirm`. A POC is normally local-only, with no remote and often no history, so there is no copy to restore from. Without `--confirm` the script is a
   dry run that changes nothing, which also answers "what would this do?". Done when it exits 0 and `POC/` holds the experiment.
6. Scaffold from the same folder with `flows/new.md`: the project directory lands beside `POC/` on its own. Run `sf new` beside `POC/`, never inside it.

The intake relocates and deletes nothing: when something looks like it should go, say so and leave it.

## Challenge the intent

Runs once the user has confirmed the reading, before `sf new`. The reading shows things the user has not said, and those are questions only someone who read the code can ask. Not "what do you want",
but "your POC does X: does that mean Y?". A generic intake produces a specification that says nothing about this product.

1. Seed from the reading: `scripts/read-poc.sh <dir> | scripts/plan-challenge.sh` (it takes a reading, not a `POC/` folder: `report.inventory` is all it requires). A seed is an observation plus the
   dimension it opens: refine a seed, merge two or drop one, and invent none.
2. When `revealing` is `false`, say so in the terms of `reason` and ask the user directly: the POC reveals too little to challenge, and questions any project would get are the failure this step
   prevents.
3. Ask one question at a time, each naming its observation: "Your POC processes audio with a local model rather than an API: was that a privacy decision that has to hold in the product, or just the
   quickest thing to get working?". A question that names no observation is the generic intake in costume; it belongs to the SRS conversation that follows. `cap` is an upper bound, not a quota: two
   good questions beat six dutiful ones, and the first answer often removes the third. When `dropped` is above 0, questions were left out: say so if the conversation goes deep.
4. Read `notes`: they say what could not be probed (a Python POC yields fewer seeds because only `package.json` is parsed today). That is a limit of the reading, not a verdict on the POC, and the user
   deserves to hear the difference.
5. Record the answers: pipe `{seeds, answers, root, notes}` into `scripts/record-intake.sh --out <workspace>/intake.json`. Each answer carries the `dimension` of its seed, and the script refuses an
   answer that references no seed, so the link to the observation survives in the artefact.

Done when `intake.json` exists. The SRS step reads it, so nothing in it is asked twice.

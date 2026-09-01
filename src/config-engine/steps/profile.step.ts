import { StepDefinition } from '../types'

/**
 * Opening question of `sf new`: what should be installed. Downstream steps gate on the
 * answer — `harness` skips every stack-related step, `stack` skips the workflow tool, the
 * SRS and the tracker wiring.
 *
 * `stack` does NOT skip the skills. Every scaffolded profile deposits the core harness
 * artefacts — the git and code-quality skills, `.claude/docs/`, and the settings that
 * register their hooks — so `sf update` can refresh them on any profile (see the `harness`
 * entry written into the manifest in `new.ts`). That is deliberate, and the labels below
 * say so now: they used to promise "no AI workflow configuration", which a user reasonably
 * read as "no `.claude/` directory at all", and then found seven skills in their repo (#628).
 *
 * Removing the deposit is a different decision, and a larger one: the deposited
 * `.claude/settings.json` registers a `UserPromptSubmit` hook pointing at
 * `.claude/skills/sf-srs/scripts/srs-intent-hook.sh`, so dropping the skills while keeping
 * the settings would ship a configuration referencing a script that is not there.
 */
export const profileStep: StepDefinition = {
  id: 'profile',
  title: 'Installation profile',
  fields: [
    {
      type: 'list',
      name: 'profile',
      message: 'What do you want to install?',
      choices: [
        { name: 'Full SaaS project: technical stack + AI workflow harness', value: 'full' },
        { name: 'AI harness only: workflow + skills + SRS on an existing project', value: 'harness' },
        { name: 'Technical stack only: no workflow tool and no SRS (core AI skills still included)', value: 'stack' }
      ],
      default: 'full'
    }
  ]
}

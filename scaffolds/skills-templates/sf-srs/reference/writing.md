# Writing pages: details

Read from `SKILL.md`, "Write pages", when `sf srs write` refuses a spec or a page joins one written earlier.

## What the batch check refuses (exit 2, before any page)

- An FR attached to a feature. Epic = feature + version: an FR belongs to a version, so the batch declares one and the FR names it in `parentEpicId`.
- A `parentEpicId` that is neither an `epic.id` declared earlier in the batch nor given as `parentEpicPageId`. The message lists every logical id known so far, so a typo or a missing Epic is easy to
  spot.
- A version title or number, or a UR / FR / DS / TC / NFR id, that the feature already holds (#919). Take them from `sf srs next-ids --feature <page-url-or-id>`.
- An `epic.parentId` given as a page URL or id that is not a feature of this SRS (a direct child of its root page).

Reading tolerates a feature that holds its FRs directly: real features are in that shape and their FRs must not be lost. Writing does not, so no new feature starts in a shape that already needs
`sf srs normalize`.

## A version of a feature written earlier

Set `epic.parentId` to the feature page's URL or id instead of a logical id. `write` resolves the page before writing anything, refuses one that is not a feature of this SRS, writes the version and
its FRs under the feature, and adds the version to the feature's Versions list in place. A backend that cannot edit an existing page lists what is left to add by hand in the report's `notPlaced`.

## An FR added to a version written earlier

Set the FR candidate's `parentEpicPageId` to the version page. `write` creates the FR page, adds its row to the version's FR table and a line to "What changed in this version" (the candidate's
optional `change`, `Adds <id> — <title>` by default), and adds its row and the UR / DS / TC rows it carries to the feature's tables, with the version. A page that is not a version of this SRS still
receives the FR page, and the report says no table lists it.

## What an `epic` candidate renders

Its inline `frs[]`, like `urs`, `dsItems`, `tcItems` and `nfrItems`, is rendered into the page body, the FR table included. On a version, and on an `fr` candidate, those items are also listed in the
feature page's tables, with the version. FR child pages, the ones `spawn` turns into Stories, come only from `kind: 'fr'` candidates.

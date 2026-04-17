# SaaSFoundry Tool Skill (placeholder)

This is a placeholder bundle for the `tool-saasfoundry` Claude Code skill. The real payload ships in Phase 2 of epic #18.

The CLI commands `sf skill install | update | uninstall` manage this bundle's lifecycle — copying it to either `~/.claude/skills/tool-saasfoundry/` (user scope) or `.claude/skills/tool-saasfoundry/` (project scope) and maintaining a `.version` manifest alongside it.

## Why this exists now

Phase 1D (ticket #61) wires up the lifecycle commands before the skill content exists. Having a copyable placeholder lets us:

- Exercise the install / update / uninstall code paths in real tests (no mocks required)
- Ship the bundle in the npm package so `npx saasfoundry-cli sf skill install` works out of the box
- Validate the `.version` manifest flow against a concrete directory

## What will replace this

In Phase 2 this file — and the rest of the bundle directory — is replaced by the real skill: `SKILL.md`, helper scripts, catalogue-aware prompts, and documentation for AI agents assisting developers on their SaaSFoundry projects.

Until then, treat this file as a marker that the skill *can* be installed. No behavior depends on its contents.

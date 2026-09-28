import type { SaaSFoundryManifest } from './types'

export type TechnicalStackCapability = 'present' | 'absent' | 'inconsistent'
export type CollaborationHarnessCapability = 'managed' | 'core-only' | 'legacy-unknown' | 'inconsistent'
export type EffectiveProjectProfile = 'full' | 'stack' | 'harness' | 'projection' | 'unknown' | 'inconsistent'

export interface ProjectCapabilities {
  technicalStack: TechnicalStackCapability
  collaborationHarness: CollaborationHarnessCapability
  effectiveProfile: EffectiveProjectProfile
}

/** Positive manifest evidence that the collaboration harness is configured. */
export function hasManagedHarnessEvidence(manifest: SaaSFoundryManifest): boolean {
  // Optional skills, SRS and coding-agent declarations can be installed
  // independently, so they are deliberately not treated as proof.
  return manifest.workflow !== undefined || manifest.aiRules !== undefined
}

function technicalStackCapability(manifest: SaaSFoundryManifest): TechnicalStackCapability {
  const modules = manifest.modules
  const structural = [modules?.email, modules?.s3Setup, modules?.dbSetup, modules?.includeAnalytics]
  const present = structural.filter((value) => value !== undefined).length

  if (present === 0) return manifest.structure === 'cli' ? 'absent' : 'inconsistent'
  if (present !== structural.length || modules?.advancedSkills === undefined) return 'inconsistent'
  return manifest.structure === 'cli' ? 'inconsistent' : 'present'
}

function collaborationHarnessCapability(manifest: SaaSFoundryManifest): CollaborationHarnessCapability {
  const managed = manifest.modules?.harness?.managed
  const evidence = hasManagedHarnessEvidence(manifest)

  if (managed === true) return 'managed'
  if (managed === false) return evidence ? 'inconsistent' : 'core-only'
  return evidence ? 'managed' : 'legacy-unknown'
}

function effectiveProfile(technicalStack: TechnicalStackCapability, collaborationHarness: CollaborationHarnessCapability): EffectiveProjectProfile {
  if (technicalStack === 'inconsistent' || collaborationHarness === 'inconsistent') return 'inconsistent'
  if (technicalStack === 'present' && collaborationHarness === 'managed') return 'full'
  if (technicalStack === 'present' && collaborationHarness === 'core-only') return 'stack'
  if (technicalStack === 'absent' && collaborationHarness === 'managed') return 'harness'
  return 'unknown'
}

/**
 * Older multirepo children predate the explicit projection marker. Their
 * generated manifest shape is deliberately recognized conservatively so a
 * child named `<root>-api` or `<root>-web` can never be promoted as if it were
 * the coordinator. A standalone harness with the same legacy shape must be
 * made explicit before profile adoption; failing closed is safer than
 * scaffolding a second application inside it.
 */
export function hasLegacyMultirepoChildShape(manifest: SaaSFoundryManifest): boolean {
  if (manifest.projection || manifest.structure !== 'cli' || !/-((api)|(web))$/.test(manifest.projectName)) return false
  const technicalKeys = [manifest.modules?.email, manifest.modules?.s3Setup, manifest.modules?.dbSetup, manifest.modules?.includeAnalytics]
  return (
    technicalKeys.every((value) => value === undefined) &&
    manifest.modules?.harness !== undefined &&
    Array.isArray(manifest.modules?.advancedSkills) &&
    manifest.mainBranch !== undefined &&
    manifest.fileHashes !== undefined &&
    (manifest.modules.harness.managed === true || hasManagedHarnessEvidence(manifest))
  )
}

/** Derive current capabilities without persisting or guessing an installation profile. */
export function classifyProjectCapabilities(manifest: SaaSFoundryManifest): ProjectCapabilities {
  const technicalStack = technicalStackCapability(manifest)
  const collaborationHarness = collaborationHarnessCapability(manifest)
  if (manifest.projection?.kind === 'multirepo-child' || hasLegacyMultirepoChildShape(manifest)) {
    return { technicalStack, collaborationHarness, effectiveProfile: 'projection' }
  }
  return { technicalStack, collaborationHarness, effectiveProfile: effectiveProfile(technicalStack, collaborationHarness) }
}

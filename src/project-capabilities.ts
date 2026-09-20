import type { SaaSFoundryManifest } from './types'

export type TechnicalStackCapability = 'present' | 'absent' | 'inconsistent'
export type CollaborationHarnessCapability = 'managed' | 'core-only' | 'legacy-unknown' | 'inconsistent'
export type EffectiveProjectProfile = 'full' | 'stack' | 'harness' | 'unknown' | 'inconsistent'

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

/** Derive current capabilities without persisting or guessing an installation profile. */
export function classifyProjectCapabilities(manifest: SaaSFoundryManifest): ProjectCapabilities {
  const technicalStack = technicalStackCapability(manifest)
  const collaborationHarness = collaborationHarnessCapability(manifest)
  return { technicalStack, collaborationHarness, effectiveProfile: effectiveProfile(technicalStack, collaborationHarness) }
}

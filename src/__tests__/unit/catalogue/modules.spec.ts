import { CATALOGUE, getAllModuleNames, getModuleByName, ModuleDefinition } from '../../../catalogue/modules'

describe('module catalogue', () => {
  describe('integrity', () => {
    it('should have no duplicate module names', () => {
      const names = CATALOGUE.map((m) => m.name)
      const unique = new Set(names)
      expect(unique.size).toBe(names.length)
    })

    it('should populate every required field on every entry', () => {
      for (const module of CATALOGUE) {
        expect(module.name).toMatch(/^[a-z0-9-]+$/)
        expect(module.displayName).toBeTruthy()
        expect(module.description).toBeTruthy()
        expect(['module', 'skill', 'structural']).toContain(module.category)
        expect(Array.isArray(module.keywords)).toBe(true)
        expect(module.keywords.length).toBeGreaterThan(0)
        expect(Array.isArray(module.provides)).toBe(true)
        expect(module.provides.length).toBeGreaterThan(0)
        expect(Array.isArray(module.alternatives)).toBe(true)
        expect(module.alternatives.length).toBeGreaterThan(0)
        expect(module.introducedInVersion).toMatch(/^\d+\.\d+\.\d+/)
        expect(module.minCliVersion).toMatch(/^\d+\.\d+\.\d+/)
        expect(Array.isArray(module.filesAffected)).toBe(true)
        expect(module.filesAffected.length).toBeGreaterThan(0)
        expect(Array.isArray(module.dependencies)).toBe(true)
      }
    })

    it('should only use "scaffold" as installOnly value when present', () => {
      for (const module of CATALOGUE) {
        if (module.installOnly !== undefined) {
          expect(module.installOnly).toBe('scaffold')
        }
      }
    })

    it('should flag all structural entries as scaffold-only', () => {
      const structural = CATALOGUE.filter((m) => m.category === 'structural')
      for (const module of structural) {
        expect(module.installOnly).toBe('scaffold')
      }
    })

    it('should use lowercase single-word keywords', () => {
      for (const module of CATALOGUE) {
        for (const keyword of module.keywords) {
          expect(keyword).toBe(keyword.toLowerCase())
          expect(keyword).not.toMatch(/\s/)
        }
      }
    })

    it('should include the known phase-1 modules', () => {
      const names = CATALOGUE.map((m) => m.name)
      for (const expected of ['email', 'storage', 'analytics', 'sf-skill-context7', 'sf-skill-atlassian', 'sf-skill-notion', 'sf-skill-figma']) {
        expect(names).toContain(expected)
      }
    })
  })

  describe('getModuleByName', () => {
    it('should return the matching module', () => {
      const module = getModuleByName('email')
      expect(module).toBeDefined()
      expect(module?.displayName).toBe('MailerSend Email Service')
    })

    it('should return undefined for an unknown name', () => {
      expect(getModuleByName('does-not-exist')).toBeUndefined()
    })
  })

  describe('getAllModuleNames', () => {
    it('should return every catalogue name', () => {
      const names = getAllModuleNames()
      expect(names).toHaveLength(CATALOGUE.length)
      expect(names).toEqual(CATALOGUE.map((m: ModuleDefinition) => m.name))
    })
  })
})

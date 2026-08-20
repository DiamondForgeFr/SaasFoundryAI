import { copy } from 'fs-extra'
import { readFile, writeFile } from 'fs/promises'
import { resolve } from 'path'

import type { ModuleInstaller } from '../migrations/module/types'
import { overlaysPath } from '../types'
import { fileExists } from '../utils'

/** Pinned in lockstep with the version the overlay's `pwa.config.ts` is written against. */
const VITE_PLUGIN_PWA_VERSION = '1.3.0'

export const pwaInstallerMeta: ModuleInstaller = {
  name: 'pwa',
  currentVersion: 1,
  migrations: []
}

interface InstallPwaModuleParams {
  webPath: string
  projectName: string
  projectDescription?: string
}

/**
 * Install the PWA module on a Web app, making it installable as a desktop application
 * through the browser's own flow (Chrome/Brave/Edge "Install this application").
 *
 * Every step is idempotent: `sf update` may run this against a project that already has the
 * module, and re-deposits must not duplicate an import, a plugin call or a meta tag.
 *
 * Used by both `sf new` (during initial generation) and `sf update` (when adding it later).
 */
export async function installPwaModule({ webPath, projectName, projectDescription }: InstallPwaModuleParams) {
  const overlay = resolve(overlaysPath, 'modules/pwa')

  // 1. Icons — deposited into the web app's public/ so the build copies them verbatim.
  await copy(`${overlay}/public`, `${webPath}/public`, { overwrite: true })

  // 2. PWA options, with the project's own identity substituted in.
  const configSource = await readFile(`${overlay}/pwa.config.ts`, 'utf8')
  const configContent = configSource.replace(/\{\{PROJECT_NAME\}\}/g, projectName).replace(/\{\{PROJECT_DESCRIPTION\}\}/g, projectDescription || projectName)
  await writeFile(`${webPath}/pwa.config.ts`, configContent)

  // 3. The plugin is a devDependency of the generated app, not of the CLI. It is added here
  //    rather than in the web overlay's package.json because the module is declinable —
  //    a `--no-pwa` project must not carry a dependency it never imports.
  const packageJsonPath = `${webPath}/package.json`
  if (await fileExists(packageJsonPath)) {
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
    packageJson.devDependencies = packageJson.devDependencies || {}
    if (!packageJson.devDependencies['vite-plugin-pwa']) {
      packageJson.devDependencies['vite-plugin-pwa'] = VITE_PLUGIN_PWA_VERSION
      // Keep devDependencies alphabetical, as npm itself writes them.
      packageJson.devDependencies = Object.fromEntries(Object.entries(packageJson.devDependencies).sort(([a], [b]) => a.localeCompare(b)))
      await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
    }
  }

  // 4. Register the plugin — one import, one call.
  const viteConfigPath = `${webPath}/vite.config.ts`
  if (await fileExists(viteConfigPath)) {
    let viteConfig = await readFile(viteConfigPath, 'utf8')
    if (!viteConfig.includes('vite-plugin-pwa')) {
      viteConfig = viteConfig.replace(/(import \{ defineConfig, loadEnv \} from 'vite')/, "$1\nimport { VitePWA } from 'vite-plugin-pwa'\n\nimport { pwaOptions } from './pwa.config'")
      viteConfig = viteConfig.replace(/plugins: \[([^\]]*)\]/, (_match, plugins) => `plugins: [${plugins.trim()}, VitePWA(pwaOptions)]`)
      await writeFile(viteConfigPath, viteConfig)
    }
  }

  // 5. `theme_color` in the manifest is what desktop installation uses, but the meta tag is
  //    what tints the mobile system bar. Both are needed to look intentional everywhere.
  const indexHtmlPath = `${webPath}/index.html`
  if (await fileExists(indexHtmlPath)) {
    let indexHtml = await readFile(indexHtmlPath, 'utf8')
    if (!indexHtml.includes('name="theme-color"')) {
      indexHtml = indexHtml.replace(/(\n\s*)(<meta name="viewport")/, '$1<meta name="theme-color" content="#F97316" />$1$2')
      await writeFile(indexHtmlPath, indexHtml)
    }
  }
}

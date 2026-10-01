/** `import [type] [Default, ]{ a, b } from 'module'`, on one line or spread over several. */
const NAMED_IMPORT = /^import (type )?(?:([A-Za-z_$][\w$]*), )?\{([^}]*)\} from '([^']+)'$/gm

/**
 * Lay out named imports the way the generated projects' prettier does: on one line when it
 * fits in `printWidth`, otherwise one specifier per line (no semicolons, no trailing comma,
 * as their `.prettierrc` sets).
 *
 * The monorepo rewrites the web app's imports to `@<project>/…`, so the line's length
 * depends on the project name: a layout fixed in the template was wrong for some name
 * whatever it was, and `npm run format:check` failed on a fresh project (#867). Only imports
 * whose module `relayout` selects are touched; one carrying a comment is left as written.
 */
export function layoutNamedImports(source: string, relayout: (module: string) => boolean, printWidth = 200): string {
  return source.replace(NAMED_IMPORT, (statement: string, type = '', defaultImport: string | undefined, body: string, module: string) => {
    if (!relayout(module) || /\/[/*]/.test(body)) return statement
    const specifiers = body
      .split(',')
      .map((specifier) => specifier.trim())
      .filter(Boolean)
    const head = `import ${type}${defaultImport ? `${defaultImport}, ` : ''}`
    const oneLine = `${head}{ ${specifiers.join(', ')} } from '${module}'`
    if (oneLine.length <= printWidth) return oneLine
    return `${head}{\n${specifiers.map((specifier) => `  ${specifier}`).join(',\n')}\n} from '${module}'`
  })
}

const STRING = String.raw`'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"`
/** `key: 'string',` on one line. */
const STRING_PROPERTY = new RegExp(String.raw`^( *)([A-Za-z_$][\w$]*): (${STRING})(,?)$`, 'gm')
/** The same property, broken after its colon. */
const BROKEN_STRING_PROPERTY = new RegExp(String.raw`^( *)([A-Za-z_$][\w$]*):\n\1  (${STRING})(,?)$`, 'gm')

/**
 * Lay out `key: 'string'` object properties the way the generated projects' prettier does:
 * on one line when it fits in `printWidth`, otherwise broken after the colon with the string
 * indented below. The email locales embed the project name in long sentences, so the layout
 * depends on the name's length (#867).
 */
export function layoutStringProperties(source: string, printWidth = 200): string {
  return source
    .replace(BROKEN_STRING_PROPERTY, (_statement: string, indent: string, key: string, value: string, comma: string) => `${indent}${key}: ${value}${comma}`)
    .replace(STRING_PROPERTY, (statement: string, indent: string, key: string, value: string, comma: string) =>
      statement.length <= printWidth ? statement : `${indent}${key}:\n${indent}  ${value}${comma}`
    )
}

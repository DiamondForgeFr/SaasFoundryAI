#!/usr/bin/env node
'use strict'

// Gathers the evidence a POC reading is built from, and decides — deterministically —
// whether there is enough there to read at all.
//
// The division of labour matters. A script cannot say what a POC *proves*; that is a
// judgement, and it belongs to the skill. But "is there anything here to read?" must
// NOT be a judgement, because the failure mode is an assistant inventing a purpose for
// a folder of three loose scripts. So `recognisable` is decided here, from anchors, and
// the skill is forbidden from overriding it.
//
// Usage:
//   read-poc.js <directory>
//
// Output (stdout, JSON object): see REPORT SHAPE in read-poc.sh
//
// Exit codes:
//   0 — success (including recognisable:false — that is a finding, not an error)
//   1 — internal error
//   2 — invalid input (missing/unreadable directory)

const fs = require('fs')
const path = require('path')

// Directories that are never authored by hand. Walking them tells us nothing about the
// POC and can be enormous, so they are skipped — but their presence is itself evidence
// (a node_modules means someone ran an install), so we record that they were seen.
const GENERATED_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit',
  '.venv', 'venv', 'env', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache',
  'target', 'vendor', 'coverage', '.turbo', '.cache', '.parcel-cache', '.gradle', '.idea', '.vscode',
  'obj', 'Pods', '.terraform', '.serverless'
])

// Filesystem noise. Left in, a stray .DS_Store counts toward the authored-file threshold
// and can flip the recognisability verdict on a macOS folder that holds nothing else.
const NOISE_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', '.localized'])

// A manifest is the strongest anchor: it names the stack and usually the intent.
const MANIFESTS = [
  { file: 'package.json', stack: 'node' },
  { file: 'deno.json', stack: 'deno' },
  { file: 'requirements.txt', stack: 'python' },
  { file: 'pyproject.toml', stack: 'python' },
  { file: 'setup.py', stack: 'python' },
  { file: 'Pipfile', stack: 'python' },
  { file: 'go.mod', stack: 'go' },
  { file: 'Cargo.toml', stack: 'rust' },
  { file: 'composer.json', stack: 'php' },
  { file: 'Gemfile', stack: 'ruby' },
  { file: 'pom.xml', stack: 'jvm' },
  { file: 'build.gradle', stack: 'jvm' },
  { file: 'build.gradle.kts', stack: 'jvm' },
  { file: 'Package.swift', stack: 'swift' },
  { file: 'pubspec.yaml', stack: 'dart' },
  { file: 'Dockerfile', stack: 'docker' },
  { file: 'docker-compose.yml', stack: 'docker' },
  { file: 'docker-compose.yaml', stack: 'docker' }
]

const SOURCE_EXT = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.go', '.rs', '.rb', '.php',
  '.java', '.kt', '.swift', '.dart', '.cs', '.c', '.h', '.cpp', '.hpp', '.scala',
  '.ex', '.exs', '.clj', '.sh', '.bash', '.zsh', '.sql', '.vue', '.svelte'
])

// Lockfiles and their kin are authored by a tool, not a person. They count as evidence of
// a real install but never as authored work — otherwise a folder holding only a
// package-lock.json would read as a substantial codebase.
const TOOL_AUTHORED = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'poetry.lock',
  'Pipfile.lock', 'Gemfile.lock', 'composer.lock', 'Cargo.lock', 'go.sum'
])

const MAX_ENTRIES = 5000
const MAX_DEPTH = 12

function fail(code, message) {
  process.stderr.write('read-poc: ' + message + '\n')
  process.exit(code)
}

const target = process.argv[2]
if (!target) fail(2, 'usage: read-poc.js <directory>')

let rootStat
try {
  rootStat = fs.statSync(target)
} catch (err) {
  fail(2, 'cannot read directory ' + target + ': ' + err.message)
}
if (!rootStat.isDirectory()) fail(2, target + ' is not a directory')

const root = path.resolve(target)

// ── walk ────────────────────────────────────────────────────────────────────────────

const files = []
const generatedSeen = []
let truncated = false
let dirCount = 0

function walk(dir, depth) {
  if (truncated) return
  if (depth > MAX_DEPTH) return
  let dirents
  try {
    dirents = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return // unreadable subdirectory is not fatal — the rest of the reading still holds
  }
  for (const dirent of dirents) {
    if (files.length >= MAX_ENTRIES) {
      truncated = true
      return
    }
    const abs = path.join(dir, dirent.name)
    const rel = path.relative(root, abs)
    if (dirent.isDirectory()) {
      if (GENERATED_DIRS.has(dirent.name)) {
        generatedSeen.push(rel)
        continue
      }
      dirCount++
      walk(abs, depth + 1)
      continue
    }
    if (!dirent.isFile()) continue
    if (NOISE_FILES.has(dirent.name)) continue
    let size = 0
    try {
      size = fs.statSync(abs).size
    } catch {
      /* a file that vanished mid-walk is simply not part of the reading */
    }
    files.push({ path: rel, name: dirent.name, ext: path.extname(dirent.name).toLowerCase(), size })
  }
}

walk(root, 0)

// ── evidence ────────────────────────────────────────────────────────────────────────

const byName = new Map(files.map((f) => [f.path, f]))

const stacks = []
const manifestsFound = []
for (const { file, stack } of MANIFESTS) {
  if (!byName.has(file)) continue
  manifestsFound.push(file)
  if (!stacks.includes(stack)) stacks.push(stack)
}

function readIfPresent(rel, limit) {
  if (!byName.has(rel)) return null
  try {
    const raw = fs.readFileSync(path.join(root, rel), 'utf8')
    return limit && raw.length > limit ? raw.slice(0, limit) : raw
  } catch {
    return null
  }
}

// package.json is the one manifest worth parsing: name, description, scripts and direct
// dependencies are the closest a machine gets to "what was this for".
let pkg = null
const pkgRaw = readIfPresent('package.json', 200000)
if (pkgRaw) {
  try {
    const parsed = JSON.parse(pkgRaw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      pkg = {
        name: typeof parsed.name === 'string' ? parsed.name : null,
        description: typeof parsed.description === 'string' ? parsed.description : null,
        scripts: parsed.scripts && typeof parsed.scripts === 'object' ? parsed.scripts : {},
        dependencies: Object.keys({ ...(parsed.dependencies || {}), ...(parsed.devDependencies || {}) }).sort()
      }
    }
  } catch {
    pkg = { name: null, description: null, scripts: {}, dependencies: [], malformed: true }
  }
}

const readmeFile = files.find((f) => /^readme(\.|$)/i.test(f.name) && !f.path.includes(path.sep))
let readme = { present: false, path: null, firstParagraph: null }
if (readmeFile) {
  const raw = readIfPresent(readmeFile.path, 20000) || ''
  const firstParagraph = raw
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0 && !/^[#>\-*=`[!]/.test(block))
    .shift()
  readme = {
    present: true,
    path: readmeFile.path,
    firstParagraph: firstParagraph ? firstParagraph.replace(/\s+/g, ' ').slice(0, 600) : null
  }
}

const sourceFiles = files.filter((f) => SOURCE_EXT.has(f.ext))
const authoredFiles = files.filter((f) => !TOOL_AUTHORED.has(f.name))

const testEvidence = []
if (files.some((f) => /(^|[/\\])(tests?|__tests__|spec)([/\\]|$)/i.test(f.path))) testEvidence.push('test directory')
if (files.some((f) => /\.(spec|test)\.[a-z]+$/i.test(f.name))) testEvidence.push('*.spec / *.test files')
if (files.some((f) => /^test_.*\.py$/i.test(f.name))) testEvidence.push('test_*.py files')

// Entry points: conventional names first, then whatever the manifest declares.
const ENTRY_CANDIDATES = ['index.js', 'index.ts', 'main.js', 'main.ts', 'main.py', 'app.py', 'main.go', 'app.js', 'server.js', 'src/index.js', 'src/index.ts', 'src/main.ts', 'src/main.py', 'src/app.py', 'cmd/main.go']
const entryPoints = ENTRY_CANDIDATES.filter((c) => byName.has(c))

// ── git ─────────────────────────────────────────────────────────────────────────────
//
// Three states, and the third is the one that must never be guessed at: a POC that is a
// subdirectory of somebody else's repository. Moving it would rewrite paths in a repo
// nobody pointed us at, so the move planner refuses on this and says why.

let git = { isRepo: false, ownRepo: false, enclosingRoot: null }
if (fs.existsSync(path.join(root, '.git'))) {
  git = { isRepo: true, ownRepo: true, enclosingRoot: root }
} else {
  let cursor = path.dirname(root)
  let previous = null
  while (cursor && cursor !== previous) {
    if (fs.existsSync(path.join(cursor, '.git'))) {
      git = { isRepo: true, ownRepo: false, enclosingRoot: cursor }
      break
    }
    previous = cursor
    cursor = path.dirname(cursor)
  }
}

// ── the verdict ─────────────────────────────────────────────────────────────────────
//
// An anchor is something that lets a reader say what this is without inventing it. Any
// one of them is enough; none of them means we say so rather than guess.

const anchors = []
if (manifestsFound.length > 0) anchors.push('manifest: ' + manifestsFound.join(', '))
if (readme.present && readme.firstParagraph) anchors.push('README with prose')
if (sourceFiles.length >= 1 && authoredFiles.length >= 3) anchors.push(sourceFiles.length + ' source file(s)')

let recognisable = anchors.length > 0
let reason = null
if (!recognisable) {
  if (files.length === 0) reason = 'the directory holds no files'
  else if (sourceFiles.length === 0) reason = 'no manifest, no README with prose, and no source file among ' + files.length + ' file(s)'
  else reason = 'no manifest, no README with prose, and only ' + authoredFiles.length + ' authored file(s) — too little to read a purpose from'
}

const topLevel = [...new Set(files.map((f) => f.path.split(path.sep)[0]))].sort()

process.stdout.write(
  JSON.stringify(
    {
      root,
      recognisable,
      reason,
      anchors,
      stacks,
      manifests: manifestsFound,
      package: pkg,
      readme,
      entryPoints,
      tests: { present: testEvidence.length > 0, evidence: testEvidence },
      git,
      inventory: {
        files: files.length,
        directories: dirCount,
        sourceFiles: sourceFiles.length,
        authoredFiles: authoredFiles.length,
        bytes: files.reduce((sum, f) => sum + f.size, 0),
        topLevel,
        generatedPresent: generatedSeen.sort(),
        truncated
      }
    },
    null,
    2
  ) + '\n'
)

# Référence des constats des scanners

`srs-cli.sh draft --from codebase` lance cinq scanners sur le code source et écrit une enveloppe `ScannerFinding[]` sur la sortie standard. Cette page documente les formes JSON utilisées par les
prompts, les wrappers et les scanners personnalisés.

```jsonc
{
  "source": "codebase",
  "findings": [
    /* ScannerFinding[] */
  ]
}
```

Tous les constats partagent :

```ts
interface BaseScannerFinding {
  kind: 'endpoint' | 'ui-flow' | 'entity' | 'test' | 'doc-context'
  title: string
  excerpt?: string
  notes?: string
}
```

`kind` est le discriminant et `title` un libellé lisible que l'agent peut présenter au reviewer.

## `endpoint` — contrôleurs NestJS

`nestjs.scanner.ts` produit un constat par décorateur HTTP d'une classe `@Controller(...)`.

```ts
interface EndpointFinding extends BaseScannerFinding {
  kind: 'endpoint'
  area: string
  file: string
  method: string
  path: string
  hasTests: boolean
}
```

```jsonc
{
  "kind": "endpoint",
  "title": "POST /auth/signin",
  "area": "auth",
  "file": "api/src/modules/auth/auth.controller.ts",
  "method": "POST",
  "path": "/auth/signin",
  "hasTests": true
}
```

`hasTests` est un signal heuristique. Il faut le recouper avec les constats `test` de la même zone avant d'affirmer une lacune de couverture.

## `ui-flow` — pages React

`react.scanner.ts` produit un constat par page référencée dans un manifeste `routes.tsx` ou `routes.ts`.

```ts
interface UiFlowFinding extends BaseScannerFinding {
  kind: 'ui-flow'
  area: string
  file: string
  route?: string
  formFields: string[]
  linkedEndpointGuess?: string
}
```

```jsonc
{
  "kind": "ui-flow",
  "title": "SignInPage (public/SignInPage)",
  "area": "public/SignInPage",
  "file": "web/src/pages/public/SignInPage.tsx",
  "route": "/signin",
  "formFields": ["email", "password"],
  "linkedEndpointGuess": "signin"
}
```

`linkedEndpointGuess` repose sur une correspondance de chaîne ; il doit être vérifié. Une page sans route détectable omet `route`.

## `entity` — modèles Prisma

`prisma.scanner.ts` lit les schémas mono-fichier et multi-fichiers. Les enums sont ignorés.

```ts
interface EntityField {
  name: string
  type: string
  optional?: boolean
  isId?: boolean
}

interface EntityRelation {
  field: string
  target: string
}

interface EntityFinding extends BaseScannerFinding {
  kind: 'entity'
  area: string
  file: string
  model: string
  fields: EntityField[]
  relations: EntityRelation[]
}
```

```jsonc
{
  "kind": "entity",
  "title": "Session",
  "area": "auth",
  "file": "api/prisma/schema/auth.prisma",
  "model": "Session",
  "fields": [
    { "name": "id", "type": "String", "isId": true },
    { "name": "userId", "type": "String" },
    { "name": "user", "type": "User" },
    { "name": "expiresAt", "type": "DateTime" }
  ],
  "relations": [{ "field": "user", "target": "User" }]
}
```

Les types PascalCase non scalaires sont considérés comme des relations candidates, même sans attribut `@relation` explicite.

## `test` — spécifications Jest

`tests.scanner.ts` émet un constat par fichier `*.spec.{ts,tsx}` ou `*.e2e.ts` contenant au moins un `describe` et un `it`/`test`.

```ts
interface TestFinding extends BaseScannerFinding {
  kind: 'test'
  area: string
  file: string
  describe: string
  cases: string[]
}
```

```jsonc
{
  "kind": "test",
  "title": "AuthService",
  "area": "auth",
  "file": "api/src/modules/auth/tests/unit/auth.service.spec.ts",
  "describe": "AuthService",
  "cases": ["hashes passwords with bcrypt", "rejects expired refresh tokens"]
}
```

Un fichier produit un seul constat ; ses cas sont conservés dans `cases[]`. Les fichiers sans cas sont ignorés.

## `doc-context` — documentation Markdown

`docs.scanner.ts` collecte les titres H1 à H3 de `README.md`, des fichiers d'instructions racine/API/Web et de `docs/**/*.md`. Le frontmatter est retiré.

```ts
interface DocContextFinding extends BaseScannerFinding {
  kind: 'doc-context'
  area: string
  file: string
  heading: string
  headingLevel: 1 | 2 | 3
  excerpt: string
}
```

```jsonc
{
  "kind": "doc-context",
  "title": "Authentication",
  "area": "docs",
  "file": "docs/auth.md",
  "heading": "Authentication",
  "headingLevel": 1,
  "excerpt": "Email + password sign-in with refresh tokens."
}
```

L'extrait est limité à 280 caractères. Il sert d'amorce ; l'agent ouvre le fichier quand il lui faut davantage de contexte.

## Alimentation des cinq catégories

| Section | Sources principales                                | Règle                                                                                    |
| ------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **UR**  | `doc-context`, inférence depuis les FR             | Un objectif utilisateur cohérent par zone                                                |
| **FR**  | `endpoint`, `ui-flow`                              | Une FR par endpoint ou petit groupe ; les routes deviennent des critères d'acceptation   |
| **DS**  | `entity`, contrats d'API, formulaires              | Modèle de données, contrat API et formulaire ; dédoublonnage par préfixe                 |
| **TC**  | `test.cases[]`, endpoints sans test                | Un TC par cas ; un TC TODO rend une couverture manquante visible                         |
| **NFR** | signaux auth/i18n/Prisma/Docker/Playwright/Swagger | Proposition P3 avec cible « proposed — needs human validation » avant validation humaine |

La compétence `sf-srs` contient les règles détaillées et reste la source de vérité du comportement de l'agent.

## Garanties de stabilité

Le pipeline respecte `.gitignore` et exclut notamment `node_modules`, `dist`, `coverage`, `.git` et `.vitepress/cache`. Les scanners s'exécutent dans l'ordre NestJS → React → Prisma → tests → docs ;
la découverte des fichiers est triée, donc une entrée identique produit un ordre identique.

Les codes de sortie suivent le contrat `srs-cli.sh` : `0` succès, `2` entrée invalide, `3` backend absent, `4` backend inconnu, `5` erreur d'exécution du scanner.

## Voir aussi

- [Tutoriel : partir d'un code existant](/fr/srs/walkthrough#rediger-depuis-un-code-existant)
- [Cycle SRS : phase ai-draft](/fr/srs/lifecycle)
- [`src/srs/scanners/types.ts`](https://github.com/DiamondForgeFr/SaasFoundryAI/blob/develop/src/srs/scanners/types.ts)

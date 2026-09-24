# Ce que SaaSFoundry vous apporte

SaaSFoundry réunit deux systèmes dans un même projet :

1. une **fondation SaaS préconstruite** avec authentification, RBAC multi-tenant, API typée, application React et runtime de production ;
2. un **harness de développement** qui relie les agents de code à vos spécifications, votre board, vos règles Git et votre workflow de validation.

Vous pouvez générer chaque système séparément ou les combiner. Les capacités optionnelles restent explicites : un inventaire n'est utile que s'il distingue ce qui est toujours présent de ce que vous
avez choisi d'installer.

```text
full    = fondation SaaS + harness de développement
stack   = fondation SaaS uniquement
harness = harness ajouté à une base de code existante
```

[Comparez les trois parcours d'installation](/fr/getting-started/setup-paths) ou examinez les [topologies générées](/fr/guide/monorepo-vs-multirepo).

## Vue d'ensemble

| Capacité                                              |     `full`     |    `stack`     |   `harness`    | Optionnelle |
| ----------------------------------------------------- | :------------: | :------------: | :------------: | :---------: |
| Authentification, modèle tenant et RBAC contextualisé |       ✓        |       ✓        |       —        |      —      |
| API NestJS, PostgreSQL et Prisma                      |       ✓        |       ✓        |       —        |      —      |
| Application React et socle d'interface bilingue       |       ✓        |       ✓        |       —        |      —      |
| Workflow, skills principaux et règles d'intégration   |       ✓        |       —        |       ✓        |      —      |
| Manifeste et cycle de mise à jour                     |       ✓        |       ✓        |       ✓        |      —      |
| MailerSend, S3, Analytics et PWA                      | Si sélectionné | Si sélectionné |       —        |      ✓      |
| Centralisation SRS et skills d'outils externes        | Si sélectionné |       —        | Si sélectionné |      ✓      |

La sélection exacte est enregistrée dans `.saasfoundry.json`, afin que le CLI et les agents de code lisent le même contrat de projet.

```json
{
  "profile": "full",
  "structure": "monorepo",
  "modules": {
    "harness": { "version": "1.0.0-beta" },
    "email": { "version": "1.0.0-beta" }
  }
}
```

Découvrez comment ce contrat évolue dans [Mettre un projet à jour](/fr/guide/updating-projects).

## Fondation SaaS

### Authentification et cycle de session

L'API générée inclut l'inscription, la connexion, la déconnexion, l'utilisateur courant, la confirmation de compte et la réinitialisation du mot de passe. Les stratégies NestJS Passport valident des
jetons d'accès courts et des jetons de renouvellement ; le navigateur reçoit les deux dans des cookies `httpOnly`, sans exposer les jetons au JavaScript applicatif.

```ts
async signIn(dto: SignInDto, response: Response) {
  const { accessToken, refreshToken, userId } = await authService.signIn(dto)
  authService.setAuthCookies(response, accessToken, refreshToken)
  return { userId }
}
```

Les mots de passe sont hachés avec bcrypt, les routes authentifiées utilisent `JwtAuthGuard` et l'état du jeton de renouvellement peut être invalidé à la déconnexion. L'application web fournit les
écrans de connexion, inscription, confirmation et réinitialisation associés.

Poursuivez avec [RBAC et multi-tenant](/fr/features/rbac) pour voir comment l'identité devient une autorisation.

### Modèle tenant, compte et entité

Le modèle de données représente une plateforme, des comptes clients, des organisations et des entités imbriquées, au lieu de laisser le multi-tenant à la première équipe produit. L'état du compte, les
adhésions, les invitations et les demandes de réactivation font partie du cycle généré.

```text
Plateforme
 └─ Compte
     ├─ Utilisateurs et attributions de rôles
     ├─ Profil de l'organisation
     └─ Entités (avec hiérarchie parent/enfant)
```

L'interface générée inclut l'administration de plateforme, les paramètres du compte, les utilisateurs, rôles, entités, invitations, le profil et la réactivation. Consultez
[RBAC et multi-tenant](/fr/features/rbac) pour le modèle d'application.

### RBAC contextualisé

L'autorisation est évaluée au niveau `PLATFORM`, `ACCOUNT` ou `ENTITY`. Les rôles combinent modules, sous-modules visibles et permissions d'action, tandis que des contraintes de base de données
rejettent les attributions incohérentes.

```ts
@RequireAccess({
  module: 'ACCOUNT_ADMINISTRATION',
  subModule: 'USERS'
})
findUsers() {}

@RequirePermissions(['ACCOUNT_USER_MANAGEMENT'], 'ACCOUNT_ADMINISTRATION')
updateUser() {}
```

Le frontend masque les routes et actions indisponibles pour la lisibilité, mais le guard NestJS reste l'autorité. Consultez le guide complet [RBAC et multi-tenant](/fr/features/rbac).

### Invitations et réactivation de compte

Les administrateurs de compte peuvent inviter des utilisateurs avec un rôle contextualisé ; les invités acceptent un jeton signé et expirant. Les clients désactivés peuvent soumettre une demande de
réactivation à la plateforme au lieu de dépendre d'un processus support improvisé.

```text
invitation créée → jeton émis → acceptation → rôle contextualisé attribué
compte inactif → demande → revue plateforme → compte actif
```

Lorsque le fournisseur d'e-mail est désactivé, les messages rendus restent visibles dans les logs de développement. L'installation du module [E-mail](/fr/modules/email) envoie les mêmes parcours via
MailerSend.

### Internationalisation

L'application React est configurée avec i18next, la détection de langue du navigateur et des ressources YAML. Les espaces de noms anglais et français sont initialisés pour l'authentification, la
navigation, l'administration de compte, le dashboard, la plateforme, le profil et les pages d'erreur.

```yaml
# apps/web/src/locales/fr/auth.yml
signIn:
  title: Connexion
  submit: Se connecter
```

Chaque nouveau domaine étend le même espace de noms dans les deux dossiers de locales. La préférence de langue est persistée sur l'utilisateur.

### PostgreSQL et Prisma

L'API utilise Prisma 7 avec l'adaptateur PostgreSQL et un schéma multi-fichiers découpé par domaine. Des fonctions SQL, triggers et données initiales protègent les invariants de portée des rôles et
installent les modules et rôles système initiaux.

```ts
export class PrismaService extends PrismaClient {
  constructor(env: EnvConfig) {
    super({
      adapter: new PrismaPg({ connectionString: env.get('DATABASE_URL') })
    })
  }
}
```

```text
prisma/schema/
├── schema.prisma
├── accounts.prisma
├── invitations.prisma
├── modules.prisma
├── organizations.prisma
└── users.prisma
```

Les configurations de développement local et de test utilisent également PostgreSQL, ce qui réduit l'écart avec la production.

### Contrat d'API typé

Les contrôleurs NestJS 11 décrivent les opérations avec les décorateurs Swagger. Les contrats de requête utilisent Zod 4 via `nestjs-zod` ; au démarrage, un document OpenAPI nettoyé est généré dans
`docs/openapi.json`.

```ts
export const createEntitySchema = z.object({
  name: z.string().trim().min(1),
  parentId: z.string().uuid().optional()
})

export class CreateEntityDto extends createZodDto(createEntitySchema) {}
```

Dans un monorepo, Orval transforme ce document en `api-client` partagé, avec ses hooks React Query. Les packages de validation, types et configuration partagés maintiennent les deux applications sur
le même contrat.

```text
schéma Zod → DTO NestJS → OpenAPI → client API généré → React Query
```

Consultez [Structure du projet](/fr/guide/project-structure) et [Monorepo ou multirepo](/fr/guide/monorepo-vs-multirepo).

### Application React

Le frontend généré utilise React 19, React Router 7, Vite, Tailwind CSS 4, les primitives Radix, des composants de style ShadCN, TanStack React Query et React Hook Form. Les routes publiques et
privées, providers de requêtes et d'erreurs, layouts, navigation et primitives responsives sont déjà connectés.

```tsx
const router = createBrowserRouter([...publicRoutes, ...privateRoutes])

root.render(
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>
)
```

En monorepo, les primitives réutilisables vivent dans `packages/ui-primitives` ; les projets multirepo intègrent les mêmes primitives dans le dépôt web.

### Expérience de développement et quality gates

Chaque application générée inclut TypeScript, une configuration ESLint flat, Prettier, Jest ou Vitest, des tests E2E d'API et des tests navigateur Playwright. Les hooks Husky valident les messages de
commit, les contrôles rapides avant commit et la gate plus lourde avant push.

```text
.husky/
├── prepare-commit-msg
├── commit-msg
├── pre-commit
└── pre-push
```

Docker démarre la base de développement, et une configuration Compose dédiée isole les tests de base de données de l'API. Les GitHub Actions générées tiennent compte de la topologie et peuvent limiter
les jobs aux surfaces modifiées par une pull request.

Le [guide des outils de développement](/fr/getting-started/tools) détaille la boucle locale.

### Runtime de production

Les projets API et web incluent des Dockerfiles multi-stage. Nginx sert la SPA compilée et relaie le trafic API, tandis que les health checks, la validation de l'environnement et les logs Winston avec
rotation rendent les échecs observables.

```dockerfile
FROM node:22-alpine AS builder
RUN npm run build

FROM nginx:alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
HEALTHCHECK CMD wget --quiet --tries=1 --spider http://localhost:80/ || exit 1
```

Le CLI valide le manifeste généré avant les opérations de cycle de vie. Des migrations numérotées du manifeste et des migrations de modules ordonnées mettent à jour la configuration possédée sans
écraser silencieusement le code de l'utilisateur.

Consultez [Mettre un projet à jour](/fr/guide/updating-projects) pour la prévisualisation, la comparaison à trois sources, les conflits et la récupération.

## Harness de développement

### Un contrat de projet unique

`.saasfoundry.json` enregistre la topologie, les ports, branches, outils, modules, profils d'agents et références des fichiers gérés. Les commandes du CLI et les skills générés le consomment au lieu
de dupliquer les informations du projet dans les prompts.

```bash
sf status --claude-friendly --no-network
```

Cette commande donne à l'agent de code un résumé déterministe et hors ligne avant toute modification. Consultez [Structure du projet](/fr/guide/project-structure).

### Workflow de livraison adapté à la complexité

Le harness fournit deux presets sécurisés. Le workflow équipe sépare la validation fonctionnelle de la revue de code ; le workflow Solo regroupe sa validation humaine dans la revue de PR.
L'installation interactive permet aussi de définir et d'enregistrer une séquence personnalisée.

```text
Backlog → Ready → In progress → AI testing
        → Human testing → In review → Done
```

```text
Solo : Backlog → In progress → AI testing → In review → Done
```

Dans le preset équipe, **Human testing désigne le test fonctionnel de la feature** et **In review désigne la revue de code**. La complexité adapte la profondeur d'analyse, de planification, de test et
de revue à l'intérieur des phases configurées.

```text
bug      correction directe + preuve de non-régression
low      implémentation légère
medium   analyse structurée et plan approuvé
complex  analyse approfondie et revue contradictoire
```

Les transitions passent par l'adaptateur du board configuré. GitHub Projects fournit le contrat v1 complet ; Jira et Linear sont expérimentaux. Notion est le backend SRS v1 complet, pas un tracker de
workflow complet. Commencez par [Workflow de livraison](/fr/guide/workflow-system).

### Skills et grammaire d'intégration

Les skills principaux `sf-*` apprennent aux agents à inspecter l'état du projet, respecter les gates des tickets, connecter les couches backend et frontend et utiliser l'outil de board sélectionné. Ce
sont des instructions du projet, pas une application séparée cachée hors du dépôt.

```text
.agents/skills/
├── sf-workflow/
├── sf-integration-rules/
├── sf-tool-github-projects/
└── sf-srs/                 # si sélectionné
```

Les règles d'intégration couvrent modèle Prisma → service/contrôleur NestJS → contrat partagé → hook React Query → route/formulaire → permission RBAC, afin d'éviter qu'une fonctionnalité ne soit
implémentée que dans une seule couche.

Consultez [Système de skills](/fr/guide/skills-system) et [Connecter vos outils](/fr/features/your-tools).

### Traçabilité des spécifications à la livraison

Lorsque la capacité SRS est sélectionnée, les exigences restent dans la source de vérité configurée et sont réconciliées avec les tickets natifs du board. Le harness propose les ajouts détectés dans
la conversation, attend une approbation explicite et préserve les relations Epic/FR/DS/TC.

```text
exigence → mise à jour SRS approuvée → ticket réconcilié
         → implémentation gardée → preuves de test → PR
```

La V1 fournit le backend Notion ; les autres backends sont des cibles d'adaptateur, pas des implémentations annoncées. Consultez [Une source de vérité SRS](/fr/srs/centralization) et le
[module SRS](/fr/modules/srs).

## Capacités optionnelles

Optionnel signifie **pris en charge et installable**, pas activé dans chaque scaffold. Sélectionnez ces capacités pendant `sf new` ou ajoutez plus tard les modules compatibles avec `sf update`.

### E-mail transactionnel

Le [module E-mail](/fr/modules/email) active MailerSend pour la confirmation de compte, la réinitialisation du mot de passe et les invitations. Sans lui, les mêmes templates et parcours restent
testables localement via les logs de développement.

```bash
sf update --add-modules email \
  --mailersend-api-key "$MAILERSEND_KEY" \
  --mailersend-sender-email noreply@example.com
```

### Stockage compatible S3

Le [module Stockage](/fr/modules/storage) ajoute les uploads, URL présignées, logos d'organisation et soit un service MinIO local, soit les identifiants d'un service compatible S3 existant.

```bash
sf update --add-modules storage --s3-setup docker
```

### Analytics et installation

[Analytics](/fr/modules/analytics) ajoute le chargement Umami uniquement en production et respectueux de la vie privée. [PWA](/fr/modules/pwa) ajoute le manifeste web, les icônes de marque et le
service worker nécessaires à une application installable.

```bash
sf update --add-modules analytics,pwa
```

### Outils externes

Des skills optionnels relient le harness à des services comme Notion, Jira/Confluence, Figma ou la documentation actuelle des bibliothèques. Une intégration déclarée dépend toujours des identifiants
et des capacités de l'hôte ; SaaSFoundry signale les combinaisons non prises en charge au lieu de prétendre que chaque connecteur est universellement disponible.

```bash
sf modules list
sf modules info storage
sf update --dry-run
```

Consultez [Connecter vos outils](/fr/features/your-tools) pour la matrice de support et le comportement en cas d'indisponibilité.

## Pour continuer

- [Créer votre premier projet](/fr/getting-started/first-project)
- [Comprendre les deux topologies générées](/fr/guide/monorepo-vs-multirepo)
- [Explorer le RBAC et le multi-tenant](/fr/features/rbac)
- [Livrer votre premier ticket](/fr/getting-started/shipping-first-ticket)
- [Mettre à jour sans perdre vos changements](/fr/guide/updating-projects)

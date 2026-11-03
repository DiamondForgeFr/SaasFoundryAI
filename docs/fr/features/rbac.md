# Un RBAC qui comprend la hiérarchie de votre SaaS

SaaSFoundryAI ne s'arrête pas à « admin » et « user ». L'application générée fournit un modèle d'autorisation complet pour une plateforme, ses comptes clients et les entités de chaque compte.

L'authentification établit l'identité. Le RBAC répond à la question plus difficile : **que peut voir ou modifier cette personne, dans ce contexte ?**

## Trois portées, un seul modèle de permissions

| Portée     | Cible de l'affectation | Rôle typique     | Périmètre                                                 |
| ---------- | ---------------------- | ---------------- | --------------------------------------------------------- |
| `PLATFORM` | Aucun compte ni entité | `platform-admin` | Administration transverse et opérations de plateforme     |
| `ACCOUNT`  | Un compte client       | `account-admin`  | Ce compte et, pour l'administration, ses entités          |
| `ENTITY`   | Une entité d'un compte | `entity-admin`   | Cette entité et les entités descendantes qu'elle gouverne |

Un rôle définit des capacités. Un `UserRoleAssignment` lie ce rôle à la bonne cible. Les contraintes de base de données refusent les combinaisons incohérentes : une affectation plateforme n'a aucune
cible, une affectation compte possède un `accountId` et une affectation entité possède un `entityId`.

```text
Utilisateur
 ├─ rôle PLATFORM ───────────────────────────► tous les comptes
 ├─ rôle ACCOUNT + accountId ────────────────► un compte
 └─ rôle ENTITY + entityId ──────────────────► une sous-arborescence
```

La portée plateforme n'exige pas de fausse adhésion à chaque compte. Les accès aux comptes et aux entités restent explicites, ce qui rend les frontières entre tenants vérifiables.

## Modules, sections et actions

L'autorisation comporte trois niveaux plutôt qu'une liste plate :

1. **Module** — la personne peut-elle entrer dans une zone comme `ACCOUNT_ADMINISTRATION` ?
2. **Sous-module** — peut-elle lire une section comme `USERS`, `ENTITIES`, `ROLES` ou `SETTINGS` ?
3. **Permission** — peut-elle réaliser une action comme `ACCOUNT_USER_MANAGEMENT` ou `ROLE_CUSTOM_MANAGEMENT` ?

Cette séparation rend les rôles en lecture seule naturels. Un rôle peut voir la section `USERS` sans recevoir de permission de mutation. Sélectionner une action dans l'éditeur de rôles généré ajoute
automatiquement sa section ; retirer la section retire aussi ses actions. Des triggers PostgreSQL imposent la même règle derrière l'interface.

```ts
@RequireAccess({
  module: 'ACCOUNT_ADMINISTRATION',
  subModule: 'USERS'
})
findUsers() {
  // Lecture : module + section visible
}

@RequirePermissions(
  ['ACCOUNT_USER_MANAGEMENT'],
  'ACCOUNT_ADMINISTRATION'
)
updateUser() {
  // Écriture : module + action requise
}
```

Le guard NestJS renvoie `401` en l'absence d'utilisateur authentifié et `403` lorsqu'un utilisateur authentifié ne possède pas la capacité requise dans la portée courante.

## La portée suit la requête

Un utilisateur détient plusieurs affectations de rôle (un rôle plateforme, un rôle de compte, un rôle par entité). Le guard ne compte que celles qui s'appliquent au compte ou à l'entité sur lesquels
la requête agit : un rôle détenu à un endroit n'autorise donc jamais une action ailleurs. Une route déclare sa cible avec `@ScopeFrom` :

```ts
@Patch(':id/status')
@RequirePermissions(['ACCOUNT_UPDATE'], 'ACCOUNT_ADMINISTRATION')
@ScopeFrom('id', 'ACCOUNT') // `:id` est un identifiant de compte
updateStatus() {}
```

| Cible                  | Affectations qui comptent                                                                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compte A (`'ACCOUNT'`) | Rôles plateforme ; rôles de compte détenus sur A. Les rôles d'entité d'une entité de A ne comptent que sur les routes qui l'activent avec `includeEntityAssignments`.               |
| Entité E (`'ENTITY'`)  | Rôles plateforme ; rôles de compte détenus sur le compte de E ; rôles d'entité détenus sur E ou sur l'un de ses ancêtres. Jamais un descendant, une entité sœur ou un autre compte. |

Le backend résout la cible dans cet ordre : le `@ScopeFrom` de la route, puis un paramètre de route historique `:accountId` ou `:entityId`, puis les en-têtes `X-Scope-Account-Id` /
`X-Scope-Entity-Id`. Les en-têtes sont l'indice le plus faible : ils ne sont lus que si la route ne déclare aucune portée, et ne peuvent donc pas détourner un contrôle du compte ou de l'entité nommés
dans l'URL. L'application React ne les envoie pas : elle reçoit la portée choisie depuis la session et filtre routes, onglets et actions avec le même vocabulaire de modules, sous-modules et
permissions. Masquer une action améliore la lisibilité ; le guard backend reste l'autorité.

Les routes du module `PLATFORM_ADMINISTRATION` ne comptent que les rôles plateforme, quelle que soit la cible : un rôle personnalisé de compte ou d'entité qui porte une section de plateforme ne donne
donc jamais l'accès plateforme. Une URL qui nomme un compte ou une entité inexistants répond `404`, et un compte auquel l'utilisateur n'appartient pas répond `401`, comme avant ; une cible à laquelle
l'utilisateur appartient mais sur laquelle il n'a aucun rôle applicable répond `403`.

Les services contrôlent ce que le guard ne voit pas. `PATCH /accounts/:id/users/:userId` contrôle chaque modification dans la portée où elle agit (`ACCOUNT_USER_MANAGEMENT` au niveau du compte pour
l'état actif, `USER_ROLE_ALLOCATION` au niveau du compte pour les rôles de compte, `USER_ROLE_ALLOCATION` dans la portée de l'entité pour chaque tranche d'entité), et `POST /invitations`,
`POST /entities` ainsi que les routes de rôles contrôlent la permission dans la portée de chaque cible. Un administrateur d'entité lit donc les utilisateurs et les rôles de son compte, invite des
utilisateurs et attribue des rôles dans son entité et dans le sous-arbre de celle-ci, et gère les rôles personnalisés de portée `ENTITY` du compte (ce sont des définitions de rôle valables pour tout
le compte, pas limitées à son entité). Il ne modifie rien d'autre au niveau du compte : ni rôle de compte, ni état d'utilisateur, ni paramètre du compte.

::: warning Endpoints sans portée

Un endpoint sans portée utilise l'union des affectations de l'utilisateur, ce qui permet à un rôle détenu dans un compte d'agir sur un autre. Toute route qui prend un identifiant de compte ou d'entité
doit le déclarer avec `@ScopeFrom` ; quand la cible n'est pas dans l'URL (corps de requête, identifiant de rôle), le service doit contrôler la permission dans la portée de chaque cible.

:::

::: tip Mettre à jour un projet généré avant la 1.1.1

Avant la 1.1.1, une route de compte ou d'entité était contrôlée contre l'union de tous les rôles de l'utilisateur : un rôle d'entité, ou le rôle d'administrateur d'un autre compte dont l'utilisateur
est simple membre, pouvait passer les contrôles d'administrateur de compte (un `entity-admin` fourni par défaut pouvait se promouvoir administrateur du compte). Le correctif touche des fichiers du
blueprint qu'aucun installeur ne possède : `sf update` l'applique par fusion à trois voies. Un fichier que vous n'avez pas modifié est mis à jour sur place ; un fichier modifié reçoit un fichier
annexe `.saasfoundry.new` à fusionner à la main. Les fichiers concernés sont `permissions.guard.ts`, `require-permissions.decorator.ts`, `authenticated-request.type.ts`, `jwt.strategy.ts`,
`jwt-auth.guard.ts`, `account-access.service.ts`, `account.controller.ts`, `account.service.ts`, `entity.controller.ts`, `entity.service.ts`, `invitation.service.ts` et
`shared-validation/invitation.ts`, ainsi que les nouveaux `scope-filter.ts`, `permission-checker.ts` et `authenticated-user.include.ts`.

Si vous avez modifié `jwt.strategy.ts`, fusionnez-le en premier : il doit charger l'`entity` de chaque affectation (reprenez `authenticatedUserInclude`). `AuthenticatedUser` exige désormais `entity` :
une stratégie périmée fait échouer `tsc` au lieu de retirer silencieusement à chaque administrateur d'entité ses droits sur les routes de compte jusqu'au prochain rafraîchissement du jeton.

Trois points changent pour le code que vous avez écrit :

- `PermissionsGuard` reçoit `AccountAccessService` en dépendance de constructeur. Le module est global ; ajoutez `AccountAccessModule` aux modules de test de vos propres specs e2e.
- Une route qui prend un identifiant de compte ou d'entité doit le déclarer avec `@ScopeFrom`, sinon elle garde l'union de tous les rôles.
- Les contrôles par cible répondent `403` ; les contrôles `401` existants gardent leur statut.

Une invitation vers une adresse qui en a déjà une en attente reprend désormais ses cibles et ses rôles seulement si vous avez le droit de les attribuer : l'invitation fusionnée est autorisée comme si
vous l'aviez soumise en entier. Les listes `accountIds`, `entityIds` et `roleIds` sont dédoublonnées et plafonnées (100, 100 et 20).

:::

## Rôles inclus dans un projet généré

| Rôle système     | Portée     | Usage prévu                                                   |
| ---------------- | ---------- | ------------------------------------------------------------- |
| `guest`          | Plateforme | Socle anonyme technique, non attribuable à un utilisateur     |
| `platform-user`  | Plateforme | Profil et mot de passe sans accès administratif               |
| `platform-admin` | Plateforme | Administration transverse de la plateforme                    |
| `account-user`   | Compte     | Membre d'un compte avec accès en lecture                      |
| `account-admin`  | Compte     | Administration des utilisateurs, entités, rôles et paramètres |
| `entity-user`    | Entité     | Membre limité à une entité                                    |
| `entity-admin`   | Entité     | Administration d'une entité et de sa sous-arborescence        |

Il s'agit de modèles système protégés, pas de conditions codées en dur. Les administrateurs peuvent faire évoluer leurs droits via l'API prévue, et les mises à jour de base de données conservent ces
choix. Des rôles personnalisés propres à un compte peuvent être créés dans l'éditeur généré ; leurs permissions sont filtrées par `applicableScopes`, empêchant par exemple un rôle d'entité de recevoir
une action réservée à la plateforme.

## Les invitations conservent la même frontière

Les invitations transportent leurs cibles compte, entité et rôle. Avant l'envoi, l'API vérifie que l'invitant :

- peut inviter dans chaque compte ou entité demandé ;
- peut attribuer des rôles ;
- ne peut attribuer un rôle plateforme que s'il dispose déjà de cette portée ;
- ne mélange pas un rôle plateforme avec des cibles compte ou entité ;
- n'attribue pas le rôle technique `guest`.

L'acceptation crée ensemble les liens utilisateur et les affectations de rôles contextualisées. Le scheduler généré traite les invitations expirées, et le flux d'e-mails anglais/français est déjà
relié au module d'invitation.

## Défense en profondeur

| Couche     | Protection                                                                           |
| ---------- | ------------------------------------------------------------------------------------ |
| React      | Routes, onglets et actions suivent la portée courante                                |
| NestJS     | Décorateurs et `PermissionsGuard` imposent module, section et action                 |
| Services   | L'autorité compte/entité et la visibilité descendante sont vérifiées sur les données |
| PostgreSQL | Cohérence des portées, sections, permissions et affectations uniques                 |
| Tests      | Des parcours live exercent l'isolation des comptes, entités et rôles                 |

Vous disposez ainsi d'un point de départ extensible, pas d'une promesse que toute future règle métier sera automatique. Pour chaque nouvelle capacité, étendez le catalogue de permissions, protégez
l'endpoint, exposez-le dans la portée courante et ajoutez les tests d'isolation correspondants.

## Où l'inspecter

- `apps/api/prisma/schema/users.prisma` — rôles et affectations contextualisées
- `apps/api/prisma/schema/modules.prisma` — modules, sections et permissions
- `apps/api/src/modules/auth/guards/permissions.guard.ts` — contrôle des requêtes
- `apps/web/src/hooks/auth/useModuleAccess.ts` — contrôle des capacités côté frontend
- `apps/web/src/components/dialogs/create-role-dialog.tsx` — éditeur de rôles personnalisés

Ces chemins décrivent un monorepo généré. En multirepo, les mêmes fichiers API et web se trouvent à la racine de leurs dépôts respectifs.

## Continuer

- [Topologie du projet](/fr/guide/monorepo-vs-multirepo)
- [Système de modules](/fr/guide/module-system)
- [Livrer votre premier ticket](/fr/getting-started/shipping-first-ticket)

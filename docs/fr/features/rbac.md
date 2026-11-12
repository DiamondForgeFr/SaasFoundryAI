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
utilisateurs et attribue des rôles dans son entité et dans le sous-arbre de celle-ci, et gère les rôles personnalisés de portée `ENTITY` utilisés uniquement dans ce sous-arbre (voir ci-dessous). Il ne
modifie rien d'autre au niveau du compte : ni rôle de compte, ni état d'utilisateur, ni paramètre du compte.

### Qui peut modifier un rôle

Les routes de rôles (`POST /accounts/:id/roles`, `POST /accounts/platform/roles`, `PATCH` et `DELETE /accounts/roles/:roleId`, `PATCH /accounts/roles/:roleId/status`) portent un identifiant de rôle :
c'est donc le service qui décide, et il répond `403` :

| Rôle                                                 | Qui peut le créer, le modifier, l'activer ou le supprimer                                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rôle système ou modèle global                        | Seulement un détenteur de `ROLE_CUSTOM_MANAGEMENT` via un rôle **plateforme**. Un rôle plateforme qui ne fait que consulter la console ne compte pas.   |
| Rôle personnalisé `ACCOUNT` du compte A              | `ROLE_CUSTOM_MANAGEMENT` sur A (un rôle de compte sur A, ou un rôle plateforme). Un rôle d'entité ne compte jamais.                                     |
| Rôle personnalisé `ENTITY` du compte A               | `ROLE_CUSTOM_MANAGEMENT` dans **chaque entité où le rôle est attribué** : l'administrateur du compte, ou un administrateur d'entité de leur sous-arbre. |
| Rôle personnalisé `ENTITY` de A, attribué nulle part | `ROLE_CUSTOM_MANAGEMENT` sur A ou sur l'une de ses entités.                                                                                             |

Deux règles s'ajoutent pour tous ceux qui ne sont pas la plateforme :

- **Personne n'accorde ce qu'il ne détient pas.** Chaque permission ou section qu'une requête ajoute à un rôle doit être détenue par l'appelant là où le rôle s'applique ; renvoyer ce que le rôle a
  déjà, ou lui retirer quelque chose, ne demande rien de plus. Un utilisateur qui détient un rôle personnalisé ne peut pas l'étendre pour dépasser celui qui l'a rédigé.
- **Aucun rôle de compte ou d'entité ne porte une section de plateforme.** Une section de `PLATFORM_ADMINISTRATION` est refusée sur un rôle `ACCOUNT` ou `ENTITY`, quel que soit le demandeur,
  plateforme comprise.

Les rôles système ne sont ni renommables ni supprimables par personne ; un administrateur de la plateforme fait évoluer leurs droits.

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

Avant la 1.1.1, les routes de rôles laissaient aussi tout détenteur de `ROLE_CUSTOM_MANAGEMENT` (dont l'`entity-admin` fourni par défaut) réécrire les droits d'un rôle système pour toute la
plateforme, poser une section de plateforme sur un rôle de compte ou d'entité, et modifier les rôles `ENTITY` d'une entité sœur ou étendre un rôle qu'il détient lui-même. La 1.1.1 applique les règles
de « Qui peut modifier un rôle » ci-dessus. Le correctif touche `account.service.ts`, `account-access.service.ts`, `permission-checker.ts` et la page web `account-roles.tsx` (plus le mock de test
`service-mocks.ts`), fusionnés par `sf update` de la même façon ; aucune migration de module n'est nécessaire, car aucun fichier n'est renommé, découpé ni ajouté. Si vous appelez vous-même
`getPermissionChecker` ou `ScopedPermissionChecker`, le nouveau troisième argument est facultatif. Un appelant hors plateforme qui touche un rôle système, ou un administrateur d'entité qui crée un
rôle `ACCOUNT`, reçoit désormais `403` là où il recevait `401`.

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

Il s'agit de modèles système protégés, pas de conditions codées en dur. Les administrateurs de la plateforme peuvent faire évoluer leurs droits via l'API prévue, et les mises à jour de base de données
conservent ces choix. Des rôles personnalisés propres à un compte peuvent être créés dans l'éditeur généré ; leurs permissions sont filtrées par `applicableScopes`, empêchant par exemple un rôle
d'entité de recevoir une action réservée à la plateforme, et leur auteur ne peut accorder que ce qu'il détient lui-même.

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

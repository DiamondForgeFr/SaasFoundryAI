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

Le backend résout le contexte d'autorisation actif à partir des en-têtes explicites ou des paramètres de route :

1. `X-Scope-Account-Id`
2. `X-Scope-Entity-Id`
3. `:accountId`
4. `:entityId`

L'application React reçoit la portée choisie depuis la session, l'envoie avec les appels API et filtre routes, onglets et actions avec le même vocabulaire de modules, sous-modules et permissions.
Masquer une action améliore la lisibilité ; le guard backend reste l'autorité.

::: warning Endpoints sans portée

Pour compatibilité, les endpoints sans indication de portée utilisent l'union des affectations de l'utilisateur. Tout nouvel endpoint sensible au tenant devrait porter une portée compte ou entité afin
d'imposer le contexte le plus étroit.

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

- [Topologie du projet](/guide/monorepo-vs-multirepo)
- [Système de modules](/guide/module-system)
- [Livrer votre premier ticket](/getting-started/shipping-first-ticket)

# Tutoriel SRS

Ce parcours active la SRS, rédige un Epic, le fait relire puis crée les Stories correspondantes. Comptez environ quinze minutes avec une intégration Notion déjà configurée.

Commencez par [centraliser les exigences produit](/fr/srs/centralization) si vous voulez comprendre la source canonique, les propositions de l'agent et les approbations humaines.

## Prérequis

- Un projet SaaSFoundryAI avec `.saasfoundry.json`.
- Un workspace Notion et un token d'intégration.
- Une page parente explicitement partagée avec l'intégration.

Une page racine SRS dédiée limite les droits de l'intégration au périmètre utile.

## 1. Activer la SRS

À la création :

```bash
sf new --non-interactive \
  --project-name tutorial-saas \
  --structure monorepo \
  --setup-repo local \
  --db-setup docker \
  --db-type postgresql \
  --email-service none \
  --no-analytics \
  --advanced-skills notion \
  --srs-enable \
  --srs-backend notion \
  --srs-parent-page-input "https://www.notion.so/your-workspace/SRS-root-abc123"
```

Dans un projet existant :

```bash
sf update --add-modules srs \
  --srs-backend notion \
  --srs-parent-page-input "https://www.notion.so/your-workspace/SRS-root-abc123" \
  --notion-api-token "secret_..."
```

Les deux chemins installent `sf-srs` et `sf-tool-notion`, puis écrivent `tools.srs` dans le manifeste. Vérifiez :

```bash
jq '.tools.srs' .saasfoundry.json
.claude/skills/sf-srs/scripts/srs-cli.sh validate
```

Un code de sortie `0` confirme que l'adaptateur Notion v1 peut initialiser la racine.

## 2. Créer le ticket de rédaction

Le travail SRS part d'un ticket auditable portant un label `srs:*` :

```bash
gh issue create \
  --title "Epic — Authentication & session management" \
  --body "First cut at the auth SRS. Will drive the signup / login / SSO feature tree." \
  --label "srs:new,complexity: medium"
```

Dans cet exemple, le ticket est `#42` :

```bash
.claude/skills/sf-workflow/workflow-cli.sh update-status 42 "Ready"
.claude/skills/sf-workflow/workflow-cli.sh update-status 42 "In progress"
```

## 3. Cadrer en conversation

Demandez par exemple :

> Rédigeons un Epic Authentication avec trois FR : connexion par mot de passe, SSO Google/GitHub et renouvellement de session. Chaque FR doit avoir des UR, DS et TC. Il n'existe pas de notes sources.

L'agent propose un `DraftCandidate[]` comprenant un Epic et ses FR. Aucune page n'est créée avant votre accord.

## 4. Lancer le rédacteur

```bash
.claude/skills/sf-workflow/workflow-cli.sh transition-drafting 42 ai-draft
.claude/skills/sf-srs/scripts/srs-cli.sh write --spec /tmp/draft-42.json
```

Après succès, Notion contient l'Epic, les pages `FR-001`, `FR-002` et `FR-003`, leurs sections UR/FR/DS/TC et une table de traçabilité. La page est désormais la source canonique.

## 5. Relire la spécification

```bash
.claude/skills/sf-workflow/workflow-cli.sh transition-drafting 42 human-review
```

Vérifiez que :

- les UR expriment le résultat attendu par l'utilisateur ;
- les DS décrivent réellement les bibliothèques, algorithmes et frontières ;
- les TC sont précis et exécutables.

Corrigez les détails directement dans Notion et consignez la décision sur le ticket. Cette revue de spécification est distincte du `Human testing` fonctionnel d'une fonctionnalité déjà codée.

## 6. Réconcilier et créer les Stories

Préparez d'abord le plan de réconciliation et exécutez un dry-run :

```bash
.claude/skills/sf-workflow/workflow-cli.sh transition-drafting 42 spawning \
  --epic "https://www.notion.so/your-workspace/Authentication-..." \
  --version "<version-url-or-id>" \
  --milestone v1.0.0 \
  --reconciliation-plan /tmp/reconcile.json \
  --dry-run
```

Après revue, relancez sans `--dry-run`. Le spawner réutilise les tickets canoniques existants et crée uniquement le travail manquant ou partiel. Les nouvelles Stories deviennent des sous-issues
natives en `Backlog`, avec leur lien FR, leurs critères TC et la chaîne UR → FR → DS → TC.

## 7. Terminer la rédaction

```bash
.claude/skills/sf-workflow/workflow-cli.sh transition-drafting 42 done
```

Le ticket de rédaction est fermé. Chaque Story générée entre indépendamment dans le workflow de code configuré : preset complet, Solo ou modèle personnalisé.

## 8. Faire évoluer la spec pendant le développement

Si une conversation révèle un nouveau cas d'acceptation, l'agent propose un ajout :

```text
💡 Cela ressemble à un TC sur FR-001.
   Proposition : TC-007 — accepter les caractères Unicode et emoji dans les mots de passe.

Appliquer via srs-cli.sh apply-update ? [accept / edit / reject]
```

Après acceptation :

```bash
echo '{
  "kind": "add-tc",
  "pageId": "<FR-001 page id>",
  "item": {
    "id": "TC-007",
    "title": "passwords containing unicode/emoji characters are accepted without error"
  }
}' | .claude/skills/sf-srs/scripts/srs-cli.sh apply-update
```

La v1 est additive : le nouveau bloc est ajouté en fin de page et sera rangé dans la section canonique lors de la prochaine revue.

## Rédiger depuis un code existant

Pour un produit mature dont le code est la meilleure source actuelle :

```bash
.claude/skills/sf-srs/scripts/srs-cli.sh draft --from codebase
.claude/skills/sf-srs/scripts/srs-cli.sh draft --from codebase --path /path/to/repo
```

Les scanners trouvent endpoints NestJS, écrans React, modèles Prisma, tests et documentation. L'agent groupe les constats par `area`, propose un Epic à la fois et affiche une couverture
UR/FR/DS/TC/NFR avant acceptation.

```text
🔍 Zone auth — 6 endpoints, 2 entités, 2 specs, 1 page, 1 bloc de documentation.

📘 Epic proposé : Authentication & session management
   ├─ FR-001 Password sign-in
   ├─ FR-002 Sign-up
   └─ FR-003 Session refresh

Accepter, modifier, rejeter ou ignorer cette zone ?
```

Une acceptation sérialise le cluster en `DraftCandidate[]` et appelle `write --spec`. Le reviewer peut corriger chaque zone avant toute écriture Notion. Consultez la
[référence des scanners](/fr/srs/scanner-findings).

## Dépannage

### `validate` retourne 5

Vérifiez `NOTION_API_TOKEN`, le partage explicite de la page racine et l'accès HTTPS à `api.notion.com`.

### Le spawn rencontre la règle 8

Une Story produit doit provenir de sa page FR via le spawner. Le bypass est réservé aux tickets réellement méta, avec une raison explicite.

### La table de traçabilité est obsolète

Limite v1 : l'adaptateur Notion ajoute les blocs sans remplacer une section existante. Une FR créée par `apply-update` apparaît comme page enfant, mais la table de l'Epic doit être rafraîchie pendant
la revue humaine.

## Et ensuite ?

- [Cycle de vie SRS](/fr/srs/lifecycle)
- [Module SRS](/fr/modules/srs)
- [Système de complexité](/fr/workflow/complexity-system)

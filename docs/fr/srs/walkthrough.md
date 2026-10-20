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

Définissez d'abord `NOTION_API_TOKEN` dans l'environnement du shell qui lance la commande, via votre gestionnaire de secrets. Ne placez pas le jeton dans les arguments ni dans une conversation avec
l'assistant.

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

Définissez `SF_UPDATE_NOTION_API_TOKEN` dans l'environnement avant de lancer :

```bash
sf update --add-modules srs \
  --srs-backend notion \
  --srs-parent-page-input "https://www.notion.so/your-workspace/SRS-root-abc123"
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
.claude/skills/sf-srs/scripts/srs-cli.sh validate --spec /tmp/draft-42.json
.claude/skills/sf-workflow/workflow-cli.sh transition-drafting 42 ai-draft --spec /tmp/draft-42.json
```

Sans option, la phase affiche la procédure de rédaction et ne modifie rien. `validate --spec` vérifie la spécification hors ligne ; `ai-draft --spec` l'écrit.

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

TC-007 apparaît dans le tableau « Test Cases (TC) » de la page de la fonctionnalité, avec la version de la page d'où il a été ajouté ; rien n'est ajouté en fin de page, sauf si le tableau manque.

## 9. Modifier une FR qui existe déjà

Plus tard, la revue du ticket #43 montre que la connexion par mot de passe doit aussi verrouiller le compte après cinq échecs, et qu'elle est P2 plutôt que P1 :

> La connexion par mot de passe doit verrouiller le compte après 5 échecs. Et c'est une P2, pas une P1.

C'est un changement d'une FR qui existe : l'agent propose un correctif `update-fr` plutôt qu'un élément ajouté. Il désigne la FR par son identifiant et les champs qui changent, et prévisualise d'abord
:

```bash
echo '{
  "kind": "update-fr",
  "frId": "FR-AUTH-001",
  "changes": {
    "priority": "P2",
    "acceptanceCriteria": { "add": ["the account is locked after 5 failed attempts"] }
  }
}' | .claude/skills/sf-srs/scripts/srs-cli.sh apply-update --dry-run
```

L'aperçu est un document JSON : `changes` liste chaque cellule qui changerait, ancienne et nouvelle valeur, et `changeLine` la ligne que la version gagnerait. Rien n'est écrit.

```jsonc
{
  "kind": "update-fr",
  "frId": "FR-AUTH-001",
  "dryRun": true,
  "changes": [
    { "where": "FR page › summary › Priority", "before": "P1", "after": "P2" },
    { "where": "FR page › Priority", "before": "P1", "after": "P2" },
    { "where": "FR page › Acceptance Criteria", "before": "• …", "after": "• …\n• the account is locked after 5 failed attempts" },
    { "where": "version \"v1 — MVP\" › FR table › Priority", "before": "P1", "after": "P2" },
    { "where": "feature \"Authentication\" › FR table › Priority", "before": "P1", "after": "P2" }
  ],
  "changeLine": { "status": "would-add", "text": "Amends FR-AUTH-001 — Password login (priority, acceptance criteria)" }
  /* … */
}
```

Après **acceptation**, l'agent lance le même correctif sans `--dry-run`. La page de la FR, le tableau des FR de sa version et celui de sa fonctionnalité affichent les nouvelles valeurs, la liste «
What changed » de la version gagne une ligne, et rien n'est ajouté. Appliquer le correctif une seconde fois n'écrit rien. Si l'écriture s'arrête en cours de route, la commande sort avec le code 6 et
affiche ce qui est appliqué et ce qui reste ; la relancer termine le travail.

La Story déjà générée pour la FR (#43) garde le texte qu'avait la FR à sa génération. Le `followUps` du résultat la nomme, et vous mettez son corps à jour à la main.

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

### Les références d'une FR, ou un UR / DS / TC, n'ont pas été modifiés

`apply-update` ajoute un UR, FR, DS, TC ou NFR et modifie sur place une FR qui existe (section 9). Il ne modifie pas les références d'une FR (`urRefs`, `dsRefs`, `tcRefs`, qui sont aussi listées dans
les tableaux des UR, DS et TC — [#1056](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1056)), ni un UR, DS, TC ou NFR qui existe déjà. Un correctif qui demande le premier est refusé avec le
code 2 et rien n'est écrit ; faites ces changements à la main pendant la prochaine revue humaine.

## Et ensuite ?

- [Cycle de vie SRS](/fr/srs/lifecycle)
- [Module SRS](/fr/modules/srs)
- [Système de complexité](/fr/workflow/complexity-system)

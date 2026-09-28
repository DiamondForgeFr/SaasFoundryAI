# Système de workflow

Le harness de développement SaaSFoundryAI transforme la politique de livraison en fichiers projet, commandes protégées et état de board. Les humains et les agents de développement lisent le même
`.saasfoundry.json` ; aucun des deux n’a besoin de reconstituer le processus à partir de l’historique d’une conversation.

## Ce qu’installe le harness

- `sf-workflow` — le routeur, les garde-fous et les instructions de chaque statut ;
- un skill d’outil de board — `sf-tool-github-projects` pour le parcours v1 complet ;
- la politique de branches, commits, pull requests et statuts dans `.saasfoundry.json` ;
- des profils de complexité pour adapter l’analyse et la revue ;
- des règles pour les tickets enfants natifs, plans de test et preuves de fusion.

Le workflow est indépendant de l’agent de développement. Claude Code peut utiliser son point d’entrée dédié ; Codex, Gemini CLI, Kimi Code, Qwen Code et les hôtes génériques consomment les
instructions partagées et les skills `sf-*` installés selon leurs capacités natives.

## Choisir la forme du workflow

### Équipe : `saasfoundry`

```text
Backlog → Ready → In progress → AI testing → Human testing → In review → Done
```

C’est le workflow complet documenté sur ce site.

- **`Human testing` signifie validation fonctionnelle de la feature :** vérifier le comportement dans un environnement réel à partir de la pull request en brouillon et du plan de test.
- **`In review` signifie revue de code :** rendre la même pull request prête, exécuter toute la CI et examiner l’implémentation avant la fusion.

Choisissez-le lorsque le comportement du produit mérite un contrôle fonctionnel séparé de la revue de code.

### Solo : `solo`

```text
Backlog → In progress → AI testing → In review → Done
```

Solo retire les colonnes séparées `Ready` et `Human testing`. Il conserve la planification, l’implémentation, les pushes, les preuves de test, la CI et les garde-fous de fusion. `In review` devient
l’unique barrière humaine : on y relit la pull request et, lorsque nécessaire, on y teste manuellement la fonctionnalité.

Sélectionnez un preset pendant la création ou l’ajout du harness :

```bash
sf new --project-name my-product --profile full --workflow saasfoundry
sf new --project-name my-product --profile harness --workflow solo
sf update --target-profile harness --workflow solo
```

Changez le preset d’un projet géré existant sur place :

```bash
sf workflow use solo
sf workflow use saasfoundry
```

La commande préserve board, branches et URL du projet, remplace l’ensemble de statuts, régénère leur documentation et tente d’aligner le GitHub Project configuré.

### Workflow personnalisé

La configuration interactive propose **Custom Workflow**. Définissez au moins deux statuts nommés, donnez à chacun une description exploitable par les agents et choisissez sa couleur de board. Vous
pouvez sauvegarder et réutiliser le résultat :

```bash
sf workflow save regulated-team
sf workflow create release-train
sf workflow list
sf workflow show-template regulated-team
sf workflow use regulated-team
```

::: warning Personnalisable ne signifie pas sans garde-fous

Les presets équipe et Solo sont les seuls parcours protégés de bout en bout en v1. Un modèle personnalisé peut enregistrer et synchroniser les étapes du board, mais l'installateur ne génère pas les
documents de statut complets ni des contrôles arbitraires pour de nouveaux noms. L'équipe doit étendre le skill installé avant d'utiliser cette séquence comme contrat de livraison.

:::

## Trois axes indépendants

| Axe               | Contrôle                                                           | Exemples                                   |
| ----------------- | ------------------------------------------------------------------ | ------------------------------------------ |
| Forme du workflow | Preset protégé ou extension avancée active                         | équipe, Solo, personnalisé                 |
| Complexité        | Profondeur d’analyse, de planification et de revue dans les phases | bug, low, medium, complex                  |
| Nature            | Propriété de la livraison et parcours autorisé                     | user-facing, internal, enfant groupé, Epic |

Un ticket complexe en Solo reçoit toujours une analyse approfondie et une revue contradictoire ; il possède simplement une seule barrière humaine sur la pull request au lieu de colonnes séparées pour
le test fonctionnel et la revue de code. Un ticket à faible risque dans le preset équipe traverse toujours les étapes configurées, avec une cérémonie plus légère.

La nature ajoute des exceptions protégées. Un enfant `nature:bundled-pr` n’a pas de pull request : son commit atomique est livré dans celle de son parent. Un Epic n’a ni branche ni pull request ; son
état est dérivé de ses enfants natifs.

## Cycle de vie de la pull request

Pour le preset équipe :

1. committer et pousser avant `AI testing` ;
2. publier le plan et le rapport de test ;
3. créer ou réutiliser une **pull request en brouillon** avant `Human testing` ;
4. laisser le développeur effectuer la validation fonctionnelle de la feature ;
5. après approbation et tests de non-régression, rendre la même PR prête ;
6. entrer dans `In review` pour la revue de code et la CI complète ;
7. attendre que le développeur fusionne ;
8. vérifier la fusion avant `Done`.

```bash
WORKFLOW=.claude/skills/sf-workflow/workflow-cli.sh

$WORKFLOW create-pr 42 --draft
$WORKFLOW ready-pr 42
$WORKFLOW update-status 42 "In review"
# developer merges
$WORKFLOW update-status 42 Done
```

Solo peut créer directement une pull request prête après `AI testing`, car sa phase `In review` constitue déjà la barrière humaine.

## Commandes de statut et de configuration

```bash
sf workflow show
sf workflow validate
sf workflow set-working-branch develop
sf workflow set-ai-rules

.claude/skills/sf-workflow/workflow-cli.sh status 42
.claude/skills/sf-workflow/workflow-cli.sh update-status 42 "AI testing"
```

Ne modifiez jamais le board directement pour contourner une transition refusée. Ce refus prouve qu’une condition d’entrée, une condition de sortie ou une preuve externe manque.

En v1, `sf workflow validate` contrôle uniquement les champs locaux du manifeste. Il ne compare pas les options du board distant : inspectez séparément le board configuré après toute modification des
statuts.

## Contrat du manifeste

```json
{
  "workflow": {
    "template": "SaaSFoundry AI Workflow",
    "tool": "github-projects",
    "projectUrl": "https://github.com/orgs/acme/projects/1",
    "workingBranch": "develop",
    "prTargetBranch": "develop",
    "requireCodeReview": true,
    "statuses": [
      { "name": "Backlog", "color": "GRAY" },
      { "name": "Ready", "color": "YELLOW" },
      { "name": "In progress", "color": "BLUE" },
      { "name": "AI testing", "color": "PURPLE" },
      { "name": "Human testing", "color": "ORANGE" },
      { "name": "In review", "color": "PINK" },
      { "name": "Done", "color": "GREEN" }
    ]
  }
}
```

Le manifeste est la source de vérité. Les noms de statuts, de branches et les cibles de pull request ne sont jamais déduits des exemples de documentation.

## Prise en charge des outils

| Adaptateur      | Contrat v1                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| GitHub Projects | Complet : issues, enfants natifs, champs de statut, milestones, garde-fous de PR et preuves de fusion |
| Jira            | Expérimental : des opérations utiles existent, sans garantie de parité complète                       |
| Linear          | Expérimental : des opérations sur les issues existent, sans garantie de parité complète               |
| Notion          | Backend SRS et documentaire, pas un tracker de workflow v1 complet                                    |

Exécutez `sf status --agent-friendly --no-network` pour inspecter la configuration déclarée sans prétendre que les identifiants ou l’accès réseau fonctionnent. Ne vérifiez la connexion que lorsque la
tâche a réellement besoin du service externe.

## Tickets de rédaction SRS

La rédaction de spécifications n’est pas une livraison de code. Les tickets portant `srs:drafting`, `srs:update` ou `srs:new` restent dans la colonne `In progress` du board et suivent :

```text
AI draft → Human review → Spawning → Done
```

Utilisez `workflow-cli.sh transition-drafting` ; le CLI refuse pour ces tickets les transitions du parcours de code.

## Continuer

- [Référence du workflow équipe à 7 statuts](/fr/workflow/7-status-system)
- [Système de complexité](/fr/workflow/complexity-system)
- [Intégration GitHub Projects](/fr/workflow/github-integration)
- [Connecter vos outils](/fr/features/your-tools)
- [Configuration par CLI ou agent](/fr/getting-started/setup-paths)

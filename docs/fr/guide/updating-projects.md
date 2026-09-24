# Mettre les projets à jour

`sf update` maintient un projet généré plusieurs semaines ou mois auparavant synchronisé avec les évolutions de SaaSFoundryAI. Il propage les nouveaux modèles, scripts et ensembles de skills sans
écraser les changements apportés à votre code.

Cette page explique ce que `sf update` fait, ce qu’il ne touche pas et comment résoudre les conflits.

## Ce que fait réellement `sf update`

La commande regroupe trois flux indépendants :

1. **Mise à jour des modèles** — détecte une version du CLI plus récente que celle du manifeste `.saasfoundry.json` et propage les évolutions du scaffold, par exemple un skill, une configuration
   NestJS ou un correctif de sécurité.
2. **Ajout de modules** — ajoute les modules absents lors de la génération : e-mail, stockage, analytics ou skills optionnels. Ce flux s’exécute indépendamment de la version.
3. **Transition de capacité gérée** — ajoute la stack technique ou le harness de collaboration manquant pour amener un projet géré éligible au profil `full`.

Tous les flux partent du manifeste et de la classification canonique des capacités, jamais d’une déduction à partir de `modules.harness` seul. Un projet **multirepo** issu de la release vérifiée
`saasfoundry-cli@1.0.0-beta` peut d’abord créer ce manifeste par le flux explicite d’adoption ci-dessous. La bêta publiée désactivait le monorepo : il n’existe donc aucune disposition monorepo bêta
authentique à adopter. Les autres projets sans manifeste sont refusés.

## Adopter un projet antérieur au manifeste

L’adoption d’un projet historique est séparée de la mise à jour des modèles et de l’ajout de modules. Elle ne prend en charge que la sortie multirepo de la release publiée
`saasfoundry-cli@1.0.0-beta`, épinglée par intégrité. Elle ne suppose pas qu’un dépôt NestJS/React arbitraire vient de SaaSFoundryAI et n’accepte aucune reconstruction synthétique en monorepo.
Commencez par une inspection en lecture seule propre à la release :

```bash
sf update --adopt-legacy --dry-run --json \
  --project-name my-app \
  --main-branch main
```

Le rapport compare l’inventaire historique complet API/Web à la release npm épinglée, exige les signatures critiques et une correspondance d’au moins 90 % des fichiers éligibles, classe les autres
fichiers personnalisés comme appartenant à l’utilisateur et retourne une `fingerprint`. Cette empreinte couvre chaque fichier inspecté, y compris ceux de l’utilisateur : toute modification entre
l’aperçu et l’application invalide le plan. Appliquez uniquement ce plan revu :

```bash
sf update --adopt-legacy \
  --project-name my-app \
  --main-branch main \
  --adopt-plan <fingerprint>
```

La commande crée seulement `.saasfoundry.json`. Elle ne remplace jamais un manifeste existant et refuse les chemins historiques manquants, une correspondance insuffisante, une signature critique
modifiée, les liens et liens physiques, fichiers spéciaux, collisions de casse ou une autre empreinte. Lancez ensuite `sf update --dry-run --json` pour examiner les modèles et modules. Les options
d’adoption ne se combinent pas aux options de module, workflow, stack, SRS ou identifiants : adoptez d’abord, mettez à jour ensuite.

Le manifeste adopté indique qu’un premier rafraîchissement reste à effectuer, même si les textes de version historique et actuelle coïncident. Ce marqueur n’est effacé qu’après un rafraîchissement
sans conflit non résolu.

## Promouvoir un projet géré vers le profil complet

Commencez par l’état canonique, puis prévisualisez la transition :

```bash
sf status --json --no-network
sf update --target-profile full --dry-run --json
```

- Un projet `harness` planifie une stack technique. Le mode interactif collecte topologie et choix techniques puis explique le futur profil `full` avant une confirmation unique.
- Un projet `stack` ajoute le harness de collaboration. `sf update --add-modules harness` reste compatible et mène au même résultat.
- Un projet `full` est déjà complet : la demande ne change rien.
- Une projection enfant multirepo délègue la transition technique au projet coordinateur racine.
- Un projet `unknown` ou `inconsistent` reste inchangé jusqu’à l’application de la remédiation indiquée.

Le plan de stack est atomique. Un fichier non géré sur un chemin généré, un lien dangereux, un fichier spécial, une collision de casse ou un conflit fichier/répertoire bloque toute la transition.
`replace`, `force` et les fichiers `.saasfoundry.new` ne contournent pas cette barrière d’adoption initiale. Le rapport JSON bloqué indique `"mutated": false`, liste les chemins et fournit une
remédiation exécutable.

Les fichiers préexistants identiques octet par octet restent la propriété de l’utilisateur et sont inscrits dans `unmanagedPaths` ; les mises à jour et ajouts futurs ne les absorbent pas. Les
commandes SaaSFoundry se coordonnent au moyen d’un verrou projet. Évitez qu’un autre outil local renomme ou remplace des chemins pendant l’application.

### Projet géré, produit externe ou POC ?

- **Projet harness géré sans produit sur les chemins candidats :** prévisualisez `sf update --target-profile full`.
- **Dépôt externe dont l’application existante reste le produit :** conservez le profil `harness`. La transition ne fusionne pas une application, ses dépendances, sa base ou ses données d’exécution
  dans la stack générée.
- **POC jetable à reconstruire :** utilisez le flux d’admission POC et de préservation approuvé, déplacez l’expérimentation sous `POC/`, puis créez un projet `full` propre à côté. Ne lancez jamais
  `sf new --profile full` dans le dossier du POC.

La transition v1 fonctionne sous macOS, Linux et Windows via WSL. L’exécution Windows native est rejetée avant toute modification.

## Fusion à trois sources

SaaSFoundryAI traite la mise à jour des modèles comme une fusion à trois sources :

| Entrée      | Définition                                                      | Source                              |
| ----------- | --------------------------------------------------------------- | ----------------------------------- |
| **base**    | Hash de chaque fichier tel que généré par l’ancienne version    | `.saasfoundry.json` → `fileHashes`  |
| **current** | Hash actuel du fichier dans le projet                           | Calculé par `sf update`             |
| **target**  | Hash du fichier que le nouveau CLI générerait pour ce manifeste | Régénéré dans un dossier temporaire |

Pour chaque fichier :

| Condition                                     | Action       | Résultat                                                               |
| --------------------------------------------- | ------------ | ---------------------------------------------------------------------- |
| `base == target`                              | **noop**     | Le modèle n’a pas changé.                                              |
| `base != target` et `current == base`         | **update**   | Le modèle a évolué et le fichier est intact : application automatique. |
| `base != target` et `current != base, target` | **conflict** | Le modèle et l’utilisateur ont modifié le fichier.                     |
| `!base` et `target` et `!current`             | **add**      | Nouveau fichier du modèle absent du projet : copie.                    |
| `!base` et `target` et `current != target`    | **conflict** | Un fichier utilisateur occupe déjà le chemin.                          |
| `base` et `!target` et `current == base`      | **remove**   | Le modèle a retiré un fichier intact : signalement uniquement.         |

Cette fusion est volontairement prudente :

- les modifications utilisateur ne sont jamais écrasées silencieusement ;
- un nouveau fichier ne remplace jamais un fichier utilisateur de même nom ;
- un fichier retiré du modèle est signalé, jamais supprimé automatiquement.

## Stratégies de conflit

`--conflict-strategy` propose trois comportements :

| Stratégie             | Comportement                                                                         | Usage                                                    |
| --------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `save-new` par défaut | Écrit la nouvelle version dans `<file>.saasfoundry.new` et laisse l’original intact. | Valeur sûre pour une fusion manuelle.                    |
| `keep`                | Conserve le fichier sans sidecar ni diff.                                            | Lorsque les modifications locales font autorité.         |
| `replace`             | Écrase le fichier avec le modèle. **Destructif.**                                    | Uniquement pour réinitialiser volontairement un fichier. |

::: warning `replace` est destructif

La stratégie `replace` écrit directement le modèle sur votre fichier. Il n’existe ni `.bak` ni annulation : vos changements sont perdus. Utilisez-la uniquement dans un contexte scripté, après avoir
committé.

:::

## Prévisualiser avant d’appliquer

`--dry-run --json` retourne un objet JSON versionné sans toucher au projet ni à une ressource externe :

```bash
sf update --dry-run --json --add-modules email
```

Les diagnostics destinés à l’humain vont sur stderr ; stdout reste analysable. Exemple de transition de profil :

```json
{
  "version": 1,
  "mutated": false,
  "profileTransition": {
    "targetProfile": "full",
    "currentCapabilities": {
      "technicalStack": "absent",
      "collaborationHarness": "managed",
      "effectiveProfile": "harness"
    },
    "status": "ready",
    "plan": {
      "version": 1,
      "mutated": false,
      "topology": "monorepo",
      "canApply": true
    }
  }
}
```

En CI, `sf update --dry-run --json > report.json` permet d’exposer les changements à venir avant leur arrivée sur la branche de travail.

## Ajouter des modules après génération

Les modules ignorés pendant `sf new` restent disponibles :

```bash
# Interactive
sf update

# Scripted
sf update --non-interactive \
  --add-modules email,storage \
  --mailersend-api-key $MAILERSEND_KEY \
  --s3-setup docker
```

`--add-modules` accepte une liste séparée par des virgules :

- `email` — e-mail transactionnel MailerSend ;
- `storage` — stockage objet compatible S3, via MinIO Docker ou identifiants externes ;
- `analytics` — analytics Umami auto-hébergés ;
- `pwa` — application installable, icônes, manifeste et service worker ;
- `harness` — skills et processus de collaboration, avec `--workflow solo|saasfoundry|none` en script ;
- `srs` — spécifications logicielles, avec Notion comme backend actuel ; Confluence et `local-markdown` sont prévus ;
- `sf-skill-context7`, `sf-skill-atlassian`, `sf-skill-notion`, `sf-skill-figma` — skills d’outils optionnels.

Les modules de stack sont préparés dans un dossier isolé avant toute modification. Si `keep` ou `save-new` laisse une collision, SaaSFoundry maintient le module absent du manifeste et n’installe pas
ses dépendances. Résolvez les chemins ou relancez volontairement avec `replace`, puis exécutez à nouveau `sf update` ; les fichiers déjà appliqués sont détectés et ne sont pas dupliqués.

Chaque module possède ses options d’identifiants. Consultez la référence [`sf update`](/fr/cli/sf-update).

## Activer le SRS sur un projet existant

Le [module SRS](/fr/modules/srs) fournit un système de spécifications avec Notion comme backend v1 :

```bash
# Interactive
sf update

# Scripted
sf update --non-interactive \
  --add-modules srs \
  --srs-backend notion \
  --srs-parent-page-input "https://www.notion.so/your-workspace/SRS-root-abc123" \
  --notion-api-token "secret_..."
```

L’installateur :

1. installe `sf-srs` sous `.claude/skills/sf-srs/` avec modèles, scripts et dispatcher ;
2. installe `sf-tool-notion` s’il manque ;
3. crée la page racine Epic dans Notion via `adapter.init()` — la page parente doit être partagée avec l’intégration ;
4. écrit `tools.srs.*` dans `.saasfoundry.json`.

### Importer des notes existantes une seule fois

```bash
sf update --non-interactive \
  --add-modules srs \
  --srs-backend notion \
  --srs-parent-page-input "https://www.notion.so/your-workspace/SRS-root" \
  --srs-ingest-enable \
  --srs-ingest-parent-input "https://www.notion.so/your-workspace/Legacy-notes" \
  --notion-api-token "secret_..."
```

Cette commande définit temporairement `tools.srs.pendingIngestion`. À la prochaine session d’un agent de développement configuré, le skill `sf-srs` guide le choix des pages historiques à transformer
en spécifications Epic/FR structurées, puis efface le marqueur lorsque `srs-cli.sh write` réussit.

Consultez le [parcours SRS complet](/fr/srs/walkthrough).

## Recette de mise à niveau

```bash
# 1. Vérifier l'arbre et créer une branche de sauvegarde
git status
git checkout -b backup/pre-sf-update
git checkout -

# 2. Mettre le CLI à niveau
npm install -g saasfoundryai-cli@latest

# 3. Prévisualiser
sf update --dry-run --json

# 4. Appliquer avec les conflits dans des sidecars
sf update --accept-template-updates

# 5. Examiner les sidecars
git status
find . -name "*.saasfoundry.new"

# 6. Fusionner chacun manuellement, puis le supprimer
rm **/*.saasfoundry.new

# 7. Relancer les tests et committer
npm test
git add -A && git commit -m "chore: sf update $(sf --version)"
```

`.saasfoundry.json` est réécrit à la fin d’une mise à jour réussie ; la prochaine exécution part donc d’une nouvelle `base`.

## Ce que `sf update` ne fait pas

- Il ne lance pas systématiquement `npm install` ou `prisma generate`. Les ajouts de modules peuvent installer leurs dépendances ; une simple mise à jour de modèles ne le fait pas.
- Il ne migre pas la base. Les évolutions Prisma sont seulement propagées comme fichiers ; exécutez séparément `npx prisma db push` ou `npm run db:setup:dev`, ce dernier reconstruisant et repeuplant
  la base de manière destructive.
- Il ne touche pas à l’historique Git et ne crée aucun commit. L’arbre reste modifié pour votre revue.
- Il ne met pas automatiquement les packages npm installés à niveau. `package.json` suit la même fusion ; `package-lock.json` est généralement exclu.

## Dépannage

### « before hash tracking »

Les premières versions n’enregistraient pas `fileHashes`. La mise à jour des modèles est alors ignorée et seul l’ajout de modules fonctionne. Pour réactiver le suivi, régénérez dans un dossier
temporaire avec les mêmes options, copiez le bloc `fileHashes`, puis committez-le.

### Tous les fichiers sont en conflit

Un formateur global lancé après génération a probablement modifié tous les hashes. Sur une branche propre, utilisez `replace` si vous êtes certain que les changements sont uniquement de mise en forme,
ou régénérez les hashes depuis un `sf new` temporaire avec les mêmes options.

### Le nouveau CLI a retiré un fichier intact

`sf update` le signale sans le supprimer. Supprimez-le manuellement :

```bash
git rm path/to/removed-file.ts
```

### Où sont les tests de fusion ?

- `src/__tests__/integration/commands/update.spec.ts`
- `src/__tests__/integration/commands/update.non-interactive.spec.ts`
- `src/__tests__/e2e/update-command.spec.ts`

Ils couvrent l’aperçu, les stratégies de conflit, l’ajout de modules et le mode non interactif.

## Voir aussi

- [Référence CLI `sf update`](/fr/cli/sf-update)
- [Système de modules](/fr/guide/module-system)
- [Structure d’un projet](/fr/guide/project-structure)

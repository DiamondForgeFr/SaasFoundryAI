# sf update

Faites évoluer un projet géré sans perdre vos changements. `sf update` est la commande de cycle de vie d'un projet SaaSFoundryAI existant. Elle découvre le projet grâce à `.saasfoundry.json`, migre
les métadonnées et modules gérés si nécessaire, compare les nouveaux templates à vos fichiers et peut ajouter des capacités écartées lors de la création.

```bash
sf update [options]
```

::: tip Prévisualiser d'abord

Utilisez `sf update --dry-run --json` avant une mise à jour automatisée ou importante. La prévisualisation n'écrit aucun fichier et ne lance aucun installateur ; son rapport versionné indique toujours
`"mutated": false`.

:::

## Le cycle de mise à jour

| Étape                      | Ce que fait `sf update`                                                                                                             | Limite de sécurité                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **1. Découvrir**           | Lit le manifeste racine et classe le stack, le harness, la topologie, les modules et leurs versions.                                | Un manifeste absent ou incohérent arrête la mise à jour normale.         |
| **2. Récupérer et migrer** | Récupère une transition technique interrompue, puis exécute les migrations de manifeste et de modules lors d'une vraie application. | Une version n'avance qu'après la réussite de sa migration.               |
| **3. Planifier**           | Régénère le template sélectionné à l'écart et calcule les ajouts de modules ou la transition de profil.                             | Le dry-run isole la génération et les effets fournisseurs.               |
| **4. Comparer**            | Compare la base enregistrée, les octets actuels et le nouveau template.                                                             | Vos modifications deviennent des conflits explicites.                    |
| **5. Appliquer**           | Écrit les ajouts et changements sûrs, puis suit la stratégie de conflit choisie.                                                    | Par défaut, un fichier divergent n'est pas écrasé : un sidecar est créé. |
| **6. Enregistrer**         | Persiste les capacités, versions de modules, ports, propriétés et nouvelles bases.                                                  | La prochaine exécution repart du dernier état terminé.                   |

Lancez la commande depuis le dossier qui possède le `.saasfoundry.json` concerné. Pour une transition de profil multirepo, il s'agit du coordinateur racine, pas d'une projection API ou web.

## Le manifeste est le contrat partagé

`.saasfoundry.json` relie trois dimensions :

- **Reproduction par le CLI :** topologie, ports, modules, fournisseurs et choix de génération décrivent le projet.
- **Propriété sûre :** `fileHashes` enregistre le contenu géré en dernier par SaaSFoundry ; `unmanagedPaths` conserve les chemins adoptés ou utilisateur hors de cette frontière.
- **Harness de développement :** workflow, agents, outils et configuration SRS indiquent aux hôtes de code les règles et intégrations actives.

Versionnez le manifeste avec les fichiers qu'il décrit. Ne copiez pas celui d'un autre projet et ne modifiez pas ses empreintes à la main : l'algorithme dépend de leur relation avec ce dépôt précis.

## Prévisualiser sans mutation

Prévisualisation lisible :

```bash
sf update --dry-run
```

Prévisualisation exploitable par une machine :

```bash
sf update --dry-run --json > plan-mise-a-jour-saasfoundry.json
```

`--json` exige `--dry-run`. Le CLI réserve stdout à un seul objet JSON versionné et envoie les diagnostics sur stderr. Le rapport peut lister les actions de template, modules choisis, blocages de
transition, codes de raison et remédiations exécutables, sans exposer le contenu des fichiers candidats ni demander les secrets fournisseurs.

Un dry-run n'est pas un jeton d'autorisation pour l'application. Relisez-le, gardez un arbre Git propre, puis relancez une commande d'application qui exprime la même intention.

## Comparaison des fichiers à trois voies

Pour chaque chemin géré, le CLI compare :

| Entrée     | Signification                                              | Source                               |
| ---------- | ---------------------------------------------------------- | ------------------------------------ |
| **Base**   | Les octets enregistrés lors de la dernière gestion.        | `.saasfoundry.json` → `fileHashes`   |
| **Actuel** | Les octets présents dans l'arbre de travail.               | Lecture au moment de la mise à jour. |
| **Cible**  | Les octets que le CLI actuel générerait pour ce manifeste. | Régénération isolée.                 |

La décision reste conservative :

| Situation                                                   | Résultat                                                  |
| ----------------------------------------------------------- | --------------------------------------------------------- |
| Le template n'a pas changé.                                 | Aucune action.                                            |
| Le template a changé et l'actuel égale encore la base.      | Mise à jour sur place.                                    |
| Le projet contient déjà la cible.                           | Aucune action.                                            |
| Le template et le fichier actuel ont tous deux divergé.     | Stratégie de conflit.                                     |
| La cible ajoute un chemin absent.                           | Ajout.                                                    |
| La cible ajoute un chemin occupé par d'autres octets.       | Stratégie de conflit.                                     |
| La cible retire un fichier géré encore identique à la base. | Suppression par la procédure protégée des fichiers gérés. |
| La cible retire un fichier que vous avez modifié.           | Conservation.                                             |

Les chemins inscrits dans `unmanagedPaths` restent hors de la carte de propriété. Un nouveau chemin de template ou de module déjà occupé par d'autres octets devient un conflit. Un module ajouté
tardivement est préparé hors du projet et soumis à ces contrôles avant d'enregistrer sa version ou ses dépendances.

## Stratégies de conflit

| Stratégie           | Comportement sur un fichier divergent                                     | Quand l'utiliser                                                               |
| ------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `save-new` (défaut) | Conserve votre fichier et écrit la cible dans `<chemin>.saasfoundry.new`. | Vous voulez fusionner manuellement après relecture.                            |
| `keep`              | Conserve votre fichier sans sidecar.                                      | Votre version doit rester la source de vérité.                                 |
| `replace`           | Remplace votre fichier par la cible générée.                              | Vous avez versionné ou sauvegardé l'arbre et voulez explicitement le template. |

```bash
sf update --accept-template-updates --conflict-strategy save-new
```

`--accept-template-updates` évite la confirmation interactive pour les évolutions sans conflit. Il ne transforme pas les conflits `save-new` ou `keep` en installation de module réussie : tant qu'une
collision de module subsiste, le module n'est pas versionné et ses dépendances ne sont pas rafraîchies. Résolvez les chemins puis relancez la commande.

::: danger `replace` supprime vos octets locaux

Le CLI ne crée aucune sauvegarde du fichier remplacé. Versionnez l'arbre et inspectez la prévisualisation avant de choisir `replace`.

:::

## Migrations et récupération

Une mise à jour peut combiner trois mécanismes distincts :

1. Les **migrations de manifeste** amènent les anciens schémas au format actuel.
2. Les **migrations de modules** exécutent la chaîne ordonnée de chaque module installé et n'avancent sa version qu'après succès.
3. Le **rafraîchissement du template** applique la comparaison ci-dessus ; ce n'est pas une migration de base de données de production.

Lorsqu'un projet `harness` reçoit le stack technique, SaaSFoundry utilise une transaction journalisée. Un prochain `sf update --target-profile full` tente d'abord une récupération sûre si un processus
s'est arrêté pendant la transition. S'il ne peut prouver ni commit complet ni retour arrière sûr, il s'arrête et signale les chemins non résolus.

Les changements de base applicative restent une opération de l'équipe. Relisez les changements Prisma ou SQL générés et utilisez les commandes du projet adaptées à l'environnement ; `sf update` ne
promet pas de migrer les données de production.

## Ajouter des capacités après la création

Sélection interactive :

```bash
sf update
```

Prévisualisation et application scriptées :

```bash
sf update --dry-run --json --add-modules email,analytics
sf update --non-interactive --add-modules email,analytics
```

Les choix disponibles dépendent du manifeste. Le catalogue comprend e-mail, stockage, analytics, PWA, SRS, les skills outils supportés et l'alias de compatibilité du harness pour un profil `stack`. Un
module déjà installé est ignoré.

### Converger vers le profil complet

Les transitions V1 sont uniquement additives :

| Profil actuel               | `--target-profile full`                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `harness`                   | Planifie puis ajoute un stack monorepo ou multirepo si chaque chemin candidat est absent ou strictement identique. |
| `stack`                     | Ajoute le harness de développement géré. `--add-modules harness` reste l'alias compatible.                         |
| `full`                      | Réussit sans modification.                                                                                         |
| `projection` multirepo      | S'arrête et renvoie vers le coordinateur racine.                                                                   |
| `unknown` ou `inconsistent` | S'arrête avec une remédiation du manifeste.                                                                        |

La V1 ne retire pas de module, ne regroupe ni ne sépare les dépôts, ne convertit pas monorepo↔multirepo et ne quitte pas le profil `full`.

```bash
sf status --json --no-network
sf update --target-profile full --dry-run --json
sf update --target-profile full
```

Pour une transition harness → full non interactive, fournissez tous les choix techniques requis :

```bash
sf update --non-interactive \
  --target-profile full \
  --structure monorepo \
  --db-setup manual \
  --db-type postgresql \
  --email-service none \
  --s3-setup manual \
  --no-analytics \
  --pwa
```

Une collision non gérée sur un chemin technique bloque tout l'ajout initial du stack ; aucune stratégie de conflit ne force cette adoption. Les transitions de profil fonctionnent sur macOS, Linux et
Windows via WSL en V1. Windows natif s'arrête avant mutation.

## Adopter un projet bêta vérifié

Un projet généré avant les manifestes ne peut pas suivre le cycle normal sans base de confiance. La V1 supporte uniquement la sortie multirepo vérifiée du paquet publié `saasfoundry-cli@1.0.0-beta`.

Prévisualisez et récupérez l'empreinte du plan :

```bash
sf update --adopt-legacy --dry-run --json \
  --project-name mon-app \
  --main-branch main
```

Appliquez exactement ce plan relu :

```bash
sf update --adopt-legacy \
  --project-name mon-app \
  --main-branch main \
  --adopt-plan <empreinte>
```

L'adoption vérifie la structure historique et les octets inspectés, puis écrit uniquement `.saasfoundry.json`. Elle ne remplace jamais un manifeste existant. Toute modification inspectée invalide
l'empreinte. Les options d'adoption ne se combinent pas avec les options modules, workflow, stack, SRS ou secrets ; lancez ensuite une mise à jour normale.

La bêta publiée ne générait pas de monorepo : les reconstructions synthétiques d'un monorepo bêta ne sont pas éligibles.

## Automatisation et secrets

Gardez les secrets hors des commandes générées et de l'historique shell. Les variables disponibles à l'application comprennent :

| Secret               | Variable d'environnement        |
| -------------------- | ------------------------------- |
| Mot de passe de base | `SF_UPDATE_DB_PASSWORD`         |
| Clé API MailerSend   | `SF_UPDATE_MAILERSEND_API_KEY`  |
| Clé d'accès S3       | `SF_UPDATE_S3_ACCESS_KEY`       |
| Secret S3            | `SF_UPDATE_S3_SECRET_KEY`       |
| Clé Context7         | `SF_UPDATE_CONTEXT7_API_KEY`    |
| Jeton Atlassian      | `SF_UPDATE_ATLASSIAN_API_TOKEN` |
| Jeton Notion         | `SF_UPDATE_NOTION_API_TOKEN`    |
| Jeton Figma          | `SF_UPDATE_FIGMA_API_TOKEN`     |

Exemple :

```bash
SF_UPDATE_MAILERSEND_API_KEY="$MAILERSEND_KEY" \
  sf update --non-interactive \
  --add-modules email \
  --accept-template-updates
```

## Checklist de récupération

Avant une mise à jour importante :

```bash
git status
sf status --claude-friendly --no-network
sf update --dry-run --json > plan-mise-a-jour-saasfoundry.json
```

Puis :

1. Versionnez ou sauvegardez l'arbre actuel.
2. Relisez le rapport et résolvez ses blocages.
3. Appliquez avec `save-new` sauf si un écrasement est intentionnel.
4. Inspectez `git diff` et chaque sidecar `.saasfoundry.new`.
5. Fusionnez ou écartez chaque sidecar explicitement, puis supprimez-le.
6. Lancez le build, le lint, les tests et la procédure de base requise par le projet généré.
7. Versionnez ensemble les fichiers mis à jour et `.saasfoundry.json`.

Si la commande échoue, suivez son message de récupération et relancez la même commande après correction. Ne supprimez pas les journaux de transition et ne réécrivez pas les empreintes de propriété
manuellement.

## Options

| Option                                                              | Description                                                            | Défaut      |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------- |
| `--non-interactive`                                                 | Échouer si une valeur obligatoire manque, sans poser de question.      | -           |
| `--dry-run`                                                         | Prévisualiser sans écrire ni lancer d'installateur.                    | -           |
| `--json`                                                            | Avec `--dry-run`, produire un objet JSON versionné sur stdout.         | -           |
| `--target-profile <profile>`                                        | Ajouter la capacité manquante pour atteindre `full` ; seule valeur V1. | -           |
| `--project-description <text>`                                      | Description utilisée lorsqu'un harness ajoute le stack.                | dérivée     |
| `--structure <structure>`                                           | `monorepo` ou `multirepo` pour harness → full.                         | -           |
| `--db-setup <setup>`                                                | `docker`, `credentials` ou `manual`.                                   | -           |
| `--db-type <type>`                                                  | `postgresql` ou `sql`.                                                 | -           |
| `--db-host`, `--db-port`, `--db-user`, `--db-password`, `--db-name` | Choix de base avec identifiants.                                       | -           |
| `--api-port`, `--web-port`                                          | Ports hôte API et web explicites.                                      | automatique |
| `--email-service <service>`                                         | `none` ou `mailersend`.                                                | -           |
| `--analytics` / `--no-analytics`                                    | Inclure ou ignorer Analytics dans un nouveau stack.                    | -           |
| `--pwa` / `--no-pwa`                                                | Inclure ou ignorer le support PWA.                                     | -           |
| `--accept-template-updates`                                         | Appliquer les évolutions sans conflit sans confirmation.               | -           |
| `--conflict-strategy <strategy>`                                    | `keep`, `replace` ou `save-new`.                                       | `save-new`  |
| `--add-modules <modules>`                                           | Modules à ajouter, séparés par des virgules.                           | -           |
| `--workflow <preset>` / `--no-workflow`                             | Configurer `solo`, `saasfoundry`, `none`, ou aucun workflow.           | -           |
| `--adopt-legacy`                                                    | Inspecter ou adopter un multirepo bêta vérifié.                        | -           |
| `--adopt-plan <fingerprint>`                                        | Appliquer le plan d'adoption exact déjà relu.                          | -           |
| `--project-name <name>`                                             | Nom généré d'origine pour la vérification historique.                  | dossier     |
| `--main-branch <branch>`                                            | Branche historique commune si elle n'est pas prouvée automatiquement.  | détectée    |
| `--s3-setup <setup>`                                                | Mode de stockage pour une transition ou un ajout compatible.           | -           |
| `--srs-backend <backend>`                                           | Backend SRS ; la V1 supporte `notion`.                                 | -           |
| `--srs-parent-page-input <url>`                                     | URL ou ID de la page racine SRS.                                       | -           |

Des options supplémentaires existent pour les secrets et intégrations des modules activés. Utilisez `sf update --help` pour la liste exhaustive actuelle.

## Poursuivre le cycle

- [Comprendre le modèle de mise à jour complet](/guide/updating-projects)
- [Inspecter l'état du projet](/cli/sf-status)
- [Comparer monorepo et multirepo](/fr/guide/monorepo-vs-multirepo)
- [Comprendre le cycle SRS](/srs/lifecycle)

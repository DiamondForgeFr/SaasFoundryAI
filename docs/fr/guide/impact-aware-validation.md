# Validation adaptée à l'impact

SaaSFoundryAI classe le changement Git avant de choisir les tests. Le même contrat portable et sans dépendance pilote les hooks locaux, le dépôt SaaSFoundryAI, les nouveaux monorepos, les dépôts
API/Web multirepo et les projets rafraîchis avec `sf update`.

L'objectif n'est pas d'affaiblir la validation. Il est de ne plus payer pour du travail sans rapport avec le changement, tout en conservant un fallback complet et conservateur.

```text
Plage Git ou index préparé
          │
          ▼
classifieur d'impact portable
          │
          ├─ documentation
          ├─ frontend
          ├─ backend
          ├─ contrats partagés
          ├─ harness / scaffold
          └─ cycle de vie
          │
          ▼
commandes locales ou étapes GitHub Actions
          │
          ▼
un contrôle obligatoire stable
```

## Ce qui s'exécute selon le changement

Le classifieur tient compte du profil du dépôt. Un chemin n'a pas le même sens dans le générateur SaaSFoundryAI, un monorepo généré, un dépôt API et un dépôt Web.

| Changement                                                              | Travail sélectionné                                                    | Travail volontairement évité                                 |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------ |
| Markdown ou `docs/` uniquement                                          | Garde-fous et contrôles de documentation                               | Build produit, tests unitaires/E2E, couverture, cycle de vie |
| Source Web générée                                                      | Contrôles frontend et cycle de vie concerné                            | Contrôles propres au backend                                 |
| Source API générée                                                      | Contrôles backend et cycle de vie concerné                             | Contrôles propres au frontend                                |
| Package partagé ou contrat API généré du monorepo                       | Suite partagée (consommateurs frontend + backend) et cycle de vie      | Aucun consommateur du contrat n'est ignoré                   |
| Contrat du harness ou du scaffold                                       | Contrôles harness/scaffold et cycle de vie si la sortie générée change | Travail propre à la documentation                            |
| Lockfile, configuration racine, workflow, classifieur ou chemin inconnu | Validation complète                                                    | Rien : l'ambiguïté élargit la validation                     |

Pour un renommage ou une copie, l'ancien et le nouveau chemin sont classés. Un déplacement API vers Web sélectionne donc les deux côtés. Les chemins dangereux, statuts Git non pris en charge, bornes
introuvables, configurations invalides et fichiers inconnus déclenchent une validation complète.

## Travail local

Le hook de pre-commit valide l'instantané préparé dans l'index Git, pas les modifications non indexées :

```bash
npm run test:staged
```

Inspectez une plage sans exécuter les commandes :

```bash
npm run test:impact -- \
  --base origin/develop \
  --head HEAD \
  --range-mode three-dot \
  --dry-run
```

Forcez la commande de niveau release :

```bash
npm run test:impact -- --base HEAD --head HEAD --full
```

Chaque projet stocke sa table de commandes dans `.saasfoundry/validation.json`. Les commandes sont des tableaux d'arguments, pas des chaînes shell fournies par les fichiers modifiés. Dans un projet
généré, les scripts portables résident sous `scripts/saasfoundry/` ; le classifieur et le runner sont copiés octet pour octet depuis l'implémentation canonique.

## Politique GitHub Actions

Les filtres de chemins ne décident pas si le workflow existe. Le classifieur s'exécute toujours, puis seules les étapes sélectionnées démarrent.

| Événement                                      | Plage et politique                                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Pull request draft                             | La classification reste visible ; les validations coûteuses sont différées                |
| Pull request prête                             | Diff trois points depuis la base ; sélectif sauf si la cible de release impose le complet |
| Merge queue                                    | Plage deux points du merge group ; même contrat que la PR                                 |
| Push ordinaire sur la branche de travail       | Plage deux points ; sélectif                                                              |
| Branche principale/release, tag `v*` ou `rc-*` | Validation complète forcée                                                                |
| Exécution planifiée ou manuelle                | Validation complète forcée                                                                |
| Classifieur absent de la base de confiance     | Fallback complet de bootstrap                                                             |

Pour les pull requests et les merge groups, GitHub Actions charge le classifieur depuis le commit de base de confiance. Une PR ne peut donc pas affaiblir ses propres règles afin d'éviter des tests. Le
premier déploiement dans un dépôt qui ne possède pas encore le classifieur exécute volontairement le plan complet.

Le fichier de workflow reste toutefois du code de la pull request. Protégez `.github/workflows/`, les scripts de validation canoniques et `CODEOWNERS` par une revue obligatoire des Code Owners avec
invalidation des approbations obsolètes, ou imposez le contrôle via un workflow obligatoire au niveau de l'organisation et stocké hors du dépôt. SaaSFoundryAI dépose les règles de propriété pour son
propre dépôt, mais les paramètres GitHub restent la frontière d'application. Ne remplacez pas ce mécanisme par `pull_request_target` si du code de la pull request est exécuté.

La protection de branche vise un contrôle stable : **`CI / Required gate`**. Il vérifie la version du contrat, les sorties booléennes et la concordance entre le plan demandé et le résultat du job. Un
job sélectionné absent ou en échec fait échouer ce contrôle.

## Comment les économies sont prouvées

Les tests du dépôt vérifient la sélection elle-même, pas un pourcentage marketing :

- un changement de documentation désactive frontend, backend, couverture et cycle de vie ;
- un fichier de documentation indexé exclut une modification source non indexée ;
- les changements API, Web et partagés se propagent à leurs vrais consommateurs sans rejouer des wrappers équivalents ;
- une modification racine ou de workflow sélectionne la commande complète ;
- les projets monorepo et multirepo reçoivent des classifieurs identiques ;
- le cycle de la version précédente prouve que `sf update` dépose les deux profils multirepo et reste idempotent.

Le gain de temps dépend du cache, de la taille du projet et des chemins modifiés. Mesurez-le avec les durées GitHub Actions et les artefacts de timing Docker. La garantie déterministe est plus précise
: si une voie n'est pas sélectionnée, sa commande ne démarre pas.

## Quand forcer la validation complète

Exécutez le plan complet avant une release, après une modification du classifieur ou du workflow, lorsqu'une migration externe change les hypothèses, ou si le plan sélectionné ne correspond pas au
risque perçu.

```bash
npm run test:full
```

La validation adaptée à l'impact optimise le feedback ordinaire. Elle ne remplace ni les preuves d'AI testing, ni le Human testing d'une fonctionnalité visible, ni la revue de code, ni la matrice
finale de release.

## Voir aussi

- [Développement](/fr/contributing/development)
- [Livrer votre premier ticket](/fr/getting-started/shipping-first-ticket)
- [Monorepo ou multirepo](/fr/guide/monorepo-vs-multirepo)
- [Workflow de livraison](/fr/workflow/introduction)

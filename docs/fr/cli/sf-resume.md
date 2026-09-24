# sf resume

Terminez une installation interrompue à la dernière étape.

`sf new` écrit tous les fichiers, puis exécute les étapes de finalisation : installation des dépendances, démarrage des services de développement, application du schéma de base de données et
génération du client ORM. Si l'une d'elles échoue, le projet sur disque est complet à une étape près. La terminer manuellement demandait trois commandes, dont une avec un nom de réseau Docker dérivé
du projet et une autre avec un chemin dépendant de la topologie. `sf` connaît déjà toutes ces informations : il les a utilisées lors de la première tentative.

## Utilisation

```bash
sf resume [--dry-run]
```

Exécutez la commande depuis la racine du projet, c'est-à-dire le dossier qui contient `.saasfoundry.json`.

## Options

| Option      | Description                                     | Valeur par défaut |
| ----------- | ----------------------------------------------- | ----------------- |
| `--dry-run` | Indiquer les actions prévues sans rien modifier | -                 |

## Fonctionnement

| Étape            | Vérification                                                                   |
| ---------------- | ------------------------------------------------------------------------------ |
| `dependencies`   | N'installe que ce qui manque : workspace racine en monorepo, API et web sinon  |
| `dev services`   | Démarre le conteneur de base de données, sauf si son port répond déjà          |
| `storage`        | Démarre les conteneurs MinIO, sauf si le port de la console répond déjà        |
| `database setup` | Applique le schéma, les fonctions SQL, les déclencheurs et les jeux de données |
| `ORM client`     | Régénère le client Prisma                                                      |

Chaque étape qui ne fait rien **explique pourquoi**. Une étape silencieuse est impossible à distinguer d'une étape réellement exécutée.

::: danger La commande ne réinitialise jamais une base contenant des données

`db:setup:dev` exécute `prisma db push --force-reset`. « Terminer l'installation » ne doit jamais signifier « réinitialiser la base sur laquelle vous travaillez ». L'étape destructive est donc refusée
dès que la base contient des tables, mais aussi lorsque le nombre de tables ne peut pas être lu. Une base illisible n'est pas une base vide.

:::

## Idempotente par conception

Lancer la commande sur un projet sain est sans risque et ne modifie rien. `docker compose up -d` réussit même lorsqu'un conteneur fonctionne déjà ; le lancer systématiquement annoncerait donc un
travail qui n'était pas nécessaire. Or « rien à terminer » est précisément la réponse attendue pour un projet déjà opérationnel.

Le stockage est contrôlé indépendamment de la base : un MinIO qui ne démarre pas ne doit pas empêcher l'application du schéma. C'est aussi pourquoi `sf new` démarre ces deux éléments séparément.

## Exemples

```bash
# Voir ce qui serait exécuté sans rien modifier
sf resume --dry-run
```

```bash
# Terminer l'installation
sf resume
```

Sortie typique pour un projet dont le stockage n'avait pas démarré :

```
🔧 Finishing the setup of "my-app"

  · dependencies      already installed
  · dev services      already answering on 5436
  ✓ storage           storage containers up
  · database setup    already set up
  · ORM client        already generated
```

## Quand la commande est proposée

`sf new` l'affiche lorsqu'une étape de finalisation échoue. L'écran final nomme l'étape, fournit la commande qui la termine et renvoie vers `sf resume` pour tout reprendre en une fois.

## Voir aussi

- [`sf status`](/fr/cli/sf-status) — vérifier sans modification si le projet peut réellement fonctionner
- [`sf new`](/fr/cli/sf-new) — créer le projet initial

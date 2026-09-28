# sf tools

Gérez plusieurs comptes d'accès aux services externes — Atlassian, Notion et Figma — utilisés par les skills avancées des agents de code.

## Utilisation

```bash
sf tools [subcommand] [options]
```

## Options

| Option                 | Description                                         | Valeur par défaut |
| ---------------------- | --------------------------------------------------- | ----------------- |
| `list`                 | Afficher tous les outils et leur nombre de comptes  | -                 |
| `accounts <tool>`      | Lister les comptes d'un outil                       | -                 |
| `add <tool> <account>` | Ajouter un compte à un outil                        | -                 |
| `use <tool> <account>` | Choisir le compte de l'outil pour le projet courant | -                 |
| `current`              | Afficher les comptes utilisés par le projet courant | -                 |

## Exemples

```bash
# Lister tous les outils disponibles
sf tools list
```

```bash
# Ajouter un compte Atlassian
sf tools add atlassian my-account
```

```bash
# Utiliser un compte précis dans le projet courant
sf tools use atlassian my-account
```

```bash
# Afficher les comptes du projet courant
sf tools current
```

## Voir aussi

- [Commandes du CLI](/fr/cli/sf-new)
- [Démarrage rapide](/fr/getting-started/quick-start)

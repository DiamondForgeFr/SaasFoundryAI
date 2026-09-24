# Publier la documentation

## Situation actuelle

**Le site n'a encore jamais été déployé.** La documentation se construit localement, mais GitHub Pages n'est pas activé sur le dépôt :

| Point                      | État                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| GitHub Pages               | non activé — `gh api repos/DiamondForgeFr/SaasFoundryAI/pages` retourne actuellement 404 |
| chemin de base             | `/`, adapté au serveur local et à un futur domaine personnalisé                          |
| déclencheur de déploiement | manuel uniquement, pour ne pas faire échouer une release avant l'activation de Pages     |

La documentation incluse dans le package npm reste la voie disponible en v1 : `sf docs` la sert localement, sans réseau.

## La consulter localement

```bash
npm run docs:dev     # http://localhost:5176
npm run docs:build   # sortie statique dans docs/.vitepress/dist
npm run docs:preview
```

Le port **5176** est défini dans `docs/.vitepress/config.mts`. Il évite le port 5173 utilisé par le frontend d'une application générée, afin que les deux puissent fonctionner en parallèle.

## Activer la publication

1. Dans le dépôt : **Settings** → **Pages** → **Source** → **GitHub Actions**. Cette opération est manuelle et réservée aux propriétaires.
2. Lancez une première fois `Deploy Documentation` depuis l'onglet Actions grâce à `workflow_dispatch`.
3. Vérifiez le déploiement et les routes anglaises et françaises.
4. Réactivez ensuite le bloc `push` commenté dans `.github/workflows/deploy-docs.yml` si les releases doivent publier automatiquement la documentation.

## Pourquoi `base` vaut `/`

La documentation sert deux contextes racine : la copie incluse dans le package et, plus tard, un domaine personnalisé.

Un site de projet `github.io/<repo>/` demanderait au contraire :

```ts
base: '/SaasFoundryAI/'
```

Respectez la casse exacte `SaasFoundryAI`, et adaptez également le `href` de la favicon dans la même configuration.

## Domaine personnalisé

1. Configurez le DNS :

   ```text
   CNAME: docs.example.com → diamondforgefr.github.io
   ```

2. Dans **Settings** → **Pages** → **Custom domain**, saisissez le domaine et activez **Enforce HTTPS**.
3. Ajoutez un fichier `CNAME` dans `docs/public/`, contenant ce domaine, afin que le prochain déploiement conserve la configuration.

Avec un domaine personnalisé, `base: '/'` reste correct.

Le précédent placeholder `https://docs.saasfoundry.io` n'est ni enregistré ni configuré dans le dépôt. Le domaine public doit être choisi et provisionné explicitement avant d'être annoncé.

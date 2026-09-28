# Publier la documentation

GitHub Pages est configuré pour ce dépôt avec **GitHub Actions** comme source. Le workflow `Deploy Documentation` construit les deux langues et publie le site statique à l'adresse
`https://diamondforgefr.github.io/SaasFoundryAI/`.

## Publier une révision validée

1. Mergez la modification documentaire dans `develop` via sa pull request relue.
2. Ouvrez **Actions → Deploy Documentation → Run workflow** et sélectionnez `develop`.
3. Attendez la réussite des jobs `build` et `deploy`.
4. Vérifiez l'[accueil anglais](https://diamondforgefr.github.io/SaasFoundryAI/), l'[accueil français](https://diamondforgefr.github.io/SaasFoundryAI/fr/) et un guide d'installation dans chaque
   langue.

L'environnement `github-pages` n'autorise actuellement les déploiements **que depuis `develop`**. Une branche de fonctionnalité peut construire le site, mais son job de déploiement sera refusé par
cette protection. Ne l'assouplissez pas pour prévisualiser une pull request : utilisez `npm run docs:dev` ou `npm run docs:preview`.

Le workflow reste volontairement manuel pendant la première publication et la revue. Si la documentation doit ensuite être publiée automatiquement après les merges, ajoutez un déclencheur `push` pour
la branche de publication choisie dans `.github/workflows/deploy-docs.yml` et réexaminez la règle de branche. Évitez de déclencher depuis `develop` et `master` simultanément : un push plus ancien
pourrait remplacer une documentation plus récente.

## La consulter localement

```bash
npm run docs:dev     # http://localhost:5176
npm run docs:build   # sortie statique dans docs-dist
npm run docs:preview
```

Le serveur de développement utilise le port **5176**, laissant 5173 au frontend d'une application générée. La CLI inclut aussi cette documentation : `sf docs` la sert hors ligne à la racine d'un
serveur local.

## Chemin de base

Le workflow Pages récupère le bon préfixe auprès de `actions/configure-pages`. Pour le site du dépôt, il construit avec `/SaasFoundryAI/` (respectez la casse du dépôt). Les builds locaux et inclus
dans le package utilisent `/` par défaut. Si un domaine personnalisé est configuré plus tard, l'action fournira `/` sans modifier le code. La favicon, les liens canoniques et les liens entre langues
suivent le même préfixe.

Pour reproduire localement le build du site du dépôt :

```bash
SF_DOCS_BASE=/SaasFoundryAI/ npm run docs:build
```

## Domaine personnalisé plus tard

1. Pointez le `CNAME` DNS du sous-domaine choisi vers `diamondforgefr.github.io`.
2. Renseignez ce domaine dans **Settings → Pages → Custom domain**, vérifiez le DNS et activez HTTPS.
3. Conservez un fichier `CNAME` correspondant dans `docs/public/` si la configuration Pages l'exige, puis vérifiez une nouvelle exécution du workflow et tous les liens.

N'annoncez pas un nom de domaine provisoire avant de l'avoir enregistré et configuré.

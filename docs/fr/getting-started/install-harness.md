# Installer le harness

Ajoutez le workflow de développement de SaaSFoundryAI à un dépôt existant. **Votre code applicatif reste en place** : le profil `harness` ajoute les instructions partagées des agents, les skills et un
manifeste de projet, sans remplacer votre API ni votre frontend.

## 1. Préparer la machine

Installez Git, Node.js 24.19.0 et npm 11. Docker n'est pas nécessaire pour installer uniquement le harness. Un agent de développement est facultatif si vous utilisez directement le CLI.

## 2. Installer dans le dépôt

```bash
cd votre-projet
npx saasfoundryai-cli new --profile harness
```

Le parcours interactif demande quels profils d'agents et quels outils d'équipe configurer. Vérifiez le récapitulatif avant de confirmer. La commande écrit `.saasfoundry.json` et des instructions de
projet révisables ; elle ne remplace pas votre stack technique.

Vous démarrez un nouveau SaaS ? Lancez `npx saasfoundryai-cli new` et choisissez **full** pour associer le harness à la fondation SaaS prête à l'emploi, ou **stack** pour la fondation sans workflow
géré.

## 3. Vérifier

```bash
npx saasfoundryai-cli status --agent-friendly --no-network
npx saasfoundryai-cli agents list --json
npx saasfoundryai-cli docs
```

La dernière commande ouvre la documentation embarquée dans le CLI, même sans le site hébergé. Pour utiliser la commande courte `sf`, installez le paquet une fois avec
`npm install -g saasfoundryai-cli`.

## Vous préférez demander à un assistant ?

Ouvrez le dépôt dans un assistant de développement capable de lire ses fichiers et d'exécuter des commandes, puis dites :

> Aide-moi à installer le harness de développement SaaSFoundryAI dans ce dépôt. Examine d'abord le projet existant, propose les commandes CLI et les profils d'agents adaptés à mes outils, puis demande
> mon accord avant de modifier les fichiers.

L'assistant peut guider le même parcours `npx saasfoundryai-cli new --profile harness` que ci-dessus ; il ne doit pas recréer le scaffold à la main. Claude Code, Codex, Gemini CLI, Kimi Code et Qwen
Code disposent de profils d'agents enregistrés. Pour un autre hôte, choisissez `generic` et vérifiez qu'il peut lire les instructions générées et exécuter les commandes requises. L'installation
facultative du **skill** `tool-saasfoundry` en une phrase cible actuellement Claude Code ; elle n'est pas nécessaire pour installer ou utiliser le harness avec un autre assistant.

GPT, DeepSeek, GLM et Kimi peuvent désigner des modèles ou des fournisseurs de modèles, pas nécessairement des hôtes d'agents. Utilisez-les dans un outil ayant accès au dépôt et au terminal ; pendant
l'installation, sélectionnez le profil de cet outil, pas le nom du modèle.

Pour les choix détaillés, les plateformes et la création d'un nouveau produit, consultez le [guide d'installation complet](/fr/getting-started/installation) ou les
[parcours CLI et assistant](/fr/getting-started/setup-paths).

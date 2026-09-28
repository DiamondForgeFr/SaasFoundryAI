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

Dans **Claude Code**, ouvrez le dépôt et dites :

> Install the SaaSFoundryAI skill from https://github.com/DiamondForgeFr/SaasFoundryAI, then help me set up the development harness in this repository.

L'assistant propose l'installation et demande votre accord avant de lancer le même CLI. Cette phrase d'amorçage du skill ne fonctionne actuellement de façon native que dans Claude Code. Avec Codex,
Gemini CLI, Kimi Code, Qwen Code ou un autre agent, suivez les étapes du terminal, sélectionnez son profil, puis ouvrez le dépôt configuré dans cet agent.

Pour les choix détaillés, les plateformes et la création d'un nouveau produit, consultez le [guide d'installation complet](/fr/getting-started/installation) ou les
[parcours CLI et assistant](/fr/getting-started/setup-paths).

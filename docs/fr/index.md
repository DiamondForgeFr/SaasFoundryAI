---
layout: home
hero:
  name: SaaSFoundryAI
  text: Un SaaS prêt pour la production, conçu pour les équipes humaines et IA.
  tagline: >-
    Confiez un seul lien à votre assistant IA : il génère un projet professionnel NestJS + React + PostgreSQL, puis livre les fonctionnalités avec des garde-fous qui maintiennent chaque contributeur,
    humain ou IA, dans le même workflow.
  actions:
    - theme: brand
      text: Commencer avec votre IA
      link: /getting-started/installation
    - theme: alt
      text: Utiliser le CLI
      link: /getting-started/quick-start
    - theme: alt
      text: Comprendre la philosophie
      link: /workflow/introduction
    - theme: alt
      text: GitHub
      link: https://github.com/DiamondForgeFr/SaasFoundryAI

features:
  - icon: 🚀
    title: Productif dès le premier jour
    details: >-
      Générez un monorepo complet — NestJS 11, React 19, PostgreSQL 16, Prisma 7, Docker, CI, hooks, tests, i18n et authentification — avec `sf new`. Vous développez la première fonctionnalité métier
      dès le premier jour, pas la deuxième semaine.

  - icon: 🎯
    title: Concentrez-vous sur ce qui rend votre produit unique
    details: Le socle technique est résolu une fois, au niveau du générateur. Vous évitez des semaines d'intégration pour consacrer votre temps aux fonctionnalités propres à votre produit.

  - icon: 🤝
    title: Un même workflow pour les humains et l'IA
    details: >-
      Un cycle en 7 statuts (Backlog → Ready → In progress → AI testing → Human testing → In review → Done) s'applique à chaque ticket, quel que soit son auteur. Votre agent IA travaille sur le board
      comme un développeur.

  - icon: 🛡️
    title: Des garde-fous qui protègent la qualité du code
    details:
      Commits conventionnels, validations pre-commit et pre-push, tickets structurés et contrôles de pull request. Les dérives sont détectées avant le merge, que l'auteur soit humain, IA ou les deux.

  - icon: 🧠
    title: Économe en tokens par conception
    details: >-
      Chaque ticket est classé bug, low, medium ou complex. L'IA adapte la rigueur du processus : analyse minimale pour une coquille, revue contradictoire complète pour une évolution critique. Vous
      payez pour la rigueur utile, pas pour le cérémonial.

  - icon: 🧩
    title: Évoluez avec `sf update`
    details: >-
      L'email, le stockage, l'analytics et le support des applications installables (PWA) sont fournis sous forme de modules composables. Ajoutez-les plus tard, recevez les améliorations du socle et
      restez aligné avec la dernière version du scaffold.

  - icon: 🛟
    title: Un manifeste validé et migré en sécurité
    details: >-
      `.saasfoundry.json` est validé par ajv contre un schéma JSON à chaque appel du CLI : les erreurs deviennent immédiatement exploitables. Les changements incompatibles passent par un registre de
      migrations numérotées, afin que `sf update` fasse évoluer les anciens projets sans correction manuelle.
---

## Commencez ici — une phrase pour votre assistant IA

> Installe le skill SaaSFoundryAI depuis https://github.com/DiamondForgeFr/SaasFoundryAI

Collez cette phrase dans Claude Code — ou dans tout assistant capable de lire un lien et d'exécuter des commandes — placez-vous dans le dossier où vous souhaitez travailler, puis décrivez votre
produit avec vos propres mots. L'assistant installe le skill, demande uniquement ce qu'il ne peut pas déduire et pilote la suite : génération du projet, modules, workflow et tickets.

::: details Ce que votre assistant fait avec cette phrase

```bash
# Installe le skill tool-saasfoundry au niveau utilisateur, dans ~/.claude/skills/tool-saasfoundry/
npx saasfoundryai-cli@beta skill install --yes --force
```

Le skill lit ensuite `.saasfoundry.json` lorsqu'il existe, pilote `sf` **sans interaction** et ne répond jamais aux questions interactives à votre place. Le contrat complet se trouve dans
[Système de skills](/guide/skills-system) et [`sf skill`](/cli/sf-skill).

:::

**Vous préférez le terminal ?** Le CLI est un parcours de premier ordre, pas une solution de repli — commencez par le [Démarrage rapide](/getting-started/quick-start).

## Pour les équipes qui prennent la qualité du code au sérieux — avec ou sans IA

SaaSFoundryAI n'est pas une simple couche autour de l'IA. C'est une **fondation SaaS professionnelle et un contrat de workflow** qui fonctionnent parfaitement avec une équipe entièrement humaine et
**s'adaptent naturellement lorsque des agents IA rejoignent l'équipe**.

Que vous soyez freelance sur un nouveau projet client, CTO lançant un produit ou équipe intégrant Claude Code à un workflow d'ingénierie existant, SaaSFoundryAI vous apporte la même chose : un socle
logiciel et un processus auxquels toute l'équipe peut se fier.

### L'idée centrale

Les workflows d'ingénierie traditionnels concentrent tous les garde-fous au niveau de la pull request. Cela fonctionne tant qu'un reviewer peut reconstruire mentalement l'intention de l'auteur. Le
modèle atteint ses limites dès qu'une partie du travail est réalisée par un agent IA sans mémoire des décisions précédentes.

**SaaSFoundryAI inverse ce modèle : les garde-fous vivent dans le workflow lui-même.** Lorsqu'une pull request apparaît, le code a déjà été planifié, relu, testé et validé par les humains et par
l'automatisation.

```text
Backlog → Ready → In progress → AI testing → Human testing → In review → Done
```

Chaque ticket suit les mêmes sept statuts. La rigueur de chaque étape **s'adapte au niveau de complexité du ticket**, afin de ne mobiliser le processus complet que lorsqu'il apporte de la valeur.

| Complexité     | Style                | Ce que fait l'IA                                             |
| -------------- | -------------------- | ------------------------------------------------------------ |
| 🐛 **bug**     | Correction directe   | Pas d'analyse préalable. Test de non-régression obligatoire. |
| 🟢 **low**     | Oneshot              | Analyse minimale, plan mental, sans validation préalable.    |
| 🟡 **medium**  | Structuré            | 2 à 4 agents d'exploration, plan détaillé et validation.     |
| 🔴 **complex** | Revue contradictoire | 6 à 10 agents, plan complet et revue de niveau OWASP.        |

Résultat : les changements simples restent légers, les évolutions critiques bénéficient de la rigueur nécessaire et **la consommation de tokens suit la valeur du travail**.

## Vos outils, pas un silo supplémentaire

Votre agent IA n'invente pas son propre gestionnaire de tâches. Il utilise l'outil que **vous** utilisez déjà :

| Outil           | Quand le choisir                                                      | Disponibilité           |
| --------------- | --------------------------------------------------------------------- | ----------------------- |
| GitHub Projects | Le choix par défaut : natif au dépôt, gratuit, avec sous-tickets.     | Disponible aujourd'hui  |
| Jira            | Gestion de projet mature, sprints et champs personnalisés.            | Sur la feuille de route |
| Notion          | Proche de la documentation, adapté aux équipes produit et ingénierie. | Sur la feuille de route |
| Linear          | Cycles rapides et structurés pour les startups.                       | Sur la feuille de route |
| ClickUp         | Gestion tout-en-un pour les équipes très orientées opérations.        | Sur la feuille de route |

::: info Outils pris en charge aujourd'hui

Le workflow IA fonctionne actuellement avec **GitHub Projects**. Les adaptateurs Jira, Notion, Linear et ClickUp sont prévus ensuite : le moteur de workflow est déjà indépendant de l'outil, seule
l'intégration propre à chaque board reste à livrer. Suivez l'avancement dans les [issues publiques](https://github.com/DiamondForgeFr/SaasFoundryAI/issues).

:::

Vous obtenez des tickets lisibles par tous, des colonnes standard et un historique qu'une personne non technique peut suivre. **Votre agent IA crée des sous-tickets, déplace les statuts, ouvre des
pull requests et laisse des commentaires exactement comme un développeur.** Les validations humaines se trouvent aux transitions naturelles (Ready, Human testing, In review), afin qu'une personne
confirme toujours avant que le code ne quitte l'équipe.

::: tip Personnalisable dans les prochaines versions

Le cycle en 7 statuts est aujourd'hui fixe, car il encode les pratiques que nous avons le plus éprouvées. Les prochaines versions vous permettront de **personnaliser le workflow lui-même** : renommer
les statuts, retirer les étapes optionnelles ou ajouter des phases propres à votre équipe. Le workflow s'adaptera ainsi à votre façon de travailler.

:::

## Comment ça fonctionne

Vous décrivez votre besoin ; l'assistant exécute la commande :

| Vous dites                                                          | Il exécute                                                                        |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| _« Je veux un SaaS avec un portail client et l'envoi de fichiers »_ | `sf new` — topologie, modules et outil de workflow déduits de la conversation     |
| _« Livrons le premier ticket »_                                     | `sf workflow` — Backlog → Done sur un véritable ticket                            |
| _« Notre projet est-il toujours à jour ? »_                         | `sf update` — améliorations du socle, nouveaux modules et résolution des conflits |

Vous pouvez également lancer directement les trois mêmes commandes depuis le terminal :

```bash
sf new my-saas           # choisir la topologie, les modules et l'outil de workflow
sf workflow              # suivre Backlog → Done pour un véritable ticket
sf update                # recevoir les améliorations, ajouter des modules, résoudre les conflits
```

Chaque commande respecte la même configuration `.saasfoundry.json`. Le workflow suivi aujourd'hui par votre équipe est donc celui que votre agent IA suivra demain.

## Prêt à essayer ?

- **[Commencer avec votre IA →](/getting-started/installation)** — une phrase confiée à un assistant, sans terminal.
- **[Utiliser le CLI →](/getting-started/quick-start)** — deux commandes, 60 secondes.
- **[Livrer votre premier ticket →](/getting-started/first-project)** — un parcours complet avec un exemple réel.
- **[Garder les exigences traçables →](/fr/srs/centralization)** — laisser l'agent structurer le SRS sans créer un silo privé supplémentaire.
- **[Comprendre la philosophie →](/workflow/introduction)** — pourquoi ce workflow existe et comment il reste fiable.

---

::: tip Éprouvé de bout en bout

SaaSFoundryAI est développé avec son propre workflow. Chaque fonctionnalité visible ici a suivi le même cycle en 7 statuts que celui utilisé par les projets générés. Si quelque chose casse chez nous,
nous le voyons avant que cela ne casse chez vous.

:::

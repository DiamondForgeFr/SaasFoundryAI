# Une source de vérité pour les exigences produit

SaaSFoundryAI ne cache pas les décisions produit dans une conversation et n'invente pas un dépôt de spécifications privé. Il écrit des exigences structurées dans le système que votre équipe peut
consulter, rechercher, relire et conserver après la fin de la session IA.

En v1, ce système est **Notion**. Le moteur SRS est indépendant du backend, mais Notion est le seul adaptateur livré de bout en bout aujourd'hui. Confluence et Markdown local sont sur la feuille de
route : ce ne sont pas encore des options opérationnelles.

::: tip Le contrat en une phrase

L'agent peut proposer et structurer une exigence ; **votre équipe l'approuve, puis le backend SRS configuré en conserve la version durable**.

:::

## Pourquoi les spécifications sortent de la conversation

Une conversation IA constitue une bonne mémoire de travail, mais une mauvaise source de vérité : les sessions sont personnelles, le contexte peut être compacté et les décisions restent difficiles à
retrouver pour le reste de l'équipe.

Un SRS externe donne la même référence à tous les contributeurs :

| Besoin        | Ce qu'apporte le SRS partagé                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------- |
| Revue produit | Les parties prenantes non techniques peuvent lire et commenter sans ouvrir le dépôt.              |
| Auditabilité  | Exigences, décisions de conception et tests restent visibles après la session de code.            |
| Recherche     | Un membre de l'équipe retrouve une exigence par fonctionnalité, identifiant ou formulation.       |
| Traçabilité   | UR, FR, DS, TC et tickets de livraison se référencent mutuellement.                               |
| Portabilité   | Le workflow dépend d'un contrat d'adaptateur, pas d'un historique de chat ni d'un fournisseur IA. |

Cela ne signifie pas que Notion est toujours préférable aux fichiers versionnés dans Git. C'est le choix produit de la v1 pour les équipes qui veulent partager une surface lisible entre produit et
ingénierie. Un adaptateur Markdown local est prévu pour les équipes qui souhaitent volontairement relire et versionner les spécifications dans le dépôt.

## Ce qui est livré en v1

| Capacité                                          | État    | Signification                                                                                                        |
| ------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------- |
| Contrat `SrsAdapter` indépendant du backend       | Livré   | Rédaction, navigation, écriture, mise à jour et génération de tickets n'importent pas directement un fournisseur.    |
| Adaptateur SRS Notion                             | Livré   | Création de pages, parcours des enfants, ajouts et génération de tickets depuis le SRS fonctionnent de bout en bout. |
| Adaptateur SRS Confluence                         | Roadmap | Le contrat le prévoit ; l'implémentation n'est pas livrée.                                                           |
| Adaptateur SRS Markdown local                     | Roadmap | Prévu pour les spécifications Git-native ; indisponible en v1.                                                       |
| Capture conversationnelle des exigences           | Livré   | L'agent propose un ajout et attend l'approbation avant toute écriture.                                               |
| Réconciliation des tickets fondée sur les preuves | Livré   | La génération compare SRS, board et implémentation avant de créer ou réutiliser un ticket.                           |

::: warning Indépendant du backend ne signifie pas que tous les backends sont disponibles

`tools.srs.backend` sélectionne une implémentation enregistrée. En v1, la seule valeur opérationnelle est `notion`. Un backend inconnu provoque une erreur explicite ; aucun repli silencieux n'est
effectué.

:::

## De l'idée à l'exigence durable

```text
Votre message
    │
    ▼
détecteur d'intention local ── aucun signal ──▶ poursuite de la tâche
    │ signal d'exigence
    ▼
l'agent propose un diff typé : UR / FR / DS / TC
    │
    ├── refuser   ──▶ aucune écriture
    ├── modifier  ──▶ réviser la proposition
    └── accepter  ──▶ sf srs apply-update
                            │
                            ▼
                     SrsAdapter configuré
                            │
                            ▼
                       page Notion
```

Le détecteur est local et rapide. Il recherche dans le message un langage d'exigence et envoie un rappel à l'agent de code. Il n'envoie pas le message à Notion et n'autorise aucune écriture.

L'agent ne peut intervenir qu'une fois par tour de conversation. Il doit montrer la destination et le contenu proposés, puis attendre `accepter`, `modifier` ou `refuser`. Seule une acceptation
explicite atteint `sf srs apply-update`.

## Un modèle de spécification traçable

SaaSFoundryAI relie cinq catégories :

| Catégorie                            | Question traitée                                           | Exemple                                                               |
| ------------------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------- |
| **UR** — User Requirement            | Pourquoi une personne ou l'entreprise en a-t-elle besoin ? | Le propriétaire d'un compte limite l'accès à une entité juridique.    |
| **FR** — Functional Requirement      | Quel comportement observable doit exister ?                | L'éditeur de rôles assigne des permissions limitées à une entité.     |
| **DS** — Design Specification        | Comment le comportement est-il représenté ou implémenté ?  | `UserRoleAssignment` stocke le scope et l'entité cible.               |
| **TC** — Test Case                   | Comment prouver l'exigence ?                               | Un utilisateur affecté à l'entité A ne peut pas lire l'entité B.      |
| **NFR** — Non-functional Requirement | Quelle contrainte de qualité s'applique ?                  | Les contrôles d'autorisation respectent le budget de latence convenu. |

Les identifiants construisent une chaîne lisible :

```text
UR-001 ──▶ FR-003 ──▶ DS-004
              └────▶ TC-007
              └────▶ NFR-002
```

Les liens comptent davantage que la numérotation. Un reviewer peut partir du besoin utilisateur, retrouver le comportement promis, inspecter sa conception et accéder aux preuves qui le valident.

## Piloté par un schéma, pas improvisé

Lorsque SaaSFoundryAI rédige depuis une base de code existante, des scanners collectent des faits : opérations, entités persistantes, parcours UI, tests et extraits de documentation. Le fichier
partagé `clustering-rules.json` définit ensuite comment transformer ces résultats en propositions relisibles.

Le processus est volontairement progressif :

1. **Collecter les preuves** dans le dépôt. Les scanners font de leur mieux ; pour une stack non prise en charge, l'agent doit lire directement le code au lieu de conclure que rien n'existe.
2. **Regrouper par domaine produit** en suivant la structure propre au dépôt, sans imposer les conventions de dossiers d'un framework.
3. **Proposer les Features, Versions et FR** autour de comportements cohérents, pas autour de fichiers isolés.
4. **Préparer les DS et TC** à partir des modèles, contrats d'opération, formulaires UI et tests exécutables.
5. **Rendre les manques visibles**. Une opération non couverte devient un cas de test TODO ; elle n'est jamais présentée comme testée.
6. **Demander une validation humaine** pour les exigences inférées et chaque NFR proposé avant l'écriture.

Les règles sont des données structurées afin que le comportement de rédaction puisse être relu et testé. Elles guident l'agent ; elles ne l'autorisent pas à inventer une intention produit absente.

## Le cycle dédié à la rédaction

Le travail de spécification ne prétend pas être une livraison de code. Un ticket portant `srs:new`, `srs:update` ou `srs:drafting` reste dans la colonne **In progress** du board tout en suivant ses
propres phases :

```text
Ready
  └─▶ In progress / brainstorm
         └─▶ ai-draft
                └─▶ human-review
                       └─▶ spawning
                              └─▶ Done
```

- **Brainstorm** fixe l'intention et le périmètre.
- **AI draft** écrit l'arbre de pages proposé via l'adaptateur configuré.
- **Human review** se déroule dans le backend SRS, où produit et ingénierie peuvent l'affiner ensemble.
- **Spawning** crée ou réutilise les tickets de livraison uniquement après l'approbation de l'arbre de pages.
- **Done** ferme le ticket de rédaction ; les tickets de livraison générés commencent leur workflow normal en Backlog.

Cette séparation préserve la lisibilité du board : le ticket de rédaction trace la décision de spécification, tandis que chaque Story générée trace l'implémentation et la livraison.

## Réconciliation entre spécification et tickets

SaaSFoundryAI ne transforme pas aveuglément chaque FR en nouveau ticket. Avant la génération, le plan de réconciliation doit vérifier trois sources de preuves :

1. **Board** — tickets ouverts et fermés, parenté native, statut et liens SRS canoniques.
2. **SRS** — la Feature ou Version sélectionnée et son ensemble complet de FR.
3. **Implémentation** — preuves qu'une exigence est livrée, partielle, manquante ou remplacée.

Chaque FR sélectionnée reçoit exactement une classification :

| Classification | Résultat                                                               |
| -------------- | ---------------------------------------------------------------------- |
| `delivered`    | Ne rien créer et conserver les preuves.                                |
| `superseded`   | Ne rien créer et conserver la raison de son remplacement.              |
| `partial`      | Réutiliser l'unique ticket canonique ou en créer un s'il n'existe pas. |
| `missing`      | Réutiliser l'unique ticket canonique ou en créer un s'il n'existe pas. |

La génération s'arrête avant toute mutation lorsqu'une source est indisponible, que le plan ne couvre pas exactement toutes les FR, que plusieurs tickets revendiquent la même page canonique ou qu'un
ticket existant appartient à un autre parent. Il s'agit d'un garde contre les doublons, pas d'un import au mieux.

## Configuration et secrets

Le manifeste stocke l'identité du fournisseur et les références durables des pages, jamais le secret :

```jsonc
{
  "tools": {
    "srs": {
      "enabled": true,
      "backend": "notion",
      "intentDetectorEnabled": true,
      "rootPage": {
        "id": "...",
        "url": "https://www.notion.so/...",
        "name": "SRS produit"
      }
    }
  }
}
```

`NOTION_API_TOKEN` reste dans l'environnement ou le gestionnaire de secrets configuré. L'intégration Notion doit être partagée uniquement avec les pages parentes qu'elle doit lire ou mettre à jour.

## Vous gardez le contrôle

Plusieurs niveaux de désactivation existent :

- **Pour une proposition :** choisissez `refuser` ; rien n'est écrit. Choisissez `modifier` pour corriger le diff avant validation.
- **Sans détection automatique :** définissez `tools.srs.intentDetectorEnabled` à `false`. Vous pouvez toujours demander explicitement une opération SRS.
- **Sans flux SRS :** définissez `tools.srs.enabled` à `false` pour désactiver les propositions automatiques et le flux de mise à jour conversationnel.
- **Sans module SRS :** ne l'activez pas dans `sf new`, ou ne l'ajoutez pas avec `sf update`.

Désactiver le détecteur n'est pas une migration de données. Les pages Notion existantes restent là où votre équipe les possède.

## Limites volontaires de la v1

- Les mises à jour conversationnelles fonctionnent uniquement par **ajout**. L'adaptateur Notion ajoute un élément clairement identifié ; un reviewer le réintègre à la section canonique lors de la
  prochaine revue SRS.
- Une proposition IA n'est pas une approbation. Aucune exigence n'est écrite avant l'acceptation de l'utilisateur.
- Les scanners fournissent des preuves, pas une compréhension exhaustive. Des résultats rares exigent une inspection guidée par un humain.
- Confluence et Markdown local sont des destinations architecturales, pas des adaptateurs livrés.
- Centraliser le SRS ne remplace pas les tickets. Le SRS définit le contrat produit ; le board trace la livraison.

## Continuer

- [Suivre le parcours Notion](/srs/walkthrough)
- [Comprendre le cycle de rédaction](/srs/lifecycle)
- [Lire le contrat des résultats de scanner](/srs/scanner-findings)
- [Voir comment vos outils restent les sources de vérité](/fr/features/your-tools)

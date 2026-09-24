# Installer avec le CLI ou un assistant IA

SaaSFoundryAI propose deux parcours d'installation de premier ordre. Vous pouvez répondre vous-même au CLI interactif, ou décrire le produit à un assistant qui traduit vos décisions en une commande
non interactive.

Les deux parcours utilisent le même moteur de configuration et les mêmes installateurs. Ils produisent le même `.saasfoundry.json`, les mêmes fichiers générés et le même workflow après l'installation.

## Choisir son parcours

| Choix                    | Idéal quand                                                                                                                  | Ce que vous contrôlez                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **CLI interactif**       | Vous découvrez SaaSFoundryAI, souhaitez voir chaque choix applicable ou préférez travailler uniquement dans le terminal.     | Chaque question et le récapitulatif final modifiable.                         |
| **Piloté par assistant** | Vous utilisez déjà Claude Code, savez décrire le produit souhaité ou voulez des recommandations fondées sur un POC existant. | L'intention, la commande proposée et l'approbation explicite avant exécution. |

Aucun parcours n'est plus puissant que l'autre. Le parcours assistant pilote le CLI par la conversation ; ce n'est pas un générateur différent.

## Parcours 1 — CLI interactif

Partez du dossier qui doit contenir le nouveau projet :

```bash
npx saasfoundryai-cli@beta new
# ou, après une installation globale :
sf new
```

Le CLI pose uniquement les questions qui s'appliquent aux décisions précédentes. Les étapes de configuration s'exécutent dans cet ordre :

1. **Profil d'installation** — projet complet, harness sur un code conservé ou socle technique.
2. **Profils d'agents de code** — quels outils compatibles partagent le harness.
3. **Projet et dépôt** — nom, description, branche, topologie et éventuels remotes.
4. **Services techniques** — base de données, email, stockage, analytics et application installable lorsqu'un socle est demandé.
5. **Outils d'équipe** — tracker, backend de documentation/SRS et contexte design.
6. **Workflow et langue** — preset de livraison et langue des SRS, tickets et commentaires de code.
7. **Skills et SRS** — skills outils optionnels et initialisation du SRS Notion.
8. **Récapitulatif modifiable** — sélectionnez une ligne à corriger, ou confirmez la génération.

### La première réponse change tout

| Profil    | Résultat                                                                                                            | À choisir quand                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `full`    | Socle SaaS technique et harness de collaboration géré.                                                              | Vous créez un nouveau produit ou reconstruisez un POC jetable.                            |
| `harness` | Workflow, skills, options SRS et instructions d'agents dans le dépôt courant, sans socle de remplacement.           | Le code existant reste le produit.                                                        |
| `stack`   | Scaffold technique sans outil de workflow ni SRS configuré ; les skills principaux gérés sont tout de même déposés. | Vous voulez volontairement l'architecture de base sans le workflow de collaboration géré. |

::: danger Ne générez pas un projet complet par-dessus un code conservé

Si le dépôt actuel reste votre produit, choisissez `harness`. Un harness géré pourra ensuite prévisualiser une transition additive avec `sf update --target-profile full --dry-run --json` ; un scaffold
complet n'est pas une stratégie de fusion sur place pour un code existant quelconque.

:::

### Relire avant de générer

Le parcours interactif se termine par un récapitulatif. Modifier une ligne rouvre l'étape responsable et recalcule les choix qui en dépendent. La génération ne commence qu'après avoir choisi **Confirm
and continue**.

Les réponses deviennent un objet de configuration validé. Le scaffold est ensuite rendu, les intégrations optionnelles sont initialisées, les empreintes des fichiers gérés sont enregistrées et
`.saasfoundry.json` est écrit.

Choisissez ce parcours pour comprendre chaque décision ou lorsqu'aucun assistant n'est disponible.

## Parcours 2 — piloté par assistant

Le bootstrap assistant en une phrase est aujourd'hui natif pour **Claude Code** :

> Installe le skill SaaSFoundryAI depuis https://github.com/DiamondForgeFr/SaasFoundryAI

Il installe le skill utilisateur `tool-saasfoundry` avec :

```bash
npx saasfoundryai-cli@beta skill install --yes --force
```

Le skill orchestre ensuite le même CLI. Il ne répond jamais aux questions Inquirer interactives et ne génère jamais les fichiers du scaffold à la main.

::: info Autres agents de code

Les harness générés peuvent déclarer des profils Codex, Gemini CLI, Kimi Code, Qwen Code, Claude Code et générique. Cette capacité est distincte du bootstrap en une phrase ci-dessus. Pour un autre
hôte, lancez une première fois le CLI interactif, sélectionnez son profil, puis ouvrez le projet généré avec cet hôte.

:::

### Comment l'assistant découvre l'installation

Le skill accepte trois styles de conversation :

| Mode        | Signal                                                   | Comportement                                                                      |
| ----------- | -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Guidé**   | « Je veux démarrer un SaaS. »                            | Pose une question pertinente à la fois et explique ses recommandations.           |
| **Express** | « Crée un monorepo avec PostgreSQL, stockage et email. » | Déduit une intention complète, présente un plan unique et demande une validation. |
| **Expert**  | Vous fournissez une commande partielle ou complète.      | Vérifie les véritables flags et valeurs, puis conserve vos choix.                 |

Avant de choisir les flags, l'assistant détermine le point de départ :

- **Espace vide** — propose `full` pour un nouveau produit.
- **Dépôt existant à conserver** — propose `harness` et laisse les fichiers techniques en place.
- **POC jetable à reconstruire** — le lit d'abord, challenge l'intention produit, le conserve dans `POC/` après approbation, puis génère le nouveau projet à côté.
- **Projet géré avec `.saasfoundry.json`** — lit son état et utilise `sf update`, pas un second `sf new`.

### Une conversation concrète

```text
Vous
  Je veux un nouveau SaaS B2B nommé acme-portal. Une même équipe possède
  l'API et le web. PostgreSQL en local, envoi de fichiers, emails
  transactionnels, GitHub Projects et Notion pour le SRS.
  J'utilise Claude Code et Codex.

Assistant
  Je comprends : nouveau monorepo complet, PostgreSQL et stockage objet
  gérés par Docker, MailerSend, GitHub Projects, SRS Notion et
  instructions partagées pour Claude Code + Codex.

  Commande proposée (secrets et identifiants externes masqués) :
  sf new --non-interactive --profile full \
    --project-name acme-portal --structure monorepo \
    --agents claude-code,codex --setup-repo local \
    --db-setup docker --db-type postgresql \
    --s3-setup docker --email-service mailersend \
    --tracker github-projects --docs notion \
    --srs-enable --srs-backend notion \
    --workflow saasfoundry --language fr \
    --no-analytics --no-start-services --start-apps none

  Il me manque la page parente Notion, l'identité d'expéditeur et les
  credentials des deux fournisseurs. Ils ne seront pas affichés dans le plan.
  Dois-je continuer une fois ces valeurs fournies ?
```

L'assistant construit une intention structurée et la passe dans la table de flags versionnée du skill. Il présente un résumé humain et la commande générée. Si vous changez une décision, il reconstruit
le plan plutôt que de modifier une chaîne shell opaque.

Seule une approbation explicite autorise l'exécution. En mode `--non-interactive`, une valeur manquante provoque un échec au lieu d'ouvrir une question cachée.

### Valeurs sûres et secrets

Le skill peut recommander un choix lorsque la description du produit le justifie :

- monorepo sauf si l'API et le web ont des propriétaires ou des calendriers de livraison distincts ;
- PostgreSQL géré par Docker pour le développement local ;
- aucun fournisseur email tant que le produit n'a pas besoin d'invitations, de réinitialisation de mot de passe ou de reçus ;
- analytics désactivé tant que la mesure ne fait pas partie du plan produit ;
- PWA activée sauf si l'installation doit volontairement être impossible.

Les recommandations sont visibles avant l'exécution. Les choix à fort impact — conserver un code existant, choisir où vit le SRS et où arrivent les tickets — ne sont jamais devinés.

Les credentials ne sont demandés que si l'intégration correspondante est sélectionnée. Ils sont masqués dans les récapitulatifs et ne doivent jamais être enregistrés dans `.saasfoundry.json`.

## Là où les deux parcours convergent

```text
réponses interactives                  intention conversationnelle
         │                                      │
         ▼                                      ▼
 session du config-engine            plan tool-saasfoundry
         │                                      │
         └──────────────┬───────────────────────┘
                        ▼
              options sf new validées
                        │
                        ▼
      scaffold + installateurs + empreintes
                        │
                        ▼
           .saasfoundry.json + projet
                        │
                        ▼
            sf status / sf update / workflow
```

Le manifeste enregistre la topologie, les ports, les modules, la langue, le workflow, les outils, les déclarations d'agents et les empreintes des fichiers gérés. Il devient la source de vérité des
lectures et mises à jour futures, quelle que soit la façon dont les réponses initiales ont été collectées.

Après la génération, les deux utilisateurs lancent les mêmes vérifications :

```bash
cd acme-portal
sf status --agent-friendly --no-network
sf agents list --json
```

Tous deux font ensuite évoluer le projet avec la même commande :

```bash
sf update --dry-run --json --non-interactive
```

L'assistant montre normalement cette prévisualisation avant de demander l'application. L'utilisateur du CLI peut inspecter et appliquer le même plan directement.

## Ce qui ne converge pas automatiquement

- Sélectionner un profil d'agent n'installe ni n'authentifie cet outil de code.
- Un contrôle de credentials réussi ne prouve pas que l'hôte expose l'intégration à chaque agent.
- Le bootstrap assistant ne rend pas les secrets portables entre machines.
- `harness`, `stack` et `full` restent des profils de capacités différents, même s'ils partagent le même format de manifeste.
- Un dépôt externe n'est pas fusionné silencieusement dans un nouveau scaffold.

## Continuer

- [Installer les prérequis](/getting-started/installation)
- [Suivre l'installation la plus courte](/getting-started/quick-start)
- [Créer et inspecter un premier projet](/getting-started/first-project)
- [Lire la référence complète de `sf new`](/cli/sf-new)
- [Comprendre les mises à jour sûres](/cli/sf-update)

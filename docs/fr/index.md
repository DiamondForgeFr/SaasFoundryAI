---
layout: home
hero:
  name: SaaSFoundryAI
  text: Livrez le produit. Pas le boilerplate.
  tagline: >-
    Une fondation SaaS prête pour la production et un harness de développement indépendant des fournisseurs, conçus pour que les humains et plusieurs agents IA livrent selon les mêmes règles.
  actions:
    - theme: brand
      text: Démarrer avec l'agent
      link: /fr/getting-started/installation
    - theme: alt
      text: Utiliser le CLI
      link: /fr/getting-started/quick-start
    - theme: alt
      text: Explorer le système
      link: /fr/features/built-in
---

<dl class="sf-proof-strip" aria-label="Résumé du produit">
  <div><dt>2 fondations</dt><dd>application + livraison</dd></div>
  <div><dt>Jusqu'à 7 étapes sécurisées</dt><dd>parcours Team complet</dd></div>
  <div><dt>6 profils d'agents</dt><dd>un seul harness partagé</dd></div>
  <div><dt>1 contrat</dt><dd>.saasfoundry.json</dd></div>
</dl>

<section class="sf-home-section">
  <span class="sf-home-eyebrow">LE CONTRAT DE LIVRAISON</span>
  <h2>Les garde-fous vivent avant la pull request.</h2>
  <p class="sf-home-lead">
    Le preset équipe suit sept étapes visibles. La nature du ticket active des raccourcis explicites et contrôlés pour le travail interne, les changements groupés et les Epics. Les humains valident
    l'intention et le comportement ; l'automatisation vérifie le code ; le board connecté conserve la piste d'audit. GitHub Projects fournit le contrat de livraison v1 complet ;
    les adaptateurs de board Jira et Linear sont expérimentaux.
  </p>

  <ol class="sf-status-flow" aria-label="Workflow SaaSFoundry équipe en sept étapes">
    <li>Backlog</li>
    <li class="sf-human-gate">Ready<span class="sf-gate-label">intention validée</span></li>
    <li>In progress</li>
    <li>AI testing</li>
    <li class="sf-human-gate">Human testing<span class="sf-gate-label">test fonctionnel</span></li>
    <li class="sf-human-gate">In review<span class="sf-gate-label">revue de code</span></li>
    <li>Done</li>
  </ol>

  <p><strong>Chaque validation dit ce que l'humain fait réellement.</strong> Human testing vérifie la fonctionnalité dans un environnement réel ; In review relit le code de la pull request prête. L'agent prépare les preuves, mais ne valide pas son propre travail.</p>

  <div class="sf-workflow-choice" role="list" aria-label="Configurations de workflow disponibles">
    <div role="listitem"><strong>Équipe · 7 statuts</strong><span>Tests fonctionnels et revue de code sont deux validations distinctes.</span></div>
    <div role="listitem"><strong>Solo · 5 statuts</strong><span>Pas de Human testing séparé ; la revue de PR est la validation humaine.</span></div>
    <div role="listitem"><strong>Personnalisé · avancé</strong><span>Définissez et réutilisez les étapes du board ; complétez les documents de statut et les garde-fous avant d'utiliser ce parcours pour livrer.</span></div>
  </div>

  <dl class="sf-complexity-grid" aria-label="Rigueur adaptée à la complexité">
    <div><dt>bug</dt><dd>Correction directe + test de régression</dd></div>
    <div><dt>low</dt><dd>Analyse minimale, exécution rapide</dd></div>
    <div><dt>medium</dt><dd>Plan structuré + validation</dd></div>
    <div><dt>complex</dt><dd>Analyse profonde + revue contradictoire</dd></div>
  </dl>

  <p><strong>Payez pour la rigueur, pas pour le cérémonial.</strong> Le processus s'adapte au risque : une coquille ne consomme pas le même contexte ni le même budget de revue qu'une modification des autorisations.</p>
</section>

<section class="sf-home-section">
  <span class="sf-home-eyebrow">LE MODÈLE PRODUIT</span>
  <h2>Deux systèmes qui n'auraient jamais dû être séparés.</h2>
  <p class="sf-home-lead">
    La plupart des générateurs s'arrêtent après avoir créé des fichiers. La plupart des workflows IA commencent sans comprendre l'application qu'ils modifient. SaaSFoundryAI relie les deux : une
    véritable architecture SaaS sur laquelle construire et un harness de livraison qui rend chaque changement traçable.
  </p>

  <div class="sf-pillar-grid">
    <a class="sf-pillar" href="/fr/features/built-in">
      <span class="sf-card-index">01 / CONSTRUIRE</span>
      <h3>Fondation SaaS de production</h3>
      <p>Authentification, multi-tenant, RBAC contextualisé, API typée, React, PostgreSQL et socle opérationnel fonctionnent déjà ensemble avant votre première fonctionnalité métier.</p>
      <span class="sf-card-link">Voir les capacités incluses →</span>
    </a>
    <a class="sf-pillar sf-pillar--harness" href="/fr/guide/workflow-system">
      <span class="sf-card-index">02 / LIVRER</span>
      <h3>Harness de développement sécurisé</h3>
      <p>SRS, tickets, skills, tests, validations humaines et pull requests partagent un seul workflow entre Claude Code, Codex et les autres hôtes d'agents déclarés.</p>
      <span class="sf-card-link">Explorer le harness →</span>
    </a>
  </div>
</section>

<section class="sf-home-section">
  <span class="sf-home-eyebrow">MULTI-AGENT · INDÉPENDANT DES FOURNISSEURS</span>
  <h2>Un seul contrat projet. La bonne exécution pour chaque sous-tâche.</h2>
  <p class="sf-home-lead">
    SaaSFoundryAI n'est pas lié à Claude Code. Le harness partage les règles du projet avec six profils d'agents de code, tandis que son planificateur traite fournisseur, runtime, modèle et effort de
    raisonnement comme des candidats qualifiés. La complexité du workflow détermine quand déléguer et exiger une revue indépendante ; le planificateur compare ensuite uniquement ce que l'hôte actif expose réellement.
  </p>

  <div class="sf-agent-grid" role="list" aria-label="Profils d'agents de code pris en charge">
    <span role="listitem">Claude Code</span><span role="listitem">Codex</span><span role="listitem">Gemini CLI</span>
    <span role="listitem">Kimi Code</span><span role="listitem">Qwen Code</span><span role="listitem">Hôte générique</span>
  </div>

  <ol class="sf-execution-flow" aria-label="Parcours de planification d'exécution adaptative">
    <li><strong>Classifier</strong><span>mécanique, implémentation, architecture ou sécurité</span></li>
    <li><strong>Exiger</strong><span>capacités, contexte, confidentialité et effort minimal</span></li>
    <li><strong>Qualifier</strong><span>candidats fournisseur + runtime + modèle + effort</span></li>
    <li><strong>Planifier</strong><span>agent principal, validation indépendante, retries et replis</span></li>
    <li><strong>Autoriser</strong><span>coût exact, budget, approbations et dispatch par l'hôte</span></li>
  </ol>

  <p class="sf-boundary-note"><strong>La frontière v1 :</strong> SaaSFoundry livre les contrats de planification et de sécurité indépendants des fournisseurs. L'hôte actif reste responsable d'exposer et de lancer les agents et modèles réels ; SaaSFoundry n'installe aucun compte fournisseur, ne copie aucun identifiant et n'invente aucun candidat indisponible.</p>
  <p><a href="/fr/guide/agent-coexistence">Comprendre la coexistence des hôtes →</a> · <a href="/fr/guide/execution-planning">Explorer la planification adaptative →</a></p>
</section>

<section class="sf-home-section">
  <span class="sf-home-eyebrow">CE QUI EST LIVRÉ DÈS LE PREMIER JOUR</span>
  <h2>Le travail indifférencié est déjà fait.</h2>
  <p class="sf-home-lead">
    Commencez avec un produit cohérent plutôt qu'un empilement de packages déconnectés. Chaque capacité ci-dessous est générée, câblée et documentée dans la même architecture.
  </p>

  <div class="sf-capability-grid">
    <a href="/fr/features/built-in#authentification-et-cycle-de-session">Authentification & sessions</a>
    <a href="/fr/features/built-in#modele-tenant-compte-et-entite">Modèle tenant & compte</a>
    <a href="/fr/features/rbac">RBAC contextualisé</a>
    <a href="/fr/features/built-in#invitations-et-reactivation-de-compte">Invitations & réactivation</a>
    <a href="/fr/features/built-in#postgresql-et-prisma">PostgreSQL & Prisma</a>
    <a href="/fr/features/built-in#contrat-d-api-type">Contrat API typé</a>
    <a href="/fr/features/built-in#application-react">Application React</a>
    <a href="/fr/features/built-in#internationalisation">Internationalisation</a>
    <a href="/fr/features/built-in#experience-de-developpement-et-quality-gates">Tests, hooks & CI</a>
    <a href="/fr/features/built-in#runtime-de-production">Runtime Docker</a>
    <a href="/fr/guide/monorepo-vs-multirepo">Monorepo ou multirepo</a>
    <a href="/fr/modules/email">Extensions composables</a>
  </div>
</section>

<section class="sf-home-section">
  <span class="sf-home-eyebrow">CHOISISSEZ VOTRE INTERFACE</span>
  <h2>Demandez à votre agent ou lancez la commande. Obtenez le même résultat.</h2>
  <p class="sf-home-lead">
    L'IA est une interface de SaaSFoundryAI, pas le remplacement de son CLI. Les deux parcours utilisent le même manifeste, les mêmes installateurs, la même validation et le même projet généré.
  </p>

  <div class="sf-path-grid">
    <a class="sf-path-card" href="/fr/getting-started/setup-paths#parcours-2-—-pilote-par-assistant">
      <code>« Crée mon espace SaaS »</code>
      <h3>Parcours assisté par un agent</h3>
      <p>Décrivez le résultat. Votre agent lit le projet, ne demande que les décisions manquantes, puis pilote les commandes SaaSFoundry explicites.</p>
      <span class="sf-card-link">Installer le skill agent →</span>
    </a>
    <a class="sf-path-card" href="/fr/getting-started/setup-paths#parcours-1-—-cli-interactif">
      <code>sf new --project-name mon-produit</code>
      <h3>Parcours CLI direct</h3>
      <p>Utilisez le questionnaire interactif ou les options scriptées. Le CLI reste déterministe, inspectable et automatisable sans modèle dans la boucle.</p>
      <span class="sf-card-link">Ouvrir le démarrage rapide →</span>
    </a>
  </div>
  <div class="sf-convergence">même projet · même manifeste · mêmes garanties</div>
</section>

<section class="sf-home-section">
  <span class="sf-home-eyebrow">DES PREUVES, PAS DES PROMESSES</span>
  <h2>Construit avec le workflow qu'il vous fournit.</h2>
  <p class="sf-home-lead">SaaSFoundryAI utilise son propre harness. Le produit généré est testé du navigateur à PostgreSQL en passant par l'API, dans les deux topologies prises en charge.</p>

  <div class="sf-evidence-grid">
    <div class="sf-evidence-card">
      <span class="sf-card-index">PARCOURS PRODUIT RÉELS</span>
      <h3>Navigateur → API → base de données</h3>
      <p>Les tests live couvrent l'authentification, les invitations, les frontières tenant, les permissions contextualisées, le contrôle des modules et la réactivation sans fournisseur externe.</p>
    </div>
    <div class="sf-evidence-card">
      <span class="sf-card-index">ÉVOLUTION SÛRE</span>
      <h3>Générez aujourd'hui. Mettez à jour demain.</h3>
      <p>Manifestes validés, migrations numérotées et mises à jour conscientes des conflits font évoluer la fondation sans traiter les projets générés comme des démos jetables.</p>
    </div>
  </div>
</section>

<section class="sf-final-cta">
  <span class="sf-home-eyebrow">COMMENCEZ À VOTRE NIVEAU</span>
  <h2>Apportez l'idée produit. Gardez les standards d'ingénierie.</h2>
  <p>Utilisez votre agent pour le parcours guidé ou restez dans le terminal. Les deux commencent avec la même fondation de production et terminent dans le même workflow sécurisé.</p>
  <div class="sf-final-actions">
    <a href="/fr/getting-started/setup-paths#parcours-2-—-pilote-par-assistant">Construire avec votre agent →</a>
    <a href="/fr/getting-started/quick-start">Commencer avec le CLI →</a>
    <a href="/fr/features/built-in">Inspecter chaque capacité →</a>
  </div>
</section>

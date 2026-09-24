---
layout: home
hero:
  name: SaaSFoundryAI
  text: Ship the product. Not the boilerplate.
  tagline: >-
    A production-ready SaaS foundation and a guarded development harness, designed together so human and AI contributors can deliver on the same terms.
  actions:
    - theme: brand
      text: Build with your agent
      link: /getting-started/installation
    - theme: alt
      text: Start with the CLI
      link: /getting-started/quick-start
    - theme: alt
      text: Explore the system
      link: /features/built-in
---

<dl class="sf-proof-strip" aria-label="Product summary">
  <div><dt>2 foundations</dt><dd>application + delivery</dd></div>
  <div><dt>7 guarded stages</dt><dd>canonical delivery path</dd></div>
  <div><dt>2 topologies</dt><dd>monorepo or multirepo</dd></div>
  <div><dt>1 contract</dt><dd>.saasfoundry.json</dd></div>
</dl>

<section class="sf-home-section">
  <span class="sf-home-eyebrow">THE DELIVERY CONTRACT</span>
  <h2>Guardrails live before the pull request.</h2>
  <p class="sf-home-lead">
    The canonical user-facing path follows seven visible stages. Ticket nature activates explicit, guarded shortcuts for internal work, bundled changes and Epics. Humans approve intent and behavior;
    automation verifies the code; the connected board keeps the audit trail. GitHub Projects provides the complete v1 delivery contract; Jira and Linear board adapters are experimental.
  </p>

  <ol class="sf-status-flow" aria-label="Canonical seven-stage delivery workflow">
    <li>Backlog</li>
    <li class="sf-human-gate">Ready<span class="sf-gate-label">human approval</span></li>
    <li>In progress</li>
    <li>AI testing</li>
    <li class="sf-human-gate">Human testing<span class="sf-gate-label">human approval</span></li>
    <li class="sf-human-gate">In review<span class="sf-gate-label">human approval</span></li>
    <li>Done</li>
  </ol>

  <p><strong>Human gates are named and highlighted.</strong> The agent can prepare evidence and run guarded operations, but it cannot silently approve its own work.</p>

  <dl class="sf-complexity-grid" aria-label="Complexity-adaptive rigor">
    <div><dt>bug</dt><dd>Direct fix + regression test</dd></div>
    <div><dt>low</dt><dd>Minimal analysis, fast execution</dd></div>
    <div><dt>medium</dt><dd>Structured plan + approval</dd></div>
    <div><dt>complex</dt><dd>Deep analysis + adversarial review</dd></div>
  </dl>

  <p><strong>Pay for rigor, not theatre.</strong> Ceremony scales with risk, so a typo does not consume the same context and review budget as an authorization change.</p>
</section>

<section class="sf-home-section">
  <span class="sf-home-eyebrow">THE PRODUCT MODEL</span>
  <h2>Two systems that should never have been separated.</h2>
  <p class="sf-home-lead">
    Most generators stop after creating files. Most AI workflows start without understanding the application they modify. SaaSFoundryAI connects both sides: a real SaaS architecture to build on,
    and a delivery harness that keeps every change traceable.
  </p>

  <div class="sf-pillar-grid">
    <a class="sf-pillar" href="/features/built-in">
      <span class="sf-card-index">01 / BUILD</span>
      <h3>Production SaaS foundation</h3>
      <p>Authentication, tenancy, scoped RBAC, typed APIs, React, PostgreSQL and the operational baseline already work together before your first business feature.</p>
      <span class="sf-card-link">See what is built in →</span>
    </a>
    <a class="sf-pillar sf-pillar--harness" href="/guide/workflow-system">
      <span class="sf-card-index">02 / DELIVER</span>
      <h3>Guarded development harness</h3>
      <p>SRS, tickets, skills, tests, human gates and pull requests share one workflow. Your agent operates the system; it does not invent a private process beside it.</p>
      <span class="sf-card-link">Explore the harness →</span>
    </a>
  </div>
</section>

<section class="sf-home-section">
  <span class="sf-home-eyebrow">WHAT SHIPS ON DAY ONE</span>
  <h2>The undifferentiated work is already done.</h2>
  <p class="sf-home-lead">
    Start with a coherent product rather than a pile of disconnected packages. Each capability below is generated, wired and documented as part of the same architecture.
  </p>

  <div class="sf-capability-grid">
    <a href="/features/built-in#authentication-and-session-lifecycle">Authentication & sessions</a>
    <a href="/features/built-in#tenant-account-and-entity-model">Tenant & account model</a>
    <a href="/features/rbac">Scoped RBAC</a>
    <a href="/features/built-in#invitations-and-account-reactivation">Invitations & reactivation</a>
    <a href="/features/built-in#postgresql-and-prisma">PostgreSQL & Prisma</a>
    <a href="/features/built-in#typed-api-contract">Typed API contract</a>
    <a href="/features/built-in#react-application">React application</a>
    <a href="/features/built-in#internationalization">Internationalization</a>
    <a href="/features/built-in#developer-experience-and-quality-gates">Tests, hooks & CI</a>
    <a href="/features/built-in#production-runtime">Docker runtime</a>
    <a href="/guide/monorepo-vs-multirepo">Monorepo or multirepo</a>
    <a href="/modules/email">Composable add-ons</a>
  </div>
</section>

<section class="sf-home-section">
  <span class="sf-home-eyebrow">CHOOSE YOUR INTERFACE</span>
  <h2>Ask your agent or run the command. Reach the same result.</h2>
  <p class="sf-home-lead">
    AI is an interface to SaaSFoundryAI, not a replacement for its CLI. Both paths use the same manifest, installers, validation and generated project.
  </p>

  <div class="sf-path-grid">
    <a class="sf-path-card" href="/getting-started/setup-paths#path-2-—-assistant-driven">
      <code>“Create my SaaS workspace”</code>
      <h3>Agent-assisted path</h3>
      <p>Describe the outcome. Your coding agent reads the project, asks only for missing decisions, then drives the explicit SaaSFoundry commands.</p>
      <span class="sf-card-link">Install the agent skill →</span>
    </a>
    <a class="sf-path-card" href="/getting-started/setup-paths#path-1-—-interactive-cli">
      <code>sf new my-product</code>
      <h3>Direct CLI path</h3>
      <p>Use the interactive flow or scripted flags. The CLI remains deterministic, inspectable and suitable for automation without a model in the loop.</p>
      <span class="sf-card-link">Open the CLI quick start →</span>
    </a>
  </div>
  <div class="sf-convergence">same project · same manifest · same guarantees</div>
</section>

<section class="sf-home-section">
  <span class="sf-home-eyebrow">EVIDENCE, NOT PROMISES</span>
  <h2>Built with the workflow it gives you.</h2>
  <p class="sf-home-lead">SaaSFoundryAI dogfoods its own harness. The generated product is exercised from browser to API to PostgreSQL across both supported topologies.</p>

  <div class="sf-evidence-grid">
    <div class="sf-evidence-card">
      <span class="sf-card-index">REAL PRODUCT PATHS</span>
      <h3>Browser → API → database</h3>
      <p>Live lifecycle tests cover authentication, invitations, tenant boundaries, scoped permissions, module control and account reactivation without external providers.</p>
    </div>
    <div class="sf-evidence-card">
      <span class="sf-card-index">SAFE EVOLUTION</span>
      <h3>Generate today. Update tomorrow.</h3>
      <p>Validated manifests, numbered migrations and conflict-aware updates let the foundation evolve without treating generated projects as disposable demos.</p>
    </div>
  </div>
</section>

<section class="sf-final-cta">
  <span class="sf-home-eyebrow">START AT YOUR ALTITUDE</span>
  <h2>Bring the product idea. Keep the engineering standards.</h2>
  <p>Use your coding agent for the guided path or stay in the terminal. Both start with the same production foundation and end inside the same guarded workflow.</p>
  <div class="sf-final-actions">
    <a href="/getting-started/installation">Build with your agent →</a>
    <a href="/getting-started/quick-start">Start with the CLI →</a>
    <a href="/features/built-in">Inspect every capability →</a>
  </div>
</section>

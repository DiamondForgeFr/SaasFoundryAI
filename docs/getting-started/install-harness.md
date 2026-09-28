# Set up the harness

Bring SaaSFoundryAI's development workflow to a repository you already own. **Your application code stays in place**: the `harness` profile adds shared agent instructions, skills and a managed project
manifest, not a replacement API or frontend.

## 1. Prepare your machine

Install Git, Node.js 24.19.0 and npm 11. You do not need Docker just to install the harness. A coding-agent runtime is optional if you will use the CLI yourself.

## 2. Install in your repository

```bash
cd your-project
npx saasfoundryai-cli new --profile harness
```

The interactive setup asks which coding-agent profiles and team tools to configure. Review its recap before confirming. It writes `.saasfoundry.json` and reviewable project instructions; it does not
replace your technical stack.

Starting a new SaaS instead? Run `npx saasfoundryai-cli new` and choose **full** to combine the harness with the ready SaaS foundation, or **stack** for the foundation without the managed workflow.

## 3. Verify

```bash
npx saasfoundryai-cli status --agent-friendly --no-network
npx saasfoundryai-cli agents list --json
npx saasfoundryai-cli docs
```

The last command opens the documentation bundled with the CLI, even without the hosted site. If you prefer the short `sf` command, install once with `npm install -g saasfoundryai-cli`.

## Prefer to ask an assistant?

In **Claude Code**, open the repository and say:

> Install the SaaSFoundryAI skill from https://github.com/DiamondForgeFr/SaasFoundryAI, then help me set up the development harness in this repository.

The assistant proposes the setup and asks for approval before running the same CLI. This one-line skill bootstrap is currently Claude Code-specific. With Codex, Gemini CLI, Kimi Code, Qwen Code or
another coding agent, run the terminal steps above, select that agent's profile, then open the configured repository in the agent.

Need the decision matrix, platform notes or a new-project walkthrough? Continue to the [full installation guide](/getting-started/installation) or
[CLI versus assistant setup](/getting-started/setup-paths).

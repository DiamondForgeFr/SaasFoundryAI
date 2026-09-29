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

Open the repository in a coding assistant that can read its files and run terminal commands, then say:

> Help me set up the SaaSFoundryAI development harness in this repository. Inspect the existing project first, propose the CLI steps and coding-agent profiles for the tools I use, and ask before
> changing files.

The assistant can guide the same `npx saasfoundryai-cli new --profile harness` flow shown above; it should not recreate the scaffold by hand. Claude Code, Codex, Gemini CLI, Kimi Code and Qwen Code
have registered coding-agent profiles. For another host, choose `generic` and verify that it can read the generated instructions and run the required commands. The optional one-line `tool-saasfoundry`
**skill installer** currently targets Claude Code; it is not required to set up or use the harness with another assistant.

GPT, DeepSeek, GLM and Kimi can name models or model providers, not necessarily coding-agent hosts. Use them through a host that exposes the needed repository and terminal capabilities; select the
host's profile, not a model name, during setup.

Need the decision matrix, platform notes or a new-project walkthrough? Continue to the [full installation guide](/getting-started/installation) or
[CLI versus assistant setup](/getting-started/setup-paths).

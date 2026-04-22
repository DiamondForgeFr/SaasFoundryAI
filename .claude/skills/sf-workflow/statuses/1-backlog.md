# STATUS: Backlog

**ROLE**: Preparation phase - detect complexity, analyze context, plan implementation, validate specs

## When to Enter This Status

- When a new idea/feature/bug is mentioned by the developer
- Before any branch creation or code writing

## Mandatory Actions (in order)

### 1. READ THE TICKET THOROUGHLY

### 2. DETECT COMPLEXITY → THEN WRITE IT TO THE TICKET

**Step 2a — Run complexity detection (suggestion only):**

```bash
.claude/skills/sf-workflow/scripts/detect-complexity.sh {ticket-number}
```

**AI will suggest complexity based on:**

- Number of files potentially impacted
- Keywords (auth, payment, security → complex)
- Risk assessment
- Similar historical tickets

**Complexity levels:**

- 🐛 **bug** - Quick fix, minimal ceremony
- 🟢 **low** - Simple task (oneshot-style)
- 🟡 **medium** - Standard feature (apex-free-style)
- 🔴 **complex** - Critical feature (full apex with review)

**Developer ALWAYS has final say - ask for confirmation or adjustment.**

**Step 2b — Persist the complexity label on the ticket:**

```bash
.claude/skills/sf-workflow/workflow-cli.sh retag {ticket-number} {level}
# level: bug | low | medium | complex
```

⚠️ **This step is mandatory, not optional.** `detect-complexity.sh` only prints a suggestion; it does NOT write anything to the ticket. Without the `complexity: *` label, the ticket cannot leave
Backlog — `update-status` is hard-gated on it (see errors to avoid below).

### 3. ANALYZE (adaptive based on complexity)

**Check if analysis required:**

```bash
.claude/skills/sf-workflow/scripts/analyze.sh {ticket-number} {complexity}
```

**Skipped for:** 🐛 bug **Minimal for:** 🟢 low (2-3 files, no agents) **Standard for:** 🟡 medium (2-4 parallel agents) **Deep for:** 🔴 complex (6-10 parallel agents)

**Purpose:**

- Gather context about what currently exists
- Find patterns, files, utilities
- Identify dependencies and risks
- Document findings with file:line references

**Follow the guidance from analyze.sh for your complexity level.**

### 4. PLAN (adaptive based on complexity)

**Check if planning required:**

```bash
.claude/skills/sf-workflow/scripts/plan.sh {ticket-number} {complexity}
```

**Skipped for:** 🐛 bug **Minimal for:** 🟢 low (mental plan) **Detailed for:** 🟡 medium (file-by-file, requires approval) **Comprehensive for:** 🔴 complex (with dependencies, requires approval)

**Purpose:**

- Create implementation strategy
- Map acceptance criteria to file changes
- Identify execution order
- Plan edge cases and error handling

**If approval required:**

- Post plan as ticket comment
- Wait for explicit approval before proceeding

**Follow the guidance from plan.sh for your complexity level.**

### 5. CHALLENGE THE SPECS

- Ask questions to clarify requirements
- Identify uncovered edge cases
- Suggest improvements or alternatives
- Validate the proposed technical approach

### 6. ENSURE TICKET CONTAINS

- Clear description of the problem/need
- Precise acceptance criteria
- Sufficient technical context
- Complexity tag set

### 7. WAIT FOR VALIDATION

**Two approvals needed:**

1. **Specs complete** → can move to Ready
2. **Prioritization** (from Ready) → can move to In Progress

## Exit Conditions

- **Complexity label persisted on the ticket** (run `get-complexity {ticket}` and confirm it prints one of `bug|low|medium|complex`, not `(none)`)
- Analysis complete (if required by complexity)
- Plan approved (if required by complexity)
- Developer validates that specs are complete
- All identified edge cases are documented
- Technical approach is validated

## Next Status

**Ready**

## Errors to Avoid

❌ NEVER create a branch from Backlog ❌ NEVER start coding before Ready ❌ NEVER skip complexity detection ❌ NEVER leave Backlog without persisting the `complexity: *` label via `retag` (suggestion
≠ label; `update-status` is hard-gated) ❌ NEVER skip analysis/planning if required by complexity ❌ NEVER move to Ready without developer validation

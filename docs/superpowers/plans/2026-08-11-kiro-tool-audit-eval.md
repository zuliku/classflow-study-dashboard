# Kiro Tool Capability Audit + Eval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a stable Kiro scenario-evaluation contract and audit the existing Read / Write / Memory tool surface before deciding whether Task 5 should change or add any tools.

**Architecture:** Split macro Task 4 into two independently reviewable low-load tasks. Task 4A creates a typed, deterministic scenario matrix and static validation tests; it does not call a live model. Task 4B inspects current registries/schemas/executors against those scenarios and writes an evidence-based capability audit with an explicit Task 5 recommendation.

**Tech Stack:** TypeScript, Vitest, AI SDK tool registries, Markdown documentation.

## Global Constraints

- Do not change tool runtime behavior in Task 4.
- Do not add aggregate tools in Task 4.
- `dense | balanced | deep` remains presentation-only and must not affect expected tool paths.
- Prefer current high-level deterministic tools over hypothetical replacements.
- Eval scenarios must distinguish required, allowed/conditional, and forbidden/unnecessary tools.
- Task 4A is static/deterministic; no API keys, live provider calls, model snapshots, Playwright, or nondeterministic assertions.
- Task 4B must audit descriptions, schemas, executor outputs, overlaps, repeated chains, and capability gaps, but only write documentation.
- Task 5 may be skipped if the audit does not show a recurring capability gap.
- Focused Vitest + `npm run typecheck`; no full build or E2E by default.

---

### Task 4A: Typed Kiro Eval Scenario Matrix

**Files:**
- Create: `lib/ai/eval/kiroScenarios.ts`
- Create: `tests/kiroEvalScenarios.test.ts`

**Interfaces:**
- Consumes: `KIRO_TOOLS` from `@/lib/ai/tools` as the authoritative tool-name surface.
- Produces: `KiroEvalScenario`, `KiroEvalToolName`, and `KIRO_EVAL_SCENARIOS` for later manual/model evaluation and Task 4B audit evidence.

- [ ] **Step 1: Write the failing structural test**

Create `tests/kiroEvalScenarios.test.ts` that imports `KIRO_EVAL_SCENARIOS` and asserts at least 15 unique scenarios, non-empty `requiredFacts`, positive `maxToolCalls`, unique scenario IDs, and no overlap between `requiredTools` and `forbiddenTools`.

- [ ] **Step 2: Write tool-name validity tests**

Import `KIRO_TOOLS`, derive `new Set(Object.keys(KIRO_TOOLS))`, and assert every tool referenced by `requiredTools`, `allowedTools`, and `forbiddenTools` exists in the registry.

- [ ] **Step 3: Write coverage tests for the approved scenario families**

Assert the matrix contains scenarios covering: today planning, today priority, today task listing, assignment health, weekly pressure, free time, PDF/material breakdown, multi-task study planning, batch DDL write, reminder create, reminder delete/cancel, focus start, course material listing, material requirement summary, and explicit long-term memory save.

- [ ] **Step 4: Run RED**

Run `npx vitest run tests/kiroEvalScenarios.test.ts` and verify it fails because the matrix does not yet exist.

- [ ] **Step 5: Implement the typed scenario contract**

Create `lib/ai/eval/kiroScenarios.ts` with:

```ts
import { KIRO_TOOLS } from "@/lib/ai/tools";

export type KiroEvalToolName = keyof typeof KIRO_TOOLS;

export interface KiroEvalScenario {
  id: string;
  category: "read" | "plan" | "write" | "material" | "memory" | "focus";
  userMessage: string;
  contextAssumptions: string[];
  requiredTools: KiroEvalToolName[];
  allowedTools: KiroEvalToolName[];
  forbiddenTools: KiroEvalToolName[];
  maxToolCalls: number;
  requiredFacts: string[];
  forbiddenBehaviors: string[];
  answerPriorities: string[];
}
```

`allowedTools` means conditional tools that are acceptable only if the scenario data requires them; it is not a suggestion to call them.

- [ ] **Step 6: Add 15 concrete scenarios**

Use stable IDs and exact intent contracts for:

1. `today-task-list` — `search_assignments(scope=today)` should be sufficient; forbid automatic detail/health/free-time expansion.
2. `today-top-priority` — scoped assignment search; allow health only for genuine competing candidates; forbid health on every task.
3. `today-study-plan` — resolve real assignment IDs then `propose_study_plan`; forbid model-built schedule from week/free-time fragments.
4. `assignment-health` — resolve assignment then `get_assignment_health`; forbid `get_available_time` unless concrete slots were requested.
5. `weekly-pressure` — use the smallest combination needed to assess deadlines/load; keep a reasonable ceiling and forbid unrelated material reads.
6. `tonight-free-time` — require `get_available_time`; forbid hand-calculation from week/calendar tools.
7. `pdf-task-breakdown` — `get_assignment` → necessary `read_material` → `propose_task_breakdown`.
8. `multi-assignment-week-plan` — resolve assignments → `propose_study_plan`; no direct StudyBlock writes.
9. `batch-ddl-change` — resolve real IDs → `apply_change_set`; forbid multiple independent DDL writes as the preferred path.
10. `create-reminder` — explicit reminder intent; direct `create_reminder`; forbid pre-emptive `list_reminders` when target is already unambiguous.
11. `cancel-reminder` — `list_reminders` only when reminderId is not already known, then `delete_reminder`; multiple matches require clarification.
12. `start-focus` — explicit duration and unambiguous target → `start_focus_session`; forbid mandatory `get_focus_status` preflight.
13. `course-material-list` — metadata only via `get_course` or `get_material_metadata`; forbid `read_material`.
14. `material-requirements-summary` — read only the specified/necessary material body; require source-backed summary behavior; forbid unrelated course-wide material scans.
15. `save-study-preference-memory` — explicit “记住” intent → `save_memory`; forbid saving current business state as memory.

Keep tool-call ceilings realistic rather than artificially tiny. Resolve-entity searches count toward the ceiling where the scenario explicitly lacks a unique ID.

- [ ] **Step 7: Run GREEN**

Run:

```bash
npx vitest run tests/kiroEvalScenarios.test.ts tests/kiroPromptV2.test.ts tests/kiroResponsePreference.test.ts
npm run typecheck
```

- [ ] **Step 8: Commit Task 4A**

```bash
git add lib/ai/eval/kiroScenarios.ts tests/kiroEvalScenarios.test.ts
git commit -m "test(kiro): add agent eval scenario matrix"
```

---

### Task 4B: Tool Capability Audit + Task 5 Recommendation

**Files:**
- Create: `docs/superpowers/audits/2026-08-11-kiro-tool-capability-audit.md`
- Read only: `lib/ai/tools/read/registry.ts`
- Read only: `lib/ai/tools/read/schemas.ts`
- Read only: `lib/ai/tools/read/executor.ts`
- Read only: `lib/ai/tools/write/registry.ts`
- Read only: `lib/ai/tools/write/schemas.ts`
- Read only: `lib/ai/tools/write/executor.ts`
- Read only: `lib/ai/memory/tools.ts`
- Read only: `lib/ai/eval/kiroScenarios.ts`

**Interfaces:**
- Consumes: the Task 4A scenario matrix and the current tool surface.
- Produces: an evidence-based audit with per-tool-family findings, recurring-chain evidence, and exactly one Task 5 recommendation: `skip`, `refine-existing-tools`, or `add-minimal-tool`.

- [ ] **Step 1: Inventory the tool surface by family**

Document Read / Write / Memory tool names and their intended responsibility. Do not copy full schemas or descriptions; summarize responsibility and direct deterministic outputs.

- [ ] **Step 2: Audit high-risk overlap pairs**

At minimum inspect: `get_current_context` vs request `baseContext/contextRefs`; `get_course` vs `get_material_metadata`; `get_week_schedule` vs `get_calendar_range`; `search_assignments` vs `get_upcoming_assignments`; `get_assignment` vs `get_assignment_schedule`; `get_assignment_health` vs `get_available_time`; `update_schedule` vs `move_schedule` / `resize_schedule`; generic `update_assignment` vs specialized assignment setters.

For each pair classify overlap as `intentional`, `description-ambiguity`, `output-gap`, or `candidate-for-consolidation`.

- [ ] **Step 3: Audit schemas and outputs for forced follow-up reads**

Identify whether a tool omits a field that its common scenario immediately needs, causing a deterministic extra read. Distinguish genuine missing capability from fields intentionally delegated to a more authoritative tool.

- [ ] **Step 4: Map all 15 scenarios to current tool chains**

For each scenario record the minimum expected chain, reasonable call count, and whether the chain is already supported without a new tool.

- [ ] **Step 5: Apply the aggregate-tool threshold**

Recommend a new aggregate tool only if at least 3–4 common scenarios repeatedly require the same 4+ tool combination and the repetition cannot be removed by Task 3 policy or a small description/output refinement. Otherwise do not recommend one.

- [ ] **Step 6: Write explicit findings**

The audit must contain: strengths, redundant/ambiguous areas, missing capability if any, description/schema/output refinements worth considering, repeated-chain evidence, and a prioritized list of no more than 5 candidate improvements.

- [ ] **Step 7: End with exactly one Task 5 decision**

Use one of:

```text
Task 5 recommendation: skip
Task 5 recommendation: refine-existing-tools
Task 5 recommendation: add-minimal-tool
```

If recommending a tool, name the minimal capability and list the scenarios that justify it. Do not implement it in Task 4B.

- [ ] **Step 8: Verify no runtime source changed**

Run `git status --short` and confirm the audit task changed only the audit Markdown file. Task 4A source/tests may already be committed and should remain unchanged.

- [ ] **Step 9: Commit Task 4B**

```bash
git add docs/superpowers/audits/2026-08-11-kiro-tool-capability-audit.md
git commit -m "docs(kiro): audit agent tool capabilities"
```

## Self-Review

- Spec coverage: the plan covers all 15 approved scenario classes, Expected/Forbidden tool behavior, call ceilings, required facts, stopping behavior, information-density concerns, and evidence-driven Task 5 gating.
- Placeholder scan: no TBD/TODO placeholders; Task 4B requires concrete classifications and an exact recommendation token.
- Type consistency: all scenario tool names are derived from `keyof typeof KIRO_TOOLS`; Task 4B consumes the exact `KIRO_EVAL_SCENARIOS` produced by Task 4A.

# Kiro Computer Agent V1 Part 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Kiro Computer Agent V1 with interactive approvals, message-owned Agent Tasks, reviewable Computer changes, task-level session Undo, bounded audit metadata, safe conversation-history restore, and regenerate hardening.

**Architecture:** Keep `lib/ai/computer/*` as a separate trust domain. `ask` must pause the exact client tool call without mutation or tool output; approval resumes only that call through the same sandbox/policy/grant checks. Model-safe tool output is separated from runtime-only review/checkpoint facts. Reuse the existing Kiro conversation persistence (`lib/ai/history/types.ts` + `sanitize.ts` + `KiroSessionProvider`) for display-only Computer task history instead of creating a parallel conversation-history database.

**Tech Stack:** Next.js 14, React 18, TypeScript 5.5, Zustand 4.5, AI SDK 7, IndexedDB, File System Access API, existing Dialog/Button primitives, Vitest 4, fake-indexeddb, Playwright.

## Global Constraints

- Source of truth: `docs/superpowers/specs/2026-08-13-kiro-computer-agent-v1-design.md`.
- Continue from Part 2 HEAD `eb514b3` or newer; preserve Part 1/2 reasoning, workspace, permission, tool, Markdown/DOCX, and verification behavior.
- Sandbox is not permission. Approval may satisfy only a policy result that is already `ask`. It must never override `deny`, hard deny, read-only roots, `PATH_OUTSIDE_SANDBOX`, missing/revoked grants, or adapter errors.
- No Computer tool schema may expose `permission`, `approval`, `remember`, `force`, `unsafe`, or `skipCheck`.
- V1 still exposes no model-facing delete/move/rename, shell/PowerShell/cmd, application launch, MCP, arbitrary network, or Full Access tools.
- Internal Undo may remove only resources created by the same task; this is runtime restoration, not an LLM delete capability.
- Mutation and Undo success require read/stat verification.
- Task/progress UI shows factual runtime activity only, never hidden model reasoning.
- Never persist/send native absolute paths, `adapterRef`, `FileSystemDirectoryHandle`, permission tokens, file bytes, checkpoint snapshots, or raw full-file content.
- Runtime text snapshot for patch Undo is capped by the existing Part 2 patch limit (1 MiB source file).
- Audit metadata keeps at most 500 entries.
- Remove Part 2's turn-global `computerActions` footer; Computer tasks/changes must attach to the assistant message that owns their toolCallIds.
- Centralize Browser grant IndexedDB lookup in `lib/ai/computer/workspace/grants.ts`; `adapters/browser.ts` must not duplicate grant DB constants/access.
- Tests must be deterministic and offline. The Part 3 Playwright test must not call a real external model/API. Use an existing mock route/fixture if available; otherwise intercept `/api/ai/chat` with a deterministic AI SDK-compatible tool-call stream for only this test.
- Test policy: targeted Part 3 Vitest + one focused Computer E2E + typecheck. No full Vitest/Playwright/screenshot regression/build by default.

---

## File Map

### Create
- `lib/ai/computer/approval.ts` — approval request/decision and exact one-shot matching.
- `lib/ai/computer/task.ts` — Agent Task, step, change, and pure update helpers.
- `lib/ai/computer/checkpoints.ts` — runtime-only inverse operations and verified task Undo.
- `lib/ai/computer/audit.ts` — bounded safe audit metadata IndexedDB.
- `store/useKiroComputerRuntimeStore.ts` — non-persisted approval/review UI state only.
- `components/kiro/computer/ComputerApprovalDialog.tsx` — dedicated permission dialog.
- `components/kiro/computer/KiroAgentTaskCard.tsx` — task progress/change summary.
- `components/kiro/computer/KiroChangeReviewDialog.tsx` — bounded runtime review.
- `components/settings/KiroComputerAuditPanel.tsx` — latest safe Computer activity.
- `tests/unit/kiro-computer-approval.test.ts`
- `tests/unit/kiro-computer-checkpoints.test.ts`
- `tests/unit/kiro-computer-history-audit.test.ts`
- `tests/e2e/kiro-computer-agent-v1.spec.ts`

### Modify
- `lib/ai/computer/types.ts`
- `lib/ai/computer/result.ts`
- `lib/ai/computer/executor.ts`
- `lib/ai/computer/executor-types.ts`
- `lib/ai/computer/adapters/browser.ts`
- `lib/ai/computer/adapters/sandbox.ts`
- `lib/ai/computer/workspace/grants.ts`
- `store/useKiroComputerStore.ts`
- `hooks/useKiroChat.ts`
- `components/kiro/KiroChatSurface.tsx`
- `components/kiro/KiroConversation.tsx`
- `components/kiro/computer/KiroComputerActionCard.tsx`
- `components/settings/KiroAgentSettings.tsx`
- `lib/ai/history/types.ts`
- `lib/ai/history/sanitize.ts`
- `tests/unit/kiro-computer-tools.test.ts`

Do not create a second Computer conversation-history database. Existing `KiroSessionProvider` already persists `sanitizeConversation(...)` to `lib/ai/history/db.ts`; extend that pipeline.

---

## Core Interfaces

```ts
export type ComputerApprovalDecision =
  | "deny"
  | "allow-once"
  | "allow-session"
  | "allow-workspace";

export interface ComputerApprovalRequest {
  id: string;
  toolCallId: string;
  taskId: string;
  capability: ComputerCapability;
  risk: ComputerRisk;
  workspaceId: string;
  workspaceLabel: string;
  rootId?: string;
  rootLabel?: string;
  relativePath?: string;
  resourceLabel: string;
  description: string;
  allowedDecisions: ComputerApprovalDecision[];
}

export interface ComputerOneShotApproval {
  approvalId: string;
  toolCallId: string;
  capability: ComputerCapability;
  workspaceId: string;
  rootId?: string;
  relativePath?: string;
}

export type ComputerExecutionAttempt =
  | { kind: "completed"; output: ComputerToolResult; runtime?: ComputerRuntimeMutation }
  | { kind: "approval-required"; request: ComputerApprovalRequest };
```

Only `completed.output` is passed to `chat.addToolOutput`. `runtime` and pending execution context are never sent to the model.

```ts
export type KiroAgentTaskStatus =
  | "running"
  | "awaiting_permission"
  | "completed"
  | "failed"
  | "cancelled"
  | "undone"
  | "undo_failed";

export interface KiroAgentTaskStep {
  id: string;
  toolCallId: string;
  label: string;
  status: "running" | "awaiting_permission" | "done" | "failed" | "cancelled";
  startedAt: string;
  completedAt?: string;
}

export interface KiroComputerChange {
  id: string;
  toolCallId: string;
  operation: "create" | "modify";
  resourceType: "directory" | "text" | "document";
  workspaceId: string;
  workspaceLabel: string;
  rootId: string;
  rootLabel: string;
  relativePath: string;
  displayName: string;
  format?: "markdown" | "docx";
  size?: number;
  verification: "passed";
  review:
    | { kind: "create"; preview?: string }
    | { kind: "text-patch"; edits: Array<{ before: string; after: string }> }
    | { kind: "document"; title?: string; headings: string[]; paragraphs: number; lists: number; tables: number; codeBlocks: number; characters: number };
}

export interface KiroAgentTask {
  id: string;
  conversationId: string | null;
  userMessageId: string;
  assistantMessageId?: string;
  title: string;
  status: KiroAgentTaskStatus;
  steps: KiroAgentTaskStep[];
  changes: KiroComputerChange[];
  toolCallIds: string[];
  canUndo: boolean;
  undoUsed: boolean;
  startedAt: string;
  completedAt?: string;
}
```

Conversation persistence uses a narrower `PersistedComputerTaskView`; it must omit `review`, checkpoints, before text, native data, and executable Undo.

---

### Task 1: Interactive Approval + Grant Store Boundary + Message Ownership

**Files:**
- Create: `lib/ai/computer/approval.ts`
- Create: `lib/ai/computer/task.ts`
- Create: `store/useKiroComputerRuntimeStore.ts`
- Create: `components/kiro/computer/ComputerApprovalDialog.tsx`
- Modify: `lib/ai/computer/result.ts`
- Modify: `lib/ai/computer/executor.ts`
- Modify: `lib/ai/computer/workspace/grants.ts`
- Modify: `lib/ai/computer/adapters/browser.ts`
- Modify: `hooks/useKiroChat.ts`
- Modify: `components/kiro/KiroChatSurface.tsx`
- Modify: `components/kiro/KiroConversation.tsx`
- Test: `tests/unit/kiro-computer-approval.test.ts`
- Test: `tests/unit/kiro-computer-tools.test.ts`

- [ ] **Step 1: Write approval tests before implementation.** Cover Guided `patch_text_file → approval-required` with unchanged file; exact one-shot matching; different path/toolCall fails; explicit `deny` remains deny; hard-denied capability never creates an approval request; session/workspace rule shapes.

- [ ] **Step 2: Run RED.**

```bash
npx vitest run tests/unit/kiro-computer-approval.test.ts tests/unit/kiro-computer-tools.test.ts
```

- [ ] **Step 3: Centralize Browser handle retrieval.** Export runtime-only `getBrowserWorkspaceDirectoryHandle(adapterRef)` from `workspace/grants.ts`. Keep `showDirectoryPicker()` only in `chooseBrowserWorkspaceDirectory()` and `requestPermission()` only in the explicit reauthorization helper. Remove duplicated grant DB/store/version and direct IndexedDB handle lookup from `adapters/browser.ts`.

- [ ] **Step 4: Implement approval helpers.** `allow-once` is an exact in-memory grant. `allow-session` creates an exact resource rule (`scope:"session"`). `allow-workspace` creates a capability + workspace persistent rule. These helpers may be called only after executor policy returned `ask`; they must never convert `deny` into allow.

- [ ] **Step 5: Refactor executor to return `ComputerExecutionAttempt`.** Required order:

```text
schema → frozen snapshot/live workspace → path/sandbox → policy
→ deny: completed false output
→ ask without exact one-shot: approval-required, NO IO
→ ask with exact one-shot: continue
→ live grant/adapter → execute → verify → completed
```

Remove the Part 2 special-case copy that treated Guided patch independently; `policy.effect` is authoritative.

- [ ] **Step 6: Build non-persisted runtime UI store.** It may hold only `pendingApproval: ComputerApprovalRequest | null` and `reviewTaskId: string | null`. Pending original tool input/snapshot/callbacks remain in `useKiroChat` refs, not Zustand.

- [ ] **Step 7: Pause/resume the exact tool call in `useKiroChat`.** On approval-required: do not `addToolOutput`; store safe request; hold `{approvalId, toolCallId, toolName, input, frozenComputerSnapshot, taskId}` in a ref; mark step awaiting permission. Decision semantics:
  - deny → one final `USER_CANCELLED` tool output, no execution;
  - allow-once → rerun exact call with one-shot;
  - allow-session → add session rule, rerun normal policy;
  - allow-workspace → add persistent workspace rule, rerun normal policy.

Live workspace/rules/grant are rechecked on resume. Stop/newChat/loadConversation/unmount clears pending approval and ref.

- [ ] **Step 8: Build `ComputerApprovalDialog`.** Use shared `Dialog`. Show safe logical workspace/root/path and only the decisions listed in `allowedDecisions`. Do not reuse destructive ConfirmDialog.

- [ ] **Step 9: Introduce one live Computer task per Computer-enabled user turn.** Create at send boundary, append factual steps for actual Computer calls, track toolCallIds. Bind the task to the assistant message whose tool parts contain those ids while building `KiroChatMessageView`. Remove the Part 2 global `computerActions` footer from `KiroChatSurface`/`KiroConversation`.

- [ ] **Step 10: GREEN and commit.**

```bash
npx vitest run tests/unit/kiro-computer-approval.test.ts tests/unit/kiro-computer-tools.test.ts
git add lib/ai/computer store/useKiroComputerRuntimeStore.ts hooks/useKiroChat.ts components/kiro tests/unit/kiro-computer-approval.test.ts tests/unit/kiro-computer-tools.test.ts
git commit -m "feat(kiro): add interactive computer approvals"
```

---

### Task 2: Change Review + Verified Checkpoint/Undo

**Files:**
- Create: `lib/ai/computer/checkpoints.ts`
- Create: `components/kiro/computer/KiroAgentTaskCard.tsx`
- Create: `components/kiro/computer/KiroChangeReviewDialog.tsx`
- Modify: `lib/ai/computer/result.ts`
- Modify: `lib/ai/computer/executor.ts`
- Modify: `lib/ai/computer/executor-types.ts`
- Modify: `lib/ai/computer/adapters/browser.ts`
- Modify: `lib/ai/computer/adapters/sandbox.ts`
- Modify: `hooks/useKiroChat.ts`
- Modify: `components/kiro/KiroConversation.tsx`
- Modify: `components/kiro/computer/KiroComputerActionCard.tsx`
- Test: `tests/unit/kiro-computer-checkpoints.test.ts`

Checkpoint types:

```ts
export type ComputerInverseOperation =
  | { type: "remove-created"; workspaceId: string; rootId: string; relativePath: string; resourceType: "file" | "directory" }
  | { type: "restore-text"; workspaceId: string; rootId: string; relativePath: string; beforeText: string };

export interface ComputerTaskCheckpoint {
  taskId: string;
  inverses: ComputerInverseOperation[];
  used: boolean;
}
```

- [ ] **Step 1: Write checkpoint tests.** Cover create text/docx/directory Undo, patch restoration, reverse-order mixed Undo, second Undo rejection, non-empty directory removal rejection, revoked grant failure, and verification after each inverse.

- [ ] **Step 2: Add runtime-only removal IO.** Extend `ComputerAdapterIO` with `remove(path, kind)` for checkpoint restoration only. Browser uses non-recursive directory removal; Sandbox removes exactly one file or empty directory. Do not register any model-facing delete tool.

- [ ] **Step 3: Split model-safe result from runtime mutation facts.** Verified mutations return `ComputerRuntimeMutation` separately from `ComputerToolResult`. Runtime facts contain:
  - create → `remove-created` inverse;
  - patch → exact pre-write `beforeText` inverse;
  - text patch review → exact `{before,after}` edit pairs;
  - create text preview → first 2000 chars only;
  - document review → structural facts derived from validated Document IR.

No runtime snapshot enters `addToolOutput`.

- [ ] **Step 4: Build Task Card + Review Dialog.** `KiroAgentTaskCard` lives inside the owning assistant message and shows factual status/change count. Completed tasks expose `[查看更改]` and, only when checkpoint exists and unused, `[撤销本次更改]`. `KiroChangeReviewDialog` truncates each text before/after side to 2000 display chars and shows document structure rather than binary diff.

- [ ] **Step 5: Implement task-level Undo.** Keep checkpoint registry in a `useKiroChat` ref keyed by taskId. Execute inverses in reverse order using current live workspace/root/grant; verify each result. Only after all inverses pass mark checkpoint used/task `undone`. Any failure stops the rollback and sets `undo_failed`; do not claim full success.

- [ ] **Step 6: GREEN and commit.**

```bash
npx vitest run tests/unit/kiro-computer-checkpoints.test.ts tests/unit/kiro-computer-tools.test.ts
git add lib/ai/computer hooks/useKiroChat.ts components/kiro tests/unit/kiro-computer-checkpoints.test.ts tests/unit/kiro-computer-tools.test.ts
git commit -m "feat(kiro): add computer task review and undo"
```

---

### Task 3: Existing Conversation History + Audit + Regenerate + Focused V1 Regression

**Files:**
- Create: `lib/ai/computer/audit.ts`
- Create: `components/settings/KiroComputerAuditPanel.tsx`
- Modify: `lib/ai/history/types.ts`
- Modify: `lib/ai/history/sanitize.ts`
- Modify: `hooks/useKiroChat.ts`
- Modify: `components/settings/KiroAgentSettings.tsx`
- Modify: `components/kiro/KiroConversation.tsx`
- Modify: `components/kiro/computer/KiroAgentTaskCard.tsx`
- Test: `tests/unit/kiro-computer-history-audit.test.ts`
- Test: `tests/e2e/kiro-computer-agent-v1.spec.ts`

Persisted display-only shape:

```ts
export interface PersistedComputerTaskView {
  taskId: string;
  title: string;
  status: "completed" | "failed" | "cancelled" | "undone" | "undo_failed";
  changes: Array<{
    operation: "create" | "modify";
    resourceType: "directory" | "text" | "document";
    displayName: string;
    workspaceLabel: string;
    rootLabel: string;
    relativePath: string;
    format?: "markdown" | "docx";
    size?: number;
    changeCount?: number;
    verification: "passed";
  }>;
  startedAt: string;
  completedAt?: string;
}
```

Add `computerTask?: PersistedComputerTaskView` to `PersistedKiroMessage`.

- [ ] **Step 1: Write history/audit tests.** Verify sanitizer preserves only the shape above; no `review`, `beforeText`, content preview, handle, adapterRef, native path, bytes, permission token, or checkpoint. Write 510 audit records and verify only newest 500 remain.

- [ ] **Step 2: Reuse existing Kiro history pipeline.** Extend `KiroChatMessageView` with live `computerTask?` and restored `historyComputerTask?`. `sanitizeConversation()` maps either to one `PersistedKiroMessage.computerTask`, and its filter retains an assistant message that has a Computer task even if text/actions are empty. `loadConversation()` populates `restoredComputerTasksRef` and restored task UI is display-only with no executable Undo/checkpoint.

Do not create `classflow-kiro-computer-history-v1`; conversation history continues through the existing `KiroSessionProvider → sanitizeConversation → saveConversation` flow. fileciteturn288file0L2-L6 fileciteturn289file0L2-L6

- [ ] **Step 3: Preserve edit/regenerate safety for restored Computer mutations.** When computing `restoredWriteMessageIds`, include restored assistant message ids whose persisted Computer task has one or more changes. Mutation turns remain `canRegenerate=false`; read-only Computer turns keep current behavior. Retry defense-in-depth must show concise copy such as `该回复已修改工作区文件，不能直接重新生成。` and never replay a mutation automatically.

- [ ] **Step 4: Implement bounded audit DB.** Use `classflow-kiro-computer-audit-v1`, store `entries`, max 500. Metadata only: timestamp/task/conversation/toolCall/toolName/capability/policy decision/outcome/workspace/root/relativePath/verification. Log approval decision and final execution/Undo outcome. Add Settings panel with latest 10 and `清除活动记录`; clearing audit must not modify files, rules, workspaces, or conversation history.

- [ ] **Step 5: Add deterministic offline E2E.** `tests/e2e/kiro-computer-agent-v1.spec.ts` uses Sandbox. Do not call a real model. First inspect existing Kiro E2E helpers for an AI-route mock. If none exists, intercept `/api/ai/chat` inside this test and emit deterministic AI SDK-compatible client tool-call streams for exactly these two scripted turns:
  1. Workspace Auto → `create_text_file(notes.md, known text)`;
  2. Guided → `patch_text_file(notes.md, exact known edit)`.

Then verify: created task card belongs inside assistant message; Guided patch opens approval; `允许这一次` resumes exact call; review shows actual before/after; Undo restores original; switch/load the conversation and restored Computer task is visible but has no Undo.

- [ ] **Step 6: Run final targeted verification.**

```bash
npx vitest run \
  tests/unit/kiro-computer-approval.test.ts \
  tests/unit/kiro-computer-checkpoints.test.ts \
  tests/unit/kiro-computer-history-audit.test.ts \
  tests/unit/kiro-computer-tools.test.ts

npx playwright test tests/e2e/kiro-computer-agent-v1.spec.ts

npm run typecheck
```

- [ ] **Step 7: Security audit.**

```bash
grep -R -n \
  "FileSystemDirectoryHandle\|adapterRef\|absolutePath\|nativePath\|beforeText\|fileBytes\|showDirectoryPicker\|run_shell\|PowerShell\|delete_file\|delete_directory" \
  app hooks lib/ai/computer lib/ai/history store components/kiro components/settings
```

Review every hit. Expected sensitive values stay only in grant/adapter/checkpoint runtime and tests; `showDirectoryPicker` stays in explicit grant helper; there are no model-facing shell/delete tools.

- [ ] **Step 8: Commit.**

```bash
git add lib/ai/computer lib/ai/history hooks/useKiroChat.ts components/kiro components/settings tests
git commit -m "feat(kiro): complete computer agent v1 lifecycle"
```

Build is skipped by default. Run `npm run build` only for a demonstrated Next client/server or bundling problem not covered by typecheck.

---

## Part 3 Acceptance

### Approval
- [ ] `ask` pauses with no mutation and no model tool output.
- [ ] approval can satisfy only `ask`, never `deny`.
- [ ] allow-once is exact call/resource/capability only.
- [ ] session allow is memory-only and not persisted by `useKiroComputerStore`.
- [ ] workspace allow is persistent workspace capability rule.
- [ ] stale pending approvals are cleared on Stop/New/Load/unmount.

### Task / Review
- [ ] one factual Computer task per Computer-enabled user turn.
- [ ] task is attached to owning assistant message/toolCallIds.
- [ ] Part 2 global Computer action footer is removed.
- [ ] text patch review uses real exact edits; document review uses IR facts.
- [ ] no native path/adapterRef in UI.

### Undo
- [ ] create file/document/empty directory can Undo via runtime-only remove.
- [ ] patch restores exact previous text.
- [ ] inverses execute in reverse order and verify.
- [ ] no recursive delete; checkpoint is single-use.
- [ ] rollback failure is explicit and never reported as full success.
- [ ] checkpoint/snapshot is not persisted.

### History / Audit
- [ ] existing Kiro conversation DB persists display-only Computer task facts.
- [ ] restored tasks never regain Undo.
- [ ] restored Computer mutation blocks edit/regenerate replay.
- [ ] audit metadata capped at 500; Settings shows latest 10.
- [ ] no raw content/bytes/handles/adapterRef/native path/checkpoint in persisted metadata.

### Structural Closeout
- [ ] Browser grant lookup is centralized in `workspace/grants.ts`.
- [ ] `adapters/browser.ts` no longer duplicates grant DB constants/lookup.

### Verification
- [ ] four targeted Vitest files PASS.
- [ ] one deterministic offline Part 3 E2E PASS.
- [ ] `npm run typecheck` PASS.
- [ ] build skipped by policy or justified PASS if run.

## Deferred Beyond V1

- model-facing delete/move/rename;
- app open/reveal;
- shell/PowerShell/cmd and Windows process sandbox;
- MCP/arbitrary network permissions;
- Tauri/Windows adapter;
- parallel workers/background automations;
- persistent executable checkpoints across browser restarts;
- full binary/document diff editor.

Part 3 must STOP after approval, message-owned tasks/review, session checkpoint/Undo, existing-history integration, audit metadata, regenerate hardening, and focused regression are complete.

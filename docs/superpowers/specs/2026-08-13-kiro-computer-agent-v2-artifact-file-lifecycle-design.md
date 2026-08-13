# Kiro Computer Agent V2 — Artifact & File Lifecycle Design

**Status:** Draft for user review

**Date:** 2026-08-13

## 1. Goal

Kiro Computer Agent V1 already provides a safe workspace runtime, real Browser/Sandbox file IO, Markdown/DOCX creation, approval, review, undo, history, and audit. V2 turns those one-off file mutations into a persistent artifact workflow so files created or adopted by Kiro can be found, previewed, downloaded, moved, renamed, revised, and referenced again without weakening the V1 sandbox/permission boundary.

The product goal is not to build a full file explorer. The goal is to make Kiro-created work products behave like durable Agent artifacts rather than transient tool results.

## 2. Baseline

V2 builds on the current V1 architecture and must preserve:

- independent `lib/ai/computer` runtime;
- workspace-first logical resource addressing;
- Sandbox != Permission;
- Browser and Sandbox adapters;
- `Plan / Guided / Workspace Auto` modes;
- reasoning effort controls;
- verified Computer mutations;
- interactive approval;
- task-bound change review;
- runtime checkpoint/undo;
- existing Kiro history integration;
- metadata-only audit;
- no model access to raw native paths, handles, adapter refs, file bytes, or permission tokens.

V2 must not replace any of these systems with a parallel implementation.

## 3. Product Principles

### 3.1 Artifact identity is stable; paths are not

An artifact has a durable `artifactId`. `workspaceId + rootId + relativePath` describes its current location and may change after rename/move.

The model should be able to refer to an artifact by stable identity after it moves.

### 3.2 Registry is metadata, not filesystem authority

The filesystem adapter remains the source of truth for file existence and bytes. The Artifact Registry stores only bounded metadata and optional Kiro-owned source IR.

A registry entry does not bypass workspace, sandbox, grant, or permission checks.

### 3.3 Existing user files and Kiro-created artifacts are different trust cases

Kiro-created documents may retain structured source IR for safe future revisions.

Existing arbitrary DOCX files may be inspected and previewed, but V2 does not promise full structured OOXML editing for them.

### 3.4 Move and rename remain controlled mutations

`move_file` and `rename_file` are reversible filesystem mutations but can break user references. They require approval in both Guided and Workspace Auto modes in V2.

### 3.5 No delete capability

V2 still exposes no model-facing delete tool. Internal removal remains available only for verified undo/checkpoint restoration and explicit Settings lifecycle actions already present in V1.

## 4. High-Level Architecture

```text
Kiro / LLM
    |
    | Computer Tool Calls
    v
Existing Computer Runtime
    |
    +--> Workspace Resolver / Sandbox / Permission
    |
    +--> Computer Adapter
    |
    +--> Artifact Service
            |
            +--> Artifact Registry (metadata)
            +--> Artifact Source Store (Kiro-owned Document IR only)
            +--> Preview / Export
            +--> Revision guard
```

The Artifact Service sits behind the existing Computer Runtime. It is not a new execution trust domain.

## 5. Artifact Model

Introduce:

```ts
export type KiroArtifactType =
  | "text"
  | "markdown"
  | "docx";

export type KiroArtifactSource =
  | "kiro-created"
  | "workspace-existing";

export interface KiroArtifact {
  id: string;

  workspaceId: string;
  rootId: string;
  relativePath: string;

  type: KiroArtifactType;
  title: string;
  displayName: string;

  source: KiroArtifactSource;

  sourceConversationId?: string;
  sourceTaskId?: string;

  revision: number;

  createdAt: string;
  updatedAt: string;
}
```

### 5.1 Registry invariants

- `id` is stable across rename and move.
- `relativePath` is updated only after the filesystem mutation verifies successfully.
- `revision` increments only after a verified content revision.
- path changes do not increment document revision.
- registry metadata never stores `adapterRef`, native path, handle, file bytes, permission token, or full file contents.

## 6. Artifact Registry Storage

Use a dedicated browser-local IndexedDB database:

```text
classflow-kiro-artifacts-v1
```

Object stores:

```text
artifacts
sources
```

`artifacts` stores `KiroArtifact` metadata.

`sources` stores only Kiro-owned structured document source, keyed by artifact id:

```ts
interface KiroArtifactSourceRecord {
  artifactId: string;
  revision: number;
  document: KiroDocument;
  updatedAt: string;
}
```

### 6.1 Source IR boundary

Source IR is stored only when:

```text
artifact.source === "kiro-created"
```

and the artifact was generated from the trusted `KiroDocument` IR pipeline.

Do not persist:

- raw OOXML;
- binary DOCX bytes;
- raw HTML;
- unbounded extracted document contents;
- Browser handles or native paths.

## 7. Artifact Registration

### 7.1 Kiro-created files

After verified `create_text_file` or `create_document`, register an artifact.

For `create_document`:

- Markdown -> artifact type `markdown`;
- DOCX -> artifact type `docx`;
- source = `kiro-created`;
- source IR persisted;
- revision = 1.

For generic `create_text_file`:

- `.md` -> `markdown`;
- other supported text -> `text`;
- source = `kiro-created`;
- no Document IR unless it came through `create_document`.

### 7.2 Existing workspace files

Previewing or explicitly adopting an existing supported file may create a registry entry with:

```text
source = workspace-existing
```

V2 does not require automatic indexing of every file in a workspace.

No semantic index or full workspace crawl is introduced.

## 8. New File Lifecycle Tools

Add two model-facing Computer mutation tools:

```text
rename_file
move_file
```

Do not add `delete_file` or `delete_directory`.

### 8.1 rename_file

Logical input:

```ts
{
  rootId: string;
  path: string;
  newName: string;
}
```

Rules:

- source must exist;
- target must stay within the same authorized root;
- `newName` must pass Windows-safe/path-safe validation;
- destination must not already exist;
- rename must verify source absent + destination present;
- if source is a registered artifact, update its path after verification;
- if not registered, no artifact is invented unless the tool result is later adopted.

### 8.2 move_file

Logical input:

```ts
{
  rootId: string;
  path: string;
  destinationRootId: string;
  destinationPath: string;
}
```

V2 scope:

- move within the same active Workspace only;
- both roots must be authorized;
- destination root must be read-write;
- source must exist;
- destination must not exist;
- no cross-Workspace moves;
- no implicit overwrite;
- success requires target exists + source absent verification.

If the file is a registered artifact, update `rootId` and `relativePath` only after verification.

## 9. Move / Rename Permission Policy

Both tools use capability:

```text
fs.move
```

Mode defaults:

```text
Plan           -> deny
Guided         -> ask
Workspace Auto -> ask
```

Workspace Auto intentionally does not auto-approve relocation in V2.

Explicit deny, read-only roots, missing/revoked grants, path sandbox violations, and hard deny remain non-overridable.

## 10. Adapter Contract Extension

Extend the existing Computer adapter IO with one relocation primitive:

```ts
move(
  from: string,
  to: string
): Promise<void>;
```

The runtime resolves source/destination roots before adapter invocation.

For cross-root moves inside one Workspace, the runtime may use read/write/remove semantics only when the adapter cannot perform a native move, but it must preserve the same verified all-or-fail product semantics. If rollback cannot be guaranteed after partial failure, the tool must return failure and retain accurate runtime facts; it must never claim an atomic move when it was not atomic.

Browser and Sandbox implementations must be adapter-specific and must not leak native handles upward.

## 11. Move / Rename Checkpoint & Undo

Extend checkpoint inverse operations:

```ts
{
  type: "move-back";
  workspaceId: string;
  fromRootId: string;
  fromPath: string;
  toRootId: string;
  toPath: string;
}
```

Meaning: the forward operation moved from `from*` to `to*`; undo moves the verified target back to the original location.

Undo requirements:

- execute inverses in reverse order as V1 already does;
- destination-back location must still be free;
- move-back must pass sandbox/adapter resolution using the original runtime checkpoint authority;
- verify original exists and moved location no longer exists;
- only then mark undo successful;
- update Artifact Registry path back after successful inverse verification.

No model-facing delete capability is introduced.

## 12. Structured Document Revision

Add model-facing tool:

```text
update_document
```

V2 only supports artifacts that satisfy all conditions:

```text
artifact.source === "kiro-created"
artifact.type === "markdown" || artifact.type === "docx"
source IR exists
```

Input:

```ts
{
  artifactId: string;
  expectedRevision: number;
  document: KiroDocument;
}
```

### 12.1 Revision preflight

Before execution:

1. load artifact metadata;
2. confirm artifact belongs to active Workspace;
3. resolve current root/path through normal Computer Runtime;
4. verify `expectedRevision === artifact.revision`;
5. verify source IR exists and source is Kiro-owned;
6. evaluate `document.modify` permission;
7. render using the existing Markdown/DOCX renderer;
8. write;
9. verify output;
10. save new source IR;
11. increment revision.

If revision mismatches, return:

```text
ARTIFACT_REVISION_CONFLICT
```

The model must reread/inspect and retry instead of overwriting a newer revision.

## 13. Update Document Permission

`update_document` uses capability:

```text
document.modify
```

Policy follows V1 modify semantics:

```text
Plan           -> deny
Guided         -> ask
Workspace Auto -> allow
```

Explicit rules still override mode defaults according to the V1 policy precedence.

## 14. Content Checkpoint for update_document

V1 checkpoint already restores exact text for text patches. V2 adds bounded document restoration for Kiro-owned generated artifacts.

Before updating a generated document, retain runtime-only previous source IR and previous rendered bytes/text sufficient to restore that exact revision during the current runtime session.

Checkpoint data:

- never enters model tool output;
- never enters history;
- never enters audit;
- never enters Zustand persisted state;
- remains bounded by the same safety philosophy as V1 checkpoints.

After Undo:

- file content must verify against the previous revision;
- source IR restored;
- artifact revision restored to the previous number;
- task reports `undone` only after all verification succeeds.

## 15. Artifact Preview

Create `KiroArtifactPreviewDialog` using the shared Dialog primitive.

Supported preview behavior:

### Markdown

- rendered Markdown preview using the project’s existing safe Markdown rendering path;
- optional raw source view if already supported without a new editor subsystem.

### Text

- bounded monospace preview;
- large files are truncated with an explicit message.

### DOCX

- use the project’s existing DOCX read/HTML conversion capability if available;
- sanitize any generated HTML through the project’s existing safe rendering boundary;
- if full preview cannot be safely produced, show document structure facts plus a download action rather than unsafe HTML.

Preview is read-only in V2.

## 16. Artifact Download / Export

Web V2 must provide real download/export for artifacts.

For Sandbox:

- read bytes/text through Sandbox Adapter;
- create a transient Blob URL;
- trigger download;
- revoke URL after use.

For Browser Workspace:

- provide `下载副本` by reading the authorized file and downloading through the browser;
- do not claim “open in Explorer” or native file opening.

Future Desktop adapters may expose:

```text
open
reveal
```

but those capabilities are not implemented in V2 Web.

## 17. Artifact UI

V2 does not add a full Explorer page.

Add a lightweight Kiro artifact surface with two entry points:

### 17.1 Agent Task / Change card

For a registered artifact change, expose actions such as:

```text
预览
下载
```

If applicable:

```text
查看更改
撤销本次更改
```

Do not overload the card with rename/move controls; those remain Agent operations or recent-artifact actions.

### 17.2 Recent Artifacts

Add a lightweight `最近文件` / `Artifacts` surface inside the Kiro workspace UI, not a new global app workspace.

Show a bounded recent list, for example the latest 10–20 registered artifacts:

- display name;
- type;
- current Workspace/root label;
- revision when >1;
- updated time;
- preview;
- download;
- `Ask Kiro` contextual action.

This surface must remain lower visual priority than the conversation itself.

## 18. Ask Kiro About Artifact

Recent Artifact UI may start a Kiro context attachment using stable artifact metadata.

Model context receives only safe logical facts:

```text
artifactId
workspaceId
rootId
relativePath
type
revision
```

The runtime must reread the file through normal Computer tools if content is needed.

Do not inject cached full artifact contents automatically.

## 19. Task / Change Model Extension

Extend `KiroComputerChange.operation` from:

```text
create | modify
```

to include:

```text
move
rename
```

Change facts must include enough verified logical metadata to render:

```text
移动 notes.md -> archive/notes.md
重命名 draft.md -> final.md
```

For document revisions:

```text
修改 研究方案.docx · v2
```

History stores display-only facts, not runtime review snapshots or source IR.

## 20. History Integration

Continue using the existing Kiro history database and `PersistedKiroMessage` extension path established in V1.

Persist safe Artifact/change display facts only:

- artifactId;
- display name;
- type/format;
- logical workspace/root labels;
- relative path;
- revision;
- operation;
- verification status;
- timestamps.

Do not persist:

- Document IR in chat history;
- preview text;
- file bytes;
- before/after checkpoint data;
- handles;
- adapter refs;
- native paths.

Artifact source IR belongs only in the Artifact Source Store.

## 21. Regenerate Safety

Add these to Computer mutation/regenerate guards:

```text
rename_file
move_file
update_document
```

Any assistant turn that performs one of these mutations must remain non-regenerable under the same V1 safety semantics.

Read-only preview/download UI actions are not Agent mutations and do not affect regenerate safety.

## 22. Artifact Consistency and Stale Records

The filesystem remains authoritative.

When an artifact is opened or acted on:

1. resolve its current logical location;
2. stat the file;
3. if missing, mark the registry record as unavailable/stale for UI purposes;
4. do not silently recreate it;
5. offer a safe way to remove the stale registry metadata from the Artifact UI if needed.

Removing stale artifact metadata is not deleting a filesystem file and is not an LLM delete capability.

## 23. Workspace Deletion Integration

When a Workspace is explicitly removed from Settings:

- remove Artifact Registry metadata belonging to that Workspace;
- remove corresponding Kiro-owned source IR records;
- then continue existing adapter cleanup semantics;
- never delete real Browser Workspace files beyond the existing explicit Sandbox cleanup behavior.

Artifact cleanup must follow the same user-initiated Workspace lifecycle and must not create a model tool.

## 24. Settings Authorization Spacing Fix

The current `SettingsGroup` is designed around `SettingsRow` children and therefore provides horizontal padding but no generic vertical padding. The custom Authorization Workspace list currently touches the group’s top/bottom borders.

Fix this locally inside `KiroAgentSettings.tsx` only.

Target:

```tsx
<SettingsGroup title="授权位置">
  <div className="py-2.5 space-y-2">
    ...workspace rows...
    ...add location action...
  </div>
</SettingsGroup>
```

Exact final spacing may use the closest existing semantic spacing token/class, but must satisfy:

- first Workspace row has visible top breathing room;
- bottom action row has visible bottom breathing room;
- Workspace row does not visually intersect the outer group border;
- add-location button does not visually intersect the outer group border;
- do not modify global `SettingsGroup` padding;
- do not redesign the compact Workspace row introduced by the stabilization task.

## 25. Error Model Extensions

Add explicit Computer/Artifact errors as needed, including at minimum:

```text
ARTIFACT_NOT_FOUND
ARTIFACT_SOURCE_UNAVAILABLE
ARTIFACT_REVISION_CONFLICT
ARTIFACT_UNSUPPORTED_OPERATION
DESTINATION_ALREADY_EXISTS
```

Reuse existing path/sandbox/grant/permission errors where appropriate.

Errors returned to the model must remain bounded and logical; no native paths or runtime internals.

## 26. Audit

Extend existing Computer Audit metadata for:

```text
rename_file
move_file
update_document
artifact preview/download only if the existing audit model already records user-side actions cleanly
```

Agent mutation audit remains mandatory.

Do not audit file contents or source IR.

## 27. Security Boundaries

V2 must preserve all of the following:

- no model-facing delete tool;
- no shell/PowerShell/cmd;
- no application launch;
- no arbitrary network capability;
- no MCP;
- no Tauri/desktop runtime;
- no native path in model context;
- no Browser handle in registry/history/store;
- no adapterRef in model-facing artifact metadata;
- no raw OOXML from the model;
- no silent overwrite on move/rename;
- no permission prompt may bypass sandbox/read-only/hard deny;
- artifact registry never becomes filesystem authority.

## 28. Explicit Non-Goals

V2 does not implement:

- file/directory deletion tools;
- full file explorer;
- semantic workspace indexing;
- embeddings/vector search;
- background file watchers;
- Kiro Skills;
- MCP;
- shell or process sandbox;
- Tauri or Windows packaging;
- application control;
- native open/reveal;
- full arbitrary DOCX editing;
- PPTX;
- XLSX;
- PDF artifact generation;
- multi-agent workers;
- background automations.

These remain later phases.

## 29. Suggested Implementation Plan Decomposition

V2 is large enough to use two or three implementation parts without fragmenting it into micro-tasks.

Recommended three-part structure:

### Part 1 — Artifact Foundation & Relocation

- authorization spacing UI fix;
- Artifact Registry / Source Store;
- artifact registration from existing create tools;
- `move_file` / `rename_file`;
- verified relocation;
- checkpoint move-back;
- history/change/audit integration.

### Part 2 — Structured Document Revision

- `update_document`;
- revision conflict handling;
- source IR lifecycle;
- Markdown/DOCX rerender + verify;
- document update checkpoint/undo;
- task/review/history integration.

### Part 3 — Artifact UX

- preview;
- download/export;
- recent artifacts surface;
- Ask Kiro context handoff;
- stale registry behavior;
- Workspace deletion artifact cleanup;
- targeted regression.

If implementation inspection shows Parts 2 and 3 are tightly coupled and remain reviewable, they may be merged into one larger second part. Do not split into more than three plans unless a concrete blocker is discovered.

## 30. Testing Strategy

Continue the project’s efficiency-first testing policy.

### Required low-cost tests

Focused Vitest coverage should include:

- Artifact Registry create/update/path-change/revision behavior;
- registry/source persistence boundaries;
- move/rename destination conflict;
- move/rename verification;
- move-back checkpoint/undo;
- `update_document` revision conflict;
- source IR restore on undo;
- history sanitizer excludes source IR/preview/checkpoint/native internals;
- Workspace removal cleans artifact metadata only.

### Targeted E2E

Use one deterministic offline Kiro Computer Agent V2 E2E file or extend the existing offline Computer Agent E2E.

Cover one compact lifecycle:

```text
create document
-> artifact registered
-> preview/download action visible
-> rename or move with approval
-> artifact path updated
-> update document revision
-> review
-> undo one mutation
-> reload history display remains safe/read-only
```

Do not use external AI APIs.

### Verification policy

Required:

```text
focused Vitest
focused deterministic Playwright
npm run typecheck
```

`npm run build` remains skipped by default unless a client/server/bundling issue requires it.

Do not run full Vitest/Playwright suites by default.

## 31. Success Criteria

V2 is complete when a user can:

1. ask Kiro to create a Markdown or DOCX artifact;
2. see it as a durable registered artifact rather than only a transient tool fact;
3. preview or download it in Web;
4. ask Kiro to move or rename it under controlled permission rules;
5. continue revising a Kiro-generated document through structured `update_document` with revision conflict protection;
6. review verified changes and use existing task-level Undo semantics;
7. return later and still see safe artifact/history metadata;
8. remove a Workspace without leaving artifact metadata attached to it;
9. use the Authorization Settings section without Workspace rows/actions visually touching the outer group border.

The system must still expose no shell, delete, MCP, or unrestricted computer access.

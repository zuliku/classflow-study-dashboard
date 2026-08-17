# Kiro Computer Agent V2 — Artifact & File Lifecycle Design

**Status:** Ready for user review

**Date:** 2026-08-13

## 1. Goal

Kiro Computer Agent V1 already provides a safe Workspace runtime, real Browser/Sandbox file IO, Markdown/DOCX creation, approval, review, undo, history, and audit. V2 turns those one-off mutations into a durable artifact workflow so files created or adopted by Kiro can be found, previewed, downloaded, moved, renamed, revised, and referenced again without weakening the V1 sandbox/permission boundary.

The product goal is not a full file explorer. It is to make Kiro work products behave like durable Agent artifacts rather than transient Tool Results.

## 2. Baseline

V2 must preserve and reuse:

- independent `lib/ai/computer` runtime;
- Workspace-first logical resource addressing;
- Sandbox != Permission;
- Browser and Sandbox adapters;
- `Plan / Guided / Workspace Auto` modes;
- reasoning effort controls;
- verified mutations;
- interactive approval;
- task-bound change review;
- runtime checkpoint/undo;
- existing Kiro history integration;
- metadata-only audit;
- no model access to native paths, handles, adapter refs, bytes, or permission tokens.

No V1 subsystem is replaced with a parallel implementation.

## 3. Product Principles

### 3.1 Artifact identity is stable; paths are not

Every registered artifact gets a durable `artifactId`. `workspaceId + rootId + relativePath` describes its current location and may change after rename/move.

### 3.2 Registry is metadata, not filesystem authority

The adapter remains authoritative for file existence and bytes. The Artifact Registry stores bounded metadata plus optional Kiro-owned structured source IR.

### 3.3 One logical file location maps to at most one active artifact record

Within one Workspace, the tuple:

```text
workspaceId + rootId + normalized relativePath
```

must not produce duplicate active Artifact Registry records. Registration reuses the existing artifact entry when the logical location already exists.

### 3.4 Kiro-created documents and arbitrary user documents are different trust cases

Kiro-created documents may retain structured `KiroDocument` source IR for safe revision. Existing arbitrary DOCX files may be inspected/previewed/adopted, but V2 does not promise full structured OOXML editing for them.

### 3.5 Move/rename remain controlled mutations

Both operations can break references. They require approval in `Guided` and `Workspace Auto` modes in V2.

### 3.6 No model-facing delete capability

V2 still exposes no `delete_file` or `delete_directory`. Internal removal is only for verified Undo and explicit user-initiated Workspace/registry lifecycle actions.

## 4. Architecture

```text
Kiro / LLM
    |
    v
Existing Computer Runtime
    |
    +--> Workspace Resolver / Sandbox / Permission
    +--> Computer Adapter
    +--> Artifact Service
            |
            +--> Artifact Registry
            +--> Artifact Source Store
            +--> Preview / Download
            +--> Revision Guard
```

Artifact Service is behind the existing Computer Runtime. It is not a new trust domain and cannot bypass permission or sandbox checks.

## 5. Artifact Model

```ts
export type KiroArtifactType = "text" | "markdown" | "docx";

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

Registry invariants:

- `id` remains stable across rename/move;
- location changes update only after verified filesystem success;
- `revision` increments only after verified content revision;
- move/rename does not increment document revision;
- metadata never stores `adapterRef`, native path, handle, bytes, permission token, or full file content.

## 6. Artifact Storage

Use IndexedDB:

```text
classflow-kiro-artifacts-v1
```

Stores:

```text
artifacts
sources
```

`artifacts` contains `KiroArtifact` metadata.

`sources` contains structured source only for Kiro-generated documents:

```ts
interface KiroArtifactSourceRecord {
  artifactId: string;
  revision: number;
  document: KiroDocument;
  updatedAt: string;
}
```

Do not store raw OOXML, binary DOCX bytes, raw HTML, native handles, native paths, or unbounded extracted text in the source store.

## 7. Registration and Adoption

### 7.1 New Kiro-created files

After verified `create_text_file` or `create_document`, register/reuse the logical artifact location.

`create_document`:

- Markdown -> `markdown`;
- DOCX -> `docx`;
- source = `kiro-created`;
- persist source IR;
- revision = 1.

Generic `create_text_file`:

- `.md` -> `markdown`;
- supported plain text -> `text`;
- source = `kiro-created`;
- no Document IR unless creation used `create_document`.

### 7.2 Existing Workspace files

V2 performs no automatic full Workspace crawl and no migration/backfill scan of V1 files.

An existing supported file is lazily adopted when the user/Kiro opens it through the Artifact workflow or explicitly requests artifact actions. If its logical location already has an artifact, reuse that record. Otherwise create:

```text
source = workspace-existing
```

Old V1-created files therefore remain usable without an expensive migration; they become registered only when actually used.

## 8. New Computer Mutation Tools

Add:

```text
rename_file
move_file
update_document
```

Do not add deletion tools.

## 9. `rename_file`

Input:

```ts
{
  rootId: string;
  path: string;
  newName: string;
}
```

Requirements:

- source exists;
- remains inside the same authorized root;
- `newName` passes existing Windows/path safety rules;
- destination must not already exist;
- no implicit overwrite;
- verify source absent + destination present;
- update registered artifact location only after verification.

Unregistered files are not automatically registered merely because they were renamed.

## 10. `move_file`

Input:

```ts
{
  rootId: string;
  path: string;
  destinationRootId: string;
  destinationPath: string;
}
```

V2 allows moves only inside the same active Workspace.

Requirements:

- source and destination roots are authorized;
- destination root is read-write;
- source exists;
- destination does not exist;
- no cross-Workspace move;
- no overwrite;
- success requires destination exists and source no longer exists;
- update artifact location only after verification.

### 10.1 Same-adapter move

When both roots resolve to the same adapter instance/namespace, use adapter-native relocation when available.

### 10.2 Cross-adapter move inside one Workspace

When roots resolve to different adapters/namespaces, V2 may implement a verified copy-then-remove sequence:

1. read source bytes/text;
2. write destination;
3. verify destination equals source representation;
4. remove source using runtime-internal removal;
5. verify source absent.

If step 4 or 5 fails after destination creation, runtime must attempt compensating removal of the newly-created destination. If compensation also fails, report a partial-failure state accurately and do not update Artifact Registry location. Never report an atomic move when atomicity was not achieved.

The internal removal path is not registered as an LLM tool.

## 11. Move/Rename Permission Policy

Both use `fs.move`.

```text
Plan           -> deny
Guided         -> ask
Workspace Auto -> ask
```

Explicit deny, read-only roots, missing/revoked grants, path violations, and hard deny remain non-overridable.

## 12. Adapter Contract Extension

Extend the existing adapter IO with relocation support sufficient for the runtime to implement §10 while keeping adapter/native details hidden.

The implementation plan may choose either:

```ts
move(from: string, to: string): Promise<void>
```

for same-adapter relocation, plus existing read/write/remove primitives for cross-adapter relocation, or an equivalent focused interface matching the current adapter shape.

The architecture requirement is fixed: higher Kiro layers never receive native handles/paths.

## 13. Move/Rename Undo

Extend checkpoint inverses with verified relocation restoration:

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

Undo requirements:

- reverse-order execution;
- original destination-back location must still be available;
- execute through runtime resolver/adapter authority;
- verify original restored + moved location absent;
- update Artifact Registry location back only after verification;
- mark task `undone` only when every inverse verifies.

## 14. `update_document`

Only supported when:

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

Preflight:

1. load artifact;
2. artifact belongs to active Workspace;
3. resolve current root/path through existing Computer Runtime;
4. verify `expectedRevision === artifact.revision`;
5. verify Kiro-owned source IR exists;
6. evaluate `document.modify` permission;
7. render through existing Markdown/DOCX renderer;
8. write;
9. verify output;
10. persist new source IR;
11. increment revision.

Revision mismatch returns:

```text
ARTIFACT_REVISION_CONFLICT
```

No silent overwrite of a newer revision.

## 15. `update_document` Permission

Use `document.modify`:

```text
Plan           -> deny
Guided         -> ask
Workspace Auto -> allow
```

V1 explicit rule precedence remains unchanged.

## 16. Document Revision Checkpoint

Before `update_document`, retain runtime-only prior source IR and sufficient prior rendered content to restore the exact previous revision during the current runtime session.

Checkpoint data never enters Tool Output, chat history, audit, Zustand persisted state, or Artifact metadata.

Undo must:

- restore file content;
- verify restoration;
- restore source IR;
- restore artifact revision;
- report success only after all four succeed.

## 17. Artifact Preview

Create `KiroArtifactPreviewDialog` using the shared Dialog primitive.

### Markdown

V2 requires:

- rendered preview using the project’s existing safe Markdown rendering path;
- raw-source toggle with bounded content.

### Text

- read-only monospace preview;
- bounded content;
- explicit truncation notice for large files.

### DOCX

Minimum guaranteed V2 preview is a safe structural preview using `inspect_document` facts:

- title;
- headings;
- paragraph/list/table/code counts;
- character count.

If the repository already has a safe Mammoth-to-sanitized-HTML path that can be reused without introducing a new sanitizer/security subsystem, the implementation may additionally render rich DOCX preview. Rich HTML preview is not required for V2 completion.

Preview remains read-only.

## 18. Download / Export

Web V2 must provide real download behavior.

Sandbox:

- read through Sandbox Adapter;
- create transient Blob URL;
- trigger download;
- revoke URL.

Browser Workspace:

- provide `下载副本` by reading through the authorized adapter;
- do not claim native open/reveal behavior.

Desktop `open`/`reveal` remains deferred.

## 19. Artifact UI

V2 does not create a new global Explorer workspace.

### 19.1 Agent Task Card

Registered artifact changes expose:

```text
预览
下载
```

and retain applicable:

```text
查看更改
撤销本次更改
```

Rename/move controls do not need to be embedded directly into every Task Card.

### 19.2 Recent Artifacts

Add a lightweight Kiro-local `最近文件` / `Artifacts` surface showing exactly the latest **12** registered artifacts by `updatedAt` descending.

Each item shows:

- display name;
- type;
- logical Workspace/root label;
- revision when >1;
- updated time;
- Preview;
- Download;
- `Ask Kiro` contextual action.

The surface remains visually subordinate to the conversation and does not become a full file explorer.

## 20. Ask Kiro About Artifact

Context handoff uses stable safe metadata only:

```text
artifactId
workspaceId
rootId
relativePath
type
revision
```

File contents are reread through normal Computer tools when needed. Cached full content is never injected automatically.

## 21. Change Model Extension

Extend `KiroComputerChange.operation`:

```text
create | modify | move | rename
```

Verified display facts must support:

```text
移动 notes.md -> archive/notes.md
重命名 draft.md -> final.md
修改 研究方案.docx · v2
```

History stores display-only facts, not runtime source/review/checkpoint data.

## 22. History Integration

Continue using the existing Kiro history database and `PersistedKiroMessage` flow.

Safe persisted artifact/change facts may include:

- artifactId;
- display name;
- type/format;
- Workspace/root labels;
- relative path;
- revision;
- operation;
- verification status;
- timestamps.

Do not persist Document IR in chat history, preview text, bytes, checkpoint data, handles, adapter refs, or native paths.

Source IR belongs only in the Artifact Source Store.

## 23. Regenerate Safety

Add to mutation guards:

```text
rename_file
move_file
update_document
```

Turns containing these mutations are non-regenerable under existing V1 semantics.

Preview/download UI actions are read-only UI operations and do not change regenerate safety.

## 24. Stale Artifact Records

Filesystem remains authoritative.

When an artifact is opened or acted on:

1. resolve current logical location;
2. stat file;
3. if missing, mark record unavailable/stale in UI;
4. do not recreate silently;
5. allow the user to remove stale registry metadata.

Removing stale metadata is not deleting a filesystem file and is never an Agent tool.

## 25. Workspace Removal Integration

When the user explicitly removes a Workspace in Settings:

- delete Artifact Registry metadata for that Workspace;
- delete matching source IR records;
- then continue existing Workspace adapter/grant cleanup;
- never delete real Browser Workspace files beyond existing explicit Sandbox lifecycle behavior.

No model tool is introduced for this cleanup.

## 26. Settings Authorization Spacing Fix

The current `SettingsGroup` assumes `SettingsRow` children and provides horizontal but not generic vertical padding. The custom Authorization Workspace list therefore visually touches the group border.

Fix only `KiroAgentSettings.tsx`:

```tsx
<SettingsGroup title="授权位置">
  <div className="py-2.5 space-y-2">
    ...
  </div>
</SettingsGroup>
```

Requirements:

- visible breathing room above first Workspace row;
- visible breathing room below Add Location action;
- no row/action overlaps the outer border;
- do not change global `SettingsGroup` padding;
- do not redesign the compact Workspace row already introduced.

## 27. Error Model Extensions

Add at minimum:

```text
ARTIFACT_NOT_FOUND
ARTIFACT_SOURCE_UNAVAILABLE
ARTIFACT_REVISION_CONFLICT
ARTIFACT_UNSUPPORTED_OPERATION
DESTINATION_ALREADY_EXISTS
MOVE_PARTIAL_FAILURE
```

Reuse existing sandbox/path/grant/permission errors where applicable. Model-visible errors remain logical and bounded.

## 28. Audit

Audit Agent mutations:

```text
rename_file
move_file
update_document
```

Do **not** add audit entries for ordinary user-side Preview or Download actions in V2. They are read-only UI actions, not Agent decisions.

Audit remains metadata-only.

## 29. Security Boundaries

V2 preserves:

- no model-facing delete;
- no shell/PowerShell/cmd;
- no app launch;
- no arbitrary network capability;
- no MCP;
- no Tauri/Desktop runtime;
- no native path in model context;
- no Browser handle in Registry/history/store;
- no adapterRef in model-facing artifact metadata;
- no raw OOXML from model;
- no silent overwrite;
- no approval bypass of sandbox/read-only/hard deny;
- Artifact Registry never becomes filesystem authority.

## 30. Explicit Non-Goals

V2 does not implement:

- file/directory deletion tools;
- full Explorer;
- semantic indexing/embeddings;
- background file watchers;
- Kiro Skills;
- MCP;
- shell/process sandbox;
- Tauri/Windows packaging;
- app control;
- native open/reveal;
- full arbitrary DOCX editing;
- PPTX/XLSX/PDF artifact generation;
- multi-agent workers;
- background automations.

## 31. Implementation Plan Decomposition

Use at most three large implementation plans.

### Part 1 — Artifact Foundation & Relocation

- Authorization spacing fix;
- Artifact Registry / Source Store;
- create-tool artifact registration;
- lazy adoption;
- `rename_file` / `move_file`;
- relocation verification;
- move-back checkpoint;
- change/history/audit integration.

### Part 2 — Structured Document Revision

- `update_document`;
- source IR lifecycle;
- revision conflicts;
- Markdown/DOCX rerender + verify;
- document revision checkpoint/undo;
- task/review/history integration.

### Part 3 — Artifact UX

- Preview;
- Download;
- Recent 12 artifacts;
- Ask Kiro artifact context;
- stale record handling;
- Workspace-removal registry cleanup;
- focused regression.

Parts 2 and 3 may be merged only if implementation inspection shows they remain one reviewable dependency chain. Do not split into more than three plans without a concrete blocker.

## 32. Testing Strategy

Efficiency-first testing remains mandatory.

Focused Vitest coverage:

- Registry uniqueness and registration reuse;
- source IR persistence boundary;
- lazy adoption;
- move/rename conflict and verification;
- cross-adapter partial-failure compensation;
- move-back Undo;
- revision conflict;
- document source/revision restore on Undo;
- history sanitizer excludes source IR/preview/checkpoint/native internals;
- Workspace removal cleans Registry/source metadata only.

One deterministic offline Computer Agent V2 E2E should cover a compact lifecycle:

```text
create document
-> artifact registered
-> Preview/Download available
-> rename or move with approval
-> location updates
-> update document revision
-> review
-> undo one mutation
-> reload history remains display-only/safe
```

No external AI API.

Required verification:

```text
focused Vitest
focused deterministic Playwright
npm run typecheck
```

`npm run build` remains skipped by default unless a client/server/bundling-only problem requires it. Do not run full Vitest/Playwright suites by default.

## 33. Success Criteria

V2 is complete when a user can:

1. create Markdown/DOCX with Kiro and receive a durable artifact identity;
2. lazily adopt supported existing files without full Workspace indexing;
3. preview or download registered artifacts in Web;
4. move/rename files under controlled permission rules with verified outcomes;
5. continue revising Kiro-generated Markdown/DOCX through `update_document` with stale-revision protection;
6. review and Undo verified mutations through the existing Agent Task lifecycle;
7. reload later and retain safe artifact/history metadata;
8. remove a Workspace without leaving Artifact Registry/source metadata attached to it;
9. use the Authorization Settings section without rows/actions touching the outer group border.

The system still exposes no shell, delete, MCP, or unrestricted computer access.

# Kiro Computer Agent V1 — Workspace, Reasoning, Permissions, Files & Documents

Status: Approved for implementation planning
Date: 2026-08-13

## 1. Goal

Kiro Computer Agent V1 upgrades Kiro from a chat assistant with ClassFlow-specific tools into a workspace-scoped agent runtime that can safely operate on user-authorized files and generate real artifacts.

V1 is designed toward a future Windows desktop agent with filesystem, application, shell, network, MCP, background-task, and automation capabilities, while the first implementation only opens a constrained subset:

- Chrome / Edge: real user-authorized folders via the File System Access API.
- Unsupported browsers: Kiro Sandbox backed by IndexedDB, with preview/download instead of claiming native-folder writes.
- Filesystem: workspace listing/search/grep/metadata/read, directory creation, text-file creation, conflict-safe text patching.
- Documents: Markdown and DOCX creation through a structured document pipeline plus verification.
- Agent controls: model reasoning effort and Computer Agent permission mode in both Composer and Settings.
- Safety: workspace sandbox, permission broker, approval lifecycle, mutation verification, change review, checkpoints/Undo, audit metadata, prompt-injection boundary, regenerate guard.

V1 is not a generic shell agent. It must establish the trust and execution architecture first.

---

## 2. Architectural Decision

Use **Approach B: independent Computer Runtime integrated into the existing Kiro Harness**.

Do not append computer operations directly to `lib/ai/tools/write/*`, and do not rewrite the whole chat runtime into a new orchestrator in V1.

Target architecture:

```text
Kiro Model
    │
    ▼
Kiro Tool Router
    │
    ├── Read Runtime
    ├── ClassFlow Write Runtime
    ├── Memory Runtime
    └── Computer Runtime
            │
            ▼
     prepareComputerTool()
            │
   ┌────────┼────────┐
   │        │        │
Resolver  Sandbox  Policy
   │        │        │
   └────────┼────────┘
            ▼
      Approval Gate
            │
            ▼
    Computer Executor
            │
            ▼
     ComputerAdapter
      ┌─────┴─────┐
      │           │
Browser Adapter  Sandbox Adapter
      │
File System Access API
```

Future desktop integration adds `TauriComputerAdapter` without changing the model-facing tool protocol.

---

## 3. Non-negotiable Principles

### 3.1 Sandbox is not Permission

Sandbox defines what Kiro is technically capable of accessing.

Permission policy defines whether an otherwise-valid operation may execute automatically, must ask the user, or must be denied.

A user changing permission mode must never enlarge the sandbox.

### 3.2 Workspace-first

The model never operates on raw absolute system paths as its primary resource identifier.

Model-facing resources use:

```ts
{
  workspaceId: "research",
  rootId: "output",
  path: "红海危机/研究框架.docx"
}
```

The runtime resolves those logical identifiers to browser handles or future desktop paths.

### 3.3 Mutation must be verified

A tool execution returning from the underlying API is not sufficient for success.

Every mutation follows:

```text
Prepare → Execute → Verify → Record → Report
```

Only a passed verification can produce `ok: true` and a successful File/Artifact Action Card.

### 3.4 Mutation must be reviewable

Computer mutations produce structured changes. Kiro must be able to show what it created or modified without relying on the model's prose.

### 3.5 Runtime must be environment-independent

Kiro tools depend on `ComputerAdapter`, not directly on `showDirectoryPicker`, IndexedDB, Node filesystem APIs, Tauri APIs, Rust, PowerShell, or shell commands.

---

## 4. Trust Domains

ClassFlow business writes and Computer resource writes are separate trust domains.

Keep existing ClassFlow write tools under their current architecture.

Add a separate Computer domain under:

```text
lib/ai/computer/
```

Computer code must not expose unrestricted App Store mutation, arbitrary JavaScript, eval, raw shell, or direct OS APIs to the model.

---

## 5. Workspace Model

```ts
interface KiroWorkspace {
  id: string;
  name: string;
  roots: KiroWorkspaceRoot[];
  instructionsFile?: "KIRO.md";
  createdAt: string;
  updatedAt: string;
}

interface KiroWorkspaceRoot {
  id: string;
  label: string;
  access: "read-only" | "read-write";
  adapterRef: string;
}
```

A workspace may contain multiple roots, including read-only roots.

Example:

```text
论文研究
├── 研究资料   read-write
├── 原始数据   read-only
└── 输出       read-write
```

`adapterRef` is an opaque runtime reference. It is not sent to the model.

---

## 6. Resource Resolution and Path Safety

All model-provided paths are relative to an authorized `rootId`.

The resolver must reject or safely normalize attempts involving:

- absolute paths;
- drive prefixes;
- UNC paths;
- `..` traversal escaping the root;
- invalid Windows file names;
- reserved Windows device names;
- separator ambiguity;
- symlink / canonical-path escape where the adapter can resolve canonical paths.

A permission approval can never override `PATH_OUTSIDE_SANDBOX`.

---

## 7. Computer Runtime Module Boundary

Recommended structure:

```text
lib/ai/computer/
├── types.ts
├── errors.ts
├── capabilities.ts
├── risk.ts
├── policy.ts
├── permissions.ts
├── broker.ts
├── prepare.ts
├── executor.ts
├── audit.ts
├── checkpoints.ts
├── workspace/
│   ├── types.ts
│   ├── registry.ts
│   ├── resolver.ts
│   └── instructions.ts
├── tools/
│   ├── schemas.ts
│   ├── registry.ts
│   ├── formatters.ts
│   └── mutating.ts
├── filesystem/
│   ├── path.ts
│   ├── search.ts
│   ├── textPatch.ts
│   └── verify.ts
├── documents/
│   ├── types.ts
│   ├── renderer.ts
│   ├── markdown.ts
│   ├── docx.ts
│   └── verify.ts
└── adapters/
    ├── types.ts
    ├── browser.ts
    └── sandbox.ts
```

`useKiroChat.ts` may route Computer tools into this runtime, but it must not absorb Computer execution/business logic.

---

## 8. ComputerAdapter

V1 stabilizes a filesystem/document-oriented adapter interface.

```ts
interface ComputerAdapter {
  capabilities(): ComputerAdapterCapabilities;

  listDirectory(resource: ResolvedResource): Promise<DirectoryEntry[]>;
  stat(resource: ResolvedResource): Promise<FileMetadata | null>;

  readText(
    resource: ResolvedResource,
    options?: ReadTextOptions
  ): Promise<TextReadResult>;

  readBytes(resource: ResolvedResource): Promise<Uint8Array>;

  createDirectory(resource: ResolvedResource): Promise<void>;

  writeText(
    resource: ResolvedResource,
    content: string,
    options: WriteOptions
  ): Promise<void>;

  writeBytes(
    resource: ResolvedResource,
    content: Uint8Array,
    options: WriteOptions
  ): Promise<void>;

  move?(
    from: ResolvedResource,
    to: ResolvedResource
  ): Promise<void>;
}
```

V1 implementations:

- `BrowserFileAdapter`
- `SandboxAdapter`

Future:

- `TauriComputerAdapter`

Shell/process/network must not be added to this interface in V1. Those are future, separate capability domains.

---

## 9. Browser and Fallback Strategy

### 9.1 Supported Chromium environment

Real workspace folders use the File System Access API and require explicit user gesture for directory selection.

Directory handles are stored in a dedicated IndexedDB grant store, not in Kiro preferences or chat history.

On startup or workspace use:

```text
load handle → query permission → use / request user re-authorization
```

Revoked permission must result in an explicit re-authorization state.

### 9.2 Unsupported browser fallback

Use a `SandboxAdapter` backed by IndexedDB.

The UI must clearly say the workspace is stored in the current browser.

Generated files may be previewed/downloaded, but Kiro must not claim that a native computer folder was modified.

---

## 10. Computer Tool Set — V1

Keep the model-facing tool set compact.

### Read tools

```text
list_workspace_roots
list_directory
search_files
grep_files
get_file_metadata
read_text
```

`read_text` supports bounded reads such as:

```ts
{
  startLine?: number;
  endLine?: number;
  maxChars?: number;
}
```

Large files should be searched and read in segments rather than blindly injected into context.

### Write tools

```text
create_directory
create_text_file
patch_text_file
create_document
```

V1 does not expose arbitrary file delete or generic overwrite tools.

---

## 11. Text Patching

`patch_text_file` must be conflict-safe.

A patch edit identifies exact current content rather than asking the model to rewrite an entire file.

Example:

```ts
{
  oldText: "## 研究方法",
  newText: "## 研究设计与识别策略"
}
```

Execution rules:

- zero matches → `PATCH_CONFLICT`;
- one match → apply;
- multiple matches → `PATCH_AMBIGUOUS`;
- write result must be read back and verified.

This preserves Coding-Agent-style precise editing while avoiding a general-purpose shell.

---

## 12. Document Domain

Document creation is not treated as a raw filesystem concern.

V1 exposes:

```text
create_document
inspect_document
```

Supported V1 formats:

```ts
type KiroDocumentFormat = "markdown" | "docx";
```

Future formats may include PDF, PPTX, XLSX, and HTML without requiring one new model tool per format.

---

## 13. Structured Document IR

Model-to-document generation uses structured content rather than model-generated binary/OOXML.

```ts
interface KiroDocument {
  title?: string;
  blocks: KiroDocumentBlock[];
}
```

V1 block vocabulary:

- heading;
- paragraph;
- bullet list;
- numbered list;
- simple table;
- quote;
- code block;
- page break.

Equation and image blocks may be reserved for future schema versions, but unsupported blocks must fail explicitly rather than silently downgrade.

Pipeline:

```text
LLM → Document IR → Renderer → Bytes/Text → Adapter → Verifier
```

---

## 14. DOCX Rendering and Verification

The model must never generate raw OOXML or binary payloads.

The DOCX renderer owns package generation.

V1 DOCX output should support a practical academic/document subset:

- title;
- Heading 1–3;
- normal paragraphs;
- bold/italic inline runs where represented;
- bullets;
- numbering;
- simple tables;
- quotes;
- page breaks.

Verification minimum:

```text
read written bytes
→ valid ZIP package
→ required DOCX OOXML entries exist
→ document.xml parseable
→ success
```

A rendering or verification failure must not produce a success Action Card.

---

## 15. Capability and Risk Model

Capabilities and risk are separate concepts.

```ts
type ComputerCapability =
  | "workspace.list"
  | "fs.list"
  | "fs.search"
  | "fs.read"
  | "fs.create"
  | "fs.modify"
  | "fs.move"
  | "fs.delete"
  | "document.create"
  | "document.modify"
  | "app.open"
  | "app.reveal"
  | "shell.execute"
  | "network.access";
```

```ts
type ComputerRisk =
  | "read"
  | "create"
  | "modify"
  | "destructive"
  | "execute"
  | "external";
```

V1 may define future capabilities in types, but must not expose shell/delete/application execution tools.

---

## 16. Agent Permission Modes

Composer and Settings expose three usable V1 modes:

### Plan

```text
read/search = allow
create/modify/move/delete/execute = deny
```

### Guided — default

```text
read/search = allow
create = allow
modify = ask
move = ask
delete/execute = deny
```

### Workspace Auto

```text
read/search/create/modify = allow
move = ask
delete/execute = deny
```

`Full Access` exists only as a future desktop architecture state and is not a usable Web V1 mode.

Auto must never mean unrestricted computer access.

---

## 17. Permission Rule Engine

```ts
interface ComputerPermissionRule {
  id: string;
  effect: "allow" | "ask" | "deny";
  capability: ComputerCapability;
  workspaceId?: string;
  rootId?: string;
  resourcePattern?: string;
  scope: "persistent" | "session";
}
```

Policy evaluation conceptually follows:

```text
hard deny
→ resource-specific rule
→ root rule
→ workspace rule
→ session rule
→ agent-mode default
```

A more permissive rule cannot override a hard sandbox boundary or a read-only root.

---

## 18. Approval Lifecycle

Computer permissions need a dedicated approval UI rather than reusing a simple destructive ConfirmDialog.

Example choices:

```text
拒绝
允许这一次
本次会话允许
此 Workspace 始终允许
```

The model cannot request or set its own approval persistence.

Tool schemas must not expose fields such as:

```text
permission
approval
force
unsafe
remember
skipCheck
```

Runtime data:

```ts
interface ComputerApprovalRequest {
  id: string;
  taskId?: string;
  toolCallId: string;
  capability: ComputerCapability;
  risk: ComputerRisk;
  workspaceId: string;
  rootId?: string;
  resourceLabel: string;
  description: string;
  allowedDecisions: ComputerApprovalDecision[];
}
```

---

## 19. Computer Tool Preflight

Every Computer tool must pass through one preflight path:

```text
Schema validation
→ Workspace resolution
→ Resource resolution
→ Sandbox validation
→ Capability evaluation
→ Risk evaluation
→ Permission evaluation
→ Optional user approval
→ Execute
→ Verify
→ Record
```

Recommended entry point:

```ts
prepareComputerTool(...)
```

The executor may never bypass preflight.

---

## 20. Model Reasoning Effort

Reasoning effort is a first-class inference setting and must remain distinct from Kiro's existing response-depth preference.

```ts
type KiroReasoningEffort =
  | "default"
  | "low"
  | "medium"
  | "high";
```

`default` means: do not actively override the provider/model default reasoning behavior.

It does not mean adaptive/automatic complexity selection.

---

## 21. Reasoning Capability Registry

Model capabilities must explicitly declare whether reasoning effort is adjustable.

```ts
interface ReasoningCapability {
  adjustable: boolean;
  supportedEfforts: KiroReasoningEffort[];
  mechanism:
    | "effort"
    | "anthropic-effort"
    | "thinking-budget"
    | "fixed";
}
```

Do not infer reasoning support from model name, vendor, or transport.

Unsupported models must not show a fake working control.

---

## 22. Reasoning Provider Mapping

Add a dedicated inference mapping layer, for example:

```text
lib/ai/reasoning/
├── types.ts
├── normalize.ts
├── capabilities.ts
└── providerOptions.ts
```

Entry point:

```ts
resolveReasoningProviderOptions({
  definition,
  effort
})
```

The server normalizes the selected effort and converts it into safe provider-specific options.

Never pass arbitrary client-supplied provider options through to the provider SDK.

---

## 23. DeepSeek Constraint

Current project behavior for the official DeepSeek transport explicitly disables thinking while using Kiro's tool calling due to the current compatibility constraint.

Therefore V1 must mark that transport/model combination as non-adjustable reasoning unless the transport implementation is intentionally changed and verified.

The UI must show a fixed/unavailable state rather than pretending `low/medium/high` is active.

---

## 24. Custom OpenAI-Compatible Providers

Custom providers remain conservative.

Add an explicit advanced capability flag for adjustable reasoning. It is disabled by default.

If enabled, Kiro may expose the reasoning control according to the configured mechanism supported by the implementation.

If the provider rejects the mapped reasoning option, return a real provider error; do not silently retry without the requested reasoning setting while claiming it was applied.

---

## 25. Turn Snapshot vs Live Security State

At message submission, freeze:

```text
model
reasoning effort
agent mode
active workspace id
```

These define the current turn/task intent.

Do not let Composer changes retroactively alter an already-running turn.

However, evaluate these live at every Computer tool execution:

```text
permission rules
workspace grants
root access
revocations
sandbox availability
```

If the user revokes a grant mid-task, the next tool call must fail safely.

---

## 26. State Ownership

### `useAISettingsStore`

Owns:

```text
provider
model
reasoningEffort
```

Reasoning changes in Composer and Settings update the same state.

### `useKiroPreferencesStore`

Continues to own UI/behavior preferences such as:

```text
output text size
response preference
auto context
web search
web PDF vision
```

Reasoning must not be merged with response preference.

### `useKiroComputerStore`

New store owning logical Computer Agent configuration:

```text
computerEnabled
activeWorkspaceId
agentMode
workspace metadata
permission rules
```

### IndexedDB Computer Grant Store

Owns opaque native/browser directory handles.

Never place `FileSystemDirectoryHandle` in Zustand persistence or conversation history.

### Agent Task Runtime

Owns transient execution state:

```text
current task
steps
changes
checkpoints
pending approval
```

---

## 27. Kiro Composer UI

The existing Composer bottom toolbar already contains attachment/context/web/model/send controls. V1 extends this without turning it into a dense settings panel.

Desktop concept:

```text
+  @  Web  Computer                权限 ▾  思考 ▾  Model ▾  Send
```

### Computer toggle

- OFF: neutral.
- ON: active state.
- If no usable workspace exists, clicking ON starts workspace authorization instead of silently enabling.
- During a locked turn, disable mode/reasoning/workspace changes consistent with existing model selection locking.

### Permission mode chip

Visible only while Computer Agent is enabled.

Choices:

```text
计划
受控
工作区自动
```

The Composer only switches mode presets. Fine-grained rules live in Settings.

### Reasoning chip

Shows only meaningful supported values for the selected model.

Example:

```text
思考 中 ▾
```

If the current model is fixed/non-adjustable, show a disabled/fixed state rather than an interactive fake selector.

### Responsive behavior

Normal width may show labels.

Compact/sidecar widths collapse to icon + tooltip/popover while retaining accessible names.

---

## 28. Workspace UI Placement

Workspace identity is context, not an execution setting.

Do not crowd it into the bottom-right control cluster with model/reasoning/permission.

Place active Workspace near the Composer context area, for example above the prompt or integrated with `KiroContextBar`:

```text
论文研究 ▾   @ 国际贸易课程
```

Conceptually:

```text
top/context area = what Kiro is working with
bottom execution controls = how Kiro is allowed to act
```

---

## 29. Settings Information Architecture

Do not further overload the existing large `KiroAISettings.tsx` with all Computer settings.

Use two product areas:

### Kiro & AI

Contains:

```text
provider
model
reasoning effort
response preference
Kiro Search
vision
```

Reasoning description:

> 控制支持该能力的模型在回答前投入的推理计算。

Response preference description remains distinct:

> 控制 Kiro 最终回答的表达深度与篇幅。

### Kiro Agent

New area containing:

```text
Computer Agent toggle
default permission mode
workspace management
authorized roots
read-only/read-write status
fine-grained permission rules
activity/audit information
future desktop capabilities status
```

Suggested components:

```text
components/settings/
├── KiroAgentSettings.tsx
├── KiroWorkspaceSettings.tsx
└── KiroPermissionSettings.tsx
```

---

## 30. Tool Registration and Routing

Computer tools become a separate tool domain.

`KIRO_TOOLS` may be extended with Computer schema definitions, but server-side request assembly should only expose Computer tools when Computer Agent is enabled.

Suggested exposure:

### Plan

Expose only read/search/list/metadata tools.

### Guided / Workspace Auto

Also expose V1 creation/patch/document tools.

This reduces tool-schema clutter, but server filtering is not a security boundary.

The Browser Computer Runtime must still reject disallowed tools if they arrive unexpectedly.

---

## 31. Tool Router Evolution

Do not fully rewrite all existing handlers in V1.

Introduce an explicit Computer domain and, where practical, a domain resolver such as:

```ts
resolveKiroToolDomain(toolName)
```

Conceptual domains:

```text
read
classflow-write
memory
computer
```

The goal is to prevent more `if toolName === ...` branches from accumulating in `useKiroChat.ts`.

---

## 32. Agent Task Model

V1 introduces a lightweight task model based on observable tool execution, not hidden reasoning.

```ts
interface KiroAgentTask {
  id: string;
  conversationId: string;
  userMessageId: string;
  title: string;
  status:
    | "running"
    | "awaiting_permission"
    | "completed"
    | "failed"
    | "cancelled";
  steps: KiroAgentTaskStep[];
  changes: KiroComputerChange[];
  startedAt: string;
  completedAt?: string;
}
```

Task steps are factual runtime activity such as:

```text
读取工作区
搜索资料
生成 Markdown
验证 DOCX
```

They are not model chain-of-thought.

Existing Kiro Activity Trace should evolve toward this runtime-backed model instead of creating an unrelated duplicate progress system.

---

## 33. Change Records and File Action Cards

Computer success output is a runtime fact.

```ts
interface KiroComputerChange {
  id: string;
  operation: "create" | "modify" | "move" | "rename";
  resourceType: "text" | "document" | "directory";
  workspaceId: string;
  rootId: string;
  path: string;
  before?: ChangeSnapshot;
  after?: ChangeSnapshot;
  verification: "passed" | "failed";
}
```

Chat UI should render File/Artifact Action Cards with real metadata:

```text
✓ 已创建文件
研究方案.docx
论文研究 / output
Word 文档 · 38 KB
```

Web fallback actions may be:

```text
预览 / 下载 / 撤销
```

Future desktop actions may be:

```text
打开 / 在资源管理器中显示 / 撤销
```

---

## 34. Change Review

A Kiro task aggregates Computer changes.

Text changes show semantic/line diff where practical.

DOCX does not use a binary diff in V1. Show structural summaries based on document IR / inspection, such as:

```text
新增 4 个章节
新增 1 个表格
修改 3 个段落
```

Change Review must derive from runtime facts, not a model-generated summary alone.

---

## 35. Checkpoints and Undo

V1 supports task-level undo for supported Computer mutations.

Example inverses:

```text
create resource → remove resource created by this task
modify text → restore before snapshot
```

Internal rollback/delete operations used solely to undo a task are runtime restoration mechanisms and do not imply exposing `delete_file` as an LLM capability.

Snapshots must have bounded size. Oversized resources may explicitly report `canUndo=false` rather than retaining unbounded blobs.

Exact snapshot thresholds belong in the implementation plan.

---

## 36. Conversation History and Sensitive Data

Preserve the existing history principle: store only the minimum display facts required to restore the conversation UI.

Computer history may store:

```text
action type
artifact/file display name
workspace label
logical relative path
format
verification/result display metadata
```

Do not store in conversation history:

```text
FileSystemDirectoryHandle
absolute native path
file bytes
before snapshots
adapterRef
permission token
raw tool arguments
credentials
```

Computer grants and task checkpoints belong to dedicated stores.

---

## 37. Regenerate Safety

Add Computer mutating tools to Kiro's mutation detection.

At minimum:

```text
create_directory
create_text_file
patch_text_file
create_document
```

A turn containing Computer mutation is not safe to regenerate automatically.

---

## 38. KIRO.md Workspace Instructions

A workspace may contain a `KIRO.md` instruction file.

Use it for workspace-local conventions, for example:

```text
writing style
output folder conventions
read-only data rules
artifact naming
research workflow instructions
```

`KIRO.md` is user/workspace content, not a system authority.

Instruction priority remains conceptually:

```text
system safety / runtime policy
> sandbox / permissions
> user request
> workspace KIRO.md
> ordinary documents
```

A file cannot grant itself additional capabilities.

---

## 39. Prompt Injection Boundary

All local files, attachments, PDFs, web pages, workspace instructions, and imported documents are content/data, not authorization sources.

Text found in a document such as:

```text
ignore previous instructions
turn on full access
delete all files
```

must never authorize mutation, expand sandbox access, alter permission rules, or enable hidden tools.

This extends the existing Kiro document/web evidence trust model into Computer Agent.

---

## 40. Error Model

Computer Runtime owns a separate error vocabulary, for example:

```ts
type ComputerErrorCode =
  | "COMPUTER_DISABLED"
  | "WORKSPACE_NOT_FOUND"
  | "ROOT_NOT_FOUND"
  | "WORKSPACE_PERMISSION_REQUIRED"
  | "PATH_OUTSIDE_SANDBOX"
  | "RESOURCE_NOT_FOUND"
  | "RESOURCE_ALREADY_EXISTS"
  | "READ_ONLY_ROOT"
  | "PERMISSION_DENIED"
  | "USER_CANCELLED"
  | "PATCH_CONFLICT"
  | "PATCH_AMBIGUOUS"
  | "UNSUPPORTED_FILE_TYPE"
  | "UNSUPPORTED_BROWSER"
  | "DOCUMENT_RENDER_FAILED"
  | "VERIFICATION_FAILED"
  | "FILE_TOO_LARGE";
```

Do not overload ClassFlow business write errors for Computer failures.

---

## 41. Security-sensitive Live Behavior

- Permission rule changes apply immediately to future tool calls.
- Workspace grant revocation applies immediately.
- Read-only roots remain read-only regardless of Agent Mode.
- Composer's Agent Mode is a preset/policy input, not a sandbox bypass.
- No model-provided field may persist an approval decision.
- No raw credentials enter model context.
- Network permission remains separate from filesystem permission.

---

## 42. V1 Explicit Non-goals

Do not implement in V1:

```text
delete_file
delete_directory
arbitrary overwrite_file
run_shell
PowerShell
cmd
launch_application
kill_process
registry access
arbitrary network access
MCP
semantic workspace index
parallel agents
background automations
filesystem watch
PPTX
XLSX
PDF export
full DOCX editing
OS-level process sandbox
```

The architecture reserves room for these without pretending they exist.

---

## 43. Future Windows Architecture

Future Windows desktop work should add native implementations below the stable Runtime boundary:

```text
Kiro Computer Runtime
      ↓
TauriComputerAdapter
      ↓
native filesystem / open / reveal
```

Later, process and network execution should be separate capability/runtime domains with OS-level sandboxing and explicit command/network policy.

Tauri capability scoping alone must not be treated as a complete future shell sandbox.

---

## 44. End-to-end V1 Success Scenario

Given an authorized `论文研究` workspace with writable `output` root, the following request must become a real agent workflow:

> 把我们刚才讨论的红海危机选题整理成一份研究方案 Word，放到论文研究 Workspace 的 output 文件夹，同时生成一份 Markdown 版本。

Expected runtime flow:

```text
resolve active workspace
→ inspect output root
→ read KIRO.md if present
→ create Markdown artifact
→ verify Markdown
→ create DOCX artifact
→ verify DOCX
→ record changes
→ render real File/Artifact cards
```

User-facing result:

```text
完成 2 项更改
✓ 研究方案.md
✓ 研究方案.docx

查看更改
撤销本次更改
```

Kiro must not claim completion unless both real artifact operations passed verification.

---

## 45. Implementation Plan Decomposition

This feature is complex enough that the implementation plan may be divided into **2–3 large continuous parts**, not many micro-tasks.

Recommended planning shape:

### Part 1 — Runtime Foundation, Reasoning, Workspace & Permissions

Covers:

```text
Computer domain/types/errors
ComputerAdapter interfaces
Browser/Sandbox grant foundation
workspace registry/resolution
sandbox/path validation
capability/risk/policy engine
approval lifecycle
useKiroComputerStore
reasoning capability registry/provider mapping
turn snapshot integration
Composer + Settings controls for reasoning / Computer / Agent Mode
```

### Part 2 — Files, Documents, Verification & Kiro Tool Integration

Covers:

```text
Computer tool schemas/registry/router
list/search/grep/metadata/read
mkdir/create text/patch text
Document IR
Markdown renderer
DOCX renderer
verification
KIRO.md
context-budget-aware file reading
mutation/regenerate integration
```

### Part 3 — Agent UX, Change Review, Checkpoints & Regression

Use only if implementation/review size warrants a third part.

Covers:

```text
Agent Task runtime/progress
approval dialog integration
File/Artifact Action Cards
change review
checkpoint/task undo
audit metadata
history persistence metadata
workspace management polish
targeted E2E/integration regression
```

The final implementation plan must prioritize continuous development and may merge Parts 2 and 3 when the concrete code review shows that doing so is manageable.

---

## 46. Testing Strategy Direction

Detailed commands belong in the implementation plan, but V1 testing should follow the project's development-efficiency policy:

- targeted unit tests for pure path/policy/patch/document-verification logic;
- targeted Computer Runtime integration tests;
- a small number of high-value Kiro E2E flows;
- typecheck required;
- no default full Playwright suite;
- no default full regression suite;
- build only when the implementation introduces a boundary that typecheck cannot validate, such as browser/server import or packaging issues.

High-value E2E acceptance should cover at least:

1. authorize/use workspace or sandbox fallback;
2. Guided mode approval for modifying an existing file;
3. Plan mode blocks mutation;
4. create Markdown + DOCX and show verified Action Cards;
5. reasoning setting appears in Composer/Settings and is frozen per turn;
6. unsupported/fixed reasoning models do not expose fake adjustment;
7. Computer mutation disables safe regenerate;
8. task-level change review/Undo for supported changes.

---

## 47. Acceptance Summary

V1 is design-complete only if implementation preserves all of the following:

### Architecture

- independent Computer Runtime;
- existing Kiro Harness retained;
- adapter abstraction ready for Windows;
- no shell used as a filesystem shortcut.

### Safety

- sandbox and permission separated;
- model sees logical workspace paths, not native absolute paths;
- read-only roots enforced;
- permission changes cannot enlarge sandbox;
- prompt/file content cannot authorize mutations;
- no delete/shell/application execution exposed in V1.

### Agent behavior

- Computer tool preflight is mandatory;
- mutations are verified before success;
- changes are runtime-recorded and reviewable;
- supported mutations have task-level Undo/checkpoint semantics;
- Computer mutations participate in regenerate safety.

### Reasoning

- `default / low / medium / high` is capability-driven;
- reasoning is separate from response depth;
- Composer and Settings share one reasoning setting source;
- reasoning is frozen in the turn snapshot;
- unsupported/fixed transports show no fake control.

### Permissions UI

- Composer exposes Computer toggle + Agent Mode when applicable;
- Settings exposes default mode, workspaces, roots, and fine-grained permission rules;
- Agent Mode remains a policy preset rather than a sandbox bypass.

### Files/Documents

- real authorized-folder support on supported Chromium browsers;
- explicit IndexedDB sandbox fallback elsewhere;
- bounded read/search/grep tooling;
- conflict-safe text patching;
- Markdown and DOCX generated via structured document runtime;
- generated artifacts are verified before success.

---

## 48. Final Product Positioning

Kiro Computer Agent is not a “download Word” feature and not a generic Coding Agent clone.

The intended product is:

> **Codex / Claude Code-style agent execution harness, adapted to ClassFlow's learning, research, document, personal knowledge, and future desktop workflows.**

The durable product advantage is the combination of:

```text
ClassFlow learning context
+ workspace-scoped computer capabilities
+ structured document/artifact generation
+ user-controlled permissions
+ auditable and reversible agent actions
```

This V1 establishes that foundation without prematurely exposing unrestricted computer execution.

# Kiro Computer Agent V2 — Part 3 Artifact UX Tightening Addendum

> This addendum is part of the Part 3 implementation plan and overrides the corresponding details in `2026-08-13-kiro-computer-agent-v2-part3-artifact-ux.md` where they differ.

## 1. Why this addendum exists

Final code inspection found two Part 3 correctness requirements that must be explicit before implementation:

1. `Ask Kiro` for DOCX must be a real capability. The existing `inspect_document` DOCX path currently exposes only weak binary-derived facts, so a model cannot reliably read Word body text through normal Computer tools.
2. Artifact Context must be strictly whitelisted again on the server. Client `refsForPrompt()` is not a sufficient trust boundary because `/api/ai/chat` can be called directly with arbitrary `contextRefs` fields.

A third implementation clarification removes ambiguity around create-Undo Artifact cleanup testing.

---

## 2. Existing `inspect_document` must become DOCX-content-capable

This is **not a new model tool**. Extend the existing `inspect_document` read tool.

### Required behavior for DOCX

In `lib/ai/computer/executor.ts`, do not call `adapter.readText()` on `.docx` binary content.

For DOCX:

1. `readBytes(normalized)`;
2. create a Blob with Word MIME;
3. reuse existing `extractDocx()` from `lib/ai/attachments/docx.ts` (Mammoth raw-text only);
4. return a bounded text excerpt to the model, maximum **12,000 characters**;
5. return `truncated: true` when either attachment extraction or the 12k Computer result bound truncates;
6. if the logical file maps to a registered Artifact whose Source IR exists and `source.revision === artifact.revision`, use `inspectDocumentFacts(source.document, "docx")` for trusted structural facts;
7. otherwise use safe fallback facts from extracted raw text (`title = artifact?.title ?? filename`, headings/lists/tables/codeBlocks = 0, paragraphs = non-empty paragraph count, characters = extracted text length);
8. keep `bytes` size in the result if already useful;
9. never return HTML/OOXML/bytes to the model.

Expected model-safe DOCX output shape:

```ts
{
  ok: true,
  data: {
    format: "docx",
    title?: string,
    headings: number,
    paragraphs: number,
    lists: number,
    tables: number,
    codeBlocks: number,
    characters: number,
    bytes: number,
    text: string,
    truncated: boolean,
  }
}
```

### Test

Extend `tests/unit/kiro-computer-tools.test.ts`:

- create a DOCX via `create_document` containing a known phrase such as `Word 正文可读取`;
- call `inspect_document` on that file;
- assert `data.text` contains that phrase;
- assert structural facts come from the registered Source IR;
- assert no HTML/OOXML/byte-array field is returned.

This is required so `Ask Kiro` can actually answer questions about Kiro-generated Word artifacts using normal Computer reads.

---

## 3. Server must normalize/whitelist Context refs

Add a pure shared prompt type + normalizer in `lib/ai/context/contextSelection.ts` (or a focused sibling module if the existing file becomes unwieldy):

```ts
export type KiroPromptContextRef =
  | {
      kind: "course" | "assignment" | "group-project" | "material" | "week";
      id?: string;
      label: string;
    }
  | {
      kind: "artifact";
      id: string;
      label: string;
      workspaceId: string;
      rootId: string;
      relativePath: string;
      type: "text" | "markdown" | "docx";
      revision: number;
    };

export function normalizePromptContextRefs(input: unknown): KiroPromptContextRef[];
```

### Client

`refsForPrompt()` returns `KiroPromptContextRef[]` using explicit object construction. Never spread the original `KiroContextRef` into prompt payloads.

### Server

In `app/api/ai/chat/route.ts`, replace raw:

```ts
const contextRefs = Array.isArray(b.contextRefs)
  ? (b.contextRefs as Record<string, unknown>[])
  : [];
```

with:

```ts
const contextRefs = normalizePromptContextRefs(b.contextRefs);
```

The normalizer must:

- reject unknown kinds;
- preserve only the allowed fields above;
- require Artifact `id/workspaceId/rootId/relativePath/type/revision`;
- reject invalid Artifact type or revision < 1;
- never copy arbitrary additional client fields.

Thus even a direct malicious API call containing:

```ts
{
  kind: "artifact",
  adapterRef: "secret",
  nativePath: "C:\\...",
  content: "..."
}
```

cannot place those fields into the system prompt.

### Tests

`tests/unit/kiro-artifact-context.test.ts` must test both:

- trusted `refsForPrompt()` projection;
- hostile raw object through `normalizePromptContextRefs()`.

Assert hostile fields are absent.

---

## 4. Create Undo Artifact cleanup: use one executable path in tests

Main plan requires `remove-created` to carry `artifactId` and successful create Undo to remove matching Artifact metadata + Source IR.

Implementation may choose either:

### Preferred focused option

Extend `applyInverseToAdapter()` so that for:

```ts
inverse.type === "remove-created" && inverse.artifactId
```

it:

1. removes the file and verifies it absent using the existing adapter flow;
2. then calls `removeArtifactRecordIfMatches()`;
3. verifies the record/source are absent;
4. throws on registry cleanup failure so the Task becomes `undo_failed`.

This makes the exact production path directly unit-testable and avoids adding another Hook-only orchestration branch.

Directory inverses never have `artifactId`.

If this creates an undesirable module cycle after inspection, the Agent may instead keep cleanup orchestration in `useKiroChat`, but then it must extract a small testable helper and use that same helper in both production and unit tests. Do **not** leave the test as a manual sequence that is different from production.

---

## 5. Artifact raw patch error code

Add to `ComputerErrorCode`:

```text
ARTIFACT_UNSUPPORTED_OPERATION
```

Use it when `patch_text_file` targets a registered Artifact with live Kiro-owned Source IR. The model-safe message tells Kiro to use `update_document`.

Do not overload `ARTIFACT_NOT_EDITABLE`, because the Artifact is editable; only the raw patch operation is unsupported for that structured representation.

---

## 6. Final focused verification addition

Part 3 final unit command remains focused, but `kiro-computer-tools.test.ts` must now include the DOCX inspect regression:

```bash
npx vitest run \
  tests/unit/kiro-artifact-access.test.ts \
  tests/unit/kiro-artifact-context.test.ts \
  tests/unit/kiro-computer-checkpoints.test.ts \
  tests/unit/kiro-computer-tools.test.ts
```

No new E2E file is needed. Continue extending only:

```text
tests/e2e/kiro-computer-artifacts-v2.spec.ts
```

Build remains skipped unless a real Mammoth client bundling/client-server boundary issue appears.

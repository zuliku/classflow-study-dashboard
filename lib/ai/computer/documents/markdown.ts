import { KiroDocument, KiroInline } from "@/lib/ai/computer/documents/types";

/**
 * Document IR → deterministic Markdown。
 * 表格正确 escape `|` 与换行；所有文本原样输出（renderer 负责转义）。
 */
export function renderMarkdownInline(inline: KiroInline[] | undefined): string {
  if (!inline) return "";
  return inline
    .map((run) => {
      let text = run.text;
      if (text.includes("|")) text = text.replace(/\|/g, "\\|");
      if (text.includes("\n")) text = text.replace(/\n/g, " ");
      if (run.bold) text = `**${text}**`;
      if (run.italic) text = `*${text}*`;
      return text;
    })
    .join("");
}

export function renderMarkdown(doc: KiroDocument): string {
  const out: string[] = [];
  if (doc.title) {
    out.push(`# ${doc.title}`);
    out.push("");
  }
  for (const block of doc.blocks) {
    switch (block.type) {
      case "heading":
        out.push(`${"#".repeat(block.level)} ${renderMarkdownInline(block.content)}`);
        out.push("");
        break;
      case "paragraph":
        out.push(renderMarkdownInline(block.content));
        out.push("");
        break;
      case "bullet-list":
        for (const item of block.items) {
          out.push(`- ${renderMarkdownInline(item)}`);
        }
        out.push("");
        break;
      case "numbered-list":
        block.items.forEach((item, i) => {
          out.push(`${i + 1}. ${renderMarkdownInline(item)}`);
        });
        out.push("");
        break;
      case "quote":
        out.push(`> ${renderMarkdownInline(block.content)}`);
        out.push("");
        break;
      case "code":
        out.push("```" + (block.language ?? "") + "\n" + block.text + "\n```");
        out.push("");
        break;
      case "table": {
        const header = block.header.map((cell) => renderMarkdownInline(cell));
        out.push(`| ${header.join(" | ")} |`);
        out.push(`| ${header.map(() => "---").join(" | ")} |`);
        for (const row of block.rows) {
          out.push(`| ${row.map((cell) => renderMarkdownInline(cell)).join(" | ")} |`);
        }
        out.push("");
        break;
      }
      case "page-break":
        out.push("");
        out.push("---");
        out.push("");
        break;
    }
  }
  return out.join("\n").trimEnd() + "\n";
}

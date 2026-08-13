import JSZip from "jszip";
import { KiroDocument, KiroInline } from "@/lib/ai/computer/documents/types";
import { ComputerError } from "@/lib/ai/computer/errors";

/**
 * Document IR → DOCX（OOXML package 由 renderer 全权生成；模型永远不提交 raw OOXML）。
 * 所有用户/模型文本进入 XML 前强制 escape（& < > " '）。
 */

function xmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function renderRuns(inline: KiroInline[] | undefined): string {
  if (!inline || inline.length === 0) return "";
  return inline
    .map((run) => {
      const props: string[] = [];
      if (run.bold) props.push("<w:b/>");
      if (run.italic) props.push("<w:i/>");
      const propsXml = props.length > 0 ? `<w:rPr>${props.join("")}</w:rPr>` : "";
      return `<w:r>${propsXml}<w:t xml:space="preserve">${xmlEscape(run.text)}</w:t></w:r>`;
    })
    .join("");
}

function styleIdForHeading(level: 1 | 2 | 3): string {
  return level === 1 ? "Heading1" : level === 2 ? "Heading2" : "Heading3";
}

function styleIdForBlock(block: { type: string }): string {
  switch (block.type) {
    case "quote":
      return "Quote";
    case "code":
      return "CodeBlock";
    case "bullet-list":
      return "ListBullet";
    case "numbered-list":
      return "ListNumber";
    default:
      return "Normal";
  }
}

export async function renderDocx(doc: KiroDocument): Promise<Uint8Array> {
  const paragraphs: string[] = [];
  if (doc.title) {
    paragraphs.push(`<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>${renderRuns([{ text: doc.title }])}</w:p>`);
  }
  for (const block of doc.blocks) {
    switch (block.type) {
      case "heading":
        paragraphs.push(`<w:p><w:pPr><w:pStyle w:val="${styleIdForHeading(block.level)}"/></w:pPr>${renderRuns(block.content)}</w:p>`);
        break;
      case "paragraph":
        paragraphs.push(`<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr>${renderRuns(block.content)}</w:p>`);
        break;
      case "bullet-list":
        for (const item of block.items) {
          paragraphs.push(`<w:p><w:pPr><w:pStyle w:val="ListBullet"/></w:pPr>${renderRuns(item)}</w:p>`);
        }
        break;
      case "numbered-list":
        for (const item of block.items) {
          paragraphs.push(`<w:p><w:pPr><w:pStyle w:val="ListNumber"/></w:pPr>${renderRuns(item)}</w:p>`);
        }
        break;
      case "quote":
        paragraphs.push(`<w:p><w:pPr><w:pStyle w:val="Quote"/></w:pPr>${renderRuns(block.content)}</w:p>`);
        break;
      case "code":
        paragraphs.push(`<w:p><w:pPr><w:pStyle w:val="CodeBlock"/></w:pPr>${renderRuns([{ text: block.text }])}</w:p>`);
        break;
      case "page-break":
        paragraphs.push(`<w:p><w:r><w:br w:type="page"/></w:r></w:p>`);
        break;
      case "table": {
        const rows: string[] = [];
        const allRows = [block.header, ...block.rows];
        for (const row of allRows) {
          const cells = row
            .map((cell) => `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${renderRuns(cell)}</w:tc>`)
            .join("");
          rows.push(`<w:tr>${cells}</w:tr>`);
        }
        paragraphs.push(`<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>${rows.join("")}</w:tbl>`);
        break;
      }
    }
  }

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${paragraphs.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body>
</w:document>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:spacing w:before="240" w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="Heading 2"/><w:pPr><w:spacing w:before="200" w:after="100"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="Heading 3"/><w:pPr><w:spacing w:before="160" w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:rPr><w:i/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="CodeBlock"><w:name w:val="CodeBlock"/><w:rPr><w:sz w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="ListBullet"/><w:numPr><w:numId w:val="1"/></w:numPr></w:style>
<w:style w:type="paragraph" w:styleId="ListNumber"><w:name w:val="ListNumber"/><w:numPr><w:numId w:val="2"/></w:numPr></w:style>
</w:styles>`;

  const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`;

  const coreProps = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>${xmlEscape(doc.title ?? "")}</dc:title>
<dc:creator>ClassFlow Kiro</dc:creator>
</cp:coreProperties>`;

  const appProps = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
<Application>ClassFlow Kiro</Application>
</Properties>`;

  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypes);
  zip.file("_rels/.rels", rels);
  zip.file("docProps/core.xml", coreProps);
  zip.file("docProps/app.xml", appProps);
  zip.file("word/document.xml", documentXml);
  zip.file("word/styles.xml", stylesXml);
  zip.file("word/numbering.xml", numberingXml);
  zip.file("word/_rels/document.xml.rels", docRels);

  const blob = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return new Uint8Array(blob);
}

export { ComputerError };

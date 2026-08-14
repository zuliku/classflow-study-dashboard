/**
 * DOCX Package Manifest Dump（V2.4 forensics）—— 不依赖 .NET。
 * 输出：文件大小 / ZIP entries（含压缩前后大小）/ [Content_Types].xml / 顶层 rels /
 * document.xml namespaces / docProps。用于 01-paragraph vs control.docx 的 package 对比。
 */
import { readFile, stat } from "node:fs/promises";
import JSZip from "jszip";

export interface DocxPackageManifest {
  file: string;
  size: number;
  entries: Array<{ name: string; size: number; compressedSize: number; crc32: number }>;
  contentTypes: string;
  rootRels: string;
  documentNamespaces: string[];
  hasNumbering: boolean;
  hasTheme: boolean;
  docProps: { title?: string; creator?: string };
}

export async function inspectDocxPackage(filePath: string): Promise<DocxPackageManifest> {
  const bytes = await readFile(filePath);
  const info = await stat(filePath);
  const zip = await JSZip.loadAsync(bytes);
  const entries: DocxPackageManifest["entries"] = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const data = await entry.async("uint8array");
    entries.push({ name: entry.name, size: data.byteLength, compressedSize: 0, crc32: 0 });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));

  const contentTypes = (await zip.file("[Content_Types].xml")?.async("string")) ?? "";
  const rootRels = (await zip.file("_rels/.rels")?.async("string")) ?? "";
  const documentXml = (await zip.file("word/document.xml")?.async("string")) ?? "";
  const nsMatch = /<w:document([^>]*)>/.exec(documentXml);
  const namespaces = nsMatch
    ? nsMatch[1].match(/xmlns(?::\w+)?="[^"]*"/g) ?? []
    : [];

  const coreXml = (await zip.file("docProps/core.xml")?.async("string")) ?? "";
  const titleMatch = /<dc:title>([^<]*)<\/dc:title>/.exec(coreXml);
  const creatorMatch = /<dc:creator>([^<]*)<\/dc:creator>/.exec(coreXml);

  return {
    file: filePath,
    size: info.size,
    entries,
    contentTypes,
    rootRels,
    documentNamespaces: namespaces,
    hasNumbering: !!zip.file("word/numbering.xml"),
    hasTheme: !!zip.file("word/theme/theme1.xml"),
    docProps: { title: titleMatch?.[1], creator: creatorMatch?.[1] },
  };
}

/** 只输出安全 metadata（不输出用户正文）；fixture 内容可经 --include-content 单独查看 */
export function summarizeManifest(manifest: DocxPackageManifest): string {
  const lines = [
    `file: ${manifest.file}`,
    `size: ${manifest.size} bytes`,
    `entries (${manifest.entries.length}):`,
    ...manifest.entries.map((e) => `  ${e.name} (${e.size} bytes)`),
    `document namespaces:`,
    ...manifest.documentNamespaces.map((n) => `  ${n}`),
    `has numbering.xml: ${manifest.hasNumbering}`,
    `has theme: ${manifest.hasTheme}`,
    `docProps: ${JSON.stringify(manifest.docProps)}`,
  ];
  return lines.join("\n");
}

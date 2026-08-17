/**
 * Kiro DOCX Package Provenance Inspector（V2.6）。
 *
 * 判断 DOCX 来源不能只依赖 Artifact DB（artifact.source 可能被旧状态/旧流程污染），
 * package 自身的证据（docProps + 结构签名）也必须参与：
 *
 * - legacyStructuralSignature：detectLegacyKiroDocx（w:tc→w:r direct child / w:style→w:numPr direct child）
 * - legacyKiroProducer：docProps 明确标识旧 Kiro renderer（Application 或 creator = "ClassFlow Kiro"，
 *   且不含当前 renderer marker）——旧手写 renderer 的唯一 package 证据
 * - currentRendererMarker：docProps/core.xml <dc:description> 包含当前 renderer marker
 */

import JSZip from "jszip";
import { detectLegacyKiroDocx } from "@/lib/ai/computer/documents/legacy";
import { DOCX_CREATOR, DOCX_RENDERER_MARKER } from "@/lib/ai/computer/runtimeVersion";

export interface KiroDocxProvenance {
  legacyStructuralSignature: boolean;
  directTableRuns: number;
  invalidStyleNumPr: number;
  legacyKiroProducer: boolean;
  currentRendererMarker: boolean;
  creator?: string;
  application?: string;
  description?: string;
}

function extractXmlElement(xml: string | undefined, tag: string): string | undefined {
  if (!xml) return undefined;
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`).exec(xml);
  return m ? m[1] : undefined;
}

/** 读取 docProps 的 creator / description / Application（不抛错；非 DOCX package → 全 undefined） */
export async function readDocxDocProps(bytes: Uint8Array): Promise<{
  creator?: string;
  application?: string;
  description?: string;
}> {
  try {
    const zip = await JSZip.loadAsync(bytes);
    const core = await zip.file("docProps/core.xml")?.async("string");
    const app = await zip.file("docProps/app.xml")?.async("string");
    return {
      creator: extractXmlElement(core, "dc:creator"),
      description: extractXmlElement(core, "dc:description"),
      application: extractXmlElement(app, "Application"),
    };
  } catch {
    return {};
  }
}

export async function inspectKiroDocxProvenance(bytes: Uint8Array): Promise<KiroDocxProvenance> {
  const detection = await detectLegacyKiroDocx(bytes);
  const props = await readDocxDocProps(bytes);
  const currentRendererMarker = !!props.description && props.description.includes(DOCX_RENDERER_MARKER);
  const legacyKiroProducer =
    !currentRendererMarker && (props.application === DOCX_CREATOR || props.creator === DOCX_CREATOR);
  return {
    legacyStructuralSignature: detection.legacy,
    directTableRuns: detection.directTableRuns,
    invalidStyleNumPr: detection.invalidStyleNumPr,
    legacyKiroProducer,
    currentRendererMarker,
    creator: props.creator,
    application: props.application,
    description: props.description,
  };
}

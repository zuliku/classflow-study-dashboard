/**
 * On-demand fixture generation（npm run eval:visual:fixtures）。
 * 生成全部 20 个场景的 synthetic PNG 到 .tmp/visual-intake-eval/（已 gitignore，不提交）。
 */
import { it } from "vitest";
import { join } from "path";
import { VISUAL_INTAKE_EVAL_SCENARIOS } from "@/lib/ai/eval/visualIntakeScenarios";
import { renderAllVisualIntakeFixtures, cjkFontAvailable, CjkFontUnavailableError } from "@/scripts/visual-intake-eval/renderScreenshot";

it("生成全部 synthetic fixtures 到 .tmp/visual-intake-eval/", () => {
  if (!cjkFontAvailable()) throw new CjkFontUnavailableError();
  const dir = join(process.cwd(), ".tmp", "visual-intake-eval");
  const files = renderAllVisualIntakeFixtures(
    dir,
    VISUAL_INTAKE_EVAL_SCENARIOS.map((s) => s.screenshot)
  );
  console.log(`fixtures written: ${files.length}`);
}, 60_000);

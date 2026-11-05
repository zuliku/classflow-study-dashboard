import { afterEach, describe, expect, it } from "vitest";
import { handleSubagent } from "@/app/api/ai/subagent/route";
import {
  __clearAllInvocationsForTest,
  beginInvocation,
} from "@/src/main/security/invocationTrust";

function request(body: unknown) {
  return new Request("http://127.0.0.1/api/ai/subagent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const BASE = {
  provider: "deepseek",
  model: "deepseek-flash",
  apiKey: "sk-test",
  messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "研究" }] }],
};

describe("handleSubagent validation / trust boundary", () => {
  afterEach(() => {
    __clearAllInvocationsForTest();
  });

  it("非法 JSON / 缺失 provider / 非法 subagent → 4xx，不启动模型", async () => {
    const badJson = await handleSubagent(
      new Request("http://127.0.0.1/api/ai/subagent", { method: "POST", body: "{" })
    );
    expect(badJson.status).toBe(400);

    const noProvider = await handleSubagent(request({ ...BASE, provider: "unknown" }));
    expect(noProvider.status).toBe(400);

    const invocationId = beginInvocation("local-user");
    const invalidSubagent = await handleSubagent(
      request({
        ...BASE,
        invocationId,
        subagent: { role: "writer", task: "写文章" },
      })
    );
    expect(invalidSubagent.status).toBe(400);
    const body = (await invalidSubagent.json()) as { code: string };
    expect(body.code).toBe("SUBAGENT_INVALID_INPUT");
  });

  it("remote-channel invocation → 403（子代理仅本地）", async () => {
    const invocationId = beginInvocation("remote-channel", { source: "qq-bot" });
    const res = await handleSubagent(
      request({
        ...BASE,
        invocationId,
        subagent: { role: "researcher", task: "研究一个主题" },
      })
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("SUBAGENT_LOCAL_ONLY");
  });

  it("缺失 invocationId → 400（validator fail closed）", async () => {
    const res = await handleSubagent(
      request({
        ...BASE,
        subagent: { role: "planner", task: "制定计划" },
      })
    );
    expect(res.status).toBe(400);
  });
});

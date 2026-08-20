import { describe, expect, it } from "vitest";
import { getInboxSourcePresentation } from "@/lib/inbox/sourcePresentation";

describe("channel brand presentation", () => {
  it.each([
    ["qq-bot", "QQ", "/brand/channels/qq.png"],
    ["qq-mail", "QQ 邮箱", "/brand/channels/qq-mail.svg"],
    ["gmail", "Gmail", "/brand/channels/gmail.svg"],
  ] as const)("maps %s to the expected label and brand asset", (source, label, iconSrc) => {
    expect(getInboxSourcePresentation(source)).toEqual({ label, iconSrc });
  });
});

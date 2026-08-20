import { describe, it, expect, beforeEach } from "vitest";
import { __clearChannelRegistryForTest, registerChannelFactory, getChannelFactory, listRegisteredChannelTypes } from "@/src/main/channels/registry";
import type { QQChannelConfig } from "@/src/main/channels/qq/config";

describe("channelRegistry", () => {
  beforeEach(() => __clearChannelRegistryForTest());

  it("register and get factory", () => {
    const fakeFactory = (() => ({ id: "test", getState: () => "disconnected" as const })) as never;
    registerChannelFactory("qq-bot", fakeFactory);
    expect(getChannelFactory("qq-bot")).toBe(fakeFactory);
    expect(listRegisteredChannelTypes()).toEqual(["qq-bot"]);
  });

  it("unknown type returns undefined", () => {
    expect(getChannelFactory("qq-bot")).toBeUndefined();
  });

  it("re-register overwrites", () => {
    const f1 = (() => 1) as never;
    const f2 = (() => 2) as never;
    registerChannelFactory("qq-bot", f1);
    registerChannelFactory("qq-bot", f2);
    expect(getChannelFactory("qq-bot")).toBe(f2);
  });

  it("factory creates adapter with config", () => {
    const fakeAdapter = { id: "qq_1", channel: "qq-bot" } as never;
    const factory = (config: QQChannelConfig) => {
      expect(config.appId).toBe("123");
      return fakeAdapter;
    };
    registerChannelFactory("qq-bot", factory as never);
    const f = getChannelFactory("qq-bot")!;
    const adapter = (f as (c: QQChannelConfig) => unknown)({ id: "qq_1", appId: "123", credentialRef: "cred_1" } as QQChannelConfig);
    expect(adapter).toBe(fakeAdapter);
  });
});

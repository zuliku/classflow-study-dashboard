import { describe, it, expect } from "vitest";
import {
  validateAvatarFile,
  AVATAR_MAX_BYTES,
  AVATAR_STORAGE_KEY,
} from "@/lib/profileAvatar";

function fakeFile(type: string, size: number, name = "avatar.png"): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe("profileAvatar 文件校验（纯函数）", () => {
  it("接受合法的图片文件", () => {
    expect(validateAvatarFile(fakeFile("image/png", 1024))).toEqual({ ok: true });
    expect(validateAvatarFile(fakeFile("image/jpeg", 1024))).toEqual({ ok: true });
    expect(validateAvatarFile(fakeFile("image/webp", 1024))).toEqual({ ok: true });
  });

  it("非图片文件被拒绝（type 检查）", () => {
    expect(validateAvatarFile(fakeFile("text/plain", 1024)).ok).toBe(false);
    expect(validateAvatarFile(fakeFile("application/pdf", 1024)).ok).toBe(false);
    // 伪装成 image 的实际非图片也会在 decode 阶段失败；这里验证 mime 前缀检查
    expect(validateAvatarFile(fakeFile("image/png", 1024)).ok).toBe(true);
  });

  it("超过 5 MB 的图片被拒绝", () => {
    expect(validateAvatarFile(fakeFile("image/png", AVATAR_MAX_BYTES)).ok).toBe(true);
    expect(validateAvatarFile(fakeFile("image/png", AVATAR_MAX_BYTES + 1)).ok).toBe(false);
  });

  it("固定 storage key（持久化地址唯一）", () => {
    expect(AVATAR_STORAGE_KEY).toBe("profile-avatar");
  });
});

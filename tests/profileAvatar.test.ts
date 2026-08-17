import { describe, it, expect } from "vitest";
import {
  validateAvatarFile,
  detectImageMime,
  AVATAR_MAX_BYTES,
  AVATAR_STORAGE_KEY,
} from "@/lib/profileAvatar";
import { stripUnbackableAvatarRef, AVATAR_ZIP_PATH } from "@/lib/backupPackage";
import { UserProfile } from "@/types";

function fakeFile(type: string, size: number, name = "avatar.png"): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe("profileAvatar 文件校验（纯函数）", () => {
  it("接受合法的图片文件", () => {
    expect(validateAvatarFile(fakeFile("image/png", 1024))).toEqual({ ok: true });
    expect(validateAvatarFile(fakeFile("image/jpeg", 1024))).toEqual({ ok: true });
    expect(validateAvatarFile(fakeFile("image/webp", 1024))).toEqual({ ok: true });
  });

  it("非图片 MIME 被拒绝（前置过滤）；伪装 image/* 由解码层拦截", () => {
    expect(validateAvatarFile(fakeFile("text/plain", 1024)).ok).toBe(false);
    expect(validateAvatarFile(fakeFile("application/pdf", 1024)).ok).toBe(false);
    // MIME 前缀只是预过滤（V4.1 contract）：伪装 image 的无效字节需通过
    // validateAvatarDecodable（浏览器解码）拒绝，此处不承诺 decode。
    expect(validateAvatarFile(fakeFile("image/png", 1024)).ok).toBe(true);
  });

  it("超过 5 MB 的图片被拒绝", () => {
    expect(validateAvatarFile(fakeFile("image/png", AVATAR_MAX_BYTES)).ok).toBe(true);
    expect(validateAvatarFile(fakeFile("image/png", AVATAR_MAX_BYTES + 1)).ok).toBe(false);
  });

  it("固定 storage key（持久化地址唯一）", () => {
    expect(AVATAR_STORAGE_KEY).toBe("profile-avatar");
    expect(AVATAR_ZIP_PATH).toBe("avatar/profile-avatar");
  });
});

describe("detectImageMime 字节签名识别", () => {
  it("PNG / JPEG / WebP 按签名识别", () => {
    // PNG 魔数 \x89PNG\r\n\x1a\n
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0]);
    expect(detectImageMime(png)).toBe("image/png");
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    expect(detectImageMime(jpeg)).toBe("image/jpeg");
    const webp = new TextEncoder().encode("RIFF\x00\x00\x00\x00WEBPVP8 ");
    expect(detectImageMime(webp)).toBe("image/webp");
  });

  it("未知/过短字节 → octet-stream", () => {
    expect(detectImageMime(new Uint8Array([0, 1, 2]))).toBe("application/octet-stream");
    expect(detectImageMime(new Uint8Array([]))).toBe("application/octet-stream");
    const text = new TextEncoder().encode("not an image at all");
    expect(detectImageMime(text)).toBe("application/octet-stream");
  });
});

describe("stripUnbackableAvatarRef（JSON 备份语义）", () => {
  const base = (): UserProfile => ({
    name: "u",
    avatarUrl: "",
    avatarStorageKey: AVATAR_STORAGE_KEY,
    college: "c",
    grade: "g",
    studentId: "s",
    completedCredits: 0,
    totalCredits: 0,
  });

  it("声明 avatarStorageKey → JSON 导出剥离该引用", () => {
    const stripped = stripUnbackableAvatarRef(base());
    expect(stripped.avatarStorageKey).toBeUndefined();
    expect(stripped.name).toBe("u");
  });

  it("未声明 → 原样返回（兼容旧 profile）", () => {
    const profile = { ...base(), avatarStorageKey: undefined };
    expect(stripUnbackableAvatarRef(profile)).toBe(profile);
  });

  it("旧版 avatarUrl（外部 URL）保持原样", () => {
    const profile = { ...base(), avatarUrl: "https://example.com/a.png" };
    const stripped = stripUnbackableAvatarRef(profile);
    expect(stripped.avatarUrl).toBe("https://example.com/a.png");
    expect(stripped.avatarStorageKey).toBeUndefined();
  });
});

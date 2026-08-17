import { describe, expect, it } from "vitest";
import { getAddedIds } from "@/lib/addedIds";

describe("getAddedIds", () => {
  it("does not animate the initial collection", () => {
    expect(getAddedIds(null, ["a", "b"])).toEqual([]);
  });

  it("returns only genuine insertions", () => {
    expect(getAddedIds(["a"], ["a", "b"])).toEqual(["b"]);
    expect(getAddedIds(["a", "b"], ["b", "a"])).toEqual([]);
    expect(getAddedIds(["a", "b"], ["a"])).toEqual([]);
  });

  it("counts an id re-added after it was absent", () => {
    expect(getAddedIds(["a", "b"], ["a"])).toEqual([]);
    const afterRemoval = ["a"];
    expect(getAddedIds(afterRemoval, ["a", "b"])).toEqual(["b"]);
  });
});

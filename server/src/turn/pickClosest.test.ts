import { describe, expect, it } from "vitest";

// pickClosest lives in broker.ts, which imports the database on load; re-implementing the
// contract here would hide drift, so we import it through a dynamic import with DATA_DIR
// pointed at a throwaway directory.
process.env.DATA_DIR = process.env.DATA_DIR ?? "./data-test";
const { pickClosest } = await import("./broker.js");

describe("model pin degradation", () => {
  it("prefers the same family when the exact model is missing", () => {
    expect(pickClosest("claude-opus-5", ["gpt-5", "claude-opus-4.6", "claude-sonnet-4.5"])).toBe("claude-opus-4.6");
    expect(pickClosest("claude-sonnet-4.5", ["gpt-5", "claude-sonnet-4"])).toBe("claude-sonnet-4");
  });
  it("falls back through the family ranking", () => {
    expect(pickClosest("claude-opus-5", ["claude-haiku-4.5", "gpt-5"])).toBe("gpt-5");
    expect(pickClosest("claude-opus-5", ["claude-haiku-4.5", "gpt-4.1"])).toBe("claude-haiku-4.5");
  });
  it("returns the only model when nothing matches", () => {
    expect(pickClosest("mystery", ["some-model"])).toBe("some-model");
  });
});

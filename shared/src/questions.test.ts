import { describe, expect, it } from "vitest";
import { questionSimilarity, similarQuestion, stripRepeatedQuestions } from "./questions.js";
import type { Question } from "./reducer.js";

const q = (id: string, text: string): Question => ({ id, label: `Q-${id}`, text, askedBy: null, addressedTo: [], status: "open", eventId: `e${id}`, createdAt: "2026-09-06T00:00:00Z" });

describe("questions register guards", () => {
  const open = [q("01", "Which region hosts the DR site?"), q("02", "Do we keep the legacy CSV feed after the cut-over?")];

  it("measures overlap on meaningful words", () => {
    expect(questionSimilarity("Which region hosts the DR site?", "What region will host the DR site?")).toBeGreaterThan(0.5);
    expect(questionSimilarity("Which region hosts the DR site?", "Should orders be idempotent?")).toBe(0);
  });

  it("finds the open question a reworded one repeats", () => {
    expect(similarQuestion("Could you confirm which region will host the DR site?", open)?.label).toBe("Q-01");
    expect(similarQuestion("Should the payment gateway retry on timeout?", open)).toBeNull();
  });

  it("takes repeated questions out of a reply and keeps the rest", () => {
    const reply = "Recorded D-04 for the cache. I still need to know: which region hosts the DR site? Also, is the legacy CSV feed kept after the cut-over?\n\nThe deployment view is updated.";
    const r = stripRepeatedQuestions(reply, open);
    expect(r.removed).toHaveLength(2);
    expect(r.text).toContain("Recorded D-04 for the cache.");
    expect(r.text).toContain("The deployment view is updated.");
    expect(r.text).not.toMatch(/DR site\?/);
    expect(r.text).not.toMatch(/CSV feed/);
  });

  it("drops a bullet that only re-asks, leaves new questions alone", () => {
    const reply = "Open points:\n- Which region hosts the DR site?\n- Should we shard the orders table by tenant?";
    const r = stripRepeatedQuestions(reply, open);
    expect(r.removed).toEqual(["- Which region hosts the DR site?"]);
    expect(r.text).toBe("Open points:\n\n- Should we shard the orders table by tenant?");
  });

  it("never returns an empty reply", () => {
    expect(stripRepeatedQuestions("Which region hosts the DR site?", open).text).toBe("Which region hosts the DR site?");
  });
});

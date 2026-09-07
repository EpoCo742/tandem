import type { Question } from "./reducer.js";

// Keeping the AI from asking twice. The register is the memory; these helpers catch the two ways a
// model still repeats itself: raising a question that is already open, and writing an open question
// back into its reply. Both are decided by word overlap, which is cheap and needs no model.

const STOP = new Set(["that", "this", "with", "from", "have", "will", "what", "which", "should", "would", "could", "there", "their", "about", "does", "need", "want", "your", "they", "them", "than", "then", "when", "where", "into", "also", "still", "know", "please", "tell", "like", "some", "more", "just", "been", "were", "here"]);
const stem = (w: string) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
const wordsOf = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).map(stem).filter((w) => w.length > 3 && !STOP.has(w)));

/** Word overlap between two texts, 0 to 1 (Jaccard on words longer than three letters, stop words dropped). */
export function questionSimilarity(a: string, b: string): number {
  const wa = wordsOf(a);
  const wb = wordsOf(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let both = 0;
  for (const w of wa) if (wb.has(w)) both++;
  return both / (wa.size + wb.size - both);
}

/** The open question this text is a rewording of, if any. */
export function similarQuestion(text: string, open: Question[], threshold = 0.5): Question | null {
  let best: { q: Question; s: number } | null = null;
  for (const q of open) {
    const s = questionSimilarity(text, q.text);
    if (s >= threshold && (!best || s > best.s)) best = { q, s };
  }
  return best?.q ?? null;
}

/** A reply with the sentences that re-ask an open question taken out; what was removed comes back for the log. */
export function stripRepeatedQuestions(text: string, open: Question[], threshold = 0.5): { text: string; removed: string[] } {
  if (open.length === 0 || !text.includes("?")) return { text, removed: [] };
  const removed: string[] = [];
  const lines = text.split("\n").map((line) => {
    if (!line.includes("?")) return line;
    // Sentences: split after ., ! or ? followed by a space; a bullet or heading line is one unit.
    const parts = /^\s*([-*]|\d+\.)\s/.test(line) || /^#/.test(line) ? [line] : line.split(/(?<=[.!?])\s+/);
    const kept = parts.filter((p) => {
      const q = p.trim().endsWith("?") ? similarQuestion(p, open, threshold) : null;
      if (q) removed.push(p.trim());
      return !q;
    });
    return kept.join(" ").replace(/\s+$/, "");
  });
  const out = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text: out || text, removed };
}

// Restore a card whose latest version cannot be rendered, as a forward version (nothing is
// deleted from the ledger). Run from the server directory with the server STOPPED, because the
// running server caches session state in memory:
//
//   npx tsx scripts/repair-card.ts <sessionId> <artifactId> [--resolve <optionId> [--decision <decisionId>]]
//
// --resolve marks a restored decision point as resolved with that option (use it when the AI
// already recorded the decision but broke the card instead of leaving it to the vote).
import { contentProblem, type DecisionPointContent } from "@tandem/shared";
import { appendEvent, getState } from "../src/ledger.js";
import { createCommit, requestChange } from "../src/governance.js";

const args = process.argv.slice(2);
const [sessionId, artifactId] = args;
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!sessionId || !artifactId) {
  console.error("usage: npx tsx scripts/repair-card.ts <sessionId> <artifactId> [--resolve <optionId> [--decision <decisionId>]]");
  process.exit(2);
}

const state = getState(sessionId);
const a = state.artifacts[artifactId];
if (!a) {
  console.error(`no artifact ${artifactId} in session ${sessionId}`);
  process.exit(1);
}
const currentProblem = contentProblem(a.type, a.current.content);
console.log(`${a.title} (${a.type}) is at v${a.current.versionNo}: ${currentProblem ?? "renders fine"}`);
const good = [...a.versions].reverse().find((v) => contentProblem(a.type, v.content) === null);
if (!good) {
  console.error("no earlier version of this card renders either; nothing to restore");
  process.exit(1);
}
if (good.versionId === a.current.versionId) {
  console.log("the current version already renders; nothing to do");
  process.exit(0);
}
const actor = a.ownerUserId;
const outcome = requestChange({
  sessionId,
  turnId: null,
  actorKind: "user",
  actorUserId: actor,
  op: "restore",
  artifactId: a.id,
  artifactType: a.type,
  title: a.title,
  content: good.content,
  summary: good.summary,
  rationale: `Repair: restore v${good.versionNo}, the last version that renders`,
  baseVersionNo: null,
  causedBy: [a.current.eventId],
  provenance: good.provenance,
});
console.log(`restore of v${good.versionNo}: ${outcome.status}${"versionNo" in outcome ? ` as v${outcome.versionNo}` : ""}`);
if (outcome.status !== "applied") process.exit(1);

const resolve = flag("resolve");
if (resolve && a.type === "decision_point") {
  const c = good.content as DecisionPointContent;
  if (!c.options.some((o) => o.id === resolve)) {
    console.error(`no option ${resolve}; options are ${c.options.map((o) => o.id).join(", ")}`);
    process.exit(1);
  }
  const decisionId = flag("decision") ?? null;
  if (decisionId && !state.decisions[decisionId]) {
    console.error(`no decision ${decisionId} in this session`);
    process.exit(1);
  }
  appendEvent(sessionId, { type: "decision.voted", actorKind: "user", actorUserId: actor, causedBy: [a.current.eventId], payload: { decisionPointArtifactId: a.id, optionId: resolve } });
  appendEvent(sessionId, { type: "decision.resolved", actorKind: "system", actorUserId: null, causedBy: [a.current.eventId], payload: { decisionPointArtifactId: a.id, optionId: resolve, decisionId } });
  console.log(`decision point resolved with ${resolve}${decisionId ? ` (decision ${state.decisions[decisionId]!.label})` : ""}; blocked cards released`);
}
createCommit(sessionId, actor, null, `Repair: restore ${a.title} to v${good.versionNo}`);
const after = getState(sessionId).artifacts[artifactId]!;
console.log(`done: ${a.title} is now v${after.current.versionNo}, ${contentProblem(after.type, after.current.content) ?? "renders fine"}`);

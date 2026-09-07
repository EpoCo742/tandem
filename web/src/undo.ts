import * as Y from "yjs";
import type { Collab } from "./collab";

// Ctrl+Z / Ctrl+Y for what you did in this tab. Two stacks share the shortcut: card moves, resizes
// and tidies live in the shared layout document and are undone by a Yjs UndoManager (only this
// tab's own changes are tracked); edits and deletes are ledger changes and are undone by writing
// the previous state back as a new version, so history stays whole and everyone sees the undo.
// Whichever stack has the most recent action answers the key.

export interface UndoAction {
  label: string; // "edit of Data model"
  at: number;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

type Listener = (note: string) => void;

class ContentStack {
  done: UndoAction[] = [];
  undone: UndoAction[] = [];
  push(a: UndoAction) {
    this.done.push(a);
    this.undone = [];
    if (this.done.length > 50) this.done.shift();
  }
  clear() {
    this.done = [];
    this.undone = [];
  }
}

const content = new ContentStack();
let layout: Y.UndoManager | null = null;
const listeners = new Set<Listener>();
let busy = false;

/** Track this tab's own layout changes; call once per session with its collab document. */
export function bindLayoutUndo(collab: Collab): () => void {
  layout?.destroy();
  layout = new Y.UndoManager(collab.nodes, { captureTimeout: 400 });
  const stamp = (e: { stackItem: { meta: Map<string, unknown> } }) => e.stackItem.meta.set("at", Date.now());
  layout.on("stack-item-added", stamp);
  content.clear();
  return () => {
    layout?.destroy();
    layout = null;
  };
}

/** Wrap a layout change that should not be undoable (auto-placement of new cards, a size reset). */
export function untracked(collab: Collab, fn: () => void) {
  collab.doc.transact(fn, "auto");
}

/** Record a content action that has just been applied, with how to take it back and how to do it again. */
export function recordAction(a: Omit<UndoAction, "at">) {
  content.push({ ...a, at: Date.now() });
}

export function onUndoNote(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const say = (note: string) => listeners.forEach((l) => l(note));

const layoutTop = (stack: { meta: Map<string, unknown> }[] | undefined) => (stack && stack.length ? Number(stack[stack.length - 1]!.meta.get("at") ?? 0) : -1);

export async function undo(): Promise<void> {
  if (busy) return;
  const c = content.done[content.done.length - 1];
  const l = layout ? layoutTop(layout.undoStack) : -1;
  if (!c && l < 0) {
    say("Nothing to undo");
    return;
  }
  if (c && c.at >= l) {
    busy = true;
    try {
      await c.undo();
      content.done.pop();
      content.undone.push(c);
      say(`Undid ${c.label} · Ctrl+Y to redo`);
    } catch (e) {
      say(`Could not undo ${c.label}: ${(e as Error).message}`);
    } finally {
      busy = false;
    }
    return;
  }
  layout!.undo();
  say("Undid the last card move · Ctrl+Y to redo");
}

export async function redo(): Promise<void> {
  if (busy) return;
  const c = content.undone[content.undone.length - 1];
  const l = layout ? layoutTop(layout.redoStack) : -1;
  if (!c && l < 0) {
    say("Nothing to redo");
    return;
  }
  if (c && c.at >= l) {
    busy = true;
    try {
      await c.redo();
      content.undone.pop();
      content.done.push({ ...c, at: Date.now() });
      say(`Redid ${c.label}`);
    } catch (e) {
      say(`Could not redo ${c.label}: ${(e as Error).message}`);
    } finally {
      busy = false;
    }
    return;
  }
  layout!.redo();
  say("Redid the last card move");
}

/** True when the key event should be left to the element that has focus (typing in a box). */
export function typingTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
}

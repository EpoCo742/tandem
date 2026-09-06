// The organisation library: what earlier sessions decided, built and constrained, searchable
// across sessions, and the provenance carried by anything copied out of it.

export type LibraryKind = "decision" | "component" | "constraint" | "document";

/** Where a copied decision, component or constraint came from. Set by whoever copies it; never edited. */
export interface ImportedFrom {
  sessionId: string;
  sessionTitle: string;
  kind: LibraryKind;
  refId: string; // decision id, component id, constraint id (C-01) or publication slug
}

/** One search result. `snippet` marks the matched words with [ and ]. */
export interface LibraryHit {
  kind: LibraryKind;
  sessionId: string;
  sessionTitle: string;
  refId: string;
  title: string;
  snippet: string;
  people: string[]; // who agreed, set or signed it
  updatedAt: string;
  isPublic: boolean; // reachable because the session published a document, not because the searcher is in it
  link: string; // /s/:id or /p/:slug
  artifactId?: string; // card to focus when the link opens a session
  importRef: ImportedFrom; // ready to pass as importedFrom when copying it in
}

/** How a published design document stands: which version is out, who signed it, whether it is still live. */
export interface PublicationState {
  publicationId: string;
  artifactId: string;
  slug: string;
  status: "live" | "revoked";
  versions: { publicationVersionNo: number; docVersionNo: number; at: string; byUserId: string | null; note?: string; approved: { decisionLabel: string; signers: string[] } | null }[];
}

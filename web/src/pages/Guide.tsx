import { TopBar } from "../components/TopBar";
import { Brand, PRODUCT_NAME } from "../components/Brand";

// Where everything is and how to use it, in the app itself. One entry per feature: what it is,
// where to find it, what to do. Kept in step with docs/07-demo-script.md as features land; a
// feature that is not on this page is not finished.

interface Entry { name: string; where: string; how: string }
interface Group { title: string; blurb: string; entries: Entry[] }

const GROUPS: Group[] = [
  {
    title: "Sessions",
    blurb: "A session is one design conversation: the people, the canvas, the ledger of everything that happened in it.",
    entries: [
      { name: "Create a session", where: "Home page, New session", how: "Pick a kind of design (a template seeds the constraints card and a checklist), the AI provider, who pays for turns, and the model. Sponsor mode funds every turn from your credential; speaker mode uses each person's own." },
      { name: "Invite people", where: "Session top bar, the role picker then Invite", how: "Copy the link. Editors change the canvas. Reviewers comment, vote, sign off and propose, but nothing they do lands without approval. Viewers only read. Two to five people is the size this is built for." },
      { name: "Consent", where: "The note at the top of the AI lane, once per session", how: "Accept it before posting: everything in the lane and on the canvas is sent to the AI provider. The side channel is not. Consent carries into forks of the same session." },
      { name: "Rename, archive, delete", where: "The … menu next to the session title, in the top bar or on the home page", how: "Owner only. Archived sessions are read only and out of the digest until reopened. Delete removes everything for everyone; forks made from it survive." },
      { name: "Export a session file", where: "The … menu next to a session's title; or Home, Your sessions, Select… / Export all", how: "One JSON file with the whole session: conversation, cards and every version, decisions, uploads, canvas layout, published pages. Select… ticks several sessions for one file; Export all takes every session you are in. Credentials never go in the file." },
      { name: "Import session files", where: "Home page, Your sessions, Import…", how: "Pick a file exported here or on another install. Add as new sessions makes copies you own; nothing here is touched. Restore in place keeps every id and published page and replaces a same-id session you own; use it to put a backup back." },
      { name: "Fork", where: "Session top bar, Fork as v2", how: "A new session that starts from the current canvas and the agreed decisions; the original stays as it is. Superseded decisions and resolved decision points are left behind. The fork can compare its design document with the original's." },
      { name: "Built-in demo", where: "Home page, See it working", how: "A finished session to open or replay from the start. Read only for everyone; only its design document reaches the library." },
      { name: "Thumbnails and the list", where: "Home page, Your sessions", how: "Each row draws the shape of its canvas, and shows the provider, model, who pays, the policy and your role. Newest activity first." },
    ],
  },
  {
    title: "The AI lane",
    blurb: "The left pane: one AI, everyone in the room, every turn attributed and paid for by a person.",
    entries: [
      { name: "Address the AI", where: "Left pane, the message box", how: "Messages sent within about 1.5 seconds of each other are answered together in one turn, so two people asking at once get one coherent reply. Shift+Enter for a new line." },
      { name: "Mention someone", where: "Type @ and their name in any message", how: "The message is marked for them, shows in their digest on the home page, and can reach them through their own notification tool." },
      { name: "Attach a file", where: "Attach file, or drop a file anywhere on the lane", how: "Screenshots, Markdown, text, YAML, JSON and .mmd diagrams become source cards the AI treats as source material. Type what it should do with the file, then send." },
      { name: "Resize the box", where: "The grip above the message box", how: "Drag it up to make the box taller. The size is remembered in this browser." },
      { name: "What the AI is doing", where: "The AI lane, while a turn runs", how: "Three moving dots and a line in plain words: thinking, drawing System architecture, recording a decision, writing the reply. Finished steps stack above the current one, so a long turn reads as progress rather than silence. Nothing is spent on it; the words come from the tool calls themselves." },
      { name: "Stop or send now", where: "Buttons under the message box", how: "Send now closes the batch window early instead of waiting. Stop interrupts a reply while it is being written; what arrived is kept." },
      { name: "What a turn cost", where: "The lane header, and the chip under each AI reply", how: "Running tokens in and out and the model of the last turn; click the header for the breakdown by model and by who paid, with turn counts and premium requests." },
      { name: "The brief", where: "Right pane, Brief", how: "In a long session, messages that fall out of the model's window are folded into a running brief that keeps who said what. The AI reads the brief instead. Refresh it by hand here." },
      { name: "Side channel", where: "Right pane, Side channel", how: "Talk to the other people without the AI hearing any of it. Promote a note when you want it sent to the AI after all." },
      { name: "Threads on cards", where: "The speech-bubble button on any card, or a component row on the model card", how: "Notes anchored to a card or a component, resolvable. Promote a thread to hand it to the AI with that card as context." },
    ],
  },
  {
    title: "The canvas",
    blurb: "The middle: every artifact as a card, laid out on a shared canvas everyone sees move.",
    entries: [
      { name: "Cards", where: "The centre of the session", how: "Every card has edit, versions, threads, full screen and delete. Editing a card someone else owns makes a proposal for them to approve. Drag to move, drag a corner to resize; both are shared." },
      { name: "Open a card full screen", where: "The ⤢ button on a card, or Present", how: "Zoom with the − % + buttons, the + − 0 keys, or Ctrl+wheel; f fits a diagram to the screen. Drag a zoomed diagram to move around it. Esc closes." },
      { name: "Undo and redo", where: "Ctrl+Z and Ctrl+Y anywhere in a session (Cmd on a Mac)", how: "Takes back your own last card move, resize, tidy, edit or delete in this tab. Edits and deletes come back as new versions, so the history stays whole and everyone sees it. Not for AI turns, decisions or answers." },
      { name: "Tidy", where: "Canvas corner, tidy", how: "Packs every card by its real size into as many columns as fill the screen shape. Everyone gets the new layout; Ctrl+Z puts it back." },
      { name: "Empty canvas", where: "A new session, before the first turn", how: "The empty state suggests what to ask for first, tuned to the template you chose." },
      { name: "Architecture model", where: "The arch model card", how: "The source of truth for structure: components, boundaries, relationships, deployment nodes. Views are drawn from it, never hand-drawn. Click a component for its decisions, threads and impact." },
      { name: "Views", where: "View cards, and the model card's view buttons", how: "Container, component, sequence and deployment views, plus as-is vs to-be when a baseline is recorded. All generated from the model; the sequence view needs no AI turn." },
      { name: "Import a diagram", where: "Model card, import…", how: "Paste Mermaid, Structurizr DSL or PlantUML to merge it into the model, replace the model, or record it as the as-is baseline." },
      { name: "As-is from code", where: "Ask “draw the current architecture of repository X” with a repository tool registered", how: "Reads manifests, never source, and records the result as the as-is baseline. From then on the model is the target state and the as-is view marks added, removed, changed and unchanged." },
      { name: "Data model", where: "Ask the AI for the data model", how: "Entities, fields and relationships as a card, rendered as tables and an entity diagram, and carried into the design document as tables." },
      { name: "Contracts", where: "Upload the spec, then say “Contract for Service B from orders-api.yaml”", how: "The uploaded OpenAPI or AsyncAPI document becomes a card rendered as an API reference: endpoints grouped by tag, parameters, body and responses on click, channels for AsyncAPI, raw text a click away." },
      { name: "Alternatives", where: "Ask the AI to compare or propose alternatives", how: "Candidates side by side with their own diagrams, for and against, against the constraints. Decide opens a vote; the winner becomes the model." },
      { name: "Data-flow classification", where: "The model card's relationship rows", how: "Flows carry what they move (PII, secrets, internal, public). A flow that breaks a residency or security constraint shows as a violation chip on the model card." },
      { name: "Impact", where: "Click a component on the model card", how: "What depends on it: the cards, decisions, constraints and threads that would be touched if it changed." },
      { name: "Presentation mode", where: "Session top bar, Present", how: "One card per screen. Arrow keys move, C opens the contents to jump, arrange picks which cards and in what order, and the decision log closes the walkthrough. Zoom works on a slide." },
      { name: "Live cursors", where: "Session top bar, cursors", how: "See where the others are on the canvas and what they have selected, in their own colour. Cycle the button to hide yours, or hide everyone's." },
      { name: "Appearance", where: "Top bar, the theme button", how: "Auto, light or dark, remembered in this browser. Cards glow briefly when someone changes them, boundaries are tinted per group, and diagrams are laid out with ELK so lines stay readable." },
    ],
  },
  {
    title: "Registers",
    blurb: "The right pane keeps what the group has settled, still owes an answer on, or has taken on faith.",
    entries: [
      { name: "Decisions", where: "Right pane, Decisions", how: "The AI records what the group settles. Proposed until everyone named agrees, then recorded, then superseded when something replaces it. Each one opens as an architecture decision record: context, options, consequences, deciders, evidence." },
      { name: "Decision points", where: "A decision point card, or Vote from the digest", how: "Opened when people disagree or a change puts a constraint at risk. Everyone votes; a deadline can be set, and when it passes without a majority the point expires and unblocks the cards it held." },
      { name: "Questions", where: "Right pane, Questions (a badge counts the open ones)", how: "What the AI or a person still needs answered. Answer or drop them here with no AI turn; the answer reaches the AI with the next message. Ask the group with the box at the bottom. The AI cannot open the same question twice, and a reply that re-asks an open one loses that sentence." },
      { name: "Assumptions", where: "Right pane, Decisions, Assumptions section", how: "Say “we assume …” and the AI records it with an optional revisit date. Settle one as held or did not hold; the digest reminds you when a date arrives." },
      { name: "Constraints", where: "The constraints card", how: "Musts, must-nots and targets with who set each one. The AI designs against them, and a change that breaks one raises a decision point rather than going through quietly." },
      { name: "Checklist", where: "Right pane, Checklist (templated sessions only)", how: "What a whole design of this kind still lacks. The AI steers toward the unticked items; the top bar shows how far along it is." },
      { name: "Sources", where: "Right pane, Sources", how: "Every uploaded file, what was extracted from it, and which cards cite it." },
    ],
  },
  {
    title: "Governance and history",
    blurb: "Nothing changes quietly: every change is an event, and anything contested waits for people.",
    entries: [
      { name: "Proposals", where: "Right pane, Proposals (a badge when one waits on you)", how: "Changes to cards you own, and outbound writes through your tools. Approve or reject with a reason. A proposal nobody answers expires rather than applying." },
      { name: "History and revert", where: "Right pane, History", how: "Every commit with who made it and what it touched, including external actions through tools. Revert takes the canvas back to a commit as a new forward change; nothing is erased." },
      { name: "Replay", where: "Session top bar, replay", how: "Scrub through the session from its first event: cards, decisions and messages as they were at that moment. Everything is read only while replaying." },
      { name: "Versions on a card", where: "Any card, versions", how: "Every version with its author, rationale and what it derived from. Compare two, or restore an earlier one as a new version." },
    ],
  },
  {
    title: "The design document",
    blurb: "What the session is for: one document, assembled from the canvas, reviewed and published.",
    entries: [
      { name: "Compile", where: "Session top bar, Compile design doc", how: "One AI turn assembles a Design document card from everything on the canvas: overview, architecture with the diagrams, data model, constraints, sources, decision log, open questions. Compile again after the canvas moves for a new version." },
      { name: "Read it as a page", where: "Design document card, read", how: "A full page with contents, a version picker, review status, print, and the link to the public page." },
      { name: "Compare versions", where: "The document page, compare with in the sidebar", how: "Pick another version, or in a fork a version from the original session. Shows what changed: text by section, decisions, model, constraints, contracts, questions and cards, with the major changes ranked on top. Save as card puts it on the canvas with no AI turn; save + AI narrative spends one turn on a “What matters” paragraph." },
      { name: "Review and sign-off", where: "Design document card, review panel", how: "Request review from named people; each signs; the approval is recorded as a decision. Any canvas change afterwards puts the document back in draft with a note of what moved." },
      { name: "Publish", where: "Design document card, publish panel", how: "A public page at /p/… that needs no sign-in, with a frozen copy per published version and the signatures on each. Publish again for a new version, or unpublish to take the page down and keep the address." },
      { name: "Export", where: "Session top bar, Export .md", how: "The whole session as Markdown: cards, diagrams, decision records, assumptions, questions, contracts, threads and external actions. The preview also offers the decision records as a zip of ADR files. The model card exports Structurizr DSL." },
    ],
  },
  {
    title: "Across sessions",
    blurb: "What one session learns, the next one can use.",
    entries: [
      { name: "Library", where: "Top bar, library; or the Library tab inside a session", how: "Search decisions, components, constraints, contracts and published documents from every session you are in, plus everything published. Filter by kind." },
      { name: "Copy something in", where: "A library hit, copy into this session", how: "Brings a decision, component or constraint across with a note of where it came from, with no AI turn. It goes through the same governance as anything else." },
      { name: "The AI can search it", where: "Ask for precedent from other sessions", how: "The AI searches the same library and cites what it found, so an agreed answer is reused rather than re-argued." },
      { name: "Digest", where: "Home page", how: "What is waiting on you across every session: votes, proposals, outbound writes, sign-offs, assumptions due a revisit and mentions, then what changed since you last looked." },
    ],
  },
  {
    title: "Your credentials and tools",
    blurb: "You bring the AI seat and the tools; the app never resells either.",
    entries: [
      { name: "Credentials", where: "Top bar, credentials", how: "Connect a Copilot token or sign in with GitHub. Your credential funds your turns, or the session's sponsor pays for everyone. The offline fake provider needs no seat and is there for demos." },
      { name: "External tools", where: "Top bar, credentials, External tools", how: "Register MCP servers by pasting an editor's mcp.json entry or filling in the fields. The AI reads through them freely; anything that writes is proposed to you first, and “always for …” records a standing permission you can revoke here. A server that fails or times out shows its status and last error here, never in the lane." },
      { name: "Notifications", where: "Top bar, credentials, Notifications", how: "Be told through one of your own tools, in the channel you name, when something waits on you. Setting the rule is the approval." },
      { name: "Backups for a whole install", where: "For whoever runs the server: scripts/backup.mjs with TANDEM_ADMIN_TOKEN set", how: "Export every session before a redeploy and import it after, or take a consistent copy of the database file. See the README section on backups and redeploys." },
    ],
  },
];

export function Guide() {
  document.title = `Guide · ${PRODUCT_NAME}`;
  const count = GROUPS.reduce((n, g) => n + g.entries.length, 0);
  return (
    <>
      <TopBar />
      <div className="page" style={{ maxWidth: 900 }}>
        <Brand large />
        <h1 style={{ fontSize: 26, margin: "18px 0 4px" }}>Where everything is</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          All {count} features of {PRODUCT_NAME}, where to find each one, and what to do there. Anything not on this page is not built yet.
        </p>
        {GROUPS.map((g) => (
          <section key={g.title} style={{ marginTop: 24 }}>
            <h2 style={{ fontSize: 17, marginBottom: 2 }}>{g.title}</h2>
            <p className="muted" style={{ margin: "0 0 8px", fontSize: 12.5 }}>{g.blurb}</p>
            <div style={{ overflowX: "auto" }}>
              <table className="guide">
                <thead><tr><th style={{ width: "20%" }}>Feature</th><th style={{ width: "28%" }}>Where</th><th>How</th></tr></thead>
                <tbody>
                  {g.entries.map((e) => (
                    <tr key={e.name}><td><b>{e.name}</b></td><td className="mono" style={{ fontSize: 11.5, letterSpacing: 0 }}>{e.where}</td><td>{e.how}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

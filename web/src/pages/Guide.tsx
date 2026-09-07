import { TopBar } from "../components/TopBar";
import { PRODUCT_NAME } from "../components/Brand";

// Where everything is and how to use it, in the app itself. One entry per feature: what it is,
// where to find it, what to do. Kept in step with docs/07-demo-script.md as features land.

interface Entry { name: string; where: string; how: string }
interface Group { title: string; entries: Entry[] }

const GROUPS: Group[] = [
  {
    title: "Sessions",
    entries: [
      { name: "Create a session", where: "Home page, New session", how: "Pick a kind of design (a template seeds the constraints card and a checklist), the AI provider, and who pays for turns." },
      { name: "Invite people", where: "Session top bar, Invite", how: "Copy the link. Editors can change the canvas; viewers and reviewers read, comment and vote." },
      { name: "Rename, archive, delete", where: "Session top bar, the … menu next to the title", how: "Archived sessions are read only until reopened. Delete removes everything for everyone; forks survive." },
      { name: "Fork", where: "Session top bar, Fork as v2", how: "A new session with the current canvas and agreed decisions. Your consent to the AI provider carries over. The fork can compare its design document with the original's." },
      { name: "Built-in demo", where: "Home page, See it working", how: "A finished session you can open and replay from the start. Read only; only its design document is in the library." },
    ],
  },
  {
    title: "The AI lane",
    entries: [
      { name: "Address the AI", where: "Left pane, the message box", how: "Accept the consent note once per session first. Messages sent within about 1.5 seconds of each other are answered together. Shift+Enter for a new line." },
      { name: "Attach a file", where: "Attach file, or drop a file anywhere on the lane", how: "Screenshots, Markdown, text, YAML, JSON and .mmd diagrams become source cards. Type what the AI should do with it, then send." },
      { name: "Resize the box", where: "The grip above the message box", how: "Drag it up to make the box taller. The size is remembered in this browser." },
      { name: "Stop or send now", where: "Buttons under the message box", how: "Send now closes the batch window early; Stop interrupts a reply that is being generated." },
      { name: "Side channel", where: "Right pane, Side channel", how: "Talk to the other people without the AI hearing. Promote a note to send it to the AI later." },
      { name: "Threads on cards", where: "The speech-bubble button on any card, or a component row on the model card", how: "Notes anchored to a card. Promote a thread to hand it to the AI with the card as context." },
    ],
  },
  {
    title: "The canvas",
    entries: [
      { name: "Cards", where: "The centre", how: "Every card has edit, versions, threads and delete. Editing someone else's card makes a proposal they approve." },
      { name: "Open a card full screen", where: "The ⤢ button on a card, or Present", how: "Zoom with the − % + buttons in the header, the + − 0 keys, Ctrl+wheel, or f to fit a diagram to the screen. Drag a diagram to move around it. Esc closes." },
      { name: "Undo and redo", where: "Ctrl+Z and Ctrl+Y anywhere in a session (Cmd on a Mac)", how: "Takes back your own last card move, resize, tidy, edit or delete in this tab; Ctrl+Y does it again. Edits and deletes are undone as new versions, so the history stays whole and everyone sees it. Not for AI turns, decisions or answers." },
      { name: "Tidy", where: "Canvas corner, tidy", how: "Packs every card by its real size into as many columns as fill the screen. Everyone gets the new layout." },
      { name: "Architecture model", where: "The arch model card", how: "The source of truth for structure. Views are drawn from it. Click a component to see its decisions, threads and impact." },
      { name: "Import a diagram", where: "Model card, import…", how: "Paste Mermaid, Structurizr DSL or PlantUML to merge into the model, replace it, or record it as the as-is baseline." },
      { name: "Sequence and deployment views", where: "Model card, Sequence from…; or ask the AI where things run", how: "Generated from the model's relationships and placements. No AI turn for the sequence view." },
      { name: "Alternatives", where: "Ask the AI to compare or propose alternatives", how: "Candidates side by side against the constraints. Decide opens a vote; the winner becomes the model." },
      { name: "Contracts", where: "Upload the spec, then say “Contract for Service B from orders-api.yaml”", how: "The uploaded OpenAPI or AsyncAPI document becomes a card rendered as an API reference: endpoints by tag, parameters and responses on click, raw text a click away." },
      { name: "Presentation mode", where: "Session top bar, Present", how: "One card per screen. Arrow keys move, C opens the contents to jump to a slide, arrange chooses which cards and in what order." },
      { name: "Live cursors", where: "Session top bar, cursors", how: "See where others are on the canvas, or hide yourself." },
    ],
  },
  {
    title: "Registers",
    entries: [
      { name: "Decisions", where: "Right pane, Decisions", how: "The AI records what the group settles. Proposed until everyone named agrees. A decision point opens a vote when people disagree or a constraint is at risk." },
      { name: "Questions", where: "Right pane, Questions (a badge shows how many are open)", how: "What the AI or a person still needs answered. Answer or drop them here with no AI turn; the answer reaches the AI with the next message. Ask the group with the box at the bottom. The AI cannot open the same question twice, and a reply that re-asks an open one loses that sentence." },
      { name: "Assumptions", where: "Right pane, Decisions, Assumptions section", how: "Say “we assume …” and the AI records it for you with an optional revisit date. Settle one as held or did not hold." },
      { name: "Constraints", where: "The constraints card", how: "Musts, must-nots and targets with who set them. Changes that break one raise a decision point." },
      { name: "Checklist", where: "Right pane, Checklist (templated sessions)", how: "What a whole design of this kind still lacks; the AI steers toward the unticked items." },
    ],
  },
  {
    title: "Documents",
    entries: [
      { name: "Compile the design document", where: "Session top bar, Compile design doc", how: "One AI turn assembles a Design document card from everything on the canvas. Compile again after the canvas moves to get a new version." },
      { name: "Read it as a page", where: "Design document card, read", how: "A page with contents, a version picker, status, print, and the public page link." },
      { name: "Compare versions", where: "Design document card, read, then compare with in the sidebar", how: "Pick another version (or, in a fork, a version from the original session). The page shows what changed: text by section, decisions, model, constraints, contracts, questions, other cards, with the major changes ranked on top. Save as card puts it on the canvas with no AI turn; save + AI narrative spends one turn on a “What matters” paragraph. On a published document, the publish panel offers changes since the published version." },
      { name: "Review and sign-off", where: "Design document card, review panel", how: "Request review; reviewers sign; approval is recorded as a decision. Any canvas change puts the document back in draft." },
      { name: "Publish", where: "Design document card, publish panel", how: "A public page at /p/… with every published version. Publish again after changes for a new version; unpublish takes the page down and keeps the link." },
      { name: "Export", where: "Session top bar, Export .md; or the model card's structurizr .dsl", how: "The whole session as Markdown with decisions, ADRs, assumptions, questions, contracts and diagrams; or the model as Structurizr DSL." },
    ],
  },
  {
    title: "Across sessions",
    entries: [
      { name: "Library", where: "Top bar, library; or the Library tab in a session", how: "Search decisions, components, constraints, contracts and published documents from every session you can see. Copy one into your session; the AI can search it too." },
      { name: "Replay", where: "Session top bar, replay", how: "Step through the session from the first event; everything is read only while replaying." },
      { name: "Digest", where: "Home page", how: "What is waiting on you: votes, sign-offs, revisits, mentions, and what changed since you last looked." },
    ],
  },
  {
    title: "Your tools",
    entries: [
      { name: "Credentials", where: "Top bar, credentials", how: "A Copilot token or GitHub sign-in funds your turns (or the sponsor's, depending on the session)." },
      { name: "External tools", where: "Top bar, credentials, External tools", how: "Register MCP servers. The AI can read through them freely; anything that writes waits for your approval in the Proposals tab. A server that fails or times out shows its status and last error here, not in the lane." },
      { name: "Notifications", where: "Top bar, credentials, Notifications", how: "Be told through one of your own tools when something waits on you." },
    ],
  },
];

export function Guide() {
  document.title = `Guide · ${PRODUCT_NAME}`;
  return (
    <>
      <TopBar />
      <div className="page" style={{ maxWidth: 860 }}>
        <h1 style={{ fontSize: 26, marginBottom: 4 }}>Where everything is</h1>
        <p className="muted" style={{ marginTop: 0 }}>Every feature, where to find it, and what to do there.</p>
        {GROUPS.map((g) => (
          <section key={g.title} style={{ marginTop: 22 }}>
            <h2 style={{ fontSize: 17, marginBottom: 8 }}>{g.title}</h2>
            <div style={{ overflowX: "auto" }}>
              <table className="guide">
                <thead><tr><th style={{ width: "22%" }}>Feature</th><th style={{ width: "28%" }}>Where</th><th>How</th></tr></thead>
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

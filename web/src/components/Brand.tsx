// The mark: four threads on the left, the cloth they become on the right. Several people's
// contributions going in, one agreed design coming out. The name is "archloom", set lowercase
// with the accent on the half that does the work; "arch" is the domain, "loom" is the mechanism.

export const PRODUCT_NAME = "archloom";

/** Shown under the name on the way in, and nowhere else: the mark drawn as a sentence. */
export const PRODUCT_LINE = "Many threads, one design";

export function BrandMark({ size = 22, accent = "var(--accent)", ink = "currentColor" }: { size?: number; accent?: string; ink?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" aria-hidden="true" style={{ display: "block", flex: "none" }}>
      <g stroke={ink} strokeWidth="5.5" fill="none">
        <path d="M4 17h30" />
        <path d="M4 30h24" />
        <path d="M4 43h32" />
        <path d="M4 56h27" />
      </g>
      <rect x="40" y="12" width="28" height="48" fill={accent} />
    </svg>
  );
}

/** Mark and name, in two sizes: the top bar and a page heading. `line` adds the tagline. */
export function Brand({ large = false, line = false }: { large?: boolean; line?: boolean }) {
  const name = (
    <span className="brand-name">
      <span className="brand-arch">arch</span>
      <span className="brand-loom">loom</span>
    </span>
  );
  if (large) {
    // With the line, the mark grows to the height of the two rows and the words of the line are
    // spread to the width of the name, so the lockup is a rectangle rather than a ragged step.
    return (
      <div className="brand-large">
        <BrandMark size={line ? 54 : 46} />
        <div className="brand-stack">
          {name}
          {line && (
            <div className="brand-line">
              {PRODUCT_LINE.split(" ").map((w) => (
                <span key={w}>{w}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }
  return (
    <span className="brand">
      <BrandMark size={20} />
      {name}
    </span>
  );
}

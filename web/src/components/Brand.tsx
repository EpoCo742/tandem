// The mark: a round table seen from above, four seats around it, the seat at the right in the
// accent for the AI. The name is "Session Zero", the session before the build. The line under
// it says what the product is for people who do not know the reference.

export const PRODUCT_NAME = "Session Zero";
export const PRODUCT_LINE = "Collaborative Architecture with AI";

export function BrandMark({ size = 22, accent = "var(--accent)", seat = "var(--link)", ring = "currentColor" }: { size?: number; accent?: string; seat?: string; ring?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" aria-hidden="true" style={{ display: "block", flex: "none" }}>
      <circle cx="36" cy="36" r="16" fill="none" stroke={ring} strokeWidth="5.5" />
      <circle cx="36" cy="9" r="5.5" fill={seat} />
      <circle cx="36" cy="63" r="5.5" fill={seat} />
      <circle cx="9" cy="36" r="5.5" fill={seat} />
      <circle cx="63" cy="36" r="5.5" fill={accent} />
    </svg>
  );
}

/** Mark, name and line, in two sizes: the top bar and a page heading. */
export function Brand({ large = false }: { large?: boolean }) {
  if (large) {
    return (
      <div className="brand-large">
        <BrandMark size={44} />
        <div>
          <div className="brand-name">{PRODUCT_NAME}</div>
          <div className="brand-line">{PRODUCT_LINE}</div>
        </div>
      </div>
    );
  }
  return (
    <span className="brand" title={PRODUCT_LINE}>
      <BrandMark size={20} />
      <span className="brand-name">{PRODUCT_NAME}</span>
    </span>
  );
}

import { useCallback, useRef, useState, type ReactNode } from "react";

// Zoom for a card opened full screen or shown as a slide. CSS zoom reflows the content, so text
// stays crisp, the scroll area follows, and a diagram can be made large enough to read. Buttons,
// Ctrl+wheel, and the + - 0 f keys; "fit" sizes a diagram to the space it has.

const STEP = 1.2;
const MIN = 0.4;
const MAX = 4;
const clamp = (z: number) => Math.min(MAX, Math.max(MIN, z));

export function useZoom(initial = 1) {
  const [zoom, setZoomRaw] = useState(initial);
  const bodyEl = useRef<HTMLDivElement | null>(null);
  const detach = useRef<(() => void) | null>(null);
  // The body's inner width in CSS pixels. A diagram's SVG is sized to its container, which would
  // fill the same box at every zoom; pinning the zoomed wrapper to this width makes it scale instead.
  const [baseWidth, setBaseWidth] = useState<number | null>(null);
  const setZoom = useCallback((z: number | ((cur: number) => number)) => setZoomRaw((cur) => clamp(typeof z === "function" ? z(cur) : z)), []);
  const zoomIn = useCallback(() => setZoom((z) => z * STEP), [setZoom]);
  const zoomOut = useCallback(() => setZoom((z) => z / STEP), [setZoom]);
  const reset = useCallback(() => setZoom(1), [setZoom]);
  // A diagram fits when its unscaled size, times the zoom, fills the body without overflowing.
  const fit = useCallback(() => {
    const body = bodyEl.current;
    const svg = body?.querySelector("svg");
    if (!body || !svg) {
      setZoom(1);
      return;
    }
    const r = svg.getBoundingClientRect();
    setZoomRaw((cur) => {
      const w = r.width / cur;
      const h = r.height / cur;
      if (!w || !h) return 1;
      return clamp(Math.min((body.clientWidth - 24) / w, (body.clientHeight - 24) / h));
    });
  }, [setZoom]);
  const onKey = useCallback(
    (e: KeyboardEvent): boolean => {
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return false;
      if (e.key === "+" || e.key === "=") zoomIn();
      else if (e.key === "-" || e.key === "_") zoomOut();
      else if (e.key === "0") reset();
      else if (e.key === "f" || e.key === "F") fit();
      else return false;
      e.preventDefault();
      return true;
    },
    [zoomIn, zoomOut, reset, fit],
  );
  // Ctrl+wheel zooms the content instead of the page. React's wheel listener is passive, so the
  // listener is bound by hand when the body mounts (a callback ref: the body only exists while open).
  const bodyRef = useCallback(
    (el: HTMLDivElement | null) => {
      detach.current?.();
      detach.current = null;
      bodyEl.current = el;
      if (!el) return;
      const cs = getComputedStyle(el);
      // Measured before the vertical scrollbar appears, so leave room for it.
      setBaseWidth(Math.max(0, el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 18));
      const onWheel = (e: WheelEvent) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        setZoom((z) => (e.deltaY < 0 ? z * 1.1 : z / 1.1));
      };
      el.addEventListener("wheel", onWheel, { passive: false });
      // Drag to pan a diagram: press anywhere that is not a control and pull the view around.
      let drag: { x: number; y: number; left: number; top: number; id: number } | null = null;
      const onDown = (e: PointerEvent) => {
        if (e.button !== 0 || !el.classList.contains("pannable")) return;
        const t = e.target as HTMLElement | null;
        if (t?.closest("button, a, input, textarea, select, [contenteditable]")) return;
        drag = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, id: e.pointerId };
        el.setPointerCapture(e.pointerId);
        el.classList.add("panning");
        e.preventDefault();
      };
      const onMove = (e: PointerEvent) => {
        if (!drag || e.pointerId !== drag.id) return;
        el.scrollLeft = drag.left - (e.clientX - drag.x);
        el.scrollTop = drag.top - (e.clientY - drag.y);
      };
      const onUp = (e: PointerEvent) => {
        if (!drag || e.pointerId !== drag.id) return;
        drag = null;
        el.classList.remove("panning");
        try {
          el.releasePointerCapture(e.pointerId);
        } catch {
          /* already released */
        }
      };
      el.addEventListener("pointerdown", onDown);
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);
      detach.current = () => {
        el.removeEventListener("wheel", onWheel);
        el.removeEventListener("pointerdown", onDown);
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onUp);
      };
    },
    [setZoom],
  );
  return { zoom, setZoom, zoomIn, zoomOut, reset, fit, onKey, bodyRef, baseWidth };
}

export function ZoomBar({ z, diagram }: { z: ReturnType<typeof useZoom>; diagram: boolean }) {
  return (
    <span className="zoombar" title="Zoom: + and - keys, 0 for 100%, f to fit a diagram, Ctrl+wheel">
      <button className="icon" onClick={z.zoomOut} disabled={z.zoom <= MIN}>−</button>
      <button className="icon" onClick={z.reset} style={{ minWidth: 48 }}>{Math.round(z.zoom * 100)}%</button>
      <button className="icon" onClick={z.zoomIn} disabled={z.zoom >= MAX}>+</button>
      {diagram && <button className="icon" onClick={z.fit}>fit</button>}
    </span>
  );
}

export function ZoomBody({ z, className, diagram = false, children }: { z: ReturnType<typeof useZoom>; className: string; diagram?: boolean; children: ReactNode }) {
  return (
    <div className={className + (diagram ? " pannable" : "")} ref={z.bodyRef} title={diagram ? "Drag to move around; Ctrl+wheel to zoom" : undefined}>
      <div style={{ zoom: z.zoom, ...(diagram && z.baseWidth ? { width: z.baseWidth } : {}) } as React.CSSProperties}>{children}</div>
    </div>
  );
}

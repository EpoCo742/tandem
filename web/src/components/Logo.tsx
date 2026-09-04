import { usePrefs } from "../state/prefs";
import lightMark from "../assets/tandem-8a-extruded-light.svg";
import darkMark from "../assets/tandem-8a-extruded-dark.svg";

// Two files rather than one recolourable mark: the extrusion, the amber A and the
// teal N stem each shift for the dark palette, so the artwork carries the change.

export function Logo({ height = 20, className }: { height?: number; className?: string }) {
  const resolved = usePrefs((s) => s.resolved);
  return <img className={className ? `logo ${className}` : "logo"} src={resolved === "dark" ? darkMark : lightMark} alt="Tandem" style={{ height }} />;
}

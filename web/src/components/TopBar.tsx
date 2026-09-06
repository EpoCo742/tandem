import { api } from "../api";
import { useStore } from "../state/store";
import { usePrefs } from "../state/prefs";
import { navigate } from "../App";

// GitHub sign-in supplies a picture; dev login does not, so initials on the participant colour remain the fallback.
export function Avatar({ name, color, size = 22, src }: { name: string; color: string; size?: number; src?: string | null }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  if (src) return <img className="avatar" src={src} alt={name} title={name} style={{ width: size, height: size, boxShadow: `0 0 0 2px ${color}` }} referrerPolicy="no-referrer" />;
  return (
    <span className="avatar" style={{ background: color, width: size, height: size }} title={name}>
      {initials}
    </span>
  );
}

const THEME_LABEL = { system: "auto", light: "light", dark: "dark" } as const;
const THEME_GLYPH = { system: "◐", light: "☀", dark: "☾" } as const;

export function ThemeToggle() {
  const theme = usePrefs((s) => s.theme);
  const cycleTheme = usePrefs((s) => s.cycleTheme);
  return (
    <button className="icon" onClick={cycleTheme} title="Theme: follows your OS by default. Click to cycle auto, light, dark.">
      <span aria-hidden>{THEME_GLYPH[theme]}</span> {THEME_LABEL[theme]}
    </button>
  );
}

export function TopBar({ children }: { children?: React.ReactNode }) {
  const me = useStore((s) => s.me);
  const setMe = useStore((s) => s.setMe);
  const user = me?.user;
  return (
    <div className="topbar">
      <a href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }} style={{ textDecoration: "none", color: "inherit" }}>
        <span className="brand"><span>Tandem</span></span>
      </a>
      <span className="mono">poc</span>
      {children}
      <span className="grow" />
      <ThemeToggle />
      {user && (
        <div className="who">
          <a href="/library" onClick={(e) => { e.preventDefault(); navigate("/library"); }} title="Search decisions, components, constraints and published documents across sessions">library</a>
          <a href="/settings" onClick={(e) => { e.preventDefault(); navigate("/settings"); }}>credentials</a>
          {user.avatarUrl ? (
            <a href={`https://github.com/${user.handle}`} target="_blank" rel="noreferrer" title="GitHub profile" style={{ display: "inline-flex" }}>
              <Avatar name={user.displayName || user.handle} color="#5a6773" src={user.avatarUrl} />
            </a>
          ) : (
            <Avatar name={user.displayName || user.handle} color="#5a6773" />
          )}
          <span className="who-name">
            <span>{user.displayName || user.handle}</span>
            {user.displayName && user.displayName !== user.handle && <span className="mono">@{user.handle}</span>}
          </span>
          <button onClick={() => api("POST", "/auth/logout", {}).then(() => { setMe({ ...me!, user: null }); navigate("/"); })}>sign out</button>
        </div>
      )}
    </div>
  );
}

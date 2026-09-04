import { api } from "../api";
import { useStore } from "../state/store";
import { navigate } from "../App";

export function Avatar({ name, color, size = 22 }: { name: string; color: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className="avatar" style={{ background: color, width: size, height: size }} title={name}>
      {initials}
    </span>
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
      {user && (
        <div className="who">
          <a href="/settings" onClick={(e) => { e.preventDefault(); navigate("/settings"); }}>credentials</a>
          <Avatar name={user.displayName || user.handle} color="#5a6773" />
          <span>{user.displayName || user.handle}</span>
          <button onClick={() => api("POST", "/auth/logout", {}).then(() => { setMe({ ...me!, user: null }); navigate("/"); })}>sign out</button>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { api, type Me } from "./api";
import { useStore } from "./state/store";
import { Home } from "./pages/Home";
import { Settings } from "./pages/Settings";
import { Join } from "./pages/Join";
import { Session } from "./pages/Session";
import { Login } from "./pages/Login";

function usePath() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return path;
}

export function navigate(to: string) {
  history.pushState({}, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function App() {
  const path = usePath();
  const me = useStore((s) => s.me);
  const setMe = useStore((s) => s.setMe);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api<Me>("GET", "/auth/me")
      .then(setMe)
      .catch(() => setMe({ user: null, devAuth: false, githubConfigured: false }))
      .finally(() => setLoaded(true));
  }, [setMe]);

  if (!loaded || !me) return <div className="page muted">Loading…</div>;
  if (!me.user) return <Login />;

  const join = path.match(/^\/join\/([^/]+)/);
  if (join) return <Join token={join[1]!} />;
  const session = path.match(/^\/s\/([^/]+)/);
  if (session) return <Session sessionId={session[1]!} />;
  if (path.startsWith("/settings")) return <Settings />;
  return <Home />;
}

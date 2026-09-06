import { useEffect, useState } from "react";
import { api, type Me } from "./api";
import { useStore } from "./state/store";
import { Home } from "./pages/Home";
import { Settings } from "./pages/Settings";
import { Join } from "./pages/Join";
import { Session } from "./pages/Session";
import { Vote } from "./pages/Vote";
import { Login } from "./pages/Login";
import { Published } from "./pages/Published";
import { Library } from "./pages/Library";

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
  const published = path.match(/^\/p\/([A-Za-z0-9]+)$/);
  if (published) return <Published slug={published[1]!} />; // public: no sign-in needed
  if (!me.user) return <Login />;
  if (path.startsWith("/library")) return <Library />;

  const join = path.match(/^\/join\/([^/]+)/);
  if (join) return <Join token={join[1]!} />;
  const vote = path.match(/^\/s\/([^/]+)\/vote\/([^/]+)/);
  if (vote) return <Vote sessionId={vote[1]!} artifactId={vote[2]!} />;
  const session = path.match(/^\/s\/([^/]+)/);
  if (session) return <Session sessionId={session[1]!} />;
  if (path.startsWith("/settings")) return <Settings />;
  return <Home />;
}

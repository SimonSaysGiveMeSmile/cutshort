import { useEffect, useState } from "react";
import { ConnectScreen } from "./components/ConnectScreen";
import { ControllerScreen } from "./components/ControllerScreen";
import { ThemeSheet } from "./components/ThemeSheet";
import { bindAutoWake, connection, detectAgent, type ConnState } from "./lib/connection";
import { applyMode, loadMode, loadTheme, type Mode } from "./themes";
import type { OS } from "./shortcuts";

export default function App() {
  const [screen, setScreen] = useState<"connect" | "deck">("connect");
  const [state, setState] = useState<ConnState>(connection.state);
  const [os, setOS] = useState<OS>(connection.os);
  const [theme, setTheme] = useState(loadTheme());
  const [mode, setMode] = useState<Mode>(loadMode(theme));
  const [showThemes, setShowThemes] = useState(false);

  useEffect(() => {
    const off = connection.onState(setState);
    // Reconnect when the user returns to the app or the network comes back.
    const unwake = bindAutoWake();
    // Auto-connect when launched from the agent's QR (or served by the agent).
    const agent = detectAgent();
    if (agent) {
      connection.pair(agent).then((ok) => {
        if (ok) {
          setOS(connection.os);
          setScreen("deck");
        }
      });
    }
    return () => {
      off();
      unwake();
    };
  }, []);

  function setOSBoth(next: OS) {
    setOS(next);
    connection.os = next;
  }

  function toggleMode() {
    const next: Mode = mode === "dark" ? "light" : "dark";
    setMode(next);
    applyMode(next);
  }

  return (
    <>
      <div className="backdrop" aria-hidden />
      <div className="grain" aria-hidden />
      <div className="app">
        {screen === "connect" ? (
          <ConnectScreen onConnected={() => setScreen("deck")} />
        ) : (
          <ControllerScreen
            os={os}
            setOS={setOSBoth}
            state={state}
            mode={mode}
            onToggleMode={toggleMode}
            onOpenThemes={() => setShowThemes(true)}
          />
        )}
      </div>
      {showThemes && (
        <ThemeSheet
          current={theme}
          onPick={(id) => {
            setTheme(id);
            setMode(loadMode(id));
            setShowThemes(false);
          }}
          onClose={() => setShowThemes(false)}
        />
      )}
    </>
  );
}

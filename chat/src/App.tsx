import { useEffect, useState } from "react";
import type { SurfaceKey } from "./app/surfaces";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Rail } from "./components/Rail";
import { loadTheme, saveTheme, themeChoiceMade, forgetThemeChoice } from "./lib/settings";
import type { Theme } from "./lib/settings";
import { ChatSurface } from "./surfaces/ChatSurface";
import { ModelsSurface } from "./surfaces/ModelsSurface";
import { SettingsForm } from "./components/SettingsForm";
import { useChat } from "./surfaces/useChat";
import "./App.css";

export function App() {
  const [surface, setSurface] = useState<SurfaceKey>("chat");
  const [theme, setTheme] = useState<Theme>(() => loadTheme());
  const chat = useChat();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => {
      if (!themeChoiceMade()) setTheme(media.matches ? "dark" : "light");
    };
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, []);

  function chooseTheme(next: Theme): void {
    saveTheme(next);
    setTheme(next);
  }

  return (
    <div className="shell">
      <Rail current={surface} onOpen={setSurface} />
      <div className="shell-main">
        <main className="stage">
          <ErrorBoundary>
            {surface === "chat" ? (
              <ChatSurface chat={chat} onNavigate={setSurface} />
            ) : surface === "models" ? (
              <ModelsSurface onNavigate={setSurface} />
            ) : (
              <SettingsForm theme={theme} onTheme={chooseTheme} onResetTheme={forgetThemeChoice} />
            )}
          </ErrorBoundary>
        </main>
      </div>
      <p className="visually-hidden" role="status" />
    </div>
  );
}

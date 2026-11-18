import { useState } from "react";
import { systemTheme, themeChoiceMade } from "../lib/settings";
import type { Theme } from "../lib/settings";
import { useLanguage } from "../i18n/useLanguage";
import { Icon } from "./Icon";
import "./Settings.css";

type Look = Theme | "auto";
const LOOKS: Look[] = ["auto", "light", "dark"];

interface SettingsFormProps {
  theme: Theme;
  onTheme: (theme: Theme) => void;
  onResetTheme: () => void;
}

/** The only settings this build has: the look of the app. */
export function SettingsForm({ theme, onTheme, onResetTheme }: SettingsFormProps) {
  const { table } = useLanguage();
  const t = table.settings;
  const [look, setLook] = useState<Look>(() => (themeChoiceMade() ? theme : "auto"));
  const labels: Record<Look, string> = { light: t.lookLight, dark: t.lookDark, auto: t.lookAuto };

  function chooseLook(next: Look): void {
    setLook(next);
    if (next === "auto") {
      onResetTheme();
      onTheme(systemTheme());
      return;
    }
    onTheme(next);
  }

  return (
    <div className="settings-page">
      <h2>{t.title}</h2>
      <div className="settings-group">
        <div className="settings-row">
          <span className="settings-row-title">{t.look}</span>
          <div className="settings-seg" role="group" aria-label={t.look}>
            {LOOKS.map((key) => (
              <button key={key} type="button" aria-pressed={look === key} onClick={() => chooseLook(key)}>
                {labels[key]}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="settings-lede">
        <Icon name="lock" size={15} />
        {t.lede}
      </p>
    </div>
  );
}

import { useState } from "react";
import { useLanguage } from "../i18n/useLanguage";
import { Icon } from "../components/Icon";
import { AdvancedPanel, type AdvancedDto, type AdvancedSaveInput } from "../components/AdvancedPanel";
import { SamplingPanel } from "../components/SamplingPanel";
import { invoke } from "../lib/tauri";
import "./surfaces.css";
import "./ExpertsSurface.css";

type Section = "server" | "sampling";
const SECTIONS: readonly Section[] = ["server", "sampling"];

/** For experts (mockups 17-advanced-*): one page, two sections. It opens on
    the two entry cards; a section, once open, is one tab of two. */
export function ExpertsSurface({
  onBack,
  model,
  onModelChange,
}: {
  onBack: () => void;
  model: string;
  onModelChange: (model: string) => void;
}) {
  const { table } = useLanguage();
  const t = table.advanced;
  const [section, setSection] = useState<Section | null>(null);
  const titles: Record<Section, string> = { server: t.title, sampling: table.sampling.title };

  return (
    <div className="experts-page">
      <button type="button" className="surface-back" onClick={onBack}>
        <Icon name="left" size={16} stroke={2.2} />
        {table.chrome.pages.models}
      </button>
      <p className="experts-tag">
        <Icon name="settings" size={14} />
        {t.expertsTag}
      </p>
      <h2>{t.expertsTitle}</h2>
      <p className="experts-lead">{t.expertsLead}</p>
      {section === null ? (
        <div className="experts-entry">
          <EntryCard icon="cpu" tag={t.serverTag} title={titles.server} blurb={t.serverBlurb} onOpen={() => setSection("server")} />
          <EntryCard icon="sliders" tag={t.samplingTag} title={titles.sampling} blurb={t.samplingBlurb} onOpen={() => setSection("sampling")} />
        </div>
      ) : (
        <>
          <div
            className="experts-tabs"
            role="tablist"
            // Two tabs: either arrow moves to the other one.
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              const next = section === "server" ? "sampling" : "server";
              setSection(next);
              document.getElementById(`experts-tab-${next}`)?.focus();
            }}
          >
            {SECTIONS.map((key) => (
              <button
                key={key}
                id={`experts-tab-${key}`}
                type="button"
                role="tab"
                aria-selected={section === key}
                aria-controls="experts-panel"
                tabIndex={section === key ? 0 : -1}
                className={section === key ? "is-on" : undefined}
                onClick={() => setSection(key)}
              >
                {titles[key]}
              </button>
            ))}
          </div>
          <div className="experts-card" id="experts-panel" role="tabpanel" aria-labelledby={`experts-tab-${section}`}>
            {section === "server" ? (
              <AdvancedPanel
                save={(changes: AdvancedSaveInput) => invoke<AdvancedDto>("brain_set_advanced", changes)}
                model={model}
                onModelChange={onModelChange}
              />
            ) : (
              <SamplingPanel />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function EntryCard({ icon, tag, title, blurb, onOpen }: {
  icon: "cpu" | "sliders";
  tag: string;
  title: string;
  blurb: string;
  onOpen: () => void;
}) {
  const { table } = useLanguage();
  return (
    <section className="experts-card">
      <p className="experts-tag is-section">
        <Icon name={icon} size={14} />
        {tag}
      </p>
      <h3>{title}</h3>
      <p className="experts-blurb">{blurb}</p>
      <button type="button" className="experts-open" aria-label={`${table.advanced.open} ${title}`} onClick={onOpen}>
        {table.advanced.open}
        <Icon name="right" size={15} />
      </button>
    </section>
  );
}

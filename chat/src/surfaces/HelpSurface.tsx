import { useEffect, useRef, useState } from "react";
import { useLanguage } from "../i18n/useLanguage";
import { ReportProblem } from "../components/ReportProblem";
import { KalsaWordmark } from "../components/KalsaWordmark";
import "./HelpSurface.css";

function HelpText({ text }: { text: string }) {
  return <>{text.split(/(\*\*.*?\*\*)/g).map((part, index) =>
    part.startsWith("**")
      ? <strong key={index}>{part.slice(2, -2)}</strong>
      : part,
  )}</>;
}

export function HelpSurface() {
  const { table, language } = useLanguage();
  const help = table.help;
  const [current, setCurrent] = useState(0);
  const section = help.sections[current];
  // Focus starts on the heading of the first section, so a screen reader begins the page there.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <article className="help-page" lang={language === "it" ? "it" : "en"}>
      <div className="help-layout">
        <div className="help-side">
          <div className="help-brand">
            <KalsaWordmark height={24} />
          </div>
          <h2 className="help-title">{table.chrome.pages.help}</h2>
          <nav className="help-index" aria-label={table.chrome.pages.help}>
            {help.sections.map((item, index) => (
              <button
                key={index}
                type="button"
                className="help-index-item"
                aria-current={index === current ? "true" : undefined}
                onClick={() => setCurrent(index)}
              >
                {item.title}
              </button>
            ))}
          </nav>
        </div>
        <section className="help-body" aria-labelledby="help-section-title">
          <h3 id="help-section-title" ref={heading} tabIndex={-1}>{section.title}</h3>
          {section.paragraphs.map((text, paragraph) => (
            <p key={paragraph}><HelpText text={text} /></p>
          ))}
          {section.items.length > 0 ? (
            <ul>
              {section.items.map((text, item) => (
                <li key={item}><HelpText text={text} /></li>
              ))}
            </ul>
          ) : null}
          {section.report ? <ReportProblem /> : null}
          {section.cited ? <p className="help-sources">{help.sources}</p> : null}
        </section>
      </div>
    </article>
  );
}

import { useEffect, useRef } from "react";
import { useLanguage } from "../i18n/useLanguage";
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
  // Focus starts on the first heading, so a screen reader begins the page there.
  const firstHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    firstHeading.current?.focus();
  }, []);

  return (
    <article className="help-page" lang={language === "it" ? "it" : "en"}>
      {help.sections.map((section, index) => (
        <section key={index} aria-labelledby={`help-section-${index}`}>
          <h2
            id={`help-section-${index}`}
            ref={index === 0 ? firstHeading : undefined}
            tabIndex={index === 0 ? -1 : undefined}
          >
            {section.title}
          </h2>
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
        </section>
      ))}
      <p className="help-sources">{help.sources}</p>
    </article>
  );
}

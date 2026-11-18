import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { copyText } from "../lib/clipboard";
import { useLanguage } from "../i18n/useLanguage";
import type { English } from "../i18n/en/all";
import { publicHttpUrl } from "../lib/publicUrl";
import { Openable } from "./Openable";
import { Icon } from "./Icon";
import { Streamdown, type Components } from "streamdown";

function languageOf(className?: string): string {
  return /language-([\w+-]+)/.exec(className ?? "")?.[1] ?? "";
}

function hostOf(words: English["markdown"], src?: string): string {
  if (!src) return words.unknownAddress;
  if (/^data:/i.test(src)) return words.embeddedData;
  try {
    return new URL(src).host || words.unknownAddress;
  } catch {
    return words.invalidAddress;
  }
}

/** Remote images are never loaded: no request, no IP, no Referer. The
    address stays openable by hand, and Rust checks it again. */
function BlockedImage({ alt, src }: { alt?: string; src?: string }) {
  const { table } = useLanguage();
  const t = table.markdown;
  const href = publicHttpUrl(src);
  return (
    <span className="blocked-image">
      {t.imageBlocked}
      {alt ? t.withAlt(alt) : ""}
      {t.from(hostOf(t, src))}
      {href ? (
        <>
          {" "}<Openable url={href}>{t.openAddress}</Openable>
        </>
      ) : null}
    </span>
  );
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const { table } = useLanguage();
  const t = table.markdown;
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy(): Promise<void> {
    if (!(await copyText(code))) return;
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="codeblock">
      <div className="codeblock-head">
        <span className="codeblock-lang">{language || t.code}</span>
        <button type="button" className="codeblock-copy" onClick={() => void copy()}>
          <Icon name={copied ? "check" : "copy"} size={14} />
          {copied ? t.copied : t.copy}
        </button>
      </div>
      <pre className="codeblock-pre" tabIndex={0}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function Pre({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

function Code({ children, className }: { children?: ReactNode; className?: string }) {
  const text = Array.isArray(children)
    ? children.map((child) => String(child ?? "")).join("")
    : String(children ?? "");
  if (languageOf(className) === "" && !text.includes("\n")) {
    return <code className="inline-code">{children}</code>;
  }
  return <CodeBlock language={languageOf(className)} code={text.replace(/\n$/, "")} />;
}

// Stable identities: Streamdown memoizes settled blocks by component ref.
const COMPONENTS = {
  pre: Pre,
  code: Code,
  img: BlockedImage,
  strong: ({ children }: { children?: ReactNode }) => <strong>{children}</strong>,
  table: ({ children }: { children?: ReactNode }) => <table>{children}</table>,
  // A refused address is text, and a good one is a button: the webview
  // never follows a model-written link itself.
  a: ({ children, href }: { children?: ReactNode; href?: string }) => {
    const url = publicHttpUrl(href);
    return url ? <Openable url={url}>{children}</Openable> : <>{children}</>;
  },
} as Components;

const NO_RAW_HTML: never[] = [];

/** Markdown as it streams in. Empty rehype plugins keep raw HTML as text. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <Streamdown className="markdown" mode="static" components={COMPONENTS} rehypePlugins={NO_RAW_HTML}>
      {text}
    </Streamdown>
  );
});

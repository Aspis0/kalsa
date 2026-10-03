import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { copyText } from "../lib/clipboard";
import { useLanguage } from "../i18n/useLanguage";
import type { English } from "../i18n/en/all";
import { publicHttpUrl } from "../lib/publicUrl";
import { Openable } from "./Openable";
import { Streamdown, type Components } from "streamdown";

function languageOf(className?: string): string {
  const match = /language-([\w+-]+)/.exec(className ?? "");
  return match ? match[1] : "";
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

// Remote images are never loaded: no request, no IP, no Referer, no query
// smuggling the conversation out. The address stays openable by hand — through
// the command, which checks it again in Rust.
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
  const [failedCopy, setFailedCopy] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function later(fn: () => void): void {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(fn, 1600);
  }

  async function copy(): Promise<void> {
    const ok = await copyText(code);
    if (ok) {
      setCopied(true);
      later(() => setCopied(false));
    } else {
      setFailedCopy(true);
      later(() => setFailedCopy(false));
    }
  }

  return (
    <div className="codeblock">
      <div className="codeblock-head">
        <span className="codeblock-lang">{language || t.code}</span>
        <button type="button" className="codeblock-copy" onClick={() => void copy()}>
          {copied ? t.copied : failedCopy ? t.copyFailed : t.copy}
        </button>
      </div>
      <pre className="codeblock-pre" tabIndex={0}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function Pre({ children }: { children?: ReactNode }) {
  // Fenced blocks arrive as <pre><code class="language-x">; the pre is
  // unwrapped so the block code below owns its own box, scroll and header.
  return <>{children}</>;
}

function Code({ children, className }: { children?: ReactNode; className?: string }) {
  const language = languageOf(className);
  const text = Array.isArray(children)
    ? children.map((c) => String(c ?? "")).join("")
    : String(children ?? "");
  const block = language !== "" || text.includes("\n");
  if (!block) return <code className="inline-code">{children}</code>;
  return <CodeBlock language={language} code={text.replace(/\n$/, "")} />;
}

// Ours, not Streamdown's defaults: those carry Tailwind utility classes and
// control chrome this app has no Tailwind for, and a table of ours is already
// scrolled by `.markdown table`. Stable identities (a fresh object each render
// would defeat the per-block memo); the assertion is the one prop type
// Streamdown's two `Components` branches cannot agree on.
const COMPONENTS = {
  pre: Pre,
  code: Code,
  img: BlockedImage,
  // A real <strong>: Streamdown's own is a span carrying a Tailwind weight
  // class, and with no Tailwind here that text would not be bold at all.
  strong: ({ children }: { children?: ReactNode }) => <strong>{children}</strong>,
  table: ({ children }: { children?: ReactNode }) => <table>{children}</table>,
  // An address the gate refuses is text, not something to click:
  // `publicUrl.ts` is the one place that decides, and the click itself
  // goes through Rust. A model writes these addresses; a Tauri webview
  // cannot follow an `href` anyway.
  a: ({ children, href }: { children?: ReactNode; href?: string }) => {
    const url = publicHttpUrl(href);
    return url ? <Openable url={url}>{children}</Openable> : <>{children}</>;
  },
} as Components;

// The switch that keeps raw HTML out of the DOM: Streamdown turns every html
// node into its literal text unless the rehype list names rehype-raw, and this
// list names nothing. An empty, stable list — a new array each render would
// defeat the per-block memo.
const NO_RAW_HTML: never[] = [];

/** Assistant prose. GFM tables/lists/quotes, code fenced with copy header.
    Streamdown (Apache-2.0) parses an answer as it arrives: an unterminated
    fence, a half-written table or a bold run still open render as the element
    they are heading for, and every block that has settled is memoized. */
export const Markdown = memo(function Markdown({
  text,
  streaming = false,
}: {
  text: string;
  /** While true the text is still arriving, so a partial answer is parsed. */
  streaming?: boolean;
}) {
  return (
    <Streamdown
      className="markdown"
      mode={streaming ? "streaming" : "static"}
      components={COMPONENTS}
      // An `<img src=x onerror=…>` or a `<script>` is shown as the characters
      // it is; naming rehype-raw here is the one line that would build it.
      rehypePlugins={NO_RAW_HTML}
    >
      {text}
    </Streamdown>
  );
});

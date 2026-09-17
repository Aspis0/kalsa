import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function languageOf(className?: string): string {
  const match = /language-([\w+-]+)/.exec(className ?? "");
  return match ? match[1] : "";
}

function hostOf(src?: string): string {
  if (!src) return "unknown address";
  if (/^data:/i.test(src)) return "embedded data";
  try {
    return new URL(src).host || "unknown address";
  } catch {
    return "invalid address";
  }
}

function safeHref(src?: string): string | undefined {
  if (src && /^https?:\/\//i.test(src)) return src;
  return undefined;
}

// Remote images are never loaded: no request, no IP, no Referer, no query
// smuggling the conversation out. The address stays openable by hand.
function BlockedImage({ alt, src }: { alt?: string; src?: string }) {
  const href = safeHref(src);
  return (
    <span className="blocked-image">
      Image blocked{alt ? `: ${alt}` : ""} ({hostOf(src)}). Images from the network are
      never loaded.{href ? (
        <>
          {" "}<a href={href} target="_blank" rel="noreferrer">Open address</a>
        </>
      ) : null}
    </span>
  );
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const [failedCopy, setFailedCopy] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function later(fn: () => void): void {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(fn, 1600);
  }

  async function copy(): Promise<void> {
    let ok = false;
    try {
      await navigator.clipboard.writeText(code);
      ok = true;
    } catch {
      try {
        // Clipboard API unavailable (permissions): fall back to selection.
        const area = document.createElement("textarea");
        area.value = code;
        document.body.appendChild(area);
        area.select();
        ok = document.execCommand("copy");
        area.remove();
      } catch {
        ok = false;
      }
    }
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
        <span className="codeblock-lang">{language || "code"}</span>
        <button type="button" className="codeblock-copy" onClick={() => void copy()}>
          {copied ? "Copied" : failedCopy ? "Copy failed" : "Copy"}
        </button>
      </div>
      <pre className="codeblock-pre" tabIndex={0}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function Pre({ children }: { children?: ReactNode }) {
  // react-markdown v9 renders fenced blocks as <pre><code class="language-x">.
  // Unwrap the pre: block code becomes a CodeBlock, which owns its scroll.
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

/** Assistant prose. GFM tables/lists/quotes, code fenced with copy header. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: Pre,
          code: Code,
          img: BlockedImage,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

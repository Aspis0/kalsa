import { Component } from "react";
import type { ReactNode } from "react";
import type { English } from "../i18n/en/all";
import { useLanguage } from "../i18n/useLanguage";
import { available, invoke } from "../lib/tauri";
import { SendLogBlock } from "./ReportProblem";
import "./ErrorBoundary.css";
import "./ReportProblem.css";

interface ErrorBoundaryProps {
  crash: English["crash"];
  report: English["report"];
  children: ReactNode;
}

interface ErrorBoundaryState {
  crashed: boolean;
}

/**
 * Last resort for corrupt data or render bugs: a static fallback that can
 * never crash itself (no store, no children, no markdown — the words it
 * shows are the static language table, read once before the fall) with two
 * ways out, and — because a crash is exactly when a tester should be able
 * to send the log — the error's own name and message clipped into the log
 * first (never props or state, which can hold a conversation), then the
 * same Send block the report section shows.
 */
class ErrorBoundaryClass extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { crashed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { crashed: true };
  }

  componentDidCatch(error: unknown): void {
    console.error("Crescent Chat crashed:", error);
    if (available() && error instanceof Error) {
      // Fire and forget: the boundary must not crash on its own reporting.
      // The line the log gets is the error's name and the first stack
      // frame — file and component names. The MESSAGE is never sent: it
      // can quote a whole conversation.
      invoke("brain_log_webview_error", {
        name: error.name,
        frame: firstFrame(error.stack),
      }).catch(() => {});
    }
  }

  private eraseAndReload(): void {
    try {
      const doomed: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("crescent-chat.")) doomed.push(key);
      }
      doomed.forEach((key) => localStorage.removeItem(key));
    } catch {
      // Clearing failed too; reloading still gives the empty state a chance.
    }
    window.location.reload();
  }

  render(): ReactNode {
    if (!this.state.crashed) return this.props.children;
    return (
      <div className="error-boundary" role="alert">
        <h2>{this.props.crash.title}</h2>
        <p>{this.props.crash.body}</p>
        {available() ? <SendLogBlock words={this.props.report} /> : null}
        <div className="error-boundary-actions">
          <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
            {this.props.crash.reload}
          </button>
          <button type="button" className="btn-quiet" onClick={() => this.eraseAndReload()}>
            {this.props.crash.erase}
          </button>
        </div>
      </div>
    );
  }
}

/** The first `at ...` line of a stack: a file/component name with a
    line number, or nothing when the browser gave no stack. */
function firstFrame(stack?: string): string {
  return stack?.split("\n").find((line) => line.trim().startsWith("at ")) ?? "";
}

/** The class is the catcher; this wrapper only hands it the chosen words. */
export function ErrorBoundary({ children }: { children: ReactNode }) {
  const { table } = useLanguage();
  return (
    <ErrorBoundaryClass crash={table.crash} report={table.report}>
      {children}
    </ErrorBoundaryClass>
  );
}

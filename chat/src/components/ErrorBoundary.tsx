import { Component } from "react";
import type { ReactNode } from "react";
import type { English } from "../i18n/en/all";
import { useLanguage } from "../i18n/useLanguage";
import "./ErrorBoundary.css";

interface ErrorBoundaryProps {
  crash: English["crash"];
  children: ReactNode;
}

interface ErrorBoundaryState {
  crashed: boolean;
}

/**
 * Last resort for corrupt data or render bugs: a static fallback that can
 * never crash itself (no store, no children, no markdown — the words it
 * shows are the static language table, read once before the fall) with two
 * ways out.
 */
class ErrorBoundaryClass extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { crashed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { crashed: true };
  }

  componentDidCatch(error: unknown): void {
    console.error("Crescent Chat crashed:", error);
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

/** The class is the catcher; this wrapper only hands it the chosen words. */
export function ErrorBoundary({ children }: { children: ReactNode }) {
  const { table } = useLanguage();
  return <ErrorBoundaryClass crash={table.crash}>{children}</ErrorBoundaryClass>;
}

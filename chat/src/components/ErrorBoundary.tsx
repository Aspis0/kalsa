import { Component } from "react";
import type { ReactNode } from "react";
import "./ErrorBoundary.css";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  crashed: boolean;
}

/**
 * Last resort for corrupt data or render bugs: a static fallback that can
 * never crash itself (no store, no props, no markdown) with two ways out.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
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
        <h2>Something went wrong.</h2>
        <p>
          The conversation view could not be drawn — usually this means the
          saved data is damaged. Your settings are untouched.
        </p>
        <div className="error-boundary-actions">
          <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
            Reload the app
          </button>
          <button type="button" className="btn-quiet" onClick={() => this.eraseAndReload()}>
            Erase local data and start fresh
          </button>
        </div>
      </div>
    );
  }
}

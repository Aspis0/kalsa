import { Component } from "react";
import type { ReactNode } from "react";
import { Icon } from "./Icon";
import "./ErrorBoundary.css";

interface State {
  crashed: boolean;
}

/** The last line of defence. The fallback uses no app state, so it can still
    render when the tree below it cannot. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { crashed: false };

  static getDerivedStateFromError(): State {
    return { crashed: true };
  }

  componentDidCatch(error: unknown): void {
    console.error("Kalsa crashed:", error);
  }

  render(): ReactNode {
    if (!this.state.crashed) return this.props.children;
    return (
      <div className="error-boundary" role="alert">
        <div className="error-boundary-column">
          <span className="error-boundary-icon">
            <Icon name="alert" size={38} stroke={1.8} />
          </span>
          <h2>Something went wrong.</h2>
          <p className="error-boundary-body">Kalsa hit an error it could not recover from.</p>
          <div className="error-boundary-actions">
            <button type="button" className="error-boundary-btn error-boundary-btn-primary" onClick={() => window.location.reload()}>
              <Icon name="refresh" size={18} />
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}

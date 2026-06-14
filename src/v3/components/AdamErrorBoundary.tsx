import { Component, type ReactNode } from "react";
import { reportError } from "@/lib/errorReporter";

interface AdamErrorBoundaryProps {
  children: ReactNode;
  context?: Record<string, unknown>;
  fallback?: ReactNode;
}

interface AdamErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorId: string | null;
}

export class AdamErrorBoundary extends Component<AdamErrorBoundaryProps, AdamErrorBoundaryState> {
  state: AdamErrorBoundaryState = {
    hasError: false,
    error: null,
    errorId: null,
  };

  static getDerivedStateFromError(error: Error): AdamErrorBoundaryState {
    return {
      hasError: true,
      error,
      errorId: typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `adam-error-${Date.now()}`,
    };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    reportError(error, {
      componentStack: info.componentStack,
      errorId: this.state.errorId,
      ...this.props.context,
    });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="v3-card" style={{ borderColor: "rgba(239, 68, 68, 0.35)", background: "rgba(254, 242, 242, 0.96)" }}>
          <div className="v3-card-title" style={{ color: "#991b1b" }}>Something went wrong in this panel</div>
          <div style={{ fontSize: 13, color: "#b91c1c", lineHeight: 1.6 }}>
            Error ID: {this.state.errorId}
          </div>
          <button
            type="button"
            className="v3-button ghost"
            style={{ marginTop: 12, fontSize: 12 }}
            onClick={() => this.setState({ hasError: false, error: null, errorId: null })}
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

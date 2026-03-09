import React, { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          dir="rtl"
          className="flex flex-col items-center justify-center min-h-[300px] p-8 text-center gap-4"
        >
          <div className="text-4xl">⚠️</div>
          <h2 className="text-xl font-bold text-destructive">
            {this.props.fallbackTitle || "حدث خطأ غير متوقع"}
          </h2>
          <p className="text-sm text-muted-foreground max-w-md">
            {this.state.error?.message || "حدث خطأ أثناء عرض هذا القسم."}
          </p>
          <button
            onClick={this.handleReset}
            className="mt-2 px-6 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            🔄 إعادة المحاولة
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

import React from "react";

type Props = { children: React.ReactNode };
type State = { hasError: boolean; error?: any };

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }
  componentDidCatch(error: any, info: any) {
    console.error("ErrorBoundary caught:", error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          maxWidth: 980, margin: "24px auto", padding: 16,
          background: "#fff3f0", color: "#7a1a00",
          border: "1px solid #ffd4cc", borderRadius: 12, fontFamily: "system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial"
        }}>
          <b>Something went wrong while rendering the app.</b>
          <pre style={{ whiteSpace: "pre-wrap", marginTop: 10 }}>{String(this.state.error || "")}</pre>
          <p>Open the browser Console for details.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

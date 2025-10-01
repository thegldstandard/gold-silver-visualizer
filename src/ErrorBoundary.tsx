import React from "react";

export class ErrorBoundary extends React.Component<{children: React.ReactNode}, {error?: any}> {
  constructor(props:any){ super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error:any){ return { error }; }
  componentDidCatch(error:any, info:any){ console.error("App crashed:", error, info); (window as any).__GSV_ERR__ = String(error); }
  render(){
    if (this.state.error) {
      return (
        <div style={{padding:16,color:"#fff",background:"#111",fontFamily:"system-ui,Segoe UI,Roboto,Helvetica,Arial"}}>
          <h2>Something went wrong</h2>
          <div style={{whiteSpace:"pre-wrap",opacity:.8,marginTop:8}}>{String(this.state.error)}</div>
          <div style={{opacity:.7,marginTop:8}}>Open DevTools → Console for details. Your data and settings are safe.</div>
        </div>
      );
    }
    return this.props.children as any;
  }
}

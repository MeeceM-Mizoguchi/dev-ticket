// レンダー/コミット中に投げられた例外を捕捉し、アプリ全体が真っ白になるのを防ぐ境界（BRU7-043）。
// React はクラスの componentDidCatch / getDerivedStateFromError でしか描画中の例外を拾えないため
// クラスコンポーネントで実装する。fallback は差し替え可能。resetKeys が変わると自動で復帰を試みる。
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** 例外時に表示する要素。retry(=状態リセット)を受け取れる。未指定なら既定のカード表示。 */
  fallback?: (error: Error, retry: () => void) => ReactNode;
  /** ここに含めた値のいずれかが変化したら、境界を自動リセットして子を再マウントする（例: boardId）。 */
  resetKeys?: unknown[];
  /** 例外を外部（ログ収集等）へ通知したい場合のフック。 */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 原因追跡のためコンソールへ残す（本番の minified スタックでも発生箇所の手掛かりになる）。
    console.error("[ErrorBoundary] 描画中に例外を捕捉:", error, info.componentStack);
    this.props.onError?.(error, info);
  }

  componentDidUpdate(prev: Props) {
    // resetKeys が変わったら（別ボードへ切替 等）、前回の例外状態を捨てて復帰を試みる。
    if (this.state.error && !shallowEqualArray(prev.resetKeys, this.props.resetKeys)) {
      this.setState({ error: null });
    }
  }

  retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.retry);
    return <DefaultFallback onRetry={this.retry} />;
  }
}

function shallowEqualArray(a?: unknown[], b?: unknown[]): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((v, i) => Object.is(v, b[i]));
}

function DefaultFallback({ onRetry }: { onRetry: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", minHeight: 200, gap: 12, color: "#6B6560", padding: 24, textAlign: "center" }}>
      <span style={{ fontSize: 14, fontWeight: 700, color: "#1A1714" }}>表示中にエラーが発生しました</span>
      <span style={{ fontSize: 12, color: "#A09790" }}>お手数ですが、再読み込みするか下のボタンでやり直してください。</span>
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button onClick={onRetry} style={{ fontSize: 12, fontWeight: 600, padding: "7px 16px", background: "#059669", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}>
          やり直す
        </button>
        <button onClick={() => window.location.reload()} style={{ fontSize: 12, fontWeight: 600, padding: "7px 16px", background: "#fff", color: "#1A1714", border: "1px solid rgba(26,23,20,0.15)", borderRadius: 8, cursor: "pointer" }}>
          再読み込み
        </button>
      </div>
    </div>
  );
}

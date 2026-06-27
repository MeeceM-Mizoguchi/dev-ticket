import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { Capacitor } from "@capacitor/core";
import App from "./app/App.tsx";
import "./styles/index.css";
import "handsontable/dist/handsontable.full.min.css";

// macOS/iPadアプリ(WKWebView)はブラウザ(Retina, DPR=2)より描画密度が低く、
// 同じ内容が画面に小さく詰め込まれて表示される。viewport幅を「Retina相当」に
// 補正して、Web版と同じ見た目・文字サイズに揃える(全画面に効く)。
// 実機iPad/iPhone(DPR≈2〜3)はそのまま。主にMacアプリ(DPR≈1.5)が対象。
function normalizeNativeViewport() {
  if (!Capacitor.isNativePlatform()) return;
  // iPhone(縦長・小画面)は対象外。Mac/iPadはどちらも既定だと描画幅が広く
  // 内容が小さく表示されるため、Web版(Retina)相当の 1800px に固定して
  // 見た目・文字サイズ・レイアウトをWeb版/Mac版と揃える。
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return;
  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return;
  // 描画幅を小さくするほど内容は大きく表示される。
  // 実機iPad(タッチあり)はMacより画面が小さいので、より大きく見えるよう
  // 幅を狭め(1400)、Mac(タッチなし)はWeb版同等の1800にする。
  // ※サイズ調整はこの数値を変えるだけ(小さく=大きく表示 / 大きく=小さく表示)。
  const isTouchDevice = navigator.maxTouchPoints > 0;
  const target = isTouchDevice ? 1400 : 1800;
  // viewport-fit=cover はセーフエリア(env(safe-area-inset-*))を有効にするために必要。
  meta.setAttribute("content", `width=${target}, viewport-fit=cover`);
}
normalizeNativeViewport();

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);

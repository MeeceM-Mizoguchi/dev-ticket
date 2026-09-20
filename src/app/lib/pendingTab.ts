// 別タブを「クリックと同じ実行の中で」先に確保し、準備ができるまで待たせる画面を出す。
//
// ★ window.open はユーザー操作の直後の同期実行中にしか許可されない。
//   APIの await を挟んでから呼ぶと操作の有効期間が切れ、必ずポップアップブロックに当たる。
//   そのため、先に空タブを取ってから URL を流し込む。
//
// ★ noopener を付けるとハンドルが null で返り、後から location を流し込めなくなる。
//   代わりに開いた直後に opener を切って、開いた先から DevTicket 側を触れないようにする。
//
// 中身は about:blank に書き込む独立したHTMLで、アプリのCSSもフォントも読み込まれない。
// そのため色・フォント・アニメーションはすべてこのファイル内で完結させている。

/** about:blank に流し込むので、埋め込む文字列は必ずエスケープする */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function pendingHtml(heading: string, sub: string): string {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dev Ticket — ${esc(heading)}</title>
<style>
  *{box-sizing:border-box}
  html,body{height:100%}
  body{
    margin:0;background:#F5F6F8;color:#1A1714;
    font-family:"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic",Meiryo,system-ui,-apple-system,sans-serif;
    display:flex;align-items:center;justify-content:center;padding:24px;
  }
  .card{
    width:100%;max-width:420px;background:#fff;border-radius:20px;overflow:hidden;
    box-shadow:0 24px 80px rgba(0,0,0,.14),0 4px 16px rgba(0,0,0,.06);
  }
  .bar{
    position:relative;overflow:hidden;padding:20px 24px 18px;
    background:linear-gradient(135deg,#059669 0%,#047857 60%,#065F46 100%);
  }
  .bar:before,.bar:after{content:"";position:absolute;border-radius:50%;background:rgba(255,255,255,.07)}
  .bar:before{top:-20px;right:-20px;width:100px;height:100px}
  .bar:after{bottom:-30px;left:40px;width:80px;height:80px;background:rgba(255,255,255,.05)}
  .eyebrow{
    position:relative;margin:0 0 5px;font-size:9px;letter-spacing:.12em;text-transform:uppercase;
    color:rgba(255,255,255,.55);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  }
  .title{position:relative;margin:0;font-size:17px;font-weight:800;letter-spacing:-.025em;color:#fff;line-height:1.25}
  .body{padding:26px 24px 28px;text-align:center}
  .dots{display:flex;gap:7px;justify-content:center;margin-bottom:14px}
  .dots span{
    width:8px;height:8px;border-radius:50%;background:#059669;opacity:.25;
    animation:pulse 1.1s ease-in-out infinite;
  }
  .dots span:nth-child(2){animation-delay:.16s}
  .dots span:nth-child(3){animation-delay:.32s}
  @keyframes pulse{0%,80%,100%{opacity:.25;transform:scale(.85)}40%{opacity:1;transform:scale(1)}}
  .sub{margin:0;font-size:12.5px;line-height:1.85;color:#6B6458}
  .hint{margin:16px 0 0;font-size:11px;color:#B0A9A4}
  @media (prefers-color-scheme:dark){
    body{background:#15171A;color:#E8E6E3}
    .card{background:#1F2226;box-shadow:0 24px 80px rgba(0,0,0,.5)}
    .sub{color:#A8A39D}
    .hint{color:#77726D}
  }
</style>
</head>
<body>
  <div class="card" role="status" aria-live="polite">
    <div class="bar">
      <p class="eyebrow">Dev Ticket</p>
      <h1 class="title">${esc(heading)}</h1>
    </div>
    <div class="body">
      <div class="dots" aria-hidden="true"><span></span><span></span><span></span></div>
      <p class="sub">${esc(sub)}</p>
      <p class="hint">このタブは自動で切り替わります。閉じないでください。</p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * 別タブを確保して「準備中」の画面を出す。
 * 用意ができたら `tab.location.href = url` で目的地へ送り、失敗したら `tab.close()` する。
 *
 * @returns ポップアップが禁止されている場合は null
 */
export function openPendingTab(heading: string, sub: string): Window | null {
  const tab = window.open("", "_blank");
  if (!tab) return null;
  try {
    tab.opener = null;
    tab.document.write(pendingHtml(heading, sub));
    tab.document.close();
  } catch {
    // 表示だけの処理。書き込めなくてもタブ自体は使えるので、そのまま返す
  }
  return tab;
}

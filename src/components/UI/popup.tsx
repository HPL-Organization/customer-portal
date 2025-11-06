"use client";

export const popupHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Opening your VIP live session…</title>
  <style>
    html,body{height:100%;margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif;background:#ffffec;color:#17152A}
    .wrap{height:100%;display:grid;place-items:center}
    .card{padding:28px 24px;border:1px solid #BFBFBF;border-radius:16px;background:#fff;box-shadow:0 8px 24px rgba(0,0,0,.08);text-align:center;max-width:460px}
    .ring{width:28px;height:28px;border-radius:50%;border:3px solid #e6e6e6;border-top-color:#8C0F0F;animation:spin 1s linear infinite;margin:0 auto 12px}
    @keyframes spin{to{transform:rotate(360deg)}}
    .sub{opacity:.7;font-size:14px;margin-top:6px}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="ring"></div>
      <div><strong>Preparing your session…</strong></div>
      <div class="sub">This window will automatically open Zoom when ready.</div>
    </div>
  </div>
</body>
</html>`;

export function openPlaceholderPopup(): Window | null {
  const w = window.open("", "_blank");
  if (!w) return null;
  try {
    w.document.open();
    w.document.write(popupHtml);
    w.document.close();
  } catch {}
  return w;
}

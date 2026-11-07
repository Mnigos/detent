// The badge and panel palette: neutral-950 ground, neutral-700 borders, the blue-400 focus ring.
export const PREVIEW_STYLE = `
:host{all:initial;position:fixed;inset:0;z-index:2147483646;font:12px/1.4 sans-serif;color:#f5f5f5}
.dialog{position:absolute;inset:0;background:rgba(10,10,10,.92)}
.stage{position:absolute;inset:0;display:flex;overflow:auto;padding:56px 64px;box-sizing:border-box;overscroll-behavior:contain}
.zoom{margin:auto;padding:0;border:0;background:none;cursor:zoom-in;line-height:0}
.zoom img{display:block;max-width:calc(100vw - 128px);max-height:calc(100vh - 112px);object-fit:contain;border-radius:4px;box-shadow:0 2px 24px rgba(0,0,0,.5)}
.zoom[aria-pressed="true"]{cursor:zoom-out}
.zoom[aria-pressed="true"] img{max-width:none;max-height:none}
.bar{position:absolute;top:12px;right:16px;left:16px;display:flex;align-items:center;gap:8px;pointer-events:none}
.bar>*{pointer-events:auto}
.counter{color:#a3a3a3;font-variant-numeric:tabular-nums}
.title{overflow:hidden;color:#d4d4d4;text-overflow:ellipsis;white-space:nowrap}
.spacer{flex:1}
button,a{font:inherit;color:inherit}
.control{display:inline-flex;align-items:center;justify-content:center;height:28px;min-width:28px;padding:0 10px;box-sizing:border-box;border:1px solid #404040;border-radius:6px;background:#171717;text-decoration:none;cursor:pointer}
.control:hover{border-color:#737373;background:#262626}
.step{position:absolute;top:50%;width:40px;height:40px;padding:0;border-radius:999px;font-size:20px;transform:translateY(-50%)}
.previous{left:12px}
.next{right:12px}
[hidden]{display:none}
:focus{outline:none}
:focus-visible{outline:2px solid #60a5fa;outline-offset:2px}
`

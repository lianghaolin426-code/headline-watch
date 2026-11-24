// 网页看板（第三版）：报刊式排版 + 毛玻璃卡片。
// 视图：简报（头条、今日要闻、12 小时统计、话题磁贴、实时快讯）/ 重要 / 6 分以上 / 全部。
// 界面文字有中文、English、العربية 三种（阿拉伯语整页从右到左）；
// 快讯内容的翻译在访问者的浏览器里完成（Chrome 自带的 Translator），不占服务器端的 AI 额度，浏览器不支持时显示原文。
// 页面开着时每 15 秒刷新；有新的重要快讯会响一声，可选弹出浏览器通知。
// 注意：CSS 和 JS 用 String.raw 写成模板字符串，里面不要出现反引号和 ${}，也不要写 \u 转义（用 String.fromCharCode）。

const CSS = String.raw`
:root{
  --bg:#f5f0e6;--bg2:#ece5d7;--ink:#1a1714;--ink2:#4a433b;--ink3:#7a7065;--ink4:#a79c8d;--rule:#d9d0c0;--rule2:#c7bca9;
  --red:#c8371d;--red-soft:rgba(200,55,29,.1);--amber:#c98a1a;--ok:#2f8f5b;
  --glass:rgba(255,255,255,.52);--glass2:rgba(255,255,255,.72);--glass-line:rgba(255,255,255,.85);--glass-edge:rgba(26,23,20,.07);
  --bar:rgba(245,240,230,.78);--shadow:0 1px 1px rgba(60,40,20,.04),0 12px 34px rgba(60,40,20,.08);--shadow2:0 30px 80px rgba(40,25,10,.28);
  --blob1:rgba(200,55,29,.13);--blob2:rgba(201,138,26,.16);--blob3:rgba(120,90,60,.1);--mark:rgba(201,138,26,.3);
  --serif:Charter,"Iowan Old Style","Songti SC","Noto Serif SC","Source Han Serif SC","Geeza Pro","Noto Naskh Arabic",Georgia,"Times New Roman",serif;
  --sans:Inter,-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Hiragino Sans GB","Microsoft YaHei","SF Arabic","Geeza Pro","Segoe UI",Roboto,sans-serif;
  --mono:"SF Mono",ui-monospace,SFMono-Regular,"JetBrains Mono",Menlo,Consolas,monospace;
  --top:92px;
}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){
  --bg:#12100d;--bg2:#1a1713;--ink:#f3ecdf;--ink2:#cfc6b7;--ink3:#978d7f;--ink4:#6a6156;--rule:#2d2822;--rule2:#40392f;
  --red:#ff6b4a;--red-soft:rgba(255,107,74,.13);--amber:#e3a743;--ok:#5fcf95;
  --glass:rgba(255,255,255,.045);--glass2:rgba(255,255,255,.08);--glass-line:rgba(255,255,255,.1);--glass-edge:rgba(0,0,0,.4);
  --bar:rgba(18,16,13,.74);--shadow:0 1px 1px rgba(0,0,0,.3),0 14px 40px rgba(0,0,0,.35);--shadow2:0 30px 90px rgba(0,0,0,.7);
  --blob1:rgba(255,107,74,.16);--blob2:rgba(227,167,67,.1);--blob3:rgba(140,110,80,.12);--mark:rgba(227,167,67,.32);
}}
:root[data-theme=dark]{
  --bg:#12100d;--bg2:#1a1713;--ink:#f3ecdf;--ink2:#cfc6b7;--ink3:#978d7f;--ink4:#6a6156;--rule:#2d2822;--rule2:#40392f;
  --red:#ff6b4a;--red-soft:rgba(255,107,74,.13);--amber:#e3a743;--ok:#5fcf95;
  --glass:rgba(255,255,255,.045);--glass2:rgba(255,255,255,.08);--glass-line:rgba(255,255,255,.1);--glass-edge:rgba(0,0,0,.4);
  --bar:rgba(18,16,13,.74);--shadow:0 1px 1px rgba(0,0,0,.3),0 14px 40px rgba(0,0,0,.35);--shadow2:0 30px 90px rgba(0,0,0,.7);
  --blob1:rgba(255,107,74,.16);--blob2:rgba(227,167,67,.1);--blob3:rgba(140,110,80,.12);--mark:rgba(227,167,67,.32);
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-padding-top:calc(var(--top) + 40px)}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 var(--sans);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
a{color:inherit;text-decoration:none}
button,input{font:inherit;color:inherit}
button{cursor:pointer;-webkit-tap-highlight-color:transparent;border:0;background:transparent;padding:0}
:focus{outline:none}
:focus-visible{outline:2px solid var(--red);outline-offset:2px;border-radius:4px}
.num{font-family:var(--mono);font-variant-numeric:tabular-nums;letter-spacing:-.03em}
mark{background:var(--mark);color:inherit;border-radius:2px;padding:0 1px}
.bg{position:fixed;inset:0;z-index:-1;pointer-events:none;background:
  radial-gradient(720px 460px at 8% -8%,var(--blob1),transparent 70%),
  radial-gradient(680px 420px at 96% 4%,var(--blob2),transparent 70%),
  radial-gradient(900px 520px at 50% 108%,var(--blob3),transparent 70%)}
.wrap{max-width:1240px;margin:0 auto;padding-inline:40px}
.glass{background:var(--glass);border:1px solid var(--glass-line);box-shadow:var(--shadow),0 0 0 1px var(--glass-edge);-webkit-backdrop-filter:blur(22px) saturate(1.5);backdrop-filter:blur(22px) saturate(1.5);border-radius:18px}

/* ---------- 顶部工具栏 ---------- */
.util{position:sticky;top:0;z-index:20;background:var(--bar);-webkit-backdrop-filter:blur(18px) saturate(1.4);backdrop-filter:blur(18px) saturate(1.4);border-bottom:1px solid var(--rule);padding-top:env(safe-area-inset-top)}
.util .wrap{height:46px;display:flex;align-items:center;gap:18px;font-size:12.5px;color:var(--ink3)}
.live{display:inline-flex;align-items:center;gap:7px;white-space:nowrap}
.live b{width:6px;height:6px;border-radius:50%;background:var(--red);animation:pulse 2.4s infinite}
.live strong{color:var(--ink);font-weight:600}
.live.err b{animation:none;background:var(--ink4)}
@keyframes pulse{0%{box-shadow:0 0 0 0 var(--red-soft)}60%{box-shadow:0 0 0 7px transparent}100%{box-shadow:0 0 0 0 transparent}}
.clocks{display:flex;gap:16px;white-space:nowrap}
.clk b{color:var(--ink);font-weight:500}
.clk em{font-style:normal;margin-inline-start:5px}
.clk.open em{color:var(--ok);font-weight:600}
.sp{flex:1}
.trs{font-size:12px;color:var(--red);white-space:nowrap;display:none}
.trs.on{display:inline}
button.trs{text-decoration:underline;text-underline-offset:3px}
.sbox{position:relative;width:220px}
.sbox svg{position:absolute;inset-inline-start:10px;top:50%;transform:translateY(-50%);width:14px;height:14px;color:var(--ink4);pointer-events:none}
.sbox input{width:100%;height:30px;border:1px solid var(--rule);background:var(--glass);border-radius:999px;padding-inline:30px 12px;font-size:13px;-webkit-appearance:none;appearance:none}
.sbox input::placeholder{color:var(--ink4)}
.sbox input::-webkit-search-cancel-button{-webkit-appearance:none}
.sbox input:focus{border-color:var(--ink3);background:var(--glass2)}
.lang{display:inline-flex;border:1px solid var(--rule);border-radius:999px;padding:2px;background:var(--glass)}
.lang button{font-size:12px;font-weight:600;color:var(--ink3);padding:4px 10px;border-radius:999px;line-height:1.3}
.lang button.on{background:var(--ink);color:var(--bg)}
.ib{position:relative;width:32px;height:32px;border-radius:50%;display:grid;place-items:center;color:var(--ink2);flex:none}
.ib:hover{background:var(--glass2)}
.ib svg{width:17px;height:17px}
.ib.has::after{content:"";position:absolute;top:5px;inset-inline-end:5px;width:7px;height:7px;border-radius:50%;background:var(--red);box-shadow:0 0 0 2px var(--bg)}
#sbtn,.cancel{display:none}

/* ---------- 报头与视图切换 ---------- */
.mast{text-align:center;padding:26px 0 18px}
.mast h1{margin:0;font:700 46px/1 var(--serif);letter-spacing:-.02em}
.mast p{margin:9px 0 0;font-size:12px;letter-spacing:.2em;color:var(--ink3)}
[dir=rtl] .mast p,[dir=rtl] .kick,[dir=rtl] .sec,[dir=rtl] .lbl{letter-spacing:0}
.tabs{position:sticky;top:calc(47px + env(safe-area-inset-top));z-index:19;background:var(--bar);-webkit-backdrop-filter:blur(18px) saturate(1.4);backdrop-filter:blur(18px) saturate(1.4)}
.tabs .wrap>div{display:flex;align-items:center;gap:26px;height:45px;border-top:3px double var(--ink);border-bottom:1px solid var(--ink)}
.tab{position:relative;font-size:13.5px;font-weight:600;color:var(--ink3);white-space:nowrap;height:100%;display:inline-flex;align-items:center;gap:6px}
.tab i{font-style:normal;font-weight:400;font-size:12px;color:var(--ink4)}
.tab:hover{color:var(--ink)}
.tab.on{color:var(--red)}
.tab.on::after{content:"";position:absolute;inset-inline:0;bottom:-1px;height:2px;background:var(--red)}
.sum{margin-inline-start:auto;font-size:12px;color:var(--ink3);white-space:nowrap;display:flex;gap:10px;align-items:center;overflow:hidden}
.sum b{color:var(--red);font-weight:600}
.sum button{color:var(--red);font-size:12px;text-decoration:underline;text-underline-offset:3px}

/* ---------- 通用小件 ---------- */
.kick{font-size:11.5px;font-weight:700;letter-spacing:.14em;color:var(--red);margin-bottom:14px;display:flex;align-items:center;gap:10px}
.sec{display:flex;align-items:center;justify-content:space-between;font-size:11.5px;letter-spacing:.14em;font-weight:700;border-top:3px solid var(--ink);padding-top:10px;margin-bottom:4px}
.sec button{font-size:12px;letter-spacing:0;color:var(--red);font-weight:600}
.by{font-size:12.5px;color:var(--ink3);display:flex;flex-wrap:wrap;gap:4px 12px;align-items:center}
.by b{color:var(--ink);font-weight:600}
.sc{display:inline-block;min-width:30px;text-align:center;font:700 12px/1 var(--mono);letter-spacing:-.03em;padding:5px 6px;border-radius:3px;color:var(--ink4)}
.sc.s2{color:var(--ink2);box-shadow:inset 0 0 0 1px var(--rule2)}
.sc.s3{background:var(--ink);color:var(--bg)}
.cf{color:var(--red);font-weight:600;white-space:nowrap}
.hit{font:500 11px/1 var(--mono);letter-spacing:-.02em;padding:4px 6px;border-radius:3px;color:var(--ink3);box-shadow:inset 0 0 0 1px var(--rule2);white-space:nowrap}
.wh{color:var(--red);font-size:11.5px;font-weight:600;white-space:nowrap}
.tsep{width:1px;height:16px;background:var(--rule2);flex:none}
.btn.on{color:var(--red);border-color:var(--red)}
.li .sc{align-self:start}
.stat{display:flex;flex-direction:column}
.vs{margin-top:16px}.vs strong{display:block;font-size:13.5px;font-weight:700}.vs strong.up{color:var(--red)}.vs small,.sen small,.tk .sub{display:block;font-size:11.5px;color:var(--ink3);margin-top:5px;line-height:1.45}
.gauge{position:relative;height:6px;border-radius:3px;background:var(--rule2);margin-top:10px}
.gauge:before{content:'';position:absolute;inset-inline-start:50%;top:-4px;width:1px;height:14px;background:var(--ink3)}
.gauge i{position:absolute;top:-3px;width:12px;height:12px;margin-inline-start:-6px;border-radius:50%;background:var(--ink);border:2px solid var(--bg);transition:inset-inline-start .6s cubic-bezier(.2,.7,.2,1)}
.gauge i.up{background:var(--red)}
.sen{margin-top:auto;padding-top:18px}.sen .hd{display:flex;justify-content:space-between;font-size:12px;font-weight:700}.sen .hd .sbu{color:var(--ok)}.sen .hd .sbe{color:var(--red)}
.split{display:flex;height:6px;border-radius:3px;overflow:hidden;background:var(--rule2);margin-top:7px;gap:2px}.split i{display:block;transition:flex-grow .6s cubic-bezier(.2,.7,.2,1)}.split .sbu{background:var(--ok)}.split .sne{background:var(--rule2)}.split .sbe{background:var(--red)}
.tk .sub{margin:-4px 0 8px}
.tkr{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:10px;width:100%;padding:8px 0;border:0;border-top:1px solid var(--rule);background:none;color:inherit;font:inherit;text-align:start;cursor:pointer}
.tkr b{font:700 13px/1 var(--sans);letter-spacing:.02em;min-width:46px}.tkr span{font-size:12.5px;color:var(--ink3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tkr em{font-style:normal;font-size:12.5px;font-weight:700}.tkr u{grid-column:1/-1;display:block;height:3px;border-radius:2px;background:var(--ink);opacity:.75;text-decoration:none;margin-top:-2px}.tkr.h u{background:var(--red);opacity:1}
.tkr:hover b{color:var(--red)}
.wform{display:flex;gap:8px;padding:4px 26px 0}
.wform input{flex:1;min-width:0;height:38px;border:1px solid var(--rule2);background:var(--glass);border-radius:999px;padding-inline:14px;font-size:14px}
.wform input:focus{border-color:var(--ink3)}
.wchips{display:flex;flex-wrap:wrap;gap:6px;padding:10px 26px 0}
.wc{font-size:12.5px;font-weight:600;color:var(--red);border:1px solid var(--red);border-radius:999px;padding:3px 10px}
.whint{margin:8px 26px 0;font-size:11.5px;color:var(--ink3);line-height:1.5}
.show{position:fixed;inset:0;z-index:50;background:var(--bg);display:none;flex-direction:column;padding:4vh 6vw 0;cursor:pointer}
.show::before{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(60vw 50vh at 0% 0%,var(--blob1),transparent 70%),radial-gradient(60vw 50vh at 100% 100%,var(--blob2),transparent 70%)}
.showing .show{display:flex}.showing{overflow:hidden}
.show-top{position:relative;display:flex;align-items:center;gap:18px;font-size:14px;color:var(--ink3);border-bottom:3px double var(--ink);padding-bottom:14px}
.show-top b{font:700 22px/1 var(--serif);color:var(--ink)}
.show-top button{width:34px;height:34px;border-radius:50%;border:1px solid var(--rule2);display:grid;place-items:center;color:var(--ink2)}
.show-top svg{width:13px;height:13px}
.show-body{position:relative;flex:1;display:flex;flex-direction:column;justify-content:center;max-width:1500px;animation:rise .5s ease-out}
@keyframes rise{from{opacity:0;transform:translateY(14px)}}
.show-body .kick{font-size:clamp(13px,1.2vw,18px);margin-bottom:3vh}
.show-body h1{margin:0 0 3.4vh;font:700 clamp(34px,5.6vw,92px)/1.08 var(--serif);letter-spacing:-.03em;word-break:break-word}
.show-body h1.zh{line-height:1.2;letter-spacing:0;font-size:clamp(30px,4.8vw,80px)}
.show-body p{margin:0 0 4vh;font:clamp(17px,1.9vw,30px)/1.5 var(--serif);color:var(--ink2);max-width:40em;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.show-body .foot{display:flex;align-items:center;gap:20px}
.show-body .by{font-size:clamp(14px,1.3vw,20px)}
.show-body .ring{width:84px;height:84px}.show-body .ring span{font-size:29px}
.show-bar{position:relative;height:3px;background:var(--rule);margin:0 -6vw}
.show-bar i{display:block;height:100%;background:var(--red);transform-origin:0 50%;animation:prog 12s linear}
[dir=rtl] .show-bar i{transform-origin:100% 50%}
.paused .show-bar i{animation-play-state:paused}
@keyframes prog{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.trb{font-size:10.5px;color:var(--ink4);border:1px solid var(--rule2);border-radius:3px;padding:0 4px;line-height:15px;white-space:nowrap}
.ring{--p:80;position:relative;flex:none;width:68px;height:68px;border-radius:50%;background:conic-gradient(var(--red) calc(var(--p)*1%),var(--rule) 0);display:grid;place-items:center}
.ring::before{content:"";position:absolute;inset:5px;border-radius:50%;background:var(--bg)}
.ring span{position:relative;font:700 23px/1 var(--serif);letter-spacing:-.03em}
.ring.lo{background:conic-gradient(var(--ink3) calc(var(--p)*1%),var(--rule) 0)}
[data-id]{cursor:pointer}

/* ---------- 简报 ---------- */
.top{display:grid;grid-template-columns:1.55fr 1fr;gap:44px;padding:32px 0 30px}
.hero h2{margin:0 0 18px;font:700 52px/1.08 var(--serif);letter-spacing:-.025em;word-break:break-word}
.hero h2.zh{font-size:44px;line-height:1.2;letter-spacing:0}
.hero p{font:19px/1.6 var(--serif);color:var(--ink2);margin:0 0 22px;max-width:34em}
.hero .foot{display:flex;align-items:center;gap:16px}
@media (hover:hover){.hero:hover h2,.rk:hover h4,.card:hover h4,.w:hover .wt,.li:hover .lt{text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:4px}}
.rank{border-inline-start:1px solid var(--rule);padding-inline-start:36px}
.rank h3{margin:0 0 4px;font-size:11.5px;letter-spacing:.14em;color:var(--ink3);font-weight:700}
.rk{display:grid;grid-template-columns:44px 1fr;gap:6px;padding:15px 0;border-bottom:1px solid var(--rule)}
.rk:last-child{border:0}
.rk em{font:italic 400 34px/1 var(--serif);color:var(--ink4)}
.rk h4{margin:0 0 7px;font:700 19px/1.3 var(--serif);letter-spacing:-.01em}
.now{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;padding-bottom:34px}
.tile{padding:20px 22px;min-width:0}
.lbl{font-size:11.5px;font-weight:700;letter-spacing:.12em;color:var(--ink3);margin-bottom:10px}
.stat b{display:block;font:700 58px/1 var(--serif);letter-spacing:-.04em}
.stat p{margin:8px 0 0;font-size:13px;color:var(--ink3);line-height:1.5}
.topic h3{margin:0;font:700 25px/1.15 var(--serif);letter-spacing:-.02em;display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.topic h3 span{font:500 12px/1 var(--sans);letter-spacing:0;color:var(--red);white-space:nowrap}
.topic .cnt{font-size:12.5px;color:var(--ink3);margin:3px 0 8px}
.li{display:grid;grid-template-columns:auto 1fr;gap:10px;padding:9px 0;border-top:1px solid var(--rule);font-size:13.5px;line-height:1.4}
.li .lt{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.li small{display:block;color:var(--ink3);font-size:11.5px;margin-top:2px}
.low{display:grid;grid-template-columns:1.55fr 1fr;gap:44px;padding-bottom:60px}
.g3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0 28px}
.card{padding:16px 0;border-bottom:1px solid var(--rule)}
.card h4{margin:0 0 8px;font:700 18px/1.32 var(--serif)}
.card p{margin:0 0 10px;font-size:13.5px;color:var(--ink2);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.wire{padding-inline-start:36px;border-inline-start:1px solid var(--rule)}
.w{display:grid;grid-template-columns:46px 1fr;gap:10px;padding:10px 0;border-bottom:1px dotted var(--rule2);font-size:14px;line-height:1.45}
.w time{color:var(--red);font-size:12.5px;padding-top:1px}
.w.h .wt{font-weight:700}
.w small{display:block;color:var(--ink3);font-size:11.5px;margin-top:2px}

/* ---------- 列表视图 ---------- */
.list{padding:8px 0 80px}
.day{position:sticky;top:var(--top);z-index:3;background:var(--bar);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);display:flex;gap:10px;align-items:baseline;padding:12px 0 8px;font:700 15px/1 var(--serif);border-bottom:1px solid var(--ink)}
.day span{font:400 12px/1 var(--sans);color:var(--ink3)}
.row{display:grid;grid-template-columns:48px 36px minmax(0,1fr) auto;column-gap:14px;align-items:baseline;padding:12px 0;border-bottom:1px solid var(--rule)}
.row .t{color:var(--ink3);font-size:12.5px}
.row .h{font:400 16.5px/1.42 var(--serif);color:var(--ink2);word-break:break-word}
.row.m .h{color:var(--ink)}
.row.imp .h{color:var(--ink);font-weight:700;font-size:18px}
.row.imp .t{color:var(--red)}
.row .x{display:inline-flex;gap:8px;margin-inline-start:10px;vertical-align:2px;font-size:12px;align-items:center}
.row .src{font-size:12px;color:var(--ink3);white-space:nowrap;max-width:160px;overflow:hidden;text-overflow:ellipsis}
.row.sel{background:var(--red-soft);box-shadow:-12px 0 0 var(--red-soft),12px 0 0 var(--red-soft)}
@media (hover:hover){.row:hover .h{text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:4px}}
.row.new{animation:flash 2.6s ease-out}
@keyframes flash{0%{background:var(--mark)}}
.seen{display:flex;align-items:center;gap:12px;font-size:11.5px;font-weight:700;letter-spacing:.08em;color:var(--red);padding:10px 0}
.seen::before,.seen::after{content:"";flex:1;height:1px;background:var(--red);opacity:.5}
.empty{text-align:center;color:var(--ink3);padding:90px 24px;font-size:14px}
.empty b{display:block;color:var(--ink);font:700 22px/1.3 var(--serif);margin-bottom:8px}
.empty button{margin-top:18px}
.morebox{text-align:center;padding:28px 0 0;font-size:13px;color:var(--ink3)}
.morebox .btn[disabled]{opacity:.5;cursor:default}
.sk{height:14px;border-radius:3px;background:var(--rule);margin:22px 0;animation:sk 1.3s ease-in-out infinite alternate}
@keyframes sk{to{opacity:.4}}

/* ---------- 阅读面板 ---------- */
.scrim{position:fixed;inset:0;z-index:30;background:rgba(20,14,8,.36);opacity:0;pointer-events:none;transition:opacity .2s}
.open-reader .scrim,.open-side .scrim{opacity:1;pointer-events:auto}
.panel{position:fixed;z-index:31;top:12px;bottom:12px;inset-inline-end:12px;width:min(460px,calc(100vw - 24px));overflow-y:auto;border-radius:22px;background:color-mix(in srgb,var(--bg) 86%,transparent);box-shadow:var(--shadow2),0 0 0 1px var(--glass-edge);transform:translateX(calc(100% + 30px));transition:transform .28s cubic-bezier(.2,.8,.2,1);visibility:hidden;scrollbar-width:thin}
[dir=rtl] .panel{transform:translateX(calc(-100% - 30px))}
.open-reader #reader,.open-side #side{transform:none;visibility:visible}
.px{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;align-items:center;padding:16px 22px 8px;font-size:11.5px;font-weight:700;letter-spacing:.12em;color:var(--ink3)}
.px button{width:30px;height:30px;border-radius:50%;background:var(--glass);border:1px solid var(--glass-line);display:grid;place-items:center;color:var(--ink2)}
.px svg{width:13px;height:13px}
.d{padding:6px 26px 34px}
.d-top{display:flex;align-items:center;gap:16px;margin-bottom:20px}
.d-lv{font-size:14px;font-weight:700}
.d-lv.hot{color:var(--red)}
.d-by{font-size:12.5px;color:var(--ink3);margin-top:2px}
.d h2{margin:0 0 14px;font:700 27px/1.25 var(--serif);letter-spacing:-.015em;word-break:break-word}
.d .by{margin-bottom:16px}
.d-body{font:16.5px/1.7 var(--serif);color:var(--ink2);word-break:break-word}
.d-body p{margin:0 0 12px}
.d-none{font-size:13px;color:var(--ink4)}
.orig{margin-top:18px;padding-top:14px;border-top:1px dotted var(--rule2);font-size:13px;color:var(--ink3);line-height:1.55}
.orig b{display:block;font-size:11px;letter-spacing:.1em;color:var(--ink4);margin-bottom:4px}
.d-act{display:flex;gap:8px;margin-top:22px;flex-wrap:wrap}
.btn{display:inline-flex;align-items:center;gap:6px;height:38px;padding:0 16px;border-radius:999px;border:1px solid var(--rule2);font-size:13.5px;font-weight:600;color:var(--ink2)}
.btn:hover{border-color:var(--ink3);color:var(--ink)}
.btn.pri{background:var(--ink);border-color:var(--ink);color:var(--bg)}
.btn.pri:hover{opacity:.88;color:var(--bg)}
.btn svg{width:13px;height:13px}

/* ---------- 来源与设置面板 ---------- */
.sh{display:flex;align-items:center;justify-content:space-between;padding:16px 26px 6px;font-size:11.5px;font-weight:700;letter-spacing:.12em;color:var(--ink3)}
.sh button{font-size:12px;letter-spacing:0;color:var(--red);font-weight:600}
.grp{display:flex;align-items:center;width:100%;padding:10px 26px 4px;font:700 15px/1.2 var(--serif);text-align:start;gap:6px}
.grp .num{margin-inline-start:auto;font-size:11px;color:var(--ink4);font-weight:400}
.so{display:flex;align-items:center;gap:10px;width:100%;padding:6px 26px;font-size:14px;color:var(--ink2);text-align:start;min-height:36px}
.so:hover{background:var(--glass)}
.so .bx{flex:none;width:15px;height:15px;border-radius:4px;border:1px solid var(--ink4);display:grid;place-items:center}
.so .bx svg{width:10px;height:10px;color:var(--bg);opacity:0}
.so.on .bx{background:var(--ink);border-color:var(--ink)}
.so.on .bx svg{opacity:1}
.so:not(.on){color:var(--ink4)}
.so .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.so .via{font-size:10px;color:var(--ink4);border:1px solid var(--rule2);border-radius:3px;padding:0 4px;line-height:14px;flex:none}
.so .bad{width:6px;height:6px;border-radius:50%;background:var(--red);flex:none}
.so .only{margin-inline-start:auto;font-size:12px;color:var(--red);display:none;flex:none}
.so .num{margin-inline-start:auto;font-size:11px;color:var(--ink4);flex:none}
@media (hover:hover){.so:hover .only{display:inline}.so:hover .only+.num{display:none}}
.set{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 26px;font-size:14px;color:var(--ink2);min-height:44px}
.set small{display:block;font-size:11.5px;color:var(--ink3);line-height:1.4}
.sw{flex:none;width:36px;height:20px;border-radius:10px;background:var(--rule2);position:relative;transition:background .15s}
.sw::after{content:"";position:absolute;top:2px;inset-inline-start:2px;width:16px;height:16px;border-radius:50%;background:var(--bg);transition:transform .15s}
.sw[aria-pressed=true]{background:var(--red)}
.sw[aria-pressed=true]::after{transform:translateX(16px)}
[dir=rtl] .sw[aria-pressed=true]::after{transform:translateX(-16px)}
.seg{display:inline-flex;border:1px solid var(--rule2);border-radius:999px;padding:2px;flex:none}
.seg button{font-size:12px;color:var(--ink3);padding:4px 10px;border-radius:999px;font-weight:600}
.seg button.on{background:var(--ink);color:var(--bg)}
.keys{padding:4px 26px 20px;font-size:12px;color:var(--ink3);line-height:2.1}
.keys kbd{font:500 10.5px/1 var(--mono);border:1px solid var(--rule2);border-radius:3px;padding:2px 5px;color:var(--ink2);margin-inline-end:3px}
.keys span{margin-inline-end:12px;white-space:nowrap;display:inline-block}
.mclk{display:none;gap:18px;padding:4px 26px 0;font-size:12.5px;color:var(--ink3);flex-wrap:wrap}

.pill{position:fixed;left:50%;top:calc(var(--top) + 14px);transform:translate(-50%,-110px);z-index:15;border-radius:999px;background:var(--ink);color:var(--bg);font-size:13px;font-weight:600;padding:9px 16px;box-shadow:var(--shadow2);transition:transform .22s cubic-bezier(.2,.8,.2,1);white-space:nowrap}
.pill.show{transform:translate(-50%,0)}
.pill.hot{background:var(--red);color:#fff}
.tip{position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:40;background:var(--ink);color:var(--bg);font-size:13px;padding:9px 15px;border-radius:999px;opacity:0;pointer-events:none;transition:opacity .2s;max-width:88vw;text-align:center}
.tip.show{opacity:1}

/* ---------- 平板 ---------- */
@media (max-width:1080px){
  .wrap{padding-inline:26px}
  .clocks{display:none}.mclk{display:flex}
  .top,.low{grid-template-columns:1fr;gap:0}
  .rank,.wire{border:0;padding:0;margin-top:26px}
  .rank h3{border-top:3px solid var(--ink);padding-top:10px;color:var(--ink)}
  .now{grid-template-columns:repeat(2,minmax(0,1fr))}
  .hero h2{font-size:44px}.hero h2.zh{font-size:38px}
}
/* ---------- 手机 ---------- */
@media (max-width:719px){
  .wrap{padding-inline:18px}
  .util .wrap{gap:8px;height:48px}
  .live span{display:none}
  .lang button{padding:5px 9px}
  .util .sbox{display:none;flex:1;width:auto}
  .util .sbox input{height:36px;font-size:16px}
  #sbtn{display:grid}
  .searching .live,.searching .sp,.searching .lang,.searching .ib,.searching .trs{display:none}
  .searching .sbox{display:block}.searching .cancel{display:block;font-size:14px;color:var(--ink2);padding:6px 2px;white-space:nowrap}
  .trs{position:absolute;inset-inline:18px;top:calc(100% + 6px);text-align:center;background:var(--bg);border:1px solid var(--rule);border-radius:999px;padding:4px 10px}
  .util .wrap{position:relative}
  .mast{padding:18px 0 14px}.mast h1{font-size:31px}.mast p{font-size:10.5px;letter-spacing:.14em}
  .tabs{top:calc(49px + env(safe-area-inset-top))}
  .tabs .wrap>div{gap:22px;overflow-x:auto;scrollbar-width:none}
  .tabs .wrap>div::-webkit-scrollbar{display:none}
  .sum{display:none}
  .top{padding:24px 0 26px}
  .hero h2{font-size:32px;line-height:1.14}.hero h2.zh{font-size:28px;line-height:1.28}
  .hero p{font-size:17px}
  .ring{width:56px;height:56px}.ring span{font-size:19px}
  .rk{grid-template-columns:36px 1fr}.rk em{font-size:28px}.rk h4{font-size:18px}
  .now{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;gap:12px;margin-inline:-18px;padding:4px 18px 30px;scrollbar-width:none}
  .now::-webkit-scrollbar{display:none}
  .now .tile{flex:0 0 78%;scroll-snap-align:center}
  .g3{grid-template-columns:1fr}
  .low{padding-bottom:40px}
  .row{grid-template-columns:auto minmax(0,1fr) auto;grid-template-areas:"t src s" "c c c";column-gap:10px;row-gap:6px;padding:13px 0;align-items:center}
  .row .t{grid-area:t}.row .src{grid-area:src;max-width:none}.row .sc{grid-area:s;justify-self:end}.row .c{grid-area:c}
  .row .h{font-size:17px}.row.imp .h{font-size:18.5px}
  .row .x{display:flex;margin:6px 0 0}
  .panel{top:auto;bottom:0;inset-inline:0;width:auto;max-height:86vh;max-height:86dvh;border-radius:22px 22px 0 0;transform:translateY(105%);padding-bottom:env(safe-area-inset-bottom)}
  [dir=rtl] .panel{transform:translateY(105%)}
  .keysec{display:none}
  .d{padding-inline:22px}.d h2{font-size:24px}
  .sh,.grp,.so,.set,.mclk,.wform,.wchips{padding-inline:22px}.whint{margin-inline:22px}
  #pbtn{display:none}.show-top span[data-i]{display:none}
}
@media (prefers-reduced-motion:reduce){*:not(#showBar){animation:none!important;transition:none!important}}
`;

const JS = String.raw`
var I18N={
zh:{tag:'美股与沙特市场快讯',live:'实时更新',updated:'{0} 更新',fail:'连接失败，自动重试中',ny:'纽约',ry:'利雅得',mOpen:'开盘',mClosed:'休市',mPre:'盘前',mPost:'盘后',mNote:'按常规交易时段判断，不含节假日',
 search:'搜索标题和摘要',cancel:'取消',settings:'来源与设置',brief:'简报',hot:'重要',mid:'6 分以上',all:'全部',
 total:'共 {0} 条 · 每分钟抓取',hidden:'已隐藏 {0} 个来源',searching:'搜索“{0}”',clear:'清除筛选',sinceVisit:'上次查看后新增 <b>{0}</b> 条重要',
 lead:'头条',scoreN:'评分 {0}',topToday:'今日要闻',vsUp:'比平常多 {0}%',vsDown:'比平常少 {0}%',vsFlat:'和平常差不多',vsNone:'对比数据积累中，满一天后显示',vsNote:'对比过去 {0} 天同一时段的平均 {1} 条',senti:'多空情绪',bull:'利好 {0}',bear:'利空 {0}',sentiNote:'按标题关键词估算',sentiNone:'暂无明显多空信号',tkTitle:'热门股票',tkNone:'过去 12 小时没有被多次提到的股票',tkSub:'过去 12 小时被提到的次数，点击筛选',last12:'过去 12 小时',statLine:'条重要快讯，共 {0} 条，来自 {1} 个来源',hAgo:'{0} 小时前',nowL:'现在',
 topic:'话题',topicCnt:'{0} 条快讯 · {1} 条重要',timeline:'时间线 →',more:'更多重要快讯',wire:'实时快讯',viewAll:'查看全部 →',
 nSrc:'{0} 个来源证实',merged:'同一事件已合并',pts:'{0} 分',today:'今天',yesterday:'昨天',items:'{0} 条',seenHere:'上次看到这里',
 lvHot:'重要快讯',lvNone:'尚未评分',lvHigh:'高分',lvMid:'一般关注',lvLow:'常规消息',byAi:'AI 评分',byRule:'规则评分',byWait:'等待评分',boost:'原始 {0}，多源证实加分',
 noBody:'这条快讯只有标题，没有摘要。',original:'原文',translated:'译',open:'打开原文',copy:'复制标题',copied:'已复制标题',copyFail:'复制失败，请手动选择文字',detail:'快讯详情',
 sources:'来源',selAll:'全选',only:'只看',fetchFail:'最近一次抓取失败：{0}',gFlash:'快讯',gWire:'通讯社与媒体',gCn:'中文快讯',gGulf:'沙特与海湾',gOff:'官方与公告',gOther:'其他',
 alerts:'提醒',sound:'提示音',soundD:'有重要快讯时响一声',notif:'桌面通知',notifD:'有重要快讯时弹出系统通知',notifNo:'这个浏览器不支持',notifDenied:'已被浏览器拒绝，需在浏览器设置里放行',
 look:'外观',theme:'主题',tAuto:'跟随系统',tDark:'深色',tLight:'浅色',keys:'快捷键',kMove:'上下条',kOpen:'打开原文',kSearch:'搜索',kView:'切换视图',kStar:'收藏',kShow:'展示模式',
 eNone:'还没有数据',eNoneD:'部署后等一两分钟，第一批快讯就会出现。',eFilter:'没有符合条件的快讯',eFilterD:'当前的来源筛选或搜索把结果都过滤掉了。',eScore:'暂时没有达到这个分数的快讯',eScoreD:'可以切到“全部”看所有快讯。',eConn:'连接失败',eConnD:'暂时读不到数据，页面会自动重试。',
 newHot:'↑ {0} 条新的重要快讯',newAll:'↑ {0} 条新快讯',trLoad:'翻译模型下载中 {0}%',trEnable:'点此启用快讯翻译',trNo:'此浏览器不支持网页内翻译，快讯显示原文（电脑版 Chrome 可用）',watch:'自选',star:'收藏',wTitle:'自选关注',wPh:'如 NVDA、Aramco、美联储',add:'添加',wHint:'命中这些词的快讯会标出来，并汇总在“自选”一栏',wEmpty:'还没有自选关注',wEmptyD:'在右上角“来源与设置”里添加股票代码或关键词。',wNone:'暂时没有命中自选的快讯',sEmpty:'还没有收藏',sEmptyD:'打开一条快讯，点“收藏”就会出现在这里。',save:'收藏',saved:'已收藏',share:'复制分享文本',shared:'已复制，可直接粘贴',present:'展示模式',pHint:'← → 切换 · 空格暂停 · Esc 退出',pEmpty:'暂时没有重要快讯',src:'来源',loadMore:'加载更早的快讯',loading:'加载中…',noMore:'没有更早的快讯了（数据库保留最近 7 天）',loaded:'已载入 {0} 条 · 每分钟抓取',days:'日一二三四五六',dateFmt:'{0}月{1}日 星期{2}'},
en:{tag:'US & SAUDI MARKET FLASHES',live:'Live',updated:'updated {0}',fail:'Connection lost, retrying',ny:'New York',ry:'Riyadh',mOpen:'Open',mClosed:'Closed',mPre:'Pre-market',mPost:'After hours',mNote:'Regular session hours; holidays not included',
 search:'Search headlines and summaries',cancel:'Cancel',settings:'Sources & settings',brief:'Briefing',hot:'Important',mid:'Score 6+',all:'All',
 total:'{0} items · fetched every minute',hidden:'{0} sources hidden',searching:'Search "{0}"',clear:'Clear filters',sinceVisit:'<b>{0}</b> important since your last visit',
 lead:'LEAD STORY',scoreN:'SCORE {0}',topToday:'TOP STORIES',vsUp:'{0}% busier than usual',vsDown:'{0}% quieter than usual',vsFlat:'About as busy as usual',vsNone:'Comparison appears after a full day of history',vsNote:'vs. an average of {1} in the same hours over the past {0} days',senti:'SENTIMENT',bull:'Bullish {0}',bear:'Bearish {0}',sentiNote:'Estimated from headline keywords',sentiNone:'No clear signal yet',tkTitle:'MOST MENTIONED STOCKS',tkNone:'No stock mentioned more than once in the last 12 hours',tkSub:'Mentions in the last 12 hours. Click to filter',last12:'LAST 12 HOURS',statLine:'important flashes out of {0}, from {1} sources',hAgo:'{0}h ago',nowL:'now',
 topic:'TOPIC',topicCnt:'{0} flashes · {1} important',timeline:'Timeline →',more:'MORE IMPORTANT',wire:'LIVE WIRE',viewAll:'View all →',
 nSrc:'{0} sources confirm',merged:'Merged with same story',pts:'{0}',today:'Today',yesterday:'Yesterday',items:'{0} items',seenHere:'YOU LEFT OFF HERE',
 lvHot:'Important',lvNone:'Not scored yet',lvHigh:'High score',lvMid:'Worth a look',lvLow:'Routine',byAi:'AI score',byRule:'Rule score',byWait:'Awaiting score',boost:'base {0}, raised by multi-source confirmation',
 noBody:'This flash has a headline only, no summary.',original:'ORIGINAL',translated:'TR',open:'Open original',copy:'Copy headline',copied:'Headline copied',copyFail:'Copy failed, select the text manually',detail:'FLASH DETAIL',
 sources:'SOURCES',selAll:'Select all',only:'Only',fetchFail:'Last fetch failed: {0}',gFlash:'Flash feeds',gWire:'Wires & media',gCn:'Chinese flashes',gGulf:'Saudi & Gulf',gOff:'Official & filings',gOther:'Other',
 alerts:'ALERTS',sound:'Sound',soundD:'Chime on important flashes',notif:'Desktop notifications',notifD:'System notification on important flashes',notifNo:'Not supported in this browser',notifDenied:'Blocked by the browser; allow it in browser settings',
 look:'APPEARANCE',theme:'Theme',tAuto:'System',tDark:'Dark',tLight:'Light',keys:'SHORTCUTS',kMove:'Next / previous',kOpen:'Open original',kSearch:'Search',kView:'Switch view',kStar:'Save',kShow:'Presentation',
 eNone:'No data yet',eNoneD:'The first flashes appear a minute or two after deployment.',eFilter:'Nothing matches',eFilterD:'The current source filter or search hides every flash.',eScore:'Nothing at this score yet',eScoreD:'Switch to "All" to see every flash.',eConn:'Connection failed',eConnD:'Data is unavailable right now. The page retries automatically.',
 newHot:'↑ {0} new important',newAll:'↑ {0} new flashes',trLoad:'Downloading translation model {0}%',trEnable:'Enable flash translation',trNo:'This browser cannot translate in-page, so flashes stay in their original language (desktop Chrome can)',watch:'Watchlist',star:'Saved',wTitle:'WATCHLIST',wPh:'e.g. NVDA, Aramco, Fed',add:'Add',wHint:'Flashes matching these terms are marked and collected under "Watchlist"',wEmpty:'No watchlist yet',wEmptyD:'Add tickers or keywords under "Sources & settings" at the top.',wNone:'No flashes match your watchlist right now',sEmpty:'Nothing saved yet',sEmptyD:'Open a flash and press "Save" to keep it here.',save:'Save',saved:'Saved',share:'Copy share text',shared:'Copied, ready to paste',present:'Presentation mode',pHint:'← → to move · Space to pause · Esc to exit',pEmpty:'No important flashes right now',src:'Source',loadMore:'Load earlier flashes',loading:'Loading…',noMore:'No earlier flashes (the database keeps the last 7 days)',loaded:'{0} loaded · fetched every minute',days:['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],dateFmt:'{2}, {3} {1}'},
ar:{tag:'أخبار عاجلة للسوقين الأمريكي والسعودي',live:'مباشر',updated:'آخر تحديث {0}',fail:'انقطع الاتصال، جارٍ إعادة المحاولة',ny:'نيويورك',ry:'الرياض',mOpen:'مفتوح',mClosed:'مغلق',mPre:'قبل الافتتاح',mPost:'بعد الإغلاق',mNote:'وفق ساعات التداول الاعتيادية، دون العطل',
 search:'ابحث في العناوين والملخصات',cancel:'إلغاء',settings:'المصادر والإعدادات',brief:'الموجز',hot:'المهم',mid:'6 فأكثر',all:'الكل',
 total:'{0} خبر · تحديث كل دقيقة',hidden:'{0} مصادر مخفية',searching:'بحث «{0}»',clear:'مسح التصفية',sinceVisit:'<b>{0}</b> أخبار مهمة منذ زيارتك الأخيرة',
 lead:'الخبر الرئيسي',scoreN:'التقييم {0}',topToday:'أبرز أخبار اليوم',vsUp:'أكثر نشاطًا من المعتاد بنسبة {0}%',vsDown:'أهدأ من المعتاد بنسبة {0}%',vsFlat:'قريب من المعتاد',vsNone:'تظهر المقارنة بعد يوم كامل من البيانات',vsNote:'مقارنة بمتوسط {1} في الساعات نفسها خلال {0} أيام',senti:'معنويات السوق',bull:'إيجابي {0}',bear:'سلبي {0}',sentiNote:'تقدير من كلمات العناوين',sentiNone:'لا إشارة واضحة بعد',tkTitle:'الأسهم الأكثر ذكرًا',tkNone:'لا سهم ذُكر أكثر من مرة في آخر 12 ساعة',tkSub:'عدد مرات الذكر في آخر 12 ساعة. انقر للتصفية',last12:'آخر 12 ساعة',statLine:'خبرًا مهمًا من أصل {0}، من {1} مصدرًا',hAgo:'قبل {0} س',nowL:'الآن',
 topic:'موضوع',topicCnt:'{0} خبر · {1} مهم',timeline:'التسلسل الزمني ←',more:'أخبار مهمة أخرى',wire:'الأخبار العاجلة',viewAll:'عرض الكل ←',
 nSrc:'أكدته {0} مصادر',merged:'مدمج مع الخبر نفسه',pts:'{0}',today:'اليوم',yesterday:'أمس',items:'{0} خبر',seenHere:'توقفت هنا في آخر زيارة',
 lvHot:'خبر مهم',lvNone:'لم يُقيَّم بعد',lvHigh:'تقييم مرتفع',lvMid:'جدير بالمتابعة',lvLow:'خبر اعتيادي',byAi:'تقييم الذكاء الاصطناعي',byRule:'تقييم القواعد',byWait:'بانتظار التقييم',boost:'الأساس {0}، ورُفع لتأكيد عدة مصادر',
 noBody:'هذا الخبر عنوان فقط دون ملخص.',original:'النص الأصلي',translated:'مترجم',open:'فتح المصدر',copy:'نسخ العنوان',copied:'تم نسخ العنوان',copyFail:'تعذّر النسخ، حدّد النص يدويًا',detail:'تفاصيل الخبر',
 sources:'المصادر',selAll:'تحديد الكل',only:'فقط',fetchFail:'فشل آخر جلب: {0}',gFlash:'خدمات عاجلة',gWire:'وكالات وإعلام',gCn:'عاجل بالصينية',gGulf:'السعودية والخليج',gOff:'جهات رسمية وإفصاحات',gOther:'أخرى',
 alerts:'التنبيهات',sound:'صوت التنبيه',soundD:'نغمة عند ورود خبر مهم',notif:'إشعارات سطح المكتب',notifD:'إشعار من النظام عند ورود خبر مهم',notifNo:'غير مدعوم في هذا المتصفح',notifDenied:'حظرها المتصفح؛ اسمح بها من إعداداته',
 look:'المظهر',theme:'السمة',tAuto:'النظام',tDark:'داكن',tLight:'فاتح',keys:'اختصارات',kMove:'التالي / السابق',kOpen:'فتح المصدر',kSearch:'بحث',kView:'تبديل العرض',kStar:'حفظ',kShow:'وضع العرض',
 eNone:'لا توجد بيانات بعد',eNoneD:'تظهر أولى الأخبار بعد دقيقة أو دقيقتين من التشغيل.',eFilter:'لا نتائج مطابقة',eFilterD:'تصفية المصادر أو البحث الحالي يخفي كل الأخبار.',eScore:'لا أخبار بهذا التقييم حاليًا',eScoreD:'انتقل إلى «الكل» لعرض جميع الأخبار.',eConn:'فشل الاتصال',eConnD:'تعذّر جلب البيانات الآن. تعيد الصفحة المحاولة تلقائيًا.',
 newHot:'↑ {0} أخبار مهمة جديدة',newAll:'↑ {0} أخبار جديدة',trLoad:'جارٍ تنزيل نموذج الترجمة {0}%',trEnable:'فعّل ترجمة الأخبار',trNo:'هذا المتصفح لا يدعم الترجمة داخل الصفحة، فتُعرض الأخبار بلغتها الأصلية (متاح في كروم لسطح المكتب)',watch:'قائمتي',star:'المحفوظات',wTitle:'قائمة المتابعة',wPh:'مثل NVDA أو أرامكو أو الفيدرالي',add:'إضافة',wHint:'تُميَّز الأخبار المطابقة لهذه الكلمات وتُجمع في «قائمتي»',wEmpty:'لا توجد قائمة متابعة بعد',wEmptyD:'أضف رموز الأسهم أو الكلمات من «المصادر والإعدادات» في الأعلى.',wNone:'لا أخبار مطابقة لقائمتك حاليًا',sEmpty:'لا محفوظات بعد',sEmptyD:'افتح خبرًا واضغط «حفظ» ليظهر هنا.',save:'حفظ',saved:'محفوظ',share:'نسخ نص المشاركة',shared:'تم النسخ وجاهز للصق',present:'وضع العرض',pHint:'← → للتنقل · مسافة للإيقاف · Esc للخروج',pEmpty:'لا أخبار مهمة حاليًا',src:'المصدر',loadMore:'تحميل أخبار أقدم',loading:'جارٍ التحميل…',noMore:'لا أخبار أقدم (تحتفظ القاعدة بآخر 7 أيام)',loaded:'تم تحميل {0} · تحديث كل دقيقة',days:['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'],dateFmt:'{2}، {1} {3}'}
};
var MONTHS={en:['January','February','March','April','May','June','July','August','September','October','November','December'],ar:['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر']};
function api(p){return p+(p.indexOf('?')>=0?'&':'?')+(KEY?'key='+encodeURIComponent(KEY):'');}
var $=function(id){return document.getElementById(id)};
var nav=(navigator.language||'zh').toLowerCase();
var state={view:'brief',lang:nav.indexOf('ar')===0?'ar':nav.indexOf('zh')===0?'zh':'en',off:{},q:'',sound:true,notify:true,theme:'auto',items:[],pending:[],lastSeen:0,first:true,loaded:false,newIds:{},sel:null,health:{},prevSeen:0,topSeen:0,watch:[],stars:{},shown:400,noMore:false,older:false};
try{var saved=JSON.parse(localStorage.getItem('hw')||'{}');
  if(/^(brief|hot|mid|all|watch|star)$/.test(saved.view))state.view=saved.view;if(/^(zh|en|ar)$/.test(saved.lang))state.lang=saved.lang;
  if(saved.off)state.off=saved.off;if(saved.sound===false)state.sound=false;if(saved.notify===false)state.notify=false;
  if(saved.theme==='dark'||saved.theme==='light')state.theme=saved.theme;if(saved.seen)state.prevSeen=state.topSeen=+saved.seen||0;if(Array.isArray(saved.watch))state.watch=saved.watch.filter(function(w){return typeof w==='string'&&w}).slice(0,40);}catch(e){}
try{state.stars=JSON.parse(localStorage.getItem('hw-stars')||'{}')||{}}catch(e){state.stars={}}
function save(){try{localStorage.setItem('hw',JSON.stringify({view:state.view,lang:state.lang,off:state.off,sound:state.sound,notify:state.notify,theme:state.theme,seen:state.topSeen,watch:state.watch}))}catch(e){}}
function saveStars(){try{localStorage.setItem('hw-stars',JSON.stringify(state.stars))}catch(e){}}
function T(k){var s=(I18N[state.lang]||I18N.zh)[k];if(s==null)s=I18N.zh[k];if(typeof s!=='string')return s;var a=arguments;return s.replace(/\{(\d)\}/g,function(_,n){return a[+n+1]});}

/* ---------- 小工具 ---------- */
var MARKS=new RegExp('['+String.fromCharCode(8206,8207)+']','g');
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function hl(s){s=String(s==null?'':s);var k=state.q.toLowerCase();if(!k)return esc(s);var low=s.toLowerCase(),out='',p=0,i;
  while((i=low.indexOf(k,p))>=0){out+=esc(s.slice(p,i))+'<mark>'+esc(s.slice(i,i+k.length))+'</mark>';p=i+k.length;}return out+esc(s.slice(p));}
function pad(n){return n<10?'0'+n:''+n}
function hm(ts){var d=new Date(ts);return pad(d.getHours())+':'+pad(d.getMinutes())}
function dayKey(ts){var d=new Date(ts);return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate()}
function dateText(ts){var d=new Date(ts),dn=T('days')[d.getDay()],mn=(MONTHS[state.lang]||[])[d.getMonth()];return T('dateFmt',d.getMonth()+1,d.getDate(),dn,mn);}
function dayLabel(ts){if(dayKey(ts)===dayKey(Date.now()))return [T('today'),dateText(ts)];if(dayKey(ts)===dayKey(Date.now()-864e5))return [T('yesterday'),dateText(ts)];return [dateText(ts),''];}
function fmtScore(x){return x==null?'–':String(Math.round(x*10)/10)}
function lvl(i){var s=i.score;if(s==null)return 0;if(s>=8)return 3;if(s>=5)return 2;return 1;}
function isHot(i){return !!(i.important&&!i.dup_of)}
var ENT={'&quot;':'"','&amp;':'&','&#39;':"'",'&apos;':"'",'&lt;':'<','&gt;':'>','&nbsp;':' '};
function dec(s){return String(s||'').replace(/&(?:quot|amp|#39|apos|lt|gt|nbsp);/g,function(m){return ENT[m]})}
function cleanTitle(t){return dec(t).replace(MARKS,'').replace(/^FinancialJuice:\s*/i,'').replace(/(?:\s+|(?<=[^\x00-\x7f]))(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,6}\/[A-Za-z0-9_\-\/.?=&%#]+/gi,'').replace(/\s*(?:more here|read more)\s*:?\s*$/i,'').replace(/\s*\|\s*$/,'').replace(/\s{2,}/g,' ').trim()||String(t||'');}
function squash(s){return String(s||'').toLowerCase().replace(/https?:\/\/\S+/g,'').replace(/[^\p{L}\p{N}]+/gu,'');}
function cleanBody(i){
  var b=dec(i.body).replace(/^Key Points(?=[A-Z])/,'').replace(MARKS,'').replace(/\r/g,'').split('\n').map(function(l){return l.trim()})
    .filter(function(l){return !/^https?:\/\/\S+$/.test(l)}).join('\n').replace(/\n{2,}/g,'\n\n').trim();
  if(!b)return '';
  var sb=squash(b),st=squash(i.title);
  if(sb===st||st.indexOf(sb)===0||sb===squash(cleanTitle(i.title)))return '';
  if(String(i.body).length>=495&&!/[.。!！?？…]$/.test(b))b+='…';
  return b;
}
function fixUrl(u){u=String(u||'');var m=u.match(/^https?:\/\/[^\/]+(https?:\/\/.*)$/);if(m)u=m[1];return /^https?:\/\//.test(u)?u:'';}
function shortSrc(s){return String(s).replace(/\s*\(Bluesky\)\s*$/i,'')}
var HAN=/\p{Script=Han}/u,ARAB=/\p{Script=Arabic}/u;
function itemLang(i){return HAN.test(i.title)?'zh':ARAB.test(i.title)?'ar':'en';}
var GROUPS=[['flash','gFlash'],['wire','gWire'],['cn','gCn'],['gulf','gGulf'],['off','gOff'],['other','gOther']];
function groupOf(s){var n=s.toLowerCase();
  if(HAN.test(s))return 'cn';
  if(/argaam|arab|saudi|gulf|tadawul|zawya/.test(n))return 'gulf';
  if(/financialjuice|unusual whales|investinglive|seeking alpha|squawk|walter/.test(n))return 'flash';
  if(/federal reserve|newswire|business wire|treasury|\bsec\b/.test(n))return 'off';
  if(/reuters|bloomberg|\bap\b|\bft\b|wsj|cnbc|barron|bbc|investing\.com|nasdaq|marketwatch/.test(n))return 'wire';
  return 'other';}
var CHECK='<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m2.5 6.2 2.4 2.4 4.6-5"/></svg>';
var EXT='<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3H3v10h10v-3M9 3h4v4M13 3 7.5 8.5"/></svg>';

/* ---------- 快讯内容翻译：在浏览器里完成，不占服务器额度 ---------- */
var TR={},trs={},trBusy={},want=[],wantBody={},pumping=false,pumpAgain=false,trTok=0,trTimer=0;
function trLoad(){try{TR=JSON.parse(localStorage.getItem('hw-tr-'+state.lang)||'{}')}catch(e){TR={}}}
function trSave(){try{var ks=Object.keys(TR);if(ks.length>700){var o={};ks.slice(-500).forEach(function(k){o[k]=TR[k]});TR=o;}localStorage.setItem('hw-tr-'+state.lang,JSON.stringify(TR))}catch(e){}}
// 返回要显示的标题和摘要；还没有译文的先显示原文，并排队等翻译
function tx(i,needBody){
  var o={t:cleanTitle(i.title),b:null,tr:false};
  if(itemLang(i)===state.lang)return o;
  var c=TR[i.id];
  if(i.tr_lang===state.lang&&i.title_tr){o.t=cleanTitle(i.title_tr);o.tr=true;
    if(i.body_tr)o.b=i.body_tr;else if(c&&c.b)o.b=c.b;else if(needBody&&!(c&&c.nb)){wantBody[i.id]=1;want.push(i.id);}
    return o;}
  if(c&&c.t){o.t=c.t;o.tr=true;if(c.b)o.b=c.b;}
  if(!c||(!c.t&&!c.x))want.push(i.id);
  if(needBody&&!(c&&(c.b||c.nb))){wantBody[i.id]=1;want.push(i.id);}
  return o;
}
function trStatus(mode,n){var el=$('trs'),bt=$('trOn');el.classList.remove('on');bt.classList.remove('on');
  if(mode==='load'){el.textContent=T('trLoad',n);el.classList.add('on');}else if(mode==='click'){bt.textContent=T('trEnable');bt.classList.add('on');}}
async function getTr(src,dst,gesture){
  var k=src+'>'+dst;if(k in trs)return trs[k];
  if(!('Translator' in self)){trs[k]=null;if(!getTr.told){getTr.told=1;tip(T('trNo'),5200);}return null;}
  if(trBusy[k])return trBusy[k];
  var tok=trTok;
  var job=(async function(){
    try{
      var av=await Translator.availability({sourceLanguage:src,targetLanguage:dst});
      if(av==='unavailable'){if(tok===trTok)trs[k]=null;return null;}
      // 模型还没下载时，浏览器要求由用户点击触发；没有点击就先显示“点此启用”的提示
      if(av!=='available'&&!gesture){trStatus('click');return null;}
      var t=await Translator.create({sourceLanguage:src,targetLanguage:dst,monitor:function(m){m.addEventListener('downloadprogress',function(e){if(tok!==trTok)return;if(e.loaded<1)trStatus('load',Math.round(e.loaded*100));else trStatus();});}});
      if(tok!==trTok)return null;
      trStatus();trs[k]=t;return t;
    }catch(e){if(tok===trTok)trStatus('click');return null;}
  })();
  trBusy[k]=job;
  try{return await job;}finally{if(trBusy[k]===job)delete trBusy[k];}
}
function warm(){var has={};state.items.forEach(function(i){has[itemLang(i)]=1});Object.keys(has).forEach(function(src){if(src!==state.lang)getTr(src,state.lang,true)});}
async function pump(gesture){
  if(pumping){if(gesture)pumpAgain=true;return;}pumping=true;var tok=trTok,done=0,skip={};
  try{
    var seen={},ids=want.filter(function(id){if(seen[id])return false;seen[id]=1;return true});want=[];
    for(var n=0;n<ids.length&&n<160;n++){
      if(tok!==trTok)break;
      var i=byId(ids[n]);if(!i)continue;var src=itemLang(i);if(src===state.lang)continue;
      if(skip[src])continue;var tr=await getTr(src,state.lang,gesture);if(!tr){skip[src]=1;continue;}
      var c=TR[i.id]||(TR[i.id]={});
      try{
        if(!c.t){c.t=String(await tr.translate(cleanTitle(i.title))||'').trim();if(!c.t)c.x=1;}
        if(wantBody[i.id]&&!c.b&&!c.nb){var b=cleanBody(i);if(b)c.b=String(await tr.translate(b)||'').trim();else c.nb=1;delete wantBody[i.id];}
      }catch(e){c.x=1;}
      if(tok!==trTok)break;
      if(++done%6===0)softRender();
    }
  }finally{pumping=false;if(done&&tok===trTok){trSave();softRender();}else if(pumpAgain||tok!==trTok){softRender();}pumpAgain=false;}
}
function softRender(){clearTimeout(trTimer);trTimer=setTimeout(function(){render(true);if(show.on){var k=show.k;showRender();show.k=k;}},120);}

/* ---------- 筛选 ---------- */
function base(){var k=state.q.toLowerCase(),tk=/^\$[A-Za-z0-9.]{1,6}$/.test(state.q)?tkRe(state.q.slice(1).toUpperCase()):null;
  return state.items.filter(function(i){if(state.off[i.source])return false;
    if(tk){if(!tk.test(i.title+' '+(i.title_tr||'')))return false;}else if(k){var c=TR[i.id];if((i.title+' '+(i.body||'')+' '+(i.title_tr||'')+' '+((c&&c.t)||'')).toLowerCase().indexOf(k)<0)return false;}return true;});}
function watchHit(i){if(!state.watch.length)return '';var c=TR[i.id],t=(i.title+' '+(i.body||'')+' '+(i.title_tr||'')+' '+((c&&c.t)||'')).toLowerCase();
  for(var k=0;k<state.watch.length;k++){var w=state.watch[k].toLowerCase();if(/^[a-z0-9.]{1,5}$/.test(w)){if(new RegExp('(^|[^a-z0-9])'+w.replace(/\./g,'\\.')+'($|[^a-z0-9])').test(t))return state.watch[k];}else if(t.indexOf(w)>=0)return state.watch[k];}return '';}
function inView(i,v){if(v==='watch')return !!watchHit(i);if(v==='hot')return isHot(i);if(v==='mid')return (i.score||0)>=6&&!i.dup_of;return true;}
function starList(){var k=state.q.toLowerCase();return Object.keys(state.stars).map(function(id){return byId(id)||state.stars[id]}).filter(function(i){return !k||(i.title+' '+(i.body||'')).toLowerCase().indexOf(k)>=0}).sort(function(a,b){return b.ts-a.ts});}
function visible(){return state.view==='star'?starList():base().filter(function(i){return inView(i,state.view)});}
function byId(id){for(var k=0;k<state.items.length;k++)if(state.items[k].id===id)return state.items[k];return state.stars[id]||null;}
function offCount(){return Object.keys(state.off).length}
function dedupe(list){var s={};return list.filter(function(i){var k=squash(cleanTitle(i.title)).slice(0,30);if(s[k])return false;s[k]=1;return true});}

/* ---------- 热门股票与多空情绪：都在浏览器里按标题算，不用 AI ---------- */
var TK=[['NVDA','Nvidia','nvidia|英伟达'],['AAPL','Apple','apple|苹果'],['MSFT','Microsoft','microsoft|微软'],['GOOGL','Alphabet','alphabet|google|谷歌'],['AMZN','Amazon','amazon|亚马逊'],
 ['META','Meta','\\bMeta\\b|Facebook|脸书',1],['TSLA','Tesla','tesla|特斯拉'],['AVGO','Broadcom','broadcom|博通'],['AMD','AMD','\\bAMD\\b|超威半导体',1],['INTC','Intel','\\bintel\\b|英特尔'],
 ['TSM','TSMC','tsmc|台积电'],['NFLX','Netflix','netflix|奈飞|网飞'],['ORCL','Oracle','oracle|甲骨文'],['PLTR','Palantir','palantir'],['JPM','JPMorgan','jpmorgan|jp morgan|摩根大通|小摩'],
 ['GS','Goldman Sachs','goldman|高盛'],['MS','Morgan Stanley','morgan stanley|摩根士丹利|大摩'],['BAC','Bank of America','bank of america|美国银行'],['BRK','Berkshire','berkshire|伯克希尔'],
 ['BA','Boeing','boeing|波音'],['XOM','Exxon','exxon|埃克森'],['CVX','Chevron','chevron|雪佛龙'],['WMT','Walmart','walmart|沃尔玛'],['DIS','Disney','disney|迪士尼'],['LLY','Eli Lilly','eli lilly|礼来'],
 ['PFE','Pfizer','pfizer|辉瑞'],['COIN','Coinbase','coinbase'],['MU','Micron','micron|美光'],['QCOM','Qualcomm','qualcomm|高通'],['SMCI','Super Micro','super micro|supermicro|超微电脑'],
 ['UBER','Uber','\\buber\\b|优步'],['SNY','Sanofi','sanofi|赛诺菲'],['INSM','Insmed','insmed'],
 ['2222','Aramco','aramco|沙特阿美|أرامكو'],['2010','SABIC','\\bsabic\\b|沙特基础工业|سابك'],['1120','Al Rajhi','al rajhi|alrajhi|الراجحي'],['7010','stc','\\bstc\\b|saudi telecom|الاتصالات السعودية'],
 ['1211','Maaden','ma.?aden|معادن'],['2082','ACWA Power','acwa|أكوا'],['1180','SNB','saudi national bank|\\bSNB\\b|البنك الأهلي']];
var TKX={};TK.forEach(function(t){t.re=new RegExp('(?:'+t[2]+')|\\$'+t[0]+'\\b|[(:]\\s*'+t[0]+'\\)',t[3]?'':'i');TKX[t[0]]=t;});
var CASH=/\$([A-Z]{2,5})\b|\((?:NASDAQ|NYSE|Nasdaq|NYSE American|TADAWUL)\s*:\s*([A-Z0-9.]{1,6})\)/g;
function tkRe(sym){return TKX[sym]?TKX[sym].re:new RegExp('\\$'+sym.replace(/\./g,'\\.')+'\\b|[(:]\\s*'+sym.replace(/\./g,'\\.')+'\\)');}
function tickers(list){var m={};
  list.forEach(function(i){var t=cleanTitle(i.title),u={};
    TK.forEach(function(k){if(k.re.test(t))u[k[0]]=k[1];});
    var x;CASH.lastIndex=0;while((x=CASH.exec(t))){var s=x[1]||x[2];if(!u[s]&&!TKX[s]&&!/^(USD|EUR|GBP|JPY|CNY|SAR|BTC|ETH|GDP|CPI|ETF|IPO|CEO)$/.test(s))u[s]='';}
    Object.keys(u).forEach(function(s){var o=m[s]=m[s]||{sym:s,name:u[s],n:0,hot:0};o.n++;if(isHot(i))o.hot++;});});
  return Object.keys(m).map(function(s){return m[s]}).filter(function(o){return o.n>=2}).sort(function(a,b){return b.n-a.n||b.hot-a.hot||(a.sym<b.sym?-1:1)}).slice(0,6);}
var BULL=/\b(surg\w+|soar\w*|jump\w*|rall(?:y|ies|ied)|gains?|rises?|rose|climb\w*|record high|beats?|upgrade[sd]?|boost\w*|rebound\w*|skyrocket\w*|buyback|tops|approv\w+|wins?|raises? (?:guidance|forecast|outlook|dividend))\b|大涨|上涨|飙升|暴涨|走高|新高|反弹|超预期|上调|回购|获批|利好|拉升|涨超|涨逾|涨近/gi;
var BEAR=/\b(plung\w+|slump\w*|tumbl\w+|falls?|fell|drops?|dropped|slid\w*|sinks?|sank|crash\w*|sell-?off|miss(?:es|ed)?|downgrade[sd]?|warn\w*|loss(?:es)?|layoffs?|bankrupt\w*|defaults?|probe|investigat\w+|lawsuit|sanction\w*|tariffs?|blacklist\w*|halt\w*|recall\w*|fraud|short sellers?|lows?|weak\w*|fears?|slash\w*|cuts? (?:guidance|forecast|outlook|jobs))\b|大跌|下跌|暴跌|跳水|走低|新低|下调|不及预期|裁员|破产|违约|调查|制裁|关税|黑名单|利空|跌超|跌逾|跌近|亏损|警告|做空/gi;
function mood(i){var t=cleanTitle(i.title),a=(t.match(BULL)||[]).length,b=(t.match(BEAR)||[]).length;return a>b?1:b>a?-1:0;}

/* ---------- 话题：统计标题里反复出现的专有名词 ---------- */
var STOP={};('the this that after with from will says new its and for not how why what but are has can could may over more here amid into than who was were his her their our your you they them just still also when where while about against between during before under near per via ' +
 'us ai ceo cfo ipo etf gdp pmi cpi eps gaap inc corp ltd plc llc co group holdings company capital global international bank stock stocks share shares market markets street wall billion trillion million first second third report reports analysts analyst ' +
 'monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december breaking update live watch exclusive factbox explainer opinion analysis ' +
 'reuters bloomberg cnbc wsj ft bbc ap nasdaq barron investing seeking alpha financialjuice newswire actual forecast previous flash rate rates interest probabilities president chief executive north south east west').split(' ').forEach(function(w){STOP[w]=1});
function topics(list){
  var cap={},low={},docs={};
  list.forEach(function(i){if(itemLang(i)!=='en')return;var ws=cleanTitle(i.title).split(/[^A-Za-z0-9&'’-]+/),u={};
    ws.forEach(function(w,n){w=w.replace(/['’]s$/,'');if(w.length<3||/\d/.test(w))return;var k=w.toLowerCase();if(STOP[k])return;
      if(/^[A-Z]/.test(w)){if(n>0)cap[k]=(cap[k]||0)+1;u[k]=w;}else low[k]=(low[k]||0)+1;});
    Object.keys(u).forEach(function(k){(docs[k]=docs[k]||{name:u[k],items:[]}).items.push(i)});});
  var ks=Object.keys(docs).filter(function(k){return docs[k].items.length>=4&&(cap[k]||0)>=3&&(low[k]||0)<=(cap[k]||0)*.15})
    .sort(function(a,b){return docs[b].items.length-docs[a].items.length}),pick=[];
  ks.forEach(function(k){if(pick.length>=3)return;var its=docs[k].items;
    var ov=pick.some(function(p){var n=its.filter(function(i){return p.items.indexOf(i)>=0}).length;return n/its.length>.45});
    if(!ov)pick.push(docs[k]);});
  return pick;
}

/* ---------- 渲染：小件 ---------- */
function chips(i,o){var h='';
  if(i.confirms>0)h+='<span class="cf">'+T('nSrc',i.confirms+1)+'</span>';
  if(o&&o.tr)h+='<span class="trb">'+T('translated')+'</span>';
  var w=watchHit(i);if(w)h+='<span class="wh">◆ '+esc(w)+'</span>';
  if(state.stars[i.id])h+='<span class="wh">★</span>';
  return h;}
function hits(i){var h='';if(i.hits)i.hits.split(' | ').forEach(function(x){if(x)h+='<span class="hit" dir="ltr">'+esc(x)+'</span>'});if(i.dup_of)h+='<span class="hit">'+T('merged')+'</span>';return h;}
function byline(i,o,noScore){return '<div class="by">'+(noScore?'':'<span class="sc s'+lvl(i)+'">'+fmtScore(i.score)+'</span>')+'<b>'+esc(shortSrc(i.source))+'</b><span class="num">'+hm(i.ts)+'</span>'+chips(i,o)+'</div>';}
function ring(i,cls){var s=i.score||0;return '<div class="ring'+(s>=8?'':' lo')+(cls||'')+'" style="--p:'+Math.round(s*10)+'"><span>'+fmtScore(i.score)+'</span></div>';}
function isZhText(s){return HAN.test(s)}

/* ---------- 渲染：简报 ---------- */
function hotList(b){
  var now=Date.now(),recent=b.filter(function(i){return i.ts>now-18*36e5});if(recent.length<8)recent=b;
  var hot=dedupe(recent.filter(isHot).sort(function(x,y){return y.score-x.score||y.confirms-x.confirms||y.ts-x.ts||(x.id<y.id?-1:1)}));
  if(!hot.length)hot=dedupe(recent.filter(function(i){return !i.dup_of&&i.score!=null}).sort(function(x,y){return y.score-x.score||y.ts-x.ts})).slice(0,12);
  return hot;
}
function briefHtml(b){
  var now=Date.now(),hot=hotList(b);
  if(!hot.length)return '';
  var hero=hot.filter(function(i){return cleanBody(i)})[0]||hot[0];if(hot[0].score-hero.score>1)hero=hot[0];
  var rest=hot.filter(function(i){return i!==hero}),ho=tx(hero,true),hb=ho.b!=null?ho.b:cleanBody(hero);
  var h='<div class="top"><article class="hero" data-id="'+esc(hero.id)+'"><div class="kick">'+T('lead')+' · '+T('scoreN',fmtScore(hero.score))+'</div>'+
    '<h2 dir="auto"'+(isZhText(ho.t)?' class="zh"':'')+'>'+hl(ho.t)+'</h2>'+(hb?'<p dir="auto">'+hl(hb.split('\n\n')[0])+'</p>':'')+
    '<div class="foot">'+ring(hero)+byline(hero,ho,true)+'</div></article>'+
    '<div class="rank"><h3>'+T('topToday')+'</h3>'+rest.slice(0,4).map(function(i,k){var o=tx(i);return '<article class="rk" data-id="'+esc(i.id)+'"><em class="num">'+(k+2)+'</em><div><h4 dir="auto">'+hl(o.t)+'</h4>'+byline(i,o)+'</div></article>'}).join('')+'</div></div>';
  // 12 小时统计：重要条数、和平常比、多空情绪、热门股票
  var win=dedupe(b.filter(function(i){return i.ts>now-12*36e5&&!i.dup_of})),tot=win.length,imp=win.filter(isHot).length,srcs={};win.forEach(function(i){srcs[i.source]=1});
  var st=state.stats,vs='<div class="vs"><strong>'+T('vsNone')+'</strong><div class="gauge"></div></div>';
  if(st&&st.windows){var w0=null,past=[];st.windows.forEach(function(w){if(w.k===0)w0=w;else if(st.now-w.k*864e5-432e5>=st.oldest&&(w.n||0)>=50)past.push(w.imp||0);});
    if(w0){imp=w0.imp||0;tot=Math.max(tot,w0.n||0);}
    if(past.length){var avg=past.reduce(function(x,y){return x+y},0)/past.length,r=avg>0?imp/avg:(imp?2:1),pc=Math.round(Math.abs(r-1)*100),up=r>=1.1,dn=r<=.9;
      vs='<div class="vs"><strong'+(up?' class="up"':'')+'>'+(up?T('vsUp',pc):dn?T('vsDown',pc):T('vsFlat'))+'</strong><div class="gauge"><i'+(up?' class="up"':'')+' style="inset-inline-start:'+Math.round(Math.max(0,Math.min(1,r/2))*100)+'%"></i></div><small>'+T('vsNote',past.length,Math.round(avg*10)/10)+'</small></div>';}}
  var ms=win.filter(function(i){return (i.score||0)>=5}).map(mood),bu=ms.filter(function(x){return x>0}).length,be=ms.filter(function(x){return x<0}).length,ne=ms.length-bu-be;
  var sen='<div class="sen"><div class="lbl" style="margin-bottom:8px">'+T('senti')+'</div>'+(bu+be?'<div class="hd"><span class="sbu">'+T('bull',bu)+'</span><span class="sbe">'+T('bear',be)+'</span></div><div class="split"><i class="sbu" style="flex-grow:'+bu+'"></i><i class="sne" style="flex-grow:'+Math.round(ne/4)+'"></i><i class="sbe" style="flex-grow:'+be+'"></i></div><small>'+T('sentiNote')+'</small>':'<small>'+T('sentiNone')+'</small>')+'</div>';
  h+='<div class="now"><div class="glass tile stat"><div class="lbl">'+T('last12')+'</div><b>'+imp+'</b><p>'+T('statLine',tot,Object.keys(srcs).length)+'</p>'+vs+sen+'</div>';
  var tks=tickers(win),tmx=tks.length?tks[0].n:1;
  h+='<div class="glass tile tk"><div class="lbl">'+T('tkTitle')+'</div>'+(tks.length?'<div class="sub">'+T('tkSub')+'</div>'+tks.map(function(o){
    return '<button class="tkr'+(o.hot?' h':'')+'" data-tk="'+esc(o.sym)+'"><b dir="ltr">'+esc(o.sym)+'</b><span dir="ltr">'+esc(o.name)+'</span><em class="num">'+o.n+'</em><u style="width:'+Math.max(8,Math.round(o.n/tmx*100))+'%"></u></button>'}).join(''):'<div class="sub" style="margin:0">'+T('tkNone')+'</div>')+'</div>';
  topics(b.filter(function(i){return i.ts>now-18*36e5})).slice(0,2).forEach(function(tp){
    var L=dedupe(tp.items.slice().sort(function(x,y){return (y.score||0)-(x.score||0)||y.ts-x.ts}));
    h+='<div class="glass tile topic"><div class="lbl">'+T('topic')+'</div><h3 data-topic="'+esc(tp.name)+'" role="button" tabindex="0" style="cursor:pointer"><bdi>'+esc(tp.name)+'</bdi><span>'+T('timeline')+'</span></h3><div class="cnt">'+T('topicCnt',tp.items.length,tp.items.filter(isHot).length)+'</div>'+
      L.slice(0,3).map(function(i){var o=tx(i);return '<div class="li" data-id="'+esc(i.id)+'"><span class="sc s'+lvl(i)+'">'+fmtScore(i.score)+'</span><div><span class="lt" dir="auto">'+esc(o.t)+'</span><small>'+esc(shortSrc(i.source))+' · <span class="num">'+hm(i.ts)+'</span></small></div></div>'}).join('')+'</div>';});
  h+='</div>';
  var more=rest.slice(4).sort(function(x,y){return y.ts-x.ts||(x.id<y.id?-1:1)}).slice(0,9),latest=b.slice(0,more.length>3?16:12);
  h+='<div class="low"><div>'+(more.length?'<div class="sec"><span>'+T('more')+'</span><button data-go="hot">'+T('viewAll')+'</button></div><div class="g3">'+more.map(function(i){var o=tx(i),bb=o.b!=null?o.b:(o.tr?'':cleanBody(i));
      return '<article class="card" data-id="'+esc(i.id)+'"><h4 dir="auto">'+hl(o.t)+'</h4>'+(bb?'<p dir="auto">'+esc(bb)+'</p>':'')+byline(i,o)+'</article>'}).join('')+'</div>':'')+'</div>'+
    '<div class="wire"><div class="sec"><span>'+T('wire')+'</span><button data-go="all">'+T('viewAll')+'</button></div>'+latest.map(function(i){var o=tx(i);
      return '<div class="w'+(isHot(i)?' h':'')+'" data-id="'+esc(i.id)+'"><time class="num">'+hm(i.ts)+'</time><div><span class="wt" dir="auto">'+hl(o.t)+'</span><small>'+esc(shortSrc(i.source))+' · '+T('pts',fmtScore(i.score))+'</small></div></div>'}).join('')+'</div></div>';
  return h;
}

/* ---------- 渲染：列表 ---------- */
function rowHtml(i){
  var L=lvl(i),hot=isHot(i),o=tx(i),x=chips(i,o)+hits(i);
  return '<article class="row'+(hot?' imp':L>=2?' m':'')+(state.sel===i.id?' sel':'')+(state.newIds[i.id]?' new':'')+'" data-id="'+esc(i.id)+'">'+
    '<time class="t num">'+hm(i.ts)+'</time><span class="sc s'+L+'">'+fmtScore(i.score)+'</span>'+
    '<div class="c"><span class="h" dir="auto">'+hl(o.t)+'</span>'+(x?'<span class="x">'+x+'</span>':'')+'</div>'+
    '<span class="src">'+esc(shortSrc(i.source))+'</span></article>';
}
function listHtml(v){
  var html='',last='',counts={},marked=false;v.forEach(function(i){var k=dayKey(i.ts);counts[k]=(counts[k]||0)+1});
  v.forEach(function(i,n){var k=dayKey(i.ts);
    if(k!==last){var l=dayLabel(i.ts);html+='<div class="day">'+l[0]+(l[1]?'<span>'+l[1]+'</span>':'')+'<span class="num" style="margin-inline-start:auto">'+T('items',counts[k])+'</span></div>';last=k;}
    if(!marked&&state.prevSeen&&i.seen_at<=state.prevSeen){marked=true;if(n>0)html+='<div class="seen">'+T('seenHere')+'</div>';}
    html+=rowHtml(i);});
  return html;
}
function detailHtml(i){
  var L=lvl(i),hot=isHot(i),u=fixUrl(i.url),o=tx(i,true),ob=cleanBody(i),b=o.b!=null?o.b:ob;
  var lv=hot?T('lvHot'):i.score==null?T('lvNone'):i.score>=8?T('lvHigh'):i.score>=5?T('lvMid'):T('lvLow');
  var by=i.score==null?T('byWait'):(i.score_by==='ai'?T('byAi'):T('byRule'))+(i.base_score!=null&&i.confirms>0&&i.base_score!==i.score?' · '+T('boost',fmtScore(i.base_score)):'');
  var body=b?'<div class="d-body" dir="auto">'+b.split('\n\n').map(function(p){return '<p>'+hl(p).replace(/\n/g,'<br>')+'</p>'}).join('')+'</div>':'<div class="d-none">'+T('noBody')+'</div>';
  return '<div class="d"><div class="d-top">'+ring(i)+'<div><div class="d-lv'+(hot?' hot':'')+'">'+lv+'</div><div class="d-by">'+by+'</div></div></div>'+
    '<h2 dir="auto">'+hl(o.t)+'</h2><div class="by"><b>'+esc(i.source)+'</b><span class="num" title="'+esc(new Date(i.ts).toLocaleString())+'">'+hm(i.ts)+'</span>'+chips(i,o)+hits(i)+'</div>'+body+
    (o.tr?'<div class="orig" dir="auto"><b>'+T('original')+'</b>'+esc(cleanTitle(i.title))+'</div>':'')+
    '<div class="d-act">'+(u?'<a class="btn pri" href="'+esc(u)+'" target="_blank" rel="noopener">'+T('open')+EXT+'</a>':'')+'<button class="btn'+(state.stars[i.id]?' on':'')+'" data-star="'+esc(i.id)+'">'+(state.stars[i.id]?'★ '+T('saved'):'☆ '+T('save'))+'</button><button class="btn" data-copy="'+esc(i.id)+'">'+T('share')+'</button></div></div>';
}
function renderSide(){
  var cnt={},names=[];state.items.forEach(function(i){if(!(i.source in cnt)){cnt[i.source]=0;names.push(i.source)}cnt[i.source]++});
  names.sort(function(a,b){return cnt[b]-cnt[a]||a.localeCompare(b)});
  var h='';
  GROUPS.forEach(function(g){
    var ns=names.filter(function(n){return groupOf(n)===g[0]});if(!ns.length)return;
    var tot=ns.reduce(function(a,n){return a+cnt[n]},0);
    h+='<button class="grp" data-g="'+g[0]+'">'+T(g[1])+'<span class="num">'+tot+'</span></button>';
    ns.forEach(function(n){var bad=state.health[n];
      h+='<button class="so'+(state.off[n]?'':' on')+'" data-s="'+esc(n)+'" role="checkbox" aria-checked="'+(state.off[n]?'false':'true')+'"><span class="bx">'+CHECK+'</span><span class="nm"><bdi>'+esc(shortSrc(n))+'</bdi></span>'+
        (/\(Bluesky\)/i.test(n)?'<span class="via">Bluesky</span>':'')+(bad?'<span class="bad" title="'+esc(T('fetchFail',bad))+'"></span>':'')+
        '<span class="only" data-only="'+esc(n)+'">'+T('only')+'</span><span class="num">'+cnt[n]+'</span></button>';});
  });
  $('srcs').innerHTML=h;
  $('swSound').setAttribute('aria-pressed',state.sound?'true':'false');
  var np=window.Notification?Notification.permission:'unsupported';
  $('swNotify').setAttribute('aria-pressed',(np==='granted'&&state.notify)?'true':'false');
  $('ntHint').textContent=np==='unsupported'?T('notifNo'):np==='denied'?T('notifDenied'):T('notifD');
  [].forEach.call($('theme').children,function(b){b.classList.toggle('on',b.dataset.t===state.theme)});
  $('wchips').innerHTML=state.watch.map(function(w,k){return '<button class="wc" data-w="'+k+'"><bdi>'+esc(w)+'</bdi> ×</button>'}).join('');
}
function renderTabs(b){
  var n={hot:0,mid:0,all:b.length};b.forEach(function(i){if(inView(i,'hot'))n.hot++;if(inView(i,'mid'))n.mid++;});
  $('nHot').textContent=n.hot;$('nMid').textContent=n.mid;$('nAll').textContent=n.all;
  $('nWatch').textContent=state.watch.length?b.filter(function(i){return inView(i,'watch')}).length:'';$('nStar').textContent=Object.keys(state.stars).length||'';
  [].forEach.call(document.querySelectorAll('.tab'),function(t){var on=t.dataset.v===state.view;t.classList.toggle('on',on);t.setAttribute('aria-selected',on?'true':'false')});
  var oc=offCount(),parts=[];
  if(oc)parts.push(T('hidden',oc));if(state.q)parts.push(esc(T('searching',state.q)));
  var fresh=state.prevSeen?state.items.filter(function(i){return i.seen_at>state.prevSeen&&isHot(i)}).length:0;
  $('sum').innerHTML=parts.length?'<span>'+parts.join(' · ')+'</span><button id="clr">'+T('clear')+'</button>':fresh?'<span>'+T('sinceVisit',fresh)+'</span>':'<span>'+T('loaded',state.items.length)+'</span>';
  $('fbtn').classList.toggle('has',oc>0);
}
function emptyHtml(){
  var filtered=offCount()||state.q;
  if(state.view==='star'&&!Object.keys(state.stars).length)return '<div class="empty"><b>'+T('sEmpty')+'</b>'+T('sEmptyD')+'</div>';
  if(state.view==='watch'&&!state.watch.length)return '<div class="empty"><b>'+T('wEmpty')+'</b>'+T('wEmptyD')+'<br><button class="btn" id="wgo">'+T('settings')+'</button></div>';
  if(state.view==='watch'&&!filtered)return '<div class="empty"><b>'+T('wNone')+'</b></div>';
  return !state.items.length?'<div class="empty"><b>'+T('eNone')+'</b>'+T('eNoneD')+'</div>'
    :filtered?'<div class="empty"><b>'+T('eFilter')+'</b>'+T('eFilterD')+'<br><button class="btn" id="clr2">'+T('clear')+'</button></div>'
    :'<div class="empty"><b>'+T('eScore')+'</b>'+T('eScoreD')+'</div>';
}
/* ---------- 动效：名次变化时平滑移位，新条目淡入，分数变化时轻轻一闪 ---------- */
var lastKey='';
function snap(){var m={},vh=window.innerHeight,n=0;[].forEach.call($('main').querySelectorAll('[data-id]'),function(el){
  if(n>120)return;var r=el.getBoundingClientRect();if(r.bottom<-400||r.top>vh+400)return;n++;
  var sc=el.querySelector('.sc,.ring span');m[el.dataset.id+'|'+el.classList[0]]={x:r.left,y:r.top,s:sc?sc.textContent:''};});return m;}
function play(prev){var ease='cubic-bezier(.2,.8,.2,1)',vh=window.innerHeight,n=0;
  [].forEach.call($('main').querySelectorAll('[data-id]'),function(el){
    if(n>120||!el.animate)return;var r=el.getBoundingClientRect();if(r.bottom<-400||r.top>vh+400)return;n++;
    var p=prev[el.dataset.id+'|'+el.classList[0]];
    if(!p){el.animate([{opacity:0,transform:'translateY(10px)'},{opacity:1,transform:'none'}],{duration:420,easing:ease});return;}
    var dx=p.x-r.left,dy=p.y-r.top;
    if(Math.abs(dx)+Math.abs(dy)>2)el.animate([{transform:'translate('+dx+'px,'+dy+'px)'},{transform:'none'}],{duration:480,easing:ease});
    var sc=el.querySelector('.sc,.ring span');
    if(sc&&p.s&&sc.textContent!==p.s){var t=sc.closest('.ring')||sc;t.animate([{transform:'scale(1)'},{transform:'scale(1.22)',boxShadow:'0 0 0 6px var(--red-soft)'},{transform:'scale(1)'}],{duration:900,easing:'ease-out'});}
  });}
function render(soft,gesture){
  var key=state.view+'|'+state.q+'|'+state.lang+'|'+offCount(),still=!!window.matchMedia&&window.matchMedia('(prefers-reduced-motion:reduce)').matches;
  var prev=(state.loaded&&!soft&&!still&&key===lastKey&&!document.hidden)?snap():null;lastKey=state.loaded?key:'';
  want=[];var b=base();renderTabs(b);if(!soft)renderSide();
  var html='';
  if(!state.loaded){for(var k=0;k<9;k++)html+='<div class="sk" style="width:'+(50+(k*37)%45)+'%"></div>';}
  else if(state.view==='brief'){html=briefHtml(b)||emptyHtml();}
  else{var v=state.view==='star'?starList():b.filter(function(i){return inView(i,state.view)});html=v.length?'<div class="list">'+listHtml(v.slice(0,state.shown))+(state.view==='star'?'':'<div class="morebox">'+(v.length>state.shown||!state.noMore?'<button class="btn" id="moreBtn"'+(state.older?' disabled':'')+'>'+T(state.older?'loading':'loadMore')+'</button>':'<span>'+T('noMore')+'</span>')+'</div>')+'</div>':(state.noMore||state.view==='star'||state.view==='watch'&&!state.watch.length?emptyHtml():emptyHtml()+'<div class="morebox"><button class="btn" id="moreBtn"'+(state.older?' disabled':'')+'>'+T(state.older?'loading':'loadMore')+'</button></div>');}
  $('main').innerHTML=html;state.newIds={};
  if(prev&&Object.keys(prev).length)play(prev);
  if(document.body.classList.contains('open-reader'))renderReader();
  setTop();if(want.length)pump(!!gesture);
}
function renderReader(){var i=state.sel&&byId(state.sel);if(i)$('rbody').innerHTML=detailHtml(i);}
function setTop(){document.documentElement.style.setProperty('--top',($('util').offsetHeight+$('tabs').offsetHeight)+'px');}
function applyI18n(){
  var r=document.documentElement;r.lang=state.lang==='zh'?'zh-CN':state.lang;r.dir=state.lang==='ar'?'rtl':'ltr';
  [].forEach.call(document.querySelectorAll('[data-i]'),function(e){e.textContent=T(e.dataset.i)});
  [].forEach.call(document.querySelectorAll('[data-ia]'),function(e){e.setAttribute('aria-label',T(e.dataset.ia));if(e.tagName==='INPUT')e.placeholder=T(e.dataset.ia);});
  $('winp').placeholder=T('wPh');
  [].forEach.call($('lang').children,function(b){b.classList.toggle('on',b.dataset.l===state.lang)});
  $('dateline').textContent=dateText(Date.now())+' · '+T('tag');renderClocks();
}

/* ---------- 市场时钟（常规交易时段，不含节假日） ---------- */
function mkt(tz,days,segs){
  var p={};try{new Intl.DateTimeFormat('en-US',{timeZone:tz,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).forEach(function(x){p[x.type]=x.value});}catch(e){return null;}
  var m=(+p.hour)*60+(+p.minute),st='mClosed';
  if(days.indexOf(p.weekday)>=0)segs.forEach(function(s){if(m>=s[0]&&m<s[1])st=s[2];});
  return {t:p.hour+':'+p.minute,st:st};
}
function renderClocks(){
  var a=mkt('America/New_York',['Mon','Tue','Wed','Thu','Fri'],[[240,570,'mPre'],[570,960,'mOpen'],[960,1200,'mPost']]);
  var b=mkt('Asia/Riyadh',['Sun','Mon','Tue','Wed','Thu'],[[600,900,'mOpen']]);
  function one(n,c){return c?'<span class="clk'+(c.st==='mOpen'?' open':'')+'" title="'+esc(T('mNote'))+'">'+T(n)+' <b class="num">'+c.t+'</b><em>'+T(c.st)+'</em></span>':'';}
  var h=one('ny',a)+one('ry',b);$('clocks').innerHTML=h;$('mclk').innerHTML=h;
}

/* ---------- 声音、通知、提示 ---------- */
function beep(){try{var a=new (window.AudioContext||window.webkitAudioContext)(),t=a.currentTime;[880,1320].forEach(function(f,k){var o=a.createOscillator(),g=a.createGain();o.type='sine';o.frequency.value=f;o.connect(g);g.connect(a.destination);g.gain.setValueAtTime(0,t+k*.14);g.gain.linearRampToValueAtTime(.16,t+k*.14+.02);g.gain.exponentialRampToValueAtTime(.001,t+k*.14+.22);o.start(t+k*.14);o.stop(t+k*.14+.25);});}catch(e){}}
function tip(s,ms){var el=$('tip');el.textContent=s;el.classList.add('show');clearTimeout(tip.t);tip.t=setTimeout(function(){el.classList.remove('show')},ms||2200);}
function showPill(){var n=state.pending.length,el=$('pill');if(!n){el.classList.remove('show');return;}
  var hot=state.pending.filter(isHot).length;el.classList.toggle('hot',hot>0);
  el.textContent=hot?T('newHot',hot):T('newAll',n);el.classList.add('show');}
function merge(){if(!state.pending.length)return;state.newIds={};if(!state.first)state.pending.forEach(function(i){state.newIds[i.id]=1});
  state.items=state.pending.concat(state.items).sort(function(a,b){return b.ts-a.ts}).slice(0,6000);state.pending=[];showPill();}

/* ---------- 数据 ---------- */
var unread=0;
async function load(){
  try{
    var r=await fetch(api('/api/items?limit=400&since='+(state.first?0:state.lastSeen)),{cache:'no-store'});
    if(!r.ok)throw new Error('HTTP '+r.status);
    var d=await r.json(),known={},changed=!state.loaded;
    state.items.forEach(function(x){known[x.id]=1});state.pending.forEach(function(x){known[x.id]=1});
    var fresh=d.items.filter(function(i){return !known[i.id]});
    // 已有条目可能后来被打分：用新数据覆盖
    var upd={};d.items.forEach(function(i){upd[i.id]=i});
    state.items=state.items.map(function(x){var u=upd[x.id];if(u&&(u.score!==x.score||u.important!==x.important||u.confirms!==x.confirms||u.dup_of!==x.dup_of||u.title_tr!==x.title_tr)){changed=true;return u;}return x;});
    state.pending=state.pending.map(function(x){return upd[x.id]||x});
    if(fresh.length){
      fresh.forEach(function(i){state.lastSeen=Math.max(state.lastSeen,i.seen_at)});
      state.pending=fresh.concat(state.pending);changed=true;
      if(!state.first){
        var hot=fresh.filter(isHot);
        if(hot.length){
          if(state.sound)beep();
          if(state.notify&&window.Notification&&Notification.permission==='granted')hot.slice(0,3).forEach(function(i){try{new Notification(cleanTitle(i.title),{body:i.source+' · '+fmtScore(i.score),tag:i.id})}catch(e){}});
          if(document.hidden){unread+=hot.length;document.title='('+unread+') Headline Watch';}
        }
      }
      // 正在往下读、或开着详情时不打断：新快讯先攒着，顶部出现提示
      if(state.first||(window.scrollY<140&&!document.body.classList.contains('open-reader'))){merge();}else{showPill();}
    }
    state.first=false;state.loaded=true;
    if(!document.hidden&&state.lastSeen>state.topSeen){state.topSeen=state.lastSeen;save();}
    if(changed)render();
    $('live').classList.remove('err');$('liveTxt').textContent=T('updated',hm(Date.now()));
  }catch(e){$('live').classList.add('err');$('liveTxt').textContent=T('fail');if(!state.loaded&&!state.items.length){$('main').innerHTML='<div class="empty"><b>'+T('eConn')+'</b>'+T('eConnD')+'</div>';}}
}
async function loadStats(){
  try{var r=await fetch(api('/api/stats'),{cache:'no-store'});if(!r.ok)return;state.stats=await r.json();if(state.view==='brief')render(true);}catch(e){}
}
// 第一次载入的 400 条不够覆盖 12 小时时，悄悄再取一页，让统计磁贴的数字是完整的
async function backfill(){
  if(state.filled||state.items.length<400)return;state.filled=true;var min=state.items[state.items.length-1].ts;if(min<Date.now()-12*36e5)return;
  try{var r=await fetch(api('/api/items?limit=500&before='+min),{cache:'no-store'});if(!r.ok)return;var d=await r.json(),have={};state.items.forEach(function(i){have[i.id]=1});
    state.items=state.items.concat((d.items||[]).filter(function(i){return !have[i.id]})).sort(function(a,b){return b.ts-a.ts}).slice(0,6000);render(true);}catch(e){}
}
async function loadHealth(){
  try{var r=await fetch(api('/api/status'),{cache:'no-store'});if(!r.ok)return;var d=await r.json(),h={};
    (d.sources||[]).forEach(function(s){if(s.last_error&&s.last_error_at&&(!s.last_ok||s.last_error_at>s.last_ok)){h[String(s.key).replace(/^[a-z]+:/,'')]=s.last_error;}});
    state.health=h;renderSide();}catch(e){}
}

/* ---------- 交互 ---------- */
function setView(v){state.view=v;state.shown=400;save();render();window.scrollTo({top:0});}
// 加载更早的快讯：先把已载入但没显示的显示出来，不够再向服务器要更早的一批
async function loadOlder(){
  if(state.older)return;var v=visible();
  if(v.length>state.shown){state.shown+=400;return render(true);}
  if(state.noMore||!state.items.length)return;
  state.older=true;render(true);
  try{
    var min=state.items[state.items.length-1].ts,r=await fetch(api('/api/items?limit=400&before='+min),{cache:'no-store'});
    if(!r.ok)throw new Error('HTTP '+r.status);
    var d=await r.json(),known={};state.items.forEach(function(x){known[x.id]=1});
    var add=d.items.filter(function(i){return !known[i.id]});
    if(d.items.length<400)state.noMore=true;
    if(add.length){state.items=state.items.concat(add).sort(function(a,b){return b.ts-a.ts}).slice(0,6000);state.shown+=400;}
  }catch(e){tip(T('fail'));}
  state.older=false;render(true);
}
function clearFilters(){state.off={};state.q='';$('q').value='';save();render();}
function panel(name,on){document.body.classList.remove('open-reader','open-side');if(on)document.body.classList.add('open-'+name);}
function openReader(id){state.sel=id;var old=document.querySelector('.row.sel');if(old)old.classList.remove('sel');
  var el=document.querySelector('.row[data-id="'+(window.CSS&&CSS.escape?CSS.escape(id):id)+'"]');if(el){el.classList.add('sel');el.scrollIntoView({block:'nearest'});}
  want=[];renderReader();$('reader').scrollTop=0;panel('reader',true);if(want.length)pump(false);}
function move(dir){if(state.view==='brief')return;var v=visible();if(!v.length)return;var k=-1;v.forEach(function(i,n){if(i.id===state.sel)k=n});
  k=Math.max(0,Math.min(v.length-1,k+dir));openReader(v[k].id);}
function applyTheme(){var r=document.documentElement;if(state.theme==='auto')r.removeAttribute('data-theme');else r.setAttribute('data-theme',state.theme);
  var dark=state.theme==='dark'||(state.theme==='auto'&&window.matchMedia('(prefers-color-scheme:dark)').matches);$('tc').setAttribute('content',dark?'#12100d':'#f5f0e6');}
function setLang(l,gesture){state.lang=l;trTok++;trs={};trBusy={};want=[];wantBody={};trStatus();trLoad();save();applyI18n();if(gesture)warm();render(false,gesture);$('liveTxt').textContent=T('updated',hm(Date.now()));}
function shareText(i){var o=tx(i,true),b=o.b!=null?o.b:(o.tr?'':cleanBody(i)),u=fixUrl(i.url),d=new Date(i.ts);
  var L=['【'+o.t+'】'];if(b)L.push(b.split('\n\n')[0]);if(o.tr)L.push(T('original')+': '+cleanTitle(i.title));
  L.push(T('src')+': '+shortSrc(i.source)+' · '+(d.getMonth()+1)+'/'+d.getDate()+' '+hm(i.ts)+' · '+T('scoreN',fmtScore(i.score))+(i.confirms>0?' · '+T('nSrc',i.confirms+1):''));if(u)L.push(u);return L.join('\n');}
function toggleStar(id){var i=byId(id);if(!i)return;if(state.stars[id])delete state.stars[id];else{var ks=Object.keys(state.stars);if(ks.length>=200)delete state.stars[ks[0]];state.stars[id]={id:i.id,source:i.source,title:i.title,body:i.body,url:i.url,ts:i.ts,seen_at:i.seen_at,score:i.score,score_by:i.score_by,base_score:i.base_score,important:i.important,confirms:i.confirms,hits:i.hits};}
  saveStars();render(true);}
function copyClick(e){var st=e.target.closest('[data-star]');if(st){toggleStar(st.dataset.star);return true;}
  var b=e.target.closest('[data-copy]');if(!b)return false;var i=byId(b.dataset.copy);if(!i)return true;var s=shareText(i);
  (navigator.clipboard?navigator.clipboard.writeText(s):Promise.reject()).then(function(){tip(T('shared'))},function(){tip(T('copyFail'))});return true;}

$('tabs').addEventListener('click',function(e){var t=e.target.closest('.tab');if(t)return setView(t.dataset.v);if(e.target.id==='clr')clearFilters();});
$('main').addEventListener('click',function(e){
  if(e.target.id==='clr2')return clearFilters();
  if(e.target.id==='moreBtn')return loadOlder();
  if(e.target.id==='wgo'){panel('side',true);return $('winp').focus();}
  var go=e.target.closest('[data-go]');if(go)return setView(go.dataset.go);
  var tkb=e.target.closest('[data-tk]');if(tkb){state.q='$'+tkb.dataset.tk;$('q').value=state.q;return setView('all');}
  var tp=e.target.closest('[data-topic]');if(tp){state.q=tp.dataset.topic;$('q').value=state.q;return setView('all');}
  if(window.getSelection&&String(window.getSelection()))return;
  var r=e.target.closest('[data-id]');if(r)openReader(r.dataset.id);});
$('main').addEventListener('keydown',function(e){if(e.key==='Enter'&&e.target.dataset&&e.target.dataset.topic)e.target.click();});
$('reader').addEventListener('click',copyClick);
$('rclose').onclick=$('sclose').onclick=$('scrim').onclick=function(){panel('',false)};
$('srcs').addEventListener('click',function(e){
  var o=e.target.closest('[data-only]');
  if(o){var keep=o.dataset.only,off={};state.items.forEach(function(i){if(i.source!==keep)off[i.source]=true});state.off=off;save();render();return;}
  var g=e.target.closest('.grp');
  if(g){var ns={};state.items.forEach(function(i){if(groupOf(i.source)===g.dataset.g)ns[i.source]=1});var names=Object.keys(ns),anyOn=names.some(function(n){return !state.off[n]});
    names.forEach(function(n){if(anyOn)state.off[n]=true;else delete state.off[n]});save();render();return;}
  var b=e.target.closest('.so');if(!b)return;var s=b.dataset.s;if(state.off[s])delete state.off[s];else state.off[s]=true;save();render();});
$('wform').onsubmit=function(e){e.preventDefault();var v=$('winp').value.split(/[,，、;；]+/).map(function(x){return x.trim()}).filter(Boolean);
  v.forEach(function(w){if(state.watch.length<40&&!state.watch.some(function(x){return x.toLowerCase()===w.toLowerCase()}))state.watch.push(w.slice(0,40))});$('winp').value='';save();render();};
$('wchips').onclick=function(e){var b=e.target.closest('[data-w]');if(!b)return;state.watch.splice(+b.dataset.w,1);save();render();};
$('allSrc').onclick=function(){state.off={};save();render();};
$('swSound').onclick=function(){state.sound=!state.sound;save();renderSide();if(state.sound)beep();};
$('swNotify').onclick=function(){
  if(!window.Notification)return tip(T('notifNo'));
  if(Notification.permission==='granted'){state.notify=!state.notify;save();renderSide();return;}
  if(Notification.permission==='denied')return tip(T('notifDenied'));
  Notification.requestPermission().then(function(p){state.notify=p==='granted';save();renderSide();});};
$('theme').onclick=function(e){var b=e.target.closest('button');if(!b)return;state.theme=b.dataset.t;save();applyTheme();renderSide();};
$('lang').onclick=function(e){var b=e.target.closest('button');if(b)setLang(b.dataset.l,true);};
$('trOn').onclick=function(){trStatus();warm();render(true,true);};
$('q').oninput=function(e){state.q=e.target.value.trim();if(state.q&&state.view==='brief')state.view='all';render();};
$('sbtn').onclick=function(){$('util').classList.add('searching');$('q').focus();};
$('cancel').onclick=function(){$('util').classList.remove('searching');if(state.q){state.q='';$('q').value='';render();}};
$('fbtn').onclick=function(){panel('side',true)};
$('pill').onclick=function(){merge();render();window.scrollTo({top:0,behavior:'smooth'});};
window.addEventListener('scroll',function(){if(state.pending.length&&window.scrollY<140&&!document.body.classList.contains('open-reader')){merge();render();}},{passive:true});
document.addEventListener('keydown',function(e){
  if(e.metaKey||e.ctrlKey||e.altKey)return;
  if(show.on){if(e.key==='Escape')showClose();else if(e.key==='ArrowRight'||e.key==='ArrowDown')showGo(1);else if(e.key==='ArrowLeft'||e.key==='ArrowUp')showGo(-1);else if(e.key===' '){show.paused=!show.paused;$('show').classList.toggle('paused',show.paused);}e.preventDefault();return;}
  var typing=/^(INPUT|TEXTAREA)$/.test((e.target.tagName||''));
  if(e.key==='Escape'){if(document.body.className.indexOf('open-')>=0)return panel('',false);if(typing){e.target.blur();if(state.q){state.q='';$('q').value='';render();}$('util').classList.remove('searching');}return;}
  if(typing)return;
  if(e.key==='/'){e.preventDefault();$('util').classList.add('searching');$('q').focus();}
  else if(e.key==='j'||e.key==='ArrowDown'){if(state.view!=='brief'){e.preventDefault();move(1);}}
  else if(e.key==='k'||e.key==='ArrowUp'){if(state.view!=='brief'){e.preventDefault();move(-1);}}
  else if(e.key==='Enter'||e.key==='o'){var i=state.sel&&document.body.classList.contains('open-reader')&&byId(state.sel),u=i&&fixUrl(i.url);if(u)window.open(u,'_blank','noopener');}
  else if(e.key==='s'){if(state.sel&&document.body.classList.contains('open-reader'))toggleStar(state.sel);}
  else if(e.key==='p')showOpen();
  else if(e.key==='1')setView('brief');else if(e.key==='2')setView('hot');else if(e.key==='3')setView('mid');else if(e.key==='4')setView('all');else if(e.key==='5')setView('watch');else if(e.key==='6')setView('star');
});
/* ---------- 展示模式：全屏大字轮播最重要的几条 ---------- */
var show={on:false,k:0,list:[],paused:false,t:0};
function showRender(){
  var el=$('showBody');if(!show.list.length){el.innerHTML='<h1>'+T('pEmpty')+'</h1>';$('showN').textContent='';return;}
  want=[];var i=show.list[show.k%show.list.length],o=tx(i,true),b=o.b!=null?o.b:(o.tr?'':cleanBody(i));
  el.innerHTML='<div class="kick">'+(show.k===0?T('lead'):T('topToday'))+(i.confirms>0?' · '+T('nSrc',i.confirms+1):'')+'</div><h1 dir="auto"'+(isZhText(o.t)?' class="zh"':'')+'>'+esc(o.t)+'</h1>'+(b?'<p dir="auto">'+esc(b.split('\n\n')[0])+'</p>':'')+
    '<div class="foot">'+ring(i)+'<div class="by"><b>'+esc(shortSrc(i.source))+'</b><span class="num">'+hm(i.ts)+'</span></div></div>';
  $('showN').textContent=(show.k%show.list.length+1)+' / '+show.list.length;
  var bar=$('showBar');bar.style.animation='none';void bar.offsetWidth;bar.style.animation='';
  if(want.length)pump(false);
}
function showGo(d){var n=show.list.length||1;show.k=(show.k+d+n)%n;showRender();clearInterval(show.t);show.t=setInterval(showTick,12000);}
function showTick(){if(!show.paused){show.list=hotList(base()).slice(0,8);show.k++;showRender();}}
function showOpen(){show.on=true;show.k=0;show.paused=false;show.list=hotList(base()).slice(0,8);panel('',false);document.body.classList.add('showing');$('show').classList.remove('paused');showRender();
  clearInterval(show.t);show.t=setInterval(showTick,12000);var r=document.documentElement;try{(r.requestFullscreen||r.webkitRequestFullscreen||function(){}).call(r)}catch(e){}}
function showClose(){show.on=false;clearInterval(show.t);document.body.classList.remove('showing');try{if(document.fullscreenElement)document.exitFullscreen()}catch(e){}}
$('pbtn').onclick=showOpen;$('showX').onclick=showClose;
$('show').addEventListener('click',function(e){if(e.target.closest('#showX'))return;var w=window.innerWidth,x=e.clientX;showGo((x<w*.3)===(document.documentElement.dir!=='rtl')?-1:1);});
document.addEventListener('fullscreenchange',function(){if(!document.fullscreenElement&&show.on)showClose();});
document.addEventListener('visibilitychange',function(){if(!document.hidden){unread=0;document.title='Headline Watch';load();}});
window.addEventListener('resize',setTop);
trLoad();applyTheme();applyI18n();render();load().then(backfill);loadHealth();loadStats();setInterval(loadStats,3e5);
setInterval(load,15000);setInterval(renderClocks,20000);setInterval(loadHealth,300000);
`;

const ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%23f5f0e6'/%3E%3Cpath d='M9 8v16M23 8v16M9 16h14' stroke='%231a1714' stroke-width='3.4'/%3E%3Ccircle cx='25.5' cy='6.5' r='3.5' fill='%23c8371d'/%3E%3C/svg%3E";

const X = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m2 2 10 10M12 2 2 12"/></svg>';

const BODY = `
<div class="bg"></div>
<header class="util" id="util"><div class="wrap">
  <div class="live" id="live" role="status"><b></b><strong data-i="live"></strong><span id="liveTxt"></span></div>
  <div class="clocks" id="clocks"></div>
  <div class="sp"></div>
  <span class="trs" id="trs"></span><button class="trs" id="trOn"></button>
  <label class="sbox"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="q" type="search" autocomplete="off" data-ia="search"></label>
  <button class="cancel" id="cancel" data-i="cancel"></button>
  <button class="ib" id="sbtn" data-ia="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></button>
  <div class="lang" id="lang"><button data-l="zh">中文</button><button data-l="en">EN</button><button data-l="ar">ع</button></div>
  <button class="ib" id="pbtn" data-ia="present"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg></button>
  <button class="ib" id="fbtn" data-ia="settings"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg></button>
</div></header>
<div class="mast wrap"><h1>Headline Watch</h1><p id="dateline"></p></div>
<nav class="tabs" id="tabs"><div class="wrap"><div role="tablist">
  <button class="tab" data-v="brief" role="tab"><span data-i="brief"></span></button>
  <button class="tab" data-v="hot" role="tab"><span data-i="hot"></span><i class="num" id="nHot">0</i></button>
  <button class="tab" data-v="mid" role="tab"><span data-i="mid"></span><i class="num" id="nMid">0</i></button>
  <button class="tab" data-v="all" role="tab"><span data-i="all"></span><i class="num" id="nAll">0</i></button>
  <span class="tsep"></span>
  <button class="tab" data-v="watch" role="tab"><span data-i="watch"></span><i class="num" id="nWatch"></i></button>
  <button class="tab" data-v="star" role="tab"><span data-i="star"></span><i class="num" id="nStar"></i></button>
  <div class="sum" id="sum"></div>
</div></div></nav>
<main class="wrap" id="main"></main>
<div class="scrim" id="scrim"></div>
<section class="panel glass" id="reader" aria-live="polite"><div class="px"><span data-i="detail"></span><button id="rclose" aria-label="Close">${X}</button></div><div id="rbody"></div></section>
<aside class="panel glass" id="side"><div class="px"><span data-i="settings"></span><button id="sclose" aria-label="Close">${X}</button></div>
  <div class="mclk" id="mclk"></div>
  <div class="sh"><span data-i="wTitle"></span></div>
  <form class="wform" id="wform"><input id="winp" autocomplete="off" maxlength="80"><button class="btn" data-i="add"></button></form>
  <div class="wchips" id="wchips"></div><p class="whint" data-i="wHint"></p>
  <div class="sh"><span data-i="sources"></span><button id="allSrc" data-i="selAll"></button></div>
  <div id="srcs"></div>
  <div class="sh"><span data-i="alerts"></span></div>
  <div class="set"><div><span data-i="sound"></span><small data-i="soundD"></small></div><button class="sw" id="swSound" data-ia="sound" aria-pressed="true"></button></div>
  <div class="set"><div><span data-i="notif"></span><small id="ntHint"></small></div><button class="sw" id="swNotify" data-ia="notif" aria-pressed="false"></button></div>
  <div class="sh"><span data-i="look"></span></div>
  <div class="set"><div data-i="theme"></div><div class="seg" id="theme"><button data-t="auto" data-i="tAuto"></button><button data-t="dark" data-i="tDark"></button><button data-t="light" data-i="tLight"></button></div></div>
  <div class="keysec"><div class="sh"><span data-i="keys"></span></div>
  <div class="keys"><span><kbd>J</kbd><kbd>K</kbd><span data-i="kMove"></span></span><span><kbd>Enter</kbd><span data-i="kOpen"></span></span><span><kbd>/</kbd><span data-i="kSearch"></span></span><span><kbd>1</kbd>–<kbd>6</kbd><span data-i="kView"></span></span><span><kbd>S</kbd><span data-i="kStar"></span></span><span><kbd>P</kbd><span data-i="kShow"></span></span></div></div>
</aside>
<section class="show" id="show"><div class="show-top"><b>Headline Watch</b><span class="num" id="showN"></span><span class="sp"></span><span data-i="pHint"></span><button id="showX" aria-label="Close">${X}</button></div>
  <div class="show-body" id="showBody"></div><div class="show-bar"><i id="showBar"></i></div></section>
<button class="pill" id="pill"></button>
<div class="tip" id="tip" role="status"></div>
`;

export function renderPage({ key }) {
  // key 来自网址参数，转义尖括号和行分隔符，避免提前结束 <script>
  const seps = new RegExp('[' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');
  const safeKey = JSON.stringify(String(key || '')).replace(/</g, '\\' + 'u003c').replace(seps, '');
  return `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" id="tc" content="#f5f0e6">
<title>Headline Watch</title>
<link rel="icon" href="${ICON}">
<script>try{var t=JSON.parse(localStorage.getItem('hw')||'{}').theme;if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t)}catch(e){}</script>
<style>${CSS}</style></head><body>${BODY}<script>
var KEY=${safeKey};${JS}</script></body></html>`;
}

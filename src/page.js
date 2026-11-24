// 网页看板。页面开着时每 15 秒刷新；有新的重要快讯会响一声，可选弹出浏览器通知。
// 版式：顶栏（状态、市场时钟、搜索）+ 左侧来源筛选 + 中间快讯流 + 右侧详情（宽屏）。
// 手机上左侧栏变成底部抽屉，详情在列表里就地展开。
// 注意：CSS 和 JS 用 String.raw 写成模板字符串，里面不要出现反引号和 ${}。

const CSS = String.raw`
:root{
  --bg:#0a0b0d;--panel:#0e1013;--raise:#15181d;--hover:#12151a;--sel:#171b21;--line:#1b1f25;--line2:#2b3039;
  --fg:#eceef1;--fg2:#b7bdc7;--fg3:#858d99;--fg4:#5b636f;
  --amber:#f5a623;--amber-fill:#f5a623;--amber-ink:#1a1204;--amber-bg:rgba(245,166,35,.06);--amber-line:rgba(245,166,35,.34);
  --ok:#3ecf8e;--err:#f0616d;--info:#6aa9ff;--mark:rgba(245,166,35,.28);
  --shadow:0 18px 50px rgba(0,0,0,.55);
  --mono:"SF Mono",ui-monospace,SFMono-Regular,"JetBrains Mono",Menlo,Consolas,monospace;
  --sans:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Segoe UI",Roboto,"Helvetica Neue",sans-serif;
  --top:93px;
}
@media (prefers-color-scheme:light){:root:not([data-theme=dark]){
  --bg:#f6f6f3;--panel:#fbfbf9;--raise:#ffffff;--hover:#efefeb;--sel:#eaeae5;--line:#e5e4de;--line2:#d2d0c8;
  --fg:#101317;--fg2:#373d46;--fg3:#68707c;--fg4:#99a0aa;
  --amber:#a55600;--amber-fill:#f2a51f;--amber-ink:#241500;--amber-bg:rgba(214,130,0,.07);--amber-line:rgba(190,110,0,.4);
  --ok:#0e9460;--err:#cf3946;--info:#2c6ccf;--mark:rgba(242,165,31,.38);
  --shadow:0 18px 50px rgba(30,30,20,.18);
}}
:root[data-theme=light]{
  --bg:#f6f6f3;--panel:#fbfbf9;--raise:#ffffff;--hover:#efefeb;--sel:#eaeae5;--line:#e5e4de;--line2:#d2d0c8;
  --fg:#101317;--fg2:#373d46;--fg3:#68707c;--fg4:#99a0aa;
  --amber:#a55600;--amber-fill:#f2a51f;--amber-ink:#241500;--amber-bg:rgba(214,130,0,.07);--amber-line:rgba(190,110,0,.4);
  --ok:#0e9460;--err:#cf3946;--info:#2c6ccf;--mark:rgba(242,165,31,.38);
  --shadow:0 18px 50px rgba(30,30,20,.18);
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-padding-top:calc(var(--top) + 34px)}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 var(--sans);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
a{color:inherit;text-decoration:none}
button,input{font:inherit;color:inherit}
button{cursor:pointer;-webkit-tap-highlight-color:transparent}
:focus{outline:none}
:focus-visible{outline:2px solid var(--amber);outline-offset:2px;border-radius:4px}
.num{font-family:var(--mono);font-variant-numeric:tabular-nums;letter-spacing:-.02em}
mark{background:var(--mark);color:inherit;border-radius:2px;padding:0 1px}

/* ---------- 顶栏 ---------- */
.hd{position:sticky;top:0;z-index:20;background:var(--bg);border-bottom:1px solid var(--line);padding-top:env(safe-area-inset-top)}
.hd-in{height:48px;display:flex;align-items:center;gap:16px;padding:0 16px}
.brand{display:flex;align-items:center;gap:9px;font:700 12.5px/1 var(--sans);letter-spacing:.14em;white-space:nowrap}
.brand i{width:9px;height:9px;background:var(--amber-fill);border-radius:1.5px;display:block}
.brand span{color:var(--fg3);font-weight:500}
.live{display:inline-flex;align-items:center;gap:7px;font-size:12px;color:var(--fg3);white-space:nowrap}
.live b{width:6px;height:6px;border-radius:50%;background:var(--ok);animation:pulse 2.4s infinite}
.live.err{color:var(--err)}.live.err b{background:var(--err);animation:none}
@keyframes pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--ok) 60%,transparent)}70%{box-shadow:0 0 0 6px transparent}100%{box-shadow:0 0 0 0 transparent}}
.clocks{display:flex;gap:18px;font-size:12px;color:var(--fg3);white-space:nowrap}
.clk{display:inline-flex;align-items:center;gap:6px}
.clk .num{color:var(--fg2)}
.clk em{font-style:normal;font-size:11px;padding:1px 5px;border-radius:3px;border:1px solid var(--line2);color:var(--fg3)}
.clk.open em{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 40%,transparent)}
.sp{flex:1}
.sbox{position:relative;width:260px;max-width:34vw}
.sbox svg{position:absolute;left:10px;top:50%;transform:translateY(-50%);width:14px;height:14px;color:var(--fg4);pointer-events:none}
.sbox input{width:100%;height:32px;border:1px solid var(--line);background:var(--panel);border-radius:6px;padding:0 34px 0 31px;font-size:13px;-webkit-appearance:none;appearance:none}
.sbox input::placeholder{color:var(--fg4)}
.sbox input::-webkit-search-cancel-button{-webkit-appearance:none}
.sbox input:focus{border-color:var(--amber-line);background:var(--raise)}
.sbox kbd{position:absolute;right:8px;top:50%;transform:translateY(-50%);font:500 11px/1 var(--mono);color:var(--fg4);border:1px solid var(--line2);border-radius:4px;padding:3px 5px}
.sbox input:focus~kbd,.sbox input:not(:placeholder-shown)~kbd{display:none}
.ib{display:none;position:relative;width:36px;height:36px;border:0;background:transparent;border-radius:8px;color:var(--fg2);place-items:center}
.ib:active{background:var(--hover)}
.ib svg{width:19px;height:19px}
.ib.has::after{content:"";position:absolute;top:7px;right:7px;width:7px;height:7px;border-radius:50%;background:var(--amber-fill);box-shadow:0 0 0 2px var(--bg)}
.cancel{display:none;border:0;background:transparent;color:var(--fg2);font-size:14px;padding:6px 2px 6px 4px;white-space:nowrap}

/* ---------- 视图切换 ---------- */
.tabs{position:sticky;top:calc(49px + env(safe-area-inset-top));z-index:19;background:var(--bg);border-bottom:1px solid var(--line);display:flex;align-items:stretch;gap:4px;padding:0 16px;height:44px}
.tab{position:relative;border:0;background:transparent;color:var(--fg3);font-size:13.5px;font-weight:500;padding:0 12px;display:inline-flex;align-items:center;gap:7px;white-space:nowrap}
.tab:first-child{margin-left:-12px}
.tab .num{font-size:11.5px;color:var(--fg4)}
.tab:hover{color:var(--fg2)}
.tab:focus-visible{outline-offset:-6px}
.tab.on{color:var(--fg);font-weight:600}
.tab.on .num{color:var(--fg3)}
.tab.on::after{content:"";position:absolute;left:12px;right:12px;bottom:-1px;height:2px;background:var(--amber-fill)}
.sum{margin-left:auto;display:flex;align-items:center;gap:10px;font-size:12px;color:var(--fg3);white-space:nowrap}
.sum button{border:0;background:transparent;color:var(--amber);font-size:12px;padding:4px 0}
.sum button:hover{text-decoration:underline}

/* ---------- 三栏 ---------- */
.cols{display:grid;grid-template-columns:232px minmax(0,1fr);align-items:start}
.side{position:sticky;top:var(--top);height:calc(100vh - var(--top));height:calc(100dvh - var(--top));overflow-y:auto;border-right:1px solid var(--line);padding:6px 0 20px;scrollbar-width:thin;scrollbar-color:var(--line2) transparent}
.pane{display:none}
@media (min-width:1240px){
  .cols{grid-template-columns:232px minmax(0,1fr) minmax(360px,30vw)}
  .pane{display:block;position:sticky;top:var(--top);height:calc(100vh - var(--top));overflow-y:auto;border-left:1px solid var(--line);background:var(--panel);scrollbar-width:thin;scrollbar-color:var(--line2) transparent}
}

/* 侧栏 */
.sh{display:flex;align-items:center;justify-content:space-between;padding:14px 16px 6px;font-size:11px;font-weight:600;letter-spacing:.1em;color:var(--fg4)}
.sh button{border:0;background:transparent;color:var(--fg3);font-size:11.5px;letter-spacing:0;font-weight:500;padding:2px 0}
.sh button:hover{color:var(--amber)}
.grp{display:flex;align-items:center;width:100%;border:0;background:transparent;padding:9px 16px 4px;font-size:11.5px;color:var(--fg3);font-weight:600;text-align:left;gap:6px}
.grp:hover{color:var(--fg)}
.grp .num{margin-left:auto;font-weight:400;color:var(--fg4);font-size:11px}
.so{display:flex;align-items:center;gap:9px;width:100%;border:0;background:transparent;padding:5px 16px;font-size:13px;color:var(--fg2);text-align:left;min-height:30px}
.so:hover{background:var(--hover);color:var(--fg)}
.so .bx{flex:none;width:13px;height:13px;border-radius:3px;border:1px solid var(--fg4);display:grid;place-items:center;background:transparent}
.so .bx svg{width:9px;height:9px;color:var(--amber-ink);opacity:0}
.so.on .bx{background:var(--amber-fill);border-color:var(--amber-fill)}
.so.on .bx svg{opacity:1}
.so:not(.on){color:var(--fg4)}
.so .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.so .via{font-size:10px;color:var(--fg4);border:1px solid var(--line2);border-radius:3px;padding:0 4px;line-height:14px;flex:none}
.so .bad{width:6px;height:6px;border-radius:50%;background:var(--err);flex:none}
.so .only{margin-left:auto;font-size:11px;color:var(--amber);display:none;flex:none}
.so .num{margin-left:auto;font-size:11px;color:var(--fg4);flex:none}
@media (hover:hover){.so:hover .only{display:inline}.so:hover .only+.num{display:none}}
.set{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 16px;font-size:13px;color:var(--fg2);min-height:34px}
.set small{display:block;font-size:11px;color:var(--fg4);line-height:1.35}
.sw{flex:none;width:32px;height:18px;border-radius:9px;border:0;background:var(--line2);position:relative;transition:background .15s}
.sw::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--fg3);transition:transform .15s,background .15s}
.sw[aria-pressed=true]{background:var(--amber-fill)}
.sw[aria-pressed=true]::after{transform:translateX(14px);background:var(--amber-ink)}
.seg{display:inline-flex;border:1px solid var(--line2);border-radius:6px;overflow:hidden;flex:none}
.seg button{border:0;background:transparent;font-size:12px;color:var(--fg3);padding:4px 9px}
.seg button+button{border-left:1px solid var(--line2)}
.seg button.on{background:var(--sel);color:var(--fg);font-weight:600}
.keys{padding:4px 16px;font-size:11.5px;color:var(--fg4);line-height:2}
.keys kbd{font:500 10.5px/1 var(--mono);border:1px solid var(--line2);border-radius:3px;padding:2px 4px;color:var(--fg3);margin-right:2px}
.keys span{margin-right:10px;white-space:nowrap;display:inline-block}
.shd{display:none}

/* ---------- 快讯流 ---------- */
.feed{min-height:60vh;padding-bottom:80px}
.day{position:sticky;top:var(--top);z-index:3;background:var(--bg);border-bottom:1px solid var(--line);padding:7px 16px;font-size:11.5px;color:var(--fg3);font-weight:600;letter-spacing:.04em;display:flex;gap:8px}
.day span{font-weight:400;color:var(--fg4)}
.row{position:relative;display:grid;grid-template-columns:44px 34px minmax(0,1fr) auto;column-gap:12px;align-items:baseline;padding:8px 16px;border-bottom:1px solid var(--line);cursor:pointer}
.row .t{color:var(--fg3);font-size:12.5px}
.row .s{justify-self:center;min-width:32px;text-align:center;font-size:11.5px;font-weight:600;line-height:18px;border-radius:3px;color:var(--fg4)}
.row .s.s2{color:var(--fg2);box-shadow:inset 0 0 0 1px var(--line2)}
.row .s.s3{background:var(--amber-fill);color:var(--amber-ink);font-weight:700}
.row .c{min-width:0}
.row .h{color:var(--fg3);font-size:14px;line-height:1.5;word-break:break-word}
.row.m .h{color:var(--fg2)}
.row.imp .h{color:var(--fg);font-weight:600}
.row.imp .t{color:var(--amber)}
.row.imp::before{content:"";position:absolute;left:0;top:0;bottom:0;width:2px;background:var(--amber-fill)}
.row.imp{background:var(--amber-bg)}
.v-hot .row.imp{background:transparent}.v-hot .row.imp::before{display:none}
.row .src{font-size:12px;color:var(--fg3);white-space:nowrap;max-width:150px;overflow:hidden;text-overflow:ellipsis;text-align:right}
.chip{display:inline-block;vertical-align:1px;margin-left:8px;font-size:11px;line-height:16px;padding:0 5px;border-radius:3px;white-space:nowrap;font-weight:500}
.chip.cf{color:var(--info);background:color-mix(in srgb,var(--info) 13%,transparent)}
.chip.hit{font-family:var(--mono);letter-spacing:-.02em;color:var(--fg3);box-shadow:inset 0 0 0 1px var(--line2)}
.row.imp .chip.hit{color:var(--amber);box-shadow:inset 0 0 0 1px var(--amber-line)}
.chip.dup{color:var(--fg4);box-shadow:inset 0 0 0 1px var(--line2)}
@media (hover:hover){.row:hover,.v-hot .row.imp:hover{background:var(--hover)}.row.imp:hover{background:color-mix(in srgb,var(--amber-fill) 10%,var(--bg))}}
.row.new{animation:flash 2.6s ease-out}
@keyframes flash{0%{background:color-mix(in srgb,var(--amber-fill) 26%,transparent)}}
.exp{display:none}
.row.sel .exp{display:block;cursor:auto}
@media (min-width:1240px){
  .row.sel,.v-hot .row.sel.imp{background:var(--sel)}
  .row.sel.imp{background:color-mix(in srgb,var(--amber-fill) 13%,var(--bg))}
  .v-hot .row.sel.imp{background:var(--sel)}
  .row.sel::after{content:"";position:absolute;right:-1px;top:0;bottom:0;width:2px;background:var(--fg2)}
  .row.sel .exp{display:none}
}

/* 详情（右侧面板与就地展开共用） */
.d{padding:22px 24px 40px}
.exp .d{padding:12px 0 6px}
.d-top{display:flex;align-items:center;gap:14px;margin-bottom:18px}
.d-sc{flex:none;width:58px;height:58px;border-radius:6px;display:grid;place-items:center;font:700 23px/1 var(--mono);letter-spacing:-.04em;color:var(--fg2);box-shadow:inset 0 0 0 1px var(--line2)}
.d-sc.s3{background:var(--amber-fill);color:var(--amber-ink);box-shadow:none}
.d-sc.s1{color:var(--fg4)}
.d-lv{font-size:13px;font-weight:600;color:var(--fg)}
.d-lv.hot{color:var(--amber)}
.d-by{font-size:12px;color:var(--fg3);margin-top:2px}
.bar{display:flex;gap:2px;margin-top:7px}
.bar i{width:11px;height:3px;background:var(--line2);border-radius:1px}
.bar i.f{background:var(--fg3)}
.bar.hot i.f{background:var(--amber-fill)}
.d h2{margin:0 0 12px;font-size:20px;line-height:1.38;font-weight:650;letter-spacing:-.01em;word-break:break-word}
.d-meta{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12.5px;color:var(--fg3);margin-bottom:14px}
.d-meta b{color:var(--fg2);font-weight:600}
.d-meta .chip{margin-left:0}
.d-body{font-size:14.5px;line-height:1.72;color:var(--fg2);word-break:break-word}
.d-body p{margin:0 0 10px}
.d-none{font-size:13px;color:var(--fg4)}
.d-act{display:flex;gap:8px;margin-top:18px;flex-wrap:wrap}
.btn{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 13px;border-radius:6px;border:1px solid var(--line2);background:transparent;font-size:13px;font-weight:500;color:var(--fg2)}
.btn:hover{border-color:var(--fg4);color:var(--fg)}
.btn.pri{background:var(--fg);border-color:var(--fg);color:var(--bg);font-weight:600}
.btn.pri:hover{opacity:.88;color:var(--bg)}
.btn svg{width:13px;height:13px}
.pane .blank{height:100%;display:grid;place-items:center;color:var(--fg4);font-size:13px;text-align:center;padding:30px}
.exp .d-top{margin-bottom:10px}.exp .d-sc{width:42px;height:42px;font-size:17px}.exp h2,.exp .d-meta{display:none}.exp .d-body,.exp .d-none{margin-top:2px}.exp .d-act{margin-top:12px}

/* 状态 */
.empty{text-align:center;color:var(--fg3);padding:90px 24px;font-size:13px}
.empty b{display:block;color:var(--fg);font-size:15px;margin-bottom:6px;font-weight:600}
.empty button{margin-top:16px}
.sk{display:grid;grid-template-columns:44px 34px 1fr;column-gap:12px;padding:11px 16px;border-bottom:1px solid var(--line)}
.sk i{height:12px;border-radius:3px;background:var(--line);animation:sk 1.3s ease-in-out infinite alternate}
@keyframes sk{to{opacity:.4}}
.pill{position:fixed;left:50%;top:calc(var(--top) + 12px);transform:translate(-50%,-90px);z-index:15;border:0;border-radius:999px;background:var(--fg);color:var(--bg);font-size:13px;font-weight:600;padding:8px 15px;box-shadow:var(--shadow);transition:transform .22s cubic-bezier(.2,.8,.2,1);white-space:nowrap}
.pill.show{transform:translate(-50%,0)}
.pill.hot{background:var(--amber-fill);color:var(--amber-ink)}
.tip{position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:40;background:var(--fg);color:var(--bg);font-size:13px;padding:8px 14px;border-radius:6px;opacity:0;pointer-events:none;transition:opacity .2s;max-width:86vw;text-align:center}
.tip.show{opacity:1}
.scrim{display:none}

/* ---------- 窄屏：侧栏变抽屉 ---------- */
@media (max-width:959px){
  .cols{grid-template-columns:minmax(0,1fr)}
  .ib{display:grid}
  .clocks{display:none}
  .side{position:fixed;z-index:31;left:0;right:0;bottom:0;top:auto;height:auto;max-height:84vh;max-height:84dvh;background:var(--panel);border:0;border-top:1px solid var(--line2);border-radius:14px 14px 0 0;padding:0 0 calc(18px + env(safe-area-inset-bottom));transform:translateY(105%);transition:transform .26s cubic-bezier(.2,.8,.2,1);box-shadow:var(--shadow);visibility:hidden}
  .sheet .side{transform:none;visibility:visible}
  .scrim{display:block;position:fixed;inset:0;z-index:30;background:rgba(0,0,0,.5);opacity:0;pointer-events:none;transition:opacity .2s}
  .sheet .scrim{opacity:1;pointer-events:auto}
  .shd{display:flex;position:sticky;top:0;z-index:1;background:var(--panel);align-items:center;justify-content:space-between;padding:14px 16px 10px;font-size:15px;font-weight:600;border-bottom:1px solid var(--line)}
  .shd button{border:0;background:transparent;color:var(--amber);font-size:14px;font-weight:600;padding:4px 0 4px 12px}
  .so{min-height:42px;font-size:14.5px}.so .bx{width:16px;height:16px}.so .bx svg{width:11px;height:11px}
  .grp{padding-top:14px;font-size:12px}
  .set{min-height:44px;font-size:14.5px}
  .keysec{display:none}
  .mclk{display:flex!important}
}
.mclk{display:none;gap:18px;padding:12px 16px 2px;font-size:12px;color:var(--fg3);flex-wrap:wrap}
@media (max-width:719px){
  body{font-size:15px}
  .hd-in{gap:6px;padding:0 6px 0 14px;height:50px}
  .tabs{top:calc(51px + env(safe-area-inset-top));padding:0 14px;height:42px}
  .live span{display:none}
  .live{margin-left:2px}
  .sum{display:none}
  .tab{flex:1;justify-content:center;padding:0 4px}
  .tab:first-child{margin-left:0}
  .tab.on::after{left:18%;right:18%}
  .hd .sbox{display:none;flex:1;width:auto;max-width:none}
  .hd .sbox kbd{display:none}
  .hd .sbox input{height:36px;font-size:16px;border-radius:9px}
  .searching .brand,.searching .live,.searching .sp,.searching .ib{display:none}
  .searching .sbox{display:block}.searching .cancel{display:block}
  .day{padding:7px 14px}
  .row{grid-template-columns:auto minmax(0,1fr) auto;grid-template-areas:"t src s" "c c c";column-gap:10px;row-gap:5px;padding:12px 14px 13px;align-items:center}
  .row .t{grid-area:t;font-size:12px}
  .row .src{grid-area:src;text-align:left;max-width:none;font-size:12px}
  .row .s{grid-area:s;justify-self:end}
  .row .c{grid-area:c}
  .row .h{font-size:15.5px;line-height:1.5}
  .sk{padding:16px 14px}
  .exp .d{padding-top:12px}
  .d-body{font-size:15px}
  .btn{height:40px;padding:0 16px;font-size:14px}
}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;

const JS = String.raw`
function api(p){return p+(p.indexOf('?')>=0?'&':'?')+(KEY?'key='+encodeURIComponent(KEY):'');}
var $=function(id){return document.getElementById(id)};
var state={view:'hot',off:{},q:'',sound:true,notify:true,theme:'auto',items:[],pending:[],lastSeen:0,first:true,loaded:false,newIds:{},sel:null,health:{}};
try{var saved=JSON.parse(localStorage.getItem('hw')||'{}');
  if(saved.view==='hot'||saved.view==='mid'||saved.view==='all')state.view=saved.view;
  if(saved.off)state.off=saved.off;if(saved.sound===false)state.sound=false;if(saved.notify===false)state.notify=false;
  if(saved.theme==='dark'||saved.theme==='light')state.theme=saved.theme;}catch(e){}
function save(){try{localStorage.setItem('hw',JSON.stringify({view:state.view,off:state.off,sound:state.sound,notify:state.notify,theme:state.theme}))}catch(e){}}

/* ---------- 小工具 ---------- */
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function hl(s){s=String(s==null?'':s);var k=state.q.toLowerCase();if(!k)return esc(s);var low=s.toLowerCase(),out='',p=0,i;
  while((i=low.indexOf(k,p))>=0){out+=esc(s.slice(p,i))+'<mark>'+esc(s.slice(i,i+k.length))+'</mark>';p=i+k.length;}return out+esc(s.slice(p));}
function pad(n){return n<10?'0'+n:''+n}
function hm(ts){var d=new Date(ts);return pad(d.getHours())+':'+pad(d.getMinutes())}
function dayKey(ts){var d=new Date(ts);return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate()}
function dayLabel(ts){var d=new Date(ts),full=(d.getMonth()+1)+'月'+d.getDate()+'日 周'+'日一二三四五六'[d.getDay()];
  if(dayKey(ts)===dayKey(Date.now()))return ['今天',full];if(dayKey(ts)===dayKey(Date.now()-864e5))return ['昨天',full];return [full,''];}
function ago(ts){var s=Math.max(0,(Date.now()-ts)/1000);if(s<60)return '刚刚';if(s<3600)return Math.floor(s/60)+' 分钟前';if(s<86400)return Math.floor(s/3600)+' 小时前';return Math.floor(s/86400)+' 天前';}
function fmtScore(x){return x==null?'–':String(Math.round(x*10)/10)}
function lvl(i){var s=i.score;if(s==null)return 0;if(s>=8)return 3;if(s>=5)return 2;return 1;}
function isHot(i){return !!(i.important&&!i.dup_of)}
function cleanTitle(t){return String(t||'').replace(/[\u200e\u200f]/g,'').replace(/^FinancialJuice:\s*/i,'').replace(/\s+(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,6}\/\S+/gi,'').replace(/\s*(?:more here|read more)\s*:?\s*$/i,'').replace(/\s*\|\s*$/,'').replace(/\s{2,}/g,' ').trim()||String(t||'');}
function squash(s){return String(s||'').toLowerCase().replace(/https?:\/\/\S+/g,'').replace(/[\s\u200e\u200f.…]+/g,'');}
function cleanBody(i){
  var b=String(i.body||'').replace(/[\u200e\u200f]/g,'').replace(/\r/g,'').split('\n').map(function(l){return l.trim()})
    .filter(function(l){return !/^https?:\/\/\S+$/.test(l)}).join('\n').replace(/\n{2,}/g,'\n\n').trim();
  if(!b)return '';
  var sb=squash(b),st=squash(i.title);
  if(sb===st||st.indexOf(sb)===0||sb===squash(cleanTitle(i.title)))return '';
  if(String(i.body).length>=495&&!/[.。!！?？…]$/.test(b))b+='…';
  return b;
}
function fixUrl(u){u=String(u||'');var m=u.match(/^https?:\/\/[^\/]+(https?:\/\/.*)$/);if(m)u=m[1];return /^https?:\/\//.test(u)?u:'';}
function shortSrc(s){return String(s).replace(/\s*\(Bluesky\)\s*$/i,'')}
var GROUPS=[['flash','快讯'],['wire','通讯社与媒体'],['cn','中文快讯'],['gulf','沙特与海湾'],['off','官方与公告'],['other','其他']];
function groupOf(s){var n=s.toLowerCase();
  if(/[\u4e00-\u9fff]/.test(s))return 'cn';
  if(/argaam|arab|saudi|gulf|tadawul|zawya/.test(n))return 'gulf';
  if(/financialjuice|unusual whales|investinglive|seeking alpha|squawk|walter/.test(n))return 'flash';
  if(/federal reserve|newswire|business wire|treasury|\bsec\b/.test(n))return 'off';
  if(/reuters|bloomberg|\bap\b|\bft\b|wsj|cnbc|barron|bbc|investing\.com|nasdaq|marketwatch/.test(n))return 'wire';
  return 'other';}
var wide=window.matchMedia('(min-width:1240px)');
var CHECK='<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m2.5 6.2 2.4 2.4 4.6-5"/></svg>';
var EXT='<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3H3v10h10v-3M9 3h4v4M13 3 7.5 8.5"/></svg>';

/* ---------- 筛选 ---------- */
function base(){var k=state.q.toLowerCase();
  return state.items.filter(function(i){if(state.off[i.source])return false;if(k&&(i.title+' '+(i.body||'')).toLowerCase().indexOf(k)<0)return false;return true;});}
function inView(i,v){if(v==='hot')return isHot(i);if(v==='mid')return (i.score||0)>=6&&!i.dup_of;return true;}
function visible(){return base().filter(function(i){return inView(i,state.view)});}
function byId(id){for(var k=0;k<state.items.length;k++)if(state.items[k].id===id)return state.items[k];return null;}
function offCount(){return Object.keys(state.off).length}

/* ---------- 渲染 ---------- */
function chipsHtml(i){var h='';
  if(i.confirms>0)h+='<span class="chip cf" title="另有 '+i.confirms+' 个来源报道了同一件事">'+(i.confirms+1)+' 源证实</span>';
  if(i.hits)i.hits.split(' | ').forEach(function(x){if(x)h+='<span class="chip hit">'+esc(x)+'</span>'});
  if(i.dup_of)h+='<span class="chip dup">同一事件已合并</span>';
  return h;}
function detailHtml(i){
  var L=lvl(i),hot=isHot(i),u=fixUrl(i.url),b=cleanBody(i),bar='',n=Math.round(i.score||0);
  for(var k=1;k<=10;k++)bar+='<i'+(k<=n?' class="f"':'')+'></i>';
  var lv=hot?'重要快讯':i.score==null?'尚未评分':i.score>=8?'高分':i.score>=5?'一般关注':'常规消息';
  var by=i.score==null?'等待评分':(i.score_by==='ai'?'AI 评分':'规则评分')+(i.base_score!=null&&i.confirms>0&&i.base_score!==i.score?' · 原始 '+fmtScore(i.base_score)+'，多源证实加分':'');
  var body=b?'<div class="d-body">'+b.split('\n\n').map(function(p){return '<p>'+hl(p).replace(/\n/g,'<br>')+'</p>'}).join('')+'</div>':'<div class="d-none">这条快讯只有标题，没有摘要。</div>';
  return '<div class="d"><div class="d-top"><div class="d-sc num s'+L+'">'+fmtScore(i.score)+'</div><div><div class="d-lv'+(hot?' hot':'')+'">'+lv+'</div><div class="d-by">'+by+'</div><div class="bar'+(L===3?' hot':'')+'">'+bar+'</div></div></div>'+
    '<h2>'+hl(cleanTitle(i.title))+'</h2>'+
    '<div class="d-meta"><b>'+esc(i.source)+'</b><span class="num" title="'+esc(new Date(i.ts).toLocaleString('zh-CN',{hour12:false}))+'">'+hm(i.ts)+'</span><span>'+ago(i.ts)+'</span>'+chipsHtml(i)+'</div>'+
    body+
    '<div class="d-act">'+(u?'<a class="btn pri" href="'+esc(u)+'" target="_blank" rel="noopener">打开原文'+EXT+'</a>':'')+'<button class="btn" data-copy="'+esc(i.id)+'">复制标题</button></div></div>';
}
function rowHtml(i){
  var L=lvl(i),hot=isHot(i),sel=state.sel===i.id;
  return '<article class="row'+(hot?' imp':L>=2?' m':'')+(sel?' sel':'')+(state.newIds[i.id]?' new':'')+'" data-id="'+esc(i.id)+'">'+
    '<time class="t num">'+hm(i.ts)+'</time>'+
    '<span class="s num s'+L+'" title="'+(i.score==null?'尚未评分':(i.score_by==='ai'?'AI 评分 ':'规则评分 ')+fmtScore(i.score))+'">'+fmtScore(i.score)+'</span>'+
    '<div class="c"><span class="h">'+hl(cleanTitle(i.title))+'</span>'+chipsHtml(i)+(sel?'<div class="exp">'+detailHtml(i)+'</div>':'')+'</div>'+
    '<span class="src">'+esc(shortSrc(i.source))+'</span></article>';
}
function renderSide(){
  var cnt={},names=[];state.items.forEach(function(i){if(!(i.source in cnt)){cnt[i.source]=0;names.push(i.source)}cnt[i.source]++});
  names.sort(function(a,b){return cnt[b]-cnt[a]||a.localeCompare(b)});
  var h='';
  GROUPS.forEach(function(g){
    var ns=names.filter(function(n){return groupOf(n)===g[0]});if(!ns.length)return;
    var tot=ns.reduce(function(a,n){return a+cnt[n]},0);
    h+='<button class="grp" data-g="'+g[0]+'" title="点击整组开关">'+g[1]+'<span class="num">'+tot+'</span></button>';
    ns.forEach(function(n){var bad=state.health[n];
      h+='<button class="so'+(state.off[n]?'':' on')+'" data-s="'+esc(n)+'" role="checkbox" aria-checked="'+(state.off[n]?'false':'true')+'"><span class="bx">'+CHECK+'</span><span class="nm">'+esc(shortSrc(n))+'</span>'+
        (/\(Bluesky\)/i.test(n)?'<span class="via">Bluesky</span>':'')+(bad?'<span class="bad" title="最近一次抓取失败：'+esc(bad)+'"></span>':'')+
        '<span class="only" data-only="'+esc(n)+'">只看</span><span class="num">'+cnt[n]+'</span></button>';});
  });
  $('srcs').innerHTML=h||'<div class="keys">暂无来源</div>';
  $('swSound').setAttribute('aria-pressed',state.sound?'true':'false');
  var np=window.Notification?Notification.permission:'unsupported';
  $('swNotify').setAttribute('aria-pressed',(np==='granted'&&state.notify)?'true':'false');
  $('ntHint').textContent=np==='unsupported'?'这个浏览器不支持':np==='denied'?'已被浏览器拒绝，需在浏览器设置里放行':'有重要快讯时弹出系统通知';
  [].forEach.call($('theme').children,function(b){b.classList.toggle('on',b.dataset.t===state.theme)});
}
function renderTabs(){
  var b=base(),n={hot:0,mid:0,all:b.length};b.forEach(function(i){if(inView(i,'hot'))n.hot++;if(inView(i,'mid'))n.mid++;});
  $('nHot').textContent=n.hot;$('nMid').textContent=n.mid;$('nAll').textContent=n.all;
  [].forEach.call(document.querySelectorAll('.tab'),function(t){var on=t.dataset.v===state.view;t.classList.toggle('on',on);t.setAttribute('aria-selected',on?'true':'false')});
  var oc=offCount(),parts=[];
  if(oc)parts.push('已隐藏 '+oc+' 个来源');if(state.q)parts.push('搜索“'+esc(state.q)+'”');
  $('sum').innerHTML=(parts.length?'<span>'+parts.join(' · ')+'</span><button id="clr">清除筛选</button>':'<span>共 '+state.items.length+' 条 · 每分钟抓取</span>');
  $('fbtn').classList.toggle('has',oc>0);
}
function renderPane(){
  var i=state.sel&&byId(state.sel);
  $('pane').innerHTML=i?detailHtml(i):'<div class="blank">选一条快讯，在这里看摘要和评分依据</div>';
}
function render(){
  renderTabs();renderSide();
  var v=visible(),html='',last='';
  if(wide.matches&&v.length&&!(state.sel&&v.some(function(i){return i.id===state.sel})))state.sel=v[0].id;
  if(!state.loaded){for(var k=0;k<12;k++)html+='<div class="sk"><i></i><i></i><i style="width:'+(45+(k*37)%50)+'%"></i></div>';}
  else if(!v.length){
    var filtered=offCount()||state.q;
    html=!state.items.length?'<div class="empty"><b>还没有数据</b>部署后等一两分钟，第一批快讯就会出现。</div>'
      :filtered?'<div class="empty"><b>没有符合条件的快讯</b>当前的来源筛选或搜索把结果都过滤掉了。<br><button class="btn" id="clr2">清除筛选</button></div>'
      :'<div class="empty"><b>'+(state.view==='all'?'暂无快讯':'暂时没有达到这个分数的快讯')+'</b>'+(state.view==='all'?'':'可以切到“全部”看所有快讯。')+'</div>';
  }
  var counts={};v.forEach(function(i){var k=dayKey(i.ts);counts[k]=(counts[k]||0)+1});
  v.forEach(function(i){var k=dayKey(i.ts);if(k!==last){var l=dayLabel(i.ts);html+='<div class="day">'+l[0]+(l[1]?'<span>'+l[1]+'</span>':'')+'<span class="num" style="margin-left:auto">'+counts[k]+' 条</span></div>';last=k;}html+=rowHtml(i);});
  $('list').innerHTML=html;$('list').className='feed v-'+state.view;state.newIds={};
  renderPane();setTop();
}
function setTop(){var h=$('hd').offsetHeight+$('tabs').offsetHeight;document.documentElement.style.setProperty('--top',h+'px');}

/* ---------- 市场时钟（常规交易时段，不含节假日） ---------- */
function mkt(tz,days,segs){
  var p={};try{new Intl.DateTimeFormat('en-US',{timeZone:tz,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).forEach(function(x){p[x.type]=x.value});}catch(e){return null;}
  var m=(+p.hour)*60+(+p.minute),st='休市',open=false;
  if(days.indexOf(p.weekday)>=0)segs.forEach(function(s){if(m>=s[0]&&m<s[1]){st=s[2];open=s[2]==='开盘';}});
  return {t:p.hour+':'+p.minute,st:st,open:open};
}
function renderClocks(){
  var a=mkt('America/New_York',['Mon','Tue','Wed','Thu','Fri'],[[240,570,'盘前'],[570,960,'开盘'],[960,1200,'盘后']]);
  var b=mkt('Asia/Riyadh',['Sun','Mon','Tue','Wed','Thu'],[[600,900,'开盘']]);
  function one(n,c){return c?'<span class="clk'+(c.open?' open':'')+'" title="按常规交易时段判断，不含节假日">'+n+' <span class="num">'+c.t+'</span><em>'+c.st+'</em></span>':'';}
  var h=one('纽约',a)+one('利雅得',b);$('clocks').innerHTML=h;$('mclk').innerHTML=h;
}

/* ---------- 声音、通知、提示 ---------- */
function beep(){try{var a=new (window.AudioContext||window.webkitAudioContext)(),t=a.currentTime;[880,1320].forEach(function(f,k){var o=a.createOscillator(),g=a.createGain();o.type='sine';o.frequency.value=f;o.connect(g);g.connect(a.destination);g.gain.setValueAtTime(0,t+k*.14);g.gain.linearRampToValueAtTime(.16,t+k*.14+.02);g.gain.exponentialRampToValueAtTime(.001,t+k*.14+.22);o.start(t+k*.14);o.stop(t+k*.14+.25);});}catch(e){}}
function tip(s){var el=$('tip');el.textContent=s;el.classList.add('show');clearTimeout(tip.t);tip.t=setTimeout(function(){el.classList.remove('show')},2200);}
function showPill(){var n=state.pending.length,el=$('pill');if(!n){el.classList.remove('show');return;}
  var hot=state.pending.filter(isHot).length;el.classList.toggle('hot',hot>0);
  el.textContent='↑ '+(hot?hot+' 条新的重要快讯':n+' 条新快讯');el.classList.add('show');}
function merge(){if(!state.pending.length)return;state.newIds={};if(!state.first)state.pending.forEach(function(i){state.newIds[i.id]=1});
  state.items=state.pending.concat(state.items).sort(function(a,b){return b.ts-a.ts}).slice(0,800);state.pending=[];showPill();}

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
    state.items=state.items.map(function(x){var u=upd[x.id];if(u&&(u.score!==x.score||u.important!==x.important||u.confirms!==x.confirms||u.dup_of!==x.dup_of)){changed=true;return u;}return x;});
    state.pending=state.pending.map(function(x){return upd[x.id]||x});
    if(fresh.length){
      fresh.forEach(function(i){state.lastSeen=Math.max(state.lastSeen,i.seen_at)});
      state.pending=fresh.concat(state.pending);changed=true;
      if(!state.first){
        var hot=fresh.filter(isHot);
        if(hot.length){
          if(state.sound)beep();
          if(state.notify&&window.Notification&&Notification.permission==='granted')hot.slice(0,3).forEach(function(i){try{new Notification(cleanTitle(i.title),{body:i.source+' · 评分 '+fmtScore(i.score),tag:i.id})}catch(e){}});
          if(document.hidden){unread+=hot.length;document.title='('+unread+') Headline Watch';}
        }
      }
      // 正在往下读时不打断：新快讯先攒着，顶部出现提示
      if(state.first||window.scrollY<140){merge();}else{showPill();}
    }
    state.first=false;state.loaded=true;
    if(changed)render();
    $('live').classList.remove('err');$('liveTxt').textContent='实时 · '+hm(Date.now())+' 更新';
  }catch(e){$('live').classList.add('err');$('liveTxt').textContent='连接失败，自动重试中';if(!state.loaded&&!state.items.length){$('list').innerHTML='<div class="empty"><b>连接失败</b>暂时读不到数据，页面会自动重试。</div>';}}
}
async function loadHealth(){
  try{var r=await fetch(api('/api/status'),{cache:'no-store'});if(!r.ok)return;var d=await r.json(),h={};
    (d.sources||[]).forEach(function(s){if(s.last_error&&s.last_error_at&&(!s.last_ok||s.last_error_at>s.last_ok)){h[String(s.key).replace(/^[a-z]+:/,'')]=s.last_error;}});
    state.health=h;renderSide();}catch(e){}
}

/* ---------- 交互 ---------- */
function setView(v){state.view=v;save();if(!wide.matches)state.sel=null;render();window.scrollTo({top:0});}
function clearFilters(){state.off={};state.q='';$('q').value='';save();render();}
function select(id,scroll){
  if(!wide.matches&&state.sel===id){state.sel=null;}else{state.sel=id;}
  var old=document.querySelector('.row.sel');if(old){old.classList.remove('sel');var e=old.querySelector('.exp');if(e)e.remove();}
  var i=state.sel&&byId(state.sel);
  if(i){var el=document.querySelector('.row[data-id="'+(window.CSS&&CSS.escape?CSS.escape(i.id):i.id)+'"]');
    if(el){el.classList.add('sel');var x=document.createElement('div');x.className='exp';x.innerHTML=detailHtml(i);el.querySelector('.c').appendChild(x);if(scroll)el.scrollIntoView({block:'nearest'});}}
  renderPane();if($('pane').scrollTop)$('pane').scrollTop=0;
}
function move(dir){var v=visible();if(!v.length)return;var k=-1;v.forEach(function(i,n){if(i.id===state.sel)k=n});
  k=Math.max(0,Math.min(v.length-1,k+dir));if(v[k].id!==state.sel||!wide.matches){if(!wide.matches&&v[k].id===state.sel)return;select(v[k].id,true);}}
function applyTheme(){var r=document.documentElement;if(state.theme==='auto')r.removeAttribute('data-theme');else r.setAttribute('data-theme',state.theme);
  var dark=state.theme==='dark'||(state.theme==='auto'&&!window.matchMedia('(prefers-color-scheme:light)').matches);$('tc').setAttribute('content',dark?'#0a0b0d':'#f6f6f3');}
function sheet(on){document.body.classList.toggle('sheet',on);}

document.querySelector('.tabs').addEventListener('click',function(e){var t=e.target.closest('.tab');if(t)return setView(t.dataset.v);if(e.target.id==='clr')clearFilters();});
$('list').addEventListener('click',function(e){
  if(e.target.id==='clr2')return clearFilters();
  if(e.target.closest('.exp')){copyClick(e);return;}
  if(window.getSelection&&String(window.getSelection()))return;
  var r=e.target.closest('.row');if(r)select(r.dataset.id,false);});
$('list').addEventListener('dblclick',function(e){if(e.target.closest('.exp'))return;var r=e.target.closest('.row');if(!r)return;var i=byId(r.dataset.id),u=i&&fixUrl(i.url);if(u)window.open(u,'_blank','noopener');});
$('pane').addEventListener('click',copyClick);
function copyClick(e){var b=e.target.closest('[data-copy]');if(!b)return;var i=byId(b.dataset.copy);if(!i)return;var s=cleanTitle(i.title);
  (navigator.clipboard?navigator.clipboard.writeText(s):Promise.reject()).then(function(){tip('已复制标题')},function(){tip('复制失败，请手动选择文字')});}
$('srcs').addEventListener('click',function(e){
  var o=e.target.closest('[data-only]');
  if(o){var keep=o.dataset.only,off={};state.items.forEach(function(i){if(i.source!==keep)off[i.source]=true});state.off=off;save();render();return;}
  var g=e.target.closest('.grp');
  if(g){var ns={};state.items.forEach(function(i){if(groupOf(i.source)===g.dataset.g)ns[i.source]=1});var names=Object.keys(ns),anyOn=names.some(function(n){return !state.off[n]});
    names.forEach(function(n){if(anyOn)state.off[n]=true;else delete state.off[n]});save();render();return;}
  var b=e.target.closest('.so');if(!b)return;var s=b.dataset.s;if(state.off[s])delete state.off[s];else state.off[s]=true;save();render();});
$('allSrc').onclick=function(){state.off={};save();render();};
$('swSound').onclick=function(){state.sound=!state.sound;save();renderSide();if(state.sound)beep();};
$('swNotify').onclick=function(){
  if(!window.Notification)return tip('这个浏览器不支持通知');
  if(Notification.permission==='granted'){state.notify=!state.notify;save();renderSide();return;}
  if(Notification.permission==='denied')return tip('通知已被浏览器拒绝，请在浏览器设置里放行');
  Notification.requestPermission().then(function(p){state.notify=p==='granted';save();renderSide();});};
$('theme').onclick=function(e){var b=e.target.closest('button');if(!b)return;state.theme=b.dataset.t;save();applyTheme();renderSide();};
$('q').oninput=function(e){state.q=e.target.value.trim();render();};
$('sbtn').onclick=function(){$('hd').classList.add('searching');$('q').focus();};
$('cancel').onclick=function(){$('hd').classList.remove('searching');if(state.q){state.q='';$('q').value='';render();}};
$('fbtn').onclick=function(){sheet(true)};$('scrim').onclick=function(){sheet(false)};$('done').onclick=function(){sheet(false)};
$('pill').onclick=function(){merge();render();window.scrollTo({top:0,behavior:'smooth'});};
window.addEventListener('scroll',function(){if(state.pending.length&&window.scrollY<140){merge();render();}},{passive:true});
document.addEventListener('keydown',function(e){
  if(e.metaKey||e.ctrlKey||e.altKey)return;
  var typing=/^(INPUT|TEXTAREA)$/.test((e.target.tagName||''));
  if(e.key==='Escape'){if(document.body.classList.contains('sheet'))return sheet(false);if(typing){e.target.blur();if(state.q){state.q='';$('q').value='';render();}$('hd').classList.remove('searching');}return;}
  if(typing)return;
  if(e.key==='/'){e.preventDefault();$('hd').classList.add('searching');$('q').focus();}
  else if(e.key==='j'||e.key==='ArrowDown'){e.preventDefault();move(1);}
  else if(e.key==='k'||e.key==='ArrowUp'){e.preventDefault();move(-1);}
  else if(e.key==='Enter'||e.key==='o'){var i=state.sel&&byId(state.sel),u=i&&fixUrl(i.url);if(u)window.open(u,'_blank','noopener');}
  else if(e.key==='1')setView('hot');else if(e.key==='2')setView('mid');else if(e.key==='3')setView('all');
});
document.addEventListener('visibilitychange',function(){if(!document.hidden){unread=0;document.title='Headline Watch';load();}});
window.addEventListener('resize',setTop);
if(wide.addEventListener)wide.addEventListener('change',function(){render()});
applyTheme();render();renderClocks();load();loadHealth();
setInterval(load,15000);setInterval(renderClocks,20000);setInterval(loadHealth,300000);
setInterval(function(){if(!document.hidden)renderPane()},60000);
`;

const ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%230a0b0d'/%3E%3Crect x='7' y='7' width='18' height='18' rx='2' fill='%23f5a623'/%3E%3C/svg%3E";

const BODY = `
<header class="hd" id="hd"><div class="hd-in">
  <div class="brand"><i></i>HEADLINE<span>WATCH</span></div>
  <div class="live" id="live" role="status"><b></b><span id="liveTxt">连接中</span></div>
  <div class="clocks" id="clocks"></div>
  <div class="sp"></div>
  <label class="sbox"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="q" type="search" placeholder="搜索标题和摘要" autocomplete="off" aria-label="搜索"><kbd>/</kbd></label>
  <button class="cancel" id="cancel">取消</button>
  <button class="ib" id="sbtn" aria-label="搜索"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></button>
  <button class="ib" id="fbtn" aria-label="来源筛选与设置"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg></button>
</div></header>
<nav class="tabs" id="tabs" role="tablist">
  <button class="tab on" data-v="hot" role="tab">重要<span class="num" id="nHot">0</span></button>
  <button class="tab" data-v="mid" role="tab">6 分以上<span class="num" id="nMid">0</span></button>
  <button class="tab" data-v="all" role="tab">全部<span class="num" id="nAll">0</span></button>
  <div class="sum" id="sum"></div>
</nav>
<div class="cols">
  <aside class="side" id="side" aria-label="来源筛选与设置">
    <div class="shd"><span>筛选与设置</span><button id="done">完成</button></div>
    <div class="mclk" id="mclk"></div>
    <div class="sh"><span>来源</span><button id="allSrc">全选</button></div>
    <div id="srcs"></div>
    <div class="sh"><span>提醒</span></div>
    <div class="set"><div>提示音<small>有重要快讯时响一声</small></div><button class="sw" id="swSound" aria-label="提示音" aria-pressed="true"></button></div>
    <div class="set"><div>桌面通知<small id="ntHint">有重要快讯时弹出系统通知</small></div><button class="sw" id="swNotify" aria-label="桌面通知" aria-pressed="false"></button></div>
    <div class="sh"><span>外观</span></div>
    <div class="set"><div>主题</div><div class="seg" id="theme"><button data-t="auto">跟随系统</button><button data-t="dark">深色</button><button data-t="light">浅色</button></div></div>
    <div class="keysec"><div class="sh"><span>快捷键</span></div>
    <div class="keys"><span><kbd>J</kbd><kbd>K</kbd>上下条</span><span><kbd>Enter</kbd>打开原文</span><span><kbd>/</kbd>搜索</span><span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd>切换视图</span></div></div>
  </aside>
  <main class="feed" id="list" aria-live="off"></main>
  <section class="pane" id="pane" aria-label="快讯详情"></section>
</div>
<div class="scrim" id="scrim"></div>
<button class="pill" id="pill"></button>
<div class="tip" id="tip" role="status"></div>
`;

export function renderPage({ key }) {
  // key 来自网址参数，转义尖括号，避免提前结束 <script>
  const safeKey = JSON.stringify(String(key || '')).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, '');
  return `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" id="tc" content="#0a0b0d">
<title>Headline Watch</title>
<link rel="icon" href="${ICON}">
<script>try{var t=JSON.parse(localStorage.getItem('hw')||'{}').theme;if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t)}catch(e){}</script>
<style>${CSS}</style></head><body>${BODY}<script>
var KEY=${safeKey};${JS}</script></body></html>`;
}

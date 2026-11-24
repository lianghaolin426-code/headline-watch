// 网页看板（第三版）：报刊式排版 + 毛玻璃卡片。
// 视图：简报（头条、今日要闻、12 小时统计、话题磁贴、实时快讯）/ 重要 / 6 分以上 / 全部。
// 界面文字有中文、English、العربية 三种（阿拉伯语整页从右到左）；
// 快讯内容的翻译在访问者的浏览器里完成（Chrome 自带的 Translator），不占服务器端的 AI 额度，浏览器不支持时显示原文。
// 页面开着时每 15 秒刷新；有新的重要快讯会响一声，可选弹出浏览器通知。
// 注意：CSS 和 JS 用 String.raw 写成模板字符串，里面不要出现反引号和 ${}，也不要写 \u 转义（用 String.fromCharCode）。

const CSS = String.raw`
:root{
  --bg:#f5f0e6;--bg2:#ece5d7;--ink:#1a1714;--ink2:#4a433b;--ink3:#7a7065;--ink4:#a79c8d;--rule:#d9d0c0;--rule2:#c7bca9;
  --red:#c8371d;--on-red:#fff;--blue:#2b5c9c;--violet:#6a48a0;--red-soft:rgba(200,55,29,.1);--amber:#c98a1a;--ok:#2f8f5b;
  --glass:rgba(255,255,255,.52);--glass2:rgba(255,255,255,.72);--glass-line:rgba(255,255,255,.85);--glass-edge:rgba(26,23,20,.07);
  --bar:rgba(245,240,230,.78);--shadow:0 1px 1px rgba(60,40,20,.04),0 12px 34px rgba(60,40,20,.08);--shadow2:0 30px 80px rgba(40,25,10,.28);
  --blob1:rgba(200,55,29,.13);--blob2:rgba(201,138,26,.16);--blob3:rgba(120,90,60,.1);--mark:rgba(201,138,26,.3);
  --serif:Charter,"Iowan Old Style","Songti SC","Noto Serif SC","Source Han Serif SC","Geeza Pro","Noto Naskh Arabic",Georgia,"Times New Roman",serif;
  --sans:Inter,-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Hiragino Sans GB","Microsoft YaHei","SF Arabic","Geeza Pro","Segoe UI",Roboto,sans-serif;
  --mono:"SF Mono",ui-monospace,SFMono-Regular,"JetBrains Mono",Menlo,Consolas,monospace;
  --top:92px;
  /* 动效：一条主曲线（快进慢出）、一条离场曲线、一条带一点回弹的曲线；时长 140 / 220 / 340 毫秒三档 */
  --e-out:cubic-bezier(.22,1,.36,1);--e-in:cubic-bezier(.5,0,.8,.2);--e-spring:cubic-bezier(.34,1.42,.64,1);
}
@property --p{syntax:'<number>';inherits:true;initial-value:0}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){
  --bg:#12100d;--bg2:#1a1713;--ink:#f3ecdf;--ink2:#cfc6b7;--ink3:#978d7f;--ink4:#6a6156;--rule:#2d2822;--rule2:#40392f;
  --red:#ff6b4a;--on-red:#1c0b06;--blue:#86b4f2;--violet:#b9a0f2;--red-soft:rgba(255,107,74,.13);--amber:#e3a743;--ok:#5fcf95;
  --glass:rgba(255,255,255,.045);--glass2:rgba(255,255,255,.08);--glass-line:rgba(255,255,255,.1);--glass-edge:rgba(0,0,0,.4);
  --bar:rgba(18,16,13,.74);--shadow:0 1px 1px rgba(0,0,0,.3),0 14px 40px rgba(0,0,0,.35);--shadow2:0 30px 90px rgba(0,0,0,.7);
  --blob1:rgba(255,107,74,.16);--blob2:rgba(227,167,67,.1);--blob3:rgba(140,110,80,.12);--mark:rgba(227,167,67,.32);
}}
:root[data-theme=dark]{
  --bg:#12100d;--bg2:#1a1713;--ink:#f3ecdf;--ink2:#cfc6b7;--ink3:#978d7f;--ink4:#6a6156;--rule:#2d2822;--rule2:#40392f;
  --red:#ff6b4a;--on-red:#1c0b06;--blue:#86b4f2;--violet:#b9a0f2;--red-soft:rgba(255,107,74,.13);--amber:#e3a743;--ok:#5fcf95;
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
.live b{position:relative;width:6px;height:6px;border-radius:50%;background:var(--red)}
.live b::after{content:"";position:absolute;inset:0;border-radius:50%;background:var(--red);opacity:0;animation:halo 3s var(--e-out) infinite}
@keyframes halo{0%{transform:scale(1);opacity:.4}65%,100%{transform:scale(3.4);opacity:0}}
.live.ping b::after{animation:ping .9s var(--e-out)}
@keyframes ping{0%{transform:scale(1);opacity:.75}100%{transform:scale(5);opacity:0}}
.live strong{color:var(--ink);font-weight:600}
.live.err b{animation:none;background:var(--ink4)}.live.err b::after{animation:none}.live.err span{color:var(--red)}
.live{cursor:pointer;border-radius:999px;padding:4px 8px;margin-inline-start:-8px}.live{transition:background .15s}.live:hover{background:var(--glass2)}
.live.spin b{animation:blink .5s infinite alternate}@keyframes blink{to{opacity:.2}}
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
/* 分段开关的滑块：选中项的底色不再瞬间跳过去，而是一块滑过去 */
.mseg,.lang,.seg{position:relative;isolation:isolate}
.thumb{position:absolute;z-index:-1;border-radius:999px;background:var(--ink);pointer-events:none;transition:left .32s var(--e-out),width .32s var(--e-out)}
.th button.on{background:transparent!important}.th button{transition:color .2s,transform .14s var(--e-out)}
.ib{position:relative;width:32px;height:32px;border-radius:50%;display:grid;place-items:center;color:var(--ink2);flex:none}
.ib{transition:background .15s,transform .14s var(--e-out)}.ib:hover{background:var(--glass2)}
.ib svg{width:17px;height:17px}
.ib.has::after{content:"";position:absolute;top:5px;inset-inline-end:5px;width:7px;height:7px;border-radius:50%;background:var(--red);box-shadow:0 0 0 2px var(--bg)}
#sbtn,.cancel{display:none}

/* ---------- 报头与视图切换 ---------- */
.mast{display:grid;grid-template-columns:minmax(0,330px) minmax(0,auto) minmax(0,330px);justify-content:space-between;align-items:end;gap:32px;padding-block:26px 20px;overflow-x:clip}
.mc{text-align:center;grid-column:2;min-width:0}
.mkick{font-size:11px;font-weight:700;letter-spacing:.22em;color:var(--red)}
/* 报头专用字体：Playfair Display ExtraBold（SIL OFL 许可），只保留 Headline Watch 用到的字母，内嵌在页面里，所有设备上长得一样 */
@font-face{font-family:HWMast;font-weight:800;font-display:swap;src:url(data:font/woff2;base64,d09GMgABAAAAAAcgABAAAAAADmgAAAbFAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGhwbgzocKgZgP1NUQVREAHQRCAqNAIonATYCJAM8CyAABCAFhTYHIAwHG9kLUVSSOpH9TLDBmFTDcJ7yxskWgs4/EWwddApbzBf6mXj4b7//7TMzT76YRzS5RE1qmfobHlmkStTV8UbTbHqX6ixTv+i0PRnPtbKH4fG0f6mGbE5XYzBPcve/l9G+4gT0P0A77P//XtX3snFsXO94AhiKBjggwbHGzehYr2tsWja5VsvQBD93ea1EBSlIwbga6VZRe1K4mkzIzBcKtAOSJDSFVh1CoNW8NYkdux4+IH/lJLmQV+CNsejy2dCFHK5K0dIqa9evi0kYTrkb8NFg9wiNs1FoCpMlwkDoqL7G7F/4Z7D9uf7Qi7VrKlJ1tUb1TWs4sb36KHmKX3zls1YtPDvaT8v4WHgkrbzwtf30C9WHkjsT/Q7hR/VJFH2iRJPf/W1U7uXFnVrdN+exbcru3yeP+dtTUYhgVls3tCgSqEtqwMGELPlQV4RSTfPWzBfN8Jq78pqXtCKzpUm30lFgf/qcOKYaNnjTwGzXwRuAh6ZRWVfVKNf9gT8ppfQ0piWF0JTQL4F5iWvndWL4K2kR6xCKbsqEqOVpoFRSdM4HJAbQz3akkpQTrylKKqbd+CZQGGwuqn5HkEv0n+k6VClUIE+uHOkFzyBE9bsurhhP0h6QlhRyD+0lnH8pJEo4/L8aMTtbLiKhOWmbIAyhM4XizNDShsrK8iBsZG6pECpRwKhKBIqLswFGllMiAKVKzSj5Zlh1HaQNzimet1ifWlp9UoxszKzsV705m7HGYp1K2WsHtYw0BW0Hl6TnUNaYrKOsdqW5nUZVV0TNNkKRQ3OqqS4otXXZwFs3IyU1QDatGdULRdYZV6lgVCGpUIAky4DRNBKlfFwzqrOWWi1fhZaRoORyr3E1kNXsQxWCkgYgm38l0SeaYnS3XA6WFTPK6LYuY0G2XN6qqVRCkSrVOZysBgYPZ8lt8JG1mlAJnKNajk5IkMzWtr0/6hmeYzGqp5Ua+1AFaKfCRcpG/Q7LicmyIZtg6lQwOkHJKAAYWQV8RB18CK06Q1+lc257Ncs7836bTB72MudwTx/fvkl42Pn2oE61CcBA8+EotItGrJbroyallUoIywtgCM6hM+eOZn/v3ARy93kR/42g8MUdpH8dZGa5HIpH7vxIFLzhFz2/iyQsB5Zm68Ao1Mdq/hrI2mQlVP8v1bASmFivAWmrEBQBbl7DyBoKvdo8PkJLc3P8wkW0GCB3lkHGpuGQDLlD82qKKk/cu5yyBNo4LkM8CtjEyF6AcK/6LEltLD23/nrmUPxmGI6Iv394iDqPvFkDSSSeEMglmDV2cKQ75r2J8vWkZUaj6gwDyuS35zSBlCeM4zKv9Pcv0TUzDzPoWgl7WutQ/tDU+Hoif0kjTzzMwy/zlLL99aLr5i+UX6lRZ4jeArqh1FMvJO8tR2ggFM3weX2qU//rc5V0L62lJkHCpfksvYzX4fhS6+AlFs5ee23dT23Z6Hn6qDNg39fJN63kEO+xTMPxonzTKB7xHdMsnPDsncmXkI7+cMTC5uS5lchWfxJLhyBhvLR0Wu9oc3rLOoeT250B3XD1tl2nPDGdevDSAiOmZAVupx2VpO3LX3KEqZ9xOwxfahO0xMLJa5edy8nNmzzPHHECulidsJilAjsT3/l31611pDUcIjsMIxQHYyyI9A1SN1L8ZiPSzrN0ifQAjajnjxGKl2I8iJwaqeOyOsAHvWZKj0UoRgxULqaZXIFpRIeuoU6DjNg8SdbJ5MVEiuG0nOfIQiCQcNnosHDXXppyA53ItjH3XTLw5xstubBUAF6XF+1H9mdQEANdrOqr2MvSjsMGK9o9bJZFIBEXzMP0AcEaNg8UiwPN4+8BCizKr5Ooa8EyhkCsyrBArPmZOrTsGFfY8E0950/hzUT4AQDebin8+uvt74019fzs8yVCyIcjVusHgl9mVwje53Sl1Q6yuUG+6X1qNxIfzKR1RvHFbNqlHN4aOvVQSfvSp5uqX979nOh3ua/uqvQakVkRaHNLFqWFmAclCWuDT5LOOEqyXXFud8GkZjSqdXWrY3RK0B4/eVLTm3CkQ3safJ9OrWnWOY/vX8ig0RG0ZsWqbeijhRXmL2yCfyqBIYQuGCI+ywEXhjwmhUSnp2JE9HviQATNjDuX+CJ7ln3QGJDGREsE6nEsp47RaCyiiKBRqPsvz25sceqsBeh3vAH0RqGLQj9+WVBf8bgT0ROBs6ejjdTbjiztnF76Q8yFgjMemzw3aGI4EFq1dKLqdfuurryxr6ynHLQ4XvjrJILGLnbhiNs9Dvr23PZGgN4igj1gkLzdygSBK8mzVGXXb/yDqP5euQsA) format('woff2')}
.mast h1{margin:8px 0 0;font:800 56px/1 HWMast,var(--serif);letter-spacing:-.02em;white-space:nowrap}
.mast h1 i{display:inline-block;width:.17em;height:.17em;border-radius:50%;background:var(--red);margin-inline-start:.07em}
.mast p{margin:12px 0 0;font-size:12px;letter-spacing:.2em;color:var(--ink3);display:flex;align-items:center;justify-content:center;gap:14px}
.mast p:before,.mast p:after{content:'';width:34px;height:1px;background:var(--rule2)}
.mseg{display:inline-flex;margin-top:14px;border:1px solid var(--rule);border-radius:999px;padding:3px;background:var(--glass)}
.mseg button{font-size:12.5px;font-weight:600;color:var(--ink3);padding:5px 15px;border-radius:999px;line-height:1.3;white-space:nowrap}
.mseg button:hover{color:var(--ink)}
.mseg button.on{background:var(--ink);color:var(--bg)}
.ear{min-width:0;max-width:330px;width:100%;padding-bottom:4px}
.ear.e2{justify-self:end}
.ear .eh{display:flex;align-items:baseline;gap:8px;font-size:11.5px;font-weight:700;letter-spacing:.12em;color:var(--ink3)}
.ear .eh b{font:700 21px/1 var(--serif);letter-spacing:-.01em;color:var(--ink);margin-inline-start:auto}
.ear .eh small{font-size:10.5px;font-weight:500;letter-spacing:.04em;color:var(--ink4)}
.ear .es{display:flex;align-items:baseline;flex-wrap:wrap;gap:2px 7px;margin-top:7px;font-size:12.5px;color:var(--ink3);line-height:1.45}.ear .es u{align-self:center}.ear .es strong{white-space:nowrap}
.ear .es strong{color:var(--ink);font-weight:600}
.ear .es u{flex:none;width:7px;height:7px;border-radius:50%;background:var(--ink4);text-decoration:none}
.ear .es u.open{position:relative;background:var(--ok);box-shadow:0 0 0 3px color-mix(in srgb,var(--ok) 22%,transparent)}
.ear .es u.open::after{content:"";position:absolute;inset:0;border-radius:50%;background:var(--ok);opacity:0;animation:halo 3s var(--e-out) infinite;animation-delay:var(--d,0s)}
.ear .es u.pre,.ear .es u.post{background:var(--amber)}
.rail{position:relative;height:6px;border-radius:3px;background:var(--rule);margin-top:12px}
.rail s{position:absolute;top:0;bottom:0;border-radius:3px;text-decoration:none;background:var(--rule2)}
.rail s.open{background:var(--ink)}.rail.on s.open.cur{background:var(--ok)}
.rail s.pre,.rail s.post{background:var(--ink4);opacity:.55}
.rail em{position:absolute;top:-5px;bottom:-5px;width:2px;margin-inline-start:-1px;background:var(--red);border-radius:1px}
.rail.idle s.open{background:var(--ink3)}.rail.idle s{opacity:.55}
.rax{position:relative;height:28px;margin-top:6px;font-size:10px;color:var(--ink4);line-height:1.3}
.rax span{position:absolute;transform:translateX(-50%);white-space:nowrap;text-align:center}[dir=rtl] .rax span{transform:translateX(50%)}
.rax span.a0{transform:none;text-align:start}.rax span.a1,[dir=rtl] .rax span.a1{transform:none;inset-inline-start:auto!important;inset-inline-end:0;text-align:end}
.rax b{display:block;font-weight:500;color:var(--ink3)}.rax i{display:block;font-style:normal}
.rnote{font-size:10.5px;color:var(--ink4);margin-top:2px}
[dir=rtl] .mast p,[dir=rtl] .mkick,[dir=rtl] .ear .eh,[dir=rtl] .kick,[dir=rtl] .sec,[dir=rtl] .lbl{letter-spacing:0}
.tabs{position:sticky;top:calc(47px + env(safe-area-inset-top));z-index:19;background:var(--bar);-webkit-backdrop-filter:blur(18px) saturate(1.4);backdrop-filter:blur(18px) saturate(1.4)}
.tabs .wrap>div{position:relative;display:flex;align-items:center;gap:26px;height:45px;border-top:3px double var(--ink);border-bottom:1px solid var(--ink)}
.tab{position:relative;font-size:13.5px;font-weight:600;color:var(--ink3);white-space:nowrap;height:100%;display:inline-flex;align-items:center;gap:6px;transition:color .2s}
.tab i{font-style:normal;font-weight:400;font-size:12px;color:var(--ink4)}
.tab:hover{color:var(--ink)}
.tab.on{color:var(--red)}
/* 选中标签下面的红线：一条线在标签之间滑动 */
.ink{position:absolute;left:0;bottom:-1px;width:1px;height:2px;background:var(--red);transform-origin:0 50%;transition:transform .36s var(--e-out);pointer-events:none;opacity:0}.ink.on{opacity:1}
.tab i{display:inline-block}
.sum{margin-inline-start:auto;font-size:12px;color:var(--ink3);white-space:nowrap;display:flex;gap:10px;align-items:center;overflow:hidden}
.sum b{color:var(--red);font-weight:600}
.sum button{color:var(--red);font-size:12px;text-decoration:underline;text-underline-offset:3px}

/* ---------- 通用小件 ---------- */
.kick{font-size:11.5px;font-weight:700;letter-spacing:.14em;color:var(--red);margin-bottom:14px;display:flex;align-items:center;gap:10px}
.sec{display:flex;align-items:center;justify-content:space-between;font-size:11.5px;letter-spacing:.14em;font-weight:700;border-top:3px solid var(--ink);padding-top:10px;margin-bottom:4px}
.sec button{flex:none;font-size:12px;letter-spacing:0;color:var(--ink2);font-weight:600}.sec button:hover{color:var(--ink);text-decoration:underline;text-underline-offset:3px}
.sec small,.rank h3 small{font-size:11.5px;font-weight:400;letter-spacing:0;color:var(--ink3);margin-inline-start:10px}
.sec span{min-width:0}
/* 标记体系（全站统一）：
   1 评分 .sc —— 重要程度，只有它和头条用朱红：8 分以上红底，6 分以上黑框，其余灰字；
   2 署名 .by —— 来源（黑）+ 时间（灰），后面跟类型标签 .tg（深度）、译、自选/收藏（琥珀色）；
   3 关联 .rc —— 同一形状的小胶囊，各带一个图标：来源证实 / 同一事件 / 深度解读 / 关联快讯 / 已合并。 */
.meta{min-width:0}
.by{font-size:12.5px;color:var(--ink3);display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center}
.by b{color:var(--ink);font-weight:600}
.sc{display:inline-block;flex:none;min-width:30px;text-align:center;font:700 12px/1 var(--mono);letter-spacing:-.03em;padding:5px 6px;border-radius:4px;color:var(--ink3)}
.sc.s2{color:var(--ink);box-shadow:inset 0 0 0 1.5px var(--ink2)}
.sc.s3{background:var(--red);color:var(--on-red)}
.tg{font-size:10.5px;font-weight:700;letter-spacing:.06em;color:var(--bg);background:var(--violet);border-radius:3px;padding:0 5px;line-height:16px;white-space:nowrap}
.rels{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.rc{--c:var(--ink3);display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:500;line-height:1;color:color-mix(in srgb,var(--c) 55%,var(--ink));white-space:nowrap;padding:4px 9px;padding-inline-start:7px;border-radius:999px;background:color-mix(in srgb,var(--c) 11%,transparent)}
.rc svg{width:12px;height:12px;flex:none;color:var(--c)}
.rc b{font-weight:700;color:color-mix(in srgb,var(--c) 35%,var(--ink))}
.rc.cfm{--c:var(--ok)}.rc.evt{--c:var(--blue)}.rc.dpc{--c:var(--violet)}
.tg.fl{background:var(--ink2)}
button.rc,.chipb,.btn,.px button,.crumb button,.pmin button{transition:background .15s,box-shadow .15s,border-color .15s,color .15s,opacity .15s,transform .14s var(--e-out)}
@media (hover:hover){.btn:active,.ib:active,.chipb:active,button.rc:active,.px button:active,.crumb button:active,.pmin button:active,.th button:active{transform:scale(.95)}}
button.rc::after{content:"";width:5px;height:5px;border-top:1.5px solid var(--c);border-inline-end:1.5px solid var(--c);transform:rotate(45deg);margin-inline-start:1px}
[dir=rtl] button.rc::after{transform:rotate(-45deg)}
button.rc:hover{background:color-mix(in srgb,var(--c) 20%,transparent)}
.hit{font:500 11px/1 var(--mono);letter-spacing:-.02em;padding:4px 6px;border-radius:3px;color:var(--ink3);box-shadow:inset 0 0 0 1px var(--rule2);white-space:nowrap}
.wh{color:var(--amber);font-size:11.5px;font-weight:600;white-space:nowrap}
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
.crumb{position:sticky;top:var(--top,92px);z-index:15;display:flex;align-items:center;gap:14px;margin:14px 0 4px;padding-block:8px;padding-inline:8px 14px;border:1px solid var(--rule);border-radius:999px;background:var(--bar);-webkit-backdrop-filter:blur(18px) saturate(1.4);backdrop-filter:blur(18px) saturate(1.4);font-size:13px;color:var(--ink3);width:fit-content;max-width:100%;box-shadow:0 6px 20px -12px rgba(0,0,0,.35)}
.crumb button{display:inline-flex;align-items:center;gap:4px;font-weight:700;color:var(--bg);background:var(--ink);border-radius:999px;padding:6px 14px 6px 8px;white-space:nowrap}.crumb button svg{width:15px;height:15px}[dir=rtl] .crumb button svg{transform:scaleX(-1)}
.crumb span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.figs{display:flex;flex-wrap:wrap;gap:22px 0;margin-top:30px;padding-top:22px;border-top:1px solid var(--rule)}
.fig{flex:1 1 0;min-width:130px;padding-inline:22px;border-inline-start:1px solid var(--rule)}
.fig:first-child{padding-inline-start:0;border:0}
.fig b{display:flex;align-items:baseline;gap:8px;font:700 46px/1 var(--serif);letter-spacing:-.03em;white-space:nowrap}
.fig b u{text-decoration:none;font:600 15px/1 var(--sans);letter-spacing:0;color:var(--ink2)}
.fig b i{font-style:normal;font-size:17px;align-self:center}.fig b i.up{color:var(--ok)}.fig b i.dn{color:var(--red)}
.fig>span{display:block;margin-top:9px;font-size:12.5px;line-height:1.4;color:var(--ink3);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.also{margin-top:28px;max-width:44em}
.also .hd,.d-sec{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:11.5px;font-weight:700;letter-spacing:.12em;color:var(--ink3);padding-bottom:10px}
.also .hd button,.d-sec button{font-size:12px;font-weight:600;letter-spacing:0;color:var(--blue)}.also .hd button:hover,.d-sec button:hover{text-decoration:underline;text-underline-offset:3px}
[dir=rtl] .also .hd,[dir=rtl] .d-sec{letter-spacing:0}
/* 事件脉络：左边时间，中间一条竖线和圆点，右边评分 + 标题 + 来源 */
.tl{position:relative;display:grid;grid-template-columns:44px 15px minmax(0,1fr);column-gap:12px;padding-bottom:16px;font-size:14px;line-height:1.4}
.tl:last-child{padding-bottom:0}
.tl time{font-size:12.5px;color:var(--ink3);padding-top:2px;text-align:end}
.tl .dot{position:relative}
.tl .dot::before{content:"";position:absolute;inset-inline-start:7px;top:0;bottom:-16px;width:1px;background:var(--rule2)}
.tl:first-of-type .dot::before{top:8px}.tl:last-child .dot::before{bottom:auto;height:8px}
.tl:only-of-type .dot::before{display:none}
.tl .dot::after{content:"";position:absolute;inset-inline-start:3px;top:5px;width:9px;height:9px;border-radius:50%;background:var(--bg);box-shadow:inset 0 0 0 2px var(--blue)}
.tl.cur .dot::after{background:var(--red);box-shadow:0 0 0 3px var(--red-soft)}
.tl .lt{font-family:var(--serif);font-size:15.5px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.tl.cur .lt{font-weight:700}
.tl small{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center;color:var(--ink3);font-size:11.5px;margin-top:4px}
.tl small em{font-style:normal;font-weight:600;color:var(--blue)}.tl.cur small em{color:var(--red)}
@media (hover:hover){.tl:hover .lt{text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:4px}}
.d-ev{margin-top:20px;border-top:1px solid var(--rule2);padding-top:14px}
.d-ev .tl:not(.cur) .dot::after{background:color-mix(in srgb,var(--bg) 86%,transparent)}
.chipb{display:inline-flex;align-items:center;gap:4px;font:600 11.5px/1 var(--mono);letter-spacing:-.02em;color:var(--ink);padding:5px 8px;border-radius:5px;box-shadow:inset 0 0 0 1px var(--rule2);white-space:nowrap}
.chipb:hover{box-shadow:inset 0 0 0 1px var(--ink3);background:var(--glass2)}
.chipb.tp{font-family:var(--sans);letter-spacing:0;color:color-mix(in srgb,var(--blue) 60%,var(--ink));box-shadow:none;background:color-mix(in srgb,var(--blue) 11%,transparent)}
.mood{font-size:12px;font-weight:700}.mood.up{color:var(--ok)}.mood.dn{color:var(--red)}
.tkr{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:10px;width:100%;padding:8px 0;border:0;border-top:1px solid var(--rule);background:none;color:inherit;font:inherit;text-align:start;cursor:pointer}
.tkr b{font:700 13px/1 var(--sans);letter-spacing:.02em;min-width:46px}.tkr span{font-size:12.5px;color:var(--ink3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tkr em{font-style:normal;font-size:12.5px;font-weight:700}.tkr u{transform-origin:0 50%;grid-column:1/-1;display:block;height:3px;border-radius:2px;background:var(--ink);opacity:.75;text-decoration:none;margin-top:-2px}.tkr.h u{background:var(--red);opacity:1}
.tkr b{transition:color .15s}.tkr:hover b{color:var(--red)}[dir=rtl] .tkr u{transform-origin:100% 50%}
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
.show-top b{font:800 22px/1 HWMast,var(--serif);color:var(--ink)}
.show-top button{width:34px;height:34px;border-radius:50%;border:1px solid var(--rule2);display:grid;place-items:center;color:var(--ink2)}
.show-top svg{width:13px;height:13px}
.show-body{position:relative;flex:1;display:flex;flex-direction:column;justify-content:center;max-width:1500px;animation:rise .6s var(--e-out)}
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
.d-rel{margin-top:18px;border-top:1px solid var(--rule2);padding-top:12px}
.d-rel-h{font-size:11px;font-weight:600;letter-spacing:.06em;color:var(--ink3);margin-bottom:6px}
.d-rel-a{display:grid;grid-template-columns:auto 1fr;gap:10px;align-items:start;padding:8px 0;border-bottom:1px solid var(--rule2);color:var(--ink);text-decoration:none}
.d-rel-a:hover span{color:var(--red)}
.d-rel-a .sc{margin-top:1px}
.d-rel-a small{display:block;margin-top:2px;font-size:11px;color:var(--ink4)}
.trb{font-size:10.5px;color:var(--ink4);border:1px solid var(--rule2);border-radius:3px;padding:0 4px;line-height:15px;white-space:nowrap}
.ring{--p:80;position:relative;flex:none;width:68px;height:68px;border-radius:50%;background:conic-gradient(var(--red) calc(var(--p)*1%),var(--rule) 0);display:grid;place-items:center}
.ring::before{content:"";position:absolute;inset:5px;border-radius:50%;background:var(--bg)}
.ring span{position:relative;font:700 23px/1 var(--serif);letter-spacing:-.03em}
.ring.mid{background:conic-gradient(var(--ink2) calc(var(--p)*1%),var(--rule) 0)}
.ring.lo{background:conic-gradient(var(--ink4) calc(var(--p)*1%),var(--rule) 0)}.ring.lo span{color:var(--ink3)}
[data-id]{cursor:pointer}

/* ---------- 简报 ---------- */
.top{display:grid;grid-template-columns:1.55fr 1fr;gap:44px;padding:32px 0 30px}
.hero h2{margin:0 0 18px;font:700 52px/1.08 var(--serif);letter-spacing:-.025em;word-break:break-word}
.hero h2.zh{font-size:44px;line-height:1.2;letter-spacing:0}
.hero p{font:19px/1.6 var(--serif);color:var(--ink2);margin:0 0 22px;max-width:34em;overflow-wrap:anywhere}
.hero .foot{display:flex;align-items:center;gap:16px}.hero .foot .by{font-size:13.5px}
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
.topic h3 span{font:500 12px/1 var(--sans);letter-spacing:0;color:var(--blue);white-space:nowrap}
.topic .cnt{font-size:12.5px;color:var(--ink3);margin:3px 0 8px}
.li{display:grid;grid-template-columns:auto 1fr;gap:10px;padding:9px 0;border-top:1px solid var(--rule);font-size:13.5px;line-height:1.4}
.li .lt{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.li small{display:block;color:var(--ink3);font-size:11.5px;margin-top:2px}
.low{display:grid;grid-template-columns:1.55fr 1fr;gap:44px;padding-bottom:60px}
.g3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0 28px}
.card{padding:16px 0;border-bottom:1px solid var(--rule)}
.card h4{margin:0 0 8px;font:700 17.5px/1.34 var(--serif);display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.card p{margin:0 0 10px;font-size:13.5px;line-height:1.5;color:var(--ink3);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.wire{padding-inline-start:36px;border-inline-start:1px solid var(--rule)}
.w{display:grid;grid-template-columns:42px minmax(0,1fr) auto;gap:10px;align-items:start;padding:10px 0;border-bottom:1px dotted var(--rule2);font-size:14px;line-height:1.45}
.w time{color:var(--ink3);font-size:12.5px;padding-top:1px}
.w .sc{margin-top:-1px}
.w .tg{margin-inline-start:6px;vertical-align:1px}
.w.h .wt{font-weight:700}
.w small{display:block;color:var(--ink3);font-size:11.5px;margin-top:2px}

/* ---------- 列表视图 ---------- */
.list{padding:8px 0 80px}
.day{position:sticky;top:var(--top);z-index:3;background:var(--bar);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);display:flex;gap:10px;align-items:baseline;padding:12px 0 8px;font:700 15px/1 var(--serif);border-bottom:1px solid var(--ink)}
.day span{font:400 12px/1 var(--sans);color:var(--ink3)}
.row{position:relative;transition:background-color .2s,box-shadow .2s;display:grid;grid-template-columns:48px 36px minmax(0,1fr) auto;column-gap:14px;align-items:baseline;padding:12px 0;border-bottom:1px solid var(--rule)}
.row .t{color:var(--ink3);font-size:12.5px}
.row .h{font:400 16.5px/1.42 var(--serif);color:var(--ink2);word-break:break-word}
.row.m .h{color:var(--ink)}
.row.imp .h{color:var(--ink);font-weight:700;font-size:18px}
.row .x{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px;align-items:center}
.row .xi{display:inline-flex;gap:8px;margin-inline-start:10px;vertical-align:2px;align-items:center}
.row .src{font-size:12px;color:var(--ink3);white-space:nowrap;max-width:160px;overflow:hidden;text-overflow:ellipsis}
.row.sel{background:var(--red-soft);box-shadow:-12px 0 0 var(--red-soft),12px 0 0 var(--red-soft)}
@media (hover:hover){.row:hover .h{text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:4px}}
/* 新到的快讯：底色淡淡亮一下，左边一条细线停留几秒再淡出（重要的用朱红，其余用墨色）。--nd 让重新渲染后动画接着走，不重头来 */
.row.new{animation:flash 2.2s var(--e-out);animation-delay:var(--nd,0s)}
@keyframes flash{0%{background:color-mix(in srgb,var(--mark) 62%,transparent)}100%{background:transparent}}
.row.new::before{content:"";position:absolute;inset-block:12px;inset-inline-start:-14px;width:2px;border-radius:1px;background:var(--ink2);transform-origin:50% 0;animation:newbar 7s var(--e-out) both;animation-delay:var(--nd,0s)}
.row.new.imp::before{background:var(--red)}
@keyframes newbar{0%{transform:scaleY(0);opacity:1}7%{transform:scaleY(1)}75%{transform:scaleY(1);opacity:1}100%{transform:scaleY(1);opacity:0}}
.seen{display:flex;align-items:center;gap:12px;font-size:11.5px;font-weight:700;letter-spacing:.08em;color:var(--red);padding:10px 0}
.seen::before,.seen::after{content:"";flex:1;height:1px;background:var(--red);opacity:.5}
.empty{text-align:center;color:var(--ink3);padding:90px 24px;font-size:14px}
.empty b{display:block;color:var(--ink);font:700 22px/1.3 var(--serif);margin-bottom:8px}
.empty button{margin-top:18px}
.morebox{text-align:center;padding:28px 0 0;font-size:13px;color:var(--ink3)}
.morebox .btn[disabled]{opacity:.5;cursor:default}
.sk{height:14px;border-radius:3px;background:linear-gradient(90deg,var(--rule) 0,var(--rule2) 45%,var(--rule) 90%);background-size:220% 100%;margin:22px 0;animation:sk 1.5s linear infinite}
@keyframes sk{from{background-position:120% 0}to{background-position:-100% 0}}

/* ---------- 阅读面板 ---------- */
.scrim{position:fixed;inset:0;z-index:30;background:rgba(20,14,8,.36);opacity:0;pointer-events:none;transition:opacity .22s linear}
.open-reader .scrim,.open-side .scrim{opacity:1;pointer-events:auto}
.panel{position:fixed;z-index:31;top:12px;max-height:calc(100vh - 24px);max-height:calc(100dvh - 24px);inset-inline-end:12px;width:min(460px,calc(100vw - 24px));overflow-y:auto;border-radius:22px;background:color-mix(in srgb,var(--bg) 86%,transparent);box-shadow:var(--shadow2),0 0 0 1px var(--glass-edge);transform:translateX(64px);opacity:0;transition:transform .2s var(--e-in),opacity .16s linear,visibility 0s linear .2s;visibility:hidden;scrollbar-width:thin}
[dir=rtl] .panel{transform:translateX(-64px)}
/* 打开：短距离滑入加淡入，快进慢出；关闭更快，不拖泥带水 */
.open-reader #reader,.open-side #side{transform:none;opacity:1;visibility:visible;transition:transform .36s var(--e-out),opacity .2s linear,visibility 0s}
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
.d .rels{margin:-6px 0 16px}
.d-facts{margin:0 0 16px;border-top:1px solid var(--rule);font-size:12.5px}
.d-facts div{display:grid;grid-template-columns:84px 1fr;gap:10px;padding:8px 0;border-bottom:1px solid var(--rule);align-items:baseline}
.d-facts dt,.d-facts div>span:first-child{color:var(--ink3)}
.d-facts div>span:last-child{color:var(--ink);display:flex;flex-wrap:wrap;gap:6px;min-width:0;align-items:center}
.legend{display:grid;gap:9px;font-size:12.5px;color:var(--ink2);padding:4px 26px 8px}
.legend>div{display:grid;grid-template-columns:64px 1fr;gap:10px;align-items:center}
.legend>div>span:first-child{display:flex;gap:4px;align-items:center}
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
.psub{padding:6px 26px 4px;font-size:11.5px;font-weight:700;letter-spacing:.12em;color:var(--ink3)}
.pmin{display:flex;flex-wrap:wrap;gap:6px;padding:2px 26px 0}
.pmin button{display:flex;flex-direction:column;align-items:center;min-width:56px;padding:6px 10px;border:1px solid var(--rule2);border-radius:12px;font-size:13px;font-weight:700;color:var(--ink2);line-height:1.2}
.pmin button small{font-size:10.5px;font-weight:500;color:var(--ink3)}
.pmin button.on{background:var(--ink);border-color:var(--ink);color:var(--bg)}
.pmin button.on small{color:var(--bg);opacity:.75}
.qh{display:flex;align-items:center;gap:6px}
.qh select{font:inherit;font-size:13px;color:var(--ink);background:transparent;border:1px solid var(--rule2);border-radius:8px;padding:4px 6px}
.sw{flex:none;width:36px;height:20px;border-radius:10px;background:var(--rule2);position:relative;transition:background .2s}
.sw::after{content:"";position:absolute;top:2px;inset-inline-start:2px;width:16px;height:16px;border-radius:50%;background:var(--bg);transition:transform .26s var(--e-spring)}
.sw[aria-pressed=true]{background:var(--red)}
.sw[aria-pressed=true]::after{transform:translateX(16px)}
[dir=rtl] .sw[aria-pressed=true]::after{transform:translateX(-16px)}
.seg{display:inline-flex;border:1px solid var(--rule2);border-radius:999px;padding:2px;flex:none}
.seg button{font-size:12px;color:var(--ink3);padding:4px 10px;border-radius:999px;font-weight:600}
.seg button.on{background:var(--ink);color:var(--bg)}
.keys{padding:4px 26px 20px;font-size:12px;color:var(--ink3);line-height:2.1}
.keys kbd{font:500 10.5px/1 var(--mono);border:1px solid var(--rule2);border-radius:3px;padding:2px 5px;color:var(--ink2);margin-inline-end:3px}
.keys span{margin-inline-end:12px;white-space:nowrap;display:inline-block}

.pill{position:fixed;left:50%;top:calc(var(--top) + 14px);transform:translate(-50%,-110px);z-index:15;border-radius:999px;background:var(--ink);color:var(--bg);font-size:13px;font-weight:600;padding:9px 16px;box-shadow:var(--shadow2);transition:transform .45s var(--e-spring);white-space:nowrap}
.pill.show{transform:translate(-50%,0)}
.pill.hot{background:var(--red);color:#fff}
.tip{position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:40;background:var(--ink);color:var(--bg);font-size:13px;padding:9px 15px;border-radius:999px;opacity:0;pointer-events:none;transform:translate(-50%,10px) scale(.96);transition:opacity .18s linear,transform .32s var(--e-out);max-width:88vw;text-align:center}
.tip.show{opacity:1;transform:translate(-50%,0)}
::view-transition-old(root),::view-transition-new(root){animation-duration:.3s}.tip.act{pointer-events:auto;cursor:pointer}

/* ---------- 窄一些的电脑窗口和平板：两个市场排到标题下面，各占一半 ---------- */
@media (max-width:1240px){
  .mast{grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px 28px;align-items:start}.mc{grid-column:1/-1;grid-row:1}.ear{max-width:none}
}
/* ---------- 平板 ---------- */
@media (max-width:1080px){
  .wrap{padding-inline:26px}
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
  .mast{padding-block:18px 16px;gap:16px 18px}.mast h1{font-size:35px}.mast p{font-size:10.5px;letter-spacing:.14em;margin-top:9px}.mkick{font-size:10px;letter-spacing:.16em}
  .mseg{margin-top:12px}.mseg button{padding:6px 16px}
  .ear .eh b{font-size:18px}.ear .eh small{display:none}.ear .es{font-size:11.5px;flex-wrap:wrap;white-space:normal;row-gap:2px}.rax{height:14px}.rax i,.rax .ae{display:none}.rail{margin-top:9px}
  .tabs{top:calc(49px + env(safe-area-inset-top))}
  .tabs .wrap>div{gap:22px;overflow-x:auto;scrollbar-width:none}.ink{bottom:0}
  .tabs .wrap>div::-webkit-scrollbar{display:none}
  .sum{display:none}
  .top{padding:24px 0 26px}
  .hero h2{font-size:32px;line-height:1.14}.hero h2.zh{font-size:28px;line-height:1.28}
  .hero p{font-size:17px}
  .ring{width:56px;height:56px}.ring span{font-size:19px}
  .figs{margin-top:24px;padding-top:18px}.fig{padding-inline:14px;min-width:96px}.fig b{font-size:34px}.fig b u{font-size:13px}
  .rk{grid-template-columns:36px 1fr}.rk em{font-size:28px}.rk h4{font-size:18px}
  .now{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;gap:12px;margin-inline:-18px;padding:4px 18px 30px;scrollbar-width:none}
  .now::-webkit-scrollbar{display:none}
  .now .tile{flex:0 0 78%;scroll-snap-align:center}
  .g3{grid-template-columns:1fr}
  .low{padding-bottom:40px}
  .row{grid-template-columns:auto minmax(0,1fr) auto;grid-template-areas:"t src s" "c c c";column-gap:10px;row-gap:6px;padding:13px 0;align-items:center}
  .row .t{grid-area:t}.row .src{grid-area:src;max-width:none}.row .sc{grid-area:s;justify-self:end}.row .c{grid-area:c}
  .row .h{font-size:17px}.row.imp .h{font-size:18.5px}
  .row .x{margin:7px 0 0}
  .panel{top:auto;bottom:0;inset-inline:0;width:auto;max-height:86vh;max-height:86dvh;border-radius:22px 22px 0 0;transform:translateY(105%);opacity:1;transition:transform .24s var(--e-in),visibility 0s linear .24s;padding-bottom:env(safe-area-inset-bottom)}
  [dir=rtl] .panel{transform:translateY(105%)}
  .open-reader #reader,.open-side #side{transition:transform .42s var(--e-out),visibility 0s}
  .keysec{display:none}
  .d{padding-inline:22px}.d h2{font-size:24px}
  .sh,.grp,.so,.set,.wform,.wchips{padding-inline:22px}.whint{margin-inline:22px}
  #pbtn{display:none}.show-top span[data-i]{display:none}
}
@media (prefers-reduced-motion:reduce){*:not(#showBar),*::before,*::after{animation:none!important;transition:none!important}}
`;

const JS = String.raw`
var I18N={
zh:{newVer:'有新版本，点这里刷新',thisDay:'今日交易日 {0}',lPre:'盘前',lOpen:'开盘',lClose:'收盘',nextDay:'下一交易日 {0}',yourT:'你的时间 {0}',backTo:'返回{0}',crumbQ:'正在看：{0}',crumbN:'{0} 条',related:'同一事件还有 {0} 条',alsoH:'事件脉络',alsoAll:'查看全部 {0} 条 →',tlFirst:'首次报道',tlLead:'头条',tlNow:'当前这条',fSrc:'家来源证实',fEv:'条相关快讯',fAge:'首次报道至今',fH:'小时',fM:'分钟',dEv:'同一事件',dTk:'相关股票',dTp:'话题',dDir:'方向',dUp:'利好',dDn:'利空',topSub:'按评分排序，同一事件只列一条',moreSub:'8 分以上，最新在前',wireSub:'全部来源，最新在前',cfBy:'证实来源',hitL:'命中规则',noBodyArt:'这篇文章只抓到了标题，点「打开原文」读全文。',lgT:'标记说明',lg3:'8 分以上，重要',lg2:'6 到 8 分，值得关注',lg1:'6 分以下，常规消息',lgDeep:'解读文章，不是快讯',lgCf:'多家来源报了同一条',lgEv:'同一件事的其他快讯',lgDp:'有相关的深度文章',lgMine:'命中你的自选词 / 已收藏',staleAt:'连接中断，上次更新 {0}',refreshTip:'点击立即刷新',refreshed:'已是最新',sOpen:'开盘中',sPre:'盘前交易',sPost:'盘后交易',sClosed:'休市',nClose:'{0}后收盘',nOpen:'{0}后开盘',nEnd:'{0}后结束',early:'今日提前至 13:00 收盘',dD:'{0} 天 {1} 小时',dH:'{0} 小时 {1} 分',dM:'{0} 分钟',nowL:'现在',yourTime:'刻度为你的本地时间',mAll:'全部市场',mUS:'美股',mSA:'沙特',vsAll:'与平常的对比只在「全部市场」下显示',tag:'美国股市 · 沙特股市　实时要闻',live:'实时更新',updated:'{0} 更新',fail:'连接失败，自动重试中',ny:'纽约',ry:'利雅得',mOpen:'开盘',mClosed:'休市',mPre:'盘前',mPost:'盘后',mNote:'按常规交易时段判断，不含节假日',
 search:'搜索标题和摘要',cancel:'取消',settings:'来源与设置',brief:'简报',hot:'重要',mid:'6 分以上',all:'全部',deep:'深度',deepB:'深度',flashB:'快讯',nDeep:'深度解读 {0} 篇',nFlash:'关联快讯 {0} 条',lvDeep:'深度文章',byDeep:'解读和评论，不打分、不推送',relArts:'深度解读',relFlash:'关联快讯',
 total:'共 {0} 条 · 每分钟抓取',hidden:'已隐藏 {0} 个来源',searching:'搜索“{0}”',clear:'清除筛选',sinceVisit:'上次查看后新增 <b>{0}</b> 条重要',
 lead:'头条',scoreN:'评分 {0}',topToday:'今日要闻',vsUp:'比平常多 {0}%',vsDown:'比平常少 {0}%',vsFlat:'和平常差不多',vsNone:'对比数据积累中，满一天后显示',vsNote:'对比过去 {0} 天同一时段的平均 {1} 条',senti:'多空情绪',bull:'利好 {0}',bear:'利空 {0}',sentiNote:'按标题关键词估算',sentiAi:'由 AI 逐条判断',sentiNone:'暂无明显多空信号',tkTitle:'热门股票',tkNone:'过去 12 小时没有被多次提到的股票',tkSub:'过去 12 小时被提到的次数，点击筛选',last12:'过去 12 小时',statLine:'条重要快讯，共 {0} 条，来自 {1} 个来源',
 topic:'话题',topicCnt:'{0} 条快讯 · {1} 条重要',timeline:'时间线 →',more:'更多重要快讯',wire:'实时快讯',viewAll:'查看全部 →',
 nSrc:'{0} 个来源证实',merged:'同一事件已合并',pts:'{0} 分',today:'今天',yesterday:'昨天',items:'{0} 条',seenHere:'以上是你上次离开后的新快讯',
 lvHot:'重要快讯',lvNone:'尚未评分',lvHigh:'高分',lvMid:'值得关注',lvLow:'常规消息',byAi:'AI 评分',byRule:'规则评分',byWait:'等待评分',boost:'原始 {0}，多源证实加分',
 noBody:'这条快讯只有标题，没有摘要。',original:'原文',translated:'译',open:'打开原文',copy:'复制标题',copied:'已复制标题',copyFail:'复制失败，请手动选择文字',detail:'快讯详情',
 sources:'来源',selAll:'全选',only:'只看',fetchFail:'最近一次抓取失败：{0}',gFlash:'快讯',gWire:'通讯社与媒体',gCn:'中文快讯',gGulf:'沙特与海湾',gOff:'官方与公告',gOther:'其他',
 alerts:'提醒',sound:'提示音',soundD:'有重要快讯时响一声',notif:'桌面通知',notifD:'有重要快讯时弹出系统通知',notifNo:'这个浏览器不支持',notifDenied:'已被浏览器拒绝，需在浏览器设置里放行',push:'后台推送',pushD:'关掉网页也能收到系统通知',pushDC:'关掉网页也能收到；Chrome 要在后台运行（别按 ⌘Q 退出）',pushOn:'已开启，这台设备会收到推送',pushNo:'这个浏览器不支持后台推送',pushMin:'推送门槛',pushConf:'8 分+多源',perDay:'{0}/天',pushCnt:'按过去 24 小时算，这个门槛大约每天推 {0} 条',pushQuiet:'免打扰',sticky:'通知停在屏幕上',stickyD:'直到你手动关掉；Mac 上会用“提醒”样式，更不容易错过',qOff:'不设',pushTest:'发一条测试推送',pushSent:'已发送，留意屏幕角落的通知',pushFail:'发送失败：{0}',pushOnTip:'后台推送已开启',pushOffTip:'后台推送已关闭',pushErr:'开启失败：{0}',
 look:'外观',theme:'主题',tAuto:'跟随系统',tDark:'深色',tLight:'浅色',keys:'快捷键',kMove:'上下条',kOpen:'打开原文',kSearch:'搜索',kView:'切换视图',kStar:'收藏',kShow:'展示模式',
 eNone:'还没有数据',eNoneD:'部署后等一两分钟，第一批快讯就会出现。',eFilter:'没有符合条件的快讯',eFilterD:'当前的来源筛选或搜索把结果都过滤掉了。',eScore:'暂时没有达到这个分数的快讯',eScoreD:'可以切到“全部”看所有快讯。',eConn:'连接失败',eConnD:'暂时读不到数据，页面会自动重试。',
 newHot:'↑ {0} 条新的重要快讯',newAll:'↑ {0} 条新快讯',trLoad:'翻译模型下载中 {0}%',trEnable:'点此启用快讯翻译',trNo:'此浏览器不支持网页内翻译，快讯显示原文（电脑版 Chrome 可用）',watch:'自选',star:'收藏',wTitle:'自选关注',wPh:'如 NVDA、Aramco、美联储',add:'添加',wHint:'命中这些词的快讯会标出来，并汇总在“自选”一栏',wEmpty:'还没有自选关注',wEmptyD:'在右上角“来源与设置”里添加股票代码或关键词。',wNone:'暂时没有命中自选的快讯',sEmpty:'还没有收藏',sEmptyD:'打开一条快讯，点“收藏”就会出现在这里。',save:'收藏',saved:'已收藏',share:'复制分享文本',shared:'已复制，可直接粘贴',present:'展示模式',pHint:'← → 切换 · 空格暂停 · Esc 退出',pEmpty:'暂时没有重要快讯',src:'来源',loadMore:'加载更早的快讯',loading:'加载中…',noMore:'没有更早的快讯了（数据库保留最近 7 天）',loaded:'已载入 {0} 条 · 每分钟抓取',days:'日一二三四五六',dateFmt:'{0}月{1}日 星期{2}'},
en:{newVer:'New version ready — tap to refresh',thisDay:'Today’s session {0}',lPre:'pre',lOpen:'open',lClose:'close',nextDay:'Next session {0}',yourT:'{0} your time',backTo:'Back to {0}',crumbQ:'Showing: {0}',crumbN:'{0} items',related:'{0} more on this story',alsoH:'HOW IT UNFOLDED',alsoAll:'View all {0} →',tlFirst:'First report',tlLead:'Lead story',tlNow:'This one',fSrc:'sources confirm',fEv:'related flashes',fAge:'since first report',fH:'h',fM:'min',dEv:'SAME STORY',dTk:'Stocks',dTp:'Topic',dDir:'Direction',dUp:'Bullish',dDn:'Bearish',topSub:'Ranked by score, one per story',moreSub:'Score 8+, newest first',wireSub:'All sources, newest first',cfBy:'Confirmed by',hitL:'Rule hits',noBodyArt:'Only the headline was captured. Use Open original to read the article.',lgT:'Legend',lg3:'8 and above: important',lg2:'6 to 8: worth a look',lg1:'Below 6: routine',lgDeep:'Analysis article, not a flash',lgCf:'Several sources ran the same item',lgEv:'More flashes on the same story',lgDp:'Has related in-depth articles',lgMine:'Matches your watchlist / saved',staleAt:'Connection lost, last update {0}',refreshTip:'Click to refresh now',refreshed:'Up to date',sOpen:'Open',sPre:'Pre-market',sPost:'After hours',sClosed:'Closed',nClose:'closes in {0}',nOpen:'opens in {0}',nEnd:'ends in {0}',early:'Early close today at 13:00',dD:'{0}d {1}h',dH:'{0}h {1}m',dM:'{0} min',nowL:'now',yourTime:'Axis shows your local time',mAll:'All markets',mUS:'US',mSA:'Saudi',vsAll:'The comparison with usual is shown for All markets only',tag:'US & SAUDI MARKETS · LIVE WIRE',live:'Live',updated:'updated {0}',fail:'Connection lost, retrying',ny:'New York',ry:'Riyadh',mOpen:'Open',mClosed:'Closed',mPre:'Pre-market',mPost:'After hours',mNote:'Regular session hours; holidays not included',
 search:'Search headlines and summaries',cancel:'Cancel',settings:'Sources & settings',brief:'Briefing',hot:'Important',mid:'Score 6+',all:'All',deep:'In depth',deepB:'IN DEPTH',flashB:'FLASH',nDeep:'{0} in-depth',nFlash:'{0} linked flashes',lvDeep:'In-depth article',byDeep:'Analysis and commentary, not scored or pushed',relArts:'In-depth coverage',relFlash:'Linked flashes',
 total:'{0} items · fetched every minute',hidden:'{0} sources hidden',searching:'Search "{0}"',clear:'Clear filters',sinceVisit:'<b>{0}</b> important since your last visit',
 lead:'LEAD STORY',scoreN:'SCORE {0}',topToday:'TOP STORIES',vsUp:'{0}% busier than usual',vsDown:'{0}% quieter than usual',vsFlat:'About as busy as usual',vsNone:'Comparison appears after a full day of history',vsNote:'vs. an average of {1} in the same hours over the past {0} days',senti:'SENTIMENT',bull:'Bullish {0}',bear:'Bearish {0}',sentiNote:'Estimated from headline keywords',sentiAi:'Judged per headline by AI',sentiNone:'No clear signal yet',tkTitle:'MOST MENTIONED STOCKS',tkNone:'No stock mentioned more than once in the last 12 hours',tkSub:'Mentions in the last 12 hours. Click to filter',last12:'LAST 12 HOURS',statLine:'important flashes out of {0}, from {1} sources',
 topic:'TOPIC',topicCnt:'{0} flashes · {1} important',timeline:'Timeline →',more:'MORE IMPORTANT',wire:'LIVE WIRE',viewAll:'View all →',
 nSrc:'{0} sources confirm',merged:'Merged with same story',pts:'{0}',today:'Today',yesterday:'Yesterday',items:'{0} items',seenHere:'NEW SINCE YOUR LAST VISIT ABOVE THIS LINE',
 lvHot:'Important',lvNone:'Not scored yet',lvHigh:'High score',lvMid:'Worth a look',lvLow:'Routine',byAi:'AI score',byRule:'Rule score',byWait:'Awaiting score',boost:'base {0}, raised by multi-source confirmation',
 noBody:'This flash has a headline only, no summary.',original:'ORIGINAL',translated:'TR',open:'Open original',copy:'Copy headline',copied:'Headline copied',copyFail:'Copy failed, select the text manually',detail:'FLASH DETAIL',
 sources:'SOURCES',selAll:'Select all',only:'Only',fetchFail:'Last fetch failed: {0}',gFlash:'Flash feeds',gWire:'Wires & media',gCn:'Chinese flashes',gGulf:'Saudi & Gulf',gOff:'Official & filings',gOther:'Other',
 alerts:'ALERTS',sound:'Sound',soundD:'Chime on important flashes',notif:'Desktop notifications',notifD:'System notification on important flashes',notifNo:'Not supported in this browser',notifDenied:'Blocked by the browser; allow it in browser settings',push:'Background push',pushD:'System notifications even with the page closed',pushDC:'Works with the page closed; Chrome must keep running in the background (do not quit with Cmd+Q)',pushOn:'On: this device receives pushes',pushNo:'This browser does not support background push',pushMin:'PUSH THRESHOLD',pushConf:'8 + confirmed',perDay:'{0}/day',pushCnt:'Based on the last 24 hours, about {0} pushes a day at this threshold',pushQuiet:'Quiet hours',sticky:'Keep on screen',stickyD:'Stays until you dismiss it (Alert style on Mac), harder to miss',qOff:'Off',pushTest:'Send a test push',pushSent:'Sent. Watch for the notification',pushFail:'Send failed: {0}',pushOnTip:'Background push is on',pushOffTip:'Background push is off',pushErr:'Could not turn on: {0}',
 look:'APPEARANCE',theme:'Theme',tAuto:'System',tDark:'Dark',tLight:'Light',keys:'SHORTCUTS',kMove:'Next / previous',kOpen:'Open original',kSearch:'Search',kView:'Switch view',kStar:'Save',kShow:'Presentation',
 eNone:'No data yet',eNoneD:'The first flashes appear a minute or two after deployment.',eFilter:'Nothing matches',eFilterD:'The current source filter or search hides every flash.',eScore:'Nothing at this score yet',eScoreD:'Switch to "All" to see every flash.',eConn:'Connection failed',eConnD:'Data is unavailable right now. The page retries automatically.',
 newHot:'↑ {0} new important',newAll:'↑ {0} new flashes',trLoad:'Downloading translation model {0}%',trEnable:'Enable flash translation',trNo:'This browser cannot translate in-page, so flashes stay in their original language (desktop Chrome can)',watch:'Watchlist',star:'Saved',wTitle:'WATCHLIST',wPh:'e.g. NVDA, Aramco, Fed',add:'Add',wHint:'Flashes matching these terms are marked and collected under "Watchlist"',wEmpty:'No watchlist yet',wEmptyD:'Add tickers or keywords under "Sources & settings" at the top.',wNone:'No flashes match your watchlist right now',sEmpty:'Nothing saved yet',sEmptyD:'Open a flash and press "Save" to keep it here.',save:'Save',saved:'Saved',share:'Copy share text',shared:'Copied, ready to paste',present:'Presentation mode',pHint:'← → to move · Space to pause · Esc to exit',pEmpty:'No important flashes right now',src:'Source',loadMore:'Load earlier flashes',loading:'Loading…',noMore:'No earlier flashes (the database keeps the last 7 days)',loaded:'{0} loaded · fetched every minute',days:['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],dateFmt:'{2}, {3} {1}'},
ar:{newVer:'نسخة جديدة جاهزة — اضغط للتحديث',thisDay:'جلسة اليوم {0}',lPre:'قبل الافتتاح',lOpen:'الافتتاح',lClose:'الإغلاق',nextDay:'الجلسة التالية {0}',yourT:'{0} بتوقيتك',backTo:'العودة إلى {0}',crumbQ:'المعروض: {0}',crumbN:'{0} خبر',related:'{0} أخبار ذات صلة',alsoH:'تسلسل الحدث',alsoAll:'عرض الكل ({0}) ←',tlFirst:'أول خبر',tlLead:'الخبر الرئيسي',tlNow:'هذا الخبر',fSrc:'مصادر أكدته',fEv:'أخبار ذات صلة',fAge:'منذ أول خبر',fH:'س',fM:'د',dEv:'الخبر نفسه',dTk:'الأسهم',dTp:'الموضوع',dDir:'الاتجاه',dUp:'إيجابي',dDn:'سلبي',topSub:'مرتبة حسب التقييم، خبر واحد لكل حدث',moreSub:'تقييم 8 فأكثر، الأحدث أولًا',wireSub:'كل المصادر، الأحدث أولًا',cfBy:'أكدته',hitL:'القواعد المطابقة',noBodyArt:'لم يُلتقط سوى العنوان. استخدم «فتح المصدر» لقراءة المقال.',lgT:'دليل العلامات',lg3:'8 فأكثر: مهم',lg2:'من 6 إلى 8: جدير بالمتابعة',lg1:'أقل من 6: اعتيادي',lgDeep:'مقال تحليلي وليس خبرًا عاجلًا',lgCf:'نشرته عدة مصادر',lgEv:'أخبار أخرى عن الحدث نفسه',lgDp:'له مقالات تحليلية مرتبطة',lgMine:'يطابق قائمة متابعتك / محفوظ',staleAt:'انقطع الاتصال، آخر تحديث {0}',refreshTip:'انقر للتحديث الآن',refreshed:'محدَّث',sOpen:'مفتوح',sPre:'قبل الافتتاح',sPost:'بعد الإغلاق',sClosed:'مغلق',nClose:'يغلق بعد {0}',nOpen:'يفتح بعد {0}',nEnd:'ينتهي بعد {0}',early:'إغلاق مبكر اليوم 13:00',dD:'{0} ي {1} س',dH:'{0} س {1} د',dM:'{0} د',nowL:'الآن',yourTime:'المحور بتوقيتك المحلي',mAll:'كل الأسواق',mUS:'الأمريكي',mSA:'السعودي',vsAll:'المقارنة بالمعتاد تظهر لكل الأسواق فقط',tag:'السوقان الأمريكي والسعودي · أخبار لحظية',live:'مباشر',updated:'آخر تحديث {0}',fail:'انقطع الاتصال، جارٍ إعادة المحاولة',ny:'نيويورك',ry:'الرياض',mOpen:'مفتوح',mClosed:'مغلق',mPre:'قبل الافتتاح',mPost:'بعد الإغلاق',mNote:'وفق ساعات التداول الاعتيادية، دون العطل',
 search:'ابحث في العناوين والملخصات',cancel:'إلغاء',settings:'المصادر والإعدادات',brief:'الموجز',hot:'المهم',mid:'6 فأكثر',all:'الكل',deep:'تحليلات',deepB:'تحليل',flashB:'خبر',nDeep:'{0} تحليل',nFlash:'{0} أخبار مرتبطة',lvDeep:'مقال تحليلي',byDeep:'تحليل وتعليق، بلا تقييم ولا إشعار',relArts:'مقالات تحليلية ذات صلة',relFlash:'الأخبار التي يتناولها المقال',
 total:'{0} خبر · تحديث كل دقيقة',hidden:'{0} مصادر مخفية',searching:'بحث «{0}»',clear:'مسح التصفية',sinceVisit:'<b>{0}</b> أخبار مهمة منذ زيارتك الأخيرة',
 lead:'الخبر الرئيسي',scoreN:'التقييم {0}',topToday:'أبرز أخبار اليوم',vsUp:'أكثر نشاطًا من المعتاد بنسبة {0}%',vsDown:'أهدأ من المعتاد بنسبة {0}%',vsFlat:'قريب من المعتاد',vsNone:'تظهر المقارنة بعد يوم كامل من البيانات',vsNote:'مقارنة بمتوسط {1} في الساعات نفسها خلال {0} أيام',senti:'معنويات السوق',bull:'إيجابي {0}',bear:'سلبي {0}',sentiNote:'تقدير من كلمات العناوين',sentiAi:'تقييم الذكاء الاصطناعي لكل عنوان',sentiNone:'لا إشارة واضحة بعد',tkTitle:'الأسهم الأكثر ذكرًا',tkNone:'لا سهم ذُكر أكثر من مرة في آخر 12 ساعة',tkSub:'عدد مرات الذكر في آخر 12 ساعة. انقر للتصفية',last12:'آخر 12 ساعة',statLine:'خبرًا مهمًا من أصل {0}، من {1} مصدرًا',
 topic:'موضوع',topicCnt:'{0} خبر · {1} مهم',timeline:'التسلسل الزمني ←',more:'أخبار مهمة أخرى',wire:'الأخبار العاجلة',viewAll:'عرض الكل ←',
 nSrc:'أكدته {0} مصادر',merged:'مدمج مع الخبر نفسه',pts:'{0}',today:'اليوم',yesterday:'أمس',items:'{0} خبر',seenHere:'ما فوق هذا الخط جديد منذ زيارتك الأخيرة',
 lvHot:'خبر مهم',lvNone:'لم يُقيَّم بعد',lvHigh:'تقييم مرتفع',lvMid:'جدير بالمتابعة',lvLow:'خبر اعتيادي',byAi:'تقييم الذكاء الاصطناعي',byRule:'تقييم القواعد',byWait:'بانتظار التقييم',boost:'الأساس {0}، ورُفع لتأكيد عدة مصادر',
 noBody:'هذا الخبر عنوان فقط دون ملخص.',original:'النص الأصلي',translated:'مترجم',open:'فتح المصدر',copy:'نسخ العنوان',copied:'تم نسخ العنوان',copyFail:'تعذّر النسخ، حدّد النص يدويًا',detail:'تفاصيل الخبر',
 sources:'المصادر',selAll:'تحديد الكل',only:'فقط',fetchFail:'فشل آخر جلب: {0}',gFlash:'خدمات عاجلة',gWire:'وكالات وإعلام',gCn:'عاجل بالصينية',gGulf:'السعودية والخليج',gOff:'جهات رسمية وإفصاحات',gOther:'أخرى',
 alerts:'التنبيهات',sound:'صوت التنبيه',soundD:'نغمة عند ورود خبر مهم',notif:'إشعارات سطح المكتب',notifD:'إشعار من النظام عند ورود خبر مهم',notifNo:'غير مدعوم في هذا المتصفح',notifDenied:'حظرها المتصفح؛ اسمح بها من إعداداته',push:'إشعارات في الخلفية',pushD:'إشعارات النظام حتى مع إغلاق الصفحة',pushDC:'تعمل مع إغلاق الصفحة؛ يجب أن يبقى Chrome يعمل في الخلفية',pushOn:'مفعّلة على هذا الجهاز',pushNo:'هذا المتصفح لا يدعم الإشعارات في الخلفية',pushMin:'حد الإشعار',pushConf:'8 + تأكيد',perDay:'{0}/يوم',pushCnt:'حسب آخر 24 ساعة: نحو {0} إشعار يوميًا',pushQuiet:'عدم الإزعاج',sticky:'إبقاء الإشعار على الشاشة',stickyD:'يبقى حتى تغلقه بنفسك',qOff:'إيقاف',pushTest:'إرسال إشعار تجريبي',pushSent:'تم الإرسال',pushFail:'فشل الإرسال: {0}',pushOnTip:'تم تفعيل الإشعارات',pushOffTip:'تم إيقاف الإشعارات',pushErr:'تعذر التفعيل: {0}',
 look:'المظهر',theme:'السمة',tAuto:'النظام',tDark:'داكن',tLight:'فاتح',keys:'اختصارات',kMove:'التالي / السابق',kOpen:'فتح المصدر',kSearch:'بحث',kView:'تبديل العرض',kStar:'حفظ',kShow:'وضع العرض',
 eNone:'لا توجد بيانات بعد',eNoneD:'تظهر أولى الأخبار بعد دقيقة أو دقيقتين من التشغيل.',eFilter:'لا نتائج مطابقة',eFilterD:'تصفية المصادر أو البحث الحالي يخفي كل الأخبار.',eScore:'لا أخبار بهذا التقييم حاليًا',eScoreD:'انتقل إلى «الكل» لعرض جميع الأخبار.',eConn:'فشل الاتصال',eConnD:'تعذّر جلب البيانات الآن. تعيد الصفحة المحاولة تلقائيًا.',
 newHot:'↑ {0} أخبار مهمة جديدة',newAll:'↑ {0} أخبار جديدة',trLoad:'جارٍ تنزيل نموذج الترجمة {0}%',trEnable:'فعّل ترجمة الأخبار',trNo:'هذا المتصفح لا يدعم الترجمة داخل الصفحة، فتُعرض الأخبار بلغتها الأصلية (متاح في كروم لسطح المكتب)',watch:'قائمتي',star:'المحفوظات',wTitle:'قائمة المتابعة',wPh:'مثل NVDA أو أرامكو أو الفيدرالي',add:'إضافة',wHint:'تُميَّز الأخبار المطابقة لهذه الكلمات وتُجمع في «قائمتي»',wEmpty:'لا توجد قائمة متابعة بعد',wEmptyD:'أضف رموز الأسهم أو الكلمات من «المصادر والإعدادات» في الأعلى.',wNone:'لا أخبار مطابقة لقائمتك حاليًا',sEmpty:'لا محفوظات بعد',sEmptyD:'افتح خبرًا واضغط «حفظ» ليظهر هنا.',save:'حفظ',saved:'محفوظ',share:'نسخ نص المشاركة',shared:'تم النسخ وجاهز للصق',present:'وضع العرض',pHint:'← → للتنقل · مسافة للإيقاف · Esc للخروج',pEmpty:'لا أخبار مهمة حاليًا',src:'المصدر',loadMore:'تحميل أخبار أقدم',loading:'جارٍ التحميل…',noMore:'لا أخبار أقدم (تحتفظ القاعدة بآخر 7 أيام)',loaded:'تم تحميل {0} · تحديث كل دقيقة',days:['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'],dateFmt:'{2}، {1} {3}'}
};
var MONTHS={en:['January','February','March','April','May','June','July','August','September','October','November','December'],ar:['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر']};
function api(p){return p+(p.indexOf('?')>=0?'&':'?')+(KEY?'key='+encodeURIComponent(KEY):'');}
var $=function(id){return document.getElementById(id)};
var nav=(navigator.language||'zh').toLowerCase();
var state={mkt:'all',view:'brief',lang:nav.indexOf('ar')===0?'ar':nav.indexOf('zh')===0?'zh':'en',off:{},q:'',sound:true,notify:true,theme:'auto',items:[],pending:[],lastSeen:0,first:true,loaded:false,newIds:{},sel:null,health:{},prevSeen:0,topSeen:0,watch:[],stars:{},shown:400,noMore:false,older:false};
try{var saved=JSON.parse(localStorage.getItem('hw')||'{}');
  if(/^(brief|hot|mid|all|watch|star)$/.test(saved.view))state.view=saved.view;if(/^(zh|en|ar)$/.test(saved.lang))state.lang=saved.lang;if(/^(us|sa)$/.test(saved.mkt))state.mkt=saved.mkt;
  if(saved.off)state.off=saved.off;if(saved.sound===false)state.sound=false;if(saved.notify===false)state.notify=false;
  if(saved.theme==='dark'||saved.theme==='light')state.theme=saved.theme;if(saved.seen){state.topSeen=+saved.seen||0;state.prevSeen=saved.at&&Date.now()-saved.at<18e5&&saved.prev!=null?+saved.prev||0:state.topSeen;}if(Array.isArray(saved.watch))state.watch=saved.watch.filter(function(w){return typeof w==='string'&&w}).slice(0,40);}catch(e){}
try{state.stars=JSON.parse(localStorage.getItem('hw-stars')||'{}')||{}}catch(e){state.stars={}}
function save(){try{localStorage.setItem('hw',JSON.stringify({mkt:state.mkt,view:state.view,lang:state.lang,off:state.off,sound:state.sound,notify:state.notify,theme:state.theme,seen:state.topSeen,prev:state.prevSeen,at:state.hiddenAt||Date.now(),watch:state.watch}))}catch(e){}}
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
function lvl(i){var s=i.score;if(s==null)return 0;if(s>=8)return 3;if(s>=6)return 2;return 1;}
function isHot(i){return !!(i.important&&!i.dup_of)}
function isArt(i){return i.kind==='article'}
var ENT={'&quot;':'"','&amp;':'&','&#39;':"'",'&apos;':"'",'&lt;':'<','&gt;':'>','&nbsp;':' '};
function dec(s){return String(s||'').replace(/&(?:quot|amp|#39|apos|lt|gt|nbsp);/g,function(m){return ENT[m]})}
function cleanTitle(t){return dec(t).replace(MARKS,'').replace(/^FinancialJuice\s*[:：]\s*/i,'').replace(/(?:\s+|(?<=[^\x00-\x7f]))(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,6}\/[A-Za-z0-9_\-\/.?=&%#]+/gi,'').replace(/\s*(?:more here|read more)\s*:?\s*$/i,'').replace(/\s*\|\s*$/,'').replace(/\s{2,}/g,' ').trim()||String(t||'');}
function squash(s){return String(s||'').toLowerCase().replace(/https?:\/\/\S+/g,'').replace(/[^\p{L}\p{N}]+/gu,'');}
function noCode(s){return String(s||'').replace(/(?:\bnew|新的)\s*[A-Za-z_$][\w$.]*\s*\(\s*\{[\s\S]*?\}\s*\)\s*[;；]?/g,' ').trim();}
function cleanBody(i){
  var b=noCode(dec(i.body)).replace(/^Key Points(?=[A-Z])/,'').replace(MARKS,'').replace(/\r/g,'').split('\n').map(function(l){return l.trim()})
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
    if(i.body_tr&&noCode(i.body_tr))o.b=noCode(i.body_tr);else if(c&&c.b)o.b=noCode(c.b)||null;else if(needBody&&!(c&&c.nb)){wantBody[i.id]=1;want.push(i.id);}
    return o;}
  if(c&&c.t){o.t=c.t;o.tr=true;if(c.b)o.b=noCode(c.b)||null;}
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
var EVS={};
function base(all){if(state.only&&!all){var on=state.only.ids;return state.items.filter(function(i){return on[i.id]&&!state.off[i.source]});}
  var k=state.q.toLowerCase(),sym=/^\$[A-Za-z0-9.]{1,6}$/.test(state.q)?state.q.slice(1).toUpperCase():'',tk=sym?tkRe(sym):null,tpc=k.charAt(0)==='#'?k.slice(1):'';if(tpc)k=tpc;
  return state.items.filter(function(i){if(state.off[i.source])return false;if(state.mkt!=='all'&&!inMkt(i,state.mkt))return false;
    if(tk){if(!(i.tickers!=null&&i.dir!=null?(','+i.tickers+',').indexOf(','+sym+',')>=0:tk.test(i.title+' '+(i.title_tr||''))))return false;}else if(tpc&&i.topic&&i.topic.toLowerCase()===tpc){}else if(k){var c=TR[i.id];if((i.title+' '+(i.body||'')+' '+(i.title_tr||'')+' '+((c&&c.t)||'')).toLowerCase().indexOf(k)<0)return false;}return true;});}
function watchHit(i){if(!state.watch.length)return '';var c=TR[i.id],t=(i.title+' '+(i.body||'')+' '+(i.title_tr||'')+' '+((c&&c.t)||'')).toLowerCase();
  for(var k=0;k<state.watch.length;k++){var w=state.watch[k].toLowerCase();if(/^[a-z0-9.]{1,5}$/.test(w)){if(new RegExp('(^|[^a-z0-9])'+w.replace(/\./g,'\\.')+'($|[^a-z0-9])').test(t))return state.watch[k];}else if(t.indexOf(w)>=0)return state.watch[k];}return '';}
function inView(i,v){if(v==='watch')return !!watchHit(i);if(v==='hot')return isHot(i);if(v==='mid')return (i.score||0)>=6&&!i.dup_of;if(v==='deep')return isArt(i);return true;}
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
    if(i.tickers!=null&&i.dir!=null){i.tickers.split(',').forEach(function(s){if(s)u[s]=TKX[s]?TKX[s][1]:''});Object.keys(u).forEach(function(s){var o=m[s]=m[s]||{sym:s,name:u[s],n:0,hot:0};o.n++;if(isHot(i))o.hot++;});return;}
    TK.forEach(function(k){if(k.re.test(t))u[k[0]]=k[1];});
    var x;CASH.lastIndex=0;while((x=CASH.exec(t))){var s=x[1]||x[2];if(!u[s]&&!TKX[s]&&!/^(USD|EUR|GBP|JPY|CNY|SAR|BTC|ETH|GDP|CPI|ETF|IPO|CEO)$/.test(s))u[s]='';}
    Object.keys(u).forEach(function(s){var o=m[s]=m[s]||{sym:s,name:u[s],n:0,hot:0};o.n++;if(isHot(i))o.hot++;});});
  return Object.keys(m).map(function(s){return m[s]}).filter(function(o){return o.n>=2}).sort(function(a,b){return b.n-a.n||b.hot-a.hot||(a.sym<b.sym?-1:1)}).slice(0,6);}
var BULL=/\b(surg\w+|soar\w*|jump\w*|rall(?:y|ies|ied)|gains?|rises?|rose|climb\w*|record high|beats?|upgrade[sd]?|boost\w*|rebound\w*|skyrocket\w*|buyback|tops|approv\w+|wins?|raises? (?:guidance|forecast|outlook|dividend))\b|大涨|上涨|飙升|暴涨|走高|新高|反弹|超预期|上调|回购|获批|利好|拉升|涨超|涨逾|涨近/gi;
var BEAR=/\b(plung\w+|slump\w*|tumbl\w+|falls?|fell|drops?|dropped|slid\w*|sinks?|sank|crash\w*|sell-?off|miss(?:es|ed)?|downgrade[sd]?|warn\w*|loss(?:es)?|layoffs?|bankrupt\w*|defaults?|probe|investigat\w+|lawsuit|sanction\w*|tariffs?|blacklist\w*|halt\w*|recall\w*|fraud|short sellers?|lows?|weak\w*|fears?|slash\w*|cuts? (?:guidance|forecast|outlook|jobs))\b|大跌|下跌|暴跌|跳水|走低|新低|下调|不及预期|裁员|破产|违约|调查|制裁|关税|黑名单|利空|跌超|跌逾|跌近|亏损|警告|做空/gi;
function mood(i){if(i.dir!=null)return i.dir;var t=cleanTitle(i.title),a=(t.match(BULL)||[]).length,b=(t.match(BEAR)||[]).length;return a>b?1:b>a?-1:0;}

/* ---------- 话题：统计标题里反复出现的专有名词 ---------- */
var STOP={};('the this that after with from will says new its and for not how why what but are has can could may over more here amid into than who was were his her their our your you they them just still also when where while about against between during before under near per via ' +
 'us ai ceo cfo ipo etf gdp pmi cpi eps gaap inc corp ltd plc llc co group holdings company capital global international bank stock stocks share shares market markets street wall billion trillion million first second third report reports analysts analyst ' +
 'monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december breaking update live watch exclusive factbox explainer opinion analysis ' +
 'reuters bloomberg cnbc wsj ft bbc ap nasdaq barron investing seeking alpha financialjuice newswire actual forecast previous flash rate rates interest probabilities president chief executive north south east west').split(' ').forEach(function(w){STOP[w]=1});
function topics(list){
  // AI 给了话题标签的快讯够多时，直接按标签归拢（中英文自动对上）；否则退回到数专有名词
  var tg={},nt=0;list.forEach(function(i){if(i.dup_of||!i.topic)return;nt++;var k=i.topic.toLowerCase();(tg[k]=tg[k]||{name:i.topic,tag:true,items:[]}).items.push(i)});
  if(nt>=12){var at=Object.keys(tg).map(function(k){return tg[k]}).filter(function(x){return x.items.length>=3}).sort(function(a,b){return b.items.length-a.items.length||b.items.filter(isHot).length-a.items.filter(isHot).length});if(at.length)return at.slice(0,3);}
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
var IC={cf:'<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="4.9"/><path d="m3.8 6.2 1.5 1.5 2.9-3.2"/></svg>',
  ev:'<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 3h8M2 6h8M2 9h5"/></svg>',
  dp:'<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"><path d="M3 1.5h4.2L9.5 3.8v6.7H3z"/><path d="M5 6h2.6M5 8h2.6"/></svg>',
  fl:'<svg viewBox="0 0 12 12" fill="currentColor"><path d="M6.9.8 2.4 6.9h2.9l-.6 4.3 4.9-6.3H6.5z"/></svg>',
  mg:'<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 2.5 6 6v4M9.5 2.5 6 6"/></svg>'};
function nb(n){return '<b class="num">'+n+'</b>'}
// 署名行里跟在来源、时间后面的小标记：类型（深度）、译、自选命中、已收藏
function tags(i,o){var h='';
  if(isArt(i))h+='<span class="tg">'+T('deepB')+'</span>';
  if(o&&o.tr)h+='<span class="trb">'+T('translated')+'</span>';
  var w=watchHit(i);if(w)h+='<span class="wh">◆ '+esc(w)+'</span>';
  if(state.stars[i.id])h+='<span class="wh">★</span>';
  return h;}
// 关联关系：统一的小胶囊。g 是简报里的事件分组（有就加“同一事件还有 N 条”，点了进时间线）
function evLabel(g){var k=g.key||'';return T('dEv')+' · '+(k.charAt(0)==='#'&&g.rep.topic?g.rep.topic:k.replace(/^[$#]/,''));}
function rels(i,g){var h='';
  if(i.confirms>0)h+='<span class="rc cfm">'+IC.cf+'<span>'+T('nSrc',nb(i.confirms+1))+'</span></span>';
  if(g){var n=g.items.length-1;if(n>0&&g.key){var ek='g:'+g.rep.id,ids={};g.items.forEach(function(x){ids[x.id]=1});EVS[ek]={ids:ids,label:evLabel(g)};h+='<button class="rc evt" data-ev="'+esc(ek)+'">'+IC.ev+'<span>'+T('related',nb(n))+'</span></button>';}}
  if(i.rel>0)h+='<span class="rc dpc">'+(isArt(i)?IC.fl:IC.dp)+'<span>'+T(isArt(i)?'nFlash':'nDeep',nb(i.rel))+'</span></span>';
  if(i.dup_of)h+='<span class="rc">'+IC.mg+'<span>'+T('merged')+'</span></span>';
  return h;}
function hits(i){var h='';if(i.hits)i.hits.split(' | ').forEach(function(x){if(x)h+='<span class="hit" dir="ltr">'+esc(x)+'</span>'});return h;}
function sc(i){return '<span class="sc s'+lvl(i)+'">'+fmtScore(i.score)+'</span>'}
function byline(i,o,noScore,g,noRel){var r=noRel?'':rels(i,g);return '<div class="meta"><div class="by">'+(noScore?'':sc(i))+'<b>'+esc(shortSrc(i.source))+'</b><span class="num">'+hm(i.ts)+'</span>'+tags(i,o)+'</div>'+(r?'<div class="rels">'+r+'</div>':'')+'</div>';}
function ring(i,cls){var s=i.score||0;return '<div class="ring'+(s>=8?'':s>=6?' mid':' lo')+(cls||'')+'" style="--p:'+Math.round(s*10)+'"><span>'+fmtScore(i.score)+'</span></div>';}
function isZhText(s){return HAN.test(s)}

/* ---------- 渲染：简报 ---------- */
function hotList(b){
  var now=Date.now(),recent=b.filter(function(i){return i.ts>now-18*36e5});if(recent.length<8)recent=b;
  var hot=dedupe(recent.filter(isHot).sort(function(x,y){return y.score-x.score||y.confirms-x.confirms||y.ts-x.ts||(x.id<y.id?-1:1)}));
  if(!hot.length)hot=dedupe(recent.filter(function(i){return !i.dup_of&&i.score!=null}).sort(function(x,y){return y.score-x.score||y.ts-x.ts})).slice(0,12);
  return hot;
}
// 把重要快讯按“同一件事”归拢：涉及同一只股票的算一组，没有股票的按 AI 话题标签算一组。
// 简报顶部每组只放分数最高的一条，其余的收进“另有 N 条相关”，这样头条和今日要闻不会被同一件事占满。
function evKeys(i){var ks=[];
  if(i.tickers)i.tickers.split(',').forEach(function(s){if(s)ks.push('$'+s)});
  if(!ks.length){var t=cleanTitle(i.title);TK.forEach(function(k){if(ks.length<2&&k.re.test(t))ks.push('$'+k[0])});}
  if(!ks.length&&i.topic)ks.push('#'+i.topic.toLowerCase());
  return ks;}
function groupHot(hot){var gs=[],by={};
  hot.forEach(function(i){var ks=evKeys(i),g=null;
    ks.forEach(function(k){if(!g&&by[k])g=by[k]});
    if(!g){g={rep:i,items:[],key:ks[0]||''};gs.push(g);}
    g.items.push(i);ks.forEach(function(k){if(!by[k])by[k]=g});});
  return gs;}
// 有些来源（如 Bluesky 帖子）把整段话当标题：大标题位置只取第一句，太长就截断
function headOf(t){if(t.length<=110)return t;var m=t.match(/^(.{24,110}?[.!?。！？])(\s|$)/);if(m)return m[1].replace(/[.。]$/,'');
  var c=t.slice(0,104),k=c.lastIndexOf(' ');return (k>60?c.slice(0,k):c).replace(/[,，;；:：\s]+$/,'')+'…';}
// 关键数字：从标题里自动取百分比、金额、数量（最多 3 个），不够就用事件本身的数字补齐（几家来源证实、多少条相关、首报至今多久）
var FIG_DN=/跌|降|挫|缩|亏|减|低|失守|蒸发|fall|fell|drop|down|slid|slump|plung|tumbl|sink|sank|lose|loss|cut|decline|lower/i,FIG_UP=/涨|升|增|高|扩|飙|赚|rise|rose|gain|jump|surg|soar|climb|rall|up\b|higher|grow|beat/i;
var FIG_RE=/([+\-]?\d[\d,]*(?:\.\d+)?)\s?(%)|((?:US)?\$\s?\d[\d,]*(?:\.\d+)?)\s?(trillion|billion|million|bn|mn|tn|[BMK]\b)?|(\d[\d,]*(?:\.\d+)?)\s?(万亿美元|亿美元|万美元|美元|万亿|亿元|亿里亚尔|里亚尔)|(\d{1,4})\s?(国|个国家|家公司|架|countries|nations|jets|jobs|states)/gi;
function figClause(t,at,len){var cut=/[，,;；。:：|｜—–]|\s-\s/g,a=0,a0=0,b=t.length,m;while((m=cut.exec(t))){if(m.index<at){a0=a;a=m.index+m[0].length;}else if(m.index>=at+len){b=m.index;break;}}
  var trim=/^[\s的了约大超逾过达至为]+|[\s的了约大超逾过达至为]+$/g,L=t.slice(a,at).replace(trim,'').trim(),R=t.slice(at+len,b).replace(/^\s+|[\s的了]+$/g,''),c=(L&&R.replace(/^的/,'')?L+'…'+R:L||R.replace(/^的/,'')).replace(/\s+/g,' ');
  if(c.length<4&&a>a0)c=(t.slice(a0,a).replace(/[，,;；。:：|｜—–\s]+$/,'')+' '+c).trim();
  return c.length>44?c.slice(0,42)+'…':c;}
function keyFigs(t){var out=[],seen={},m;FIG_RE.lastIndex=0;
  while((m=FIG_RE.exec(t))&&out.length<3){var v,u='',d=0,pre=t.slice(Math.max(0,m.index-14),m.index),post=t.slice(m.index+m[0].length,m.index+m[0].length+10);
    if(m[2]){v=m[1].replace(/^[+\-]/,'')+'%';d=/^-/.test(m[1])||FIG_DN.test(pre)?-1:/^\+/.test(m[1])||FIG_UP.test(pre)?1:FIG_DN.test(post)?-1:FIG_UP.test(post)?1:0;}
    else if(m[3]){v=m[3].replace(/\s/g,'');u=m[4]||'';}
    else if(m[5]){v=m[5];u=m[6];}
    else{if(+m[7]<2||(+m[7]>=1900&&+m[7]<2100))continue;v=m[7];u=m[8];}
    if(seen[v+u])continue;seen[v+u]=1;out.push({v:v,u:u,d:d,c:figClause(t,m.index,m[0].length)});}
  return out;}
function evItems(b,g){if(!g||!g.key)return [];var now=Date.now(),have={};g.items.forEach(function(i){have[i.id]=1});
  return b.filter(function(i){return have[i.id]||(!i.dup_of&&!isArt(i)&&i.ts>now-36*36e5&&(i.score||0)>=5&&evKeys(i).indexOf(g.key)>=0)});}
function figsHtml(hero,title,ev){var fs=keyFigs(title),h='';
  function add(v,u,c){if(fs.length<3)fs.push({v:String(v),u:u,d:0,c:c,plain:1});}
  if(hero.confirms>0)add(hero.confirms+1,'',T('fSrc'));
  if(ev.length>1){add(ev.length,'',T('fEv'));var first=ev.reduce(function(a,i){return Math.min(a,i.ts)},Date.now()),mins=Math.max(1,Math.round((Date.now()-first)/6e4));
    if(mins>=60)add(Math.round(mins/6)/10,T('fH'),T('fAge'));else add(mins,T('fM'),T('fAge'));}
  if(!fs.length)return '';
  fs.forEach(function(f){h+='<div class="fig"><b dir="ltr">'+(f.d?'<i class="'+(f.d>0?'up':'dn')+'">'+(f.d>0?'▲':'▼')+'</i>':'')+esc(f.v)+(f.u?'<u>'+esc(f.u)+'</u>':'')+'</b><span dir="auto">'+esc(f.c)+'</span></div>'});
  return '<div class="figs">'+h+'</div>';}
// 事件脉络：同一件事从首次报道到现在（最多 5 条：首报 + 分数最高的几条，按时间先后排）
function tlHtml(ev,cur,g,curKey,cls){if(ev.length<2)return '';
  var by=ev.slice().sort(function(x,y){return x.ts-y.ts}),first=by[0],keep={};keep[first.id]=1;keep[cur.id]=1;
  ev.slice().sort(function(x,y){return (y.score||0)-(x.score||0)||y.ts-x.ts}).forEach(function(i){if(Object.keys(keep).length<5)keep[i.id]=1});
  var L=by.filter(function(i){return keep[i.id]}),ek='e:'+cur.id,ids={};ev.forEach(function(x){ids[x.id]=1});EVS[ek]={ids:ids,label:evLabel(g)};
  return '<div class="'+(cls||'also')+'"><div class="'+(cls?'d-sec':'hd')+'"><span>'+T(cls?'dEv':'alsoH')+' · <span class="num">'+ev.length+'</span></span><button data-ev="'+esc(ek)+'">'+T('alsoAll',ev.length)+'</button></div>'+L.map(function(i){var o=tx(i),c=i.id===cur.id;
    return '<div class="tl'+(c?' cur':'')+'"'+(c&&cls?'':' data-id="'+esc(i.id)+'"')+'><time class="num">'+hm(i.ts)+'</time><span class="dot"></span><div><span class="lt" dir="auto">'+esc(headOf(o.t))+'</span><small>'+sc(i)+'<span>'+esc(shortSrc(i.source))+'</span>'+(c?'<em>'+T(curKey)+'</em>':i.id===first.id?'<em>'+T('tlFirst')+'</em>':'')+'</small></div></div>'}).join('')+'</div>';}
function briefHtml(b){
  var now=Date.now(),hot=hotList(b);
  if(!hot.length)return '';
  var gs=groupHot(hot),g0=gs[0],hero=g0.items.filter(function(i){return g0.rep.score-i.score<=1}).sort(function(x,y){return (cleanTitle(x.title).length>110)-(cleanTitle(y.title).length>110)||!!cleanBody(y)-!!cleanBody(x)||y.score-x.score})[0]||g0.rep;
  var ranks=gs.slice(1,5),used={};used[hero.id]=1;ranks.forEach(function(g){used[g.rep.id]=1});
  // 事件不够 4 组时，用剩下分数最高的补满
  var fill=hot.filter(function(i){return !used[i.id]});while(ranks.length<4&&fill.length){var f=fill.shift();used[f.id]=1;ranks.push({rep:f,items:[f],key:''});}
  var rest=hot.filter(function(i){return !used[i.id]}),ev0=evItems(b,g0),ho=tx(hero,true),hb=ho.b!=null?ho.b:cleanBody(hero);
  var h='<div class="top"><article class="hero" data-id="'+esc(hero.id)+'"><div class="kick">'+T('lead')+'</div>'+
    '<h2 dir="auto"'+(isZhText(ho.t)?' class="zh"':'')+'>'+hl(headOf(ho.t))+'</h2>'+(hb?'<p dir="auto">'+hl(hb.split('\n\n')[0])+'</p>':'')+
    '<div class="foot">'+ring(hero)+byline(hero,ho,true)+'</div>'+figsHtml(hero,ho.t,ev0)+tlHtml(ev0,hero,g0,'tlLead')+'</article>'+
    '<div class="rank"><h3>'+T('topToday')+'<small>'+T('topSub')+'</small></h3>'+ranks.map(function(g,k){var i=g.rep,o=tx(i);return '<article class="rk" data-id="'+esc(i.id)+'"><em class="num">'+(k+2)+'</em><div><h4 dir="auto">'+hl(headOf(o.t))+'</h4>'+byline(i,o,false,g)+'</div></article>'}).join('')+'</div></div>';
  // 12 小时统计：重要条数、和平常比、多空情绪、热门股票
  var win=dedupe(b.filter(function(i){return i.ts>now-12*36e5&&!i.dup_of})),tot=win.length,imp=win.filter(isHot).length,srcs={};win.forEach(function(i){srcs[i.source]=1});
  var st=state.mkt==='all'?state.stats:null,vs=state.mkt==='all'?'<div class="vs"><strong>'+T('vsNone')+'</strong><div class="gauge"></div></div>':'<div class="vs"><small>'+T('vsAll')+'</small></div>';
  if(st&&st.windows){var w0=null,past=[];st.windows.forEach(function(w){if(w.k===0)w0=w;else if(st.now-w.k*864e5-432e5>=st.oldest&&(w.n||0)>=50)past.push(w.imp||0);});
    if(w0){imp=w0.imp||0;tot=Math.max(tot,w0.n||0);}
    if(past.length){var avg=past.reduce(function(x,y){return x+y},0)/past.length,r=avg>0?imp/avg:(imp?2:1),pc=Math.round(Math.abs(r-1)*100),up=r>=1.1,dn=r<=.9;
      vs='<div class="vs"><strong'+(up?' class="up"':'')+'>'+(up?T('vsUp',pc):dn?T('vsDown',pc):T('vsFlat'))+'</strong><div class="gauge"><i'+(up?' class="up"':'')+' style="inset-inline-start:'+Math.round(Math.max(0,Math.min(1,r/2))*100)+'%"></i></div><small>'+T('vsNote',past.length,Math.round(avg*10)/10)+'</small></div>';}}
  var ms=win.filter(function(i){return (i.score||0)>=5}).map(mood),bu=ms.filter(function(x){return x>0}).length,be=ms.filter(function(x){return x<0}).length,ne=ms.length-bu-be;
  var sen='<div class="sen"><div class="lbl" style="margin-bottom:8px">'+T('senti')+'</div>'+(bu+be?'<div class="hd"><span class="sbu">'+T('bull',bu)+'</span><span class="sbe">'+T('bear',be)+'</span></div><div class="split"><i class="sbu" style="flex-grow:'+bu+'"></i><i class="sne" style="flex-grow:'+Math.round(ne/4)+'"></i><i class="sbe" style="flex-grow:'+be+'"></i></div><small>'+T(win.filter(function(i){return (i.score||0)>=5&&i.dir!=null}).length*2>=ms.length?'sentiAi':'sentiNote')+'</small>':'<small>'+T('sentiNone')+'</small>')+'</div>';
  h+='<div class="now"><div class="glass tile stat"><div class="lbl">'+T('last12')+'</div><b>'+imp+'</b><p>'+T('statLine',tot,Object.keys(srcs).length)+'</p>'+vs+sen+'</div>';
  var tks=tickers(win),tmx=tks.length?tks[0].n:1;
  h+='<div class="glass tile tk"><div class="lbl">'+T('tkTitle')+'</div>'+(tks.length?'<div class="sub">'+T('tkSub')+'</div>'+tks.map(function(o){
    return '<button class="tkr'+(o.hot?' h':'')+'" data-tk="'+esc(o.sym)+'"><b dir="ltr">'+esc(o.sym)+'</b><span dir="ltr">'+esc(o.name)+'</span><em class="num">'+o.n+'</em><u style="width:'+Math.max(8,Math.round(o.n/tmx*100))+'%"></u></button>'}).join(''):'<div class="sub" style="margin:0">'+T('tkNone')+'</div>')+'</div>';
  topics(b.filter(function(i){return i.ts>now-18*36e5})).slice(0,2).forEach(function(tp){
    var L=dedupe(tp.items.slice().sort(function(x,y){return (y.score||0)-(x.score||0)||y.ts-x.ts}));
    h+='<div class="glass tile topic"><div class="lbl">'+T('topic')+'</div><h3 data-topic="'+esc((tp.tag?'#':'')+tp.name)+'" role="button" tabindex="0" style="cursor:pointer"><bdi>'+esc(tp.name)+'</bdi><span>'+T('timeline')+'</span></h3><div class="cnt">'+T('topicCnt',tp.items.length,tp.items.filter(isHot).length)+'</div>'+
      L.slice(0,3).map(function(i){var o=tx(i);return '<div class="li" data-id="'+esc(i.id)+'">'+sc(i)+'<div><span class="lt" dir="auto">'+esc(o.t)+'</span><small>'+esc(shortSrc(i.source))+' · <span class="num">'+hm(i.ts)+'</span></small></div></div>'}).join('')+'</div>';});
  h+='</div>';
  var more=rest.slice().sort(function(x,y){return y.ts-x.ts||(x.id<y.id?-1:1)}).slice(0,9),latest=b.slice(0,more.length>3?16:12);
  h+='<div class="low"><div>'+(more.length?'<div class="sec"><span>'+T('more')+'<small>'+T('moreSub')+'</small></span><button data-go="hot">'+T('viewAll')+'</button></div><div class="g3">'+more.map(function(i){var o=tx(i),bb=o.b!=null?o.b:(o.tr?'':cleanBody(i));
      return '<article class="card" data-id="'+esc(i.id)+'"><h4 dir="auto">'+hl(o.t)+'</h4>'+(bb?'<p dir="auto">'+esc(bb)+'</p>':'')+byline(i,o)+'</article>'}).join('')+'</div>':'')+'</div>'+
    '<div class="wire"><div class="sec"><span>'+T('wire')+'<small>'+T('wireSub')+'</small></span><button data-go="all">'+T('viewAll')+'</button></div>'+latest.map(function(i){var o=tx(i);
      return '<div class="w'+(isHot(i)?' h':'')+'" data-id="'+esc(i.id)+'"><time class="num">'+hm(i.ts)+'</time><div><span class="wt" dir="auto">'+hl(o.t)+'</span><small>'+esc(shortSrc(i.source))+(isArt(i)?'<span class="tg">'+T('deepB')+'</span>':'')+'</small></div>'+sc(i)+'</div>'}).join('')+'</div></div>';
  return h;
}

/* ---------- 渲染：列表 ---------- */
function rowHtml(i){
  var L=lvl(i),hot=isHot(i),o=tx(i),tg=tags(i,o),x=rels(i);
  return '<article class="row'+(hot?' imp':L>=2?' m':'')+(state.sel===i.id?' sel':'')+(state.newIds[i.id]?' new':'')+'"'+(state.newIds[i.id]?' style="--nd:-'+Math.max(0,Date.now()-state.newIds[i.id])+'ms"':'')+' data-id="'+esc(i.id)+'">'+
    '<time class="t num">'+hm(i.ts)+'</time>'+sc(i)+
    '<div class="c"><span class="h" dir="auto">'+hl(o.t)+'</span>'+(tg?'<span class="xi">'+tg+'</span>':'')+(x?'<div class="x">'+x+'</div>':'')+'</div>'+
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
  var art=isArt(i)&&i.score==null;
  var lv=art?T('lvDeep'):hot?T('lvHot'):i.score==null?T('lvNone'):i.score>=8?T('lvHigh'):i.score>=6?T('lvMid'):T('lvLow');
  var by=art?T('byDeep'):i.score==null?T('byWait'):(i.score_by==='ai'?T('byAi'):T('byRule'))+(i.base_score!=null&&i.confirms>0&&i.base_score!==i.score?' · '+T('boost',fmtScore(i.base_score)):'');
  var body=b?'<div class="d-body" dir="auto">'+b.split('\n\n').map(function(p){return '<p>'+hl(p).replace(/\n/g,'<br>')+'</p>'}).join('')+'</div>':'<div class="d-none">'+T(isArt(i)?'noBodyArt':'noBody')+'</div>';
  var r=rels(i),hh=hits(i),cs={},cn=[];state.items.forEach(function(x){if(x.dup_of===i.id&&x.source!==i.source&&!cs[x.source]){cs[x.source]=1;cn.push(shortSrc(x.source))}});
  var tkc='';(i.tickers||'').split(',').forEach(function(x){if(x)tkc+='<button class="chipb" data-tk="'+esc(x)+'" dir="ltr">$'+esc(x)+'</button>'});
  if(!tkc){var ct=cleanTitle(i.title),nk=0;TK.forEach(function(k){if(nk<3&&k.re.test(ct)){nk++;tkc+='<button class="chipb" data-tk="'+esc(k[0])+'" dir="ltr">$'+esc(k[0])+'</button>'}});}
  var tpc=i.topic?'<button class="chipb tp" data-rel="#'+esc(i.topic)+'"><bdi>'+esc(i.topic)+'</bdi></button>':'';
  var ks=evKeys(i),gk=ks[0]||'',evd=gk?evItems(base(true),{key:gk,items:[i],rep:i}):[];
  var facts=(tkc?'<div><span>'+T('dTk')+'</span><span>'+tkc+'</span></div>':'')+(tpc?'<div><span>'+T('dTp')+'</span><span>'+tpc+'</span></div>':'')+(i.dir?'<div><span>'+T('dDir')+'</span><span><span class="mood '+(i.dir>0?'up':'dn')+'">'+(i.dir>0?'▲ '+T('dUp'):'▼ '+T('dDn'))+'</span></span></div>':'')+(cn.length?'<div><span>'+T('cfBy')+'</span><span>'+esc(shortSrc(i.source)+' · '+cn.join(' · '))+'</span></div>':'')+(hh?'<div><span>'+T('hitL')+'</span><span>'+hh+'</span></div>':'');
  return '<div class="d"><div class="d-top">'+ring(i)+'<div><div class="d-lv'+(hot?' hot':'')+'">'+lv+'</div><div class="d-by">'+by+'</div></div></div>'+
    '<h2 dir="auto">'+hl(o.t)+'</h2><div class="by"><b>'+esc(i.source)+'</b><span class="num" title="'+esc(new Date(i.ts).toLocaleString())+'">'+hm(i.ts)+'</span>'+tags(i,o)+'</div>'+(r?'<div class="rels">'+r+'</div>':'')+(facts?'<div class="d-facts">'+facts+'</div>':'')+body+
    (o.tr?'<div class="orig" dir="auto"><b>'+T('original')+'</b>'+esc(cleanTitle(i.title))+'</div>':'')+/* 以后的行情小图模块插在这里 */(gk?tlHtml(evd,i,{key:gk,rep:i},'tlNow','d-ev'):'')+relHtml(i)+
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
  [].forEach.call($('theme').children,function(b){b.classList.toggle('on',b.dataset.t===state.theme)});thumbSync($('theme'));
  renderPush();
  $('wchips').innerHTML=state.watch.map(function(w,k){return '<button class="wc" data-w="'+k+'"><bdi>'+esc(w)+'</bdi> ×</button>'}).join('');
}
function renderTabs(b){
  var n={hot:0,mid:0,all:b.length};b.forEach(function(i){if(inView(i,'hot'))n.hot++;if(inView(i,'mid'))n.mid++;});
  tick($('nHot'),n.hot);tick($('nMid'),n.mid);tick($('nAll'),n.all);tick($('nDeep'),b.filter(isArt).length||'');
  tick($('nWatch'),state.watch.length?b.filter(function(i){return inView(i,'watch')}).length:'');tick($('nStar'),Object.keys(state.stars).length||'');
  [].forEach.call(document.querySelectorAll('.tab'),function(t){var on=t.dataset.v===state.view;t.classList.toggle('on',on);t.setAttribute('aria-selected',on?'true':'false')});inkSync();
  var oc=offCount(),parts=[];
  if(oc)parts.push(T('hidden',oc));if(state.only)parts.push(esc(state.only.label));if(state.q)parts.push(esc(T('searching',state.q)));
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
/* ---------- 动效 ----------
   原则：只动位移和透明度（不引起重新排版）；出现快、离开更快；每个动效都对应一件事：
   · 进场（换视图、换市场、钻取、返回、首次出现）：各区块依次浮现
   · 更新（15 秒一次的新数据）：原有条目平滑让位，新条目滑入，分数和数字变了才动
   · 系统设置了“减少动态效果”时全部关闭 */
var instant=false,lastQ='',EO='cubic-bezier(.22,1,.36,1)',ESP='cubic-bezier(.34,1.42,.64,1)',lastKey='',lastRows=0,forceEnter=false,enterDir=0,BARS={};
function calm(){return !!window.matchMedia&&window.matchMedia('(prefers-reduced-motion:reduce)').matches;}
function anim(el,frames,o){if(!el||!el.animate||calm())return null;try{return el.animate(frames,o)}catch(e){return null}}
function near(el){var r=el.getBoundingClientRect();return r.bottom>-200&&r.top<window.innerHeight+200?r:null;}
function rise(el,k,dx,dy){anim(el,[{opacity:0,transform:'translate3d('+(dx||0)+'px,'+(dy==null?10:dy)+'px,0)'},{opacity:1,transform:'none'}],{duration:380,delay:(k||0)*32,easing:EO,fill:'backwards'});}
function snap(){var m={},n=0;[].forEach.call($('main').querySelectorAll('[data-id]'),function(el){
  if(n>120)return;var r=near(el);if(!r)return;n++;
  var sc=el.querySelector('.sc,.ring span');m[el.dataset.id+'|'+el.classList[0]]={x:r.left,y:r.top,s:sc?sc.textContent:''};});
  var b=$('main').querySelector('.stat b');m['#stat']=b?b.textContent:'';return m;}
/* 统计磁贴里的条形和指针：元素每次都是新画的，所以记下上一次的位置，从那里过渡到新位置 */
function bars(first){var now={};[].forEach.call($('main').querySelectorAll('.gauge i,.split i,.tkr u'),function(el,k){
  var g=el.parentNode.className==='gauge',sp=el.parentNode.className==='split',key=(g?'g':sp?'s'+el.className:'t'+(el.parentNode.dataset.tk||k)),v=g?el.style.insetInlineStart:sp?el.style.flexGrow:el.style.width;now[key]=v;
  var old=BARS[key];if(first&&!sp){old=g?'50%':null;}
  if(g&&old&&old!==v)anim(el,[{insetInlineStart:old},{insetInlineStart:v}],{duration:700,easing:EO});
  else if(sp&&old!=null&&old!==v)anim(el,[{flexGrow:old},{flexGrow:v}],{duration:700,easing:EO});
  else if(!g&&!sp&&(first||old==null||old!==v)){var f=first||old==null?0:parseFloat(old)/(parseFloat(v)||1);anim(el,[{transform:'scaleX('+f+')'},{transform:'none'}],{duration:first?620:520,delay:first?160+(k%8)*40:0,easing:EO,fill:'backwards'});}
});BARS=now;}
function tween(el,from,to){if(!el||calm()||isNaN(from)||isNaN(to)||from===to)return;var t0=performance.now(),d=520;
  (function step(t){var p=Math.min(1,(t-t0)/d),e=1-Math.pow(1-p,4);el.textContent=Math.round(from+(to-from)*e);if(p<1&&el.isConnected)requestAnimationFrame(step);else if(el.isConnected)el.textContent=to;})(t0);}
function sweep(root){if(!(window.CSS&&CSS.registerProperty))return;[].forEach.call(root.querySelectorAll('.ring'),function(el){var p=el.style.getPropertyValue('--p');if(p)anim(el,[{'--p':0},{'--p':p}],{duration:900,delay:120,easing:EO,fill:'backwards'});});}
/* 进场：简报按“头条 → 排行 → 磁贴 → 下半部分”，列表按前十几行，依次浮现；方向跟着标签的左右位置走 */
function enter(){var m=$('main'),els,k=0,dx=enterDir*14*(document.documentElement.dir==='rtl'?-1:1);
  if(state.view==='brief'&&m.querySelector('.top'))els=m.querySelectorAll('.crumb,.hero,.rank,.now>.tile,.low>div');
  else els=m.querySelectorAll('.crumb,.list>.day,.list>.row,.list>.seen,.empty');
  [].some.call(els,function(el){if(k>15)return true;if(!near(el))return k>0;rise(el,k++,dx,dx?0:10);});
  sweep(m);bars(true);}
function play(prev){var n=0,fresh=0,m=$('main');
  [].forEach.call(m.querySelectorAll('[data-id]'),function(el){
    if(n>120)return;var r=near(el);if(!r)return;n++;
    var p=prev[el.dataset.id+'|'+el.classList[0]];
    if(!p){var row=el.classList.contains('row')||el.classList.contains('w');anim(el,[{opacity:0,transform:'translate3d(0,'+(row?-10:10)+'px,0)'},{opacity:1,transform:'none'}],{duration:440,delay:Math.min(fresh++,6)*45,easing:EO,fill:'backwards'});return;}
    var dx=p.x-r.left,dy=p.y-r.top;
    if(Math.abs(dx)+Math.abs(dy)>2)anim(el,[{transform:'translate3d('+dx+'px,'+dy+'px,0)'},{transform:'none'}],{duration:460,easing:EO});
    var sc=el.querySelector('.sc,.ring span');
    if(sc&&p.s&&sc.textContent!==p.s){var t=sc.closest('.ring')||sc;anim(t,[{transform:'scale(1)'},{transform:'scale(1.16)',offset:.3},{transform:'scale(1)'}],{duration:620,easing:EO});anim(sc,[{opacity:.2},{opacity:1}],{duration:360,easing:'linear'});}
  });
  var b=m.querySelector('.stat b');if(b&&prev['#stat']&&prev['#stat']!==b.textContent)tween(b,+prev['#stat'],+b.textContent);
  bars(false);}
/* 标签下的红线和分段开关的滑块 */
function inkSync(jump){var ink=$('ink'),t=document.querySelector('.tab.on');if(!ink)return;if(!t){ink.classList.remove('on');return;}
  if(jump||!ink.classList.contains('on')){ink.style.transition='none';}
  ink.style.transform='translateX('+t.offsetLeft+'px) scaleX('+t.offsetWidth+')';ink.classList.add('on');
  if(ink.style.transition){ink.offsetWidth;ink.style.transition='';}}
function thumbSync(box,jump){var th=box.querySelector('.thumb'),on=box.querySelector('button.on');
  if(!th){th=document.createElement('i');th.className='thumb';box.appendChild(th);box.classList.add('th');jump=true;}
  if(!on){th.style.width='0';return;}
  if(jump||!parseFloat(th.style.width))th.style.transition='none';
  th.style.left=on.offsetLeft+'px';th.style.top=on.offsetTop+'px';th.style.width=on.offsetWidth+'px';th.style.height=on.offsetHeight+'px';
  if(th.style.transition){th.offsetWidth;th.style.transition='';}}
function thumbs(jump){['mseg','lang','theme'].forEach(function(id){thumbSync($(id),jump)});}
function tick(el,v){v=String(v);if(el.textContent===v)return;var had=el.textContent!=='';el.textContent=v;if(had&&state.loaded&&!state.first)anim(el,[{opacity:0,transform:'translateY(55%)'},{opacity:1,transform:'none'}],{duration:320,easing:EO});}
function render(soft,gesture){
  var key=state.view+'|'+state.mkt+'|'+state.lang+'|'+(state.only?state.only.label:'')+'|'+offCount(),qk=key+'|'+state.q,still=calm()||document.hidden;
  // 这一次渲染属于哪一种：进场（换了视图 / 市场 / 语言 / 钻取，或第一次有数据）、更新（同一视图来了新数据）、静默（翻译回填等）。打字搜索不做动效
  var kind=!state.loaded||still?'':(forceEnter||key.split('|').slice(0,4).join('|')!==lastKey.split('|').slice(0,4).join('|'))?'enter':soft?'more':qk===lastKey+'|'+lastQ?'update':'';
  var prev=kind==='update'?snap():null;lastKey=state.loaded?key:'';lastQ=state.q;forceEnter=false;
  want=[];var b=base();renderTabs(b);if(!soft)renderSide();
  var html='';
  if(!state.loaded){for(var k=0;k<9;k++)html+='<div class="sk" style="width:'+(50+(k*37)%45)+'%"></div>';}
  else if(state.view==='brief'){html=briefHtml(b)||emptyHtml();}
  else{var v=state.view==='star'?starList():b.filter(function(i){return inView(i,state.view)});html=v.length?'<div class="list">'+listHtml(v.slice(0,state.shown))+(state.view==='star'?'':'<div class="morebox">'+(v.length>state.shown||!state.noMore?'<button class="btn" id="moreBtn"'+(state.older?' disabled':'')+'>'+T(state.older?'loading':'loadMore')+'</button>':'<span>'+T('noMore')+'</span>')+'</div>')+'</div>':(state.noMore||state.view==='star'||state.view==='watch'&&!state.watch.length?emptyHtml():emptyHtml()+'<div class="morebox"><button class="btn" id="moreBtn"'+(state.older?' disabled':'')+'>'+T(state.older?'loading':'loadMore')+'</button></div>');}
  if(trail.length){var tp0=trail[trail.length-1];html='<div class="crumb"><button id="goBack"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>'+esc(T('backTo',T(tp0.view)))+'</button><span>'+esc(T('crumbQ',state.only?state.only.label:state.q.replace(/^[$#]/,'')))+' · '+T('crumbN',visible().length)+'</span></div>'+html;}
  $('main').innerHTML=html;var nowT=Date.now();Object.keys(state.newIds).forEach(function(id){if(nowT-state.newIds[id]>7000)delete state.newIds[id]});
  var rowsN=$('main').querySelectorAll('.row').length;
  // 打开网页时数据已经在手（秒开）：内容直接就位，不做浮现，只让圆环和条形图画出来；速度本身就是最好的动效
  if(kind==='enter'&&instant){instant=false;sweep($('main'));bars(true);}
  else if(kind==='enter'){enter();enterDir=0;}else if(kind==='update')play(prev);
  else if(kind==='more'&&rowsN>lastRows&&lastRows){[].slice.call($('main').querySelectorAll('.row'),lastRows,lastRows+14).forEach(function(el,k){rise(el,k)});}
  if(kind!=='enter'&&kind!=='update')bars(false);
  lastRows=rowsN;
  if(document.body.classList.contains('open-reader'))renderReader();
  setTop();if(want.length)pump(!!gesture);
}
function renderReader(){var i=state.sel&&byId(state.sel);if(i){$('rbody').innerHTML=detailHtml(i);$('reader').querySelector('.px span').textContent=T(isArt(i)?'lvDeep':'detail');loadRel(i);}}
/* 相关深度文章（快讯详情）/ 文章解读的快讯（文章详情）：打开详情时取一次，缓存 5 分钟 */
var REL={};
function relHtml(i){var c=REL[i.id];if(!c||!c.items||!c.items.length)return '';
  return '<div class="d-rel"><div class="d-rel-h">'+T(isArt(i)?'relFlash':'relArts')+' · <span class="num">'+c.items.length+'</span></div>'+c.items.map(function(r){var u=fixUrl(r.url),t=state.lang!=='zh'&&r.title_tr&&r.tr_lang===state.lang?r.title_tr:cleanTitle(r.title);
    var k=byId(r.id);
    return '<a class="d-rel-a" href="'+esc(u||'#')+'" target="_blank" rel="noopener">'+(isArt(i)&&k?sc(k):'<span class="tg'+(isArt(i)?' fl':'')+'" style="margin-top:3px">'+T(isArt(i)?'flashB':'deepB')+'</span>')+'<div><span dir="auto">'+esc(t)+'</span><small>'+esc(shortSrc(r.source))+' · <span class="num">'+hm(r.ts)+'</span></small></div></a>'}).join('')+'</div>';}
async function loadRel(i){if(!isArt(i)&&!(i.rel>0)&&!i.dup_of)return;var c=REL[i.id];if(c&&Date.now()-c.at<3e5)return;REL[i.id]={at:Date.now(),items:c&&c.items||[]};
  try{var r=await fetch(api('/api/related?id='+encodeURIComponent(i.id)),{cache:'no-store'});if(!r.ok)return;var d=await r.json();REL[i.id]={at:Date.now(),items:d.items||[]};
    if(state.sel===i.id&&d.items&&d.items.length)$('rbody').innerHTML=detailHtml(i);}catch(e){}}
function setTop(){document.documentElement.style.setProperty('--top',($('util').offsetHeight+$('tabs').offsetHeight)+'px');}
function applyI18n(){
  var r=document.documentElement;r.lang=state.lang==='zh'?'zh-CN':state.lang;r.dir=state.lang==='ar'?'rtl':'ltr';
  [].forEach.call(document.querySelectorAll('[data-i]'),function(e){e.textContent=T(e.dataset.i)});
  [].forEach.call(document.querySelectorAll('[data-ia]'),function(e){e.setAttribute('aria-label',T(e.dataset.ia));if(e.tagName==='INPUT')e.placeholder=T(e.dataset.ia);});
  $('winp').placeholder=T('wPh');
  [].forEach.call($('lang').children,function(b){b.classList.toggle('on',b.dataset.l===state.lang)});
  $('dateline').textContent=new Date().getFullYear()+' · '+dateText(Date.now());[].forEach.call($('mseg').children,function(b){b.classList.toggle('on',b.dataset.m===state.mkt)});$('live').title=T('refreshTip');renderClocks();thumbs();
}

/* ---------- 市场时段：盘前、常规、盘后，含夏令时和交易所假日 ---------- */
// 时区用 IANA 名称，夏令时由浏览器处理。假日是交易所公布的全天休市日；沙特两个开斋/宰牲节假期按天文推算，以交易所公告为准。
var HOLN={zh:{ny:'元旦',mlk:'马丁·路德·金日',pres:'总统日',gf:'耶稣受难日',mem:'阵亡将士纪念日',jun:'六月节',ind:'独立日',lab:'劳动节',thx:'感恩节',xmas:'圣诞节',found:'建国日',natl:'国庆日',fitr:'开斋节假期',adha:'宰牲节假期'},
 en:{ny:"New Year's Day",mlk:'MLK Day',pres:"Presidents' Day",gf:'Good Friday',mem:'Memorial Day',jun:'Juneteenth',ind:'Independence Day',lab:'Labor Day',thx:'Thanksgiving',xmas:'Christmas',found:'Founding Day',natl:'National Day',fitr:'Eid al-Fitr holiday',adha:'Eid al-Adha holiday'},
 ar:{ny:'رأس السنة',mlk:'يوم مارتن لوثر كينغ',pres:'يوم الرؤساء',gf:'الجمعة العظيمة',mem:'يوم الذكرى',jun:'جونتينث',ind:'عيد الاستقلال',lab:'عيد العمال',thx:'عيد الشكر',xmas:'عيد الميلاد',found:'يوم التأسيس',natl:'اليوم الوطني',fitr:'إجازة عيد الفطر',adha:'إجازة عيد الأضحى'}};
var MK={
 us:{tz:'America/New_York',days:[1,2,3,4,5],segs:[[240,570,'pre'],[570,960,'open'],[960,1200,'post']],short:[[240,570,'pre'],[570,780,'open'],[780,1020,'post']],
  hol:{'2026-11-26':'thx','2026-12-25':'xmas','2027-01-01':'ny','2027-01-18':'mlk','2027-02-15':'pres','2027-03-26':'gf','2027-05-31':'mem','2027-06-18':'jun','2027-07-05':'ind','2027-09-06':'lab','2027-11-25':'thx','2027-12-24':'xmas'},
  early:{'2026-11-27':1,'2026-12-24':1,'2027-11-26':1}},
 sa:{tz:'Asia/Riyadh',days:[0,1,2,3,4],segs:[[600,900,'open']],
  hol:{'2027-02-22':'found','2027-03-08':'fitr','2027-03-09':'fitr','2027-03-10':'fitr','2027-03-11':'fitr','2027-05-16':'adha','2027-05-17':'adha','2027-05-18':'adha','2027-05-19':'adha','2027-05-20':'adha','2027-09-23':'natl'},early:{}}};
var WD={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
function zparts(ts,tz){var p={};new Intl.DateTimeFormat('en-US',{timeZone:tz,weekday:'short',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZoneName:'short'}).formatToParts(new Date(ts)).forEach(function(x){p[x.type]=x.value});
  return {y:+p.year,m:+p.month,d:+p.day,wd:WD[p.weekday],min:(+p.hour%24)*60+(+p.minute),hm:('0'+(+p.hour%24)).slice(-2)+':'+p.minute,abbr:p.timeZoneName||''};}
function tzOff(ts,tz){var z=zparts(ts,tz);return Date.UTC(z.y,z.m-1,z.d,0,z.min)-Math.floor(ts/6e4)*6e4;}
function zToUtc(y,m,d,min,tz){var g=Date.UTC(y,m-1,d,0,min),r=g-tzOff(g,tz);return g-tzOff(r,tz);}
function ymd(dt){return dt.getUTCFullYear()+'-'+('0'+(dt.getUTCMonth()+1)).slice(-2)+'-'+('0'+dt.getUTCDate()).slice(-2);}
// 从今天（交易所当地日期）起往后 n 天的全部交易时段，换算成绝对时间
function sessions(mk,now,n){var z=zparts(now,mk.tz),out=[];
  for(var k=-1;k<n;k++){var dt=new Date(Date.UTC(z.y,z.m-1,z.d+k)),key=ymd(dt);
    if(mk.days.indexOf(dt.getUTCDay())<0||mk.hol[key])continue;
    (mk.early[key]?mk.short:mk.segs).forEach(function(g){out.push({a:zToUtc(dt.getUTCFullYear(),dt.getUTCMonth()+1,dt.getUTCDate(),g[0],mk.tz),b:zToUtc(dt.getUTCFullYear(),dt.getUTCMonth()+1,dt.getUTCDate(),g[1],mk.tz),k:g[2]});});}
  return out;}
function dur(ms){var m=Math.max(1,Math.round(ms/6e4)),h=Math.floor(m/60);if(h>=24)return T('dD',Math.floor(h/24),h%24);if(h)return T('dH',h,m%60);return T('dM',m);}
function earHtml(name,mk,now){
  var z,ss;try{z=zparts(now,mk.tz);ss=sessions(mk,now,12);}catch(e){return '';}
  var cur=null,nextOpen=null;ss.forEach(function(x){if(now>=x.a&&now<x.b)cur=x;if(!nextOpen&&x.k==='open'&&x.a>now)nextOpen=x;});
  var st=cur?cur.k:'closed',label=T(st==='open'?'sOpen':st==='pre'?'sPre':st==='post'?'sPost':'sClosed'),next='';
  var key=z.y+'-'+('0'+z.m).slice(-2)+'-'+('0'+z.d).slice(-2),hol=mk.hol[key];
  if(st==='open')next=T('nClose',dur(cur.b-now));else if(st==='post')next=T('nEnd',dur(cur.b-now));else if(nextOpen)next=T('nOpen',dur(nextOpen.a-now));
  if(st==='closed'&&hol)label+=' · '+((HOLN[state.lang]||HOLN.en)[hol]||'');
  if(mk.early[key]&&st!=='closed')next+=' · '+T('early');
  // 时段条只画“这一个交易日”：从当天第一个时段开始到最后一个时段结束，刻度是交易所当地时间。
  // 今天的时段都结束了（或今天休市）就画下一个交易日，并注明是哪天。
  var days={},order=[];ss.forEach(function(x){var d=zparts(x.a,mk.tz),k=d.y+'-'+d.m+'-'+d.d;if(!days[k]){days[k]=[];order.push(k);}days[k].push(x);});
  var day=null;order.forEach(function(k){var g=days[k];if(!day&&g[g.length-1].b>now)day=g;});
  var rail='';
  if(day){var d0=day[0].a,d1=day[day.length-1].b,span=d1-d0,pos=function(t){return ((t-d0)/span*100).toFixed(2)},segs='',ax='';
    day.forEach(function(x,n){
      segs+='<s class="'+x.k+(x===cur?' cur':'')+'" style="inset-inline-start:'+pos(x.a)+'%;width:'+((x.b-x.a)/span*100).toFixed(2)+'%"></s>';
      var nm=x.k==='pre'?T('lPre'):x.k==='open'?T('lOpen'):day[n-1]&&day[n-1].k==='open'?T('lClose'):'';
      ax+='<span class="'+(n===0?'a0':'')+'" style="inset-inline-start:'+pos(x.a)+'%"><b class="num">'+zparts(x.a,mk.tz).hm+'</b>'+(nm?'<i>'+nm+'</i>':'')+'</span>';
      if(n===day.length-1)ax+='<span class="a1'+(x.k==='open'?'':' ae')+'" style="inset-inline-start:100%"><b class="num">'+zparts(x.b,mk.tz).hm+'</b>'+(x.k==='open'?'<i>'+T('lClose')+'</i>':'')+'</span>';});
    var live=now>=d0&&now<=d1,dz=zparts(d0,mk.tz),other=dz.d!==z.d||dz.m!==z.m,when='';
    {try{when=new Intl.DateTimeFormat(state.lang==='zh'?'zh-CN':state.lang,{timeZone:mk.tz,weekday:'short',month:'numeric',day:'numeric'}).format(new Date(d0));}catch(e){}}
    rail='<div class="rail'+(st==='open'?' on':'')+(live?'':' idle')+'">'+segs+(live?'<em style="inset-inline-start:'+pos(now)+'%"></em>':'')+'</div><div class="rax">'+ax+'</div><div class="rnote">'+(when?esc(T(other?'nextDay':'thisDay',when)):'&nbsp;')+'</div>';}
  // 下一个节点换算成看的人自己的时间（和交易所不在同一时区时才显示）
  var tgt=st==='open'||st==='post'?cur.b:nextOpen?nextOpen.a:0,mine='';
  if(tgt&&tgt-now<864e5&&tzOff(now,mk.tz)!==-new Date(now).getTimezoneOffset()*6e4)mine=' · '+T('yourT',hm(tgt));
  return '<div class="eh"><span>'+T(name)+'</span><b class="num">'+z.hm+'</b><small>'+esc(z.abbr)+'</small></div>'+
    '<div class="es"><u class="'+st+'"></u><strong>'+esc(label)+'</strong><span>'+esc(next+mine)+'</span></div>'+rail;}
var EARS={};
function renderClocks(){var now=Date.now();[['earUS','ny',MK.us],['earSA','ry',MK.sa]].forEach(function(a){var h=earHtml(a[1],a[2],now);if(EARS[a[0]]===h)return;EARS[a[0]]=h;var el=$(a[0]);el.innerHTML=h;var u=el.querySelector('u.open');if(u)u.style.setProperty('--d','-'+(now%3000)+'ms');});}

/* ---------- 市场筛选：全部 / 美股 / 沙特 ---------- */
var SASRC=/^(Argaam|Arab News|Arabian Business|Saudi Gazette|Asharq)/i,
  SAW=/saudi|aramco|tadawul|riyadh|sabic|\bpif\b|opec|crude|\boil\b|brent|\bgulf\b|middle east|\biran|hormuz|qatar|\buae\b|沙特|阿美|利雅得|欧佩克|原油|油价|中东|海湾|伊朗|霍尔木兹|\p{Script=Arabic}/iu,
  USW=/\bU\.?S\.?\b|\bFed\b|Wall Street|Nasdaq|S&P|Dow\b|Treasur|Trump|White House|dollar|美股|美国|美联储|美元|华尔街|纳指|标普|道指/;
function inMkt(i,m){if(m==='all')return true;var tk=i.tickers||'',t=i.title+' '+(i.topic||''),saSrc=SASRC.test(i.source);
  if(m==='sa')return saSrc||/(^|,)\d{4}(,|$)/.test(tk)||SAW.test(t);
  return !saSrc||/[A-Z]/.test(tk)||USW.test(t);}
function setMkt(m){state.mkt=m;state.shown=400;save();applyI18n();render();}

/* ---------- 声音、通知、提示 ---------- */
function beep(){try{var a=new (window.AudioContext||window.webkitAudioContext)(),t=a.currentTime;[880,1320].forEach(function(f,k){var o=a.createOscillator(),g=a.createGain();o.type='sine';o.frequency.value=f;o.connect(g);g.connect(a.destination);g.gain.setValueAtTime(0,t+k*.14);g.gain.linearRampToValueAtTime(.16,t+k*.14+.02);g.gain.exponentialRampToValueAtTime(.001,t+k*.14+.22);o.start(t+k*.14);o.stop(t+k*.14+.25);});}catch(e){}}
function tip(s,ms){var el=$('tip');el.textContent=s;el.classList.add('show');clearTimeout(tip.t);tip.t=setTimeout(function(){el.classList.remove('show')},ms||2200);}
function showPill(){var n=state.pending.length,el=$('pill');if(!n){el.classList.remove('show');return;}
  var hot=state.pending.filter(isHot).length;el.classList.toggle('hot',hot>0);
  el.textContent=hot?T('newHot',hot):T('newAll',n);el.classList.add('show');}
function merge(){if(!state.pending.length)return;if(!state.first){var nt=Date.now();state.pending.forEach(function(i){state.newIds[i.id]=nt});}
  state.items=state.pending.concat(state.items).sort(function(a,b){return b.ts-a.ts}).slice(0,6000);state.pending=[];showPill();}

/* ---------- 数据 ---------- */
var unread=0;
async function load(manual){
  if(state.loading)return;state.loading=true;if(manual)$('live').classList.add('spin');
  try{
    var r=await fetch(api('/api/items?limit=400&since='+(state.first?(state.bootAt?Math.max(0,Math.min(state.lastSeen,state.bootAt)-18e5):0):Math.max(0,state.lastSeen-18e5))),{cache:'no-store'});
    if(!r.ok)throw new Error('HTTP '+r.status);
    var d=await r.json(),known={},changed=!state.loaded;
    // 用本机快照先显示的：如果离开太久、中间隔了不止一页，就丢掉快照，只用新数据，避免中间缺一段
    if(state.first&&state.bootAt&&d.items.length>=400){state.items=[];changed=true;}
    if(d.build)newBuild(d.build);
    state.items.forEach(function(x){known[x.id]=1});state.pending.forEach(function(x){known[x.id]=1});
    var fresh=d.items.filter(function(i){return !known[i.id]});
    // 已有条目可能后来被打分：用新数据覆盖
    var upd={};d.items.forEach(function(i){upd[i.id]=i});
    state.items=state.items.map(function(x){var u=upd[x.id];if(u&&(x.lite||u.score!==x.score||u.important!==x.important||u.confirms!==x.confirms||u.dup_of!==x.dup_of||u.title_tr!==x.title_tr||u.topic!==x.topic)){changed=true;if(isHot(u)&&!isHot(x)&&!state.first&&state.sound)beep();return u;}return x;});
    state.pending=state.pending.map(function(x){return upd[x.id]||x});
    if(fresh.length){
      fresh.forEach(function(i){state.lastSeen=Math.max(state.lastSeen,i.seen_at)});
      state.pending=fresh.concat(state.pending);changed=true;
      if(!state.first){
        var hot=fresh.filter(isHot);
        if(hot.length){
          if(state.sound)beep();
          if(state.notify&&!PUSH.sub&&window.Notification&&Notification.permission==='granted')hot.slice(0,3).forEach(function(i){try{new Notification(cleanTitle(i.title),{body:i.source+' · '+fmtScore(i.score),tag:i.id})}catch(e){}});
          if(document.hidden){unread+=hot.length;document.title='('+unread+') Headline Watch';}
        }
      }
      // 正在往下读、或开着详情时不打断：新快讯先攒着，顶部出现提示
      if(state.first||(window.scrollY<140&&!document.body.classList.contains('open-reader'))){merge();}else{showPill();}
    }
    state.first=false;state.loaded=true;
    if(!document.hidden){if(state.lastSeen>state.topSeen)state.topSeen=state.lastSeen;save();}
    if(changed){render();snapSoon();if(fresh.length&&!calm()){var lv=$('live');lv.classList.remove('ping');lv.offsetWidth;lv.classList.add('ping');setTimeout(function(){lv.classList.remove('ping')},950);}}
    state.okAt=Date.now();$('live').classList.remove('err');var ls=T('updated',hm(Date.now())),le=$('liveTxt');if(le.textContent!==ls){le.textContent=ls;anim(le,[{opacity:.25},{opacity:1}],{duration:300,easing:'linear'});}if(manual&&!changed)tip(T('refreshed'));
  }catch(e){stale();if(manual)tip(T('fail'));if(!state.loaded&&!state.items.length){$('main').innerHTML='<div class="empty"><b>'+T('eConn')+'</b>'+T('eConnD')+'</div>';}}
  state.loading=false;$('live').classList.remove('spin');
}
function stale(){$('live').classList.add('err');$('liveTxt').textContent=state.okAt?T('staleAt',hm(state.okAt)):T('fail');}
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
var VORD=['brief','hot','mid','all','deep','watch','star'];
function setView(v){var d=VORD.indexOf(v)-VORD.indexOf(state.view);enterDir=d>0?1:d<0?-1:0;state.view=v;state.shown=400;save();render();window.scrollTo({top:0});}
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
function clearFilters(){state.off={};state.only=null;state.q='';$('q').value='';save();forceEnter=true;render();}
/* ---------- 钻取与返回：点股票、话题、“另有 N 条相关”会记下原来的视图和滚动位置，返回时原样恢复 ----------
   浏览器的后退键、手机的返回手势、Esc 和页面上的返回按钮都走同一条路；详情面板和设置面板也能用返回关闭。 */
var trail=[],panelHist=false,skipPop=0;
function hpush(){try{history.pushState({hw:1},'')}catch(e){}}
function hback(){skipPop++;try{history.back()}catch(e){skipPop--;}}
function drill(q,noPush){trail.push({view:state.view,q:state.q,only:state.only,y:window.scrollY});if(!noPush)hpush();state.only=null;state.q=q;$('q').value=q;forceEnter=true;setView('all');}
function drillEv(k,noPush){var e=EVS[k];if(!e)return;trail.push({view:state.view,q:state.q,only:state.only,y:window.scrollY});if(!noPush)hpush();state.only=e;state.q='';$('q').value='';forceEnter=true;setView('all');}
function goBack(){var p=trail.pop();if(!p)return false;state.view=p.view;state.only=p.only||null;state.q=p.q;$('q').value=p.q;state.shown=400;save();forceEnter=true;enterDir=-1;render();
  requestAnimationFrame(function(){window.scrollTo(0,p.y)});return true;}
function leaveDrill(){state.only=null;while(trail.length){trail.pop();hback();}}
function panel(name,on,fromPop){document.body.classList.remove('open-reader','open-side');if(on)document.body.classList.add('open-'+name);
  if(on&&!panelHist){panelHist=true;hpush();}else if(!on&&panelHist){panelHist=false;if(!fromPop)hback();}}
window.addEventListener('popstate',function(){if(skipPop>0){skipPop--;return;}
  if(panelHist){panelHist=false;return panel('',false,true);}
  if(show.on)return;goBack();});
function openReader(id){state.sel=id;var old=document.querySelector('.row.sel');if(old)old.classList.remove('sel');
  var el=document.querySelector('.row[data-id="'+(window.CSS&&CSS.escape?CSS.escape(id):id)+'"]');if(el){el.classList.add('sel');el.scrollIntoView({block:'nearest'});}
  var was=document.body.classList.contains('open-reader');want=[];renderReader();$('reader').scrollTop=0;panel('reader',true);if(want.length)pump(false);
  // 面板滑入时内容跟着依次浮现；已经开着、用 J/K 换条时只做一次很快的淡入
  var d=$('rbody').firstElementChild;if(d){if(was)anim($('rbody'),[{opacity:0,transform:'translateY(6px)'},{opacity:1,transform:'none'}],{duration:220,easing:EO});
    else{[].slice.call(d.children,0,8).forEach(function(el,k){anim(el,[{opacity:0,transform:'translateY(10px)'},{opacity:1,transform:'none'}],{duration:420,delay:70+k*30,easing:EO,fill:'backwards'})});sweep(d);}}}
function move(dir){if(state.view==='brief')return;var v=visible();if(!v.length)return;var k=-1;v.forEach(function(i,n){if(i.id===state.sel)k=n});
  k=Math.max(0,Math.min(v.length-1,k+dir));openReader(v[k].id);}
function applyTheme(){var r=document.documentElement;if(state.theme==='auto')r.removeAttribute('data-theme');else r.setAttribute('data-theme',state.theme);
  var dark=state.theme==='dark'||(state.theme==='auto'&&window.matchMedia('(prefers-color-scheme:dark)').matches);$('tc').setAttribute('content',dark?'#12100d':'#f5f0e6');}
function setLang(l,gesture){state.lang=l;trTok++;trs={};trBusy={};want=[];wantBody={};trStatus();trLoad();save();applyI18n();if(gesture)warm();render(false,gesture);$('liveTxt').textContent=T('updated',hm(Date.now()));}
function shareText(i){var o=tx(i,true),b=o.b!=null?o.b:(o.tr?'':cleanBody(i)),u=fixUrl(i.url),d=new Date(i.ts);
  var L=['【'+o.t+'】'];if(b)L.push(b.split('\n\n')[0]);if(o.tr)L.push(T('original')+': '+cleanTitle(i.title));
  L.push(T('src')+': '+shortSrc(i.source)+' · '+(d.getMonth()+1)+'/'+d.getDate()+' '+hm(i.ts)+' · '+T('scoreN',fmtScore(i.score))+(i.confirms>0?' · '+T('nSrc',i.confirms+1):''));if(u)L.push(u);return L.join('\n');}
function toggleStar(id){var i=byId(id);if(!i)return;if(state.stars[id])delete state.stars[id];else{var ks=Object.keys(state.stars);if(ks.length>=200)delete state.stars[ks[0]];state.stars[id]={id:i.id,source:i.source,title:i.title,body:i.body,url:i.url,ts:i.ts,seen_at:i.seen_at,score:i.score,score_by:i.score_by,base_score:i.base_score,important:i.important,confirms:i.confirms,hits:i.hits};}
  saveStars();render(true);var sb=$('reader').querySelector('[data-star]');if(sb&&document.body.classList.contains('open-reader'))anim(sb,[{transform:'scale(1)'},{transform:'scale(1.12)',offset:.35},{transform:'scale(1)'}],{duration:420,easing:ESP});}
function copyClick(e){var st=e.target.closest('[data-star]');if(st){toggleStar(st.dataset.star);return true;}
  var b=e.target.closest('[data-copy]');if(!b)return false;var i=byId(b.dataset.copy);if(!i)return true;var s=shareText(i);
  (navigator.clipboard?navigator.clipboard.writeText(s):Promise.reject()).then(function(){tip(T('shared'))},function(){tip(T('copyFail'))});return true;}

$('tabs').addEventListener('click',function(e){var t=e.target.closest('.tab');if(t){leaveDrill();return setView(t.dataset.v);}if(e.target.id==='clr'){leaveDrill();clearFilters();}});
$('mseg').addEventListener('click',function(e){var b=e.target.closest('[data-m]');if(b)setMkt(b.dataset.m);});
$('main').addEventListener('click',function(e){
  if(e.target.id==='clr2')return clearFilters();
  if(e.target.id==='moreBtn')return loadOlder();
  if(e.target.id==='wgo'){panel('side',true);return $('winp').focus();}
  var go=e.target.closest('[data-go]');if(go)return setView(go.dataset.go);
  var evb=e.target.closest('[data-ev]');if(evb){e.stopPropagation();return drillEv(evb.dataset.ev);}
  var rl=e.target.closest('[data-rel]');if(rl){e.stopPropagation();return drill(rl.dataset.rel);}
  var tkb=e.target.closest('[data-tk]');if(tkb)return drill('$'+tkb.dataset.tk);
  if(e.target.closest('#goBack')){goBack();return hback();}
  var tp=e.target.closest('[data-topic]');if(tp)return drill(tp.dataset.topic);
  if(window.getSelection&&String(window.getSelection()))return;
  var r=e.target.closest('[data-id]');if(r)openReader(r.dataset.id);});
$('main').addEventListener('keydown',function(e){if(e.key==='Enter'&&e.target.dataset&&e.target.dataset.topic)e.target.click();});
$('reader').addEventListener('click',function(e){if(copyClick(e))return;
  var evb=e.target.closest('[data-ev]'),rl=e.target.closest('[data-rel]'),tkb=e.target.closest('[data-tk]');
  if(evb||rl||tkb){var had=panelHist;panelHist=false;document.body.classList.remove('open-reader');
    return evb?drillEv(evb.dataset.ev,had):drill(rl?rl.dataset.rel:'$'+tkb.dataset.tk,had);}
  var r=e.target.closest('[data-id]');if(r&&byId(r.dataset.id)){openReader(r.dataset.id);$('reader').scrollTop=0;}});
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
$('theme').onclick=function(e){var b=e.target.closest('button');if(!b)return;state.theme=b.dataset.t;save();renderSide();thumbs();
  if(document.startViewTransition&&!calm())document.startViewTransition(applyTheme);else applyTheme();};
$('lang').onclick=function(e){var b=e.target.closest('button');if(b)setLang(b.dataset.l,true);};
$('trOn').onclick=function(){trStatus();warm();render(true,true);};
$('q').oninput=function(e){state.only=null;state.q=e.target.value.trim();if(state.q&&state.view==='brief')state.view='all';render();};
$('sbtn').onclick=function(){$('util').classList.add('searching');$('q').focus();};
$('cancel').onclick=function(){$('util').classList.remove('searching');if(state.q){state.q='';$('q').value='';render();}};
$('fbtn').onclick=function(){panel('side',true)};
$('pill').onclick=function(){merge();render();window.scrollTo({top:0,behavior:'smooth'});};
window.addEventListener('scroll',function(){if(state.pending.length&&window.scrollY<140&&!document.body.classList.contains('open-reader')){merge();render();}},{passive:true});
document.addEventListener('keydown',function(e){
  if(e.metaKey||e.ctrlKey||e.altKey)return;
  if(show.on){if(e.key==='Escape')showClose();else if(e.key==='ArrowRight'||e.key==='ArrowDown')showGo(1);else if(e.key==='ArrowLeft'||e.key==='ArrowUp')showGo(-1);else if(e.key===' '){show.paused=!show.paused;$('show').classList.toggle('paused',show.paused);}e.preventDefault();return;}
  var typing=/^(INPUT|TEXTAREA)$/.test((e.target.tagName||''));
  if(e.key==='Escape'){if(document.body.className.indexOf('open-')>=0)return panel('',false);if(!typing&&trail.length){goBack();return hback();}if(typing){e.target.blur();if(state.q){state.q='';$('q').value='';render();}$('util').classList.remove('searching');}return;}
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
document.addEventListener('visibilitychange',function(){
  if(document.hidden){state.hiddenAt=Date.now();save();return;}
  // 离开超过 30 分钟再回来，算一次新的访问：标记线移到离开时看到的位置
  if(state.hiddenAt&&Date.now()-state.hiddenAt>=18e5&&state.topSeen>state.prevSeen){state.prevSeen=state.topSeen;render();}
  state.hiddenAt=0;unread=0;document.title='Headline Watch';load();renderClocks();});
// 手机从后台回来、网络恢复、从浏览器的前进后退缓存里恢复时，马上补一次更新（手机浏览器在后台会暂停定时器）
window.addEventListener('online',function(){load()});window.addEventListener('pageshow',function(e){if(e.persisted)load()});window.addEventListener('focus',function(){if(Date.now()-(state.okAt||0)>2e4)load()});
window.addEventListener('offline',stale);
setInterval(function(){if(state.okAt&&Date.now()-state.okAt>6e4)stale()},2e4);
$('live').addEventListener('click',function(){load(true)});$('live').addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();load(true);}});
window.addEventListener('resize',function(){setTop();inkSync(true);thumbs(true);});

/* ---------- 后台推送（Web Push）：关掉网页也能收到系统通知 ---------- */
var PUSH={ok:'serviceWorker' in navigator&&'PushManager' in window&&!!window.Notification,reg:null,sub:null,info:null,cfg:{min:9,mode:'score',qf:null,qt:null,sticky:false},busy:false};
try{var pc=JSON.parse(localStorage.getItem('hwpush')||'null');if(pc)PUSH.cfg=pc}catch(e){}
function pushSaveLocal(){try{localStorage.setItem('hwpush',JSON.stringify(PUSH.cfg))}catch(e){}}
function u8(s){s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';var b=atob(s),a=new Uint8Array(b.length);for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return a}
function pushPost(p,body){return fetch(api(p),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json().catch(function(){return {ok:r.ok}}).then(function(d){d.httpOk=r.ok;return d})})}
async function pushInfo(){try{var r=await fetch(api('/api/push/key'+(PUSH.sub?'?endpoint='+encodeURIComponent(PUSH.sub.endpoint):'')),{cache:'no-store'});if(r.ok)PUSH.info=await r.json();}catch(e){}}
async function pushInit(){
  if(!PUSH.ok)return renderPush();
  try{PUSH.reg=await navigator.serviceWorker.register(api('/sw.js'));PUSH.sub=await PUSH.reg.pushManager.getSubscription();}catch(e){}
  await pushInfo();
  if(PUSH.sub&&PUSH.info){var s=PUSH.info.sub;
    if(s){PUSH.cfg={min:s.min,mode:s.mode,qf:s.quietFrom,qt:s.quietTo,sticky:!!s.sticky};pushSaveLocal();}
    else await pushSave();} // 服务器那边丢了这个订阅（例如失效后被删）：用本地设置补上
  renderPush();
}
function pushBody(){var c=PUSH.cfg,tz='';try{tz=Intl.DateTimeFormat().resolvedOptions().timeZone||''}catch(e){}
  return {subscription:PUSH.sub.toJSON(),min:c.min,mode:c.mode,quietFrom:c.qf,quietTo:c.qt,sticky:!!c.sticky,tz:tz,page:location.href.split('#')[0]}}
async function pushSave(){if(!PUSH.sub)return;try{await pushPost('/api/push/subscribe',pushBody())}catch(e){}}
async function pushToggle(){
  if(!PUSH.ok)return tip(T('pushNo'));
  if(PUSH.busy)return;
  if(PUSH.sub){PUSH.busy=true;var ep=PUSH.sub.endpoint;try{await PUSH.sub.unsubscribe()}catch(e){}PUSH.sub=null;try{await pushPost('/api/push/unsubscribe',{endpoint:ep})}catch(e){}PUSH.busy=false;renderPush();return tip(T('pushOffTip'));}
  if(Notification.permission==='denied')return tip(T('notifDenied'),4000);
  var perm=Notification.permission==='granted'?'granted':await Notification.requestPermission();
  if(perm!=='granted')return renderPush();
  PUSH.busy=true;$('swPush').setAttribute('aria-pressed','true');
  try{
    if(!PUSH.reg)PUSH.reg=await navigator.serviceWorker.register(api('/sw.js'));
    await navigator.serviceWorker.ready;
    if(!PUSH.info||!PUSH.info.publicKey)await pushInfo();
    PUSH.sub=await PUSH.reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:u8(PUSH.info.publicKey)});
    var d=await pushPost('/api/push/subscribe',pushBody());
    if(!d.httpOk)throw new Error(d.error||'HTTP');
    tip(T('pushOnTip'));
  }catch(e){tip(T('pushErr',(e&&e.message)||e),5000);if(PUSH.sub){try{await PUSH.sub.unsubscribe()}catch(x){}PUSH.sub=null;}}
  PUSH.busy=false;renderPush();
}
function renderPush(){
  if(!$('swPush')||!window.PUSH)return;
  var on=!!PUSH.sub,c=PUSH.cfg,cnt=PUSH.info&&PUSH.info.counts;
  $('swPush').setAttribute('aria-pressed',on?'true':'false');
  var chrome=/Chrome\//.test(navigator.userAgent)&&!/Edg\//.test(navigator.userAgent);
  $('pushHint').textContent=!PUSH.ok?T('pushNo'):Notification.permission==='denied'?T('notifDenied'):on?T('pushOn'):(chrome?T('pushDC'):T('pushD'));
  $('pushOpts').hidden=!on;$('swSticky').setAttribute('aria-pressed',c.sticky?'true':'false');
  var key=c.mode==='confirmed'?'confirmed':String(c.min);
  [].forEach.call($('pushMin').children,function(b){var m=b.dataset.m;b.classList.toggle('on',m===key);b.querySelector('small').textContent=cnt&&cnt[m]!=null?T('perDay',cnt[m]):'';});
  $('pushCnt').textContent=cnt&&cnt[key]!=null?T('pushCnt',cnt[key]):'';
  ['qFrom','qTo'].forEach(function(id,k){var el=$(id),v=k?c.qt:c.qf,h='<option value="">'+T('qOff')+'</option>';
    for(var i=0;i<24;i++)h+='<option value="'+i+'"'+(v===i?' selected':'')+'>'+(i<10?'0':'')+i+':00</option>';el.innerHTML=h;});
}
$('swPush').onclick=pushToggle;
$('pushMin').onclick=function(e){var b=e.target.closest('[data-m]');if(!b)return;var m=b.dataset.m;
  if(m==='confirmed')PUSH.cfg.mode='confirmed';else{PUSH.cfg.mode='score';PUSH.cfg.min=Number(m);}pushSaveLocal();renderPush();pushSave();};
function qChange(){var a=$('qFrom').value,b=$('qTo').value;PUSH.cfg.qf=a===''?null:Number(a);PUSH.cfg.qt=b===''?null:Number(b);pushSaveLocal();pushSave();}
$('swSticky').onclick=function(){PUSH.cfg.sticky=!PUSH.cfg.sticky;pushSaveLocal();renderPush();pushSave();};
$('qFrom').onchange=qChange;$('qTo').onchange=qChange;
$('pushTest').onclick=async function(){if(!PUSH.sub)return;try{var d=await pushPost('/api/push/test',{endpoint:PUSH.sub.endpoint});tip(d.httpOk?T('pushSent'):T('pushFail',d.error||d.status),4000);}catch(e){tip(T('pushFail',e.message||e),4000);}};
// 点通知打开看板时定位到那条快讯
function openFromPush(id){if(!id||/^test/.test(id))return;if(byId(id))return openReader(id);load().then(function(){merge();render();if(byId(id))openReader(id);});}
if(PUSH.ok)navigator.serviceWorker.addEventListener('message',function(e){if(e.data&&e.data.hwOpen)openFromPush(e.data.hwOpen);});
var hashId=/^#i=/.test(location.hash)?decodeURIComponent(location.hash.slice(3)):null;
if(hashId){try{history.replaceState(history.state,'',location.href.split('#')[0])}catch(e){}}
/* ---------- 秒开：先用现成的数据把页面画出来，再去拿更新 ----------
   两个来源取较新的一个：服务器写进网页的首屏数据（BOOT），和本机上次看到的快照（刷新、断网时用）。
   超过 12 小时的旧数据不用，照常显示骨架等网络。 */
var SNAP='hw-snap',snapT=0;
function snapSave(){try{if(state.loaded&&!state.lite&&state.items.length)localStorage.setItem(SNAP,JSON.stringify({now:state.okAt||Date.now(),stats:state.stats,items:state.items.slice(0,400)}))}catch(e){try{localStorage.removeItem(SNAP)}catch(e2){}}}
function snapSoon(){clearTimeout(snapT);snapT=setTimeout(function(){(window.requestIdleCallback||setTimeout)(snapSave)},1500);}
window.addEventListener('pagehide',snapSave);
function bootData(){var b=BOOT,c=null,at=0;try{c=JSON.parse(localStorage.getItem(SNAP)||'null')}catch(e){}
  if(c&&(!c.items||!c.items.length||Date.now()-c.now>432e5))c=null;
  if(!b||!b.items||!b.items.length||Date.now()-b.now>432e5)b=null;
  if(b&&c&&c.now>b.now)b=null;
  if(!b&&!c)return false;
  if(b&&c){// 网页自带的数据更新，但只有标题；正文从本机快照里补
    var m={};c.items.forEach(function(i){m[i.id]=i});at=c.now;
    b.items=b.items.map(function(i){var o=i.lite&&m[i.id];if(!o)return i;o=Object.assign({},o,i);delete o.lite;return o;});}
  var src=b||c;state.items=src.items;state.stats=src.stats||null;state.bootAt=at||src.now;state.loaded=true;
  state.lite=state.items.some(function(i){return i.lite});
  state.items.forEach(function(i){if(i.seen_at>state.lastSeen)state.lastSeen=i.seen_at});
  return Math.abs(Date.now()-src.now)<2e4;}
// 轻量条目补全文：取一次完整的最新 400 条，按 id 补上正文和链接
async function fillLite(){if(!state.lite)return;
  try{var r=await fetch(api('/api/items?limit=400&since=0'),{cache:'no-store'});if(!r.ok)return;var d=await r.json(),u={};d.items.forEach(function(i){u[i.id]=i});
    state.items=state.items.map(function(x){if(!x.lite)return x;if(u[x.id])return u[x.id];x=Object.assign({},x);delete x.lite;return x;});
    state.lite=false;if(document.body.classList.contains('open-reader'))renderReader();snapSoon();}catch(e){}}
/* 新版本：服务器的版本号和这张网页不一样时，先把新网页存好。刚打开、还没动过就悄悄换上；已经在用了就只提示，不打断 */
var touched=false,buildSeen='';
['pointerdown','keydown','wheel','touchstart'].forEach(function(n){window.addEventListener(n,function(){touched=true},{passive:true,capture:true})});
async function newBuild(b){if(!b||b===BUILD||b===buildSeen)return;buildSeen=b;
  try{if(window.caches){var r=await fetch(location.href.split('#')[0],{cache:'reload'});if(r.ok&&r.headers.get('X-HW-Build')===b)await (await caches.open('hw-shell')).put(location.href.split('#')[0],r);}}catch(e){}
  var tried='';try{tried=sessionStorage.getItem('hw-build')||'';sessionStorage.setItem('hw-build',b)}catch(e){return}
  if(tried===b)return;
  if(!touched&&!document.body.classList.contains('open-reader')&&!document.body.classList.contains('open-side')&&!show.on&&window.scrollY<200)location.reload();
  else{var el=$('tip');el.textContent=T('newVer');el.classList.add('show','act');el.onclick=function(){location.reload()};}}
if('serviceWorker' in navigator)navigator.serviceWorker.register(api('/sw.js')).catch(function(){});
var freshBoot=bootData();instant=state.loaded;
trLoad();applyTheme();applyI18n();render();
if(freshBoot){state.first=false;state.okAt=Date.now();$('liveTxt').textContent=T('updated',hm(Date.now()));if(state.lastSeen>state.topSeen)state.topSeen=state.lastSeen;save();snapSoon();if(hashId)openFromPush(hashId);fillLite().then(backfill);}
else{load().then(function(){if(hashId)openFromPush(hashId);}).then(fillLite).then(backfill);}
if(!state.stats)loadStats();
pushInit();(window.requestIdleCallback||setTimeout)(loadHealth);setInterval(loadStats,3e5);
setInterval(load,15000);setInterval(renderClocks,20000);setInterval(loadHealth,300000);
`;

const ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%23f5f0e6'/%3E%3Cpath d='M9 8v16M23 8v16M9 16h14' stroke='%231a1714' stroke-width='3.4'/%3E%3Ccircle cx='25.5' cy='6.5' r='3.5' fill='%23c8371d'/%3E%3C/svg%3E";

const X = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m2 2 10 10M12 2 2 12"/></svg>';

const BODY = `
<div class="bg"></div>
<header class="util" id="util"><div class="wrap">
  <div class="live" id="live" role="button" tabindex="0" data-ia="refreshTip"><b></b><strong data-i="live"></strong><span id="liveTxt"></span></div>
  <div class="sp"></div>
  <span class="trs" id="trs"></span><button class="trs" id="trOn"></button>
  <label class="sbox"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="q" type="search" autocomplete="off" data-ia="search"></label>
  <button class="cancel" id="cancel" data-i="cancel"></button>
  <button class="ib" id="sbtn" data-ia="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></button>
  <div class="lang" id="lang"><button data-l="zh">中文</button><button data-l="en">EN</button><button data-l="ar">ع</button></div>
  <button class="ib" id="pbtn" data-ia="present"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg></button>
  <button class="ib" id="fbtn" data-ia="settings"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg></button>
</div></header>
<div class="mast wrap"><div class="ear" id="earUS"></div><div class="mc"><div class="mkick" data-i="tag"></div><h1>Headline Watch<i></i></h1><p><span id="dateline"></span></p><div><div class="mseg" id="mseg" role="group"><button data-m="all" data-i="mAll"></button><button data-m="us" data-i="mUS"></button><button data-m="sa" data-i="mSA"></button></div></div></div><div class="ear e2" id="earSA"></div></div>
<nav class="tabs" id="tabs"><div class="wrap"><div role="tablist">
  <button class="tab" data-v="brief" role="tab"><span data-i="brief"></span></button>
  <button class="tab" data-v="hot" role="tab"><span data-i="hot"></span><i class="num" id="nHot">0</i></button>
  <button class="tab" data-v="mid" role="tab"><span data-i="mid"></span><i class="num" id="nMid">0</i></button>
  <button class="tab" data-v="all" role="tab"><span data-i="all"></span><i class="num" id="nAll">0</i></button>
  <button class="tab" data-v="deep" role="tab"><span data-i="deep"></span><i class="num" id="nDeep"></i></button>
  <span class="tsep"></span>
  <button class="tab" data-v="watch" role="tab"><span data-i="watch"></span><i class="num" id="nWatch"></i></button>
  <button class="tab" data-v="star" role="tab"><span data-i="star"></span><i class="num" id="nStar"></i></button>
  <div class="sum" id="sum"></div>
  <i class="ink" id="ink"></i>
</div></div></nav>
<main class="wrap" id="main"></main>
<div class="scrim" id="scrim"></div>
<section class="panel glass" id="reader" aria-live="polite"><div class="px"><span data-i="detail"></span><button id="rclose" aria-label="Close">${X}</button></div><div id="rbody"></div></section>
<aside class="panel glass" id="side"><div class="px"><span data-i="settings"></span><button id="sclose" aria-label="Close">${X}</button></div>
  <div class="sh"><span data-i="wTitle"></span></div>
  <form class="wform" id="wform"><input id="winp" autocomplete="off" maxlength="80"><button class="btn" data-i="add"></button></form>
  <div class="wchips" id="wchips"></div><p class="whint" data-i="wHint"></p>
  <div class="sh"><span data-i="sources"></span><button id="allSrc" data-i="selAll"></button></div>
  <div id="srcs"></div>
  <div class="sh"><span data-i="alerts"></span></div>
  <div class="set"><div><span data-i="sound"></span><small data-i="soundD"></small></div><button class="sw" id="swSound" data-ia="sound" aria-pressed="true"></button></div>
  <div class="set"><div><span data-i="notif"></span><small id="ntHint"></small></div><button class="sw" id="swNotify" data-ia="notif" aria-pressed="false"></button></div>
  <div class="set"><div><span data-i="push"></span><small id="pushHint"></small></div><button class="sw" id="swPush" data-ia="push" aria-pressed="false"></button></div>
  <div id="pushOpts" hidden>
    <div class="psub" data-i="pushMin"></div>
    <div class="pmin" id="pushMin"><button data-m="8">8+<small></small></button><button data-m="8.5">8.5+<small></small></button><button data-m="9">9+<small></small></button><button data-m="9.5">9.5+<small></small></button><button data-m="confirmed"><span data-i="pushConf"></span><small></small></button></div>
    <p class="whint" id="pushCnt"></p>
    <div class="set"><div data-i="pushQuiet"></div><div class="qh"><select id="qFrom"></select><span>–</span><select id="qTo"></select></div></div>
    <div class="set"><div><span data-i="sticky"></span><small data-i="stickyD"></small></div><button class="sw" id="swSticky" data-ia="sticky" aria-pressed="false"></button></div>
    <div class="set"><button class="btn" id="pushTest" data-i="pushTest"></button></div>
  </div>
  <div class="sh"><span data-i="look"></span></div>
  <div class="set"><div data-i="theme"></div><div class="seg" id="theme"><button data-t="auto" data-i="tAuto"></button><button data-t="dark" data-i="tDark"></button><button data-t="light" data-i="tLight"></button></div></div>
  <div class="sh"><span data-i="lgT"></span></div>
  <div class="legend">
    <div><span><span class="sc s3">8.5</span></span><span data-i="lg3"></span></div>
    <div><span><span class="sc s2">6.5</span></span><span data-i="lg2"></span></div>
    <div><span><span class="sc s1">3</span></span><span data-i="lg1"></span></div>
    <div><span><span class="tg" data-i="deepB"></span></span><span data-i="lgDeep"></span></div>
    <div><span><span class="rc cfm"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="4.9"/><path d="m3.8 6.2 1.5 1.5 2.9-3.2"/></svg><b class="num">3</b></span></span><span data-i="lgCf"></span></div>
    <div><span><span class="rc evt"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 3h8M2 6h8M2 9h5"/></svg><b class="num">2</b></span></span><span data-i="lgEv"></span></div>
    <div><span><span class="rc dpc"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"><path d="M3 1.5h4.2L9.5 3.8v6.7H3z"/><path d="M5 6h2.6M5 8h2.6"/></svg><b class="num">1</b></span></span><span data-i="lgDp"></span></div>
    <div><span><span class="wh">◆ ★</span></span><span data-i="lgMine"></span></div>
  </div>
  <div class="keysec"><div class="sh"><span data-i="keys"></span></div>
  <div class="keys"><span><kbd>J</kbd><kbd>K</kbd><span data-i="kMove"></span></span><span><kbd>Enter</kbd><span data-i="kOpen"></span></span><span><kbd>/</kbd><span data-i="kSearch"></span></span><span><kbd>1</kbd>–<kbd>6</kbd><span data-i="kView"></span></span><span><kbd>S</kbd><span data-i="kStar"></span></span><span><kbd>P</kbd><span data-i="kShow"></span></span></div></div>
</aside>
<section class="show" id="show"><div class="show-top"><b>Headline Watch</b><span class="num" id="showN"></span><span class="sp"></span><span data-i="pHint"></span><button id="showX" aria-label="Close">${X}</button></div>
  <div class="show-body" id="showBody"></div><div class="show-bar"><i id="showBar"></i></div></section>
<button class="pill" id="pill"></button>
<div class="tip" id="tip" role="status"></div>
`;

// 版本号：页面内容（样式、脚本、骨架）的指纹。浏览器发现服务器上的版本号变了，就知道有新版本
function fingerprint(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
export const BUILD = fingerprint(CSS + BODY + JS);

// 写进 <script> 的数据：转义尖括号和行分隔符，避免提前结束 <script>
const seps = new RegExp('[' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');
const inline = (v) => JSON.stringify(v).replace(/</g, '\\' + 'u003c').replace(seps, '');

export function renderPage({ key, boot }) {
  return `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" id="tc" content="#f5f0e6">
<title>Headline Watch</title>
<link rel="icon" href="${ICON}">
<link rel="manifest" href="/manifest.webmanifest${key ? '?key=' + encodeURIComponent(key) : ''}">
<script>try{var t=JSON.parse(localStorage.getItem('hw')||'{}').theme;if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t)}catch(e){}</script>
<style>${CSS}</style></head><body>${BODY}<script>
var KEY=${inline(String(key || ''))},BUILD=${inline(BUILD)},BOOT=${boot ? inline(boot) : 'null'};${JS}</script></body></html>`;
}

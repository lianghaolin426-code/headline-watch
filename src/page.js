// 网页看板。页面开着时每 15 秒刷新；有新的重要快讯会响一声，可选弹出浏览器通知。
// 注意：下面整页是一个模板字符串，页面内的脚本不要用反引号和 ${}。

export function renderPage({ key }) {
  return `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#0b0d10" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#f6f5f1" media="(prefers-color-scheme: light)">
<title>Headline Watch</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23ff9f1a'/%3E%3Cpath d='M9 22V10h3v4.6h8V10h3v12h-3v-4.6h-8V22z' fill='%230b0d10'/%3E%3C/svg%3E">
<style>
:root{
  --bg:#0b0d10;--bg2:#101318;--card:#13171d;--card2:#171c23;--line:#222833;--line2:#2c3340;
  --fg:#e9ecf1;--fg2:#b4bcc8;--muted:#7a8494;--faint:#4b5463;
  --hot:#ff9f1a;--hot2:#ffb84d;--hotbg:rgba(255,159,26,.08);--hotline:rgba(255,159,26,.35);
  --up:#2fd27a;--warn:#ff5d5d;--ai:#8f8cff;
  --r:14px;--mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace;
  --sans:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Segoe UI",Roboto,sans-serif;
  --shadow:0 1px 0 rgba(255,255,255,.03) inset,0 8px 24px rgba(0,0,0,.25);
}
@media (prefers-color-scheme:light){:root:not([data-theme=dark]){
  --bg:#f6f5f1;--bg2:#efede7;--card:#ffffff;--card2:#fbfaf7;--line:#e6e3da;--line2:#d9d5ca;
  --fg:#16181c;--fg2:#3d434d;--muted:#727a86;--faint:#a3a9b2;
  --hot:#e07800;--hot2:#c96a00;--hotbg:rgba(224,120,0,.07);--hotline:rgba(224,120,0,.35);
  --up:#13a058;--warn:#d93636;--ai:#5b57e0;--shadow:0 1px 2px rgba(20,20,20,.04),0 6px 18px rgba(20,20,20,.05);
}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 var(--sans);-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
button{font:inherit;color:inherit}

/* ---------- 顶栏 ---------- */
.top{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 82%,transparent);backdrop-filter:saturate(1.4) blur(14px);-webkit-backdrop-filter:saturate(1.4) blur(14px);border-bottom:1px solid var(--line)}
.bar{max-width:920px;margin:0 auto;padding:12px 16px 0;padding-top:calc(12px + env(safe-area-inset-top))}
.row1{display:flex;align-items:center;gap:12px}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;letter-spacing:-.01em;font-size:17px}
.logo{width:28px;height:28px;border-radius:8px;background:var(--hot);color:#0b0d10;display:grid;place-items:center;font:800 15px/1 var(--sans)}
.live{display:inline-flex;align-items:center;gap:6px;font:500 12px/1 var(--sans);color:var(--muted);padding:5px 9px;border:1px solid var(--line);border-radius:999px;background:var(--card)}
.dot{width:7px;height:7px;border-radius:50%;background:var(--up);box-shadow:0 0 0 0 rgba(47,210,122,.6);animation:pulse 2s infinite}
.live.err .dot{background:var(--warn);animation:none}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(47,210,122,.55)}70%{box-shadow:0 0 0 7px rgba(47,210,122,0)}100%{box-shadow:0 0 0 0 rgba(47,210,122,0)}}
.sp{flex:1}
.icon{width:34px;height:34px;border-radius:10px;border:1px solid var(--line);background:var(--card);display:grid;place-items:center;cursor:pointer;color:var(--fg2);transition:.15s}
.icon:hover{border-color:var(--line2);color:var(--fg)}
.icon.on{color:var(--hot);border-color:var(--hotline);background:var(--hotbg)}
.icon svg{width:17px;height:17px}

.row2{display:flex;align-items:center;gap:10px;padding:12px 0;overflow-x:auto;scrollbar-width:none}
.row2::-webkit-scrollbar{display:none}
.seg{display:inline-flex;padding:3px;border-radius:11px;background:var(--bg2);border:1px solid var(--line);flex:none}
.seg button{border:0;background:transparent;padding:6px 12px;border-radius:8px;font-size:13px;font-weight:600;color:var(--muted);cursor:pointer;white-space:nowrap}
.seg button.on{background:var(--card);color:var(--fg);box-shadow:var(--shadow)}
.seg .n{font:600 11px/1 var(--mono);margin-left:6px;opacity:.75}
.chips{display:flex;gap:6px;flex:none}
.chip{border:1px solid var(--line);background:transparent;color:var(--fg2);padding:6px 11px;border-radius:999px;font-size:12.5px;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:6px}
.chip i{width:7px;height:7px;border-radius:50%;display:inline-block}
.chip.off{opacity:.42}
.search{flex:1 0 140px;min-width:140px;position:relative}
.search input{width:100%;border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:10px;padding:7px 10px 7px 30px;font:inherit;font-size:13px;outline:none}
.search input:focus{border-color:var(--hotline)}
.search svg{position:absolute;left:9px;top:50%;transform:translateY(-50%);width:14px;height:14px;color:var(--muted)}

/* ---------- 列表 ---------- */
main{max-width:920px;margin:0 auto;padding:6px 16px 80px}
.day{position:sticky;top:var(--topH,108px);z-index:2;display:flex;align-items:center;gap:10px;margin:18px 0 8px;font:600 12px/1 var(--sans);color:var(--muted);letter-spacing:.04em}
.day::after{content:"";flex:1;height:1px;background:var(--line)}
.day span{background:var(--bg);padding:4px 0}

.it{display:grid;grid-template-columns:62px 1fr;gap:12px;padding:11px 12px;border-radius:var(--r);border:1px solid transparent;transition:background .15s,border-color .15s}
.it:hover{background:var(--card)}
.tm{font:500 12.5px/1.55 var(--mono);color:var(--muted);padding-top:1px;white-space:nowrap}
.ttl{font-size:15px;color:var(--fg2);word-break:break-word}
.ttl a:hover{color:var(--fg);text-decoration:underline;text-decoration-color:var(--line2);text-underline-offset:3px}
.meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin-top:5px;font-size:12px;color:var(--muted)}
.src{display:inline-flex;align-items:center;gap:6px;font-weight:600;color:var(--fg2)}
.src i{width:7px;height:7px;border-radius:2px}
.tag{font:600 11px/1 var(--mono);padding:4px 6px;border-radius:6px;background:var(--bg2);border:1px solid var(--line);color:var(--fg2)}
.sc{font:700 11px/1 var(--mono);padding:4px 6px;border-radius:6px;color:var(--muted);border:1px solid var(--line)}
.sc.ai{color:var(--ai);border-color:color-mix(in srgb,var(--ai) 35%,transparent)}
.more{cursor:pointer;color:var(--muted);border-bottom:1px dashed var(--line2)}
.body{display:none;margin-top:8px;font-size:13.5px;color:var(--muted);white-space:pre-wrap;border-left:2px solid var(--line2);padding-left:10px}
.it.open .body{display:block}

/* 重要快讯：卡片 + 大号分数 */
.it.hot{grid-template-columns:62px 1fr auto;background:linear-gradient(180deg,var(--hotbg),transparent 140%),var(--card);border-color:var(--hotline);box-shadow:var(--shadow);margin:8px 0;padding:14px}
.it.hot .ttl{color:var(--fg);font-size:16.5px;font-weight:650;letter-spacing:-.005em;line-height:1.45}
.it.hot .tm{color:var(--hot)}
.big{align-self:start;text-align:center;min-width:52px;padding:6px 8px;border-radius:12px;background:var(--hot);color:#111}
.big b{display:block;font:800 22px/1 var(--mono);letter-spacing:-.03em}
.big small{display:block;font:700 9.5px/1 var(--sans);margin-top:4px;opacity:.7;letter-spacing:.06em}
.it.hot .tag{border-color:var(--hotline);color:var(--hot2);background:transparent}
.it.new{animation:flash 2.4s ease-out}
@keyframes flash{0%{background:color-mix(in srgb,var(--hot) 22%,transparent)}100%{}}

.empty{text-align:center;color:var(--muted);padding:70px 20px}
.empty b{display:block;color:var(--fg2);font-size:16px;margin-bottom:6px}
.toast{position:fixed;left:50%;bottom:calc(20px + env(safe-area-inset-bottom));transform:translateX(-50%) translateY(120px);background:var(--hot);color:#111;font-weight:700;font-size:13px;padding:9px 16px;border-radius:999px;box-shadow:0 10px 30px rgba(0,0,0,.35);cursor:pointer;transition:transform .25s;z-index:9;border:0}
.toast.show{transform:translateX(-50%) translateY(0)}
.foot{max-width:920px;margin:0 auto;padding:0 16px 40px;color:var(--faint);font-size:12px;text-align:center}

@media (max-width:560px){
  .it{grid-template-columns:1fr;gap:3px;padding:11px 10px}
  .it.hot{grid-template-columns:1fr auto;padding:13px}
  .it.hot .tm{grid-column:1/-1}
  .it.hot .main{grid-column:1}
  .tm{font-size:11.5px}
  .live .txt{display:none}
}
</style></head><body>
<header class="top" id="top"><div class="bar">
  <div class="row1">
    <div class="brand"><div class="logo">H</div>Headline Watch</div>
    <span class="live" id="live"><span class="dot"></span><span class="txt" id="liveTxt">连接中</span></span>
    <span class="sp"></span>
    <button class="icon" id="snd" title="新的重要快讯时响铃" aria-label="响铃"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg></button>
    <button class="icon" id="ntf" title="浏览器通知" aria-label="浏览器通知"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg></button>
  </div>
  <div class="row2">
    <div class="seg" id="seg"><button data-v="hot" class="on">重要<span class="n" id="nHot">0</span></button><button data-v="all">全部<span class="n" id="nAll">0</span></button></div>
    <div class="chips" id="chips"></div>
    <label class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="q" type="search" placeholder="搜索标题" autocomplete="off"></label>
  </div>
</div></header>
<main id="list"></main>
<div class="foot">每分钟抓取一次 · 评分 ≥ 阈值的快讯算"重要" · AI 不可用时按规则判断</div>
<button class="toast" id="toast"></button>
<script>
var KEY=${JSON.stringify(key)};
function q(p){return p+(p.indexOf('?')>=0?'&':'?')+(KEY?'key='+encodeURIComponent(KEY):'');}
var $=function(id){return document.getElementById(id)};
var state={view:'hot',off:{},q:'',sound:true,items:[],lastSeen:0,first:true,newIds:{}};
try{var saved=JSON.parse(localStorage.getItem('hw')||'{}');if(saved.view)state.view=saved.view;if(saved.off)state.off=saved.off;if(saved.sound===false)state.sound=false;}catch(e){}
function save(){try{localStorage.setItem('hw',JSON.stringify({view:state.view,off:state.off,sound:state.sound}))}catch(e){}}
var PALETTE=['#ff9f1a','#4fa3ff','#2fd27a','#c77dff','#ff6b8b','#33d1c6','#e8c547','#9aa5b1'];
var colorOf={};
function srcColor(s){if(!colorOf[s]){var h=0;for(var i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;colorOf[s]=PALETTE[h%PALETTE.length];}return colorOf[s];}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function pad(n){return n<10?'0'+n:''+n}
function hm(ts){var d=new Date(ts);return pad(d.getHours())+':'+pad(d.getMinutes())}
function dayKey(ts){var d=new Date(ts);return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate()}
function dayLabel(ts){var d=new Date(ts),t=new Date(),y=new Date(Date.now()-864e5);
  if(dayKey(ts)===dayKey(t))return '今天';if(dayKey(ts)===dayKey(y))return '昨天';
  return (d.getMonth()+1)+'月'+d.getDate()+'日 · 周'+'日一二三四五六'[d.getDay()];}
function ago(ts){var s=Math.max(0,(Date.now()-ts)/1000);if(s<60)return '刚刚';if(s<3600)return Math.floor(s/60)+' 分钟前';if(s<86400)return Math.floor(s/3600)+' 小时前';return Math.floor(s/86400)+' 天前';}
function fmtScore(x){return Math.round(x*10)/10}

function visible(){
  var qq=state.q.toLowerCase();
  return state.items.filter(function(i){
    if(state.view==='hot'&&!i.important)return false;
    if(state.off[i.source])return false;
    if(qq&&(i.title+' '+(i.body||'')).toLowerCase().indexOf(qq)<0)return false;
    return true;});
}
function renderChips(){
  var srcs={};state.items.forEach(function(i){srcs[i.source]=(srcs[i.source]||0)+1});
  $('chips').innerHTML=Object.keys(srcs).sort().map(function(s){
    return '<button class="chip'+(state.off[s]?' off':'')+'" data-s="'+esc(s)+'"><i style="background:'+srcColor(s)+'"></i>'+esc(s)+'</button>';}).join('');
  $('nHot').textContent=state.items.filter(function(i){return i.important}).length;
  $('nAll').textContent=state.items.length;
  [].forEach.call($('seg').children,function(b){b.classList.toggle('on',b.dataset.v===state.view)});
  $('snd').classList.toggle('on',state.sound);
  $('ntf').classList.toggle('on',window.Notification&&Notification.permission==='granted');
}
function itemHtml(i){
  var hot=!!i.important, tags='';
  if(i.hits)i.hits.split(' | ').forEach(function(h){if(h)tags+='<span class="tag">'+esc(h)+'</span>'});
  var sc=(!hot&&i.score)?'<span class="sc'+(i.score_by==='ai'?' ai':'')+'" title="'+(i.score_by==='ai'?'AI 评分':'规则评分')+'">'+fmtScore(i.score)+'</span>':'';
  return '<article class="it'+(hot?' hot':'')+(state.newIds[i.id]?' new':'')+'" data-id="'+esc(i.id)+'">'+
    '<div class="tm" title="'+esc(new Date(i.ts).toLocaleString('zh-CN',{hour12:false}))+'">'+hm(i.ts)+'</div>'+
    '<div class="main"><div class="ttl"><a href="'+esc(i.url)+'" target="_blank" rel="noopener">'+esc(i.title)+'</a></div>'+
    '<div class="meta"><span class="src"><i style="background:'+srcColor(i.source)+'"></i>'+esc(i.source)+'</span><span>'+ago(i.ts)+'</span>'+sc+tags+
    (i.body?'<span class="more">展开</span>':'')+'</div>'+
    (i.body?'<div class="body">'+esc(i.body)+'</div>':'')+'</div>'+
    (hot?'<div class="big"><b>'+fmtScore(i.score)+'</b><small>'+(i.score_by==='ai'?'AI 评分':'规则')+'</small></div>':'')+
  '</article>';
}
function render(){
  renderChips();
  var v=visible(),html='',last='';
  if(!v.length){
    html=state.items.length?'<div class="empty"><b>'+(state.view==='hot'?'暂时没有重要快讯':'没有符合条件的快讯')+'</b>'+(state.view==='hot'?'达到评分阈值的快讯会出现在这里。可以切到"全部"看所有快讯。':'换个筛选条件试试。')+'</div>'
      :'<div class="empty"><b>还没有数据</b>部署后等一两分钟，第一批快讯就会出现。</div>';
  }
  v.forEach(function(i){var k=dayKey(i.ts);if(k!==last){html+='<div class="day"><span>'+dayLabel(i.ts)+'</span></div>';last=k;}html+=itemHtml(i);});
  $('list').innerHTML=html;
  document.documentElement.style.setProperty('--topH',$('top').offsetHeight+'px');
}
function beep(){try{var a=new (window.AudioContext||window.webkitAudioContext)(),t=a.currentTime;[880,1320].forEach(function(f,k){var o=a.createOscillator(),g=a.createGain();o.type='sine';o.frequency.value=f;o.connect(g);g.connect(a.destination);g.gain.setValueAtTime(0,t+k*.14);g.gain.linearRampToValueAtTime(.16,t+k*.14+.02);g.gain.exponentialRampToValueAtTime(.001,t+k*.14+.22);o.start(t+k*.14);o.stop(t+k*.14+.25);});}catch(e){}}
function toast(n){var el=$('toast');el.textContent=n+' 条新的重要快讯 ↑';el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(function(){el.classList.remove('show')},8000);}
var unread=0;
async function load(){
  try{
    var r=await fetch(q('/api/items?limit=400&since='+(state.first?0:state.lastSeen)),{cache:'no-store'});
    if(!r.ok)throw new Error('HTTP '+r.status);
    var d=await r.json(),known={};state.items.forEach(function(x){known[x.id]=1});
    var fresh=d.items.filter(function(i){return !known[i.id]});
    // 已有条目可能后来被打分：用新数据覆盖
    var upd={};d.items.forEach(function(i){upd[i.id]=i});
    state.items=state.items.map(function(x){return upd[x.id]||x});
    state.newIds={};
    if(fresh.length){
      state.items=fresh.concat(state.items).sort(function(a,b){return b.ts-a.ts}).slice(0,800);
      fresh.forEach(function(i){state.lastSeen=Math.max(state.lastSeen,i.seen_at)});
      if(!state.first){
        fresh.forEach(function(i){state.newIds[i.id]=1});
        var hot=fresh.filter(function(i){return i.important});
        if(hot.length){
          if(state.sound)beep();
          if(window.Notification&&Notification.permission==='granted')hot.slice(0,3).forEach(function(i){try{new Notification(i.title,{body:i.source+' · 评分 '+fmtScore(i.score),tag:i.id})}catch(e){}});
          if(document.hidden){unread+=hot.length;document.title='('+unread+') Headline Watch';}
          if(window.scrollY>300)toast(hot.length);
        }
      }
    }
    state.first=false;render();
    $('live').classList.remove('err');$('liveTxt').textContent='实时 · '+hm(Date.now());
  }catch(e){$('live').classList.add('err');$('liveTxt').textContent='连接失败';}
}
$('seg').onclick=function(e){var b=e.target.closest('button');if(!b)return;state.view=b.dataset.v;save();render();window.scrollTo({top:0});};
$('chips').onclick=function(e){var b=e.target.closest('.chip');if(!b)return;var s=b.dataset.s;state.off[s]=!state.off[s];if(!state.off[s])delete state.off[s];save();render();};
$('q').oninput=function(e){state.q=e.target.value.trim();render();};
$('snd').onclick=function(){state.sound=!state.sound;save();renderChips();if(state.sound)beep();};
$('ntf').onclick=function(){if(!window.Notification)return alert('这个浏览器不支持通知');Notification.requestPermission().then(renderChips);};
$('list').onclick=function(e){if(e.target.classList.contains('more')){var it=e.target.closest('.it');it.classList.toggle('open');e.target.textContent=it.classList.contains('open')?'收起':'展开';}};
$('toast').onclick=function(){window.scrollTo({top:0,behavior:'smooth'});$('toast').classList.remove('show');};
document.addEventListener('visibilitychange',function(){if(!document.hidden){unread=0;document.title='Headline Watch';load();}});
window.addEventListener('resize',function(){document.documentElement.style.setProperty('--topH',$('top').offsetHeight+'px')});
load();setInterval(load,15000);setInterval(function(){if(!document.hidden)render()},60000);
</script></body></html>`;
}

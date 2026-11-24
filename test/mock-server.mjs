// 本地测试用：模拟 Telegram 频道页、RSS 源，并接收推送请求
import http from 'node:http';
import { readFileSync } from 'node:fs';
const tg = readFileSync(new URL('./fixtures/tg.html', import.meta.url), 'utf8');
let extra = '';
const received = [];
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.url.startsWith('/s/WalterBloomberg')) { res.end(tg.replace('</section>', extra + '</section>')); return; }
    if (req.url === '/feed.xml') { res.setHeader('content-type','application/rss+xml'); res.end(readFileSync(new URL('./fixtures/feed.xml', import.meta.url))); return; }
    if (req.url === '/broken') { res.statusCode = 503; res.end('down'); return; }
    if (req.url === '/add') {
      const iso = new Date().toISOString();
      extra += `<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="WalterBloomberg/${body}"><div class="tgme_widget_message_text js-message_text" dir="auto">TEST ${body}: NVIDIA SHORT SELLERS MAKE $24 BILLION</div><time datetime="${iso}"></time></div></div>`;
      extra += `<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="WalterBloomberg/${body}0"><div class="tgme_widget_message_text js-message_text" dir="auto">BORING HEADLINE ${body}</div><time datetime="${iso}"></time></div></div>`;
      res.end('ok'); return;
    }
    if (req.url === '/received') { res.setHeader('content-type','application/json'); res.end(JSON.stringify(received)); return; }
    received.push({ path: req.url, headers: { title: req.headers.title }, body });
    res.end('{"code":0}');
  });
}).listen(8789, () => console.log('mock on 8789'));

// 重新生成 logo 的全部文件：node tools/build-icons.mjs（需要本机装有 playwright，仅开发时用）
// 产出 src/icons.js（Worker 直接内嵌，不读数据库）和 assets/ 下的 SVG 原稿。
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { svg, P, I, RD } from './logo.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');

const pngs = {
  // 名称: [像素, svg 参数]
  'icon-32': [32, { small: true }],
  'apple-touch-icon': [180, { rx: 0, scale: 0.9 }],
  'icon-192': [192, {}],
  'icon-512': [512, {}],
  'maskable-512': [512, { rx: 0, scale: 0.7 }],
  'badge-96': [96, { bg: null, fg: '#fff', red: '#fff', small: true, scale: 1.2 }],
};
const b = await chromium.launch();
const out = {};
for (const [name, [size, opt]] of Object.entries(pngs)) {
  const p = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await p.setContent(`<body style="margin:0">${svg({ ...opt, size })}`);
  out[name] = (await p.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } })).toString('base64');
  await p.close();
}
await b.close();

const favicon = svg({ small: true });
writeFileSync('assets/logo.svg', svg() + '\n');
writeFileSync('assets/logo-dark.svg', svg({ bg: I, fg: P, red: RD }) + '\n');
writeFileSync('assets/logo-mark.svg', svg({ bg: null }) + '\n');
writeFileSync('assets/favicon.svg', favicon + '\n');
for (const [k, v] of Object.entries(out)) writeFileSync(`assets/${k}.png`, Buffer.from(v, 'base64'));
writeFileSync('src/icons.js', `// 由 tools/build-icons.mjs 生成，不要手改。
// Logo：报头同款 Playfair Display ExtraBold 的 “H” 加朱红句点（报头 “Headline Watch.” 的缩写）。
export const ICON_VERSION = '1';
export const FAVICON_SVG = ${JSON.stringify(favicon)};
const PNG = ${JSON.stringify(out, null, 1)};
const cache = new Map();
// 静态图标：/favicon.ico、/favicon.svg、/apple-touch-icon.png、/icons/<name>.png。不碰数据库，浏览器长期缓存。
export function iconResponse(pathname) {
  const headers = { 'Cache-Control': 'public, max-age=2592000, immutable' };
  if (pathname === '/favicon.svg') return new Response(FAVICON_SVG, { headers: { ...headers, 'Content-Type': 'image/svg+xml' } });
  const name = pathname === '/favicon.ico' ? 'icon-32'
    : /^\\/apple-touch-icon(-precomposed)?\\.png$/.test(pathname) ? 'apple-touch-icon'
    : (pathname.match(/^\\/icons\\/([a-z0-9-]+)\\.png$/) || [])[1];
  if (!name || !PNG[name]) return null;
  let bytes = cache.get(name);
  if (!bytes) {
    bytes = Uint8Array.from(atob(PNG[name]), (c) => c.charCodeAt(0));
    cache.set(name, bytes);
  }
  return new Response(bytes, { headers: { ...headers, 'Content-Type': 'image/png' } });
}
`);
console.log(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, Math.round(v.length * 0.75)])));

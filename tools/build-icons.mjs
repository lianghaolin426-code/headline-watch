// 重新生成 logo 的全部文件：node tools/build-icons.mjs（需要本机装有 playwright，仅开发时用）
// 产出 src/icons.js（Worker 直接内嵌）和 assets/ 下的原稿。两种样式：dark 黑底（默认）、light 米白底。
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { svg as base, P, I, R } from './logo.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');

const VERSION = '3'; // 图标有改动就加一，浏览器才会重新取
const STYLES = {
  dark: { bg: I, fg: P, red: '#e8492c' }, // 黑底上的朱红稍微调亮
  light: { bg: P, fg: I, red: R },
};
const pngs = {
  // 名称: [像素, svg 参数]
  'icon-32': [32, { small: true }],
  'apple-touch-icon': [180, { rx: 0, scale: 0.9 }],
  'icon-192': [192, {}],
  'icon-512': [512, {}],
  'maskable-512': [512, { rx: 0, scale: 0.7 }],
};
const b = await chromium.launch();
const shot = async (size, opt) => {
  const p = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await p.setContent(`<body style="margin:0">${base({ ...opt, size })}`);
  const buf = await p.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  await p.close();
  return buf.toString('base64');
};
const out = {};
const favicon = {};
for (const [style, colors] of Object.entries(STYLES)) {
  out[style] = {};
  for (const [name, [size, opt]] of Object.entries(pngs)) out[style][name] = await shot(size, { ...colors, ...opt });
  favicon[style] = base({ ...colors, small: true });
  writeFileSync(`assets/${style}/logo.svg`, base(colors) + '\n');
  writeFileSync(`assets/${style}/favicon.svg`, favicon[style] + '\n');
  for (const [k, v] of Object.entries(out[style])) writeFileSync(`assets/${style}/${k}.png`, Buffer.from(v, 'base64'));
}
// 安卓状态栏的单色小图标：两种样式共用
const badge = await shot(96, { bg: null, fg: '#fff', red: '#fff', small: true, scale: 1.2 });
writeFileSync('assets/badge-96.png', Buffer.from(badge, 'base64'));
await b.close();

writeFileSync('src/icons.js', `// 由 tools/build-icons.mjs 生成，不要手改。
// Logo：报头同款 Playfair Display ExtraBold 的 “H” 加朱红句点（报头 “Headline Watch.” 的缩写）。
// 两种样式：dark 黑底（默认）、light 米白底；用哪一种由管理页 /admin/logo 设置。
export const ICON_VERSION = '${VERSION}';
export const LOGO_STYLES = ['dark', 'light'];
export const DEFAULT_LOGO = 'dark';
const FAVICON = ${JSON.stringify(favicon, null, 1)};
const PNG = ${JSON.stringify(out, null, 1)};
const BADGE = ${JSON.stringify(badge)};
const cache = new Map();
const pick = (style) => (LOGO_STYLES.includes(style) ? style : DEFAULT_LOGO);
export function faviconSvg(style) {
  return FAVICON[pick(style)];
}
// 这个路径是不是图标：/favicon.ico、/favicon.svg、/apple-touch-icon.png、/icons/<name>.png。是就返回名字。
export function iconName(pathname) {
  if (pathname === '/favicon.svg') return 'favicon.svg';
  if (pathname === '/favicon.ico') return 'icon-32';
  if (/^\\/apple-touch-icon(-precomposed)?\\.png$/.test(pathname)) return 'apple-touch-icon';
  const name = (pathname.match(/^\\/icons\\/([a-z0-9-]+)\\.png$/) || [])[1];
  return name && (name === 'badge-96' || PNG[DEFAULT_LOGO][name]) ? name : null;
}
// pinned：网址里写明了样式（?s=dark），内容永远不变，浏览器长期缓存；没写明的跟着当前设置走，只缓存 10 分钟。
export function iconResponse(name, style, pinned) {
  const s = pick(style);
  const headers = { 'Cache-Control': pinned || name === 'badge-96' ? 'public, max-age=2592000, immutable' : 'public, max-age=600' };
  if (name === 'favicon.svg') return new Response(FAVICON[s], { headers: { ...headers, 'Content-Type': 'image/svg+xml' } });
  const key = name === 'badge-96' ? name : s + '/' + name;
  let bytes = cache.get(key);
  if (!bytes) {
    bytes = Uint8Array.from(atob(name === 'badge-96' ? BADGE : PNG[s][name]), (c) => c.charCodeAt(0));
    cache.set(key, bytes);
  }
  return new Response(bytes, { headers: { ...headers, 'Content-Type': 'image/png' } });
}
`);
console.log('ok');

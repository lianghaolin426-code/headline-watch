// 转述识别：一条消息如果是在转述别家媒体（“据彭博社报道……”“路透：……”“Bloomberg reports”），
// 就记下最初是谁报的。数“几家媒体在报”、读全文挑哪几篇时，都按最初的那家算：
// 三家中文媒体各转了一遍彭博的同一篇稿，只算彭博一家的说法。

const ORIGINS = [
  ['Bloomberg', /彭博(?:社|新闻社|新闻)?|bloomberg/i],
  ['Reuters', /路透(?:社)?|reuters/i],
  ['WSJ', /华尔街日报|wall street journal|\bwsj\b/i],
  ['Financial Times', /金融时报|financial times|\bft\b/i],
  ['CNBC', /\bcnbc\b/i],
  ['New York Times', /纽约时报|new york times|\bnyt\b/i],
  ['Washington Post', /华盛顿邮报|washington post/i],
  ['Nikkei', /日经(?:新闻|亚洲)?|nikkei/i],
  ['The Information', /the information/i],
  ['Axios', /\baxios\b/i],
  ['Politico', /\bpolitico\b/i],
  ['AP', /美联社|associated press/i],
  ['AFP', /法新社|\bafp\b/i],
  ['Semafor', /\bsemafor\b/i],
  ['Barron\'s', /巴伦周刊|barron'?s/i],
  ['Fox Business', /福克斯(?:商业|新闻)?|fox (?:business|news)/i],
  ['Sky News', /天空新闻|sky news/i],
  ['Al Arabiya', /阿拉比亚|al[ -]arabiya/i],
  ['SPA', /沙特通讯社|saudi press agency/i],
  ['Tasnim', /塔斯尼姆|tasnim/i],
  ['Kyodo', /共同社|kyodo/i],
  ['Yonhap', /韩联社|yonhap/i],
  ['Der Spiegel', /明镜周刊|der spiegel/i],
  ['Economist', /经济学人|the economist/i],
];
const NAMES = ORIGINS.map((o) => o[1].source).join('|');
// “据 X 报道 / 消息 / 援引”“X 报道称”“X：”“X 援引知情人士”；英文 “X reports / reported”“according to X”“- X”“(X)”“X:”
const ZH = new RegExp(`(?:据|援引|引述)\\s*(?:${NAMES})|(?:${NAMES})\\s*(?:最新)?(?:报道|消息|援引|引述|获悉|独家|称|披露)|^\\s*(?:${NAMES})\\s*[:：]`, 'i');
const EN = new RegExp(`(?:according to|citing|cites?|per|via|reported by|report by)\\s+(?:the\\s+|a\\s+)?(?:${NAMES})|(?:${NAMES})\\s+(?:reports?|reported|reporting|says|said|sources)\\b|[-–—|]\\s*(?:${NAMES})\\s*$|\\((?:${NAMES})\\)|^\\s*(?:${NAMES})\\s*:`, 'i');

const norm = (s) =>
  String(s || '')
    .replace(/\s*\(Bluesky\)\s*$/i, '')
    .replace(/\s+(Markets|Currents|Business)$/i, '')
    .replace(/文章$/, '')
    .trim();

/**
 * 这条消息转述的是哪家媒体。不是转述（或认不出来）返回 ''；消息来源本身就是那一家的也返回 ''。
 * 只看标题和正文开头一小段：转述的话一般开头就交代。
 */
export function originOf(item) {
  const text = `${item.title || ''} ${String(item.body || item.b || '').slice(0, 160)}`.replace(/<[^>]+>/g, ' ');
  const m = text.match(ZH) || text.match(EN);
  if (!m) return '';
  const hit = ORIGINS.find((o) => o[1].test(m[0]));
  if (!hit) return '';
  const own = norm(item.source);
  return hit[1].test(own) ? '' : hit[0];
}

/** 算“几家媒体”时这条消息记在谁名下：转述的记在最初那家，否则是它自己（同一家媒体的不同渠道算一家） */
export function countedAs(item) {
  return originOf(item) || norm(item.source);
}

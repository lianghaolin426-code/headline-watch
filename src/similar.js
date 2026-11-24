// 判断两条标题是不是在说同一件事（用于多源互证）。
// 做法：提取有意义的词（去掉常见虚词），看重合程度；数字和大写专有名词权重更高。

const STOP = new Set(
  'the a an and or of to in on for at by with from as is are was were be been it its this that after over under into amid says said say report reports reported new update live video watch why how what here more than about up down out its his her their our your will would could may might has have had not no just also per vs via'.split(
    ' '
  )
);

function stem(w) {
  return w.replace(/(ing|ed|es|s)$/, '');
}

export function tokens(title) {
  const t = String(title)
    .replace(/^[A-Za-z .()']{2,30}:\s+/, '') // 去掉 "FinancialJuice: " 这类前缀
    .toLowerCase()
    .replace(/[$€£¥]/g, ' ')
    .replace(/[^\p{L}\p{N}.%]+/gu, ' ');
  const out = new Set();
  for (let w of t.split(' ')) {
    w = w.replace(/^\.+|\.+$/g, '');
    if (!w || STOP.has(w)) continue;
    if (/^\p{Script=Han}+$/u.test(w)) {
      // 中文：按两字切片
      for (let i = 0; i + 1 < w.length; i++) out.add(w.slice(i, i + 2));
      continue;
    }
    if (w.length < 3 && !/\d/.test(w)) continue;
    out.add(stem(w));
  }
  return out;
}

/** 两条标题是否说的是同一件事 */
export function sameStory(a, b) {
  const A = a instanceof Set ? a : tokens(a);
  const B = b instanceof Set ? b : tokens(b);
  if (A.size < 3 || B.size < 3) return false;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter >= 3 && inter / Math.min(A.size, B.size) >= 0.5;
}

/** 多源互证加分：被 n 个其他来源报道 */
export function confirmBoost(n) {
  return n >= 2 ? 1.5 : n === 1 ? 0.75 : 0;
}

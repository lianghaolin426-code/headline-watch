// 判断一条快讯是否“值得推送”：命中关键词，或者含有大数字（十亿/万亿美元级别）。

const BIG_NUMBER = [
  /\$\s?\d[\d,.]*\s?(?:billion|trillion|bln|bn|tn|b|t)\b/i,
  /\b\d[\d,.]*\s?(?:billion|trillion)\b/i,
  /\d[\d,.]*\s?(?:亿|万亿)(?:美元|美金|元)?/,
];

export function parseKeywords(str) {
  return (str || '')
    .split(/[,，\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 返回命中原因（字符串数组）；空数组表示没命中。
 * @param {{title:string, body?:string}} item
 * @param {{keywords:string[], bigNumbers:boolean}} rules
 */
export function matchItem(item, rules) {
  const text = `${item.title}\n${item.body || ''}`;
  const lower = text.toLowerCase();
  const hits = [];
  for (const k of rules.keywords) {
    if (lower.includes(k.toLowerCase())) hits.push(k);
  }
  if (rules.bigNumbers) {
    for (const re of BIG_NUMBER) {
      const m = text.match(re);
      if (m) {
        hits.push(m[0].trim());
        break;
      }
    }
  }
  return hits;
}

/** 提取文中最大的金额，单位：十亿美元（billion）。没有返回 0。 */
export function maxAmountBillions(text) {
  let max = 0;
  const num = (s) => parseFloat(s.replace(/,/g, ''));
  const en = /\$?\s?(\d[\d,]*(?:\.\d+)?)\s?(trillion|billion|tn|bn|bln|t|b)\b/gi;
  let m;
  while ((m = en.exec(text))) {
    const unit = m[2].toLowerCase();
    // 单独的 "b"/"t" 只在前面有 $ 时才算，避免误判
    if ((unit === 'b' || unit === 't') && !m[0].includes('$')) continue;
    const v = num(m[1]) * (unit[0] === 't' ? 1000 : 1);
    if (v > max) max = v;
  }
  const zh = /(\d[\d,]*(?:\.\d+)?)\s?(万亿|亿)/g;
  while ((m = zh.exec(text))) {
    const v = num(m[1]) * (m[2] === '万亿' ? 100 : 0.1);
    if (v > max) max = v;
  }
  return max;
}

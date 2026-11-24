// 跨语言判断“是不是同一件事”：用 Workers AI 的多语言向量模型（bge-m3）把标题变成向量，
// 中文快讯和英文快讯说的是同一件事时，向量会很接近。
// 向量压成 int8 存进 D1（每条约 1KB），只保留几个小时。费用很低：每条标题约 20 个 token。

export const EMBED_MODEL = '@cf/baai/bge-m3';

export const isZh = (s) => /\p{Script=Han}/u.test(String(s));

/** 批量求向量，失败返回 null */
export async function embed(env, texts) {
  if (!env.AI || !texts.length) return null;
  const out = [];
  try {
    for (let i = 0; i < texts.length; i += 50) {
      const res = await env.AI.run(env.EMBED_MODEL || EMBED_MODEL, { text: texts.slice(i, i + 50).map((t) => String(t).slice(0, 300)) });
      const data = res?.data || res?.response;
      if (!Array.isArray(data)) return null;
      out.push(...data);
    }
    return out;
  } catch (e) {
    console.warn('embed failed', e?.message || e);
    return null;
  }
}

/** 归一化后压成 int8 */
export function pack(vec) {
  let n = 0;
  for (const x of vec) n += x * x;
  n = Math.sqrt(n) || 1;
  const q = new Int8Array(vec.length);
  for (let i = 0; i < vec.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round((vec[i] / n) * 127)));
  return q;
}

export function unpack(blob) {
  if (blob instanceof Int8Array) return blob;
  if (blob instanceof ArrayBuffer) return new Int8Array(blob);
  if (ArrayBuffer.isView(blob)) return new Int8Array(blob.buffer, blob.byteOffset, blob.byteLength);
  if (Array.isArray(blob)) return Int8Array.from(blob);
  return new Int8Array(0);
}

/** 两个 int8 向量的余弦相似度（已归一化，约等于点积 / 127²） */
export function cos(a, b) {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s / (127 * 127);
}

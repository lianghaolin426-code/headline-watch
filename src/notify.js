// 可插拔的推送渠道。哪个渠道配置了对应的密钥，就推到哪个；一个都没配也没关系，
// 快讯照样存进数据库，在网页上能看到。
//
// 加新渠道：在 NOTIFIERS 里加一项 { name, enabled(env), send(env, msg) } 即可。

const NOTIFIERS = [
  {
    // iPhone：Bark。BARK_URL 形如 https://api.day.app/你的key
    name: 'bark',
    enabled: (env) => !!env.BARK_URL,
    send: (env, m) =>
      postJson(env.BARK_URL.replace(/\/+$/, ''), {
        title: m.title.slice(0, 120),
        body: `${m.source}${m.reason ? ' · ' + m.reason : ''}`,
        url: m.url,
        group: 'Headline Watch',
        level: env.BARK_LEVEL || 'timeSensitive', // 设成 critical 则静音/勿扰也响
        sound: env.BARK_SOUND || undefined,
      }),
  },
  {
    // 安卓/iPhone：ntfy。NTFY_TOPIC 是你自己起的一个难猜的名字
    name: 'ntfy',
    enabled: (env) => !!env.NTFY_TOPIC,
    send: (env, m) =>
      fetch(`${(env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/+$/, '')}/${env.NTFY_TOPIC}`, {
        method: 'POST',
        headers: {
          Title: encodeHeader(m.title.slice(0, 120)),
          Tags: 'newspaper',
          Priority: env.NTFY_PRIORITY || '4',
          Click: m.url || '',
          ...(env.NTFY_TOKEN ? { Authorization: `Bearer ${env.NTFY_TOKEN}` } : {}),
        },
        body: `${m.source}${m.reason ? ' · ' + m.reason : ''}`,
      }),
  },
  {
    // 微信：企业微信群机器人 webhook
    name: 'wecom',
    enabled: (env) => !!env.WECOM_WEBHOOK,
    send: (env, m) =>
      postJson(env.WECOM_WEBHOOK, {
        msgtype: 'markdown',
        markdown: { content: `**${m.title}**\n> ${m.source}${m.reason ? ' · ' + m.reason : ''}\n[原文](${m.url})` },
      }),
  },
  {
    // 微信：PushPlus（公众号推送）
    name: 'pushplus',
    enabled: (env) => !!env.PUSHPLUS_TOKEN,
    send: (env, m) =>
      postJson('https://www.pushplus.plus/send', {
        token: env.PUSHPLUS_TOKEN,
        title: m.title.slice(0, 100),
        content: `${m.source}${m.reason ? ' · ' + m.reason : ''}<br><a href="${m.url}">原文</a>`,
        template: 'html',
      }),
  },
  {
    // Telegram 机器人（如果以后又想用 Telegram）
    name: 'telegram',
    enabled: (env) => !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
    send: (env, m) =>
      postJson(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        chat_id: env.TELEGRAM_CHAT_ID,
        text: `${m.title}\n${m.source}${m.reason ? ' · ' + m.reason : ''}\n${m.url}`,
        disable_web_page_preview: true,
      }),
  },
  {
    name: 'discord',
    enabled: (env) => !!env.DISCORD_WEBHOOK,
    send: (env, m) =>
      postJson(env.DISCORD_WEBHOOK, { content: `**${m.title}**\n${m.source}${m.reason ? ' · ' + m.reason : ''}\n<${m.url}>` }),
  },
  {
    // 邮件：通过 Resend（免费额度每天 100 封）
    name: 'email',
    enabled: (env) => !!(env.RESEND_API_KEY && env.EMAIL_TO && env.EMAIL_FROM),
    send: (env, m) =>
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: env.EMAIL_FROM,
          to: env.EMAIL_TO.split(',').map((s) => s.trim()),
          subject: m.title.slice(0, 150),
          text: `${m.title}\n\n${m.source}${m.reason ? ' · ' + m.reason : ''}\n${m.url}`,
        }),
      }),
  },
  {
    // 通用 webhook：把 JSON 原样 POST 给任意地址
    name: 'webhook',
    enabled: (env) => !!env.WEBHOOK_URL,
    send: (env, m) => postJson(env.WEBHOOK_URL, m),
  },
];

function postJson(url, data) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(data),
  });
}

// HTTP 头只能放 ASCII；ntfy 支持 RFC 2047 编码的 UTF-8 标题
function encodeHeader(s) {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7f]*$/.test(s)) return s;
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `=?UTF-8?B?${btoa(bin)}?=`;
}

export function enabledChannels(env) {
  return NOTIFIERS.filter((n) => n.enabled(env)).map((n) => n.name);
}

/** 推送一条消息到所有已配置的渠道，返回每个渠道的结果 */
export async function notifyAll(env, msg) {
  const active = NOTIFIERS.filter((n) => n.enabled(env));
  const results = await Promise.allSettled(
    active.map(async (n) => {
      const r = await n.send(env, msg);
      if (r && !r.ok) throw new Error(`${n.name} HTTP ${r.status}`);
      return n.name;
    })
  );
  return results.map((r, i) => ({ channel: active[i].name, ok: r.status === 'fulfilled', error: r.reason?.message }));
}

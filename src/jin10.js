// 金十数据官方 MCP 接口（https://mcp.jin10.com/mcp）的快讯。
// 需要在 mcp.jin10.com 登录金十账号、激活 MCP Token，再设成 Worker 的密钥 JIN10_TOKEN。
// 协议是 MCP（JSON-RPC over HTTP）：先 initialize 拿会话号，再调用 list_flash 工具。

const ENDPOINT = 'https://mcp.jin10.com/mcp';

async function rpc(token, body, session) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${token}`,
    'MCP-Protocol-Version': '2025-06-18',
  };
  if (session) headers['Mcp-Session-Id'] = session;
  const r = await fetch(ENDPOINT, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!r.ok && r.status !== 202) throw new Error(`金十 HTTP ${r.status}`);
  const text = await r.text();
  let msg = null;
  if ((r.headers.get('content-type') || '').includes('text/event-stream')) {
    // SSE：取最后一条 data
    for (const line of text.split('\n')) if (line.startsWith('data:')) msg = line.slice(5).trim() || msg;
  } else msg = text;
  const data = msg ? JSON.parse(msg) : null;
  if (data?.error) throw new Error(`金十 ${data.error.message || JSON.stringify(data.error)}`);
  return { data, session: r.headers.get('mcp-session-id') || session };
}

/** 抓最新一页金十快讯，返回统一格式；name 为来源显示名 */
export async function fetchJin10(token, name = '金十数据') {
  if (!token) throw new Error('没有设置 JIN10_TOKEN');
  const init = await rpc(token, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'headline-watch', version: '1.0' } },
  });
  const session = init.session;
  await rpc(token, { jsonrpc: '2.0', method: 'notifications/initialized' }, session);
  const res = await rpc(token, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_flash', arguments: {} } }, session);
  const result = res.data?.result;
  let payload = result?.structuredContent;
  if (!payload) {
    const t = (result?.content || []).find((c) => c.type === 'text')?.text;
    try {
      payload = t ? JSON.parse(t) : null;
    } catch {
      payload = null;
    }
  }
  const items = payload?.items || payload?.data?.items || (Array.isArray(payload) ? payload : []);
  return items
    .filter((o) => o && o.id != null)
    .map((o) => {
      const content = String(o.content || '').replace(/<[^>]+>/g, '').trim();
      const bracket = content.match(/^【([^】]{4,120})】/);
      const title = String(o.title || '').trim() || (bracket ? bracket[1] : content.slice(0, 280));
      const ts = Date.parse(o.time);
      return {
        id: `jin10:${o.id}`,
        source: name,
        title,
        body: content.slice(0, 500),
        url: o.url || `https://flash.jin10.com/detail/${o.id}`,
        ts: Number.isNaN(ts) ? Date.now() : ts,
      };
    })
    .filter((x) => x.title);
}

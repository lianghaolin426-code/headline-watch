# Headline Watch：合并快讯，一个地方看、一个地方收

这个小程序跑在 Cloudflare 的免费服务上，**每分钟**做一次下面的事：

1. 抓取几个快讯源。默认有：
   - Telegram 频道 Walter Bloomberg 和 First Squawk（抓的是 t.me/s/ 公开网页，你不用装 Telegram）
   - Google 新闻里的彭博报道
   - CNBC
   - Investing.com
2. 去掉重复的条目，按**关键词**和**大数字**筛选。大数字指 `$24 billion`、`2万亿美元` 这种。
3. 存进数据库。网页看板能看到所有快讯，命中的会标黄。
4. 把命中的快讯推送到你配置的渠道。**现在一个渠道都不配也能用**，先看网页就行。

全程免费：Cloudflare Workers 免费版每天 10 万次请求，D1 数据库每天 10 万次写入，每分钟跑一次绰绰有余。

## 你需要做的（大约 10 分钟）

1. 注册一个免费的 Cloudflare 账号：https://dash.cloudflare.com/sign-up 。不需要绑卡，也不需要域名。
2. 电脑上装 Node.js（https://nodejs.org ，选 LTS 版）。
3. 在这个文件夹里打开终端，依次运行下面的命令：

```bash
npm install
npx wrangler login                      # 会打开浏览器，点"允许"
npx wrangler d1 create headline-watch   # 输出里有一行 database_id = "xxxx"
```

4. 把上一步输出的 `database_id` 复制进 `wrangler.toml`，替换 `REPLACE_WITH_YOUR_DATABASE_ID`。
5. 继续运行：

```bash
npm run db:init    # 建表
npm run deploy     # 部署，最后会打印网址，形如 https://headline-watch.<你的名字>.workers.dev
```

6. 打开那个网址就能看到看板。如果是空的，等一两分钟，或者访问 `网址/api/run` 手动抓一次。

> 以上步骤也可以让 Claude 在你电脑上代你跑完。你只需要注册账号，再在浏览器里点一次"允许"。

## 网页和接口

| 地址 | 作用 |
|---|---|
| `/` | 看板。每 20 秒刷新一次。页面开着时，新的命中快讯会响铃，也可以开浏览器通知 |
| `/rss.xml` | 命中快讯的 RSS，任何 RSS 阅读器都能订阅。加 `?all=1` 输出全部快讯 |
| `/api/status` | 每个源最近一次是否抓取成功、已开启的推送渠道 |
| `/api/run?admin=管理密码` | 手动抓一次 |
| `/api/ingest` | 接收 GitHub 定时任务推来的 Telegram 页面（需要管理密码） |
| `/api/test-notify?admin=管理密码` | 给已配置的渠道发一条测试推送 |

想让网页不对外公开，可以设一个访问密码：运行 `npx wrangler secret put ACCESS_KEY`，之后用 `网址/?key=密码` 打开。

## 网页推送（不用装 App，推荐）

看板右上角“来源与设置” → “后台推送”，打开开关、在浏览器弹窗里点“允许”。之后关掉网页也能收到系统通知，点通知会打开看板并定位到那条快讯。

- 每个浏览器自己选门槛（8 / 8.5 / 9 / 9.5 分，或“8 分+多源证实”）和免打扰时段（按你所在的时区），设置存在服务器上。
- Chrome：可以关掉所有窗口，但 Chrome 要在后台运行；用 ⌘Q 完全退出后，通知要等下次打开 Chrome 才到。macOS 的“系统设置 → 通知 → Google Chrome”要允许通知。
- Safari（macOS 15.5 以上）网页关掉也能收到。iPhone（iOS 16.4 以上）要先在 Safari 里把看板“添加到主屏幕”，再从主屏幕图标打开并开启。
- 加密和签名用 Worker 自带的 WebCrypto（`src/webpush.js`）。签名密钥第一次用到时自动生成并存在 D1（`push_keys` 表），也可以用 `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_JWK` 密钥覆盖。订阅存在 `push_subs` 表（`migrate-v9.sql`，不跑也会自动建）。
- 推送失效（浏览器退订或清了数据）时自动删除该订阅；`/api/status` 的 `webpush` 一栏可以看到订阅数、最近一次成功时间和错误。

## 以后加推送渠道（想好再配，不用改代码）

在终端里运行 `npx wrangler secret put <名字>`，然后粘贴对应的值。配好后访问 `/api/test-notify` 试一下。

| 渠道 | 名字 | 值 |
|---|---|---|
| iPhone · Bark | `BARK_URL` | Bark App 里复制的地址，形如 `https://api.day.app/xxxx` |
| 安卓/iPhone · ntfy | `NTFY_TOPIC` | 自己起一个难猜的名字，然后在 ntfy App 里订阅同名主题 |
| 微信 · 企业微信群机器人 | `WECOM_WEBHOOK` | 群设置 → 添加机器人 → 复制 webhook 地址 |
| 微信 · PushPlus | `PUSHPLUS_TOKEN` | 在 pushplus.plus 登录后拿到的 token |
| 邮件 | `RESEND_API_KEY`、`EMAIL_TO`、`EMAIL_FROM` | Resend 免费账号 |
| Telegram / Discord / 任意 webhook | `TELEGRAM_BOT_TOKEN`+`TELEGRAM_CHAT_ID` / `DISCORD_WEBHOOK` / `WEBHOOK_URL` | |

可以同时配多个渠道，每条快讯会推到所有已配置的地方。

## 调整抓什么、推什么

改 `wrangler.toml` 的 `[vars]`，然后重新运行 `npm run deploy`：

- `SOURCES`：快讯源列表。加 Telegram 频道就写 `{"type":"telegram","channel":"频道名"}`；加 RSS 就写 `{"type":"rss","name":"名字","url":"..."}`。
- `KEYWORDS`：关键词，用逗号分隔，不区分大小写。
- `BIG_NUMBERS`：设为 `"true"` 时，含十亿、万亿级金额的快讯也算命中。
- `NOTIFY_MODE`：`matched` 只推命中的，`all` 全部推送，`off` 不推送。
- `MAX_AGE_MINUTES`：只推发布时间在这么多分钟以内的快讯，默认 30。

## 已知限制

- Telegram 和 Google 新闻会拒绝 Cloudflare 服务器的访问。所以 Telegram 频道改由 GitHub 定时任务（`.github/workflows/telegram.yml`）每 5 分钟抓一次，再推送到 `/api/ingest`。GitHub 的定时任务常会晚几分钟；仓库 60 天没有提交，GitHub 会自动暂停定时任务。仓库需要一个名为 `HW_ADMIN_KEY` 的 Secret，值就是管理密码。
- 彭博官方 RSS 的 robots 规则禁止自动抓取，彭博的标题主要靠 Walter Bloomberg 频道。
- X（推特）需要付费 API 才能稳定抓取，所以暂时没有加。

## 本地测试

```bash
npm test     # 解析和过滤的单元测试
```

## 中文快讯与跨语言合并（2026-11-24）

- 关注范围：只看美股、沙特股，以及影响它们的全球宏观（美联储、关税、原油/OPEC、中东局势等）。AI 评分提示词已按这个范围写。
- 中文快讯源用 `"type": "cnjson"`（华尔街见闻、格隆汇的公开 JSON 接口）。加了 `"focus": true` 的源只保留和美国/沙特/全球宏观相关的快讯（关键词见 `src/index.js` 里的 `FOCUS_ZH`），A 股、港股本地新闻直接丢掉。
- 跨语言互证：每条新快讯用 Workers AI 的多语言向量模型 `@cf/baai/bge-m3` 求向量，和最近 2 小时另一种语言的快讯比相似度，≥ `CROSS_LANGUAGE_MIN`（默认 0.65）算同一件事。关掉：`CROSS_LANGUAGE = "false"`。
- 同一件事只推一次：已有更早的重要快讯时，新来的记为重复（`dup_of`），不再推送，看板“重要”里也只显示最早那条，并显示“N 个来源证实”。
- 新表需要先执行一次：`npx wrangler d1 execute headline-watch --remote --file migrate-v4.sql`

## 数据库读取量（D1 免费额度，改查询前必读）

D1 免费版每天最多读 **500 万行**（UTC 零点 = 北京时间 08:00 重置），超了当天所有读取都会报错。
2026-11-24 出过一次：网页每 15 秒轮询一次，那条查询沿着 ts 索引把整张表（约 1.1 万行）扫一遍；统计磁贴每次扫 7 天；
翻译、简报、深度文章比对每分钟各扫十几到二十几小时的快讯。合计一天几千万行。

现在的做法（`src/dbguard.js`）：
- 每条查询的 `meta.rows_read` 都会累加，按天写进 `d1_reads` 表；`/api/status` 里的 `d1` 显示今天用了多少、哪一档。
- 自动降速：40% 以上网页 1 分钟刷新一次，60% 以上 3 分钟、后台少写简报，85% 以上 10 分钟、后台只抓取和打分；网页会提示一次。
- 首屏数据、轮询结果、统计、简报都有缓存（15 秒到 2 分钟），多个标签页共用；标签页在后台时 5 分钟才刷新一次。
- 数据库报错（比如额度用完）时：接口返回 503，网页继续显示浏览器里存的上一份数据并提示；cron 10 分钟内不再碰数据库。
- 需要的索引由 cron 自动建（`migrate-v11.sql` 只是记录）。

改代码时注意：
- 每分钟跑的查询（cron）和网页轮询的查询，读取行数要控制在几百行以内。按时间范围查时让它走索引；`ORDER BY ts` 加别的条件时，
  SQLite 可能为了排序沿 ts 索引扫全表（轮询那条就是这样，改成了 `ORDER BY +ts`）。
- 带分数线的查询把数字直接写进 SQL（如 `score >= 6`），才能用上部分索引。
- 新查询先在本地用接近线上数据量的库测 `rows_read`；上线后看 `/api/status` 的 `d1.days`。
- 估算（2026-11-24 改完后）：后台每天约 90 万行，网页每个一直开着的前台标签页每天约 30 万行，合计约 100–150 万行，是额度的 20–30%。

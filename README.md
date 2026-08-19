# LeadPilot AI｜海外询盘筛选与回复 Agent

这是一个面向海外教练、顾问、创意机构与专业服务商的“线索分拣与回复草稿”Agent。当前版本包含完整英文营销页、互动演示、服务流程、定价与询盘入口。客户提交询盘后，它会：

1. 判断优先级与意图；
2. 生成摘要和下一步建议；
3. 找出缺失信息；
4. 生成英文回复草稿；
5. 在 Cloudflare 版本中将真实询盘保存到 D1，并可通过 Resend 发送提醒邮件。

## 启动

本项目只使用 Node.js 内置模块，不需要安装依赖。

```powershell
node server.js
```

浏览器打开 `http://127.0.0.1:3000`。没有API Key时运行演示规则；演示模式足够录作品集视频。

## 接入真实AI

1. 复制 `.env.example` 为 `.env`。
2. 把自己的 `OPENAI_API_KEY` 填入 `.env`，不要写到前端、截图或交给客户。
3. 重启服务。

默认使用 `gpt-5.4-mini`。如账号没有该模型权限，可在 `.env` 中换成账号实际可用且支持结构化输出的模型。

## 换成客户业务

编辑 `config/business.json`：

- `businessName`：客户公司名；
- `offer`：客户卖什么；
- `idealCustomer`：什么线索最有价值；
- `services`：确实能提供的服务；
- `rules`：模型绝对不能违反的规则；
- `replyTone`：客户希望的表达风格。

## 下一步接自动化工具

当前入口是 `POST /api/analyze`，所以 Make、Zapier、n8n 或网站表单都能通过HTTP调用。推荐生产流程：

`网站表单 → /api/analyze → Google Sheets/CRM → 人工审核 → Gmail发送`

第一版必须保留人工审核。等客户提供真实政策、用历史数据测试通过后，再考虑自动发送低风险回复。

## 数据与安全

- 线索保存在 `data/leads.jsonl`，该文件已被 Git 忽略。
- 示例不包含登录系统，不能直接暴露到公网作为正式后台。
- 正式部署前要增加身份验证、速率限制、隐私告知、数据删除机制和HTTPS。
- 客户消息被视为不可信输入，系统提示明确禁止服从消息中的越权指令。

## 验证

```powershell
node --test
```

浏览器视觉验收脚本位于 `scripts/qa-website.js`，覆盖三种询盘场景、控制台错误与移动端横向溢出检查。

## GitHub Pages 演示

`public/` 会通过 GitHub Actions 发布到 GitHub Pages。Pages 版本在浏览器中运行同一套演示评分规则，不调用 OpenAI，也不会产生 API 费用。完整的服务端模式仍通过 `node server.js` 启动。

## Render 免费后端演示

仓库根目录的 `render.yaml` 可以建立 Render Free Web Service。该版本运行 Node 后端和 `/api/analyze`，默认使用演示规则且不保存访客提交内容。

[Deploy to Render](https://render.com/deploy?repo=https://github.com/saleiyi/leadpilot-ai)

免费实例闲置后会休眠，首次访问需要等待唤醒；本地文件也不是持久存储。正式接收客户询盘前，应接入受保护的数据库或 CRM，而不是开启本地 JSONL 存储。

## Cloudflare Pages + Functions + D1

推荐的免费边缘部署使用 Cloudflare Pages 托管 `public/`，并通过根目录的 `functions/api/` 自动生成 Workers API。互动演示接口不保存访客数据；底部真实询盘表单使用独立的 `POST /api/inquiries` 接口写入 D1。

在 Cloudflare Pages 连接 GitHub 仓库后使用：

- Production branch：`main`
- Build command：留空
- Build output directory：`public`
- Root directory：`/`

部署后访问 `/api/health` 应返回 `edge-demo`，网站会自动调用同域的 `/api/analyze`。

### 询盘数据库

首次部署前创建并迁移数据库：

```powershell
npx wrangler d1 create leadpilot-leads
npx wrangler d1 migrations apply leadpilot-leads --remote
```

数据库绑定名为 `LEADS_DB`。查看最近询盘：

```powershell
npx wrangler d1 execute leadpilot-leads --remote --command "SELECT created_at,name,email,company,service,budget,timeline,status,notification_status FROM inquiries ORDER BY created_at DESC LIMIT 20"
```

询盘表单包含必填同意声明、长度校验、同源/CORS限制与隐藏蜜罐字段。不要建立公开的询盘列表接口；后台读取需要单独加入身份验证。

### 邮件提醒

数据库保存不依赖邮件服务。要启用提醒，需要在 Cloudflare Pages 配置：

- 加密 Secret `RESEND_API_KEY`；
- 环境变量 `NOTIFY_EMAIL`；
- 可选环境变量 `NOTIFY_FROM`，默认使用 Resend 测试发件人。

未配置时，新询盘仍会保存，`notification_status` 为 `not_configured`。配置后会变为 `queued`，发送成功后更新为 `sent`，失败则更新为 `failed`。正式使用自有发件地址前，需要在邮件服务商处验证域名。

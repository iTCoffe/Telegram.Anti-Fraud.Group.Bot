# Telegram 群反诈机器人 (Cloudflare Workers版)

一个基于 Cloudflare Workers 的 Telegram 机器人，专门用于在群组中实时检测并警告可疑诈骗消息，同时提供诈骗数据库管理功能。机器人仅对群聊中的文本消息进行诈骗检测，私聊中仅响应命令，保持安静。

## ✨ 功能特点

- **智能诈骗检测**：内置 2025 年主流诈骗类型关键词库，包括刷单、冒充领导、杀猪盘、贷款诈骗等。
- **KV 数据库扩展**：支持将手机号、关键词等存入 KV 命名空间，实现自定义诈骗数据匹配。
- **群内实时警告**：检测到可疑内容时，以回复形式在群内发出警告，并附带针对性提醒。
- **管理员私聊推送**：每次检测到诈骗消息，会私下推送详细预警信息给管理员（包含群组、发送者、消息内容）。
- **数据库管理命令**：管理员可通过私聊或群聊使用命令添加、查询、统计诈骗数据。
- **一键初始化**：内置基础诈骗数据，管理员可快速初始化数据库。
- **命令菜单支持**：通过 `/setcommands` 接口设置机器人命令菜单，方便用户查看。

## 🚀 快速开始

### 前置准备

1. **Telegram Bot Token**：通过 [@BotFather](https://t.me/BotFather) 创建机器人，获取 Token。
2. **Cloudflare 账户**：注册 [Cloudflare](https://dash.cloudflare.com/) 并开启 Workers 服务。
3. **管理员 Telegram ID**：获取你自己的用户 ID（可通过 [@userinfobot](https://t.me/userinfobot) 获取）。
4. **KV 命名空间**：在 Cloudflare Workers 中创建一个 KV 命名空间，用于存储诈骗数据。

### 部署步骤

1. **克隆/下载代码**  
   将本项目代码保存为一个 JavaScript 文件（例如 `index.js`）。

2. **创建 Worker**  
   登录 Cloudflare Dashboard，进入 Workers 页面，点击“创建服务”，输入服务名称，选择“HTTP 处理器”模板。

3. **粘贴代码**  
   在 Worker 编辑器中，清空默认代码，将本项目代码粘贴进去。

4. **绑定 KV 命名空间**  
   - 在 Worker 设置中，点击“变量”，找到“KV 命名空间绑定”。
   - 点击“添加绑定”，变量名称填写 **`cfbot`**（必须与此名称一致），选择你创建的 KV 命名空间。

5. **设置环境变量**  
   在“变量”页面的“环境变量”部分，添加以下变量：

   | 变量名 | 说明 | 示例 |
   |--------|------|------|
   | `ENV_BOT_TOKEN` | Telegram 机器人 Token | `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11` |
   | `ENV_BOT_SECRET` | 自定义密钥（用于验证 Webhook 请求和访问 `/setcommands`） | 任意随机字符串，如 `my_secret_2025` |
   | `ENV_ADMIN_UID` | 管理员 Telegram ID（数字字符串） | `123456789` |

6. **部署 Worker**  
   点击“保存并部署”。复制生成的 Worker 域名（例如 `your-worker.workers.dev`）。

7. **注册 Webhook**  
   在浏览器中访问以下 URL（替换 `your-worker.workers.dev` 为你的 Worker 域名）：
   https://your-worker.workers.dev/registerWebhook?secret=你的密钥

   如果显示“✅ Webhook 注册成功”，则 Webhook 设置完成。

8. **设置命令菜单（可选）**  
访问以下 URL 以设置机器人的命令菜单（同样替换域名和 `你的密钥` 为 `ENV_BOT_SECRET` 的值）：
https://your-worker.workers.dev/setcommands?secret=你的密钥

返回成功消息后，机器人的命令菜单将自动显示在 Telegram 客户端。

## 📖 命令说明

所有命令均可私聊机器人或在群组中使用（需注意权限）。

| 命令 | 权限 | 描述 |
|------|------|------|
| `/start` | 所有人 | 显示欢迎信息和帮助 |
| `/addscam` | 管理员 | 添加诈骗数据。格式：`/addscam 关键词 类型 描述` |
| `/queryscam` | 所有人 | 查询诈骗数据。格式：`/queryscam 关键词` |
| `/scamstats` | 所有人 | 查看诈骗数据库统计信息 |
| `/initdb` | 管理员 | 初始化内置诈骗数据（覆盖现有数据） |
| `/batchaddscam` | 管理员 | 批量导入诈骗数据（JSON 格式）。示例见下文 |

## 🛠️ 使用示例

### 添加诈骗数据
/addscam 13800138000 刷单诈骗 该号码冒充客服诱导刷单

### 查询诈骗数据
/queryscam 13800138000

### 查看统计
/scamstats

### 批量导入
/batchaddscam [{"key":"13900000000","type":"贷款诈骗","desc":"无抵押低息贷款诈骗"},{"key":"安全账户","type":"公检法诈骗","desc":"公检法不会要求转账到安全账户"}]

## 🔒 隐私与安全
   机器人仅检测群聊中的文本消息，不会处理图片、文件等。
   检测到的可疑消息会在群内公开回复警告，同时私下推送管理员，不会泄露用户隐私。
   管理员 ID 和密钥存储在环境变量中，不会暴露。
   所有数据（诈骗关键词）存储在 Cloudflare KV 中，安全可靠。
   
### 第二部分（复制以下内容）：
## ⚙️ 自定义诈骗检测规则

你可以在代码中的 `detectSuspiciousContent` 函数里修改 `patterns` 数组，增加或删除正则表达式规则，以适应新的诈骗手法。
{ name: '新诈骗类型', regex: /(关键词1|关键词2)/gi }

## 📝 注意事项
   机器人必须为群组管理员才能在群内发送消息和回复。请将机器人添加为目标群组的管理员（至少拥有“发送消息”权限）。
   KV 命名空间绑定名称必须为 nfd，否则无法存储数据。
   ENV_BOT_SECRET 用于保护 Webhook 和命令菜单接口，请妥善保管。
   初始化数据库（/initdb）会覆盖现有数据，请谨慎使用。
   机器人不会处理非文本消息（如图片、贴纸等），也不会对私聊中的非命令消息做出响应。

## 📄 许可证

本项目采用 MIT 许可证。详见 LICENSE 文件。

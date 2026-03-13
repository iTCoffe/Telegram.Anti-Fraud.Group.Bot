// ==================== 环境变量配置 ====================
// 在 Cloudflare Workers 后台设置以下环境变量：
//   ENV_BOT_TOKEN     - Telegram 机器人令牌
//   ENV_BOT_SECRET    - 自定义密钥（用于 URL 参数验证）
//   ENV_ADMIN_UID     - 管理员 Telegram ID（数字字符串）
// KV 命名空间绑定：变量名称必须为 cfbot（与代码中的 cfbot 一致）

// 兼容不同环境下的环境变量读取方式
const TOKEN = (typeof ENV_BOT_TOKEN !== 'undefined') ? ENV_BOT_TOKEN : globalThis.ENV_BOT_TOKEN;
const SECRET = (typeof ENV_BOT_SECRET !== 'undefined') ? ENV_BOT_SECRET : globalThis.ENV_BOT_SECRET;
const ADMIN_UID = (typeof ENV_ADMIN_UID !== 'undefined') ? ENV_ADMIN_UID : globalThis.ENV_ADMIN_UID;

// 检查必要变量是否存在
if (!TOKEN || !SECRET || !ADMIN_UID) {
    throw new Error('请设置环境变量：ENV_BOT_TOKEN, ENV_BOT_SECRET, ENV_ADMIN_UID');
}

const WEBHOOK = '/endpoint';
const cfbot = globalThis.cfbot; // KV 命名空间绑定（必须命名为 cfbot）

// ==================== 基础工具函数 ====================
function apiUrl(methodName, params = null) {
    let query = params ? '?' + new URLSearchParams(params).toString() : '';
    return `https://api.telegram.org/bot${TOKEN}/${methodName}${query}`;
}

function requestTelegram(methodName, body, params = null) {
    return fetch(apiUrl(methodName, params), body).then(r => r.json());
}

function makeReqBody(data) {
    return {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data)
    };
}

function sendMessage(chat_id, text, extra = {}) {
    return requestTelegram('sendMessage', makeReqBody({
        chat_id,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...extra
    }));
}

// ==================== 防诈骗数据库核心功能 ====================
function detectSuspiciousContent(text) {
    const patterns = [
        { name: '手机号', regex: /1[3-9]\d{9}/g },
        { name: '银行卡/账号', regex: /\d{16,19}/g },
        { name: '可疑链接', regex: /https?:\/\/[^\s]+/g },
        { name: '收款码/二维码', regex: /(收款码|二维码|扫码支付|加微信发码)/gi },
        { name: '刷单返利诈骗', regex: /(刷单|返利|垫资|冲单|做单|佣金|点赞|关注|拉新|试玩)/gi },
        { name: '客服退款诈骗', regex: /(客服|退款|理赔|保证金|解冻|订单异常|快递丢失|质量问题)/gi },
        { name: '公检法诈骗', regex: /(公检法|通缉|涉案|冻结|安全账户|配合调查|逮捕令|征信异常)/gi },
        { name: '贷款诈骗', regex: /(无抵押|低息|秒批|包装流水|先交费用|解冻贷款|征信修复)/gi },
        { name: '婚恋杀猪盘', regex: /(网恋|交友|处对象|奔现|宝贝|老公老婆|带你赚钱|投资|博彩|数字货币|感情投资)/gi },
        { name: '冒充领导/干部', regex: /(总|书记|局长|主任|领导|换号|加微信|急事|保密|帮忙打款|私下发我)/gi },
        { name: '冒充老师/家长', regex: /(家长群|学费|资料费|老师|代收|缴费|班级群|补课费)/gi },
        { name: '冒充亲友借钱', regex: /(我是你朋友|换号|我号码丢了|急用|借钱|转我|出车祸|住院)/gi },
        { name: 'AI换脸/换声诈骗', regex: /(视频验证|语音确认|我是本人|看视频|借钱应急|家人出事)/gi },
        { name: '虚假购物/微商', regex: /(代购|秒杀|低价|不发货|先款|定金|微商转账|海外代购)/gi },
        { name: '医美/保健品诈骗', regex: /(医美分期|免费美容|保健品|包治百病|特效药|先交钱)/gi },
        { name: '冒充快递员/外卖员', regex: /(快递丢失|理赔|加微信|私下赔付|到付|代收货款)/gi },
        { name: '注销校园贷诈骗', regex: /(校园贷|注销账户|影响征信|操作失误|需要转账|清零记录)/gi },
        { name: '投资理财诈骗', regex: /(内幕|翻倍|保本|高收益|带单|老师带投|虚拟货币|外汇|期货)/gi },
        { name: '虚拟币/NFT诈骗', regex: /(比特币|以太坊|NFT|空投|挖矿|交易所|提币需要手续费)/gi },
        { name: '游戏/充值诈骗', regex: /(游戏币|装备|账号|充值|内部福利|免费皮肤|代练|解封)/gi },
        { name: '中奖/送礼诈骗', regex: /(中奖|领奖|免费领|礼品|手续费|税费|积分兑换)/gi },
        { name: '兼职诈骗', regex: /(打字员|刷单兼职|日结|无门槛|押金|培训费|入职费)/gi },
        { name: '养老诈骗', regex: /(养老项目|高息存款|保健品|养老公寓|以房养老|代办养老金)/gi },
        { name: '高危转账话术', regex: /(私下转账|微信转账|支付宝|不要告诉别人|紧急|马上转|删聊天记录)/gi }
    ];

    const results = [];
    patterns.forEach(item => {
        const matches = text.match(item.regex);
        if (matches && matches.length > 0) {
            results.push({
                type: item.name,
                content: [...new Set(matches)]
            });
        }
    });
    return results;
}

async function addScamData(key, data) {
    const scamKey = `scam-${key}`;
    const scamData = {
        ...data,
        reportCount: 1,
        createTime: new Date().toISOString(),
        updateTime: new Date().toISOString()
    };

    const existing = await cfbot.get(scamKey, { type: 'json' });
    if (existing) {
        scamData.reportCount = existing.reportCount + 1;
        scamData.createTime = existing.createTime;
    }

    await cfbot.put(scamKey, JSON.stringify(scamData));
    return scamData;
}

async function queryScamData(key) {
    const scamKey = `scam-${key}`;
    const data = await cfbot.get(scamKey, { type: 'json' });
    return data || null;
}

async function getScamStats() {
    const statsKey = 'scam-stats';
    let stats = await cfbot.get(statsKey, { type: 'json' });

    if (!stats) {
        stats = { total: 0, types: {} };
    }

    const list = await listAllScamData();
    stats.total = list.length;

    const typeCount = {};
    list.forEach(item => {
        const type = item.type || '未知';
        typeCount[type] = (typeCount[type] || 0) + 1;
    });
    stats.types = typeCount;

    await cfbot.put(statsKey, JSON.stringify(stats));
    return stats;
}

// 注意：Cloudflare KV 的 list 方法不支持 offset 参数，实际分页需使用 cursor
// 此处简化实现，直接列出所有 key 并获取数据，适用于数据量不大的场景
async function listAllScamData(limit = 1000) {
    const list = [];
    let cursor = undefined;
    do {
        const options = { prefix: 'scam-' };
        if (limit) options.limit = limit;
        if (cursor) options.cursor = cursor;
        
        const result = await cfbot.list(options);
        for (const key of result.keys) {
            if (key.name !== 'scam-stats') {
                const data = await cfbot.get(key.name, { type: 'json' });
                if (data) list.push(data);
            }
        }
        cursor = result.cursor;
    } while (cursor);
    
    return list;
}

async function initScamDatabase() {
    const scamList = [
        ["13000000000", "客服诈骗", "冒充快递/电商客服"],
        ["13111111111", "刷单诈骗", "垫付返利/冲单"],
        ["13222222222", "贷款诈骗", "无抵押/低息贷款"],
        ["13333333333", "公检法诈骗", "涉案/冻结/转账"],
        ["13444444444", "游戏诈骗", "账号/装备交易"],
        ["13555555555", "中奖诈骗", "领奖需手续费"],
        ["13666666666", "投资诈骗", "高收益/杀猪盘"],
        ["13777777777", "亲友诈骗", "借钱/紧急转账"],
        ["95013", "虚假客服", "仿冒官方热线"],
        ["400800XXXX", "售后诈骗", "退款/理赔"],
        ["www.xxx.com", "钓鱼网站", "仿冒银行/支付"],
        ["刷单返利", "关键词", "所有刷单均为诈骗"],
        ["解冻资金", "关键词", "公检法不会要求转账"],
        ["安全账户", "关键词", "官方无安全账户"],
        ["保证金", "关键词", "贷款/入职不交保证金"],
        ["13800000000", "婚恋诈骗", "网恋诱导投资/借钱"],
        ["13900000000", "婚恋诈骗", "虚假人设/博好感"],
        ["杀猪盘", "关键词", "婚恋诱导投资是诈骗"],
        ["15000000000", "冒充领导", "要求私下转账/办事"],
        ["15100000000", "冒充领导", "微信/QQ换号借钱"],
        ["王总", "关键词", "冒充领导紧急转账"]
    ];

    let success = 0;
    for (const item of scamList) {
        const [key, type, desc] = item;
        await addScamData(key, {
            key,
            type,
            description: desc,
            reporter: "system"
        });
        success++;
    }

    return { total: scamList.length, success };
}

async function batchAddScamData(chatId, dataList, isAdmin) {
    if (!isAdmin) {
        return sendMessage(chatId, "❌ 仅管理员可批量导入数据");
    }

    let success = 0, fail = 0;
    for (const item of dataList) {
        try {
            await addScamData(item.key, {
                key: item.key,
                type: item.type,
                description: item.desc,
                reporter: chatId.toString()
            });
            success++;
        } catch (e) {
            fail++;
        }
    }

    return sendMessage(chatId, `
✅ 批量导入完成
├─ 成功：${success} 条
└─ 失败：${fail} 条
  `.trim());
}

async function handleScamCommands(chatId, command, isAdmin) {
    if (command.startsWith('/addscam')) {
        if (!isAdmin) {
            return sendMessage(chatId, '<b>❌ 权限不足</b>\n仅管理员可添加诈骗数据');
        }

        const parts = command.split(' ').filter(p => p);
        if (parts.length < 4) {
            return sendMessage(chatId, `<b>⚠️ 格式错误</b>\n正确格式：/addscam 关键词 类型 描述\n示例：/addscam 13800138000 刷单诈骗 该号码冒充客服诱导刷单`);
        }

        const [_, key, type, ...descParts] = parts;
        const desc = descParts.join(' ');

        try {
            const data = await addScamData(key, {
                key,
                type,
                description: desc,
                reporter: chatId.toString()
            });

            return sendMessage(chatId, `
<b>✅ 新增诈骗数据成功</b>
├─ 关键词：<code>${key}</code>
├─ 类型：<code>${type}</code>
├─ 描述：<code>${desc}</code>
├─ 上报次数：<code>${data.reportCount}</code>
└─ 创建时间：<code>${new Date(data.createTime).toLocaleString('zh-CN')}</code>
      `.trim());
        } catch (error) {
            return sendMessage(chatId, `<b>❌ 添加失败</b>\n${error.message}`);
        }
    }

    if (command.startsWith('/queryscam')) {
        const parts = command.split(' ');
        if (parts.length < 2) {
            return sendMessage(chatId, `<b>⚠️ 格式错误</b>\n正确格式：/queryscam 关键词\n示例：/queryscam 13800138000`);
        }

        const key = parts[1];
        const data = await queryScamData(key);

        if (data) {
            return sendMessage(chatId, `
<b>🔍 诈骗数据查询结果</b>
├─ 关键词：<code>${data.key}</code>
├─ 类型：<code>${data.type}</code>
├─ 描述：<code>${data.description}</code>
├─ 上报次数：<code>${data.reportCount}</code>
├─ 上报人：<code>${data.reporter}</code>
├─ 创建时间：<code>${new Date(data.createTime).toLocaleString('zh-CN')}</code>
└─ 更新时间：<code>${new Date(data.updateTime).toLocaleString('zh-CN')}</code>
      `.trim());
        } else {
            return sendMessage(chatId, `<b>ℹ️ 查询结果</b>\n未找到关键词「${key}」相关的诈骗数据`);
        }
    }

    if (command === '/scamstats') {
        const stats = await getScamStats();

        let typeText = '';
        Object.entries(stats.types).forEach(([type, count]) => {
            typeText += `├─ ${type}：<code>${count}</code>\n`;
        });

        return sendMessage(chatId, `
<b>📊 诈骗数据库统计</b>
├─ 总记录数：<code>${stats.total}</code>
${typeText}└─ 统计时间：<code>${new Date().toLocaleString('zh-CN')}</code>
      `.trim());
    }

    if (command === '/initdb') {
        if (!isAdmin) {
            return sendMessage(chatId, "❌ 权限不足：仅管理员可初始化数据库");
        }

        try {
            const result = await initScamDatabase();
            return sendMessage(chatId, `
✅ 诈骗数据库初始化完成
├─ 总数：${result.total}
└─ 成功导入：${result.success}
      `.trim());
        } catch (e) {
            return sendMessage(chatId, `❌ 初始化失败：${e.message}`);
        }
    }

    if (command.startsWith('/batchaddscam')) {
        if (!isAdmin) return sendMessage(chatId, "❌ 权限不足");
        try {
            const jsonStr = command.replace('/batchaddscam ', '');
            const dataList = JSON.parse(jsonStr);
            return batchAddScamData(chatId, dataList, isAdmin);
        } catch (e) {
            return sendMessage(chatId, `❌ 格式错误：${e.message}\n示例：/batchaddscam [{"key":"123","type":"类型","desc":"描述"}]`);
        }
    }
}

// ==================== 核心请求处理 ====================
addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    if (url.pathname === WEBHOOK) {
        event.respondWith(handleWebhook(event));
    } else if (url.pathname === '/registerWebhook') {
        // 增加密钥验证，防止未授权调用
        const requestSecret = url.searchParams.get('secret');
        if (requestSecret !== SECRET) {
            event.respondWith(new Response('❌ 密钥错误，拒绝访问', { status: 403 }));
        } else {
            event.respondWith(registerWebhook(event, url, WEBHOOK, SECRET));
        }
    } else if (url.pathname === '/unRegisterWebhook') {
        // 增加密钥验证
        const requestSecret = url.searchParams.get('secret');
        if (requestSecret !== SECRET) {
            event.respondWith(new Response('❌ 密钥错误，拒绝访问', { status: 403 }));
        } else {
            event.respondWith(unRegisterWebhook(event));
        }
    } else if (url.pathname === '/setcommands') {
        // setcommands 原本就有密钥验证，保持不变
        event.respondWith(handleSetCommands(event));
    } else {
        event.respondWith(new Response('✅ 反诈机器人运行中（仅群聊检测）', { status: 200 }));
    }
});

// ==================== Webhook处理 ====================
async function handleWebhook(event) {
    if (event.request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== SECRET) {
        return new Response('❌ 未授权访问', { status: 403 });
    }

    try {
        const update = await event.request.json();
        event.waitUntil(onUpdate(update));
        return new Response('Ok', { status: 200 });
    } catch (error) {
        console.error('Webhook解析失败:', error);
        return new Response('❌ 解析失败', { status: 500 });
    }
}

// ==================== 命令菜单设置 ====================
async function handleSetCommands(event) {
    try {
        const urlObj = new URL(event.request.url);
        const requestSecret = urlObj.searchParams.get('secret');
        if (requestSecret !== SECRET) {
            return new Response(JSON.stringify({
                code: 403,
                msg: '❌ 密钥错误，拒绝访问'
            }), {
                status: 403,
                headers: { 'Content-Type': 'application/json; charset=utf-8' }
            });
        }

        const commands = [
            { command: 'start', description: '开始使用机器人' },
            { command: 'addscam', description: '添加诈骗数据 (管理员)' },
            { command: 'queryscam', description: '查询诈骗数据' },
            { command: 'scamstats', description: '查看诈骗数据库统计' },
            { command: 'initdb', description: '初始化数据库 (管理员)' },
            { command: 'batchaddscam', description: '批量导入诈骗数据 (管理员)' }
        ];

        const result = await requestTelegram('setMyCommands', makeReqBody({ commands }));

        if (result.ok) {
            return new Response(JSON.stringify({
                code: 200,
                msg: '✅ 命令菜单设置成功',
                commands: commands
            }, null, 2), {
                headers: { 'Content-Type': 'application/json; charset=utf-8' }
            });
        } else {
            return new Response(JSON.stringify({
                code: 500,
                msg: '❌ 命令菜单设置失败',
                error: result
            }, null, 2), {
                status: 500,
                headers: { 'Content-Type': 'application/json; charset=utf-8' }
            });
        }
    } catch (error) {
        return new Response(JSON.stringify({
            code: 500,
            msg: '❌ 设置过程异常',
            error: error.message
        }, null, 2), {
            status: 500,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
    }
}

// ==================== 消息处理逻辑 ====================
async function onUpdate(update) {
    if (update.message) {
        await onMessage(update.message);
    }
}

async function onMessage(message) {
    const chatId = message.chat.id;
    const fromId = message.from.id;
    const isAdmin = fromId.toString() === ADMIN_UID;
    const chatType = message.chat.type;

    // 处理所有命令
    if (message.text && message.text.startsWith('/')) {
        if (message.text.startsWith('/addscam') ||
            message.text.startsWith('/queryscam') ||
            message.text === '/scamstats' ||
            message.text === '/initdb' ||
            message.text.startsWith('/batchaddscam')) {
            return handleScamCommands(chatId, message.text, isAdmin);
        }

        if (message.text === '/start') {
            const startText = `
<b>👋 欢迎使用反诈机器人！</b>
├─ 🚨 反诈防护：自动检测所有主流诈骗类型 🛡️
├─自动检测可疑诈骗消息并发出警告。
├─管理员可使用以下命令管理诈骗数据库：
├─/addscam - 添加诈骗数据（管理员）
├─/queryscam - 查询诈骗数据
├─/scamstats - 查看数据库统计
├─/initdb - 初始化数据库（管理员）
└─/batchaddscam - 批量导入（管理员）
      `.trim();
            return sendMessage(chatId, startText);
        }

        return;
    }

    // 仅群聊文本消息进行诈骗检测
    if ((chatType === 'group' || chatType === 'supergroup') && message.text) {
        let suspicious = detectSuspiciousContent(message.text);

        const textWords = message.text.replace(/\W/g, ' ').split(' ').filter(w => w.length >= 3);
        for (const word of textWords) {
            const scamData = await queryScamData(word);
            if (scamData && !suspicious.some(item => item.type.includes(scamData.type))) {
                suspicious.push({
                    type: `KV库匹配-${scamData.type}`,
                    content: [word]
                });
            }
        }

        if (suspicious.length > 0) {
            let warningText = '<b>⚠️ 检测到可疑诈骗内容</b>\n';
            suspicious.forEach(item => {
                warningText += `├─ ${item.type}：<code>${item.content.join(', ')}</code>\n`;
                if (item.type.includes('婚恋')) warningText += '│ 👉 网恋提钱都是诈骗，切勿转账！\n';
                if (item.type.includes('冒充领导')) warningText += '│ 👉 务必电话核实，切勿私下转账！\n';
                if (item.type.includes('刷单')) warningText += '│ 👉 所有刷单都是诈骗，立即停止！\n';
            });
            warningText += '└─ 请注意防范诈骗！';

            await sendMessage(chatId, warningText, { reply_to_message_id: message.message_id });

            const senderInfo = `用户 ${message.from.first_name || ''} ${message.from.last_name || ''} (ID: ${message.from.id})`;
            const groupInfo = `群组 ${message.chat.title || '未知群组'} (ID: ${chatId})`;
            const adminAlert = `
<b>🚨 群聊诈骗预警</b>
${groupInfo}
${senderInfo}
<b>可疑消息：</b><code>${message.text.substring(0, 200)}${message.text.length > 200 ? '…' : ''}</code>
<b>检测项：</b>
${suspicious.map(s => `├─ ${s.type}: ${s.content.join(', ')}`).join('\n')}
      `.trim();

            await sendMessage(ADMIN_UID, adminAlert);
        }
    }
}

// ==================== Webhook注册/注销 ====================
async function registerWebhook(event, requestUrl, suffix, secret) {
    const webhookUrl = `${requestUrl.protocol}//${requestUrl.hostname}${suffix}`;
    const r = await (await fetch(apiUrl('setWebhook', {
        url: webhookUrl,
        secret_token: secret,
        allowed_updates: JSON.stringify(['message'])
    }))).json();

    return new Response(r.ok ? '✅ Webhook注册成功' : `❌ 注册失败：${JSON.stringify(r, null, 2)}`, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
}

async function unRegisterWebhook(event) {
    const r = await (await fetch(apiUrl('setWebhook', { url: '' }))).json();

    return new Response(r.ok ? '✅ Webhook已注销' : `❌ 注销失败：${JSON.stringify(r, null, 2)}`, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
}

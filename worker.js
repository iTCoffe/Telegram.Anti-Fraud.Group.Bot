// ==================== 环境变量配置（无需修改，在Cloudflare后台配置） ====================
// 环境变量（Cloudflare Workers → 设置 → 变量）：
//   ENV_BOT_TOKEN     - Telegram机器人令牌
//   ENV_BOT_SECRET    - 自定义密钥（用于URL参数验证）
//   ENV_ADMIN_UID     - 管理员Telegram ID（数字字符串）
// KV命名空间绑定：Variable name = nfd（必须填这个）

const TOKEN = ENV_BOT_TOKEN;
const WEBHOOK = '/endpoint';
const SECRET = ENV_BOT_SECRET;
const ADMIN_UID = ENV_ADMIN_UID;
const nfd = globalThis.nfd; // KV命名空间（绑定名必须为nfd）

// ==================== 基础工具函数 ====================
/**
 * 构建Telegram API请求URL
 * @param {string} methodName API方法名
 * @param {Object} params URL参数
 * @returns {string} 完整API URL
 */
function apiUrl(methodName, params = null) {
  let query = params ? '?' + new URLSearchParams(params).toString() : '';
  return `https://api.telegram.org/bot${TOKEN}/${methodName}${query}`;
}

/**
 * 发送请求到Telegram API
 * @param {string} methodName API方法名
 * @param {Object} body 请求体
 * @param {Object} params URL参数
 * @returns {Promise<Object>} API响应结果
 */
function requestTelegram(methodName, body, params = null) {
  return fetch(apiUrl(methodName, params), body).then(r => r.json());
}

/**
 * 构建JSON请求体
 * @param {Object} data 请求数据
 * @returns {Object} Fetch请求配置
 */
function makeReqBody(data) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data)
  };
}

/**
 * 发送格式化消息
 * @param {string|number} chat_id 聊天ID
 * @param {string} text 消息内容（支持HTML）
 * @param {string} parse_mode 解析模式（默认HTML）
 * @returns {Promise<Object>} 发送结果
 */
function sendMessage(chat_id, text, parse_mode = 'HTML') {
  return requestTelegram('sendMessage', makeReqBody({ 
    chat_id, 
    text,
    parse_mode,
    disable_web_page_preview: true // 禁用链接预览，更整洁
  }));
}

/**
 * 复制消息
 * @param {string|number} chat_id 目标聊天ID
 * @param {string|number} from_chat_id 源聊天ID
 * @param {number} message_id 消息ID
 * @returns {Promise<Object>} 复制结果
 */
function copyMessage(chat_id, from_chat_id, message_id) {
  return requestTelegram('copyMessage', makeReqBody({ chat_id, from_chat_id, message_id }));
}

/**
 * 转发消息
 * @param {string|number} chat_id 目标聊天ID
 * @param {string|number} from_chat_id 源聊天ID
 * @param {number} message_id 消息ID
 * @returns {Promise<Object>} 转发结果
 */
function forwardMessage(chat_id, from_chat_id, message_id) {
  return requestTelegram('forwardMessage', makeReqBody({ chat_id, from_chat_id, message_id }));
}

/**
 * 格式化时间消息（仅适配北京时间，其余逻辑/格式不变）
 * @param {Date} date 时间对象
 * @returns {string} 美化后的时间消息
 */
function formatTimeMessage(date) {
  // 核心修改：转换为北京时间（UTC+8）
  const utcTimestamp = date.getTime() + date.getTimezoneOffset() * 60000; // 转换为UTC时间戳
  const beijingDate = new Date(utcTimestamp + 8 * 3600000); // UTC+8得到北京时间
  
  // 以下逻辑完全保留你的版本，仅替换为北京时间对象
  const year = String(beijingDate.getFullYear()); // 年
  const month = String(beijingDate.getMonth() + 1).padStart(2, '0'); // 月（补0）
  const day = String(beijingDate.getDate()).padStart(2, '0'); // 日（补0）
  const hours = String(beijingDate.getHours()).padStart(2, '0');
  const minutes = String(beijingDate.getMinutes()).padStart(2, '0');
  const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const weekDay = weekDays[beijingDate.getDay()];
  
  return `
<b>⏰ 时间提醒</b> 
├─ 时间：<code>${hours}:${minutes}</code>
└─ 日期：<code>${year}年${month}月${day}日</code> ${weekDay}
<i>自动推送的整点/半点提醒 🔔</i>
  `.trim();
}

// ==================== 防诈骗数据库核心功能（2025主流全覆盖+KV扩展） ====================
/**
 * 检测文本中的可疑信息（2025主流诈骗全覆盖）
 * @param {string} text 要检测的文本
 * @returns {Array} 检测到的可疑内容列表
 */
function detectSuspiciousContent(text) {
  const patterns = [
    // 基础敏感信息
    { name: '手机号', regex: /1[3-9]\d{9}/g },
    { name: '银行卡/账号', regex: /\d{16,19}/g },
    { name: '可疑链接', regex: /https?:\/\/[^\s]+/g },
    { name: '收款码/二维码', regex: /(收款码|二维码|扫码支付|加微信发码)/gi },

    // 经典高频诈骗（2025主流）
    { name: '刷单返利诈骗', regex: /(刷单|返利|垫资|冲单|做单|佣金|点赞|关注|拉新|试玩)/gi },
    { name: '客服退款诈骗', regex: /(客服|退款|理赔|保证金|解冻|订单异常|快递丢失|质量问题)/gi },
    { name: '公检法诈骗', regex: /(公检法|通缉|涉案|冻结|安全账户|配合调查|逮捕令|征信异常)/gi },
    { name: '贷款诈骗', regex: /(无抵押|低息|秒批|包装流水|先交费用|解冻贷款|征信修复)/gi },
    
    // 社交类诈骗
    { name: '婚恋杀猪盘', regex: /(网恋|交友|处对象|奔现|宝贝|老公老婆|带你赚钱|投资|博彩|数字货币|感情投资)/gi },
    { name: '冒充领导/干部', regex: /(总|书记|局长|主任|领导|换号|加微信|急事|保密|帮忙打款|私下发我)/gi },
    { name: '冒充老师/家长', regex: /(家长群|学费|资料费|老师|代收|缴费|班级群|补课费)/gi },
    { name: '冒充亲友借钱', regex: /(我是你朋友|换号|我号码丢了|急用|借钱|转我|出车祸|住院)/gi },
    { name: 'AI换脸/换声诈骗', regex: /(视频验证|语音确认|我是本人|看视频|借钱应急|家人出事)/gi },

    // 消费/服务类诈骗
    { name: '虚假购物/微商', regex: /(代购|秒杀|低价|不发货|先款|定金|微商转账|海外代购)/gi },
    { name: '医美/保健品诈骗', regex: /(医美分期|免费美容|保健品|包治百病|特效药|先交钱)/gi },
    { name: '冒充快递员/外卖员', regex: /(快递丢失|理赔|加微信|私下赔付|到付|代收货款)/gi },
    { name: '注销校园贷诈骗', regex: /(校园贷|注销账户|影响征信|操作失误|需要转账|清零记录)/gi },

    // 投资/理财类诈骗
    { name: '投资理财诈骗', regex: /(内幕|翻倍|保本|高收益|带单|老师带投|虚拟货币|外汇|期货)/gi },
    { name: '虚拟币/NFT诈骗', regex: /(比特币|以太坊|NFT|空投|挖矿|交易所|提币需要手续费)/gi },

    // 其他高发类型
    { name: '游戏/充值诈骗', regex: /(游戏币|装备|账号|充值|内部福利|免费皮肤|代练|解封)/gi },
    { name: '中奖/送礼诈骗', regex: /(中奖|领奖|免费领|礼品|手续费|税费|积分兑换)/gi },
    { name: '兼职诈骗', regex: /(打字员|刷单兼职|日结|无门槛|押金|培训费|入职费)/gi },
    { name: '养老诈骗', regex: /(养老项目|高息存款|保健品|养老公寓|以房养老|代办养老金)/gi },

    // 万能高危话术
    { name: '高危转账话术', regex: /(私下转账|微信转账|支付宝|不要告诉别人|紧急|马上转|删聊天记录)/gi }
  ];
  
  const results = [];
  patterns.forEach(item => {
    const matches = text.match(item.regex);
    if (matches && matches.length > 0) {
      results.push({
        type: item.name,
        content: [...new Set(matches)] // 去重
      });
    }
  });
  return results;
}

/**
 * 新增诈骗信息到数据库
 * @param {string} key 存储键（如手机号/关键词）
 * @param {Object} data 诈骗信息详情
 */
async function addScamData(key, data) {
  const scamKey = `scam-${key}`;
  // 补充时间戳和上报次数
  const scamData = {
    ...data,
    reportCount: 1,
    createTime: new Date().toISOString(),
    updateTime: new Date().toISOString()
  };
  
  // 检查是否已存在，存在则增加上报次数
  const existing = await nfd.get(scamKey, { type: 'json' });
  if (existing) {
    scamData.reportCount = existing.reportCount + 1;
    scamData.createTime = existing.createTime;
  }
  
  await nfd.put(scamKey, JSON.stringify(scamData));
  return scamData;
}

/**
 * 查询诈骗数据库
 * @param {string} key 要查询的关键词/手机号等
 * @returns {Promise<Object>} 查询结果
 */
async function queryScamData(key) {
  const scamKey = `scam-${key}`;
  const data = await nfd.get(scamKey, { type: 'json' });
  return data || null;
}

/**
 * 获取诈骗数据统计
 * @returns {Promise<Object>} 统计信息
 */
async function getScamStats() {
  const statsKey = 'scam-stats';
  let stats = await nfd.get(statsKey, { type: 'json' });
  
  if (!stats) {
    stats = { total: 0, types: {} };
  }
  
  // 重新计算总数（防止数据不一致）
  const list = await listAllScamData();
  stats.total = list.length;
  
  // 统计各类型数量
  const typeCount = {};
  list.forEach(item => {
    const type = item.type || '未知';
    typeCount[type] = (typeCount[type] || 0) + 1;
  });
  stats.types = typeCount;
  
  await nfd.put(statsKey, JSON.stringify(stats));
  return stats;
}

/**
 * 列出所有诈骗数据（分页）
 * @param {number} limit 数量限制
 * @param {number} offset 偏移量
 * @returns {Promise<Array>} 诈骗数据列表
 */
async function listAllScamData(limit = 50, offset = 0) {
  const list = [];
  const keys = await nfd.list({ prefix: 'scam-', limit, offset });
  
  for (const key of keys.keys) {
    if (key.name !== 'scam-stats') { // 排除统计数据
      const data = await nfd.get(key.name, { type: 'json' });
      if (data) list.push(data);
    }
  }
  
  return list;
}

/**
 * 批量导入防诈骗数据（简洁版）
 */
async function initScamDatabase() {
  // 简洁版基础诈骗数据
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

  return {
    total: scamList.length,
    success
  };
}

/**
 * 批量导入自定义诈骗数据
 * @param {number} chatId 聊天ID
 * @param {Array} dataList 自定义数据列表
 * @param {boolean} isAdmin 是否管理员
 */
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
      console.error(`导入失败 ${item.key}：${e.message}`);
    }
  }
  
  return sendMessage(chatId, `
✅ 批量导入完成
├─ 成功：${success} 条
└─ 失败：${fail} 条
  `.trim());
}

/**
 * 处理防诈骗相关命令
 * @param {number} chatId 聊天ID
 * @param {string} command 命令内容
 * @param {boolean} isAdmin 是否是管理员
 */
async function handleScamCommands(chatId, command, isAdmin) {
  // /addscam 手机号 诈骗类型 描述
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
  
  // /queryscam 关键词
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
  
  // /scamstats 查看统计
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

  // /initdb 初始化基础数据库
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

  // /batchaddscam 批量导入自定义数据
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
  
  // 路由分发
  if (url.pathname === WEBHOOK) {
    event.respondWith(handleWebhook(event));
  } else if (url.pathname === '/registerWebhook') {
    event.respondWith(registerWebhook(event, url, WEBHOOK, SECRET));
  } else if (url.pathname === '/unRegisterWebhook') {
    event.respondWith(unRegisterWebhook(event));
  } else if (url.pathname === '/sendTime') {
    event.respondWith(handleSendTime(event)); // 免费版：URL参数验证
  } else {
    event.respondWith(new Response('✅ Telegram Bot 运行中（时间提醒, 防诈骗数据）', { status: 200 }));
  }
});

// ==================== Webhook处理 ====================
/**
 * 处理Telegram Webhook请求
 * @param {FetchEvent} event Fetch事件
 * @returns {Promise<Response>} 响应
 */
async function handleWebhook(event) {
  // 验证Webhook密钥，防止非法请求
  if (event.request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== SECRET) {
    return new Response('❌ 未授权访问', { status: 403 });
  }
  
  try {
    const update = await event.request.json();
    event.waitUntil(onUpdate(update)); // 异步处理消息，不阻塞响应
    return new Response('Ok', { status: 200 });
  } catch (error) {
    console.error('Webhook解析失败:', error);
    return new Response('❌ 解析失败', { status: 500 });
  }
}

// ==================== 免费模式：定时推送接口（URL参数验证） ====================
/**
 * 处理外部定时工具的时间推送请求（EasyCron免费版适配）
 * @param {FetchEvent} event Fetch事件
 * @returns {Promise<Response>} 响应
 */
async function handleSendTime(event) {
  try {
    const request = event.request;
    const urlObj = new URL(request.url);
    
    // 核心：从URL参数 ?secret=xxx 读取密钥（免费版无Headers，用URL参数）
    const requestSecret = urlObj.searchParams.get('secret');
    // 验证密钥（必须和Cloudflare的ENV_BOT_SECRET一致）
    if (requestSecret !== SECRET) {
      return new Response(JSON.stringify({ 
        code: 403, 
        msg: '❌ 密钥错误，拒绝访问（免费版需带?secret=你的密钥）' 
      }), { 
        status: 403, 
        headers: { 'Content-Type': 'application/json; charset=utf-8' } 
      });
    }

    const now = new Date();
    const timeMsg = formatTimeMessage(now);
    await sendMessage(ADMIN_UID, timeMsg);
    
    // 返回成功响应
    return new Response(JSON.stringify({
      code: 200,
      msg: '✅ 时间推送成功',
      time: now.toLocaleString('zh-CN'),
      content: timeMsg
    }, null, 2), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  } catch (error) {
    console.error('定时推送失败:', error);
    // 返回错误响应
    return new Response(JSON.stringify({
      code: 500,
      msg: '❌ 推送失败',
      error: error.message,
      time: new Date().toLocaleString('zh-CN')
    }, null, 2), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
}

// ==================== 消息处理逻辑 ====================
/**
 * 处理Telegram更新
 * @param {Object} update Telegram更新对象
 */
async function onUpdate(update) {
  if (update.message) {
    await onMessage(update.message);
  }
}

/**
 * 处理消息
 * @param {Object} message 消息对象
 */
async function onMessage(message) {
  const chatId = message.chat.id;
  const isAdmin = chatId.toString() === ADMIN_UID;

  // 处理防诈骗相关命令
  if (message.text && (
    message.text.startsWith('/addscam') || 
    message.text.startsWith('/queryscam') || 
    message.text === '/scamstats' ||
    message.text === '/initdb' ||
    message.text.startsWith('/batchaddscam')
  )) {
    return handleScamCommands(chatId, message.text, isAdmin);
  }

  // 自动检测消息中的可疑诈骗内容（文本+KV双引擎）
  if (message.text) {
    // 1. 文本特征检测
    let suspicious = detectSuspiciousContent(message.text);
    
    // 2. KV数据库关键词匹配（增强识别）
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

    // 发送警告提示
    if (suspicious.length > 0) {
      let warningText = '<b>⚠️ 检测到可疑诈骗内容</b>\n';
      suspicious.forEach(item => {
        warningText += `├─ ${item.type}：<code>${item.content.join(', ')}</code>\n`;
        // 针对性提醒
        if (item.type.includes('婚恋')) warningText += '│ 👉 网恋提钱都是诈骗，切勿转账！\n';
        if (item.type.includes('冒充领导')) warningText += '│ 👉 务必电话核实，切勿私下转账！\n';
        if (item.type.includes('刷单')) warningText += '│ 👉 所有刷单都是诈骗，立即停止！\n';
      });
      warningText += '└─ 请注意防范诈骗！如需上报，请联系管理员';
      
      // 普通用户收到警告
      if (!isAdmin) {
        await sendMessage(chatId, warningText);
      }
      
      // 管理员收到提醒
      if (ADMIN_UID && chatId.toString() !== ADMIN_UID) {
        await sendMessage(ADMIN_UID, `${warningText}\n\n<b>来源</b>：用户 ID ${chatId}`);
      }
    }
  }

  // 处理/start命令
  if (message.text === '/start') {
    const startText = `
<b>👋 欢迎使用双向消息机器人！</b>
├─ 您发送的所有消息都会转发给管理员 📤
├─ 管理员的回复会同步到这里 📥
├─ 🚨 2025反诈防护：自动检测所有主流诈骗类型 🛡️
└─ 管理员命令：/addscam /queryscam /scamstats /initdb /batchaddscam
<i>使用提示：直接发消息即可，无需其他命令</i>
    `.trim();
    return sendMessage(chatId, startText);
  }

  // 管理员消息处理（仅回复转发消息有效）
  if (isAdmin) {
    if (!message.reply_to_message) {
      return sendMessage(chatId, '<b>⚠️ 操作提示</b>\n请先回复需要回应的转发消息哦～');
    }

    // 从KV获取原始用户ID
    const guestChatId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: 'json' });
    if (!guestChatId) {
      return sendMessage(chatId, '<b>❌ 查找失败</b>\n无法找到对应的用户，可能消息已过期或不是转发消息～');
    }

    // 复制管理员回复给用户
    await copyMessage(guestChatId, chatId, message.message_id);
    return sendMessage(chatId, '<b>✅ 回复成功</b>\n已将消息发送给用户 ID: ${guestChatId}');
  }

  // 普通用户消息处理（转发给管理员）
  const forwardResult = await forwardMessage(ADMIN_UID, chatId, message.message_id);
  if (forwardResult.ok) {
    // 保存消息映射关系（供管理员回复使用）
    await nfd.put('msg-map-' + forwardResult.result.message_id, chatId.toString());
    await sendMessage(chatId, '<b>✅ 消息已发送</b>\n管理员会尽快回复您，请耐心等待～');
  } else {
    console.error('消息转发失败:', forwardResult);
    await sendMessage(chatId, '<b>❌ 发送失败</b>\n消息暂无法送达，请稍后再试～');
  }
}

// ==================== Webhook注册/注销 ====================
/**
 * 注册Webhook
 * @param {FetchEvent} event Fetch事件
 * @param {URL} requestUrl 请求URL
 * @param {string} suffix Webhook路径后缀
 * @param {string} secret 验证密钥
 * @returns {Promise<Response>} 响应
 */
async function registerWebhook(event, requestUrl, suffix, secret) {
  const webhookUrl = `${requestUrl.protocol}//${requestUrl.hostname}${suffix}`;
  const r = await (await fetch(apiUrl('setWebhook', { 
    url: webhookUrl, 
    secret_token: secret,
    allowed_updates: JSON.stringify(['message']) // 只接收消息更新，减少请求
  }))).json();
  
  return new Response(r.ok ? '✅ Webhook注册成功' : `❌ 注册失败：${JSON.stringify(r, null, 2)}`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

/**
 * 注销Webhook
 * @param {FetchEvent} event Fetch事件
 * @returns {Promise<Response>} 响应
 */
async function unRegisterWebhook(event) {
  const r = await (await fetch(apiUrl('setWebhook', { url: '' }))).json();
  
  return new Response(r.ok ? '✅ Webhook已注销' : `❌ 注销失败：${JSON.stringify(r, null, 2)}`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}
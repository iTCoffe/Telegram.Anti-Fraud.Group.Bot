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

  // 处理/start命令
  if (message.text === '/start') {
    const startText = `
<b>👋 欢迎使用双向消息机器人！</b>
├─ 您发送的所有消息都会转发给管理员 📤
└─ 管理员的回复会同步到这里 📥
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
    return sendMessage(chatId, `<b>✅ 回复成功</b>\n已将消息发送给用户 ID: ${guestChatId}`);
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

// ==================== 环境变量 ====================
// 需要绑定的 KV 命名空间名称：nfd
// 环境变量（在 Cloudflare Workers 中设置）：
//   ENV_BOT_TOKEN     - 机器人令牌
//   ENV_BOT_SECRET    - Webhook 密钥
//   ENV_ADMIN_UID     - 管理员用户 ID
//   ENABLE_NOTIFY     - (可选) 是否开启定期提醒，设为 'true' 开启

const TOKEN = ENV_BOT_TOKEN;
const WEBHOOK = '/endpoint';
const SECRET = ENV_BOT_SECRET;
const ADMIN_UID = ENV_ADMIN_UID; // 字符串形式

const NOTIFY_INTERVAL = 3600 * 1000; // 1小时
const fraudDb = 'https://raw.githubusercontent.com/iTaoPu/Telegram.Forward.Bot/main/data/fraud.db';
const notificationUrl = 'https://raw.githubusercontent.com/iTaoPu/Telegram.Forward.Bot/main/data/notification.txt';
const startMsgUrl = 'https://raw.githubusercontent.com/iTaoPu/Telegram.Forward.Bot/main/data/startMessage.md';
const enable_notification = (typeof ENABLE_NOTIFY !== 'undefined' && ENABLE_NOTIFY === 'true'); // 从环境变量读取

// KV 命名空间（需在 wrangler.toml 中绑定，名称必须为 nfd）
// 如果未绑定，此处会抛出 ReferenceError，请确保配置正确
const nfd = globalThis.nfd; // 在 Service Worker 语法中可直接使用绑定的全局变量

// ==================== 辅助函数 ====================
function apiUrl(methodName, params = null) {
  let query = '';
  if (params) {
    query = '?' + new URLSearchParams(params).toString();
  }
  return `https://api.telegram.org/bot${TOKEN}/${methodName}${query}`;
}

function requestTelegram(methodName, body, params = null) {
  return fetch(apiUrl(methodName, params), body).then(r => r.json());
}

function makeReqBody(body) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  };
}

function sendMessage(msg = {}) {
  return requestTelegram('sendMessage', makeReqBody(msg));
}

function copyMessage(msg = {}) {
  return requestTelegram('copyMessage', makeReqBody(msg));
}

function forwardMessage(msg) {
  return requestTelegram('forwardMessage', makeReqBody(msg));
}

// ==================== Webhook 处理 ====================
addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.pathname === WEBHOOK) {
    event.respondWith(handleWebhook(event));
  } else if (url.pathname === '/registerWebhook') {
    event.respondWith(registerWebhook(event, url, WEBHOOK, SECRET));
  } else if (url.pathname === '/unRegisterWebhook') {
    event.respondWith(unRegisterWebhook(event));
  } else {
    event.respondWith(new Response('No handler for this request'));
  }
});

async function handleWebhook(event) {
  if (event.request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== SECRET) {
    return new Response('Unauthorized', { status: 403 });
  }

  const update = await event.request.json();
  event.waitUntil(onUpdate(update));
  return new Response('Ok');
}

// ==================== 业务逻辑 ====================
async function onUpdate(update) {
  if ('message' in update) {
    await onMessage(update.message);
  }
}

async function onMessage(message) {
  // 处理 /start 命令
  if (message.text === '/start') {
    let startMsg = await fetch(startMsgUrl).then(r => r.text()).catch(() => 'Welcome!');
    return sendMessage({
      chat_id: message.chat.id,
      text: startMsg,
    });
  }

  // 管理员消息
  if (message.chat.id.toString() === ADMIN_UID) {
    // 如果没有回复任何消息，提示用法
    if (!message.reply_to_message) {
      return sendMessage({
        chat_id: ADMIN_UID,
        text: '使用方法：回复转发的消息，然后发送回复内容，或使用 /block、/unblock、/checkblock 命令'
      });
    }

    // 处理命令
    if (/^\/block$/.test(message.text)) {
      return handleBlock(message);
    }
    if (/^\/unblock$/.test(message.text)) {
      return handleUnBlock(message);
    }
    if (/^\/checkblock$/.test(message.text)) {
      return checkBlock(message);
    }

    // 非命令：获取原始用户 ID
    const guestChatId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: 'json' });
    if (!guestChatId) {
      return sendMessage({
        chat_id: ADMIN_UID,
        text: '无法找到对应的用户，可能消息已过期或不是转发的消息。'
      });
    }

    // 将管理员的回复复制给用户
    return copyMessage({
      chat_id: guestChatId,
      from_chat_id: message.chat.id,
      message_id: message.message_id,
    });
  }

  // 普通用户消息
  return handleGuestMessage(message);
}

async function handleGuestMessage(message) {
  const chatId = message.chat.id;

  // 检查是否被封禁
  const isblocked = await nfd.get('isblocked-' + chatId, { type: 'json' });
  if (isblocked) {
    return sendMessage({
      chat_id: chatId,
      text: 'You are blocked',
    });
  }

  // 转发消息给管理员
  const forwardReq = await forwardMessage({
    chat_id: ADMIN_UID,
    from_chat_id: chatId,
    message_id: message.message_id,
  });

  if (forwardReq.ok) {
    // 保存消息映射（管理员回复时使用）
    await nfd.put('msg-map-' + forwardReq.result.message_id, chatId.toString());
  } else {
    console.error('Forward failed:', forwardReq);
  }

  // 处理通知（防骗提醒等）
  return handleNotify(message);
}

async function handleNotify(message) {
  const chatId = message.chat.id;

  // 检查是否为已知骗子
  try {
    if (await isFraud(chatId)) {
      return sendMessage({
        chat_id: ADMIN_UID,
        text: `⚠️ 检测到骗子，UID: ${chatId}`,
      });
    }
  } catch (e) {
    console.error('Fraud check failed:', e);
  }

  // 定期提醒
  if (enable_notification) {
    const lastMsgTime = await nfd.get('lastmsg-' + chatId, { type: 'json' });
    const now = Date.now();
    if (!lastMsgTime || now - lastMsgTime > NOTIFY_INTERVAL) {
      await nfd.put('lastmsg-' + chatId, now);
      const notifyText = await fetch(notificationUrl).then(r => r.text()).catch(() => 'Please be cautious when trading.');
      return sendMessage({
        chat_id: ADMIN_UID,
        text: notifyText,
      });
    }
  }
}

// 封禁用户
async function handleBlock(message) {
  const guestChatId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: 'json' });
  if (!guestChatId) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '无法找到对应的用户。'
    });
  }

  // 不能封禁管理员自己
  if (guestChatId.toString() === ADMIN_UID) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '不能屏蔽自己'
    });
  }

  await nfd.put('isblocked-' + guestChatId, true);
  return sendMessage({
    chat_id: ADMIN_UID,
    text: `UID: ${guestChatId} 屏蔽成功`,
  });
}

// 解封用户
async function handleUnBlock(message) {
  const guestChatId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: 'json' });
  if (!guestChatId) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '无法找到对应的用户。'
    });
  }

  await nfd.put('isblocked-' + guestChatId, false);
  return sendMessage({
    chat_id: ADMIN_UID,
    text: `UID: ${guestChatId} 解除屏蔽成功`,
  });
}

// 检查封禁状态
async function checkBlock(message) {
  const guestChatId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: 'json' });
  if (!guestChatId) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '无法找到对应的用户。'
    });
  }

  const blocked = await nfd.get('isblocked-' + guestChatId, { type: 'json' });
  return sendMessage({
    chat_id: ADMIN_UID,
    text: `UID: ${guestChatId} ${blocked ? '已被屏蔽' : '未被屏蔽'}`,
  });
}

// ==================== Webhook 注册/注销 ====================
async function registerWebhook(event, requestUrl, suffix, secret) {
  const webhookUrl = `${requestUrl.protocol}//${requestUrl.hostname}${suffix}`;
  const r = await (await fetch(apiUrl('setWebhook', { url: webhookUrl, secret_token: secret }))).json();
  return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2));
}

async function unRegisterWebhook(event) {
  const r = await (await fetch(apiUrl('setWebhook', { url: '' }))).json();
  return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2));
}

// ==================== 诈骗数据库检查 ====================
async function isFraud(id) {
  id = id.toString();
  const dbText = await fetch(fraudDb).then(r => r.text());
  const arr = dbText.split('\n').filter(v => v.trim() !== '');
  return arr.includes(id);
}

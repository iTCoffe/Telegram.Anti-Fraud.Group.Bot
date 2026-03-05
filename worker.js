// ==================== 环境变量 ====================
// 需要绑定的 KV 命名空间名称：nfd
// 环境变量（在 Cloudflare Workers 中设置）：
//   ENV_BOT_TOKEN     - 机器人令牌
//   ENV_BOT_SECRET    - Webhook 密钥
//   ENV_ADMIN_UID     - 管理员用户 ID（字符串形式）

const TOKEN = ENV_BOT_TOKEN;
const WEBHOOK = '/endpoint';
const SECRET = ENV_BOT_SECRET;
const ADMIN_UID = ENV_ADMIN_UID;

// KV 命名空间（需在 wrangler.toml 中绑定，名称为 nfd）
const nfd = globalThis.nfd;

// ==================== 辅助函数 ====================
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

function sendMessage(chat_id, text) {
  return requestTelegram('sendMessage', makeReqBody({ chat_id, text }));
}

function copyMessage(chat_id, from_chat_id, message_id) {
  return requestTelegram('copyMessage', makeReqBody({ chat_id, from_chat_id, message_id }));
}

function forwardMessage(chat_id, from_chat_id, message_id) {
  return requestTelegram('forwardMessage', makeReqBody({ chat_id, from_chat_id, message_id }));
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
  if (update.message) {
    await onMessage(update.message);
  }
}

async function onMessage(message) {
  const chatId = message.chat.id;
  const isAdmin = chatId.toString() === ADMIN_UID;

  // 处理 /start 命令（所有人都可以）
  if (message.text === '/start') {
    const startText = '欢迎使用双向机器人！您发送的消息将被转发给管理员。';
    return sendMessage(chatId, startText);
  }

  if (isAdmin) {
    // 管理员消息：必须是对转发消息的回复
    if (!message.reply_to_message) {
      return sendMessage(chatId, '请回复您要回复的转发消息。');
    }

    // 从 KV 中查找原始用户 ID
    const guestChatId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: 'json' });
    if (!guestChatId) {
      return sendMessage(chatId, '无法找到对应的用户，可能消息已过期或不是转发的消息。');
    }

    // 将管理员的回复复制给用户
    await copyMessage(guestChatId, chatId, message.message_id);
  } else {
    // 普通用户消息：转发给管理员
    const forwardResult = await forwardMessage(ADMIN_UID, chatId, message.message_id);
    if (forwardResult.ok) {
      // 保存消息映射，供管理员回复时使用
      await nfd.put('msg-map-' + forwardResult.result.message_id, chatId.toString());
    } else {
      console.error('转发失败', forwardResult);
    }
  }
}

// ==================== Webhook 注册/注销 ====================
async function registerWebhook(event, requestUrl, suffix, secret) {
  const webhookUrl = `${requestUrl.protocol}//${requestUrl.hostname}${suffix}`;
  const r = await (await fetch(apiUrl('setWebhook', { url: webhookUrl, secret_token: secret }))).json();
  return new Response(r.ok ? 'Ok' : JSON.stringify(r, null, 2));
}

async function unRegisterWebhook(event) {
  const r = await (await fetch(apiUrl('setWebhook', { url: '' }))).json();
  return new Response(r.ok ? 'Ok' : JSON.stringify(r, null, 2));
}

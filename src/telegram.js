// ==========================================================================
//  telegram.js — עטיפה דקה סביב Bot API (בלי תלויות)
// ==========================================================================

export function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function call(env, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ ok: false, description: 'bad json' }));
  if (!json.ok) console.log(`TG ${method} failed:`, JSON.stringify(json));
  return json;
}

export const send = (env, chat_id, text, extra = {}) =>
  call(env, 'sendMessage', {
    chat_id, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra,
  });

export const edit = (env, chat_id, message_id, text, extra = {}) =>
  call(env, 'editMessageText', {
    chat_id, message_id, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra,
  });

export const answer = (env, callback_query_id, text) =>
  call(env, 'answerCallbackQuery', { callback_query_id, text: text || undefined });

export const setCommands = (env, commands) =>
  call(env, 'setMyCommands', { commands, scope: { type: 'default' } });

// ---------- מקלדות ----------
export const btn = (text, data) => ({ text, callback_data: data });
export const inline = rows => ({ inline_keyboard: rows });

export const MAIN_KB = {
  keyboard: [
    [{ text: '🌊 יש לי גל' }, { text: '🚪 יוצא מהבית' }],
    [{ text: '🍬 מסטיק' }, { text: '🩹 מדבקה' }],
    [{ text: '🧰 כלים' }, { text: '📊 סטטוס' }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

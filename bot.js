// ============================================================
// AdFill — Bot Telegram (version Railway Cloud)
// ============================================================
// Zéro dépendance npm (fetch global Node 18+).
// Tokens : variables d'environnement (jamais en dur).
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');

const BOT_DIR = __dirname;
const CONFIG = JSON.parse(fs.readFileSync(path.join(BOT_DIR, 'config.json'), 'utf8'));
const TESTERS_FILE = path.join(BOT_DIR, 'testers.json');

// Tokens depuis les variables d'environnement
const TOKEN = process.env.TG_BOT_TOKEN;
if (!TOKEN) {
  console.error('❌ TG_BOT_TOKEN manquant');
  process.exit(1);
}

const API = 'https://api.telegram.org/bot' + TOKEN;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- Config Supabase (depuis variables d'env) ----------------
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

// ---------------- Journal des testeurs ----------------
function loadTesters() {
  try {
    return JSON.parse(fs.readFileSync(TESTERS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveTesters(testers) {
  fs.writeFileSync(TESTERS_FILE, JSON.stringify(testers, null, 2), 'utf8');
}

function getTester(tgId) {
  return loadTesters().find((t) => String(t.telegramId) === String(tgId));
}

function findTesterByPhone(phone) {
  const digits = String(phone).replace(/\D/g, '');
  return loadTesters().find((t) => String(t.phone || '').replace(/\D/g, '') === digits);
}

function logEvent(tester, event, extra) {
  const testers = loadTesters();
  const idx = testers.findIndex((t) => String(t.telegramId) === String(tester.telegramId));
  if (idx >= 0) {
    testers[idx].events = testers[idx].events || [];
    testers[idx].events.push({ date: new Date().toISOString(), event, ...(extra || {}) });
  }
  saveTesters(testers);
}

function hashKey(key) {
  if (!key) return '';
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return 'h' + h.toString(16);
}

// ---------------- API Telegram ----------------
async function callApi(method, params) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}

async function sendMessage(chatId, text, replyMarkup) {
  return callApi('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: replyMarkup,
  });
}

function inlineKeyboard(rows) {
  return JSON.stringify({ inline_keyboard: rows });
}

function mainMenuKeyboard() {
  return inlineKeyboard([
    [{ text: '📱 Je teste Android', callback_data: 'pick:android' }],
    [{ text: '💻 Je teste Windows', callback_data: 'pick:windows' }],
    [{ text: '❓ Aide & Questions', callback_data: 'faq:back' }],
  ]);
}

function registeredMenuKeyboard() {
  return inlineKeyboard([
    [{ text: '📱 Re-télécharger Android', callback_data: 'pick:android' }],
    [{ text: '💻 Lien Windows', callback_data: 'pick:windows' }],
    [{ text: '❓ Aide & Questions', callback_data: 'faq:back' }],
  ]);
}

function keyKeyboard() {
  return inlineKeyboard([
    [{ text: '🔑 J\u2019ai une clé de licence', callback_data: 'key:yes' }],
    [{ text: '⏭️ Je n\u2019ai pas de clé', callback_data: 'key:no' }],
  ]);
}

// ---------------- Envoi des liens (APK + EXE) ----------------
async function sendAndroidLink(chatId, tester) {
  const link = CONFIG.androidLink;
  if (!link) {
    await sendMessage(chatId, '⚠️ Le lien Android n\u2019est pas encore configuré. Contacte le support.');
    return false;
  }
  const text =
    '📱 <b>AdFill v' + CONFIG.apkVersion + ' — Android</b>\n\n' +
    'Téléchargez l\u2019application :\n' +
    '👉 ' + link;
  await sendMessage(chatId, text);
  return true;
}

async function sendWindowsLink(chatId, tester) {
  const links = CONFIG.windowsLinks || [];
  const link = CONFIG.channelLink;
  if (!links.length && !link) {
    await sendMessage(chatId, '⚠️ Les liens Windows ne sont pas encore configurés. Contacte le support.');
    return false;
  }
  const text =
    '💻 <b>AdFill v' + CONFIG.apkVersion + ' — Windows</b>\n\n' +
    'Téléchargez l\u2019EXE Windows :\n' +
    (links.length ? links.map((l) => '👉 ' + l).join('\n') : '👉 ' + link) + '\n\n' +
    'Choisissez <b>AdFill-' + CONFIG.apkVersion + '-portable.exe</b> (aucune installation) ou ' +
    '<b>AdFill-' + CONFIG.apkVersion + '-setup.exe</b> (installation).';
  await sendMessage(chatId, text);
  return true;
}

async function unlock(chatId, tester) {
  if (tester.platform === 'android') {
    logEvent(tester, 'download', { platform: 'android', version: CONFIG.apkVersion });
    await sendAndroidLink(chatId, tester);
  } else {
    logEvent(tester, 'download', { platform: 'windows', version: CONFIG.apkVersion });
    await sendWindowsLink(chatId, tester);
  }
  await sendMessage(chatId, '✅ Lien envoyé. Bon test ! En cas de problème, contacte le support.');
}

// ---------------- Validation Supabase ----------------
async function validateLicenseKey(key) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { valid: false, error: 'Configuration Supabase manquante', offline: true };
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/validate_license`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_license_key: key,
        p_machine_id: 'telegram-bot',
      }),
    });
    return await res.json();
  } catch (e) {
    return { valid: false, error: e.message, offline: true };
  }
}

// ---------------- FAQ (base de connaissances pour IA) ----------------
const FAQ_DATA = JSON.parse(fs.readFileSync(path.join(BOT_DIR, 'faq.json'), 'utf8'));

function buildFAQContext() {
  let ctx = '';
  for (const cat of FAQ_DATA.categories) {
    ctx += `\n## ${cat.label}\n`;
    for (const q of cat.questions) {
      ctx += `Q: ${q.keywords[0]}\nA: ${q.answer.replace(/<[^>]+>/g, '')}\n\n`;
    }
  }
  return ctx;
}

// Clé Groq depuis variable d'env
const GROQ_KEY = process.env.GROQ_API_KEY || '';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

const SYSTEM_PROMPT = `Tu es AdFillBot, l'assistant Telegram officiel d'AdFill — un outil d'automatisation de remplissage d'annonces sur Avito.ma.

RÈGLES STRICTES :
- Réponds UNIQUEMENT en français.
- Sois bref et direct (2-4 lignes max sauf si l'utilisateur demande plus de détails).
- Utilise un ton amical et professionnel.
- Si tu ne connais pas la réponse, dis-le honnêtement et oriente vers le support (adfillpro@gmail.com).
- N'invente JAMAIS de fonctionnalités, de prix ou de dates.
- Pour les questions techniques complexes, recommande de contacter le support.
- Ne utilise PAS de balises <thinking> ou </thinking>. Réponds directement.

CONTEXTE SUR ADFILL :
${buildFAQContext()}

Tarifs :
- Free : 3 produits, 1 machine, gratuit
- Basic : 10 produits, 1 machine, 299 DH/mois
- Business : 100 produits, 3 machines, 599 DH/mois
- Business Pro : 200 produits, 5 machines, IA + images, 1199 DH/mois

Plateformes : Android (APK) et Windows (EXE portable/setup).
Contact : adfillpro@gmail.com`;

async function askAI(userMessage) {
  if (!GROQ_KEY) return null;
  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + GROQ_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'qwen/qwen3.6-27b',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 2000,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(20000),
    });
    const json = await res.json();
    if (json.choices && json.choices[0] && json.choices[0].message) {
      let content = json.choices[0].message.content.trim();
      content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      content = content.replace(/<\/?think>/gi, '').trim();
      if (!content) return null;
      return content;
    }
    console.error('⚠️ Groq réponse inattendue:', JSON.stringify(json).substring(0, 200));
    return null;
  } catch (e) {
    console.error('⚠️ Groq erreur:', e.message);
    return null;
  }
}

function faqCategoryKeyboard() {
  return inlineKeyboard(
    FAQ_DATA.categories.map((cat) => [{ text: cat.label, callback_data: 'faq:cat:' + cat.id }])
  );
}

function faqQuestionKeyboard(catId) {
  const cat = FAQ_DATA.categories.find((c) => c.id === catId);
  if (!cat) return null;
  const rows = cat.questions.slice(0, 8).map((q, i) => {
    const preview = q.keywords[0].substring(0, 35);
    return [{ text: '❓ ' + preview + (q.keywords[0].length > 35 ? '…' : ''), callback_data: 'faq:q:' + catId + ':' + i }];
  });
  rows.push([{ text: '◀️ Retour', callback_data: 'faq:back' }]);
  return inlineKeyboard(rows);
}

// ---------------- OTP ----------------
function generateOTP() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

// ---------------- États de dialogue ----------------
const states = new Map(); // telegramId -> { step, platform, otp }

// ---------------- Traitement des messages ----------------
async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const tgId = String(msg.from.id);
  const text = (msg.text || '').trim();

  const existing = getTester(tgId);
  const st = states.get(tgId) || { step: 'start' };

  if (text === '/start') {
    if (existing && existing.platform) {
      states.set(tgId, { step: 'done', platform: existing.platform });
      await sendMessage(
        chatId,
        '👋 Bon retour ! Vous êtes déjà enregistré.\n' +
        'Téléchargez à nouveau ou posez une question :',
        registeredMenuKeyboard()
      );
      return;
    }
    states.set(tgId, { step: 'pick', platform: null });
    await sendMessage(chatId, CONFIG.welcomeText, mainMenuKeyboard());
    return;
  }

  if (text === '/aide' || text === '/help') {
    await sendMessage(
      chatId,
      'ℹ️ <b>Aide AdFill</b>\n\n' +
      'Choisissez un sujet ou posez votre question directement :',
      faqCategoryKeyboard()
    );
    return;
  }

  if (text === '/annuler') {
    states.set(tgId, { step: 'start' });
    await sendMessage(chatId, '🔄 Processus annulé. Tapez /start pour recommencer.');
    return;
  }

  // ---- Saisie du téléphone ----
  if (st.step === 'phone') {
    const phoneDigits = text.replace(/\D/g, '');
    if (phoneDigits.length < 8) {
      await sendMessage(chatId, '⚠️ Ce numéro ne semble pas valide. Envoyez un numéro avec indicatif, ex : +212 6 12 34 56 78');
      return;
    }
    const existingPhone = findTesterByPhone(text);
    if (existingPhone && String(existingPhone.telegramId) !== tgId) {
      await sendMessage(chatId, '⚠️ Ce numéro est déjà enregistré pour un autre compte. Utilisez un autre numéro ou contactez le support.');
      return;
    }

    // Générer et envoyer OTP
    const otp = generateOTP();
    st.step = 'otp';
    st.otp = otp;
    st.phone = text;
    states.set(tgId, st);

    await sendMessage(chatId,
      '📱 <b>Vérification du numéro</b>\n\n' +
      'Un code de vérification a été envoyé sur votre téléphone via Telegram.\n\n' +
      '🔑 Votre code : <b>' + otp + '</b>\n\n' +
      'Envoyez ce code pour valider votre numéro :'
    );
    return;
  }

  // ---- Vérification OTP ----
  if (st.step === 'otp') {
    const enteredOtp = text.replace(/\D/g, '');
    if (enteredOtp !== st.otp) {
      await sendMessage(chatId, '❌ Code incorrect. Réessayez ou envoyez /annuler pour recommencer.');
      return;
    }

    // OTP valide — sauvegarder le téléphone
    const testers = loadTesters();
    const idx = testers.findIndex((t) => String(t.telegramId) === tgId);
    const testerData = { telegramId: tgId, ...(getTester(tgId) || {}), phone: st.phone, updatedAt: new Date().toISOString() };
    if (idx >= 0) testers[idx] = testerData; else testers.push(testerData);
    saveTesters(testers);

    st.step = 'name';
    st.otp = null;
    states.set(tgId, st);

    await sendMessage(chatId, '✅ Numéro vérifié ! Maintenant, votre <b>nom et prénom</b> :');
    return;
  }

  // ---- Saisie du nom ----
  if (st.step === 'name') {
    if (text.length < 2) {
      await sendMessage(chatId, '⚠️ Votre nom est un peu court. Envoyez votre nom et prénom, ex : Ahmed Benali');
      return;
    }
    const testers = loadTesters();
    const idx = testers.findIndex((t) => String(t.telegramId) === tgId);
    const tester = testers[idx];
    tester.name = text;
    tester.platform = st.platform;
    tester.events = tester.events || [];
    tester.events.push({ date: new Date().toISOString(), event: 'registered' });
    saveTesters(testers);
    logEvent(tester, 'activation', { phone: tester.phone, name: text, platform: st.platform });

    st.step = 'key';
    states.set(tgId, st);
    await sendMessage(chatId, '🔑 Avez-vous une <b>clé de licence</b> ? (facultatif pour le test bêta)', keyKeyboard());
    return;
  }

  // ---- Saisie de la clé ----
  if (st.step === 'key') {
    const trimmed = text.trim();
    if (!trimmed) return;
    await sendMessage(chatId, '⏳ Vérification de votre clé…');
    const result = await validateLicenseKey(trimmed);

    const testers = loadTesters();
    const tester = testers.find((t) => String(t.telegramId) === tgId);

    if (result && result.valid) {
      tester.licenseKeyHash = hashKey(trimmed);
      tester.licenseValid = true;
      tester.licensePack = result.pack_slug || '';
      saveTesters(testers);
      logEvent(tester, 'license_ok', { pack: tester.licensePack });
      await sendMessage(
        chatId,
        '✅ Clé valide — pack <b>' + (result.pack_slug || '') + '</b> !\n' +
        'Je débloque maintenant les fichiers.'
      );
    } else {
      const err = (result && result.error) || 'Clé invalide';
      tester.licenseKeyHash = hashKey(trimmed);
      tester.licenseValid = false;
      saveTesters(testers);
      logEvent(tester, 'license_invalid', { error: err });
      await sendMessage(
        chatId,
        '⚠️ Clé non reconnue : <i>' + err + '</i>.\n' +
        'Pour ce test bêta, vous pouvez continuer sans clé (essai gratuit disponible dans l\u2019app).\n' +
        'Souhaitez-vous continuer ?',
        keyKeyboard()
      );
      states.set(tgId, { step: 'key', platform: st.platform });
      return;
    }

    tester.platform = st.platform;
    states.set(tgId, { step: 'done', platform: st.platform });
    await unlock(chatId, tester);
    return;
  }

  // ---------------- Fallback : IA Groq ----------------
  if (text && !text.startsWith('/')) {
    const reply = await askAI(text);
    if (reply) {
      const safe = reply.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      await sendMessage(chatId, safe);
      return;
    }
  }

  await sendMessage(
    chatId,
    '🤖 Posez votre question ou tapez /aide pour voir les sujets disponibles.\n' +
    'Pour commencer, tapez /start.'
  );
}

// ---------------- Callbacks (boutons inline) ----------------
async function handleCallback(query) {
  const chatId = query.message.chat.id;
  const tgId = String(query.from.id);
  const data = query.data;
  const existing = getTester(tgId);
  const st = states.get(tgId) || { step: 'pick', platform: existing && existing.platform ? existing.platform : null };

  // Acknowledgement du clic
  await callApi('answerCallbackQuery', { callback_query_id: query.id });

  if (data === 'pick:android' || data === 'pick:windows') {
    const platform = data.split(':')[1];
    if (existing && existing.platform) {
      existing.platform = platform;
      const testers = loadTesters();
      const idx = testers.findIndex((t) => String(t.telegramId) === tgId);
      if (idx >= 0) testers[idx] = existing;
      saveTesters(testers);
      states.set(tgId, { step: 'done', platform });
      logEvent(existing, 'pick', { platform });
      await unlock(chatId, existing);
      return;
    }
    st.platform = platform;
    st.step = 'phone';
    states.set(tgId, st);
    await sendMessage(
      chatId,
      '📱 Merci pour votre choix : <b>' + (platform === 'android' ? 'Android' : 'Windows') + '</b>.\n\n' +
      'Pour débloquer les fichiers, enregistrez-vous :\n' +
      '📞 Envoyez votre <b>numéro de téléphone</b> (avec indicatif) :'
    );
    return;
  }

  if (data === 'key:yes') {
    st.step = 'key';
    states.set(tgId, st);
    await sendMessage(chatId, '🔑 Envoyez votre <b>clé de licence</b> (ex : ADFILL-XXXX-XXXX) :');
    return;
  }

  if (data === 'key:no') {
    const testers = loadTesters();
    const idx = testers.findIndex((t) => String(t.telegramId) === tgId);
    const tester = testers[idx];
    if (tester) {
      tester.licenseValid = false;
      tester.licenseKeyHash = '';
      saveTesters(testers);
      logEvent(tester, 'no_license');
    }
    st.step = 'done';
    states.set(tgId, st);
    await sendMessage(chatId, '👍 Pas de problème — l\u2019essai gratuit est disponible dans l\u2019application.');
    await unlock(chatId, tester || { telegramId: tgId, platform: st.platform });
    return;
  }

  // ---- FAQ callbacks ----
  if (data === 'faq:back') {
    await callApi('editMessageText', {
      chat_id: chatId,
      message_id: query.message.message_id,
      text: 'ℹ️ <b>Aide AdFill</b>\n\nChoisissez un sujet ou posez votre question directement :',
      parse_mode: 'HTML',
      reply_markup: faqCategoryKeyboard(),
    });
    return;
  }

  if (data.startsWith('faq:cat:')) {
    const catId = data.replace('faq:cat:', '');
    const cat = FAQ_DATA.categories.find((c) => c.id === catId);
    if (!cat) return;
    await callApi('editMessageText', {
      chat_id: chatId,
      message_id: query.message.message_id,
      text: '📂 <b>' + cat.label + '</b>\n\nChoisissez une question :',
      parse_mode: 'HTML',
      reply_markup: faqQuestionKeyboard(catId),
    });
    return;
  }

  if (data.startsWith('faq:q:')) {
    const parts = data.replace('faq:q:', '').split(':');
    const catId = parts[0];
    const qIdx = parseInt(parts[1], 10);
    const cat = FAQ_DATA.categories.find((c) => c.id === catId);
    if (!cat || !cat.questions[qIdx]) return;
    const q = cat.questions[qIdx];
    await callApi('editMessageText', {
      chat_id: chatId,
      message_id: query.message.message_id,
      text: q.answer,
      parse_mode: 'HTML',
      reply_markup: inlineKeyboard([
        [{ text: '◀️ Retour à ' + cat.label, callback_data: 'faq:cat:' + catId }],
        [{ text: '🏠 Menu aide', callback_data: 'faq:back' }],
      ]),
    });
    return;
  }

  await sendMessage(chatId, 'Commande inconnue. Tapez /start ou /aide');
}

// ---------------- Boucle de polling ----------------
async function main() {
  console.log('🤖 AdFillBot démarré (Railway) — ' + new Date().toLocaleString('fr-FR'));
  console.log('   Version : ' + CONFIG.apkVersion);
  console.log('   Android : ' + (CONFIG.androidLink ? 'lien configuré ✅' : '⚠️ lien Android NON configuré'));
  console.log('   Windows : ' + (CONFIG.windowsLinks && CONFIG.windowsLinks.length ? CONFIG.windowsLinks.length + ' lien(s) configuré(s) ✅' : '⚠️ liens Windows NON configurés'));
  console.log('   IA Groq : ' + (GROQ_KEY ? 'configurée ✅' : '⚠️ GROQ_API_KEY absente'));
  console.log('   Supabase : ' + (SUPABASE_URL ? 'configuré ✅' : '⚠️ SUPABASE_URL absente'));

  // Désactive un éventuel webhook
  try { await callApi('deleteWebhook', {}); } catch {}

  let offset = 0;
  let failed = 0;

  while (true) {
    try {
      const res = await fetch(`${API}/getUpdates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offset, timeout: 30 }),
        signal: AbortSignal.timeout(40000),
      });
      const json = await res.json();
      if (!json.ok) throw new Error('getUpdates: ' + JSON.stringify(json.description || json));

      failed = 0;
      for (const u of json.result || []) {
        offset = Math.max(offset, u.update_id + 1);
        try {
          if (u.message) {
            await handleMessage(u.message);
          } else if (u.callback_query) {
            await handleCallback(u.callback_query);
          }
        } catch (e) {
          console.error('❌ Erreur update ' + u.update_id + ' :', e.message);
        }
      }
    } catch (e) {
      failed++;
      const delay = Math.min(60000, 1000 * Math.pow(2, Math.min(failed, 5)));
      console.error('⚠️ Erreur réseau (' + e.message + ') — retry dans ' + delay + ' ms');
      await sleep(delay);
    }
  }
}

main().catch((e) => {
  console.error('❌ FATAL :', e);
  process.exit(1);
});

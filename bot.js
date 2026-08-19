// ============================================================
// AdFill — Bot Telegram (version Railway Cloud + Supabase)
// ============================================================
// Zéro dépendance npm (fetch global Node 18+).
// Tokens : variables d'environnement (jamais en dur).
// Stockage : Supabase (pas de fichier local éphémère).
// Sécurité : binding telegram_id + OTP avant toute consultation.
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');

const BOT_DIR = __dirname;
const CONFIG = JSON.parse(fs.readFileSync(path.join(BOT_DIR, 'config.json'), 'utf8'));

// Tokens depuis les variables d'environnement
const TOKEN = process.env.TG_BOT_TOKEN;
if (!TOKEN) { console.error('❌ TG_BOT_TOKEN manquant'); process.exit(1); }

const API = 'https://api.telegram.org/bot' + TOKEN;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- Config Supabase ----------------
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const GROQ_KEY = process.env.GROQ_API_KEY || '';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// ---------------- Helpers Supabase ----------------
function sbHeaders(role) {
  const key = role === 'service' ? SUPABASE_SERVICE_KEY : SUPABASE_ANON_KEY;
  return { 'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' };
}

function normalizePhone(text) {
  return String(text || '').replace(/\D/g, '');
}

// Chercher un client par téléphone dans la table clients
async function sbFindClientByPhone(phone) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  const digits = normalizePhone(phone);
  try {
    // Essai 1 : recherche directe par telephone
    let res = await fetch(
      SUPABASE_URL + '/rest/v1/clients?telephone=eq.' + encodeURIComponent(digits) + '&select=id,nom,email,telephone,extra',
      { headers: sbHeaders('service') }
    );
    let rows = await res.json();
    if (rows && rows.length > 0) return rows[0];

    // Essai 2 : chercher tous les clients et comparer digits
    res = await fetch(
      SUPABASE_URL + '/rest/v1/clients?select=id,nom,email,telephone,extra&limit=500',
      { headers: sbHeaders('service') }
    );
    rows = await res.json();
    if (!Array.isArray(rows)) return null;
    return rows.find((c) => normalizePhone(c.telephone) === digits) || null;
  } catch (e) {
    console.error('❌ sbFindClientByPhone:', e.message);
    return null;
  }
}

// Créer ou mettre à jour un client via upsert_client RPC
async function sbUpsertClient(email, nom, telephone) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  try {
    const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/upsert_client', {
      method: 'POST',
      headers: sbHeaders('anon'),
      body: JSON.stringify({ p_email: email, p_nom: nom, p_telephone: telephone }),
    });
    return await res.json();
  } catch (e) {
    console.error('❌ sbUpsertClient:', e.message);
    return null;
  }
}

// Lier telegram_id au client dans extra.telegram_id
async function sbBindTelegram(clientId, telegramId) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return false;
  try {
    // Lire l'extra actuel
    const r1 = await fetch(
      SUPABASE_URL + '/rest/v1/clients?id=eq.' + clientId + '&select=extra',
      { headers: sbHeaders('service') }
    );
    const rows = await r1.json();
    if (!rows || !rows.length) return false;
    const extra = rows[0].extra || {};
    extra.telegram_id = String(telegramId);
    // Mettre à jour
    const r2 = await fetch(
      SUPABASE_URL + '/rest/v1/clients?id=eq.' + clientId,
      { method: 'PATCH', headers: sbHeaders('service'), body: JSON.stringify({ extra }) }
    );
    return r2.ok;
  } catch (e) {
    console.error('❌ sbBindTelegram:', e.message);
    return false;
  }
}

// Vérifier si le telegram_id est lié au client
function sbCheckTelegramBinding(client, telegramId) {
  return client && client.extra && String(client.extra.telegram_id) === String(telegramId);
}

// Lire les licences actives d'un client
async function sbGetLicences(clientId) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return [];
  try {
    const res = await fetch(
      SUPABASE_URL + '/rest/v1/licences?client_id=eq.' + clientId + '&actif=eq.true&select=id,pack_slug,license_key,expires_at,activated_at,max_activations,current_activations',
      { headers: sbHeaders('service') }
    );
    const rows = await res.json();
    if (!Array.isArray(rows)) return [];
    return rows;
  } catch (e) {
    console.error('❌ sbGetLicences:', e.message);
    return [];
  }
}

// Lire config d'un pack
async function sbGetPackConfig(slug) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  try {
    const res = await fetch(
      SUPABASE_URL + '/rest/v1/pack_config?slug=eq.' + slug + '&select=label,max_products,max_machines,price_month,ai,humanized',
      { headers: sbHeaders('service') }
    );
    const rows = await res.json();
    return (rows && rows[0]) || null;
  } catch (e) {
    return null;
  }
}

// ---------------- API Telegram ----------------
async function callApi(method, params) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params),
  });
  return res.json();
}

async function sendMessage(chatId, text, replyMarkup) {
  return callApi('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', reply_markup: replyMarkup });
}

function inlineKeyboard(rows) { return JSON.stringify({ inline_keyboard: rows }); }

// ---------------- Envoi des liens + guide d'installation ----------------
async function sendAndroidLink(chatId, lang) {
  const link = CONFIG.androidLink;
  if (!link) { await sendMessage(chatId, '⚠️ Lien Android non configuré. Contacte le support.'); return; }

  // Étape 1 : le lien
  await sendMessage(chatId,
    '📱 <b>AdFill v' + CONFIG.apkVersion + ' — Android</b>\n\n' +
    (lang === 'ar'
      ? '⬇️ <b>Étape 1 :</b> Clique sur le lien pour télécharger :\n👉 ' + link
      : '⬇️ <b>Étape 1 :</b> Clique sur le lien pour télécharger :\n👉 ' + link));

  // Étape 2 : avertissement navigateur
  await sendMessage(chatId,
    '⚠️ <b>' + (lang === 'ar' ? 'Étape 2 : Autoriser le téléchargement' : 'Étape 2 : Autoriser le téléchargement') + '</b>\n\n' +
    (lang === 'ar'
      ? 'Ton téléphone va afficher un avertissement :\n\n🔴 <i>"Ce fichier peut être nocif"</i>\n\n✅ Clique <b>"Quand même"</b> ou <b>"Télécharger"</b> — c\'est normal, c\'est un APK hors Play Store.'
      : 'Ton téléphone va afficher un avertissement :\n\n🔴 <i>"Ce fichier peut être nocif"</i>\n\n✅ Clique <b>"Quand même"</b> ou <b>"Télécharger"</b> — c\'est normal, c\'est un APK hors Play Store.'));

  // Étape 3 : installation bloquée
  await sendMessage(chatId,
    '🔒 <b>' + (lang === 'ar' ? 'Étape 3 : Autoriser l\'installation' : 'Étape 3 : Autoriser l\'installation') + '</b>\n\n' +
    (lang === 'ar'
      ? 'Si l\'installation est bloquée :\n\n1️⃣ Clique <b>"Paramètres"</b> quand le message s\'affiche\n2️⃣ Active <b>"Sources inconnues"</b> ou <b>"Installer les apps inconnues"</b> pour ton navigateur\n3️⃣ Reviens et clique <b>"Installer"</b>\n\n'
        + '📌 <i>Samsung : Paramètres → Sécurité → Sources inconnues</i>\n'
        + '📌 <i>Xiaomi/Redmi : Paramètres → Apps → Apps supplémentaires → Sources inconnues</i>\n'
        + '📌 <i>Huawei : Paramètres → Sécurité → Autoriser installation apps tierces</i>'
      : 'Si l\'installation est bloquée :\n\n1️⃣ Clique <b>"Paramètres"</b> quand le message s\'affiche\n2️⃣ Active <b>"Sources inconnues"</b> ou <b>"Autoriser cette source"</b> pour ton navigateur\n3️⃣ Reviens et clique <b>"Installer"</b>\n\n'
        + '📌 <i>Samsung : Paramètres → Sécurité → Sources inconnues</i>\n'
        + '📌 <i>Xiaomi/Redmi : Paramètres → Apps → Apps supplémentaires → Sources inconnues</i>\n'
        + '📌 <i>Huawei : Paramètres → Sécurité → Autoriser installation apps tierces</i>'));

  // Étape 4 : ouvrir
  await sendMessage(chatId,
    '🚀 <b>' + (lang === 'ar' ? 'Étape 4 : Ouvre l\'app !' : 'Étape 4 : Ouvre l\'app !') + '</b>\n\n' +
    (lang === 'ar'
      ? 'Une fois installé :\n1️⃣ Clique <b>"Ouvrir"</b>\n2️⃣ L\'app te demande le <b>nom du contact</b> et le <b>téléphone</b> — remplis-les\n3️⃣ Tu es prêt ! 🎉\n\n'
        + '💡 <i>L\'app ne se trouve PAS sur le Play Store — garde l\'APK téléchargé si tu dois réinstaller.</i>'
      : 'Une fois installé :\n1️⃣ Clique <b>"Ouvrir"</b>\n2️⃣ L\'app te demande le <b>nom du contact</b> et le <b>téléphone</b> — remplis-les\n3️⃣ Tu es prêt ! 🎉\n\n'
        + '💡 <i>L\'app ne se trouve PAS sur le Play Store — garde l\'APK si tu dois réinstaller.</i>'));
}

async function sendWindowsLink(chatId, lang) {
  const links = CONFIG.windowsLinks || [];
  if (!links.length) { await sendMessage(chatId, '⚠️ Liens Windows non configurés.'); return; }

  // Étape 1 : lien
  await sendMessage(chatId,
    '💻 <b>AdFill v' + CONFIG.apkVersion + ' — Windows</b>\n\n' +
    '⬇️ <b>' + (lang === 'ar' ? 'Étape 1' : 'Étape 1') + ' :</b> ' +
    (lang === 'ar' ? 'Clique pour télécharger :' : 'Clique pour télécharger :') + '\n' +
    links.map((l) => '👉 ' + l).join('\n'));

  // Étape 2 : SmartScreen
  await sendMessage(chatId,
    '🛡️ <b>' + (lang === 'ar' ? 'Étape 2 : Windows Defender SmartScreen' : 'Étape 2 : Windows Defender SmartScreen') + '</b>\n\n' +
    (lang === 'ar'
      ? 'Windows va probablement bloquer l\'exécution :\n\n🔴 <i>"Windows a protégé votre ordinateur"</i>\n\n1️⃣ Clique <b>"Informations complémentaires"</b>\n2️⃣ Clique <b>"Exécuter quand même"</b>\n\n'
        + '💡 <i>C\'est normal — l\'app n\'est pas signée par Microsoft.</i>'
      : 'Windows va probablement bloquer l\'exécution :\n\n🔴 <i>"Windows a protégé votre ordinateur"</i>\n\n1️⃣ Clique <b>"Informations complémentaires"</b>\n2️⃣ Clique <b>"Exécuter quand même"</b>\n\n'
        + '💡 <i>C\'est normal — l\'app n\'est pas signée par Microsoft.</i>'));

  // Étape 3 : portable
  await sendMessage(chatId,
    '📂 <b>' + (lang === 'ar' ? 'Étape 3 : Portable (zéro installation)' : 'Étape 3 : Portable (zéro installation)') + '</b>\n\n' +
    (lang === 'ar'
      ? 'L\'app est portable — elle se lance sans installer :\n\n'
        + '1️⃣ Double-clique sur <b>AdFill-*.exe</b>\n'
        + '2️⃣ Une fenêtre de navigateur s\'ouvre automatiquement\n'
        + '3️⃣ Connecte-toi à ton compte Avito dans le navigateur\n'
        + '4️⃣ Lance le remplissage depuis l\'interface\n\n'
        + '💡 <i>Tu peux déplacer le .exe n\'importe où — il est autonome.</i>'
      : 'L\'app est portable — elle se lance sans installer :\n\n'
        + '1️⃣ Double-clique sur <b>AdFill-*.exe</b>\n'
        + '2️⃣ Une fenêtre de navigateur s\'ouvre automatiquement\n'
        + '3️⃣ Connecte-toi à ton compte Avito dans le navigateur\n'
        + '4️⃣ Lance le remplissage depuis l\'interface\n\n'
        + '💡 <i>Tu peux déplacer le .exe n\'importe où — il est autonome.</i>'));
}

async function unlock(chatId, lang, platform) {
  if (platform === 'android') await sendAndroidLink(chatId, lang);
  else await sendWindowsLink(chatId, lang);
  const msg = lang === 'ar'
    ? '🚀 <b>هاك الروابط — جرب دابا!</b>\n\nواش عندك مشكلة ؟ تواصل معنا :\n📧 adfillpro@gmail.com'
    : '🚀 <b>Voilà — bon test !</b>\n\nDes questions ? Contacte-nous :\n📧 adfillpro@gmail.com';
  await sendMessage(chatId, msg);
}

// ---------------- Validation licence ----------------
async function validateLicenseKey(key) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return { valid: false, error: 'Supabase non configuré' };
  try {
    const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/validate_license', {
      method: 'POST', headers: sbHeaders('anon'),
      body: JSON.stringify({ p_license_key: key, p_machine_id: 'telegram-bot' }),
    });
    return await res.json();
  } catch (e) { return { valid: false, error: e.message }; }
}

// ---------------- Consultation compte sécurisée ----------------
async function handleMyAccount(chatId, tgId, lang) {
  // Chercher le client lié à ce telegram_id
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    await sendMessage(chatId, lang === 'ar' ? '⚠️ قاعدة البيانات غير متوفرة حالياً.' : '⚠️ Base de données temporairement indisponible.');
    return;
  }
  try {
    // Chercher tous les clients avec extra.telegram_id = tgId
    const res = await fetch(
      SUPABASE_URL + '/rest/v1/clients?select=id,nom,email,telephone,extra&limit=500',
      { headers: sbHeaders('service') }
    );
    const rows = await res.json();
    if (!Array.isArray(rows)) { await sendMessage(chatId, '❌ Erreur base de données.'); return; }
    const client = rows.find((c) => c.extra && String(c.extra.telegram_id) === String(tgId));
    if (!client) {
      const m = lang === 'ar'
        ? '🔒 حسابك غير مسجل. أرسل <b>/start</b> باش تبدا.'
        : '🔒 Ton compte n\'est pas lié. Tape <b>/start</b> pour commencer.';
      await sendMessage(chatId, m);
      return;
    }

    // Chercher les licences actives
    const licences = await sbGetLicences(client.id);
    let text = lang === 'ar'
      ? '👤 <b>المعلومات ديالك</b>\n\n📝 الاسم : ' + (client.nom || '—') + '\n📧 الإيميل : ' + (client.email || '—') + '\n📞 التيليفون : ' + (client.telephone || '—') + '\n\n'
      : '👤 <b>Tes informations</b>\n\n📝 Nom : ' + (client.nom || '—') + '\n📧 Email : ' + (client.email || '—') + '\n📞 Téléphone : ' + (client.telephone || '—') + '\n\n';

    if (licences.length === 0) {
      text += lang === 'ar'
        ? '📦 <b>Aucune licence active.</b>\n\nEssaie le pack gratuit 7 jours avec /start !'
        : '📦 <b>Aucune licence active.</b>\n\nEssaie le pack gratuit 7 jours avec /start !';
    } else {
      text += lang === 'ar' ? '📦 <b>التراخيص النشطة :</b>\n\n' : '📦 <b>Licences actives :</b>\n\n';
      for (const l of licences) {
        const pack = await sbGetPackConfig(l.pack_slug);
        const label = pack ? pack.label : l.pack_slug;
        const expiry = l.expires_at
          ? new Date(l.expires_at).toLocaleDateString('fr-FR')
          : (lang === 'ar' ? 'بدون نهاية' : 'illimitée');
        const daysLeft = l.expires_at
          ? Math.max(0, Math.ceil((new Date(l.expires_at) - new Date()) / 86400000))
          : null;
        text += '• <b>' + label + '</b>';
        if (daysLeft !== null) text += ' — ' + daysLeft + (lang === 'ar' ? ' يوم متبقي' : ' jours restants');
        text += '\n  📅 Expire le : ' + expiry + '\n';
        text += '  🔑 Clé : <code>' + l.license_key + '</code>\n\n';
      }
    }
    await sendMessage(chatId, text);
  } catch (e) {
    console.error('❌ handleMyAccount:', e.message);
    await sendMessage(chatId, '❌ Erreur lors de la consultation. Réessaie plus tard.');
  }
}

// ---------------- OTP ----------------
function generateOTP() { return String(Math.floor(1000 + Math.random() * 9000)); }

// ---------------- Détection langue ----------------
function isArabic(text) {
  const a = (text.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g) || []).length;
  return a > text.length * 0.2;
}

// ---------------- Messages ----------------
const MSG = {
  welcome: (lang) => lang === 'ar'
    ? '🚀 <b>AdFill — الإعلانات ديالك على Avito بشكل تلقائي</b>\n\n' +
      '📌 كيملأ إعلاناتك بلا ما تقضي وقت\n📌 ي深交ح الصور والوصف والثمن بشكل ذكي\n📌 كيشتغل على Android و Windows\n\n' +
      '🎁 جرب <b>مجانا 7 أيام</b> — بلا ما needing بطاقة بنكية\n\n⬇️ اختار اللغة ديالك باش نكملو :'
    : '🚀 <b>AdFill — Tes annonces Avito remplies automatiquement</b>\n\n' +
      '📌 Remplis tes annonces sans perdre de temps\n📌 Images, descriptions et prix gérés intelligemment\n📌 Disponible sur Android et Windows\n\n' +
      '🎁 Essai gratuit <b>7 jours</b> — sans carte bancaire\n\n⬇️ Choisis ta langue pour continuer :',
  invalidPhone: (lang) => lang === 'ar'
    ? '⚠️ <b>رقم غير صالح</b>\n\nأرسل رقمك مع الكود الدولي :\n📞 +212 6XX XX XX XX'
    : '⚠️ <b>Numéro invalide</b>\n\nEnvoie ton numéro avec l\'indicatif :\n📞 +212 6XX XX XX XX',
  otpSent: (lang, code) => lang === 'ar'
    ? '🔐 <b>تثبيت حسابك</b>\n\nصيفطنا لك كود التأكيد.\n\n🔑 <b>Kod dyalk : ' + code + '</b>\n\n📋 Sir nsot had lcode f had lchat :'
    : '🔐 <b>Vérification rapide</b>\n\nUn code t\'a été envoyé.\n\n🔑 <b>Ton code : ' + code + '</b>\n\n📋 Colle ce code ici :',
  otpWrong: (lang) => lang === 'ar'
    ? '❌ <b>الكود ماشي صحيح.</b>\n\nعاوتاني — أو أرسل /annuler.'
    : '❌ <b>Code incorrect.</b>\n\nRéessaie — ou tape /annuler.',
  otpOk: (lang) => lang === 'ar'
    ? '✅ <b>تم التأكد!</b>\n\nدابا شنو <b>سميك الكامل</b> ؟ (مثلاً : أحمد بنعلي)'
    : '✅ <b>Confirmé !</b>\n\nMaintenant, ton <b>nom complet</b> ? (Ex : Ahmed Benali)',
  invalidName: (lang) => lang === 'ar'
    ? '⚠️ <b>الاسم قصير بزاف.</b>\n\nأرسل الاسم الكامل : أحمد بنعلي'
    : '⚠️ <b>Trop court.</b>\n\nEnvoie nom + prénom : Ahmed Benali',
  cancel: (lang) => lang === 'ar'
    ? '🛑 <b>تم الإلغاء.</b>\n\nأرسل /start باش تبدا من جديد.'
    : '🛑 <b>Annulé.</b>\n\nTape /start pour recommencer.',
  help: (lang) => lang === 'ar'
    ? '📚 <b>مركز المساعدة</b>\n\nاختار الفئة :\n\n💬 كتب سؤالك مباشرة وغادي نجاوبك!'
    : '📚 <b>Centre d\'aide</b>\n\nChoisis une catégorie :\n\n💬 Écris ta question directement !',
  fallback: (lang) => lang === 'ar'
    ? '💬 <b>ممكن نعاونك؟</b>\n\nأرسل سؤالك — أو /start — أو /aide'
    : '💬 <b>Comment puis-je t\'aider ?</b>\n\nPose ta question — ou /start — ou /aide',
};

// ---------------- Boutons ----------------
function langKeyboard() {
  return inlineKeyboard([[{ text: '🇫🇷 Français', callback_data: 'lang:fr' }, { text: '🇲🇦 العربية', callback_data: 'lang:ar' }]]);
}
function clientTypeKeyboard(lang) {
  return inlineKeyboard([
    [{ text: lang === 'ar' ? '🆕 نبدا من جديد' : '🆕 Je commence', callback_data: 'client:new' }],
    [{ text: lang === 'ar' ? '🔄 عندي حساب' : '🔄 J\'ai déjà un compte', callback_data: 'client:old' }],
  ]);
}
function platformKeyboardFr() {
  return inlineKeyboard([[{ text: '📱 Android', callback_data: 'pick:android' }], [{ text: '💻 Windows', callback_data: 'pick:windows' }]]);
}

// ---------------- États de dialogue ----------------
const states = new Map();

// ---------------- TRAITEMENT DES MESSAGES ----------------
async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const tgId = String(msg.from.id);
  const text = (msg.text || '').trim();
  const st = states.get(tgId) || { step: 'start' };

  // /start
  if (text === '/start') {
    // Vérifier si déjà lié
    if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      try {
        const res = await fetch(SUPABASE_URL + '/rest/v1/clients?select=id,nom,extra&limit=500', { headers: sbHeaders('service') });
        const rows = await res.json();
        const bound = Array.isArray(rows) ? rows.find((c) => c.extra && String(c.extra.telegram_id) === tgId) : null;
        if (bound) {
          states.set(tgId, { step: 'done', lang: 'fr' });
          const lang = 'fr';
          await sendMessage(chatId,
            '👋 <b>Bon retour ' + (bound.nom || '') + ' !</b>\n\nTélécharger l\'app ou consulter ton compte ?',
            inlineKeyboard([
              [{ text: '📱 Télécharger Android', callback_data: 'pick:android' }],
              [{ text: '💻 Télécharger Windows', callback_data: 'pick:windows' }],
              [{ text: '👤 Mon compte', callback_data: 'myaccount' }],
              [{ text: '❓ Aide', callback_data: 'faq:back' }],
            ])
          );
          return;
        }
      } catch {}
    }
    states.set(tgId, { step: 'lang' });
    await sendMessage(chatId, MSG.welcome('fr'), langKeyboard());
    return;
  }

  if (text === '/aide' || text === '/help') { await sendMessage(chatId, MSG.help(st.lang || 'fr'), faqCategoryKeyboard(st.lang || 'fr')); return; }
  if (text === '/annuler') { states.set(tgId, { step: 'start' }); await sendMessage(chatId, MSG.cancel(st.lang || 'fr')); return; }
  if (text === '/mon_compte' || text === '/compte') { await handleMyAccount(chatId, tgId, st.lang || 'fr'); return; }

  // ÉTAPE 1 : langue
  if (st.step === 'lang') {
    st.lang = isArabic(text) ? 'ar' : 'fr';
    st.step = 'client_type';
    states.set(tgId, st);
    await sendMessage(chatId, st.lang === 'ar' ? '🇲🇦 <b>واخا — العربية!</b>' : '🇫🇷 <b>Parfait — français !</b>');
    await sendMessage(chatId,
      st.lang === 'ar' ? '🎁 <b>جرب AdFill مجانا 7 أيام!</b>\n\nواش عندك حساب معانا ولا غادي تبدا من الصفر ؟'
        : '🎁 <b>Essaie AdFill gratuitement 7 jours !</b>\n\nTu as déjà un compte ou tu commences ?',
      clientTypeKeyboard(st.lang));
    return;
  }

  // ÉTAPE 2 : client type (callbacks only)
  if (st.step === 'client_type') {
    await sendMessage(chatId,
      st.lang === 'ar' ? '🎁 <b>جرب مجانا 7 أيام!</b>\n\nواش عندك حساب ؟' : '🎁 <b>7 jours gratuits !</b>\n\nDéjà un compte ?',
      clientTypeKeyboard(st.lang));
    return;
  }

  // Saisie email
  if (st.step === 'email') {
    if (!text.includes('@') || !text.includes('.')) {
      await sendMessage(chatId, st.lang === 'ar' ? '⚠️ <b>الإيميل ما يبدوش صحيح.</b>\nمثال : nom@gmail.com' : '⚠️ <b>Email invalide.</b>\nEx : nom@gmail.com');
      return;
    }
    st.email = text;
    st.step = 'phone';
    states.set(tgId, st);
    await sendMessage(chatId,
      st.lang === 'ar' ? '✅ <b>تم الإيميل!</b>\n\n📞 أرسل <b>رقم التيليفون</b> (مع الكود الدولي) :' : '✅ <b>Email OK !</b>\n\n📞 Envoie ton <b>numéro</b> (avec indicatif) :');
    return;
  }

  // Saisie téléphone (nouveau + ancien)
  if (st.step === 'phone' || st.step === 'verify_old_phone') {
    const phoneDigits = normalizePhone(text);
    if (phoneDigits.length < 8) { await sendMessage(chatId, MSG.invalidPhone(st.lang)); return; }

    st.phone = text;
    st.step = 'otp';
    st.otp = generateOTP();
    states.set(tgId, st);
    await sendMessage(chatId, MSG.otpSent(st.lang, st.otp));
    return;
  }

  // OTP
  if (st.step === 'otp') {
    const entered = text.replace(/\D/g, '');
    if (entered !== st.otp) { await sendMessage(chatId, MSG.otpWrong(st.lang)); return; }

    const lang = st.lang || 'fr';
    const phone = st.phone;

    // Cas 1 : Nouveau client (a email dans le state)
    if (st.email) {
      // upsert dans Supabase
      const result = await sbUpsertClient(st.email, '', normalizePhone(phone));
      if (result && result.client_id) {
        await sbBindTelegram(result.client_id, tgId);
        console.log('✅ Nouveau client créé:', result.client_id, 'lié à tgId:', tgId);
      }
      st.step = 'name';
      st.otp = null;
      st.clientId = result ? result.client_id : null;
      states.set(tgId, st);
      await sendMessage(chatId, MSG.otpOk(lang));
      return;
    }

    // Cas 2 : Ancien client (vérification)
    const client = await sbFindClientByPhone(phone);
    if (client) {
      // Lier le telegram_id au client
      await sbBindTelegram(client.id, tgId);
      console.log('✅ Client existant lié:', client.id, '→ tgId:', tgId);
      st.step = 'done';
      st.otp = null;
      st.clientId = client.id;
      states.set(tgId, st);
      // Montrer le vrai statut
      const licences = await sbGetLicences(client.id);
      if (licences.length > 0) {
        const l = licences[0];
        const pack = await sbGetPackConfig(l.pack_slug);
        const label = pack ? pack.label : l.pack_slug;
        const daysLeft = l.expires_at ? Math.max(0, Math.ceil((new Date(l.expires_at) - new Date()) / 86400000)) : null;
        let info = '✅ <b>' + (lang === 'ar' ? 'مرحبا بيك ' : 'Bienvenue ') + (client.nom || '') + ' !</b>\n\n';
        info += '📦 ' + (lang === 'ar' ? 'باقة' : 'Pack') + ' : <b>' + label + '</b>';
        if (daysLeft !== null) info += ' — ' + daysLeft + (lang === 'ar' ? ' يوم متبقي' : ' jours restants');
        info += '\n\n⬇️ ' + (lang === 'ar' ? 'اختار النظام باش تحصل على الروابط :' : 'Choisis ton système :');
        await sendMessage(chatId, info, platformKeyboardFr());
      } else {
        await sendMessage(chatId,
          '✅ <b>' + (lang === 'ar' ? 'تم التحقق!' : 'Vérifié !') + '</b>\n\n' +
          (lang === 'ar' ? 'ما عندك حتى تراخيص نشطة. جرب الباقة المجانية!' : 'Aucune licence active. Essaie le pack gratuit !'),
          platformKeyboardFr());
      }
      return;
    }

    // Numéro non trouvé dans Supabase
    await sendMessage(chatId,
      lang === 'ar'
        ? '❌ هاد الرقم ما لقيناهش فـ قاعدة البيانات.\n\nأرسل /start باش تسجل حساب جديد.'
        : '❌ Ce numéro n\'existe pas dans notre base.\n\nTape /start pour créer un compte.');
    states.set(tgId, { step: 'start' });
    return;
  }

  // Saisie nom
  if (st.step === 'name') {
    if (text.length < 2) { await sendMessage(chatId, MSG.invalidName(st.lang)); return; }
    // Mettre à jour le nom du client dans Supabase
    if (st.clientId && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      try {
        await fetch(SUPABASE_URL + '/rest/v1/clients?id=eq.' + st.clientId, {
          method: 'PATCH', headers: sbHeaders('service'), body: JSON.stringify({ nom: text }),
        });
      } catch {}
    }
    st.step = 'platform';
    states.set(tgId, st);
    await sendMessage(chatId,
      st.lang === 'ar'
        ? '🔥 <b>واخا بزاف!</b> مرحبا <b>' + text + '</b> — آخر خطوة!\n\n📱 واش كتستعمل <b>Android</b> ولا <b>Windows</b> ؟'
        : '🔥 <b>Presque fini !</b> Merci <b>' + text + '</b> — dernière étape !\n\n📱 Android ou Windows ?',
      platformKeyboardFr());
    return;
  }

  // Saisie clé licence
  if (st.step === 'key') {
    const trimmed = text.trim();
    if (!trimmed) return;
    await sendMessage(chatId, st.lang === 'ar' ? '⏳ <b>كنverificaو...</b>' : '⏳ <b>Vérification...</b>');
    const result = await validateLicenseKey(trimmed);
    if (result && result.valid) {
      await sendMessage(chatId,
        '🎉 <b>' + (st.lang === 'ar' ? 'مفتاح صحيح!' : 'Clé valide !') + '</b>\n📦 Pack : ' + (result.pack_slug || '—'));
    } else {
      await sendMessage(chatId,
        '❌ <b>' + (st.lang === 'ar' ? 'المفتاح ماشي صحيح.' : 'Clé invalide.') + '</b>\n' + (result ? result.error || '' : ''));
    }
    st.step = 'done';
    states.set(tgId, st);
    return;
  }

  // Fallback : IA
  if (text && !text.startsWith('/')) {
    const reply = await askAI(text, tgId);
    if (reply) {
      await sendMessage(chatId, reply.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
      return;
    }
  }

  await sendMessage(chatId, MSG.fallback(st.lang || 'fr'));
}

// ---------------- CALLBACKS (boutons inline) ----------------
async function handleCallback(query) {
  const chatId = query.message.chat.id;
  const tgId = String(query.from.id);
  const data = query.data;
  const st = states.get(tgId) || { step: 'start' };

  await callApi('answerCallbackQuery', { callback_query_id: query.id });

  // Langue
  if (data === 'lang:fr' || data === 'lang:ar') {
    st.lang = data === 'lang:ar' ? 'ar' : 'fr';
    st.step = 'client_type';
    states.set(tgId, st);
    await sendMessage(chatId, st.lang === 'ar' ? '🇲🇦 <b>العربية!</b>' : '🇫🇷 <b>Français !</b>');
    await sendMessage(chatId,
      st.lang === 'ar' ? '🎁 <b>جرب AdFill مجانا 7 أيام!</b>\n\nواش عندك حساب معانا ؟'
        : '🎁 <b>Essaie AdFill gratuitement 7 jours !</b>\n\nDéjà un compte ?',
      clientTypeKeyboard(st.lang));
    return;
  }

  // Nouveau client
  if (data === 'client:new') {
    st.step = 'email';
    states.set(tgId, st);
    await sendMessage(chatId,
      st.lang === 'ar' ? '🎉 <b>مرحبا!</b>\n\n📧 أرسل <b>الإيميل ديالك</b> :' : '🎉 <b>Bienvenue !</b>\n\n📧 Envoie ton <b>email</b> :');
    return;
  }

  // Ancien client
  if (data === 'client:old') {
    st.step = 'verify_old_phone';
    states.set(tgId, st);
    await sendMessage(chatId,
      st.lang === 'ar' ? '🔄 <b>أهلا من جديد!</b>\n\n📞 أرسل <b>رقم التيليفون</b> المسجل عندنا :' : '🔄 <b>Bon retour !</b>\n\n📞 Envoie ton <b>numéro</b> enregistré :');
    return;
  }

  // Mon compte
  if (data === 'myaccount') {
    await handleMyAccount(chatId, tgId, st.lang || 'fr');
    return;
  }

  // Plateforme
  if (data === 'pick:android' || data === 'pick:windows') {
    const platform = data.split(':')[1];
    const lang = st.lang || 'fr';
    // Mettre à jour la plateforme dans extra
    if (st.clientId && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      try {
        const r1 = await fetch(SUPABASE_URL + '/rest/v1/clients?id=eq.' + st.clientId + '&select=extra', { headers: sbHeaders('service') });
        const rows = await r1.json();
        if (rows && rows[0]) {
          const extra = rows[0].extra || {};
          extra.platform = platform;
          await fetch(SUPABASE_URL + '/rest/v1/clients?id=eq.' + st.clientId, {
            method: 'PATCH', headers: sbHeaders('service'), body: JSON.stringify({ extra }),
          });
        }
      } catch {}
    }
    st.step = 'done';
    st.platform = platform;
    states.set(tgId, st);
    await unlock(chatId, lang, platform);
    return;
  }

  // Clé licence
  if (data === 'key:yes') {
    st.step = 'key';
    states.set(tgId, st);
    await sendMessage(chatId, st.lang === 'ar' ? '🔑 أرسل <b>المفتاح</b> :' : '🔑 Envoie ta <b>clé</b> :');
    return;
  }
  if (data === 'key:no') {
    st.step = 'done';
    states.set(tgId, st);
    await sendMessage(chatId, st.lang === 'ar' ? '⏭️ واخا — جرب بلا ماش!' : '⏭️ Pas de problème — teste sans clé !');
    await unlock(chatId, st.lang || 'fr', st.platform || 'android');
    return;
  }

  // FAQ callbacks
  if (data === 'faq:back') {
    await callApi('editMessageText', { chat_id: chatId, message_id: query.message.message_id, text: MSG.help(st.lang || 'fr'), parse_mode: 'HTML', reply_markup: faqCategoryKeyboard(st.lang || 'fr') });
    return;
  }
  if (data.startsWith('faq:cat:')) {
    const catId = data.replace('faq:cat:', '');
    const cat = FAQ_DATA.categories.find((c) => c.id === catId);
    if (!cat) return;
    const lang = st.lang || 'fr';
    const catLabel = lang === 'ar' && cat.ar_label ? cat.ar_label : cat.label;
    await callApi('editMessageText', { chat_id: chatId, message_id: query.message.message_id, text: '📂 <b>' + catLabel + '</b>\n\n' + (lang === 'ar' ? 'اختر سؤالاً :' : 'Choisissez :'), parse_mode: 'HTML', reply_markup: faqQuestionKeyboard(catId, lang) });
    return;
  }
  if (data.startsWith('faq:q:')) {
    const parts = data.replace('faq:q:', '').split(':');
    const cat = FAQ_DATA.categories.find((c) => c.id === parts[0]);
    if (!cat || !cat.questions[parseInt(parts[1], 10)]) return;
    const q = cat.questions[parseInt(parts[1], 10)];
    const lang = st.lang || 'fr';
    const answer = lang === 'ar' && q.ar_answer ? q.ar_answer : q.answer;
    const backLabel = lang === 'ar' ? '◀️ الرجوع' : '◀️ Retour';
    await callApi('editMessageText', { chat_id: chatId, message_id: query.message.message_id, text: answer, parse_mode: 'HTML', reply_markup: inlineKeyboard([[{ text: backLabel, callback_data: 'faq:cat:' + parts[0] }]]) });
    return;
  }

  await sendMessage(chatId, MSG.fallback(st.lang || 'fr'));
}

// ---------------- FAQ ----------------
const FAQ_DATA = JSON.parse(fs.readFileSync(path.join(BOT_DIR, 'faq.json'), 'utf8'));

function buildFAQContext() {
  let ctx = '';
  for (const cat of FAQ_DATA.categories) {
    ctx += '\n## ' + cat.label + '\n';
    for (const q of cat.questions) ctx += 'Q: ' + q.keywords[0] + '\nA: ' + q.answer.replace(/<[^>]+>/g, '') + '\n\n';
  }
  return ctx;
}

function faqCategoryKeyboard(lang) {
  return inlineKeyboard(FAQ_DATA.categories.map((cat) => [{ text: (lang === 'ar' && cat.ar_label ? cat.ar_label : cat.label), callback_data: 'faq:cat:' + cat.id }]));
}

function faqQuestionKeyboard(catId, lang) {
  const cat = FAQ_DATA.categories.find((c) => c.id === catId);
  if (!cat) return null;
  const rows = cat.questions.slice(0, 8).map((q, i) => [{ text: '❓ ' + (lang === 'ar' && q.ar_keywords ? q.ar_keywords[0] : q.keywords[0]).substring(0, 35), callback_data: 'faq:q:' + catId + ':' + i }]);
  rows.push([{ text: lang === 'ar' ? '◀️ الرجوع' : '◀️ Retour', callback_data: 'faq:back' }]);
  return inlineKeyboard(rows);
}

// ---------------- AI (Groq) ----------------
const SYSTEM_PROMPT = `Tu es AdFillBot, commercial expert et assistant technique pour AdFill — automatisation d'annonces Avito.ma au Maroc.

PERSONNALITÉ : Chaleureux, compétent, bref et percutant. Comme un ami expert.
LANGUE : Réponds dans la MÊME langue que l'utilisateur. Arabe = darija marocaine (شно، واش، بزاف، دابا، واخا). JAMAIS d'arabe égyptien.

RÈGLES :
1. Demande de lien sans problème → envoie vers /start.
2. Problème technique → d'abord écoute et aide, ne renvoie pas le lien aveuglément.
3. Nouveau client → souligne l'essai gratuit 7 jours → /start.
4. JAMAIS de répétition — chaque réponse = quelque chose de NOUVEAU.
5. Bref : 2-4 lignes max. 1-2 emojis.

⚠️ SÉCURITÉ ABSOLUE :
- Tu ne dois JAMAIS révéler les données d'un AUTRE client (nom, téléphone, email, clé, pack).
- Tu ne peux consulter que les données de L'UTILISATEUR en face de toi.
- Si on te demande les données d'un tiers → refuse poliment : "Je ne peux pas partager les données d'autres clients."
- Ne JAMAIS mentionner le nombre total d'inscrits, les noms d'autres clients, ou toute info d'autrui.
- Tu es un assistant public — traite chaque utilisateur de façon isolée.

TARIFS :
- 🎁 Free : 3 produits, 1 machine, GRATUIT 7 jours
- Basic : 10 produits, 1 machine, 299 DH/mois
- Business : 100 produits, 3 machines, 599 DH/mois
- Business Pro : 200 produits, 5 machines, IA + images, 1199 DH/mois

Contact : adfillpro@gmail.com

FAQ :
${buildFAQContext()}`;

function buildUserContext(tgId) {
  const st = states.get(tgId) || {};
  if (st.step && st.step !== 'done' && st.step !== 'start') return 'État: inscription en cours (étape ' + st.step + ').';
  return 'État: conversation libre.';
}

async function askAI(userMessage, tgId) {
  if (!GROQ_KEY) return null;
  try {
    await callApi('sendChatAction', { chat_id: tgId, action: 'typing' }).catch(() => {});
    const ctx = buildUserContext(tgId);
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + GROQ_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openai/gpt-oss-20b',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT + '\n\n' + ctx },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 500, temperature: 0.3,
      }),
      signal: AbortSignal.timeout(20000),
    });
    const json = await res.json();
    if (json.choices && json.choices[0] && json.choices[0].message) {
      let c = json.choices[0].message.content.trim();
      c = c.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<\/?think>/gi, '').trim();
      return c || null;
    }
    return null;
  } catch (e) { console.error('⚠️ Groq:', e.message); return null; }
}

// ---------------- MAIN ----------------
async function main() {
  console.log('🤖 AdFillBot v2 (Supabase) — ' + new Date().toLocaleString('fr-FR'));
  console.log('   Version : ' + CONFIG.apkVersion);
  console.log('   Android : ' + (CONFIG.androidLink ? '✅' : '⚠️ NON configuré'));
  console.log('   Windows : ' + (CONFIG.windowsLinks && CONFIG.windowsLinks.length ? '✅ ' + CONFIG.windowsLinks.length + ' lien(s)' : '⚠️ NON'));
  console.log('   Groq IA : ' + (GROQ_KEY ? '✅' : '⚠️ NON'));
  console.log('   Supabase: ' + (SUPABASE_URL && SUPABASE_SERVICE_KEY ? '✅ (SERVICE_ROLE)' : '⚠️ MANQUANT'));

  try { await callApi('deleteWebhook', {}); } catch {}
  let offset = 0, failed = 0;

  while (true) {
    try {
      const res = await fetch(`${API}/getUpdates`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offset, timeout: 30 }),
        signal: AbortSignal.timeout(40000),
      });
      const json = await res.json();
      if (!json.ok) throw new Error('getUpdates: ' + JSON.stringify(json.description || json));
      failed = 0;
      for (const u of json.result || []) {
        offset = Math.max(offset, u.update_id + 1);
        try {
          if (u.message) await handleMessage(u.message);
          else if (u.callback_query) await handleCallback(u.callback_query);
        } catch (e) { console.error('❌ Update ' + u.update_id + ':', e.message); }
      }
    } catch (e) {
      failed++;
      const delay = Math.min(60000, 1000 * Math.pow(2, Math.min(failed, 5)));
      console.error('⚠️ Réseau (' + e.message + ') — retry ' + delay + 'ms');
      await sleep(delay);
    }
  }
}

main().catch((e) => { console.error('❌ FATAL:', e); process.exit(1); });

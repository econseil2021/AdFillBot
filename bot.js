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

const SYSTEM_PROMPT = `Tu es AdFillBot, un commercial expert et assistant technique pour AdFill — un outil d'automatisation de remplissage d'annonces sur Avito.ma au Maroc.

PERSONNALITÉ :
- Tu es un vendeur compétent et un assistant technique. Tu guides le client du début à la fin.
- Tu es chaleureux, patient, et tu parles comme un ami expert.
- Tu détectes le besoin du client et tu lui donnes la bonne réponse immédiatement.

LANGUE :
- Détecte la langue et réponds dans la MÊME langue.
- Si l'utilisateur écrit en français → réponds en français.
- Si l'utilisateur écrit en arabe → réponds en ARABE MAROCAIN (DARIJA). Utilise des mots marocains comme : شنو، واش، داكشي، بزاف، دابا، خلاص، واخا، سمح لي، بسلامة، إن شاء الله، ماشي، يالاه، زوين، خايب، عاوتاني. N'utilise JAMAIS d'arabe égyptien (ممكنش، إيه، هو ده، كده) ni d'arabe standard formel.
- Quand tu réponds en darija, écris en caractères arabes mais avec le style parlé au Maroc.

RÈGLES ABSOLUES :
1. SI le client demande de télécharger / lien / apk / exe / application → DIS-lui de taper /start pour recevoir le lien directement. NE dis JAMAIS "va au menu" ou "utilise les boutons". Donne la marche à suivre claire.
2. SI le client est déjà inscrit (a déjà donné son numéro) → propose directement les liens de téléchargement.
3. SI c'est un nouveau client → pose 2-3 questions pour comprendre son besoin (quel téléphone/PC, qu'est-ce qu'il veut faire) puis guide-le vers /start.
4. Si le client semble confus ou perdu → résume en 3 étapes simples : "1. Tape /start 2. Choisis Android ou Windows 3. Enregistre-toi et tu reçois le lien".
5. Si le client pose des questions hors-sujet ou semble abuser du bot → sois poli mais redirige vers le support.

STYLE DE RÉPONSE :
- Utilise des emojis pour rendre les réponses vivantes.
- Sois bref (3-5 lignes) sauf si le client demande des détails.
- Termine toujours par un appel à l'action clair.
- N'invente JAMAIS de fonctionnalités, prix ou dates.

TARIFS :
- Free : 3 produits, 1 machine, gratuit (essai 7 jours)
- Basic : 10 produits, 1 machine, 299 DH/mois
- Business : 100 produits, 3 machines, 599 DH/mois
- Business Pro : 200 produits, 5 machines, IA + images, 1199 DH/mois

Plateformes : Android (APK) et Windows (EXE portable/setup).
Contact support : adfillpro@gmail.com

CONTEXTE FAQ :
${buildFAQContext()}`;

function buildUserContext(tgId) {
  const existing = getTester(tgId);
  const st = states.get(tgId) || {};
  let ctx = '';
  if (existing && existing.platform) {
    ctx = `CONTEXTE UTILISATEUR : Client déjà inscrit. Plateforme: ${existing.platform}. Nom: ${existing.name || 'inconnu'}.`;
  } else {
    ctx = `CONTEXTE UTILISATEUR : Nouveau visiteur, pas encore inscrit.`;
  }
  if (st.step && st.step !== 'done' && st.step !== 'start') {
    ctx += ` État inscription: en cours (étape ${st.step}).`;
  }
  return ctx;
}

async function askAI(userMessage, tgId) {
  if (!GROQ_KEY) return null;
  try {
    const userCtx = buildUserContext(tgId);
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + GROQ_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'qwen/qwen3.6-27b',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT + '\n\n' + userCtx },
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

function faqCategoryKeyboard(lang) {
  const useAr = lang === 'ar';
  return inlineKeyboard(
    FAQ_DATA.categories.map((cat) => {
      const label = useAr && cat.ar_label ? cat.ar_label : cat.label;
      return [{ text: label, callback_data: 'faq:cat:' + cat.id }];
    })
  );
}

function faqQuestionKeyboard(catId, lang) {
  const cat = FAQ_DATA.categories.find((c) => c.id === catId);
  if (!cat) return null;
  const useAr = lang === 'ar';
  const rows = cat.questions.slice(0, 8).map((q, i) => {
    const kw = useAr && q.ar_keywords ? q.ar_keywords[0] : q.keywords[0];
    const preview = kw.substring(0, 35);
    return [{ text: '❓ ' + preview + (kw.length > 35 ? '…' : ''), callback_data: 'faq:q:' + catId + ':' + i }];
  });
  const backLabel = useAr ? 'العودة' : '◀️ Retour';
  rows.push([{ text: backLabel, callback_data: 'faq:back' }]);
  return inlineKeyboard(rows);
}

// ---------------- OTP ----------------
function generateOTP() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

// ---------------- Détection de langue ----------------
function isArabic(text) {
  const arabicChars = (text.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g) || []).length;
  return arabicChars > text.length * 0.2;
}

const MSG = {
  welcome: (t) => isArabic(t) ? 'مرحبا بيك فـ AdFill ! 🚀\n\nAdFill كيملأ إعلاناتك بشكل تلقائي على Avito.ma.\n\nجرب التطبيق وقولنا رأيك !' : CONFIG.welcomeText,
  welcomeBack: (t) => isArabic(t) ? '👋 واخا رجعتي ! نتا مسجل أصلاً.\nحمّل من جديد أو سول على شي حاجة :' : '👋 Bon retour ! Vous êtes déjà enregistré.\nTéléchargez à nouveau ou posez une question :',
  platformChoice: (t, p) => isArabic(t) ? '📱 واخا اختاريتي : <b>' + (p === 'android' ? 'Android' : 'Windows') + '</b>.\n\nباش تحصل على الروابط، سجّل راسك :\n📞 أرسل <b>رقم التيليفون ديالك</b> (مع الكود الدولي) :' : '📱 Merci pour votre choix : <b>' + (p === 'android' ? 'Android' : 'Windows') + '</b>.\n\nPour débloquer les fichiers, enregistrez-vous :\n📞 Envoyez votre <b>numéro de téléphone</b> (avec indicatif) :',
  invalidPhone: (t) => isArabic(t) ? '⚠️ هاد ماشي رقم صحيح. أرسل رقم مع الكود، مثال : +212 6 12 34 56 78' : '⚠️ Ce numéro ne semble pas valide. Envoyez un numéro avec indicatif, ex : +212 6 12 34 56 78',
  phoneUsed: (t) => isArabic(t) ? '⚠️ هاد الرقم مسجل عند حساب خر. استعمل رقم خر أو تواصل مع الدعم.' : '⚠️ Ce numéro est déjà enregistré pour un autre compte. Utilisez un autre numéro ou contactez le support.',
  otpSent: (t, code) => isArabic(t) ? '📱 <b>تأكيد الرقم</b>\n\nصيفطنا لك كود التأكيد على التيليفون ديالك عبر Telegram.\n\n🔑 الكود ديالك : <b>' + code + '</b>\n\nأرسل هاد الكود باش تأكد رقمك :' : '📱 <b>Vérification du numéro</b>\n\nUn code de vérification a été envoyé sur votre téléphone via Telegram.\n\n🔑 Votre code : <b>' + code + '</b>\n\nEnvoyez ce code pour valider votre numéro :',
  otpWrong: (t) => isArabic(t) ? '❌ الكود ماشي صحيح. عاوتاني أو أرسل /annuler باش تبدا من اللول.' : '❌ Code incorrect. Réessayez ou envoyez /annuler pour recommencer.',
  otpOk: (t) => isArabic(t) ? '✅ تم التأكد من الرقم ! دابا، <b>الاسم الكامل ديالك</b> :' : '✅ Numéro vérifié ! Maintenant, votre <b>nom et prénom</b> :',
  invalidName: (t) => isArabic(t) ? '⚠️ الاسم قصير بزاف. أرسل الاسم الكامل ديالك، مثال : أحمد بنعلي' : '⚠️ Votre nom est un peu court. Envoyez votre nom et prénom, ex : Ahmed Benali',
  askKey: (t) => isArabic(t) ? '🔑 واش عندك <b>مفتاح الترخيص</b> ؟ (اختياري للتجربة)' : '🔑 Avez-vous une <b>clé de licence</b> ? (facultatif pour le test bêta)',
  keyVerifying: (t) => isArabic(t) ? '⏳ كن verificaو المفتاح ديالك…' : '⏳ Vérification de votre clé…',
  keyValid: (t, pack) => isArabic(t) ? '✅ المفتاح صحيح — الباقة <b>' + (pack || '') + '</b> !\nكنفتحو لك الروابط دابا.' : '✅ Clé valide — pack <b>' + (pack || '') + '</b> !\nJe débloque maintenant les fichiers.',
  keyInvalid: (t, err) => isArabic(t) ? '⚠️ المفتاح ماشي معروف : <i>' + (err || 'مفتاح خايب') + '</i>.\nللتجربة، تقدر تكمل بلا مفتاح (تجربة مجانية كاينة فـ التطبيق).\nواش بغيتي تكمل ؟' : '⚠️ Clé non reconnue : <i>' + (err || 'Clé invalide') + '</i>.\nPour ce test bêta, vous pouvez continuer sans clé (essai gratuit disponible dans l\u2019app).\nSouhaitez-vous continuer ?',
  noKey: (t) => isArabic(t) ? '👍 ماشي مشكلة — التجربة المجانية كاينة فـ التطبيق.' : '👍 Pas de problème — l\u2019essai gratuit est disponible dans l\u2019application.',
  sent: (t) => isArabic(t) ? '✅ الروابط وصلوك. جرب مزيان ! إلا كان مشكلة، تواصل مع الدعم.' : '✅ Lien envoyé. Bon test ! En cas de problème, contacte le support.',
  androidNotReady: (t) => isArabic(t) ? '⚠️ رابط Android مزال ما مجهّزش. تواصل مع الدعم.' : '⚠️ Le lien Android n\u2019est pas encore configuré. Contacte le support.',
  windowsNotReady: (t) => isArabic(t) ? '⚠️ روابط Windows مزالين ما مجهّزينش. تواصل مع الدعم.' : '⚠️ Les liens Windows ne sont pas encore configurés. Contacte le support.',
  cancel: (t) => isArabic(t) ? '🔄 واخا لغينا. أرسل /start باش تبدا من اللول.' : '🔄 Processus annulé. Tapez /start pour recommencer.',
  help: (t) => isArabic(t) ? 'ℹ️ <b>مساعدة AdFill</b>\n\nاختار موضوع أو سول على شي حاجة مباشرة :' : 'ℹ️ <b>Aide AdFill</b>\n\nChoisissez un sujet ou posez votre question directement :',
  fallback: (t) => isArabic(t) ? '🤖 سول على شي حاجة أو أرسل /aide باش تشوف المواضيع.\nباش تبدا، أرسل /start.' : '🤖 Posez votre question ou tapez /aide pour voir les sujets disponibles.\nPour commencer, tapez /start.',
  unknownCmd: (t) => isArabic(t) ? 'أمر ما مفهمش. أرسل /start أو /aide' : 'Commande inconnue. Tapez /start ou /aide',
};

// ---------------- États de dialogue ----------------
const states = new Map(); // telegramId -> { step, platform, otp }

// ---------------- Traitement des messages ----------------
async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const tgId = String(msg.from.id);
  const text = (msg.text || '').trim();

  const existing = getTester(tgId);
  const st = states.get(tgId) || { step: 'start' };

  // Détecter et stocker la langue
  if (text && !text.startsWith('/')) {
    st.lang = isArabic(text) ? 'ar' : 'fr';
    states.set(tgId, st);
  }

  if (text === '/start') {
    if (existing && existing.platform) {
      states.set(tgId, { step: 'done', platform: existing.platform });
      await sendMessage(chatId, MSG.welcomeBack(text), registeredMenuKeyboard());
      return;
    }
    states.set(tgId, { step: 'pick', platform: null });
    await sendMessage(chatId, MSG.welcome(text), mainMenuKeyboard());
    return;
  }

  if (text === '/aide' || text === '/help') {
    await sendMessage(chatId, MSG.help(text), faqCategoryKeyboard());
    return;
  }

  if (text === '/annuler') {
    states.set(tgId, { step: 'start' });
    await sendMessage(chatId, MSG.cancel(text));
    return;
  }

  // ---- Saisie du téléphone ----
  if (st.step === 'phone') {
    const phoneDigits = text.replace(/\D/g, '');
    if (phoneDigits.length < 8) {
      await sendMessage(chatId, MSG.invalidPhone(text));
      return;
    }
    const existingPhone = findTesterByPhone(text);
    if (existingPhone && String(existingPhone.telegramId) !== tgId) {
      await sendMessage(chatId, MSG.phoneUsed(text));
      return;
    }

    // Générer et envoyer OTP
    const otp = generateOTP();
    st.step = 'otp';
    st.otp = otp;
    st.phone = text;
    states.set(tgId, st);

    await sendMessage(chatId, MSG.otpSent(text, otp));
    return;
  }

  // ---- Vérification OTP ----
  if (st.step === 'otp') {
    const enteredOtp = text.replace(/\D/g, '');
    if (enteredOtp !== st.otp) {
      await sendMessage(chatId, MSG.otpWrong(text));
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

    await sendMessage(chatId, MSG.otpOk(text));
    return;
  }

  // ---- Saisie du nom ----
  if (st.step === 'name') {
    if (text.length < 2) {
      await sendMessage(chatId, MSG.invalidName(text));
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
    await sendMessage(chatId, MSG.askKey(text), keyKeyboard());
    return;
  }

  // ---- Saisie de la clé ----
  if (st.step === 'key') {
    const trimmed = text.trim();
    if (!trimmed) return;
    await sendMessage(chatId, MSG.keyVerifying(text));
    const result = await validateLicenseKey(trimmed);

    const testers = loadTesters();
    const tester = testers.find((t) => String(t.telegramId) === tgId);

    if (result && result.valid) {
      tester.licenseKeyHash = hashKey(trimmed);
      tester.licenseValid = true;
      tester.licensePack = result.pack_slug || '';
      saveTesters(testers);
      logEvent(tester, 'license_ok', { pack: tester.licensePack });
      await sendMessage(chatId, MSG.keyValid(text, result.pack_slug));
    } else {
      const err = (result && result.error) || (isArabic(text) ? 'مفتاح غير صالح' : 'Clé invalide');
      tester.licenseKeyHash = hashKey(trimmed);
      tester.licenseValid = false;
      saveTesters(testers);
      logEvent(tester, 'license_invalid', { error: err });
      await sendMessage(chatId, MSG.keyInvalid(text, err), keyKeyboard());
      states.set(tgId, { step: 'key', platform: st.platform });
      return;
    }

    tester.platform = st.platform;
    states.set(tgId, { step: 'done', platform: st.platform });
    await unlock(chatId, tester);
    return;
  }

  // ---------------- Fallback : détection intelligente + IA Groq ----------------
  if (text && !text.startsWith('/')) {
    const lang = st.lang || 'fr';
    const lowerText = text.toLowerCase();

    // Détection demande de téléchargement
    const downloadKeywords = ['télécharger', 'telecharger', 'download', 'apk', 'exe', 'lien', 'liens',
      'حمّل', 'تحميل', 'رابط', 'روابط', 'تنزيل', ' скачат', 'get', 'link', 'envoi', 'envoyer'];
    const isDownloadRequest = downloadKeywords.some((kw) => lowerText.includes(kw));

    if (isDownloadRequest && existing && existing.platform) {
      // Client inscrit → envoi direct du lien
      await unlock(chatId, existing);
      return;
    }

    if (isDownloadRequest && (!existing || !existing.platform)) {
      // Nouveau → guide vers /start
      const msg = isArabic(lang)
        ? '📥 باش تحمل التطبيق، سير بالخطوات البسيطة :\n\n1️⃣ أرسل /start\n2️⃣ اختار Android أو Windows\n3️⃣ سجّل رقمك وسميك\n4️⃣ غادي تحصل على الرابط مباشرة !\n\nواخا ؟ أرسل /start'
        : '📥 Pour télécharger, suis ces étapes simples :\n\n1️⃣ Tape /start\n2️⃣ Choisis Android ou Windows\n3️⃣ Enregistre ton numéro et nom\n4️⃣ Tu reçois le lien directement !\n\nPrêt ? Tape /start';
      await sendMessage(chatId, msg);
      return;
    }

    // Détection demande d'aide / installation / problème
    const helpKeywords = ['installer', 'installation', 'marche pas', 'problème', 'erreur', 'crash',
      'تثبيت', 'ما خدامش', 'مشكلة', 'خطأ', 'bug', 'aide', 'comment'];
    const isHelpRequest = helpKeywords.some((kw) => lowerText.includes(kw));

    if (isHelpRequest && existing && existing.platform) {
      // Client inscrit avec problème → propose le support
      const msg = isArabic(lang)
        ? '🔧 باش تحل مشكلتك :\n\n1️⃣ أعد تشغيل التطبيق\n2️⃣ تأكد أن Android/Windows محدث\n3️⃣ إلا بقات المشكلة، تواصل معنا :\n📧 adfillpro@gmail.com\n\nصيفط لي وصف م详细 للمشكلة وغادي نعاونك!'
        : '🔧 Pour résoudre ton problème :\n\n1️⃣ Redémarre l\'application\n2️⃣ Vérifie que ton Android/Windows est à jour\n3️⃣ Si le problème persiste, contacte-nous :\n📧 adfillpro@gmail.com\n\nDécris ton problème en détail et on t\'aide !';
      await sendMessage(chatId, msg);
      return;
    }

    // Détection tentative d'abus / spam / hors-sujet
    const abusePatterns = ['hack', 'crack', 'gratuit forever', 'pirate', 'free premium', 'contourner', 'bypass',
      'كلمات عشوائية', '-test', 'test test', '123', 'abc'];
    const isAbuse = abusePatterns.some((p) => lowerText.includes(p));

    if (isAbuse) {
      const msg = isArabic(lang)
        ? '🤔 واش كت testa البوت ؟ AdFill متاح للجميع!\n\n📥 باش تحمل : أرسل /start\n💬 للأسئلة : كتب سؤالك مباشرة\n📧 للدعم : adfillpro@gmail.com'
        : '🤔 On dirait que tu testes le bot. AdFill est disponible pour tous !\n\n📥 Pour télécharger : tape /start\n💬 Pour des questions : écris directement\n📧 Pour le support : adfillpro@gmail.com';
      await sendMessage(chatId, msg);
      return;
    }

    // IA Groq pour les vraies questions
    const reply = await askAI(text, tgId);
    if (reply) {
      const safe = reply.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      await sendMessage(chatId, safe);
      return;
    }
  }

  await sendMessage(chatId, MSG.fallback(text));
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
    await sendMessage(chatId, MSG.platformChoice(text, platform));
    return;
  }

  if (data === 'key:yes') {
    st.step = 'key';
    states.set(tgId, st);
    const lang = st.lang || 'fr';
    await sendMessage(chatId, isArabic(lang) ? '🔑 أرسل <b>مفتاح الترخيص ديالك</b> (مثال : ADFILL-XXXX-XXXX) :' : '🔑 Envoyez votre <b>clé de licence</b> (ex : ADFILL-XXXX-XXXX) :');
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
    await sendMessage(chatId, MSG.noKey(text));
    await unlock(chatId, tester || { telegramId: tgId, platform: st.platform });
    return;
  }

  // ---- FAQ callbacks ----
  if (data === 'faq:back') {
    const lang = st.lang || 'fr';
    await callApi('editMessageText', {
      chat_id: chatId,
      message_id: query.message.message_id,
      text: MSG.help(lang),
      parse_mode: 'HTML',
      reply_markup: faqCategoryKeyboard(lang),
    });
    return;
  }

  if (data.startsWith('faq:cat:')) {
    const catId = data.replace('faq:cat:', '');
    const cat = FAQ_DATA.categories.find((c) => c.id === catId);
    if (!cat) return;
    const lang = st.lang || 'fr';
    const catLabel = isArabic(lang) && cat.ar_label ? cat.ar_label : cat.label;
    const chooseQ = isArabic(lang) ? 'اختر سؤالاً :' : 'Choisissez une question :';
    await callApi('editMessageText', {
      chat_id: chatId,
      message_id: query.message.message_id,
      text: '📂 <b>' + catLabel + '</b>\n\n' + chooseQ,
      parse_mode: 'HTML',
      reply_markup: faqQuestionKeyboard(catId, lang),
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
    const lang = st.lang || 'fr';
    const answer = isArabic(lang) && q.ar_answer ? q.ar_answer : q.answer;
    const catLabel = isArabic(lang) && cat.ar_label ? cat.ar_label : cat.label;
    const backLabel = isArabic(lang) ? 'العودة إلى ' + catLabel : '◀️ Retour à ' + catLabel;
    const homeLabel = isArabic(lang) ? '🏠 قائمة المساعدة' : '🏠 Menu aide';
    await callApi('editMessageText', {
      chat_id: chatId,
      message_id: query.message.message_id,
      text: answer,
      parse_mode: 'HTML',
      reply_markup: inlineKeyboard([
        [{ text: backLabel, callback_data: 'faq:cat:' + catId }],
        [{ text: homeLabel, callback_data: 'faq:back' }],
      ]),
    });
    return;
  }

  await sendMessage(chatId, MSG.unknownCmd(text));
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

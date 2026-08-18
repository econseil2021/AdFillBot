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
    await sendMessage(chatId, '⚠️ Le lien Android n\'est pas encore configuré. Contacte le support.');
    return false;
  }
  const text =
    '📱 <b>AdFill v' + CONFIG.apkVersion + ' — Android</b>\n\n' +
    '⬇️ Télécharge et installe l\'application :\n' +
    '👉 ' + link + '\n\n' +
    '💡 <i>Astuce : active l\'installation depuis sources inconnues dans les paramètres de ton téléphone.</i>';
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
    '⬇️ Télécharge l\'EXE Windows :\n' +
    (links.length ? links.map((l) => '👉 ' + l).join('\n') : '👉 ' + link) + '\n\n' +
    '💡 <i>Choisis <b>AdFill-' + CONFIG.apkVersion + '-portable.exe</b> (zéro installation) ou ' +
    '<b>AdFill-' + CONFIG.apkVersion + '-setup.exe</b> (installation classique).</i>';
  await sendMessage(chatId, text);
  return true;
}

async function unlock(chatId, tester) {
  const lang = tester.lang || 'fr';
  if (tester.platform === 'android') {
    logEvent(tester, 'download', { platform: 'android', version: CONFIG.apkVersion });
    await sendAndroidLink(chatId, tester);
  } else {
    logEvent(tester, 'download', { platform: 'windows', version: CONFIG.apkVersion });
    await sendWindowsLink(chatId, tester);
  }
  const msg = lang === 'ar'
    ? '🚀 <b>هاك الروابط — جرب دابا!</b>\n\nواش عندك مشكلة ؟ تواصل معنا :\n📧 adfillpro@gmail.com\n\nبالتوفيق! 🎯'
    : '🚀 <b>Voilà — bon test !</b>\n\nDes questions ? Contacte-nous :\n📧 adfillpro@gmail.com\n\nBonne utilisation ! 🎯';
  await sendMessage(chatId, msg);
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
- Tu PROMOUS activement l'essai gratuit de 7 jours — c'est ton argument de vente principal.

LANGUE :
- Détecte la langue et réponds dans la MÊME langue.
- Si l'utilisateur écrit en français → réponds en français.
- Si l'utilisateur écrit en arabe → réponds en ARABE MAROCAIN (DARIJA). Utilise des mots marocains comme : شنو، واش، داكشي، بزاف، دابا، خلاص، واخا، سمح لي، بسلامة، إن شاء الله، ماشي، يالاه، زوين، خايب، عاوتاني. N'utilise JAMAIS d'arabe égyptien (ممكنش، إيه، هو ده، كده) ni d'arabe standard formel.
- Quand tu réponds en darija, écris en caractères arabes mais avec le style parlé au Maroc.

RÈGLES ABSOLUES :
1. SI le client demande de télécharger / lien / apk / exe / application → DIS-lui de taper /start pour recevoir le lien directement. NE dis JAMAIS "va au menu" ou "utilise les boutons". Donne la marche à suivre claire.
2. SI le client est déjà inscrit (a déjà donné son numéro) → propose directement les liens de téléchargement.
3. SI c'est un nouveau client → souligne l'essai gratuit 7 jours, puis guide-le vers /start pour s'inscrire.
4. Si le client semble confus ou perdu → résume en 3 étapes simples : "1. Tape /start 2. Choisis Android ou Windows 3. Enregistre-toi et tu reçois le lien".
5. Si le client pose des questions hors-sujet ou semble abuser du bot → sois poli mais redirige vers le support.

STYLE DE RÉPONSE :
- Sois enthousiaste mais professionnel — montre la valeur d'AdFill.
- Utilise 1-2 emojis par message max.
- Sois bref et percutant (2-4 lignes sauf détails demandés).
- Termine toujours par un appel à l'action clair.
- N'invente JAMAIS de fonctionnalités, prix ou dates.

TARIFS :
- 🎁 Free : 3 produits, 1 machine, GRATUIT (essai 7 jours) —(argument principal!)
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
    // Indicateur "en train d'écrire..."
    const userCtx = buildUserContext(tgId);
    await callApi('sendChatAction', { chat_id: tgId, action: 'typing' }).catch(() => {});
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + GROQ_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-20b',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT + '\n\n' + userCtx },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 500,
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
  welcome: (lang) => lang === 'ar'
    ? '🚀 <b>AdFill — الإعلانات ديالك على Avito بشكل تلقائي</b>\n\n' +
      '📌 كيملأ إعلاناتك بلا ما تقضي وقت\n' +
      '📌 ي深交ح الصور والوصف والثمن بشكل ذكي\n' +
      '📌 كيشتغل على Android و Windows\n\n' +
      '🎁 جرب <b>مجانا 7 أيام</b> — بلا ما needing بطاقة بنكية\n\n' +
      '⬇️ اختار اللغة ديالك باش نكملو :'
    : '🚀 <b>AdFill — Tes annonces Avito remplies automatiquement</b>\n\n' +
      '📌 Remplis tes annonces sans perdre de temps\n' +
      '📌 Images, descriptions et prix gérés intelligemment\n' +
      '📌 Disponible sur Android et Windows\n\n' +
      '🎁 Essai gratuit <b>7 jours</b> — sans carte bancaire\n\n' +
      '⬇️ Choisis ta langue pour continuer :',
  invalidPhone: (lang) => lang === 'ar'
    ? '⚠️ <b>رقم غير صالح</b>\n\nأرسل رقمك مع الكود الدولي، مثال :\n📞 +212 6XX XX XX XX'
    : '⚠️ <b>Numéro invalide</b>\n\nEnvoie ton numéro avec l\'indicatif pays :\n📞 +212 6XX XX XX XX',
  phoneUsed: (lang) => lang === 'ar'
    ? '⚠️ <b>هاد الرقم مسجل فـ حساب خر</b>\n\nاستعمل رقم خر أو تواصل معنا :\n📧 adfillpro@gmail.com'
    : '⚠️ <b>Ce numéro est déjà associé à un compte</b>\n\nUtilise un autre numéro ou contacte le support :\n📧 adfillpro@gmail.com',
  otpSent: (lang, code) => lang === 'ar'
    ? '🔐 <b>تثبيت حسابك</b>\n\nصيفطنا لك كود التأكيد باش نعرفو راك صاحب الرقم.\n\n🔑 <b>Kod dyalk : ' + code + '</b>\n\n📋 Sir nsot ha lcode f had lchat :'
    : '🔐 <b>Vérification rapide</b>\n\nOn t\'a envoyé un code de confirmation.\n\n🔑 <b>Ton code : ' + code + '</b>\n\n📋 Copie-colle ce code ici pour confirmer :',
  otpWrong: (lang) => lang === 'ar'
    ? '❌ <b>الكود ماشي صحيح</b>\n\nعاوتاني — كود جديد وصافي :\n\nأو أرسل /annuler باش تبدا من جديد.'
    : '❌ <b>Code incorrect</b>\n\nRéessaie avec le bon code :\n\nOu tape /annuler pour recommencer.',
  otpOk: (lang) => lang === 'ar'
    ? '✅ <b>تم التأكد — واخا!</b>\n\nدابا أعرفناك. شنو <b>سميك الكامل</b> ؟\n\n(مثلاً : أحمد بنعلي)'
    : '✅ <b>Numéro confirmé !</b>\n\nMaintenant, dis-nous ton <b>nom complet</b> :\n\n(Ex : Ahmed Benali)',
  invalidName: (lang) => lang === 'ar'
    ? '⚠️ <b>الاسم قصير بزاف</b>\n\nأرسل الاسم الكامل ديالك :\n👤 مثال : أحمد بنعلي'
    : '⚠️ <b>Le nom est trop court</b>\n\nEnvoie ton nom et prénom :\n👤 Ex : Ahmed Benali',
  keyVerifying: (lang) => lang === 'ar'
    ? '⏳ <b>كنverificaو المفتاح ديالك...</b>\n\nثواني فقط ⏳'
    : '⏳ <b>Vérification de ta clé en cours...</b>\n\nQuelques secondes ⏳',
  keyValid: (lang, pack) => lang === 'ar'
    ? '🎉 <b>مفتاح صحيح — مرحبا بيك!</b>\n\n📦 الباقة : <b>' + (pack || 'free') + '</b>\n\n🔑 حسابك معتمد — تقدر تستعمل التطبيق بلا ماش.\n\n⬇️ اختار نظامك باش تحصل على الروابط :'
    : '🎉 <b>Clé valide — bienvenue !</b>\n\n📦 Pack : <b>' + (pack || 'free') + '</b>\n\n🔑 Ton compte est actif — utilise l\'application.\n\n⬇️ Choisis ton système pour recevoir les liens :',
  keyInvalid: (lang, err) => lang === 'ar'
    ? '❌ <b>المفتاح ماشي صحيح</b>\n\nالخطأ : ' + (err || 'غير معروف') + '\n\n🔑 تأكد من المفتاح أو جرب مفتاح خر.\n\nأو تقدر كمل بلا ماش — المفتاح اختياري.'
    : '❌ <b>Clé invalide</b>\n\nErreur : ' + (err || 'inconnue') + '\n\n🔑 Vérifie ta clé ou essaie une autre.\n\nTu peux aussi continuer sans clé — elle est optionnelle.',
  noKey: (lang) => lang === 'ar'
    ? '⏭️ <b>واخا — كمل بلا ماش!</b>\n\nالمفتاح اختياري. تقدر تجرب التطبيق مع الباقة المجانية.\n\n⬇️ اختار نظامك :'
    : '⏭️ <b>Pas de problème — continue sans clé !</b>\n\nLa clé est optionnelle. Tu peux tester avec le pack gratuit.\n\n⬇️ Choisis ton système :',
  cancel: (lang) => lang === 'ar'
    ? '🛑 <b>تم الإلغاء.</b>\n\nعندك أي سؤال ؟ أرسل /start باش تبدا من جديد.'
    : '🛑 <b>Annulé.</b>\n\nUne question ? Tape /start pour recommencer.',
  help: (lang) => lang === 'ar'
    ? '📚 <b>مركز المساعدة</b>\n\nاختار الفئة ديال السؤال ديالك :\n\n💬 ما لقيتيش السؤال ديالك؟ كتبو مباشرة وغادي نجاوبك!'
    : '📚 <b>Centre d\'aide</b>\n\nChoisis une catégorie :\n\n💬 Tu ne trouves pas ta question ? Écris-la directement et on te répond !',
  fallback: (lang) => lang === 'ar'
    ? '💬 <b>ممكن نعاونك ؟</b>\n\nأرسل سؤالك مباشرة — أو :\n/start باش تبدا\n/aide للأسئلة الشائعة'
    : '💬 <b>Comment puis-je t\'aider ?</b>\n\nPose ta question directement — ou :\n/start pour commencer\n/aide pour la FAQ',
  unknownCmd: (lang) => lang === 'ar'
    ? '🤔 <b>أمر غير معروف</b>\n\nجرب /start أو /aide — أو كتب سؤالك مباشرة!'
    : '🤔 <b>Commande inconnue</b>\n\nEssaie /start ou /aide — ou écris ta question directement !',
};

// ---------------- Boutons ----------------
function langKeyboard() {
  return inlineKeyboard([
    [{ text: '🇫🇷 Français', callback_data: 'lang:fr' }, { text: '🇲🇦 العربية', callback_data: 'lang:ar' }],
  ]);
}

function clientTypeKeyboard(lang) {
  const isNew = lang === 'ar' ? '🆕 نبدا من جديد' : '🆕 Je commence';
  const isOld = lang === 'ar' ? '🔄 عندي حساب' : '🔄 J\'ai déjà un compte';
  return inlineKeyboard([
    [{ text: isNew, callback_data: 'client:new' }],
    [{ text: isOld, callback_data: 'client:old' }],
  ]);
}

function platformKeyboardFr() {
  return inlineKeyboard([
    [{ text: '📱 Android', callback_data: 'pick:android' }],
    [{ text: '💻 Windows', callback_data: 'pick:windows' }],
  ]);
}

// ---------------- États de dialogue ----------------
const states = new Map(); // telegramId -> { step, platform, otp, lang, email }

// ---------------- Traitement des messages ----------------
async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const tgId = String(msg.from.id);
  const text = (msg.text || '').trim();

  const existing = getTester(tgId);
  const st = states.get(tgId) || { step: 'start' };

  // /start — Reset total
  if (text === '/start') {
    if (existing && existing.platform) {
      // Déjà inscrit — retour direct
      states.set(tgId, { step: 'done', platform: existing.platform, lang: existing.lang || 'fr' });
      const lang = existing.lang || 'fr';
      const msg = lang === 'ar'
        ? '👋 <b>مرحبا بيك من جديد!</b>\n\nواش بغيتي تحمل التطبيق ولا عندك سؤال ؟'
        : '👋 <b>Bon retour !</b>\n\nTu veux télécharger l\'app ou tu as une question ?';
      await sendMessage(chatId, msg, inlineKeyboard([
        [{ text: lang === 'ar' ? '📱 تحميل Android' : '📱 Télécharger Android', callback_data: 'pick:android' }],
        [{ text: lang === 'ar' ? '💻 تحميل Windows' : '💻 Télécharger Windows', callback_data: 'pick:windows' }],
        [{ text: '❓ ' + (lang === 'ar' ? 'المساعدة' : 'Aide & Questions'), callback_data: 'faq:back' }],
      ]));
      return;
    }
    states.set(tgId, { step: 'lang' });
    await sendMessage(chatId, MSG.welcome('fr'), langKeyboard());
    return;
  }

  if (text === '/aide' || text === '/help') {
    const lang = st.lang || 'fr';
    await sendMessage(chatId, MSG.help(lang), faqCategoryKeyboard(lang));
    return;
  }

  if (text === '/annuler') {
    states.set(tgId, { step: 'start' });
    await sendMessage(chatId, MSG.cancel(st.lang || 'fr'));
    return;
  }

  // ---- ÉTAPE 1 : Choix de la langue ----
  if (st.step === 'lang') {
    // Si tape directement au lieu de cliquer le bouton
    st.lang = isArabic(text) ? 'ar' : 'fr';
    states.set(tgId, st);
    const langConfirm = st.lang === 'ar'
      ? '🇲🇦 <b>واخا — العربية!</b>'
      : '🇫🇷 <b>Parfait — français !</b>';
    await sendMessage(chatId, langConfirm);
    // Passer directement à "nouveau ou ancien"
    st.step = 'client_type';
    states.set(tgId, st);
    const prompt = st.lang === 'ar'
      ? '🎁 <b>جرب AdFill مجانا 7 أيام!</b>\n\nواش عندك أصلاً حساب معانا ولا غادي تبدا من الصفر ؟'
      : '🎁 <b>Essaie AdFill gratuitement 7 jours !</b>\n\nTu as déjà un compte ou tu commences ?';
    await sendMessage(chatId, prompt, clientTypeKeyboard(st.lang));
    return;
  }

  // ---- ÉTAPE 2 : Nouveau ou ancien client (géré par callbacks uniquement) ----
  if (st.step === 'client_type') {
    // Réafficher les boutons si l'utilisateur tape au lieu de cliquer
    const prompt = st.lang === 'ar'
      ? '🎁 <b>جرب AdFill مجانا 7 أيام!</b>\n\nواش عندك أصلاً حساب معانا ولا غادي تبدا من الصفر ؟'
      : '🎁 <b>Essaie AdFill gratuitement 7 jours !</b>\n\nTu as déjà un compte ou tu commences ?';
    await sendMessage(chatId, prompt, clientTypeKeyboard(st.lang));
    return;
  }

  // ---- Saisie du téléphone (nouveau client) ----
  if (st.step === 'phone') {
    const phoneDigits = text.replace(/\D/g, '');
    if (phoneDigits.length < 8) {
      await sendMessage(chatId, MSG.invalidPhone(st.lang));
      return;
    }
    const existingPhone = findTesterByPhone(text);
    if (existingPhone && String(existingPhone.telegramId) !== tgId) {
      await sendMessage(chatId, MSG.phoneUsed(st.lang));
      return;
    }

    // Générer et envoyer OTP
    const otp = generateOTP();
    st.step = 'otp';
    st.otp = otp;
    st.phone = text;
    states.set(tgId, st);

    await sendMessage(chatId, MSG.otpSent(st.lang, otp));
    return;
  }

  // ---- Saisie email (nouveau client) ----
  if (st.step === 'email') {
    if (!text.includes('@') || !text.includes('.')) {
      const msg = st.lang === 'ar'
        ? '⚠️ <b>الإيميل ما يبدوش صحيح</b>\n\nأعد الإرسال — مثال : nom@gmail.com'
        : '⚠️ <b>L\'email ne semble pas valide</b>\n\nRéessaie — Ex : nom@gmail.com';
      await sendMessage(chatId, msg);
      return;
    }
    st.email = text;
    st.step = 'phone';
    states.set(tgId, st);
    const msg = st.lang === 'ar'
      ? '✅ <b>تم تسجيل الإيميل!</b>\n\n📞 دابا أرسل <b>رقم التيليفون ديالك</b> (مع الكود الدولي) :\n\n(باش نأكدو حسابك — سريع وم secure 🔒)'
      : '✅ <b>Email enregistré !</b>\n\n📞 Maintenant, envoie ton <b>numéro de téléphone</b> (avec indicatif pays) :\n\n(Pour sécuriser ton compte — rapide et safe 🔒)';
    await sendMessage(chatId, msg);
    return;
  }

  // ---- Vérification OTP ----
  if (st.step === 'otp') {
    const enteredOtp = text.replace(/\D/g, '');
    if (enteredOtp !== st.otp) {
      await sendMessage(chatId, MSG.otpWrong(st.lang));
      return;
    }

    // OTP valide — sauvegarder
    const testers = loadTesters();
    const idx = testers.findIndex((t) => String(t.telegramId) === tgId);
    const testerData = {
      telegramId: tgId,
      ...(getTester(tgId) || {}),
      phone: st.phone,
      email: st.email || '',
      lang: st.lang,
      updatedAt: new Date().toISOString(),
    };
    if (idx >= 0) testers[idx] = testerData; else testers.push(testerData);
    saveTesters(testers);

    st.step = 'name';
    st.otp = null;
    states.set(tgId, st);

    await sendMessage(chatId, MSG.otpOk(st.lang));
    return;
  }

  // ---- Saisie du nom ----
  if (st.step === 'name') {
    if (text.length < 2) {
      await sendMessage(chatId, MSG.invalidName(st.lang));
      return;
    }
    const testers = loadTesters();
    const idx = testers.findIndex((t) => String(t.telegramId) === tgId);
    const tester = testers[idx];
    tester.name = text;
    tester.lang = st.lang;
    tester.events = tester.events || [];
    tester.events.push({ date: new Date().toISOString(), event: 'registered' });
    saveTesters(testers);
    logEvent(tester, 'activation', { phone: tester.phone, name: text, email: tester.email, lang: st.lang });

    st.step = 'platform';
    states.set(tgId, st);

    const askPlatform = st.lang === 'ar'
      ? '🔥 <b>واخا بزاف خدام!</b> مرحبا بيك <b>' + text + '</b> — آخر خطوة!\n\n📱 واش كتستعمل <b>Android</b> ولا <b>Windows</b> ؟'
      : '🔥 <b>Presque fini !</b> Merci <b>' + text + '</b> — dernière étape !\n\n📱 Tu utilises <b>Android</b> ou <b>Windows</b> ?';
    await sendMessage(chatId, askPlatform, platformKeyboardFr());
    return;
  }

  // ---- Saisie de la clé ----
  if (st.step === 'key') {
    const trimmed = text.trim();
    if (!trimmed) return;
    await sendMessage(chatId, MSG.keyVerifying(st.lang));
    const result = await validateLicenseKey(trimmed);

    const testers = loadTesters();
    const tester = testers.find((t) => String(t.telegramId) === tgId);

    if (result && result.valid) {
      tester.licenseKeyHash = hashKey(trimmed);
      tester.licenseValid = true;
      tester.licensePack = result.pack_slug || '';
      saveTesters(testers);
      logEvent(tester, 'license_ok', { pack: tester.licensePack });
      await sendMessage(chatId, MSG.keyValid(st.lang, result.pack_slug));
    } else {
      const err = (result && result.error) || (st.lang === 'ar' ? 'مفتاح خايب' : 'Clé invalide');
      tester.licenseKeyHash = hashKey(trimmed);
      tester.licenseValid = false;
      saveTesters(testers);
      logEvent(tester, 'license_invalid', { error: err });
      await sendMessage(chatId, MSG.keyInvalid(st.lang, err), keyKeyboard());
      states.set(tgId, { step: 'key', platform: st.platform, lang: st.lang });
      return;
    }

    tester.platform = st.platform;
    states.set(tgId, { step: 'done', platform: st.platform, lang: st.lang });
    await unlock(chatId, tester);
    return;
  }

  // ---- Ancien client : vérification téléphone ----
  if (st.step === 'verify_old') {
    const phoneDigits = text.replace(/\D/g, '');
    const testers = loadTesters();
    const match = testers.find((t) => String(t.phone || '').replace(/\D/g, '') === phoneDigits && t.platform);

    if (!match) {
      const msg = st.lang === 'ar'
        ? '❌ هاد الرقم ما مسجلش عندنا. تأكد من الرقم أو تواصل مع الدعم.\n\nأرسل /start باش تبدا من جديد.'
        : '❌ Ce numéro n\'est pas enregistré chez nous. Vérifie le numéro ou contacte le support.\n\nTape /start pour recommencer.';
      await sendMessage(chatId, msg);
      return;
    }

    // Trouvé ! Donner accès
    match.lastLogin = new Date().toISOString();
    saveTesters(testers);
    logEvent(match, 'login_verified', { phone: match.phone });

    states.set(tgId, { step: 'done', platform: match.platform, lang: st.lang });
    await unlock(chatId, match);
    return;
  }

  // ---- Choix du pack (clé) ----
  if (st.step === 'key_choice') {
    // Ignorer le texte, gérer par callbacks
    return;
  }

  // ---------------- Fallback : détection intelligente + IA Groq ----------------
  if (text && !text.startsWith('/')) {
    const lang = st.lang || 'fr';
    const lowerText = text.toLowerCase();

    // Détection demande de téléchargement
    const downloadKeywords = ['télécharger', 'telecharger', 'download', 'apk', 'exe', 'lien', 'liens',
      'حمّل', 'تحميل', 'رابط', 'روابط', 'تنزيل', ' link', 'get', 'envoi', 'envoyer'];
    const isDownloadRequest = downloadKeywords.some((kw) => lowerText.includes(kw));

    if (isDownloadRequest && existing && existing.platform) {
      await unlock(chatId, existing);
      return;
    }

    if (isDownloadRequest && (!existing || !existing.platform)) {
      const msg = lang === 'ar'
        ? '🚀 <b>تريد تحمل AdFill؟</b> مرحبا!\n\n🎁 <b>جرب مجانا 7 أيام</b> — بلا ما needing بطاقة بنكية\n\n📋 أرسل <b>/start</b> باش تبدا التسجيل وتحصل على الروابط مباشرة!'
        : '🚀 <b>Tu veux télécharger AdFill ?</b> Bienvenue !\n\n🎁 <b>Essaie gratuitement 7 jours</b> — sans carte bancaire\n\n📋 Tape <b>/start</b> pour t\'inscrire et recevoir les liens !';
      await sendMessage(chatId, msg);
      return;
    }

    // Détection problème / aide
    const helpKeywords = ['installer', 'installation', 'marche pas', 'problème', 'erreur', 'crash',
      'تثبيت', 'ما خدامش', 'مشكلة', 'خطأ', 'bug', 'aide', 'comment'];
    const isHelpRequest = helpKeywords.some((kw) => lowerText.includes(kw));

    if (isHelpRequest) {
      const msg = lang === 'ar'
        ? '🔧 <b>كناوين نعاونوك!</b>\n\n🔄 أعد تشغيل التطبيق\n✅ تأكد أن Android/Windows محدث\n📧 تواصل معنا : adfillpro@gmail.com\n\n✍️ كتب وصفا مفصلا للمشكلة وغادي نجاوبك!'
        : '🔧 <b>On est là pour t\'aider !</b>\n\n🔄 Redémarre l\'application\n✅ Vérifie que ton OS est à jour\n📧 Contacte-nous : adfillpro@gmail.com\n\n✍️ Décris ton problème en détail et on te répond !';
      await sendMessage(chatId, msg);
      return;
    }

    // Détection abus
    const abusePatterns = ['hack', 'crack', 'free premium', 'pirate', '123', 'abc', 'test test'];
    const isAbuse = abusePatterns.some((p) => lowerText.includes(p));

    if (isAbuse) {
      const msg = lang === 'ar'
        ? '🤔 واش كت testa البوت؟ AdFill متاح للجميع!\n📥 أرسل /start باش تحمل'
        : '🤔 Tu testes le bot ? AdFill est pour tous !\n📥 Tape /start pour télécharger';
      await sendMessage(chatId, msg);
      return;
    }

    // IA Groq
    const reply = await askAI(text, tgId);
    if (reply) {
      const safe = reply.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      await sendMessage(chatId, safe);
      return;
    }
  }

  await sendMessage(chatId, MSG.fallback(st.lang || 'fr'));
}

// ---------------- Callbacks (boutons inline) ----------------
async function handleCallback(query) {
  const chatId = query.message.chat.id;
  const tgId = String(query.from.id);
  const data = query.data;
  const existing = getTester(tgId);
  const st = states.get(tgId) || { step: 'start' };

  // Acknowledgement du clic
  await callApi('answerCallbackQuery', { callback_query_id: query.id });

  // ---- Choix langue ----
  if (data === 'lang:fr' || data === 'lang:ar') {
    st.lang = data === 'lang:ar' ? 'ar' : 'fr';
    st.step = 'client_type';
    states.set(tgId, st);
    await sendMessage(chatId,
      st.lang === 'ar' ? 'اخترت العربية ! 🇲🇦' : 'Français choisi ! 🇫🇷'
    );
    const msg = st.lang === 'ar'
      ? 'واش نتا عميل جديد فـ AdFill walla خدام معانا أصلاً؟'
      : 'Es-tu un nouveau client AdFill ou tu utilises déjà l\'application ?';
    await sendMessage(chatId, msg, clientTypeKeyboard(st.lang));
    return;
  }

  // ---- Nouveau ou ancien client ----
  if (data === 'client:new') {
    const lang = st.lang || 'fr';
    st.step = 'email';
    states.set(tgId, st);
    const msg = lang === 'ar'
      ? '🎉 <b>مرحبا بيك!</b> تسجيل سريع وسلس.\n\n📧 أرسل <b>الإيميل ديالك</b> :\n\n(باش نصيفطولك آخر الأخبار والتحديثات)'
      : '🎉 <b>Bienvenue !</b> Inscription rapide.\n\n📧 Envoie ton <b>email</b> :\n\n(Pour recevoir les dernières actualités et mises à jour)';
    await sendMessage(chatId, msg);
    return;
  }

  if (data === 'client:old') {
    const lang = st.lang || 'fr';
    st.step = 'verify_old';
    states.set(tgId, st);
    const msg = lang === 'ar'
      ? '🔄 <b>أهلا من جديد!</b>\n\n📞 أرسل <b>رقم التيليفون</b> ديالك المسجل عندنا باش نتحقق من حسابك :'
      : '🔄 <b>Bon retour parmi nous !</b>\n\n📞 Envoie le <b>numéro de téléphone</b> enregistré chez nous pour vérifier ton compte :';
    await sendMessage(chatId, msg);
    return;
  }

  // ---- Choix plateforme ----
  if (data === 'pick:android' || data === 'pick:windows') {
    const platform = data.split(':')[1];
    const lang = st.lang || 'fr';

    // Si déjà inscrit (a un téléphone), juste changer la plateforme et donner accès
    if (existing && existing.phone) {
      existing.platform = platform;
      const testers = loadTesters();
      const idx = testers.findIndex((t) => String(t.telegramId) === tgId);
      if (idx >= 0) testers[idx] = existing;
      saveTesters(testers);
      st.step = 'done';
      st.platform = platform;
      states.set(tgId, st);
      logEvent(existing, 'pick', { platform });
      await unlock(chatId, existing);
      return;
    }

    // Nouveau client qui vient de s'inscrire → on a déjà le téléphone, on passe à la clé
    const testers = loadTesters();
    const idx = testers.findIndex((t) => String(t.telegramId) === tgId);
    if (idx >= 0) {
      testers[idx].platform = platform;
      saveTesters(testers);
    }
    st.platform = platform;
    st.step = 'done';
    states.set(tgId, st);
    logEvent({ telegramId: tgId }, 'pick', { platform });
    await unlock(chatId, { telegramId: tgId, platform, lang, ...(existing || {}) });
    return;
  }

  // ---- Clé de licence ----
  if (data === 'key:yes') {
    const lang = st.lang || 'fr';
    st.step = 'key';
    states.set(tgId, st);
    const msg = lang === 'ar'
      ? '🔑 أرسل <b>مفتاح الترخيص ديالك</b> (مثال : ADFILL-XXXX-XXXX) :'
      : '🔑 Envoie ta <b>clé de licence</b> (ex : ADFILL-XXXX-XXXX) :';
    await sendMessage(chatId, msg);
    return;
  }

  if (data === 'key:no') {
    const lang = st.lang || 'fr';
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
    const msg = lang === 'ar'
      ? '⏭️ واخا ! حسابك مسجل. المفتاح اختياري — تقدر تجرب التطبيق بلا ماش.'
      : '⏭️ Pas de problème ! Ton compte est enregistré. La clé est optionnelle — tu peux tester l\'app.';
    await sendMessage(chatId, msg);
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
    const catLabel = lang === 'ar' && cat.ar_label ? cat.ar_label : cat.label;
    const chooseQ = lang === 'ar' ? 'اختر سؤالاً :' : 'Choisissez une question :';
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
    const answer = lang === 'ar' && q.ar_answer ? q.ar_answer : q.answer;
    const catLabel = lang === 'ar' && cat.ar_label ? cat.ar_label : cat.label;
    const backLabel = lang === 'ar' ? 'العودة إلى ' + catLabel : '◀️ Retour à ' + catLabel;
    const homeLabel = lang === 'ar' ? '🏠 قائمة المساعدة' : '🏠 Menu aide';
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

  await sendMessage(chatId, MSG.unknownCmd(st.lang || 'fr'));
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

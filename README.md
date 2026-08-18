# AdFill Telegram Bot — Déploiement Railway

## Prérequis
- Compte GitHub (pour push le code)
- Compte Railway (https://railway.app) — gratuit 500h/mois

## Étapes de déploiement

### 1. Créer un repo GitHub dédié
```bash
# Créer un nouveau repo sur GitHub (ex: AdFillBot)
# Pushez ce dossier dedans
```

### 2. Push le code
```bash
cd deploy-railway
git init
git add .
git commit -m "AdFill Bot v1.0"
git remote add origin https://github.com/VOTRE_UTILISATEUR/AdFillBot.git
git push -u origin main
```

### 3. Déployer sur Railway
1. Aller sur https://railway.app
2. Cliquer "New Project" → "Deploy from GitHub repo"
3. Sélectionner le repo `AdFillBot`
4. Railway détecte automatiquement le `Procfile`

### 4. Ajouter les variables d'environnement
Dans Railway → Variables :
```
TG_BOT_TOKEN=votre_token_bot
GROQ_API_KEY=votre_cle_groq
SUPABASE_URL=https://votre-projet.supabase.co
SUPABASE_ANON_KEY=votre_anon_key
```

### 5. Activer le service
- Railway démarre automatiquement le bot
- Le bot tourne 24/7 (500h/mois gratuites)

## Structure des fichiers
```
deploy-railway/
├── bot.js           # Bot principal (adapté pour cloud)
├── config.json      # Configuration du bot
├── faq.json         # Base de connaissances
├── package.json     # Dépendances Node.js
├── Procfile         # Commande de démarrage
├── .env.example     # Template variables
└── README.md        # Ce fichier
```

## Limites gratuites
- **500 heures/mois** de temps CPU
- **512 MB RAM**
- **休眠 après 30 min d'inactivité** (mais le bot continue via polling)

## Pour mettre à jour
1. Modifier `bot.js` ou `config.json` localement
2. `git push` → Railway redéploie automatiquement

## Variables d'environnement
| Variable | Description | Obligatoire |
|---|---|---|
| `TG_BOT_TOKEN` | Token du bot Telegram | ✅ Oui |
| `GROQ_API_KEY` | Clé API Groq (IA) | ❌ Optionnel |
| `SUPABASE_URL` | URL Supabase | ❌ Optionnel |
| `SUPABASE_ANON_KEY` | Clé ANON Supabase | ❌ Optionnel |

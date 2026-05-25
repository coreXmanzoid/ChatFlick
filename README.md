# ChatFlick 🐦

> A modern full-stack social microblogging platform — share thoughts, follow people, engage with AI, and manage everything through a polished admin dashboard.

## 🔗 Live Demo
**https://chatflick.pythonanywhere.com**

<br>

![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=flat-square&logo=python&logoColor=white)
![Flask](https://img.shields.io/badge/Flask-2.x-000000?style=flat-square&logo=flask&logoColor=white)
![SQLAlchemy](https://img.shields.io/badge/SQLAlchemy-ORM-red?style=flat-square)
![Firebase](https://img.shields.io/badge/Firebase-Push_Notifications-FFCA28?style=flat-square&logo=firebase&logoColor=black)
![Cloudinary](https://img.shields.io/badge/Cloudinary-Media_Storage-3448C5?style=flat-square)
![Groq](https://img.shields.io/badge/Groq-AI_Powered-FF6B35?style=flat-square)

---

## ✨ Features

### 🔐 Authentication
- Email & password signup with CAPTCHA (Cloudflare Turnstile)
- Google OAuth 2.0 login via Authlib / OpenID Connect
- Email verification with 20-minute time-limited signed tokens
- Secure password reset via emailed link (same response for existing/non-existing emails — anti-enumeration)
- "Remember me" session persistence (plan-gated: Pro+ only)

### 📝 Posts & Feed
- Create, edit (within plan window), and delete posts
- Automatic hashtag extraction (stored separately for discovery)
- `@mention` parsing with structured JSON storage
- Home feed: **For You** (random) and **Following** tabs
- Infinite scroll with server-side pagination and exclude-IDs deduplication
- Like, repost, share, and comment on posts
- Milestone notifications at 100 / 1K / 10K likes, reposts, and comments
- Post visibility controlled by `status` field (`ACTIVE` / `REMOVED`)

### 👥 Social Graph
- Follow / unfollow with duplicate-follow prevention
- Follower and following counts on profiles
- Explore page: random accounts, follower/following lists, username search (ordered by follower count)
- Plan-gated max following limit

### 🔔 Notifications
- In-app notification inbox (15 most recent, history window plan-gated)
- Firebase Cloud Messaging (FCM) push notifications via `firebase-admin`
- Deduplication for repeat events (likes, follows) via `update_or_create`
- `@mention` notifications for posts and comments
- Self-notification suppression
- Stale/invalid FCM token auto-removal on send failure
- Health check route at `/notification-health`
- Test push route at `/notification-test-push`

### 🤖 Manzoid-AI (FlickAI)
- Groq-powered AI assistant (LLaMA 3.1 8B Instant)
- Authenticated chat with per-user in-memory conversation history (plan-gated depth)
- Daily request limit enforced server-side via user settings
- Message length limit enforced per plan
- Public stateless endpoint at `/api_chat`
- AI also powers auto-replies for support ticket submissions
- Full ChatFlick knowledge base injected as context from `ChatFlick.json`

### ⚙️ Settings (7 sections)
- Profile: name, username, contact, bio, profile picture (Cropper.js + Cloudinary)
- Account info: email, birthday, website, about
- Change password with strength validation
- Privacy: private account, show birthdate, show bio, show follower counts
- Notifications: push, email, new followers, mentions, likes/comments, reposts
- Support & Help: theme (light/dark), data download, report a problem, help center with FAQ
- Danger Zone: deactivate (reversible) or permanently delete account

### 💳 Payments & Subscription
- Three tiers: **Free**, **Pro** ($12/mo), **Enterprise** ($49/mo)
- Feature gating driven by `subscription.json` — no hardcoded limits in app code
- Payment submission flow (manual verification): JazzCash, Easypaisa, bank transfer
- Screenshot upload stored in `instance/payment_screenshots/`
- Admin reviews payments and approves/rejects Pro access
- `PENDING_PRO` status set on submission; upgraded to `PRO` on admin approval
- Unique transaction ID constraint prevents duplicate submissions

### 🛡️ Admin Dashboard (`/admin`)
- Full SPA with Bootstrap modals (no page reloads)
- **Support requests**: view, reply inline, generate AI reply, mark answered
- **User reports**: view, mark reviewed
- **Post reports**: view reported content, warn author, remove post, mark reviewed
- **Payments**: inspect screenshot, approve/reject Pro with optional admin note
- **Users**: filter by status, select for management panel, verify, approve/reject Pro, warn (auto-blocks at 3 warnings), block/unblock
- **Dashboard metrics**: total users, verified, blocked, pending Pro, support/report/payment pending counts
- **SQLite backup/restore**: download consistent backup, upload & merge without overwriting existing rows
- Protected by `@login_required + @verified_user + @only_admin` (hardcoded admin usernames: `coreXmanzoid`, `manza`)

### 📱 Mobile UI
- Dedicated mobile layout at `/mobile-home`, auto-detected via User-Agent regex
- Bottom navigation: Home, Search, More, FlickAI, Profile
- Full-post bottom-sheet overlay with comments
- More menu grid: Settings, About, Terms, Liked Posts, Logout, Switch Account, Help
- Mobile-native share API with clipboard fallback
- Mobile report sheet for post reporting
- Mobile toast notifications system

---

## 🗂️ Project Structure

```
ChatFlick/
├── app/
│   ├── models/          # SQLAlchemy models
│   │   ├── users.py         # UserData (settings JSON, subscription_plan property)
│   │   ├── posts.py         # Post (status field for moderation)
│   │   ├── comments.py      # Comments
│   │   ├── follows.py       # Follow
│   │   ├── notifications.py # Notification
│   │   ├── support_requests.py
│   │   ├── report.py        # User reports
│   │   ├── report_post.py   # Post reports (reason, admin_action)
│   │   └── payment.py       # PaymentSubmission
│   ├── routes/          # Flask Blueprints
│   │   ├── auth_routes.py
│   │   ├── main_routes.py      # Home, mobile, PWA manifest, SW, SQLite backup
│   │   ├── post_routes.py
│   │   ├── comment_routes.py
│   │   ├── profile_routes.py
│   │   ├── account_routes.py   # Follow/unfollow, logout, explore
│   │   ├── notification_routes.py
│   │   ├── setting_routes.py
│   │   ├── admin_routes.py
│   │   ├── pricing_routes.py   # Payment page & submission
│   │   ├── ai_routes.py
│   │   └── report_routes.py    # Post report creation
│   ├── services/        # Business logic layer
│   │   ├── auth_service.py
│   │   ├── admin_service.py    # All admin operations + serializers
│   │   ├── ai_service.py       # Groq chat, support AI, knowledge base
│   │   ├── account_service.py
│   │   ├── captcha_service.py
│   │   ├── cloudinary_service.py
│   │   ├── comment_service.py
│   │   ├── data_downloading_service.py
│   │   ├── email_service.py
│   │   ├── feed_service.py
│   │   ├── follow_service.py
│   │   ├── google_auth_service.py
│   │   ├── notification_service.py
│   │   ├── post_action_service.py
│   │   ├── post_service.py     # Plan-aware create/edit/delete
│   │   ├── push_service.py     # FCM send + diagnostic
│   │   ├── report_service.py
│   │   └── setting_service.py
│   ├── utils/
│   │   ├── mentions.py
│   │   ├── subscription_manager.py   # Feature gating from subscription.json
│   │   ├── time_utils.py
│   │   └── username.py
│   ├── firebase/        # Firebase Admin SDK init
│   ├── cloudinary/      # Cloudinary config
│   ├── oauth/           # Google OAuth setup
│   ├── auth.py          # Flask-Login user_loader
│   ├── decorators.py    # verified_user, pro_user, only_admin
│   └── extensions.py    # db, login_manager, oauth instances
├── templates/           # Jinja2 HTML templates
├── static/
│   ├── css/
│   │   ├── styles.css / styles01.css  # Main app styles
│   │   ├── mobile.css
│   │   ├── setting.css  # Light/dark themed settings
│   │   ├── admin.css
│   │   ├── AI.css
│   │   ├── pro.css      # Pricing page
│   │   └── payment.css
│   └── js/
│       ├── home.js          # Desktop SPA (infinite scroll, all post actions)
│       ├── mobile-home.js   # Mobile SPA equivalent
│       ├── setting.js       # Settings + Cropper.js integration
│       ├── admin.js         # Admin SPA with full CRUD
│       ├── firebase-client.js  # FCM token management, push enablement
│       ├── signup.js
│       └── resetPassword.js
├── subscription.json    # Feature/limit definitions for all plans
├── ChatFlick.json       # App knowledge base for Manzoid-AI context
├── main.py              # App entry point
└── requirements.txt
```

---

## 🚀 Getting Started

### Prerequisites
- Python 3.10+
- PostgreSQL or SQLite database
- Cloudinary account
- Firebase project (for push notifications)
- Groq API key
- Google OAuth credentials (optional)
- Cloudflare Turnstile site/secret keys

### Installation

```bash
# 1. Clone the repo
git clone https://github.com/your-username/chatflick.git
cd chatflick

# 2. Create and activate a virtual environment
python -m venv venv
source venv/bin/activate       # Windows: venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt
```

### Environment Variables

Create a `.env` file in the project root:

```env
# App
SECRET_KEY=your-secret-key

# Database
SQLALCHEMY_DATABASE_URI=sqlite:///ChatFlick.db
# SQLALCHEMY_DATABASE_URI=postgresql://user:pass@host/dbname

# Email (Gmail SMTP)
EMAIL=your-email@gmail.com
EMAIL_PASSWORD=your-gmail-app-password
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USE_TLS=true
SMTP_USE_SSL=false

# Google OAuth
CLIENT_ID=your-google-client-id
CLIENT_SECRET=your-google-client-secret

# Cloudinary
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret

# Firebase
FIREBASE_SERVICE_ACCOUNT=path/to/service-account.json
FCM_VAPID_KEY=your-vapid-key
FIREBASE_API_KEY=your-firebase-api-key
FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
FIREBASE_MESSAGING_SENDER_ID=your-sender-id
FIREBASE_APP_ID=your-web-app-id
FIREBASE_MEASUREMENT_ID=your-measurement-id
PUBLIC_BASE_URL=https://yourusername.pythonanywhere.com

# Groq AI
GROQ_API_KEY=your-groq-api-key

# Cloudflare Turnstile CAPTCHA
CLOUDFARE_SECRET_KEY=your-turnstile-secret
```

### Run the App

```bash
python main.py
```

The app is available at `http://localhost:5000`.

### Notification Setup

After deployment:
- Visit `/notification-health` (while logged in) to verify Firebase Admin, VAPID key, web config, HTTPS, and saved token status.
- POST to `/notification-test-push` (while logged in) to send a test push to your current browser token.

---

## 🧩 Tech Stack

| Layer | Technology |
|---|---|
| Backend | Flask, SQLAlchemy, Flask-Login, Authlib |
| Database | PostgreSQL (production) / SQLite (development) |
| Frontend | Jinja2, Bootstrap 5, jQuery, Bootstrap Icons |
| Media Storage | Cloudinary |
| Push Notifications | Firebase Cloud Messaging (firebase-admin) |
| AI Assistant | Groq API (LLaMA 3.1 8B Instant) |
| CAPTCHA | Cloudflare Turnstile |
| Image Cropping | Cropper.js |
| Email | Gmail SMTP (MIMEMultipart HTML) |
| OAuth | Google OpenID Connect (Authlib) |

---

## 📸 Key Pages

| Route | Description |
|---|---|
| `/` | Landing page |
| `/home` | Main feed — auto-redirects to mobile UI if mobile User-Agent detected |
| `/mobile-home` | Dedicated mobile SPA |
| `/profile/<id>` | User profile with posts, reposts, likes, about tabs |
| `/notifications` | Notification inbox |
| `/Manzoid-AI` | AI chat assistant (authenticated) |
| `/setting` | Account settings (7 sections) |
| `/pricing` | Pricing tiers with monthly/yearly toggle |
| `/payment` | Pro upgrade payment form |
| `/admin` | Admin dashboard SPA |
| `/about` | About page |
| `/privacy-policy` | Privacy policy |
| `/terms-of-service` | Terms of service |

---

## 🔒 User Status Levels

| Status | Description |
|---|---|
| `UNVERIFIED` | Newly registered — cannot follow, comment, upload photos, or receive mention notifications |
| `VERIFIED` | Email confirmed — full platform access |
| `PRO` | Premium user — verified badge, extended limits, edit posts, multi-device login |
| `ENTERPRISE` | Highest tier — unlimited posts, AI, feed; read-only admin analytics |
| `PENDING_PRO` | Payment submitted, awaiting admin verification |
| `DEACTIVED` | Temporarily deactivated by user — data preserved, reactivates on login |
| `BLOCKED` | Restricted by admin (or auto-blocked after 3 warnings) — most features disabled |

---

## 📦 Subscription Plans

Feature gating is driven entirely by `subscription.json` — no limits are hardcoded in application logic. The `subscription_manager.py` utility reads this file and exposes `has_feature()`, `get_limit()`, and `is_unlimited()` helpers used throughout routes and services.

| Feature | Free | Pro | Enterprise |
|---|---|---|---|
| Post length | 180 chars | 230 chars | Unlimited |
| Posts per day | 10 | 50 | Unlimited |
| Edit window | ❌ | 3 min | 10 min |
| Following feed limit | 10 posts | 50 posts | Unlimited |
| AI message length | 100 chars | 130 chars | Unlimited |
| AI conversation memory | 0 exchanges | 8 exchanges | Unlimited |
| AI requests/day | 5 | 100 | Unlimited |
| Profile image resolution | 256×256 | 512×512 | 1024×1024 |
| Verified badge | ❌ | ✅ Pro badge | ✅ Enterprise badge |
| Multi-device login | ❌ | ✅ | ✅ |
| Remember me | ❌ | ✅ (7 days) | ✅ (30 days) |

---

## 🤝 Contributing

Pull requests are welcome. For major changes, open an issue first.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License.

---

<p align="center">Built with ❤️ by <strong>coreXmanzoid</strong> — M. Hammad Ashraf</p>

# Angry Mod — License Server

A complete license key management server for Angry Mod APK.

## Deploy on Render.com

1. Push this folder to a **GitHub repo**
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your GitHub repo
4. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment Variable:** `ADMIN_PASSWORD` = your password

## API Endpoints (APK uses these)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/hdshrs.php` | Server status check |
| POST | `/hdshrs.php` | Key validation (body: `username`, `key`) |
| GET | `/connect` | Connection check |

## Admin Panel

Visit `https://your-render-url/admin.html`

Default password: `admin@angry123`  
**Change it via Render Environment Variables → `ADMIN_PASSWORD`**

## APK Request Format

The APK sends POST to `/hdshrs.php` with:
```json
{ "username": "player123", "key": "ANGRY-XXXX-YYYY" }
```

Server responds:
```json
{ "status": true, "message": "Login successful!", "username": "player123", "expiry": "Lifetime", "plan": "Standard" }
```
or on failure:
```json
{ "status": false, "message": "Invalid key or username." }
```

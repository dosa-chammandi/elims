# Deployment Guide

Production-ready deployment for the ELIMS Node.js server.

## Prerequisites

- Node.js 20+
- A host that supports persistent disk (Render, Fly, Railway, VPS)
  — **Netlify is not supported** (it's static-only)

## 1. Local production-mode test

```bash
cp .env.example .env
# Generate admin password hash
npm run hash-password -- "ChangeThisStrongPassword!"
# Paste the printed ADMIN_PASS_HASH=... into .env
# Generate a session secret
openssl rand -hex 32
# Paste it as SESSION_SECRET=... in .env

NODE_ENV=production node server.js
```

Verify:
- `http://localhost:8080/healthz` → `{"status":"ok",...}`
- `/admin/login` requires the new password
- Old `elims@2026` no longer works (when ADMIN_PASS_HASH is set)

## 2. Deploy to Render.com (recommended)

1. Push this repo to GitHub.
2. In Render: **New +** → **Blueprint** → pick the repo.
3. Render reads `render.yaml` and provisions the service + 1 GB persistent disk.
4. After the first deploy, set these env vars in the Render dashboard:
   - `ADMIN_PASS_HASH` — output of `npm run hash-password -- "your-password"`
   - `SMTP_USER`, `SMTP_PASS` — Gmail app password or SendGrid creds
5. (Optional) Connect a custom domain in Render → Settings → Custom Domains.

**Persistent storage notes:**
- `data/` (applications.json, site-content.json) is mounted on the disk.
- Uploaded media in `assets/images/managed/` is **not** on the disk by default — for media durability, change `mountPath` in `render.yaml` to `/opt/render/project/src/assets/images/managed` **or** migrate to S3/R2 (Option B).

## 3. CI / CD

- `.github/workflows/ci.yml` runs on every push and PR:
  - Syntax check (`node --check`)
  - `npm audit` (high+ vulns)
  - Boots the server and runs `test/e2e.js` (35 tests)
- Render auto-deploys when CI passes on the configured branch (`autoDeploy: true` in `render.yaml`).

## 4. Operations

| Task | Command |
|---|---|
| Health check | `curl https://yourdomain/healthz` |
| Reset admin password | `npm run hash-password -- "NewPassword"` → update env → restart |
| View logs | Render dashboard → Logs |
| Backup | Render → Disks → Snapshot (configure daily) |

## 5. Security checklist

- [x] `helmet` security headers
- [x] `express-rate-limit` on `/admin/login` (10/15 min) and `/submit-application` (30/hr)
- [x] `bcrypt` admin password
- [x] `secure` cookies in production
- [x] `trust proxy` behind Render LB
- [x] Magic-byte MIME validation for uploads
- [x] 30 MB upload size limit
- [ ] Move uploads to S3/R2 (Option B — for multi-instance scaling)
- [ ] Replace JSON storage with SQLite/Postgres (Option B)
- [ ] Enable Render daily disk snapshots

## 6. Rolling back

Render keeps every deploy. To roll back:
1. Render → Deploys → pick a previous green deploy → **Rollback**.

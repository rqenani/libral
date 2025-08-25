# Deploy në Render

**Opsioni 1 (pa Docker):**
- New + → **Web Service** → zgjidh repo-n.
- Environment: **Node**.
- Build Command: `npm install`
- Start Command: `npm start`
- Env Vars: `DATA_DIR=/var/data`
- Disk: add persistent disk → **/var/data** 1GB
- Health Check: `/api/diag`

**Opsioni 2 (me Dockerfile):**
- New + → **Web Service** → Advanced → Docker → përdor Dockerfile-n në root.
- Env Var: `DATA_DIR=/app/data` (e njëjta si Dockerfile).

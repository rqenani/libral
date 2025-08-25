# Deploy në Railway

1. Krijo projekt → **New Service → GitHub Repo** (ngarko këtë repo).
2. Nuk ka nevojë për Dockerfile (opsionale). Railway do detektojë Node.
3. **Variables** → shto:
   - `DATA_DIR=/app/data`
4. **Volumes** → Add volume → mount path **/app/data** (p.sh. 1GB).
5. **Start Command**: `npm start` (nga root).
6. Opsional **Healthcheck**: `/api/diag`.

> Nëse do Docker: thjesht zgjidh Dockerfile-n që vjen në repo.

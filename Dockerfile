# Bibloteka (SQLite) — Docker
FROM node:20-bullseye-slim

WORKDIR /app

# Copy only server subdir to keep image small
COPY server ./server

# Install deps in server/
RUN npm --prefix server ci || npm --prefix server install

# Persistent data dir
ENV DATA_DIR=/app/data
RUN mkdir -p /app/data

EXPOSE 8080

CMD ["node","server/server.js"]

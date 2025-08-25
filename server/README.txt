# Bibloteka (SQLite only)

## Si të nisesh lokalisht
```
cd server
npm i
npm start   # http://localhost:8080
```

## Railway
- ENV: `DATA_DIR=/app/data`
- Volume: mount `/app/data`
- Mos vendos `DATABASE_URL`

## API kryesore
- GET /api/diag
- GET /api/ext/openlibrary?query=...&limit=...
- GET /api/ext/google-books?query=...&max=...
- POST /api/books
- GET /api/books?withInventory=1&onlyInStock=1&query=...
- POST /api/inventory
- POST /api/listings
- POST /api/comments
- GET /api/availability?book_id=...
- SSE: GET /api/notifications/stream

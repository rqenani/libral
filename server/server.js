
import fs from 'fs';
import path from 'path';
import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const app = express();
const APP_VERSION = 'rebuilt-2025-08-25';
const PORT = process.env.PORT || 8080;

// --------- DB (SQLite only) ----------
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'bibloteka.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
CREATE TABLE IF NOT EXISTS books(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  author TEXT,
  cover_url TEXT,
  source TEXT DEFAULT 'local',
  external_key TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS inventory(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  quantity INTEGER DEFAULT 0,
  price INTEGER,
  condition TEXT,
  owner_name TEXT,
  owner_phone TEXT,
  owner_email TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS listings(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('sell','rent','digital','buy')),
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  price INTEGER,
  quantity INTEGER,
  condition TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS comments(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_name TEXT,
  text TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS notifications(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inventory_book ON inventory(book_id);
CREATE INDEX IF NOT EXISTS idx_listings_book ON listings(book_id);
CREATE INDEX IF NOT EXISTS idx_comments_book ON comments(book_id);
`);

const run = (sql, params=[]) => db.prepare(sql).run(params);
const all = (sql, params=[]) => db.prepare(sql).all(params);
const get = (sql, params=[]) => db.prepare(sql).get(params);

// --------- SSE Bus (ticker) ----------
const clients = new Set();
function pushNotification(msg) {
  try { run(`INSERT INTO notifications (message) VALUES (?)`, [msg]); } catch {}
  const payload = `event: tick\n` + `data: ${JSON.stringify({ message: msg })}\n\n`;
  for (const c of clients) { try { c.write(payload); } catch {} }
}

app.get('/api/notifications/stream', (req,res)=>{
  res.setHeader('Content-Type','text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control','no-cache, no-transform');
  res.setHeader('Connection','keep-alive');
  res.setHeader('X-Accel-Buffering','no');
  res.flushHeaders?.();
  clients.add(res);
  // initial ping + replay last 10
  res.write(':ok\n\n');
  try {
    const last = all(`SELECT message FROM notifications ORDER BY id DESC LIMIT 10`);
    for (const l of last.reverse()) {
      res.write(`event: tick\n`);
      res.write(`data: ${JSON.stringify({ message: l.message })}\n\n`);
    }
  } catch {}
  const hb = setInterval(()=>{ try{ res.write(':hb\n\n'); }catch{} }, 15000);
  req.on('close', ()=> { clearInterval(hb); clients.delete(res); });
});

// --------- Middleware ----------
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use('/static', express.static(path.join(__dirname, 'public/static'), {
  etag: false, lastModified: false, maxAge: 0,
  setHeaders(res){ res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, private'); }
}));

// --------- External APIs Proxies ----------
app.get('/api/ext/openlibrary', async (req,res)=>{
  try{
    const q = String(req.query.query||'').trim();
    const limit = Math.min(parseInt(req.query.limit||'12',10), 30);
    if(!q) return res.json([]);
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=${limit}&fields=key,title,author_name,cover_i,isbn`;
    const r = await fetch(url);
    if(!r.ok) return res.status(502).json({ error:'openlibrary bad status', status:r.status });
    const data = await r.json();
    const out = (data.docs||[]).map(d=>({
      key: d.key,
      title: d.title || 'Pa titull',
      author: (d.author_name||['I panjohur']).join(', '),
      cover_url: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : ''
    }));
    res.json(out);
  }catch(e){ res.status(500).json({ error:String(e) }); }
});

app.get('/api/ext/google-books', async (req,res)=>{
  try{
    const q = String(req.query.query||'').trim();
    const max = Math.min(parseInt(req.query.max||'10',10), 30);
    if(!q) return res.json([]);
    const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=${max}`;
    const r = await fetch(url);
    if(!r.ok) return res.status(502).json({ error:'google books bad status', status:r.status });
    const data = await r.json();
    const out = (data.items||[]).map(v=>{
      const i = v.volumeInfo||{};
      return {
        key: v.id,
        title: i.title || 'Pa titull',
        author: (i.authors||['I panjohur']).join(', '),
        cover_url: (i.imageLinks && (i.imageLinks.thumbnail||i.imageLinks.smallThumbnail)) || ''
      };
    });
    res.json(out);
  }catch(e){ res.status(500).json({ error:String(e) }); }
});

// --------- Core API ----------
app.get('/api/diag', (req,res)=>{
  let dbStats = {};
  try{
    dbStats = {
      books: get(`SELECT COUNT(*) as c FROM books`).c,
      inventory: get(`SELECT COUNT(*) as c FROM inventory`).c,
      listings: get(`SELECT COUNT(*) as c FROM listings`).c,
      comments: get(`SELECT COUNT(*) as c FROM comments`).c,
      notifications: get(`SELECT COUNT(*) as c FROM notifications`).c
    };
  }catch(e){ dbStats = { error: String(e) }; }
  res.json({ version: APP_VERSION, db: dbStats });
});

app.post('/api/books', (req,res)=>{
  const { title, author, cover_url, source='local', external_key } = req.body||{};
  if(!title) return res.status(400).json({ error:'title required' });
  const r = run(`INSERT INTO books (title,author,cover_url,source,external_key) VALUES (?,?,?,?,?)`,
    [title, author||'', cover_url||'', source, external_key||null]);
  pushNotification(`U shtua libri "${title}"`);
  res.json({ id: r.lastInsertRowid });
});

app.get('/api/books', (req,res)=>{
  const q = String(req.query.query||'').trim();
  const withInventory = String(req.query.withInventory||'0')==='1' || req.query.withInventory==='true';
  const onlyInStock = String(req.query.onlyInStock||'0')==='1' || req.query.onlyInStock==='true';

  let rows = [];
  if(q){
    rows = all(`SELECT * FROM books WHERE title LIKE ? OR author LIKE ? ORDER BY created_at DESC LIMIT 100`, [`%${q}%`,`%${q}%`]);
  } else {
    rows = all(`SELECT * FROM books ORDER BY created_at DESC LIMIT 200`);
  }

  if(withInventory){
    const invAgg = all(`SELECT book_id, SUM(COALESCE(quantity,0)) as qty FROM inventory GROUP BY book_id`);
    const byId = Object.fromEntries(invAgg.map(r=>[r.book_id, r.qty]));
    rows = rows.map(b=>({ ...b, stock_qty: byId[b.id]||0 }));
    if(onlyInStock){
      rows = rows.filter(b=> (b.stock_qty||0) > 0);
    }
  }
  res.json(rows);
});

// Inventory
app.post('/api/inventory', (req,res)=>{
  const { book_id, quantity=0, price=null, condition=null, owner_name=null, owner_phone=null, owner_email=null } = req.body||{};
  if(!book_id) return res.status(400).json({ error:'book_id required' });
  const r = run(`INSERT INTO inventory (book_id,quantity,price,condition,owner_name,owner_phone,owner_email) VALUES (?,?,?,?,?,?,?)`,
    [book_id, quantity, price, condition, owner_name, owner_phone, owner_email]);
  const book = get(`SELECT title FROM books WHERE id=?`, [book_id]);
  pushNotification(`${owner_name||'Dikush'} shtoi në inventar "${book?.title||('ID '+book_id)}" (${quantity} copë)`);
  res.json({ id: r.lastInsertRowid });
});

app.get('/api/inventory/aggregate', (req,res)=>{
  const book_id = parseInt(req.query.book_id||'0',10);
  if(!book_id) return res.status(400).json({ error:'book_id required' });
  const agg = get(`SELECT SUM(COALESCE(quantity,0)) as qty, MIN(price) as min_price, MAX(price) as max_price FROM inventory WHERE book_id=?`, [book_id]) || { qty:0, min_price:null, max_price:null };
  res.json(agg);
});

// Listings
app.post('/api/listings', (req,res)=>{
  const { type, book_id, price=null, quantity=1, condition=null, contact_name=null, contact_phone=null, contact_email=null } = req.body||{};
  if(!type || !book_id) return res.status(400).json({ error:'type and book_id required' });
  if(!['sell','rent','digital','buy'].includes(type)) return res.status(400).json({ error:'bad type' });
  const r = run(`INSERT INTO listings (type,book_id,price,quantity,condition,contact_name,contact_phone,contact_email) VALUES (?,?,?,?,?,?,?,?)`,
    [type, book_id, price, quantity, condition, contact_name, contact_phone, contact_email]);
  const book = get(`SELECT title FROM books WHERE id=?`, [book_id]);
  let action = 'listoi';
  if(type==='sell') action = 'shiti';
  else if(type==='rent') action = 'dha me qera';
  else if(type==='digital') action = 'ofroi';
  else if(type==='buy') action = 'po kërkon';
  pushNotification(`${contact_name||'Dikush'} ${action} librin "${book?.title||('ID '+book_id)}"`);
  res.json({ id: r.lastInsertRowid });
});

app.get('/api/listings', (req,res)=>{
  const book_id = parseInt(req.query.book_id||'0',10);
  let rows = [];
  if(book_id){
    rows = all(`SELECT * FROM listings WHERE book_id=? ORDER BY created_at DESC`, [book_id]);
  } else {
    rows = all(`SELECT * FROM listings ORDER BY created_at DESC LIMIT 100`);
  }
  res.json(rows);
});

// Comments
app.post('/api/comments', (req,res)=>{
  const { book_id, user_name=null, text } = req.body||{};
  if(!book_id || !text) return res.status(400).json({ error:'book_id and text required' });
  const r = run(`INSERT INTO comments (book_id,user_name,text) VALUES (?,?,?)`, [book_id, user_name, text]);
  const book = get(`SELECT title FROM books WHERE id=?`, [book_id]);
  pushNotification(`${user_name||'Një përdorues'} komentoi librin "${book?.title||('ID '+book_id)}"`);
  res.json({ id: r.lastInsertRowid });
});

app.get('/api/comments', (req,res)=>{
  const book_id = parseInt(req.query.book_id||'0',10);
  if(!book_id) return res.status(400).json({ error:'book_id required' });
  const rows = all(`SELECT * FROM comments WHERE book_id=? ORDER BY created_at DESC LIMIT 200`, [book_id]);
  res.json(rows);
});

// Availability (supply + demand)
app.get('/api/availability', (req,res)=>{
  const book_id = parseInt(req.query.book_id||'0',10);
  if(!book_id) return res.status(400).json({ error:'book_id required' });
  const supply = all(`
    SELECT 'inventory' as source, NULL as type, owner_name as name, owner_phone as phone, owner_email as email,
           quantity as quantity, price as price, condition as condition, created_at
    FROM inventory WHERE book_id=? AND quantity>0
    UNION ALL
    SELECT 'listing' as source, type as type, contact_name as name, contact_phone as phone, contact_email as email,
           COALESCE(quantity,1) as quantity, price as price, condition as condition, created_at
    FROM listings WHERE book_id=? AND type IN ('sell','rent','digital') AND COALESCE(quantity,1) > 0
    ORDER BY (price IS NULL), price ASC, quantity DESC, created_at DESC
  `, [book_id, book_id]);
  const demand = all(`
    SELECT 'listing' as source, type as type, contact_name as name, contact_phone as phone, contact_email as email,
           COALESCE(quantity,1) as quantity, price as price, NULL as condition, created_at
    FROM listings WHERE book_id=? AND type='buy'
    ORDER BY created_at DESC
  `, [book_id]);
  res.json({ supply, demand });
});

// --------- Frontend ---------
app.get('/', (req,res)=> res.sendFile(path.join(__dirname, 'public/index.html')));

// --------- Start ----------
app.listen(PORT, ()=>{
  console.log(`Bibloteka (SQLite) gati në port ${PORT}. DB: ${DB_PATH}`);
});

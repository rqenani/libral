
const els = {
  grid: document.getElementById('resultsGrid'),
  noRes: document.getElementById('noResults'),
  search: document.getElementById('searchInput'),
  mainBtn: document.getElementById('mainSearchBtn'),
  onlyStockToggle: document.getElementById('onlyStockToggle'),
  addListingBtn: document.getElementById('addListingBtn'),
  apiSearchInput: document.getElementById('apiSearchInput'),
  apiSearchBtnOL: document.getElementById('apiSearchBtnOL'),
  apiSearchBtnGB: document.getElementById('apiSearchBtnGB'),
  apiLoader: document.getElementById('apiLoader'),
  apiSearchResults: document.getElementById('apiSearchResults'),
  openManualAddBtn: document.getElementById('openManualAddBtn'),
  listingForm: document.getElementById('listingForm'),
  listingBookCover: document.getElementById('listingBookCover'),
  listingBookTitle: document.getElementById('listingBookTitle'),
  listingBookAuthor: document.getElementById('listingBookAuthor'),
  manualAddForm: document.getElementById('manualAddForm'),
  viewListingContent: document.getElementById('viewListingContent'),
};
let currentBookData = null;

function openModal(id){ const m = document.getElementById(id); m.classList.remove('hidden'); setTimeout(()=>{ m.classList.remove('opacity-0'); m.querySelector('.modal-content').classList.remove('scale-95'); }, 10); }
function closeModal(id){ const m = document.getElementById(id); m.classList.add('opacity-0'); m.querySelector('.modal-content').classList.add('scale-95'); setTimeout(()=> m.classList.add('hidden'), 300); }

const API_BASE = '';

async function initialLoad(){
  // default view: show local books (with optional onlyStock)
  await loadLocalBooks();
  setupSSE();
}
async function loadLocalBooks(){
  els.grid.innerHTML = `<div class="col-span-full text-center p-8"><div class="loader ease-linear rounded-full border-4 border-t-4 border-gray-200 h-12 w-12 mx-auto"></div><p class="mt-2 text-gray-500">Duke ngarkuar...</p></div>`;
  els.noRes.classList.add('hidden');
  els.grid.classList.remove('hidden');
  let url = `${API_BASE}/api/books?withInventory=1`;
  if(els.onlyStockToggle && els.onlyStockToggle.checked) url += `&onlyInStock=1`;
  const local = await fetch(url).then(r=>r.json()).catch(()=>[]);
  renderResults(local);
}

function renderResults(list){
  const grid = els.grid, noRes = els.noRes;
  grid.innerHTML = '';
  if(!list || !list.length){
    noRes.classList.remove('hidden');
    grid.classList.add('hidden');
    return;
  }
  noRes.classList.add('hidden');
  grid.classList.remove('hidden');
  list.forEach(item=>{
    const card = document.createElement('div');
    card.className = 'bg-white rounded-xl shadow-md overflow-hidden transform hover:-translate-y-1 transition duration-300 book-card relative';
    const hasStock = (item.stock_qty||0) > 0;
    const badge = hasStock ? `<div class="absolute top-2 left-2 px-2 py-1 text-xs bg-green-500 text-white rounded-full z-10">Në stok</div>` : '';
    const cover = item.cover_url || 'https://placehold.co/400x600/e2e8f0/a0aec0?text=Imazhi+Mungon';
    card.innerHTML = `
      ${badge}
      <img class="h-64 w-full object-cover" src="${cover}" onerror="this.onerror=null;this.src='https://placehold.co/400x600/e2e8f0/a0aec0?text=Imazhi+Mungon';" alt="Kopertina e ${item.title}">
      <div class="p-4">
        <h3 class="font-bold text-lg truncate">${item.title}</h3>
        <p class="text-gray-500 text-sm truncate">${item.author||''}</p>
      </div>
      <div class="absolute inset-0 bg-black bg-opacity-70 flex items-center justify-center opacity-0 overlay cursor-pointer">
        <button class="text-white font-bold py-2 px-4 rounded border-2 border-white hover:bg-white hover:text-black transition">Shiko / Listo</button>
      </div>
    `;
    card.querySelector('.overlay').addEventListener('click', ()=> showBookAndListingDetails(item));
    grid.appendChild(card);
  });
}

// Ticker SSE
function setupSSE(){
  const ticker = document.getElementById('breakingNewsTicker');
  const src = new EventSource('/api/notifications/stream');
  src.onopen = ()=> console.log('[SSE] open');
  src.onerror = (e)=> { console.log('[SSE] error', e); };
  src.addEventListener('tick', ev=>{
    try{
      const obj = JSON.parse(ev.data||'{}');
      const msg = String(obj.message||'').replace(/\s+/g,' ').trim();
      if(!msg) return;
      const div = document.createElement('div');
      div.className = 'ticker-item font-semibold px-8';
      div.innerHTML = `<i class="fas fa-bullhorn text-yellow-300 mr-2"></i> ${msg}`;
      ticker.appendChild(div);
      while (ticker.children.length > 20) ticker.removeChild(ticker.firstChild);
    }catch(err){ console.log('tick parse err', err); }
  });
}

async function handleMainSearch(){
  const query = els.search.value.trim();
  if(!query){ await loadLocalBooks(); return; }
  els.grid.innerHTML = `<div class="col-span-full text-center p-8"><div class="loader ease-linear rounded-full border-4 border-t-4 border-gray-200 h-12 w-12 mx-auto"></div><p class="mt-2 text-gray-500">Duke kërkuar...</p></div>`;
  els.noRes.classList.add('hidden');
  els.grid.classList.remove('hidden');

  try{
    // Fusion: try OpenLibrary first, fallback to Google
    let out = await fetch(`/api/ext/openlibrary?query=${encodeURIComponent(query)}&limit=20`).then(r=>r.json());
    if(!out || !out.length){
      out = await fetch(`/api/ext/google-books?query=${encodeURIComponent(query)}&max=20`).then(r=>r.json());
    }
    renderResults(out.map(b => ({
      id: null,
      title: b.title, author: b.author, cover_url: b.cover_url,
      source: 'api', external_key: b.key
    })));
  }catch(e){
    els.grid.innerHTML = `<div class="col-span-full text-center p-8 text-red-500">Ndodhi një gabim gjatë kërkimit.</div>`;
  }
}

function showBookAndListingDetails(book){
  // If book.id is null (from API search), allow listing it (we'll create book on submit)
  currentBookData = book;
  // Fetch availability, listings, comments
  fetch(`/api/availability?book_id=${book.id||0}`).then(r=>r.json()).then(av => {
    renderBookModal(book, av);
  }).catch(()=> renderBookModal(book, {supply:[], demand:[]}));
  openModal('viewListingModal');
}

function renderBookModal(book, availability){
  const b = book;
  const cover = b.cover_url || 'https://placehold.co/200x300/e2e8f0/a0aec0?text=Imazhi+Mungon';
  const supplyHtml = renderSupply(availability.supply||[]);
  const demandHtml = renderDemand(availability.demand||[]);
  els.viewListingContent.innerHTML = `
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div class="md:col-span-1">
        <img src="${cover}" class="w-full h-auto object-cover rounded-lg shadow-lg" onerror="this.onerror=null;this.src='https://placehold.co/200x300/e2e8f0/a0aec0?text=Imazhi+Mungon';">
      </div>
      <div class="md:col-span-2">
        <h3 class="text-3xl font-bold">${b.title}</h3>
        <p class="text-lg text-gray-500 mb-4">${b.author||''}</p>
        <div class="mt-4 border-t pt-4">
          <h4 class="font-semibold text-xl mb-3">Kush e ka në gjendje</h4>
          <div>${supplyHtml}${demandHtml}</div>
        </div>
      </div>
    </div>
    <div class="mt-6 border-t pt-4 text-center">
      <button id="listThisBookBtn" class="bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition duration-300 shadow-sm">
        <i class="fas fa-plus-circle mr-2"></i>Shto Njoftimin Tënd për këtë Libër
      </button>
    </div>
  `;
  document.getElementById('listThisBookBtn').addEventListener('click', ()=>{
    // Prefill listing modal with current book
    if(!b.id){
      // From API; we will create the book on submit
      currentBookData = b;
    }
    document.getElementById('listingBookCover').src = cover;
    document.getElementById('listingBookTitle').textContent = b.title;
    document.getElementById('listingBookAuthor').textContent = b.author||'';
    closeModal('viewListingModal');
    openModal('listingDetailsModal');
  });
}

function renderSupply(list){
  if(!list || !list.length) return '<p class="text-gray-500">Askush s\'ka stok të deklaruar.</p>';
  const rows = list.map(x=>{
    const price = (x.price!=null)? `${x.price} Lekë` : '-';
    const qty = x.quantity!=null? `${x.quantity} copë` : '-';
    const cond = x.condition? x.condition : '-';
    const type = x.type? x.type : (x.source==='inventory'?'inv':'-');
    const contact = [
      x.name? `<span class="font-semibold">${x.name}</span>`:'' ,
      x.phone? `<a href="tel:${x.phone}" class="text-blue-600 hover:underline">${x.phone}</a>` : '',
      x.email? `<a href="mailto:${x.email}" class="text-blue-600 hover:underline">${x.email}</a>` : ''
    ].filter(Boolean).join(' · ');
    return `<tr>
      <td class="px-3 py-2">${type}</td>
      <td class="px-3 py-2">${price}</td>
      <td class="px-3 py-2">${qty}</td>
      <td class="px-3 py-2">${cond}</td>
      <td class="px-3 py-2">${contact}</td>
    </tr>`;
  }).join('');
  return `<div class="overflow-x-auto"><table class="min-w-full text-sm">
    <thead><tr class="text-gray-500">
      <th class="px-3 py-2 text-left">Burimi</th>
      <th class="px-3 py-2 text-left">Çmimi</th>
      <th class="px-3 py-2 text-left">Sasia</th>
      <th class="px-3 py-2 text-left">Gjendja</th>
      <th class="px-3 py-2 text-left">Kontakt</th>
    </tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}
function renderDemand(list){
  if(!list || !list.length) return '';
  return `<div class="mt-4">
    <h5 class="font-semibold text-lg mb-2">Kërkesa për këtë libër</h5>
    <div class="space-y-2">` + list.map(x=>{
      const price = (x.price!=null)? `${x.price} Lekë` : '-';
      const contact = [
        x.name? `<span class="font-semibold">${x.name}</span>`:'' ,
        x.phone? `<a href="tel:${x.phone}" class="text-blue-600 hover:underline">${x.phone}</a>` : '',
        x.email? `<a href="mailto:${x.email}" class="text-blue-600 hover:underline">${x.email}</a>` : ''
      ].filter(Boolean).join(' · ');
      return `<div class="border p-3 rounded-lg bg-white"><div>${contact}</div>
        <div class="text-sm text-gray-600">Ofron: ${price} • sasia: ${x.quantity??'-'}</div></div>`;
    }).join('') + `</div>`;
}

// Events
els.mainBtn.addEventListener('click', handleMainSearch);
els.search.addEventListener('keypress', e=>{ if(e.key==='Enter') handleMainSearch(); });
els.onlyStockToggle.addEventListener('change', loadLocalBooks);

document.getElementById('closeSearchBookModal').addEventListener('click', ()=> closeModal('searchBookModal'));
document.getElementById('closeListingDetailsModal').addEventListener('click', ()=> closeModal('listingDetailsModal'));
document.getElementById('openManualAddBtn').addEventListener('click', ()=> { closeModal('searchBookModal'); openModal('manualAddModal'); });
document.getElementById('addListingBtn').addEventListener('click', ()=> openModal('searchBookModal'));
document.getElementById('closeManualAddModal').addEventListener('click', ()=> closeModal('manualAddModal'));
document.getElementById('closeViewListingModal').addEventListener('click', ()=> closeModal('viewListingModal'));

// API modal searches
document.getElementById('apiSearchBtnOL').addEventListener('click', async ()=>{
  const q = els.apiSearchInput.value.trim();
  if(!q) return;
  els.apiLoader.classList.remove('hidden');
  els.apiSearchResults.innerHTML = '';
  try{
    const data = await fetch(`/api/ext/openlibrary?query=${encodeURIComponent(q)}&limit=10`).then(r=>r.json());
    renderApiResults(data);
  }catch{ els.apiSearchResults.innerHTML = `<p class="text-center text-red-500">Gabim gjatë kërkimit.</p>`; }
  finally{ els.apiLoader.classList.add('hidden'); }
});
document.getElementById('apiSearchBtnGB').addEventListener('click', async ()=>{
  const q = els.apiSearchInput.value.trim();
  if(!q) return;
  els.apiLoader.classList.remove('hidden');
  els.apiSearchResults.innerHTML = '';
  try{
    const data = await fetch(`/api/ext/google-books?query=${encodeURIComponent(q)}&max=10`).then(r=>r.json());
    renderApiResults(data);
  }catch{ els.apiSearchResults.innerHTML = `<p class="text-center text-red-500">Gabim gjatë kërkimit.</p>`; }
  finally{ els.apiLoader.classList.add('hidden'); }
});
function renderApiResults(books){
  const res = els.apiSearchResults;
  res.innerHTML = '';
  books.forEach(book=>{
    const card = document.createElement('div');
    card.className = 'flex items-center p-2 border rounded-lg hover:bg-gray-100 cursor-pointer';
    const cover = book.cover_url || 'https://placehold.co/48x72/e2e8f0/a0aec0?text=...';
    card.innerHTML = `
      <img src="${cover}" class="w-12 h-18 object-cover rounded-md mr-4">
      <div>
        <h4 class="font-semibold">${book.title}</h4>
        <p class="text-sm text-gray-500">${book.author||''}</p>
      </div>
    `;
    card.addEventListener('click', ()=>{
      currentBookData = {
        id: null,
        title: book.title,
        author: book.author||'',
        cover_url: book.cover_url||'',
        source: 'api',
        external_key: book.key||null
      };
      document.getElementById('listingBookCover').src = currentBookData.cover_url || 'https://placehold.co/128x192/e2e8f0/a0aec0?text=Kopertina';
      document.getElementById('listingBookTitle').textContent = currentBookData.title;
      document.getElementById('listingBookAuthor').textContent = currentBookData.author||'';
      closeModal('searchBookModal');
      openModal('listingDetailsModal');
    });
    res.appendChild(card);
  });
}

// Manual add
els.manualAddForm.addEventListener('submit', (e)=>{
  e.preventDefault();
  currentBookData = {
    id: null,
    title: document.getElementById('manualTitle').value,
    author: document.getElementById('manualAuthor').value,
    cover_url: document.getElementById('manualCoverUrl').value,
    source: 'local',
    external_key: null
  };
  document.getElementById('listingBookCover').src = currentBookData.cover_url || 'https://placehold.co/128x192/e2e8f0/a0aec0?text=Kopertina';
  document.getElementById('listingBookTitle').textContent = currentBookData.title;
  document.getElementById('listingBookAuthor').textContent = currentBookData.author||'';
  closeModal('manualAddModal');
  openModal('listingDetailsModal');
});

// Submit listing (creates book if needed)
els.listingForm.addEventListener('submit', async (e)=>{
  e.preventDefault();
  if(!currentBookData){ alert('Zgjidhni librin fillimisht.'); return; }
  let bookId = currentBookData.id;
  if(!bookId){
    // create the book
    const payload = {
      title: currentBookData.title,
      author: currentBookData.author,
      cover_url: currentBookData.cover_url,
      source: currentBookData.source||'local',
      external_key: currentBookData.external_key||null
    };
    const created = await fetch(`/api/books`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) }).then(r=>r.json());
    bookId = created.id;
  }
  const listingType = document.getElementById('listingType').value;
  const priceVal = Number(document.getElementById('listingPrice').value || 0);
  const conditionVal = document.getElementById('listingCondition').value;
  const sellerName = document.getElementById('sellerName').value;
  const sellerPhone = document.getElementById('sellerPhone').value;
  const sellerEmail = document.getElementById('sellerEmail').value;

  // If buying request: price optional, no condition
  const body = {
    type: listingType, book_id: bookId,
    price: (listingType==='buy' ? (priceVal || null) : priceVal||0),
    quantity: (listingType==='buy' ? 1 : 1),
    condition: (listingType==='buy' ? null : conditionVal),
    contact_name: sellerName, contact_phone: sellerPhone, contact_email: sellerEmail
  };
  await fetch(`/api/listings`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }).then(r=>r.json());
  closeModal('listingDetailsModal');
  await loadLocalBooks();
});

// Kick off
initialLoad();

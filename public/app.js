// Sushida Malahide - front-end (vanilla JS, hash router)
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = n => '€' + Number(n).toFixed(2);
const IMG = id => `https://images.unsplash.com/${id}?w=900&q=70`;

const state = { user: null, menu: null, config: null, cart: loadCart() };
let pollTimer = null;
let onCartChanged = null; // set by views that show live basket totals

// ---------- API ----------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'sushida' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong'), { status: res.status });
  return data;
}

// ---------- Cart ----------
function loadCart() { try { return JSON.parse(localStorage.getItem('sushida-cart')) || {}; } catch { return {}; } }
function saveCart() { try { localStorage.setItem('sushida-cart', JSON.stringify(state.cart)); } catch {} renderCartUI(); }
function itemById(id) { for (const c of state.menu?.categories || []) for (const i of c.items) if (i.id === id) return i; return null; }
function cartLines() { return Object.entries(state.cart).map(([id, qty]) => ({ item: itemById(id), qty })).filter(l => l.item && l.qty > 0); }
function cartCount() { return cartLines().reduce((s, l) => s + l.qty, 0); }
function cartSubtotal() { return cartLines().reduce((s, l) => s + l.item.price * l.qty, 0); }
function setQty(id, qty) {
  if (qty <= 0) delete state.cart[id]; else state.cart[id] = Math.min(qty, 30);
  saveCart();
}
function addToCart(id) {
  setQty(id, (state.cart[id] || 0) + 1);
  const it = itemById(id);
  toast(`Added ${it.name}`);
  const c = $('#cartCount'); c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump');
}

function cartHTML({ compact = false } = {}) {
  const lines = cartLines();
  if (!lines.length) return `<div class="empty"><div class="big">🍣</div>Your basket is empty.<br><span class="small">Add something delicious from the menu.</span></div>`;
  return `<div class="cart-lines">${lines.map(({ item, qty }) => `
    <div class="cart-line">
      <div class="name">${esc(item.name)}</div>
      <div class="line-price">${eur(item.price * qty)}</div>
      <div class="qty">
        <button data-dec="${item.id}" aria-label="Remove one ${esc(item.name)}">−</button><span>${qty}</span><button data-inc="${item.id}" aria-label="Add one ${esc(item.name)}">+</button>
      </div>
    </div>`).join('')}</div>${compact ? '' : ''}`;
}
function totalsHTML(type = 'delivery') {
  const sub = cartSubtotal();
  const d = state.config?.delivery;
  if (!d) return '';
  const fee = type === 'delivery' ? (sub >= d.freeOver ? 0 : d.fee) : 0;
  const toFree = Math.max(d.freeOver - sub, 0);
  return `<div class="totals">
    <div><span>Subtotal</span><span>${eur(sub)}</span></div>
    ${type === 'delivery' ? `<div><span>Delivery</span><span>${fee ? eur(fee) : 'Free'}</span></div>
      ${toFree > 0 ? `<div class="small muted" style="display:block">Add ${eur(toFree)} more for free delivery<div class="progress"><span style="width:${Math.min(sub / d.freeOver * 100, 100)}%"></span></div></div>` : ''}` : ''}
    <div class="grand"><span>Total</span><span>${eur(sub + fee)}</span></div>
  </div>`;
}
function renderCartUI() {
  const n = cartCount();
  $('#cartCount').textContent = n;
  $('#drawerBody').innerHTML = cartHTML();
  $('#drawerFoot').innerHTML = n ? `${totalsHTML()}<a href="#/checkout" class="btn btn-primary btn-block" data-close>Checkout · ${eur(cartSubtotal())}</a>` : `<a href="#/menu" class="btn btn-ghost btn-block" data-close>Browse the menu</a>`;
  const side = $('#sideCart');
  if (side) side.innerHTML = `<h3>Your order</h3>${cartHTML()}${n ? `${totalsHTML()}<a href="#/checkout" class="btn btn-primary btn-block">Checkout</a>` : ''}`;
  const bar = $('#mobileCartBar');
  if (bar) { bar.hidden = !n; bar.innerHTML = `<span>View basket (${n})</span><span>${eur(cartSubtotal())}</span>`; }
  $$('[data-qty-for]').forEach(el => updateItemControl(el));
}
function itemControlHTML(id) {
  const q = state.cart[id] || 0;
  return q ? `<div class="qty"><button data-dec="${id}" aria-label="Remove one">−</button><span>${q}</span><button data-inc="${id}" aria-label="Add one">+</button></div>`
           : `<button class="add-btn" data-add="${id}" aria-label="Add to basket">+</button>`;
}
function updateItemControl(el) { el.innerHTML = itemControlHTML(el.dataset.qtyFor); }

function openDrawer() { document.body.classList.add('drawer-open'); }
function closeDrawer() { document.body.classList.remove('drawer-open'); }

// ---------- UI helpers ----------
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
function tagsHTML(tags = []) {
  const labels = { popular: 'Popular', veg: 'Veg', spicy: 'Spicy', gf: 'GF', new: 'New' };
  return tags.map(t => `<span class="tag tag-${t}">${labels[t] || esc(t)}</span>`).join('');
}
function itemCardHTML(it) {
  return `<article class="item" data-search="${esc((it.name + ' ' + it.desc).toLowerCase())}" data-tags="${(it.tags || []).join(' ')}">
    <div class="item-top"><h3>${esc(it.name)}</h3><span class="price">${eur(it.price)}</span></div>
    <p>${esc(it.desc)}</p>
    <div class="item-foot"><div class="tags">${tagsHTML(it.tags)}</div><div data-qty-for="${it.id}">${itemControlHTML(it.id)}</div></div>
  </article>`;
}
function initReveal() {
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .12 });
  $$('.reveal').forEach(el => io.observe(el));
}
function statusLabel(s) { return { received: 'Received', preparing: 'Preparing', ready: 'Ready', out_for_delivery: 'Out for delivery', completed: 'Completed', cancelled: 'Cancelled' }[s] || s; }
function trackerHTML(o) {
  if (o.status === 'cancelled') return '';
  const steps = o.type === 'delivery' ? ['received', 'preparing', 'out_for_delivery', 'completed'] : ['received', 'preparing', 'ready', 'completed'];
  const idx = steps.indexOf(o.status);
  return `<div class="tracker">${steps.map((s, i) => `<div class="${i <= idx ? 'done' : ''}">${statusLabel(s)}</div>`).join('')}</div>`;
}
function fmtDate(sqlUtc) { return new Date(sqlUtc.replace(' ', 'T') + 'Z').toLocaleString('en-IE', { dateStyle: 'medium', timeStyle: 'short' }); }
function initials(name) { return name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase(); }

function renderNav() {
  const u = state.user;
  $('#navAccount').innerHTML = u
    ? `<a href="#/account" class="nav-account-link"><span class="avatar">${esc(initials(u.name))}</span>${u.role === 'admin' ? 'Account' : esc(u.name.split(' ')[0])}</a>${u.role === 'admin' ? ' <a href="#/admin">Admin</a>' : ''}`
    : `<a href="#/login">Log in</a>`;
  const open = state.config?.open;
  const pill = $('#openPill');
  pill.className = 'open-pill ' + (open ? 'is-open' : 'is-closed');
  pill.textContent = open ? '● Open now' : '● Closed · opens 12:00';
}

// ---------- Views ----------
const REVIEWS = [
  { text: 'Excellent quality and service. We had ramen and a bento box from the lunch menu. Everything was delicious and portions were very big.', who: 'Google review' },
  { text: 'Cannot rate this place highly enough. Excellent service, food spot on and all keenly priced. The staff could not have been more accommodating with our baby.', who: 'Google review' },
  { text: 'The Dragon Roll had an equal amount of creaminess and crispness — we absolutely devoured it. The Ebi Gyoza were magnificent!', who: 'Google review' },
];

function viewHome(params) {
  document.body.classList.add('home');
  const popular = state.menu.categories.flatMap(c => c.items).filter(i => i.tags?.includes('popular')).slice(0, 6);
  app.innerHTML = `
  <section class="hero">
    <div class="hero-bg"></div>
    <div class="wrap hero-content">
      <div class="eyebrow">Japanese restaurant · Malahide</div>
      <h1>Sushi made with <span>Irish</span> soul.</h1>
      <p class="lead">Fresh local produce meets time-honoured Japanese technique. Dine with us on New Street or get it delivered across Malahide &amp; Portmarnock.</p>
      <div class="hero-ctas">
        <a href="#/menu" class="btn btn-primary">Order online</a>
        <a href="#/book" class="btn btn-ghost">Book a table</a>
      </div>
      <div class="hero-meta">
        <div><strong>4.8★</strong>1,390+ reviews</div>
        <div><strong>~45 min</strong>Delivery</div>
        <div><strong>12–10pm</strong>Every day</div>
      </div>
    </div>
    <div class="hero-kanji">寿司田</div>
  </section>

  <section>
    <div class="wrap">
      <div class="features">
        <div class="feature reveal"><div class="num">01</div><h3>Order &amp; track</h3><p>Create an account, order in seconds, and follow your food from our kitchen to your door.</p></div>
        <div class="feature reveal"><div class="num">02</div><h3>Delivery or collection</h3><p>We deliver to Malahide (K36) and Portmarnock (D13). Free delivery over ${eur(state.config.delivery.freeOver)}.</p></div>
        <div class="feature reveal"><div class="num">03</div><h3>Book your table</h3><p>Lunch, dinner or a celebration — reserve online in under a minute.</p></div>
      </div>
    </div>
  </section>

  <section style="padding-top:0">
    <div class="wrap story">
      <div class="story-imgs reveal">
        <img src="${IMG('photo-1617196034796-73dfa7b1fd56')}" alt="Sushi rolls" loading="lazy">
        <img src="${IMG('photo-1611143669185-af224c5e3252')}" alt="Japanese dishes" loading="lazy">
      </div>
      <div class="reveal">
        <div class="eyebrow">Our story</div>
        <h2>From local suppliers to your chopsticks.</h2>
        <p>At Sushida we blend Ireland's finest produce with authentic Japanese culinary tradition. We work closely with local suppliers to source superior ingredients, then let time-honoured techniques do the rest.</p>
        <p>From delicate nigiri to steaming bowls of tonkotsu ramen, every dish is made fresh to order in our Malahide kitchen.</p>
        <p class="signature">— The Sushida team</p>
      </div>
    </div>
  </section>

  <section style="background:var(--bg-2)">
    <div class="wrap">
      <div class="section-head reveal"><div class="eyebrow">Guest favourites</div><h2>Most loved in Malahide</h2></div>
      <div class="popular-grid">${popular.map(itemCardHTML).join('')}</div>
      <div style="text-align:center;margin-top:36px"><a href="#/menu" class="btn btn-ghost">See the full menu →</a></div>
    </div>
  </section>

  <div class="band">
    <div class="band-bg"></div>
    <div class="wrap reveal">
      <div class="eyebrow">Tonight's plan, sorted</div>
      <h2>Ramen on the sofa or a table by the window?</h2>
      <div class="hero-ctas" style="justify-content:center"><a href="#/menu" class="btn btn-primary">Get delivery</a><a href="#/book" class="btn btn-ghost">Reserve</a></div>
    </div>
  </div>

  <section>
    <div class="wrap">
      <div class="section-head reveal"><div class="eyebrow">Reviews</div><h2>What our guests say</h2></div>
      <div class="rating-summary"><strong>4.8</strong><span class="stars">★★★★★</span><span>1,390+ Google reviews</span></div>
      <div class="reviews">${REVIEWS.map(r => `<blockquote class="review reveal" style="margin:0"><div class="stars">★★★★★</div><p>“${esc(r.text)}”</p><cite>${esc(r.who)}</cite></blockquote>`).join('')}</div>
    </div>
  </section>

  <section id="visit" style="background:var(--bg-2)">
    <div class="wrap">
      <div class="section-head reveal"><div class="eyebrow">Visit us</div><h2>In the heart of Malahide</h2></div>
      <div class="visit">
        <div class="visit-card reveal">
          <dl>
            <div><dt>Address</dt><dd>Unit 1, First Floor, New Street Mall<br>26 New Street, Malahide<br>Co. Dublin, K36 Y181</dd></div>
            <div><dt>Opening hours</dt><dd>Monday – Sunday · 12:00 – 22:00</dd></div>
            <div><dt>Reservations</dt><dd><a href="tel:+35318450809">01 845 0809</a> · <a href="#/book">Book online</a></dd></div>
            <div><dt>Email</dt><dd><a href="mailto:malahide@sushida.ie">malahide@sushida.ie</a></dd></div>
          </dl>
          <a class="btn btn-ghost" style="margin-top:24px" href="https://maps.app.goo.gl/Nq39xZ1EbTeU4Ae4A" target="_blank" rel="noopener">Get directions ↗</a>
        </div>
        <div class="map reveal"><iframe title="Map of Sushida Malahide" loading="lazy" src="https://maps.google.com/maps?q=Sushida%20Malahide%2C%2026%20New%20Street%2C%20Malahide&t=m&z=16&output=embed"></iframe></div>
      </div>
    </div>
  </section>`;
  initReveal();
  if (params.get('s')) setTimeout(() => document.getElementById(params.get('s'))?.scrollIntoView(), 50);
}

function viewMenu() {
  const cats = state.menu.categories;
  app.innerHTML = `
  <div class="page-head"><div class="wrap"><div class="eyebrow">お品書き · Menu</div><h1>Order online</h1><p class="muted">Delivery to K36 &amp; D13 · Collection from New Street</p></div></div>
  <div class="cat-bar"><div class="wrap cat-bar-inner">${cats.map(c => `<a class="chip" href="#cat-${c.id}" data-cat="${c.id}">${esc(c.name)}</a>`).join('')}</div></div>
  <div class="wrap menu-layout">
    <div>
      <div class="menu-tools">
        <input type="search" id="menuSearch" placeholder="Search dishes… (e.g. salmon, ramen)" aria-label="Search the menu">
        <div class="filters">
          <button class="chip" data-filter="veg">🌱 Veg</button>
          <button class="chip" data-filter="spicy">🌶 Spicy</button>
        </div>
      </div>
      ${cats.map(c => `
        <div class="menu-cat" id="cat-${c.id}">
          <div class="menu-cat-head"><h2>${esc(c.name)}</h2><span class="jp">${esc(c.jp || '')}</span></div>${c.desc ? `<p class="muted small" style="margin:-6px 0 16px">${esc(c.desc)}</p>` : ''}
          <div class="menu-items">${c.items.map(itemCardHTML).join('')}</div>
        </div>`).join('')}
      <p class="muted small" id="noResults" hidden>No dishes match your search.</p>
      <p class="muted small">Please tell us about any allergies in the order notes. Allergen information is available on request.</p>
    </div>
    <aside class="side-cart" id="sideCart"></aside>
  </div>
  <button class="mobile-cart-bar" id="mobileCartBar" hidden></button>`;

  // Category chips: smooth scroll without changing the route hash.
  $$('.cat-bar .chip').forEach(a => a.addEventListener('click', e => { e.preventDefault(); $('#cat-' + a.dataset.cat).scrollIntoView({ behavior: 'smooth' }); }));
  const spy = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { $$('.cat-bar .chip').forEach(c => c.classList.toggle('active', 'cat-' + c.dataset.cat === e.target.id)); $(`.cat-bar .chip[data-cat="${e.target.id.slice(4)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center' }); }
  }), { rootMargin: '-40% 0px -55% 0px' });
  $$('.menu-cat').forEach(s => spy.observe(s));

  const active = new Set();
  const apply = () => {
    const q = $('#menuSearch').value.trim().toLowerCase();
    let any = false;
    $$('.menu-cat').forEach(cat => {
      let shown = 0;
      $$('.item', cat).forEach(it => {
        const ok = (!q || it.dataset.search.includes(q)) && [...active].every(t => it.dataset.tags.split(' ').includes(t));
        it.hidden = !ok; if (ok) shown++;
      });
      cat.hidden = !shown; if (shown) any = true;
    });
    $('#noResults').hidden = any;
  };
  $('#menuSearch').addEventListener('input', apply);
  $$('[data-filter]').forEach(b => b.addEventListener('click', () => {
    const t = b.dataset.filter; active.has(t) ? active.delete(t) : active.add(t); b.classList.toggle('active'); apply();
  }));
  $('#mobileCartBar').addEventListener('click', openDrawer);
  renderCartUI();
}

function timeSlots(type) {
  const { openHour, closeHour } = state.config.restaurant;
  const eta = (type === 'delivery' ? state.config.delivery : state.config.collection).etaMinutes;
  const now = state.config.now.minutes;
  let start = Math.max(openHour * 60, now + eta);
  start = Math.ceil(start / 15) * 15;
  const slots = [];
  for (let m = start; m <= closeHour * 60 - 15; m += 15) slots.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  return slots;
}

function viewCheckout() {
  if (!state.user) { sessionStorage.setItem('afterLogin', '#/checkout'); location.hash = '#/login?reason=checkout'; return; }
  if (!cartCount()) { app.innerHTML = `<div class="success"><div class="empty"><div class="big">🍣</div><h2>Your basket is empty</h2><p>Add a few dishes and come back.</p><a href="#/menu" class="btn btn-primary">Browse the menu</a></div></div>`; return; }
  const u = state.user, d = state.config.delivery;
  let type = sessionStorage.getItem('orderType') || 'delivery';

  app.innerHTML = `
  <div class="checkout">
    <form id="checkoutForm" novalidate>
      <h1>Checkout</h1>
      <div class="card step">
        <h2>1 · How would you like your order?</h2>
        <div class="toggle">
          <label><input type="radio" name="type" value="delivery" ${type === 'delivery' ? 'checked' : ''}><span class="opt"><strong>🛵 Delivery</strong><span>~${d.etaMinutes} min · K36 &amp; D13</span></span></label>
          <label><input type="radio" name="type" value="collection" ${type === 'collection' ? 'checked' : ''}><span class="opt"><strong>🥢 Collection</strong><span>~${state.config.collection.etaMinutes} min · New Street</span></span></label>
        </div>
      </div>
      <div class="card step">
        <h2>2 · Your details</h2>
        <div class="row">
          <div class="field"><label for="name">Name</label><input id="name" name="name" value="${esc(u.name)}" required autocomplete="name"></div>
          <div class="field"><label for="phone">Phone</label><input id="phone" name="phone" value="${esc(u.phone)}" required autocomplete="tel" placeholder="08X XXX XXXX"></div>
        </div>
        <div id="addressFields">
          <div class="field"><label for="address">Delivery address</label><input id="address" name="address" value="${esc(u.address)}" autocomplete="street-address" placeholder="House number, street, area"></div>
          <div class="field"><label for="eircode">Eircode</label><input id="eircode" name="eircode" value="${esc(u.eircode)}" autocomplete="postal-code" placeholder="K36 XXXX" style="text-transform:uppercase"></div>
        </div>
      </div>
      <div class="card step">
        <h2>3 · When?</h2>
        <div id="closedNotice"></div>
        <div class="field"><select name="when" id="when"></select></div>
        <h2 style="margin-top:20px">4 · Payment</h2>
        <div class="toggle">
          <label><input type="radio" name="payment" value="card_on_arrival" checked><span class="opt"><strong>💳 Card</strong><span id="cardSub">Pay on delivery</span></span></label>
          <label><input type="radio" name="payment" value="cash"><span class="opt"><strong>💶 Cash</strong><span>Pay on delivery / collection</span></span></label>
        </div>
        <div class="field" style="margin-top:18px"><label for="notes">Notes &amp; allergies</label><textarea id="notes" name="notes" maxlength="300" placeholder="Doorbell, allergies, extra soy sauce…"></textarea></div>
        <label class="check"><input type="checkbox" name="chopsticks" checked> Include chopsticks &amp; cutlery</label>
      </div>
      <div class="form-error" id="checkoutError"></div>
      <button class="btn btn-primary btn-block" id="placeOrder" type="submit">Place order</button>
    </form>
    <aside class="side-cart" style="display:block;top:100px"><h3>Order summary</h3><div id="summaryLines"></div><div id="summaryTotals"></div><a href="#/menu" class="small muted">← Add more items</a></aside>
  </div>`;

  const form = $('#checkoutForm');
  const refresh = () => {
    type = form.type.value; sessionStorage.setItem('orderType', type);
    $('#addressFields').hidden = type !== 'delivery';
    $('#cardSub').textContent = type === 'delivery' ? 'Pay on delivery' : 'Pay at collection';
    const slots = timeSlots(type);
    const open = state.config.open;
    $('#closedNotice').innerHTML = open ? '' : `<div class="notice">We're closed right now. Pre-order for later today${slots.length ? '' : ' — no more slots today, please come back tomorrow from 12:00'}.</div>`;
    $('#when').innerHTML = (open ? `<option value="asap">As soon as possible (~${(type === 'delivery' ? d : state.config.collection).etaMinutes} min)</option>` : '') + slots.map(s => `<option value="${s}">Today at ${s}</option>`).join('');
    $('#placeOrder').disabled = !open && !slots.length;
    $('#summaryLines').innerHTML = cartHTML();
    $('#summaryTotals').innerHTML = totalsHTML(type);
    const sub = cartSubtotal();
    $('#placeOrder').textContent = `Place order · ${eur(sub + (type === 'delivery' && sub < d.freeOver ? d.fee : 0))}`;
  };
  form.addEventListener('change', e => { if (e.target.name === 'type') refresh(); });
  onCartChanged = () => cartCount() ? refresh() : viewCheckout();
  refresh();

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('#checkoutError'); err.textContent = '';
    const f = Object.fromEntries(new FormData(form));
    if (type === 'delivery' && cartSubtotal() < d.minOrder) { err.textContent = `Minimum order for delivery is ${eur(d.minOrder)}.`; return; }
    const btn = $('#placeOrder'); btn.disabled = true; btn.textContent = 'Placing order…';
    try {
      const { order } = await api('/api/orders', { method: 'POST', body: {
        type, name: f.name, phone: f.phone, address: f.address, eircode: f.eircode, when: f.when,
        payment: f.payment, notes: f.notes, chopsticks: !!f.chopsticks,
        items: cartLines().map(l => ({ id: l.item.id, qty: l.qty })),
      } });
      state.cart = {}; saveCart();
      const me = await api('/api/me'); state.user = me.user;
      location.hash = `#/order/${order.id}`;
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; refresh(); }
  });
}

async function viewOrderSuccess(id) {
  const { orders } = await api('/api/orders');
  const o = orders.find(x => x.id === Number(id));
  if (!o) { location.hash = '#/account'; return; }
  app.innerHTML = `<div class="success">
    <div class="tick">✓</div>
    <div class="eyebrow">Order #${o.id}</div>
    <h1>Arigatō, ${esc(o.name.split(' ')[0])}!</h1>
    <p class="muted">Your ${o.type} order is in. ${o.when_label === 'ASAP' ? `Estimated ${o.type === 'delivery' ? 'delivery' : 'ready'} time: ~${(o.type === 'delivery' ? state.config.delivery : state.config.collection).etaMinutes} minutes.` : `Scheduled for ${esc(o.when_label)} today.`}</p>
    <div class="card narrow" style="text-align:left;margin-top:28px">
      <div class="order-top"><strong>${eur(o.total)}</strong><span class="status status-${o.status}">${statusLabel(o.status)}</span></div>
      <div class="order-items">${o.items.map(i => `${i.qty}× ${esc(i.name)}`).join('<br>')}</div>
      ${trackerHTML(o)}
    </div>
    <div class="hero-ctas" style="justify-content:center;margin-top:28px"><a href="#/account" class="btn btn-primary">Track my orders</a><a href="#/" class="btn btn-ghost">Back home</a></div>
  </div>`;
}

function authView(mode, params) {
  if (state.user) { location.hash = '#/account'; return; }
  const isLogin = mode === 'login';
  app.innerHTML = `<div class="auth-page"><div class="narrow">
    <h1>${isLogin ? 'Welcome back' : 'Create your account'}</h1>
    <p class="sub">${params.get('reason') === 'checkout' ? 'Log in or sign up to complete your order.' : isLogin ? 'Log in to order and track your deliveries.' : 'Order faster, track deliveries and see your order history.'}</p>
    <form class="card" id="authForm" novalidate>
      ${isLogin ? '' : `<ul class="perks"><li>Save your address for 1-tap checkout</li><li>Live order tracking</li><li>Reorder your favourites</li></ul>
        <div class="field"><label for="name">Full name</label><input id="name" name="name" required autocomplete="name"></div>`}
      <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" required autocomplete="email"></div>
      ${isLogin ? '' : `<div class="field"><label for="phone">Phone <span class="small">(for your delivery driver)</span></label><input id="phone" name="phone" autocomplete="tel"></div>`}
      <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" required minlength="8" autocomplete="${isLogin ? 'current-password' : 'new-password'}"></div>
      <div class="form-error" id="authError"></div>
      <button class="btn btn-primary btn-block" type="submit">${isLogin ? 'Log in' : 'Create account'}</button>
      <p class="switch">${isLogin ? `New to Sushida? <a href="#/register${params.get('reason') ? '?reason=checkout' : ''}">Create an account</a>` : `Already have an account? <a href="#/login${params.get('reason') ? '?reason=checkout' : ''}">Log in</a>`}</p>
    </form>
  </div></div>`;
  $('#authForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const btn = $('button[type=submit]', e.target); btn.disabled = true;
    try {
      await api(isLogin ? '/api/login' : '/api/register', { method: 'POST', body: f });
      state.user = (await api('/api/me')).user;
      renderNav();
      toast(isLogin ? `Welcome back, ${state.user.name.split(' ')[0]}!` : 'Account created 🎉');
      const next = sessionStorage.getItem('afterLogin'); sessionStorage.removeItem('afterLogin');
      location.hash = next || (state.user.role === 'admin' ? '#/admin' : '#/menu');
    } catch (ex) { $('#authError').textContent = ex.message; btn.disabled = false; }
  });
}

async function viewAccount(params) {
  if (!state.user) { sessionStorage.setItem('afterLogin', '#/account'); location.hash = '#/login'; return; }
  const tab = params.get('tab') || 'orders';
  const u = state.user;
  app.innerHTML = `<div class="account">
    <div class="account-head"><div><div class="eyebrow">My account</div><h1>Konnichiwa, ${esc(u.name.split(' ')[0])}</h1></div><button class="btn btn-ghost btn-sm" id="logout">Log out</button></div>
    <div class="tabs"><a href="#/account?tab=orders" class="${tab === 'orders' ? 'active' : ''}">My orders</a><a href="#/account?tab=profile" class="${tab === 'profile' ? 'active' : ''}">Profile &amp; address</a></div>
    <div id="tabBody"><p class="muted">Loading…</p></div>
  </div>`;
  $('#logout').addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }); state.user = null; renderNav(); toast('Logged out'); location.hash = '#/'; });

  if (tab === 'profile') {
    $('#tabBody').innerHTML = `<form class="card" id="profileForm" style="max-width:620px">
      <div class="row"><div class="field"><label>Name</label><input name="name" value="${esc(u.name)}"></div><div class="field"><label>Phone</label><input name="phone" value="${esc(u.phone)}"></div></div>
      <div class="field"><label>Email</label><input value="${esc(u.email)}" disabled></div>
      <div class="field"><label>Delivery address</label><input name="address" value="${esc(u.address)}"></div>
      <div class="field"><label>Eircode</label><input name="eircode" value="${esc(u.eircode)}"></div>
      <h3 style="margin-top:24px;font-size:1.1rem">Change password</h3>
      <div class="row"><div class="field"><label>Current password</label><input type="password" name="currentPassword" autocomplete="current-password"></div><div class="field"><label>New password</label><input type="password" name="newPassword" minlength="8" autocomplete="new-password"></div></div>
      <div class="form-error" id="profileError"></div>
      <button class="btn btn-primary" type="submit">Save changes</button>
    </form>`;
    $('#profileForm').addEventListener('submit', async e => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      if (!f.newPassword) { delete f.newPassword; delete f.currentPassword; }
      try { state.user = (await api('/api/me', { method: 'PUT', body: f })).user; renderNav(); toast('Profile saved'); viewAccount(params); }
      catch (ex) { $('#profileError').textContent = ex.message; }
    });
    return;
  }

  const load = async () => {
    const { orders } = await api('/api/orders');
    const body = $('#tabBody'); if (!body) return;
    body.innerHTML = orders.length ? `<div class="orders-list">${orders.map(o => `
      <div class="order">
        <div class="order-top"><div><strong>Order #${o.id}</strong> <span class="muted small">· ${fmtDate(o.created_at)} · ${o.type === 'delivery' ? '🛵 Delivery' : '🥢 Collection'} · ${esc(o.when_label)}</span></div><span class="status status-${o.status}">${statusLabel(o.status)}</span></div>
        <div class="order-items">${o.items.map(i => `${i.qty}× ${esc(i.name)}`).join(' · ')}</div>
        <div class="order-top" style="margin:0;align-items:center"><strong>${eur(o.total)}</strong><button class="btn btn-ghost btn-sm" data-reorder="${o.id}">Reorder</button></div>
        ${['completed', 'cancelled'].includes(o.status) ? '' : trackerHTML(o)}
      </div>`).join('')}</div>`
      : `<div class="empty"><div class="big">🥢</div>No orders yet.<br><a href="#/menu" class="btn btn-primary" style="margin-top:16px">Order now</a></div>`;
    $$('[data-reorder]', body).forEach(b => b.addEventListener('click', () => {
      const o = orders.find(x => x.id === Number(b.dataset.reorder));
      let missing = 0;
      o.items.forEach(i => itemById(i.id) ? setQty(i.id, (state.cart[i.id] || 0) + i.qty) : missing++);
      toast(missing ? 'Some items are no longer on the menu' : 'Added to your basket'); openDrawer();
    }));
  };
  await load();
  pollTimer = setInterval(load, 20000); // live status updates
}

function viewBook() {
  const u = state.user;
  const today = new Date().toISOString().slice(0, 10);
  const times = []; for (let m = 12 * 60; m <= 21 * 60; m += 30) times.push(`${String(m / 60 | 0).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  app.innerHTML = `
  <div class="page-head"><div class="wrap"><div class="eyebrow">予約 · Reservations</div><h1>Book a table</h1><p class="muted">Same-day online bookings close at 2pm. For groups over 20, call <a href="tel:+35318450809">01 845 0809</a>.</p></div></div>
  <div class="wrap" style="padding-bottom:100px">
    <div class="book">
      <div class="book-img"></div>
      <form class="book-form" id="bookForm" novalidate>
        <div class="row">
          <div class="field"><label for="b-date">Date</label><input id="b-date" type="date" name="date" min="${today}" value="${today}" required></div>
          <div class="field"><label for="b-time">Time</label><select id="b-time" name="time">${times.map(t => `<option ${t === '19:00' ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label for="b-people">Guests</label><select id="b-people" name="people">${Array.from({ length: 20 }, (_, i) => `<option value="${i + 1}" ${i === 1 ? 'selected' : ''}>${i + 1} ${i ? 'people' : 'person'}</option>`).join('')}</select></div>
        <div class="field"><label for="b-name">Name</label><input id="b-name" name="name" value="${esc(u?.name || '')}" required autocomplete="name"></div>
        <div class="row">
          <div class="field"><label for="b-email">Email</label><input id="b-email" type="email" name="email" value="${esc(u?.email || '')}" required autocomplete="email"></div>
          <div class="field"><label for="b-phone">Phone</label><input id="b-phone" name="phone" value="${esc(u?.phone || '')}" required autocomplete="tel"></div>
        </div>
        <div class="field"><label for="b-notes">Special requests</label><textarea id="b-notes" name="notes" maxlength="300" placeholder="Birthday, high chair, allergies…"></textarea></div>
        <div class="form-error" id="bookError"></div>
        <button class="btn btn-primary btn-block" type="submit">Request booking</button>
      </form>
    </div>
  </div>`;
  $('#bookForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try {
      await api('/api/reservations', { method: 'POST', body: f });
      app.innerHTML = `<div class="success"><div class="tick">✓</div><h1>Booking requested</h1><p class="muted">Table for ${esc(f.people)} on ${esc(f.date)} at ${esc(f.time)}.<br>We'll confirm by email or phone shortly.</p><a href="#/" class="btn btn-ghost" style="margin-top:20px">Back home</a></div>`;
      scrollTo(0, 0);
    } catch (ex) { $('#bookError').textContent = ex.message; }
  });
}

async function viewAdmin(params) {
  if (state.user?.role !== 'admin') { location.hash = '#/login'; return; }
  const tab = params.get('tab') || 'orders';
  app.innerHTML = `<div class="account" style="max-width:1200px">
    <div class="account-head"><div><div class="eyebrow">Kitchen dashboard</div><h1>Sushida admin</h1></div><span class="muted small">Auto-refreshes every 15s</span></div>
    <div class="tabs"><a href="#/admin?tab=orders" class="${tab === 'orders' ? 'active' : ''}">Orders</a><a href="#/admin?tab=reservations" class="${tab === 'reservations' ? 'active' : ''}">Reservations</a></div>
    <div id="adminBody"><p class="muted">Loading…</p></div>
  </div>`;
  let lastMax = 0;
  const load = async () => {
    const body = $('#adminBody'); if (!body) return;
    if (tab === 'reservations') {
      const { reservations: rs } = await api('/api/admin/reservations');
      body.innerHTML = rs.length ? `<div class="table-scroll"><table class="admin-table"><thead><tr><th>Date</th><th>Time</th><th>Guests</th><th>Name</th><th>Contact</th><th>Notes</th><th>Status</th></tr></thead><tbody>
        ${rs.map(r => `<tr><td>${esc(r.date)}</td><td>${esc(r.time)}</td><td>${r.people}</td><td>${esc(r.name)}</td><td>${esc(r.phone)}<br><span class="muted small">${esc(r.email)}</span></td><td class="small">${esc(r.notes)}</td>
          <td><select data-res="${r.id}">${['pending', 'confirmed', 'declined'].map(s => `<option ${s === r.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">No reservations yet.</p>';
      $$('[data-res]', body).forEach(s => s.addEventListener('change', async () => { await api(`/api/admin/reservations/${s.dataset.res}`, { method: 'PATCH', body: { status: s.value } }); toast('Reservation updated'); }));
      return;
    }
    const { orders } = await api('/api/admin/orders');
    const today = new Date().toDateString();
    const todays = orders.filter(o => new Date(o.created_at.replace(' ', 'T') + 'Z').toDateString() === today);
    const active = orders.filter(o => !['completed', 'cancelled'].includes(o.status));
    const maxId = orders[0]?.id || 0;
    if (lastMax && maxId > lastMax) { toast('🔔 New order received!'); document.title = '🔔 New order · Sushida admin'; }
    lastMax = maxId;
    body.innerHTML = `
      <div class="stats">
        <div class="stat"><strong>${active.length}</strong><span>Active orders</span></div>
        <div class="stat"><strong>${todays.length}</strong><span>Orders today</span></div>
        <div class="stat"><strong>${eur(todays.filter(o => o.status !== 'cancelled').reduce((s, o) => s + o.total, 0))}</strong><span>Revenue today</span></div>
        <div class="stat"><strong>${todays.filter(o => o.type === 'delivery').length}</strong><span>Deliveries today</span></div>
      </div>
      ${orders.length ? `<div class="table-scroll"><table class="admin-table"><thead><tr><th>#</th><th>Placed</th><th>Customer</th><th>Type / when</th><th>Items</th><th>Total</th><th>Status</th></tr></thead><tbody>
      ${orders.map(o => `<tr>
        <td><strong>${o.id}</strong></td>
        <td class="small">${fmtDate(o.created_at)}</td>
        <td>${esc(o.name)}<br><a class="small" href="tel:${esc(o.phone)}">${esc(o.phone)}</a>${o.type === 'delivery' ? `<br><span class="muted small">${esc(o.address)}, ${esc(o.eircode)}</span>` : ''}</td>
        <td>${o.type === 'delivery' ? '🛵 Delivery' : '🥢 Collection'}<br><strong>${esc(o.when_label)}</strong><br><span class="muted small">${o.payment === 'cash' ? 'Cash' : 'Card'}${o.chopsticks ? ' · chopsticks' : ''}</span></td>
        <td class="small">${o.items.map(i => `${i.qty}× ${esc(i.name)}`).join('<br>')}${o.notes ? `<br><em style="color:var(--warn)">“${esc(o.notes)}”</em>` : ''}</td>
        <td><strong>${eur(o.total)}</strong></td>
        <td><select data-order="${o.id}">${['received', 'preparing', o.type === 'delivery' ? 'out_for_delivery' : 'ready', 'completed', 'cancelled'].map(s => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${statusLabel(s)}</option>`).join('')}</select></td>
      </tr>`).join('')}</tbody></table></div>` : '<p class="muted">No orders yet.</p>'}`;
    $$('[data-order]', body).forEach(s => s.addEventListener('change', async () => { await api(`/api/admin/orders/${s.dataset.order}`, { method: 'PATCH', body: { status: s.value } }); toast(`Order #${s.dataset.order} → ${statusLabel(s.value)}`); }));
  };
  await load();
  pollTimer = setInterval(() => { if (!document.querySelector('#adminBody select:focus')) load(); }, 15000);
}

// ---------- Router ----------
async function router() {
  clearInterval(pollTimer);
  onCartChanged = null;
  closeDrawer();
  document.body.classList.remove('nav-open', 'home');
  document.title = 'Sushida Malahide · Japanese Restaurant & Sushi Delivery';
  const raw = location.hash.slice(1) || '/';
  const [pathPart, query = ''] = raw.split('?');
  const params = new URLSearchParams(query);
  const parts = pathPart.split('/').filter(Boolean);
  $$('.nav-links a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + pathPart));
  try {
    switch (parts[0]) {
      case undefined: viewHome(params); break;
      case 'menu': viewMenu(); break;
      case 'checkout': viewCheckout(); break;
      case 'login': authView('login', params); break;
      case 'register': authView('register', params); break;
      case 'account': await viewAccount(params); break;
      case 'order': await viewOrderSuccess(parts[1]); break;
      case 'book': viewBook(); break;
      case 'admin': await viewAdmin(params); break;
      default: viewHome(params);
    }
  } catch (e) {
    if (e.status === 401) { state.user = null; renderNav(); location.hash = '#/login'; return; }
    app.innerHTML = `<div class="success"><h1>Something went wrong</h1><p class="muted">${esc(e.message)}</p><a href="#/" class="btn btn-ghost">Home</a></div>`;
  }
  if (!params.get('s')) scrollTo(0, 0);
  renderCartUI();
}

// ---------- Global events ----------
document.addEventListener('click', e => {
  const t = e.target.closest('[data-add],[data-inc],[data-dec],[data-close]');
  if (!t) return;
  if (t.dataset.add) addToCart(t.dataset.add);
  else if (t.dataset.inc) setQty(t.dataset.inc, (state.cart[t.dataset.inc] || 0) + 1);
  else if (t.dataset.dec) setQty(t.dataset.dec, (state.cart[t.dataset.dec] || 0) - 1);
  else if ('close' in t.dataset) closeDrawer();
  if ((t.dataset.inc || t.dataset.dec) && onCartChanged) onCartChanged();
});
$('#cartBtn').addEventListener('click', openDrawer);
$('#closeDrawer').addEventListener('click', closeDrawer);
$('#scrim').addEventListener('click', closeDrawer);
$('#burger').addEventListener('click', () => document.body.classList.toggle('nav-open'));
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
addEventListener('scroll', () => $('#nav').classList.toggle('solid', scrollY > 40), { passive: true });
addEventListener('hashchange', router);
addEventListener('storage', e => { if (e.key === 'sushida-cart') { state.cart = loadCart(); renderCartUI(); } });
$('#year').textContent = new Date().getFullYear();

// ---------- Boot ----------
(async () => {
  const [menu, config, me] = await Promise.all([api('/api/menu'), api('/api/config'), api('/api/me')]);
  Object.assign(state, { menu, config, user: me.user });
  // Drop basket items that are no longer on the menu.
  for (const id of Object.keys(state.cart)) if (!itemById(id)) delete state.cart[id];
  renderNav();
  router();
  setInterval(async () => { try { state.config = await api('/api/config'); renderNav(); } catch {} }, 60000);
})();

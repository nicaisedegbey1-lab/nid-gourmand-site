// ═══════════════════════════════════════════════════════════
//  NID GOURMAND — app.js
//  Fonctionnalités :
//  ✅ Boutique Firebase (produits, filtres, panier)
//  ✅ Paiement PayDunya (MTN MoMo + Moov Money)
//  ✅ Stock diminue automatiquement après paiement
//  ✅ Commande sauvegardée dans Firestore (admin la voit)
//  ✅ WhatsApp envoyé après paiement confirmé
//  ✅ Bouton "Demander un devis" → WhatsApp direct
//  ✅ Favicon dynamique depuis admin
// ═══════════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────────
//  ⚠️  CONFIGURATION PAYDUNYA
//  Remplacez les valeurs ci-dessous par vos vraies clés
//  (récupérées dans PayDunya → Intégrez notre API)
// ───────────────────────────────────────────────────────────
const PAYDUNYA_CONFIG = {
  MASTER_KEY:   "VOTRE_MASTER_KEY",    // ← remplacer
  PRIVATE_KEY:  "VOTRE_PRIVATE_KEY",   // ← remplacer
  TOKEN:        "VOTRE_TOKEN",         // ← remplacer
  MODE:         "test",                // "test" ou "live"
};
// ───────────────────────────────────────────────────────────

firebase.initializeApp(window.firebaseConfig ?? firebaseConfig);
const db = firebase.firestore();

// ── Utilitaires ──────────────────────────────────────────
const money = n => new Intl.NumberFormat("fr-FR").format(n) + " FCFA";
const esc   = s => String(s ?? "").replace(/[&<>"']/g, m =>
  ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const $ = id => document.getElementById(id);

// ── État global ──────────────────────────────────────────
let allProducts = [];
let cart        = [];
let settings    = {};
let activeFilter = "Tous";

// ═══════════════════════════════════════════════════════════
//  1. CHARGEMENT DES RÉGLAGES (WhatsApp, adresse, favicon…)
// ═══════════════════════════════════════════════════════════
db.collection("settings").doc("main").onSnapshot(doc => {
  settings = doc.exists ? doc.data() : {};
  if (settings.whatsapp)   $("contactWhatsapp").textContent  = "+" + settings.whatsapp;
  if (settings.address)    $("contactAddress").textContent   = settings.address;
  if (settings.hours)      $("contactHours").textContent     = settings.hours;
  if (settings.description)$("footerDescription").textContent= settings.description;
  // Favicon dynamique
  if (settings.faviconUrl) {
    $("faviconLink").href    = settings.faviconUrl;
    $("appleTouchIcon").href = settings.faviconUrl;
    const logo = $("headerLogo");
    if (logo) logo.src = settings.faviconUrl;
  }
});
$("year").textContent = new Date().getFullYear();

// Compteur de visites
(async () => {
  try {
    await db.collection("stats").doc("visits")
      .set({ total: firebase.firestore.FieldValue.increment(1) }, { merge: true });
  } catch (_) {}
})();

// ═══════════════════════════════════════════════════════════
//  2. PRODUITS & BOUTIQUE
// ═══════════════════════════════════════════════════════════
db.collection("products").onSnapshot(snap => {
  allProducts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderFilters();
  renderProducts();
});

function renderFilters() {
  const cats = ["Tous", ...new Set(allProducts.map(p => p.category).filter(Boolean))];
  $("filters").innerHTML = cats.map(c =>
    `<button class="filter-btn${c === activeFilter ? " active" : ""}"
      onclick="setFilter('${c}')">${c}</button>`
  ).join("");
}

function setFilter(cat) {
  activeFilter = cat;
  renderFilters();
  renderProducts();
}

function renderProducts() {
  const q = ($("search").value || "").toLowerCase();
  const list = allProducts.filter(p => {
    if (Number(p.stock ?? 0) <= 0) return false;
    if (activeFilter !== "Tous" && p.category !== activeFilter) return false;
    if (q && !p.name?.toLowerCase().includes(q) && !p.desc?.toLowerCase().includes(q)) return false;
    return true;
  });
  $("products").innerHTML = list.length
    ? list.map(productCard).join("")
    : `<p style="color:#9a938c;grid-column:1/-1">Aucun produit disponible pour le moment.</p>`;
}

function productCard(p) {
  const inCart = cart.find(c => c.id === p.id);
  const img = p.image
    ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">`
    : `<div class="product-emoji">${p.emoji || "🍰"}</div>`;
  return `
    <div class="product-card">
      <div class="product-img">${img}</div>
      <div class="product-info">
        <h3>${esc(p.name)}</h3>
        <p>${esc(p.desc || "")}</p>
        <div class="product-foot">
          <strong>${money(p.price)}</strong>
          ${inCart
            ? `<div class="qty-ctrl">
                <button onclick="changeQty('${p.id}',-1)">−</button>
                <span>${inCart.qty}</span>
                <button onclick="changeQty('${p.id}',1)">+</button>
               </div>`
            : `<button class="btn-add" onclick="addToCart('${p.id}')">Ajouter</button>`}
        </div>
      </div>
    </div>`;
}

$("search").addEventListener("input", renderProducts);

// ═══════════════════════════════════════════════════════════
//  3. PANIER
// ═══════════════════════════════════════════════════════════
function addToCart(id) {
  const p = allProducts.find(x => x.id === id);
  if (!p) return;
  const existing = cart.find(c => c.id === id);
  if (existing) existing.qty++;
  else cart.push({ id, name: p.name, price: p.price, emoji: p.emoji, qty: 1 });
  updateCart();
  renderProducts();
}

function changeQty(id, delta) {
  const i = cart.findIndex(c => c.id === id);
  if (i < 0) return;
  cart[i].qty += delta;
  if (cart[i].qty <= 0) cart.splice(i, 1);
  updateCart();
  renderProducts();
}

function updateCart() {
  const total = cart.reduce((s, c) => s + c.price * c.qty, 0);
  $("cartCount").textContent = cart.reduce((s, c) => s + c.qty, 0);
  $("cartTotal").textContent = money(total);
  renderCartItems();
}

function renderCartItems() {
  const empty = cart.length === 0;
  $("cartEmpty").style.display    = empty ? "block" : "none";
  $("cartItems").style.display    = empty ? "none"  : "block";

  $("cartItems").innerHTML = cart.map(c => `
    <div class="cart-item">
      <span>${c.emoji || "🍰"} ${esc(c.name)}</span>
      <div class="qty-ctrl small">
        <button onclick="changeQty('${c.id}',-1)">−</button>
        <span>${c.qty}</span>
        <button onclick="changeQty('${c.id}',1)">+</button>
      </div>
      <strong>${money(c.price * c.qty)}</strong>
    </div>`).join("");
}

// Ouvrir / fermer panier
$("openCart").addEventListener("click",  () => toggleCart(true));
$("closeCart").addEventListener("click", () => toggleCart(false));
$("overlay").addEventListener("click",   () => toggleCart(false));
$("goShop")?.addEventListener("click",  () => toggleCart(false));

function toggleCart(open) {
  $("cartPanel").classList.toggle("open", open);
  $("overlay").classList.toggle("open", open);
  $("cartPanel").setAttribute("aria-hidden", !open);
}

// Menu mobile
$("menuBtn").addEventListener("click", () => {
  $("mainNav").classList.toggle("open");
});

// Livraison
document.querySelectorAll("input[name='deliveryMethod']").forEach(r => {
  r.addEventListener("change", () => {
    $("addressField").style.display = r.value === "livraison" ? "block" : "none";
  });
});

// ═══════════════════════════════════════════════════════════
//  4. BOUTON COMMANDER → MODALE PAIEMENT
// ═══════════════════════════════════════════════════════════
$("checkout").addEventListener("click", () => {
  if (cart.length === 0) { alert("Votre panier est vide."); return; }
  const name = $("custName").value.trim();
  const phone = $("custPhone").value.trim();
  if (!name || !phone) { alert("Merci de renseigner votre nom et votre téléphone."); return; }
  ouvrirPaiement();
});

// ═══════════════════════════════════════════════════════════
//  5. MODALE PAIEMENT PAYDUNYA
// ═══════════════════════════════════════════════════════════
let selectedChannel = "";
let selectedChannelName = "";

function ouvrirPaiement() {
  const total = cart.reduce((s, c) => s + c.price * c.qty, 0);
  $("pay-amount-display").textContent = "Total : " + money(total);
  payShowStep("methods");
  $("pay-overlay").classList.add("open");
  document.body.style.overflow = "hidden";
}

function fermerPaiement() {
  $("pay-overlay").classList.remove("open");
  document.body.style.overflow = "";
}

function payShowStep(step) {
  ["pay-step-methods","pay-form","pay-loader","pay-success","pay-error"]
    .forEach(id => $(id).style.display = "none");
  const map = {
    methods: "pay-step-methods",
    form:    "pay-form",
    loader:  "pay-loader",
    success: "pay-success",
    error:   "pay-error",
  };
  if (map[step]) $(map[step]).style.display = "block";
}

// Fermer
$("pay-close").addEventListener("click", fermerPaiement);
$("pay-overlay").addEventListener("click", e => { if (e.target === $("pay-overlay")) fermerPaiement(); });
$("pay-success-close").addEventListener("click", fermerPaiement);
$("pay-error-retry").addEventListener("click", () => payShowStep("methods"));
$("pay-back-btn").addEventListener("click", () => payShowStep("methods"));

// Sélection MTN / Moov
document.querySelectorAll(".pay-method-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    selectedChannel     = btn.dataset.channel;
    selectedChannelName = btn.dataset.name;
    $("pay-badge-container").innerHTML =
      `<div class="pay-badge">${btn.querySelector(".m-logo").textContent} ${selectedChannelName} sélectionné</div>`;
    $("pay-phone").value = "";
    payShowStep("form");
  });
});

// Confirmer le paiement
$("pay-confirm-btn").addEventListener("click", lancerPaiementPaydunya);

async function lancerPaiementPaydunya() {
  const phone = $("pay-phone").value.replace(/\s/g, "");
  if (!phone || phone.length < 8) {
    $("pay-phone").style.borderColor = "#e74c3c";
    $("pay-phone").focus();
    return;
  }
  $("pay-phone").style.borderColor = "";

  // Désactiver bouton
  $("pay-btn-text").style.display   = "none";
  $("pay-btn-loader").style.display = "inline";
  $("pay-confirm-btn").disabled = true;

  const total    = cart.reduce((s, c) => s + c.price * c.qty, 0);
  const orderRef = "NG-" + Date.now();
  const custName  = $("custName").value.trim();
  const custPhone = $("custPhone").value.trim();
  const delivery  = document.querySelector("input[name='deliveryMethod']:checked")?.value || "retrait";
  const address   = $("custAddress")?.value.trim() || "";

  // Description de la commande
  const description = cart.map(c => `${c.name} x${c.qty}`).join(", ");

  payShowStep("loader");

  try {
    // ── Appel API PayDunya ──
    // PayDunya nécessite un serveur backend pour ne pas exposer les clés.
    // Ici on utilise une Netlify Function (créée dans /netlify/functions/pay.js)
    const resp = await fetch("/.netlify/functions/pay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount:      total,
        description: description,
        orderRef:    orderRef,
        channel:     selectedChannel,
        phone:       phone,
        custName:    custName,
        custPhone:   custPhone,
      }),
    });

    const data = await resp.json();

    if (data.success) {
      // ── Paiement réussi ──
      await enregistrerCommande({
        orderRef, custName, custPhone, delivery, address,
        total, items: [...cart],
        paymentMethod: selectedChannelName,
        paymentRef:    data.token || orderRef,
        status:        "payé",
      });

      await decrementerStock();
      envoyerWhatsApp(orderRef, custName, custPhone, delivery, address, total, selectedChannelName);

      $("pay-order-ref").textContent  = "N° commande : " + orderRef;
      $("pay-success-ref").textContent = "Réf. paiement : " + (data.token || "—");
      payShowStep("success");

      // Vider le panier
      cart = [];
      updateCart();
      $("checkoutConfirm").style.display = "block";
      $("checkout").style.display = "none";

    } else {
      payShowStep("error");
      $("pay-error-msg").textContent = data.message || "Paiement refusé. Vérifiez votre solde et réessayez.";
    }

  } catch (err) {
    payShowStep("error");
    $("pay-error-msg").textContent = "Erreur de connexion. Vérifiez votre internet et réessayez.";
    console.error(err);
  }

  // Réactiver bouton
  $("pay-btn-text").style.display   = "inline";
  $("pay-btn-loader").style.display = "none";
  $("pay-confirm-btn").disabled = false;
}

// ═══════════════════════════════════════════════════════════
//  6. ENREGISTRER LA COMMANDE DANS FIRESTORE (visible dans admin)
// ═══════════════════════════════════════════════════════════
async function enregistrerCommande(data) {
  try {
    await db.collection("orders").add({
      ...data,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.error("Erreur enregistrement commande :", e);
  }
}

// ═══════════════════════════════════════════════════════════
//  7. DÉCRÉMENTER LE STOCK AUTOMATIQUEMENT
// ═══════════════════════════════════════════════════════════
async function decrementerStock() {
  const batch = db.batch();
  cart.forEach(item => {
    const ref = db.collection("products").doc(item.id);
    batch.update(ref, {
      stock: firebase.firestore.FieldValue.increment(-item.qty)
    });
  });
  try {
    await batch.commit();
  } catch (e) {
    console.error("Erreur décrémentation stock :", e);
  }
}

// ═══════════════════════════════════════════════════════════
//  8. ENVOI WHATSAPP APRÈS PAIEMENT
// ═══════════════════════════════════════════════════════════
function envoyerWhatsApp(orderRef, nom, tel, livraison, adresse, total, modePaiement) {
  const numero = settings.whatsapp || "";
  if (!numero) return;

  const lignes = cart.map(c => `• ${c.name} x${c.qty} — ${money(c.price * c.qty)}`).join("\n");
  const message = encodeURIComponent(
    `🎂 *Nouvelle commande — Nid Gourmand*\n\n` +
    `📋 *N° commande :* ${orderRef}\n` +
    `👤 *Client :* ${nom}\n` +
    `📞 *Téléphone :* ${tel}\n` +
    `📍 *Livraison :* ${livraison === "livraison" ? "Livraison — " + (adresse || "adresse à confirmer") : "Retrait en boutique"}\n\n` +
    `🛍️ *Articles :*\n${lignes}\n\n` +
    `💰 *Total :* ${money(total)}\n` +
    `✅ *Paiement :* ${modePaiement} — CONFIRMÉ\n\n` +
    `Merci de préparer cette commande ! 🙏`
  );

  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const url = isMobile
    ? `whatsapp://send?phone=${numero}&text=${message}`
    : `https://wa.me/${numero}?text=${message}`;

  setTimeout(() => window.open(url, "_blank"), 800);
}

// ═══════════════════════════════════════════════════════════
//  9. BOUTON "DEMANDER UN DEVIS" → WHATSAPP DIRECT
// ═══════════════════════════════════════════════════════════
function ouvrirDevisWhatsApp() {
  const numero = settings.whatsapp || "";
  if (!numero) {
    alert("Le numéro WhatsApp n'est pas encore configuré. Contactez l'administrateur.");
    return;
  }
  const message = encodeURIComponent(
    `Bonjour Nid Gourmand 🎂\n\n` +
    `Je souhaite obtenir un devis pour une commande personnalisée.\n\n` +
    `Pouvez-vous me contacter ?\n\nMerci !`
  );
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const url = isMobile
    ? `whatsapp://send?phone=${numero}&text=${message}`
    : `https://wa.me/${numero}?text=${message}`;
  window.open(url, "_blank");
}
// Exposer globalement pour le bouton onclick dans le HTML
window.ouvrirDevisWhatsApp = ouvrirDevisWhatsApp;

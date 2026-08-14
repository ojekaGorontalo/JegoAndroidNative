// ==================== FIREBASE CONFIG ====================
const firebaseConfig = {
  apiKey: "AIzaSyCD0pgeZio-LdKqYDtWxcdXcZwyL4ngYQI",
  authDomain: "jego-35a2b.firebaseapp.com",
  databaseURL: "https://jego-35a2b-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "jego-35a2b",
  storageBucket: "jego-35a2b.firebasestorage.app",
  messagingSenderId: "600037007040",
  appId: "1:600037007040:web:ac3243ad9b472647ffd725"
};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const database = firebase.database();
const auth = firebase.auth();

// ==================== GLOBALS ====================
let orderId = null,
  orderRef = null,
  driverLocationRef = null,
  chatRef = null;
let orderData = null,
  map = null,
  driverMarker = null,
  pickupMarker = null,
  destMarker = null,
  viaMarker = null,
  routeLine = null;
let arrivedAudio = null;
let isArrivedAlertShowing = false;
let isRatingSubmitted = false;
let selectedRating = 0;
let driverIdForRating = null;
let onesignalApiKey = null;

let currentUserBonus = 0;
let currentOrderPrice = 0;
let bonusApplied = 0;
const activeStatuses = ['accepted', 'on_the_way', 'arrived', 'on_trip'];
let driverVehicleType = 'mobil';

// ==================== AGORA ====================
const AGORA_APP_ID = "4b99abe307ac425d987518141a5d33b4";
const AGORA_APP_CERT = "0a99a957084046529b2b468cd315c6a4";
let agoraClient = null;
let localAudioTrack = null;
let remoteAudioTrack = null;
let isCallActive = false;
let isCallInProgress = false;
let customerUid = null;

// ==================== CUSTOM POPUP ====================
function showCustomAlert(title, message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('customAlertModal');
    document.getElementById('alertTitle').textContent = title || 'Pemberitahuan';
    document.getElementById('alertMessage').textContent = message || '';
    modal.style.display = 'flex';

    const okBtn = document.getElementById('alertOkBtn');
    const newOk = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newOk, okBtn);
    newOk.onclick = function () {
      modal.style.display = 'none';
      resolve();
    };
  });
}

function showCustomConfirm(title, message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirmModal');
    document.getElementById('confirmTitle').textContent = title || 'Konfirmasi';
    document.getElementById('confirmMessage').textContent = message || 'Apakah Anda yakin?';
    modal.style.display = 'flex';

    const yesBtn = document.getElementById('confirmYes');
    const noBtn = document.getElementById('confirmNo');
    const newYes = yesBtn.cloneNode(true);
    const newNo = noBtn.cloneNode(true);
    yesBtn.parentNode.replaceChild(newYes, yesBtn);
    noBtn.parentNode.replaceChild(newNo, noBtn);

    newYes.onclick = function () {
      modal.style.display = 'none';
      resolve(true);
    };
    newNo.onclick = function () {
      modal.style.display = 'none';
      resolve(false);
    };
  });
}

// ==================== UI HELPERS ====================
function formatRupiah(num) {
  return 'Rp ' + (num || 0).toLocaleString('id-ID');
}

function showToast(msg) {
  const toast = document.createElement('div');
  toast.style.cssText =
    'position:fixed; bottom:80px; left:20px; right:20px; background:#1E293B; color:white; text-align:center; padding:12px; border-radius:40px; z-index:1100; opacity:0; transition:opacity 0.2s;';
  toast.innerText = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.style.opacity = '1', 10);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
}

function showErrorUI(msg) {
  document.getElementById('loadingScreen').style.display = 'none';
  document.getElementById('errorScreen').style.display = 'flex';
  const p = document.getElementById('errorScreen').querySelector('p');
  if (p) p.innerText = msg;
  console.error(msg);
}

// ==================== ORDER HELPERS ====================
function getOrderId() {
  const urlParams = new URLSearchParams(window.location.search);
  let id = urlParams.get('order_id') || urlParams.get('id');
  if (id) return id;
  return localStorage.getItem('current_order_id');
}

function getCancelledMessage(cancelledBy) {
  if (cancelledBy === 'customer') return "⚠️ Anda telah membatalkan perjalanan ini.";
  else if (cancelledBy === 'driver') return "⚠️ Driver telah membatalkan perjalanan ini.";
  else return "⚠️ Perjalanan telah dibatalkan oleh sistem.";
}

function showCancelledWarning() {
  if (document.querySelector('.warning-message')) return;
  const contentWrapper = document.querySelector('.content-wrapper');
  const warningDiv = document.createElement('div');
  warningDiv.className = 'warning-message';
  warningDiv.innerHTML = `⚠️ Perjalanan Dibatalkan. Bonus tidak dapat dikembalikan.`;
  const statusCard = document.querySelector('.status-card');
  if (statusCard && statusCard.parentNode === contentWrapper) {
    contentWrapper.insertBefore(warningDiv, statusCard);
  } else {
    contentWrapper.prepend(warningDiv);
  }
  const chatBtn = document.getElementById('chatBtn');
  if (chatBtn) chatBtn.classList.add('disabled');
}

function extractDriverFromOrder(order, driverId) {
  if (!driverId) return null;
  if (order.driver_offers && order.driver_offers[driverId]) return order.driver_offers[driverId];
  return null;
}

// ==================== ARRIVED ALERT ====================
function showArrivedAlert() {
  if (isArrivedAlertShowing) return;
  isArrivedAlertShowing = true;
  if (arrivedAudio) {
    arrivedAudio.pause();
    arrivedAudio.currentTime = 0;
  }
  arrivedAudio = new Audio('https://jegoapp-gorontalo.netlify.app/audio/beep-warning-6387.mp3');
  arrivedAudio.loop = true;
  arrivedAudio.play().catch(e => console.warn("Audio play error:", e));
  const alertDiv = document.createElement('div');
  alertDiv.className = 'custom-alert';
  alertDiv.innerHTML =
    `<div class="custom-alert-content"><div style="font-size: 48px;">🚕</div><p style="font-weight: bold; font-size: 18px;">Driver telah tiba!</p><p>Driver sudah sampai di lokasi penjemputan Anda.</p><button class="custom-alert-button" id="arrivedAlertOkBtn">OK, Saya Tahu</button></div>`;
  document.body.appendChild(alertDiv);
  const stopAlert = () => {
    if (arrivedAudio) { arrivedAudio.pause();
      arrivedAudio.currentTime = 0;
      arrivedAudio = null; }
    if (alertDiv && alertDiv.parentNode) alertDiv.remove();
    isArrivedAlertShowing = false;
  };
  document.getElementById('arrivedAlertOkBtn').onclick = stopAlert;
}

// ==================== MAP & DRIVER MARKER ====================
function getVehicleIcon(vehicleType) {
  let iconHtml = '🚗';
  if (vehicleType) {
    const t = vehicleType.toLowerCase();
    if (t.includes('motor') || t.includes('sepeda')) iconHtml = '🏍️';
    else if (t.includes('mobil') || t.includes('car')) iconHtml = '🚗';
    else if (t.includes('truk') || t.includes('truck')) iconHtml = '🚚';
    else if (t.includes('becak')) iconHtml = '🛺';
    else if (t.includes('bus')) iconHtml = '🚌';
  }
  return L.divIcon({
    html: `<div style="font-size:32px; text-align:center; line-height:32px; background:rgba(255,255,255,0.85); border-radius:50%; padding:6px; border:3px solid #FF9800; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">${iconHtml}</div>`,
    className: 'vehicle-marker',
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    popupAnchor: [0, -22]
  });
}

function updateDriverLocation(lat, lng, bearing = 0) {
  if (!map) return;
  const icon = getVehicleIcon(driverVehicleType);
  if (driverMarker) {
    driverMarker.setLatLng([lat, lng]);
    if (driverMarker.setRotationAngle) driverMarker.setRotationAngle(bearing);
  } else {
    driverMarker = L.marker([lat, lng], { icon, rotationAngle: bearing, rotationOrigin: "center center" }).addTo(map);
    driverMarker.bindPopup('🚗 Posisi Driver').openPopup();
  }
}

// ==================== REFERRAL BONUS ====================
async function giveReferralBonusIfFirstOrder(customerUid, orderPrice, orderId) {
  if (!customerUid || !orderPrice) return;
  try {
    const referredBySnap = await database.ref(`users/${customerUid}/referred_by`).once('value');
    const referrerUid = referredBySnap.val();
    if (!referrerUid) return;
    const bonus = Math.floor(orderPrice * 0.005);
    if (bonus <= 0) return;
    await database.ref(`users/${referrerUid}/referral_bonus_total`).transaction(cur => (cur || 0) + bonus);
    await database.ref(`referralBonusHistory/${referrerUid}/${customerUid}/${orderId}`).set({
      amount: bonus,
      orderId,
      orderPrice,
      givenAt: new Date().toISOString()
    });
    await database.ref(`referralUsage/${referrerUid}/${customerUid}/lastBonusAt`).set(new Date().toISOString());
    await database.ref(`referralUsage/${referrerUid}/${customerUid}/totalBonusAccumulated`).transaction(cur => (cur || 0) +
      bonus);
    showToast(`🎉 Bonus referral Rp${bonus.toLocaleString('id-ID')} telah diberikan kepada pengguna yang mengajak Anda!`);
  } catch (err) { console.error(err); }
}

// ==================== ONESIGNAL NOTIFICATION ====================
async function getOneSignalApiKey() {
  if (onesignalApiKey) return onesignalApiKey;
  try {
    const snap = await database.ref('data-jego/PushKey').once('value');
    onesignalApiKey = snap.val();
    if (!onesignalApiKey) console.warn("PushKey tidak ditemukan");
    return onesignalApiKey;
  } catch (e) {
    console.error("Gagal ambil PushKey:", e);
    return null;
  }
}

async function sendNotificationToDriver(driverId, title, message, extraData = {}) {
  if (!driverId) return false;
  let playerId = null;
  try {
    const locSnap = await database.ref(`driver_locations/${driverId}/playerId`).once('value');
    playerId = locSnap.val();
    if (!playerId) {
      const driverSnap = await database.ref(`drivers/${driverId}/playerId`).once('value');
      playerId = driverSnap.val();
    }
  } catch (e) { console.warn('Gagal ambil playerId driver', e); }
  if (!playerId) { console.warn("Driver tidak punya playerId"); return false; }
  const apiKey = await getOneSignalApiKey();
  if (!apiKey) { console.warn("OneSignal API Key tidak tersedia"); return false; }
  try {
    const res = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Basic ${apiKey}` },
      body: JSON.stringify({
        app_id: "3357d683-8f6b-4558-9d42-2eeceed6204a",
        include_player_ids: [playerId],
        headings: { en: title },
        contents: { en: message },
        data: { orderId: orderId, type: "chat", ...extraData },
        priority: 10,
        android_priority: "high",
        android_channel_id: "022cc65d-3fb9-4939-85df-07e7cf3df0b8",
        small_icon: "ic_stat_onesignal_default",
        large_icon: "https://ojekaGorontalo.github.io/Logo/logo.png",
        android_sound: "default",
        android_vibration_pattern: [300, 500]
      })
    });
    const result = await res.json();
    if (result.errors) throw new Error(JSON.stringify(result.errors));
    console.log("Notifikasi chat ke driver terkirim");
    return true;
  } catch (err) { console.error("Gagal notif driver:", err); return false; }
}

async function notifyDriverOnChat(messageText) {
  const driverId = orderData?.driver_id;
  if (!driverId) return;
  const customerName = orderData?.customer_name || 'Customer';
  await sendNotificationToDriver(
    driverId,
    `💬 Pesan dari ${customerName}`,
    messageText.length > 60 ? messageText.slice(0, 60) + '...' : messageText, { chat: true, sender: 'customer' }
  );
}

// ==================== BONUS ====================
async function loadUserBonus() {
  const user = auth.currentUser;
  if (!user) return;
  const snap = await database.ref(`users/${user.uid}/referral_bonus_total`).once('value');
  currentUserBonus = snap.val() || 0;
  document.getElementById('userBonusAmount').innerText = formatRupiah(currentUserBonus);
}

async function checkBonusAlreadyApplied() {
  if (!orderId) return;
  const snap = await database.ref(`orders/${orderId}/bonus_used`).once('value');
  bonusApplied = snap.val() || 0;
  if (bonusApplied > 0) {
    document.getElementById('applyBonusBtn').disabled = true;
    document.getElementById('applyBonusBtn').style.opacity = '0.6';
    document.getElementById('applyBonusBtn').innerText = 'Digunakan';
    document.getElementById('bonusInput').disabled = true;
    const finalPrice = currentOrderPrice - bonusApplied;
    document.getElementById('priceDisplay').innerHTML = `${formatRupiah(finalPrice)} <small>total (sudah pakai bonus)</small>`;
    document.getElementById('price').innerHTML = formatRupiah(finalPrice);
    document.getElementById('bonusMessage').innerHTML =
      `✅ Bonus Rp ${bonusApplied.toLocaleString()} sudah digunakan. Anda bayar ${formatRupiah(finalPrice)} ke driver.`;
  } else {
    document.getElementById('priceDisplay').innerHTML = `${formatRupiah(currentOrderPrice)} <small>total</small>`;
    document.getElementById('price').innerHTML = formatRupiah(currentOrderPrice);
    document.getElementById('bonusMessage').innerHTML = '';
  }
}

async function applyBonus() {
  const bonusInput = document.getElementById('bonusInput');
  let bonusValue = parseInt(bonusInput.value);
  if (isNaN(bonusValue) || bonusValue <= 0) {
    await showCustomAlert('Perhatian', 'Masukkan nominal bonus yang valid');
    return;
  }
  if (bonusValue > currentUserBonus) {
    await showCustomAlert('Perhatian', 'Saldo bonus tidak mencukupi');
    return;
  }
  if (bonusValue > currentOrderPrice) {
    await showCustomAlert('Perhatian', 'Bonus tidak boleh melebihi harga order');
    return;
  }
  if (bonusApplied > 0) {
    await showCustomAlert('Perhatian', 'Bonus sudah pernah digunakan untuk order ini');
    return;
  }
  const user = auth.currentUser;
  if (!user) return;

  const confirmMsg =
    `Gunakan bonus Rp ${bonusValue.toLocaleString()} untuk order ini?\nHarga awal: ${formatRupiah(currentOrderPrice)}\nPotongan: ${formatRupiah(bonusValue)}\nAnda bayar: ${formatRupiah(currentOrderPrice - bonusValue)}`;
  const confirmed = await showCustomConfirm('Konfirmasi Bonus', confirmMsg);
  if (!confirmed) return;

  try {
    await database.ref(`users/${user.uid}/referral_bonus_total`).transaction(cur => (cur || 0) - bonusValue);
    await database.ref(`orders/${orderId}`).update({
      bonus_used: bonusValue,
      price_after_bonus: currentOrderPrice - bonusValue,
      bonus_applied_at: new Date().toISOString()
    });
    const driverId = orderData.driver_id;
    if (driverId && bonusValue > 0) {
      await database.ref(`driver_bonus/${driverId}`).push({
        amount: bonusValue,
        orderId,
        customerId: user.uid,
        customerName: orderData.customer_name || 'Customer',
        createdAt: new Date().toISOString(),
        status: 'pending',
        originalPrice: currentOrderPrice,
        finalPrice: currentOrderPrice - bonusValue
      });
    }
    currentUserBonus -= bonusValue;
    bonusApplied = bonusValue;
    document.getElementById('userBonusAmount').innerText = formatRupiah(currentUserBonus);
    document.getElementById('priceDisplay').innerHTML =
      `${formatRupiah(currentOrderPrice - bonusValue)} <small>total (sudah pakai bonus)</small>`;
    document.getElementById('price').innerHTML = formatRupiah(currentOrderPrice - bonusValue);
    document.getElementById('bonusMessage').innerHTML =
      `✅ Bonus Rp ${bonusValue.toLocaleString()} berhasil digunakan. Anda bayar ${formatRupiah(currentOrderPrice - bonusValue)} ke driver.`;
    document.getElementById('applyBonusBtn').disabled = true;
    document.getElementById('applyBonusBtn').style.opacity = '0.6';
    document.getElementById('applyBonusBtn').innerText = 'Digunakan';
    document.getElementById('bonusInput').disabled = true;
  } catch (err) {
    console.error(err);
    await showCustomAlert('Error', 'Gagal menggunakan bonus: ' + err.message);
  }
}

// ==================== RATING ====================
function showRatingModal() {
  if (isRatingSubmitted) return;
  selectedRating = 0;
  const stars = document.querySelectorAll('#ratingStars .rating-star');
  stars.forEach(s => { s.textContent = '☆';
    s.classList.remove('active'); });
  document.getElementById('ratingComment').value = '';
  document.getElementById('ratingPresetsContainer').innerHTML = '';
  document.getElementById('ratingModal').style.display = 'flex';
  setupRatingStars();
}

function setupRatingStars() {
  const container = document.getElementById('ratingStars');
  if (!container) return;
  const newContainer = container.cloneNode(true);
  container.parentNode.replaceChild(newContainer, container);
  const stars = newContainer.querySelectorAll('.rating-star');
  const ratingPresets = {
    1: ["Driver tidak sopan", "Perilaku tidak menyenangkan", "Tidak tepat waktu"],
    2: ["Driver kurang ramah", "Komunikasi sulit"],
    3: ["Driver biasa saja", "Performa cukup"],
    4: ["Driver ramah", "Komunikasi baik", "Tepat waktu"],
    5: ["Driver sangat ramah", "Komunikasi lancar", "Tepat waktu sekali", "Perjalanan nyaman"]
  };
  newContainer.addEventListener('click', (e) => {
    if (e.target.classList.contains('rating-star')) {
      const rating = parseInt(e.target.dataset.rating);
      selectedRating = rating;
      stars.forEach((s, idx) => { s.textContent = idx < rating ? '★' : '☆';
        s.classList.toggle('active', idx < rating); });
      const containerPreset = document.getElementById('ratingPresetsContainer');
      containerPreset.innerHTML = '';
      (ratingPresets[rating] || []).forEach(text => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'preset-btn';
        btn.textContent = text;
        btn.addEventListener('click', () => {
          const ta = document.getElementById('ratingComment');
          if (ta.value.trim() === '') ta.value = text;
          else ta.value += ', ' + text;
        });
        containerPreset.appendChild(btn);
      });
    }
  });
}

function closeRatingModal() {
  document.getElementById('ratingModal').style.display = 'none';
}

async function submitRating() {
  if (selectedRating === 0) {
    await showCustomAlert('Perhatian', 'Pilih rating terlebih dahulu');
    return;
  }
  const comment = document.getElementById('ratingComment').value.trim();
  const btn = document.getElementById('ratingSubmitBtn');
  btn.disabled = true;
  btn.textContent = 'Mengirim...';
  try {
    const user = auth.currentUser;
    if (!user) throw new Error('User tidak login');
    if (!driverIdForRating) throw new Error('Driver ID tidak ditemukan');
    await database.ref(`ratings/${orderId}/driver_rating`).set({
      rating: selectedRating,
      customer_id: user.uid,
      customer_name: orderData?.customer_name || 'Customer',
      order_id: orderId,
      driver_id: driverIdForRating,
      comment: comment,
      created_at: new Date().toISOString(),
      timestamp: Date.now()
    });
    isRatingSubmitted = true;
    closeRatingModal();
    await showCustomAlert('Terima Kasih', `Rating ${selectedRating} bintang berhasil diberikan.`);
  } catch (err) {
    console.error(err);
    await showCustomAlert('Error', 'Gagal mengirim rating: ' + err.message);
    btn.disabled = false;
    btn.textContent = 'Kirim Rating';
  }
}

// ==================== DELIVERY CARD ====================
function updateDeliveryCard(order) {
  const card = document.getElementById('deliveryInfoCard');
  const transportType = order.transport_type || '';
  const isKurir = transportType.includes('kurir');
  if (isKurir) {
    document.getElementById('deliveryCategory').textContent = order.item_category || '-';
    document.getElementById('deliveryDescription').textContent = order.item_description || '-';
    document.getElementById('deliverySender').textContent = order.sender_phone || '-';
    document.getElementById('deliveryReceiver').textContent = order.receiver_phone || '-';
    card.style.display = 'block';
  } else {
    card.style.display = 'none';
  }
}

// ==================== LOAD ORDER ====================
async function loadOrderData() {
  orderId = getOrderId();
  if (!orderId) {
    showErrorUI('Tidak ada ID pesanan. Silakan mulai dari awal.');
    return;
  }
  try {
    const orderSnap = await database.ref(`orders/${orderId}`).once('value');
    const order = orderSnap.val();
    if (!order) throw new Error(`Order ${orderId} tidak ditemukan.`);
    orderData = order;
    currentOrderPrice = order.price || 0;
    await loadUserBonus();
    await checkBonusAlreadyApplied();

    updateDeliveryCard(order);

    document.getElementById('priceDisplay').innerHTML = `${formatRupiah(currentOrderPrice)} <small>total</small>`;
    document.getElementById('price').innerHTML = formatRupiah(currentOrderPrice);
    let driverId = order.driver_id;
    if (!driverId && order.driver_offers) {
      for (let did in order.driver_offers) {
        if (order.driver_offers[did].status === 'accepted') { driverId = did; break; }
      }
    }
    driverIdForRating = driverId;
    let driverInfo = null;
    if (driverId) {
      driverInfo = extractDriverFromOrder(order, driverId);
      if (driverInfo && driverInfo.driver_type) {
        driverVehicleType = driverInfo.driver_type;
      } else if (order.driver_type) {
        driverVehicleType = order.driver_type;
      }
    }
    
    // Di dalam loadOrderData(), setelah semua data di-set dan sebelum menampilkan mainContent

// Tampilkan tombol aksi
document.getElementById('cancelHeaderBtn').classList.remove('hidden');
document.getElementById('actionsSection').classList.remove('hidden');

    document.getElementById('loadingScreen').style.display = 'none';
    document.getElementById('mainContent').style.display = 'block';
    document.getElementById('pickupAddr').innerText = order.pickup_address || '-';
    document.getElementById('destAddr').innerText = order.destination_address || '-';

    const viaPointDiv = document.getElementById('viaPoint');
    const viaAddrSpan = document.getElementById('viaAddr');
    if (order.via_address) {
      viaAddrSpan.innerText = order.via_address;
      viaPointDiv.style.display = 'flex';
    } else {
      viaPointDiv.style.display = 'none';
    }

    if (driverInfo) {
      document.getElementById('driverName').innerText = driverInfo.driver_name || 'Driver';
      document.getElementById('driverRating').innerHTML = `⭐ ${(driverInfo.driver_rating || 5).toFixed(1)}`;
      document.getElementById('driverPlate').innerText = driverInfo.driver_plate || '-';
      document.getElementById('driverVehicle').innerText = driverInfo.driver_type || '-';
      if (driverInfo.driver_photo) document.getElementById('driverPhoto').src = driverInfo.driver_photo;
    }
    updateStatusUI(order.status, order.cancelled_by);
    initMap(order);
    startRealtimeUpdates(orderId);
    initChat(orderId);
    if (order.status === 'arrived') showArrivedAlert();
    if (order.status === 'completed' && !isRatingSubmitted) setTimeout(() => showRatingModal(), 1500);
  } catch (err) {
    console.error(err);
    showErrorUI(`Gagal memuat data: ${err.message}`);
  }
}

// ==================== STATUS UI ====================
function updateStatusUI(status, cancelledBy = null) {
  const badge = document.getElementById('statusBadge');
  const msgDiv = document.getElementById('statusMessage');
  const cancelledDiv = document.getElementById('cancelledByMessage');
  const statusMap = {
    'accepted': { text: 'Driver Diterima', msg: 'Driver sedang menuju lokasi Anda' },
    'on_the_way': { text: 'Menuju Lokasi', msg: 'Driver dalam perjalanan ke titik jemput' },
    'arrived': { text: 'Driver Tiba', msg: 'Driver telah sampai di lokasi penjemputan' },
    'on_trip': { text: 'Perjalanan Dimulai', msg: 'Anda sedang dalam perjalanan ke tujuan' },
    'completed': { text: 'Selesai', msg: 'Perjalanan telah selesai. Terima kasih!' },
    'cancelled': { text: 'Dibatalkan', msg: 'Perjalanan dibatalkan' }
  };
  const info = statusMap[status] || statusMap.waiting;
  badge.innerText = info.text;
  msgDiv.innerText = info.msg;
  if (status === 'cancelled') {
    cancelledDiv.innerText = getCancelledMessage(cancelledBy);
    cancelledDiv.style.display = 'block';
  } else cancelledDiv.style.display = 'none';

  // Update tombol cancel di header
  const cancelBtn = document.getElementById('cancelHeaderBtn');
  if (status === 'on_trip' || status === 'completed' || status === 'cancelled') {
    cancelBtn.classList.add('disabled');
  } else {
    cancelBtn.classList.remove('disabled');
  }
  
  // Di dalam updateStatusUI(), setelah update cancelBtn
const chatBtn = document.getElementById('chatBtn');
const callBtn = document.getElementById('callBtn');

if (status === 'cancelled' || status === 'completed') {
  chatBtn.classList.add('disabled');
  callBtn.classList.add('disabled');
  chatBtn.disabled = true;
  callBtn.disabled = true;
} else {
  chatBtn.classList.remove('disabled');
  callBtn.classList.remove('disabled');
  chatBtn.disabled = false;
  callBtn.disabled = false;
}

  document.getElementById('orderStatus').innerText = info.text;
  if (status === 'arrived' && !isArrivedAlertShowing) showArrivedAlert();

  const isActive = activeStatuses.includes(status);
  const applyBtn = document.getElementById('applyBonusBtn');
  const bonusInput = document.getElementById('bonusInput');
  if (!isActive && applyBtn) { applyBtn.disabled = true;
    applyBtn.style.opacity = '0.6'; if (bonusInput) bonusInput.disabled = true; } else if (isActive && bonusApplied === 0 &&
    applyBtn) { applyBtn.disabled = false;
    applyBtn.style.opacity = '1'; if (bonusInput) bonusInput.disabled = false; }
}

// ==================== MAP ====================
function initMap(order) {
  if (!order.pickup_lat || !order.dest_lat) return;
  const centerLat = (order.pickup_lat + order.dest_lat) / 2;
  const centerLng = (order.pickup_lng + order.dest_lng) / 2;
  map = L.map('orderMap').setView([centerLat, centerLng], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
  pickupMarker = L.marker([order.pickup_lat, order.pickup_lng], {
    icon: L.divIcon({
      html: '<div style="background:#28a745; width:30px; height:30px; border-radius:50%; text-align:center; line-height:30px; color:white; font-weight:bold;">A</div>'
    })
  }).addTo(map).bindPopup('Penjemputan');
  if (order.via_lat && order.via_lng) {
    viaMarker = L.marker([order.via_lat, order.via_lng], {
      icon: L.divIcon({
        html: '<div style="background:#2196F3; width:30px; height:30px; border-radius:50%; text-align:center; line-height:30px; color:white; font-weight:bold;">🔵</div>'
      })
    }).addTo(map).bindPopup('Titik Singgah');
  }
  destMarker = L.marker([order.dest_lat, order.dest_lng], {
    icon: L.divIcon({
      html: '<div style="background:#dc3545; width:30px; height:30px; border-radius:50%; text-align:center; line-height:30px; color:white; font-weight:bold;">B</div>'
    })
  }).addTo(map).bindPopup('Tujuan');
  drawRoute(order);
}

async function drawRoute(order) {
  try {
    let waypoints = [];
    waypoints.push({ lat: order.pickup_lat, lng: order.pickup_lng });
    if (order.via_lat && order.via_lng) waypoints.push({ lat: order.via_lat, lng: order.via_lng });
    waypoints.push({ lat: order.dest_lat, lng: order.dest_lng });
    let coordString = waypoints.map(wp => `${wp.lng},${wp.lat}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coordString}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.routes && data.routes.length) {
      const coords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
      if (routeLine) map.removeLayer(routeLine);
      routeLine = L.polyline(coords, { color: '#FF9800', weight: 5 }).addTo(map);
      map.fitBounds(routeLine.getBounds(), { padding: [40, 40] });
    }
  } catch (e) { console.warn(e); }
}

// ==================== REALTIME UPDATES ====================
function startRealtimeUpdates(orderId) {
  orderRef = database.ref(`orders/${orderId}`);
  let previousStatus = null;
  orderRef.on('value', async (snap) => {
    const newOrder = snap.val();
    if (newOrder) {
      orderData = newOrder;
      updateStatusUI(newOrder.status, newOrder.cancelled_by);
      updateDeliveryCard(newOrder);

      let driverId = newOrder.driver_id;
      if (!driverId && newOrder.driver_offers) {
        for (let did in newOrder.driver_offers) {
          if (newOrder.driver_offers[did].status === 'accepted') { driverId = did; break; }
        }
      }
      driverIdForRating = driverId;
      if (driverId && newOrder.driver_offers && newOrder.driver_offers[driverId]) {
        const d = newOrder.driver_offers[driverId];
        document.getElementById('driverName').innerText = d.driver_name || 'Driver';
        document.getElementById('driverRating').innerHTML = `⭐ ${(d.driver_rating || 5).toFixed(1)}`;
        document.getElementById('driverPlate').innerText = d.driver_plate || '-';
        document.getElementById('driverVehicle').innerText = d.driver_type || '-';
        if (d.driver_photo) document.getElementById('driverPhoto').src = d.driver_photo;
        if (d.driver_type) driverVehicleType = d.driver_type;
      }
      if (newOrder.price) {
        currentOrderPrice = newOrder.price;
        if (!bonusApplied) {
          document.getElementById('priceDisplay').innerHTML = `${formatRupiah(currentOrderPrice)} <small>total</small>`;
          document.getElementById('price').innerHTML = formatRupiah(currentOrderPrice);
        } else {
          const finalPrice = currentOrderPrice - bonusApplied;
          document.getElementById('priceDisplay').innerHTML =
            `${formatRupiah(finalPrice)} <small>total (sudah pakai bonus)</small>`;
          document.getElementById('price').innerHTML = formatRupiah(finalPrice);
        }
      }
      if (previousStatus !== 'completed' && newOrder.status === 'completed') {
        const userId = auth.currentUser?.uid;
        const orderPrice = newOrder.price || newOrder.totalPrice || 0;
        const transportType = newOrder.transport_type || '';
        const isTransport = transportType && !transportType.includes('kurir');
        if (userId) {
          const userRef = database.ref(`users/${userId}`);
          await userRef.transaction(cur => { if (cur) cur.perjalanan = (cur.perjalanan || 0) + 1; return cur; });
        }
        if (userId && orderPrice > 0 && isTransport) await giveReferralBonusIfFirstOrder(userId, orderPrice, orderId);
        if (!isRatingSubmitted) setTimeout(() => showRatingModal(), 1000);
      }
      previousStatus = newOrder.status;
    }
  });
  const driverId = orderData?.driver_id;
  if (driverId) {
    driverLocationRef = database.ref(`driver_locations/${driverId}`);
    driverLocationRef.on('value', (snap) => {
      const loc = snap.val();
      if (loc && typeof loc.latitude === 'number' && typeof loc.longitude === 'number') {
        updateDriverLocation(loc.latitude, loc.longitude, loc.heading || 0);
      }
    });
  }
}

// ==================== CHAT ====================
function initChat(orderId) {
  chatRef = database.ref(`chat/${orderId}`);
  chatRef.off();
  chatRef.on('child_added', (snap) => {
    const msg = snap.val();
    if (chatOpen) addMessageToChat(msg);
    updateUnreadBadgeCustomer();
  });
  loadChatHistory();
  setTimeout(updateUnreadBadgeCustomer, 1000);
}

function loadChatHistory() {
  if (!chatRef) return;
  chatRef.once('value', snap => {
    const msgs = snap.val() || {};
    const container = document.getElementById('chatMessages');
    container.innerHTML = '';
    const sorted = Object.values(msgs).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    sorted.forEach(msg => addMessageToChat(msg));
  });
}

function addMessageToChat(msg) {
  if (!msg || !msg.message) return;
  const container = document.getElementById('chatMessages');
  const div = document.createElement('div');
  const senderClass = (msg.sender === 'customer') ? 'customer' : 'driver';
  div.className = `message ${senderClass}`;
  const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit',
    second: '2-digit' }) : '';

  let tickHtml = '';
  if (msg.sender === 'customer') {
    const readBy = msg.readBy || {};
    if (readBy.driver) {
      tickHtml = '<span class="tick read">✓✓</span>';
    } else {
      tickHtml = '<span class="tick">✓</span>';
    }
  } else if (msg.sender === 'driver') {
    const readBy = msg.readBy || {};
    if (readBy.customer) {
      tickHtml = '<span class="tick read">✓✓</span>';
    } else {
      tickHtml = '<span class="tick">✓</span>';
    }
  }

  div.innerHTML = `${escapeHtml(msg.message)}${tickHtml}<small>${time}</small>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function updateUnreadBadgeCustomer() {
  const badge = document.getElementById('chatBadge');
  if (!chatRef) return;
  chatRef.once('value', snap => {
    const msgs = snap.val() || {};
    let unreadCount = 0;
    for (let key in msgs) {
      const msg = msgs[key];
      if (msg.sender === 'driver') {
        const readBy = msg.readBy || {};
        if (!readBy.customer) unreadCount++;
      }
    }
    if (unreadCount > 0) {
      badge.textContent = unreadCount;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  });
}

function markDriverMessagesAsRead() {
  if (!chatRef) return;
  chatRef.once('value', snap => {
    const msgs = snap.val() || {};
    const updates = {};
    for (let key in msgs) {
      const msg = msgs[key];
      if (msg.sender === 'driver') {
        const readBy = msg.readBy || {};
        if (!readBy.customer) {
          readBy.customer = true;
          updates[`${key}/readBy`] = readBy;
        }
      }
    }
    if (Object.keys(updates).length > 0) {
      chatRef.update(updates);
      loadChatHistory();
    }
  });
}

async function sendCustomerChatMessage() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;
  const user = auth.currentUser;
  if (!user) {
    await showCustomAlert('Perhatian', 'Anda belum login.');
    return;
  }
  try {
    await chatRef.push({
      sender: 'customer',
      sender_id: user.uid,
      message: text,
      timestamp: Date.now(),
      readBy: { customer: true, driver: false }
    });
    input.value = '';
    await notifyDriverOnChat(text);
  } catch (err) {
    console.error('Gagal mengirim chat:', err);
    showToast('Gagal mengirim pesan');
  }
}

let chatOpen = false;

function openChat() {
  chatOpen = true;
  const overlay = document.getElementById('chatOverlay');
  overlay.style.display = 'flex';
  overlay.classList.add('open');
  markDriverMessagesAsRead();
  document.getElementById('chatBadge').classList.add('hidden');
}

function closeChat() {
  chatOpen = false;
  const overlay = document.getElementById('chatOverlay');
  overlay.style.display = 'none';
  overlay.classList.remove('open');
}

// ==================== CANCEL ORDER ====================
async function cancelOrder() {
  if (document.getElementById('cancelHeaderBtn').classList.contains('disabled')) {
    await showCustomAlert('Perhatian', 'Perjalanan sudah dalam perjalanan atau selesai, tidak dapat dibatalkan.');
    return;
  }
  const confirmed = await showCustomConfirm(
    'Batalkan Perjalanan',
    'Batalkan perjalanan ini? Perhatian: bonus yang sudah digunakan TIDAK akan dikembalikan.'
  );
  if (!confirmed) return;
  try {
    await database.ref(`orders/${orderId}`).update({
      status: 'cancelled',
      cancelled_by: 'customer',
      cancelled_at: new Date().toISOString()
    });
    updateStatusUI('cancelled', 'customer');
    showCancelledWarning();
    showToast('Perjalanan dibatalkan. Bonus tidak dapat dikembalikan.');
  } catch (err) {
    console.error(err);
    await showCustomAlert('Error', 'Gagal membatalkan perjalanan. Silakan coba lagi.');
  }
}

// ==================== AGORA ====================
async function getAgoraToken(channelName, uid) {
  try {
    const response = await fetch('https://asia-southeast1-jego-35a2b.cloudfunctions.net/generateAgoraToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelName, uid })
    });
    const data = await response.json();
    return data.token;
  } catch (error) {
    console.warn('Gagal ambil token dari Cloud Function:', error);
    return null;
  }
}

async function startCallInternal(channelName, uid, token) {
  try {
    agoraClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });

    agoraClient.on('user-published', async (user, mediaType) => {
      await agoraClient.subscribe(user, mediaType);
      if (mediaType === 'audio') {
        remoteAudioTrack = user.audioTrack;
        remoteAudioTrack.play();
        showToast('Driver terhubung');
        isCallActive = true;
        updateCallUI('connected');
        document.getElementById('callStatusIndicator').style.display = 'block';
      }
    });

    agoraClient.on('user-unpublished', (user) => {
      if (remoteAudioTrack && user.uid === remoteAudioTrack.getUserId()) {
        remoteAudioTrack = null;
        showToast('Driver mengakhiri panggilan');
        endCall();
      }
    });

    agoraClient.on('user-left', (user) => {
      if (remoteAudioTrack && user.uid === remoteAudioTrack.getUserId()) {
        remoteAudioTrack = null;
        showToast('Driver meninggalkan panggilan');
        endCall();
      }
    });

    await agoraClient.join(AGORA_APP_ID, channelName, token, uid);

    localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
    await agoraClient.publish([localAudioTrack]);

    showToast('Menghubungkan...');
    updateCallUI('calling');

    setTimeout(() => {
      if (!isCallActive && isCallInProgress) {
        showToast('Driver tidak merespon');
        endCall();
      }
    }, 30000);

  } catch (error) {
    console.error('Gagal memulai panggilan:', error);
    showToast('Gagal memulai panggilan: ' + error.message);
    isCallInProgress = false;
    updateCallUI('idle');
  }
}

function startCall() {
  if (isCallInProgress) {
    showToast('Panggilan sedang berlangsung');
    return;
  }
  if (!orderId || !customerUid) {
    showToast('Data order belum siap');
    return;
  }

  showCustomConfirm(
    '📞 Panggilan Suara',
    'Anda akan menghubungi driver melalui panggilan suara (VoIP). Lanjutkan?'
  ).then(async (confirmed) => {
    if (!confirmed) {
      showToast('Panggilan dibatalkan');
      return;
    }
    isCallInProgress = true;
    const channelName = `jego-${orderId}`;
    const uid = parseInt(customerUid.replace(/\D/g, '').slice(0, 8) || Math.floor(Math.random() * 100000));

    try {
      let token = await getAgoraToken(channelName, uid);
      if (!token) {
        showToast('Token tidak tersedia. Pastikan Cloud Function berjalan.');
        isCallInProgress = false;
        updateCallUI('idle');
        return;
      }
      await startCallInternal(channelName, uid, token);
    } catch (err) {
      console.error(err);
      showToast('Gagal memulai panggilan: ' + err.message);
      isCallInProgress = false;
      updateCallUI('idle');
    }
  });
}

async function endCall() {
  if (localAudioTrack) {
    localAudioTrack.close();
    localAudioTrack = null;
  }
  if (remoteAudioTrack) {
    remoteAudioTrack.stop();
    remoteAudioTrack = null;
  }
  if (agoraClient) {
    await agoraClient.leave();
    agoraClient = null;
  }
  isCallActive = false;
  isCallInProgress = false;
  document.getElementById('callStatusIndicator').style.display = 'none';
  updateCallUI('idle');
  showToast('Panggilan berakhir');
}

function updateCallUI(status) {
  const callBtn = document.getElementById('callBtn');
  if (!callBtn) return;
  if (status === 'idle') {
    callBtn.innerHTML = '📞 Panggil';
    callBtn.className = 'action-btn call-btn';
    callBtn.disabled = false;
  } else if (status === 'calling') {
    callBtn.innerHTML = '⏳ Menghubungi...';
    callBtn.className = 'action-btn call-btn';
    callBtn.disabled = true;
  } else if (status === 'connected') {
    callBtn.innerHTML = '🔴 Akhiri Panggilan';
    callBtn.className = 'action-btn call-btn active-call';
    callBtn.disabled = false;
  }
}

// ==================== BACK BUTTON HANDLER ====================
window.addEventListener('popstate', function(event) {
  if (document.getElementById('chatOverlay').classList.contains('open')) {
    closeChat();
    history.pushState(null, null, location.href);
    event.preventDefault();
  } else {
    history.pushState(null, null, location.href);
    event.preventDefault();
  }
});
history.pushState(null, null, location.href);

// ==================== DOM READY ====================
document.addEventListener('DOMContentLoaded', () => {
  auth.onAuthStateChanged(async (user) => {
    if (user) {
      customerUid = user.uid;
      await loadOrderData();
      updateCallUI('idle');
    } else {
      showErrorUI('Anda harus login terlebih dahulu.');
      setTimeout(() => window.location.href = 'loginUser.html', 2000);
    }
  });

  // Chat
  document.getElementById('chatBtn').onclick = openChat;
  document.getElementById('closeChatBtn').onclick = closeChat;
  document.getElementById('sendChatBtn').onclick = sendCustomerChatMessage;
  document.getElementById('chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault();
      sendCustomerChatMessage(); }
  });

  // Cancel di Header
  document.getElementById('cancelHeaderBtn').onclick = cancelOrder;

  // Retry
  document.getElementById('retryBtn')?.addEventListener('click', () => window.location.reload());

  // Bonus
  document.getElementById('applyBonusBtn')?.addEventListener('click', applyBonus);

  // Rating
  document.getElementById('ratingCancelBtn').onclick = closeRatingModal;
  document.getElementById('ratingSubmitBtn').onclick = submitRating;

  // Call
  document.getElementById('callBtn').addEventListener('click', function() {
    if (isCallActive || isCallInProgress) {
      endCall();
    } else {
      startCall();
    }
  });
});

// cleanup saat halaman ditutup
window.addEventListener('beforeunload', function() {
  if (isCallActive || isCallInProgress) endCall();
});
// ==================== FIREBASE CONFIG ====================
const firebaseConfig = {
  apiKey: "AIzaSyCD0pgeZio-LdKqYDtWxcdXcZwyL4ngYQI",
  authDomain: "jego-35a2b.firebaseapp.com",
  databaseURL: "https://jego-35a2b-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "jego-35a2b",
  storageBucket: "jego-35a2b.firebasestorage.app",
  appId: "1:600037007040:web:ac3243ad9b472647ffd725"
};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const database = firebase.database();

// ==================== GLOBAL ====================
let orderData = null, orderId = null, orderRef = null;
let currentStatus = '';
let orderMap = null, routePolyline = null;
let selectedRating = 0;
let customerId = null;
let chatRef = null;
let chatOpen = false;
let onesignalApiKey = null;
let driverUid = null;
let driverMarker = null;

let currentDriverLat = null;
let currentDriverLng = null;
let routeDriverToPickup = null;
let routePickupToDest = null;
let distanceLabelMarkers = [];
let routesDrawn = false;

// ==================== LOCATION ====================
let lastSentLat = null, lastSentLng = null;
const LOCATION_THRESHOLD_KM = 0.05;
let locationWatchId = null;
let isLocationTracking = false;

function calculateDistance(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return null;
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// ==================== UI HELPERS ====================
function showToast(msg) {
  let t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._hideTimer);
  t._hideTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

function getDriverData() { return JSON.parse(localStorage.getItem('jego_logged_in_driver') || '{}'); }

function escapeHtml(str) { if (!str) return ''; return str.replace(/[&<>]/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;' }[m])); }

// ==================== CALL OVERLAY ====================
function showCallOverlay(status, sub) {
  document.getElementById('callOverlay').classList.add('active');
  document.getElementById('callOverlayStatus').innerText = status || '📞 Memanggil...';
  document.getElementById('callOverlaySub').innerText = sub || 'Menghubungkan ke customer';
}

function hideCallOverlay() {
  document.getElementById('callOverlay').classList.remove('active');
}

window.updateCallStatus = function(status) {
  const btn = document.getElementById('callBtn');
  if (status === 'idle') {
    btn.innerHTML = '📞 Telepon';
    btn.className = 'action-btn-modern btn-outline';
    btn.disabled = false;
    document.getElementById('callStatusIndicator').style.display = 'none';
    hideCallOverlay();
  } else if (status === 'calling') {
    btn.innerHTML = '⏳ Menghubungi...';
    btn.className = 'action-btn-modern btn-outline';
    btn.disabled = true;
    document.getElementById('callStatusIndicator').style.display = 'none';
    showCallOverlay('📞 Memanggil...', 'Menghubungkan ke customer');
  } else if (status === 'connected') {
    btn.innerHTML = '🔴 Akhiri Panggilan';
    btn.className = 'action-btn-modern btn-outline';
    btn.disabled = false;
    document.getElementById('callStatusIndicator').style.display = 'block';
    showCallOverlay('📞 Panggilan Aktif', 'Terhubung dengan customer');
  }
};

window.showToastAndroid = function(msg) { showToast(msg); };

// ==================== CUSTOM CONFIRM ====================
function showConfirmPopup(title, message, onConfirm, onCancel) {
  const modal = document.getElementById('confirmModal');
  document.getElementById('confirmTitle').textContent = title || 'Konfirmasi';
  document.getElementById('confirmMessage').textContent = message || 'Apakah Anda yakin?';
  const yesBtn = document.getElementById('confirmYes');
  const noBtn = document.getElementById('confirmNo');
  const newYes = yesBtn.cloneNode(true);
  const newNo = noBtn.cloneNode(true);
  yesBtn.parentNode.replaceChild(newYes, yesBtn);
  noBtn.parentNode.replaceChild(newNo, noBtn);
  newYes.onclick = function() { modal.style.display = 'none'; if (typeof onConfirm === 'function') onConfirm(); };
  newNo.onclick = function() { modal.style.display = 'none'; if (typeof onCancel === 'function') onCancel(); };
  modal.style.display = 'flex';
}

// ==================== NATIVE CALL ====================
function callCustomerNative() {
  const phone = document.getElementById('customerPhone').innerText;
  const name = document.getElementById('customerName').innerText;
  if (!phone || phone === '-') {
    showToast("Nomor customer tidak tersedia");
    return;
  }
  showConfirmPopup(
    `📞 Hubungi ${name}`,
    `Anda akan menghubungi ${name} melalui panggilan telepon. Lanjutkan?`,
    function() {
      if (typeof Android !== 'undefined' && Android.callPhone) {
        Android.callPhone(phone);
      } else {
        window.location.href = `tel:${phone}`;
      }
    },
    function() { showToast("Panggilan dibatalkan"); }
  );
}

// ==================== VEHICLE ICON ====================
function getVehicleIcon(transportType) {
  let iconHtml = '🚗';
  if (transportType) {
    const t = transportType.toLowerCase();
    if (t.includes('motor') || t.includes('sepeda')) iconHtml = '🏍️';
    else if (t.includes('mobil') || t.includes('car')) iconHtml = '🚗';
    else if (t.includes('truk') || t.includes('truck')) iconHtml = '🚚';
    else if (t.includes('becak')) iconHtml = '🛺';
    else if (t.includes('bus')) iconHtml = '🚌';
  }
  return L.divIcon({
    html: `<div style="font-size:32px; text-align:center; line-height:32px; background:rgba(255,255,255,0.9); border-radius:50%; padding:6px; border:3px solid #FF8A00; box-shadow:0 4px 16px rgba(0,0,0,0.2);">${iconHtml}</div>`,
    className: 'vehicle-marker',
    iconSize: [44,44],
    iconAnchor: [22,22],
    popupAnchor: [0,-22]
  });
}

function updateDriverMarker(lat, lng, heading) {
  if (!orderMap) return;
  if (!driverMarker) {
    const icon = getVehicleIcon(orderData?.transport_type);
    driverMarker = L.marker([lat,lng], { icon, rotationAngle: heading||0, rotationOrigin:'center center' }).addTo(orderMap);
    driverMarker.bindPopup('🚗 Posisi Anda');
  } else {
    driverMarker.setLatLng([lat,lng]);
    if (driverMarker.setRotationAngle) driverMarker.setRotationAngle(heading||0);
  }
}

// ==================== LOCATION TRACKING ====================
function startLocationTracking() {
  if (!navigator.geolocation || isLocationTracking) return;
  isLocationTracking = true;
  let firstLocation = true;

  locationWatchId = navigator.geolocation.watchPosition(
    (position) => {
      const { latitude, longitude, heading, speed } = position.coords;
      if (!driverUid) return;

      currentDriverLat = latitude;
      currentDriverLng = longitude;
      updateDriverMarker(latitude, longitude, heading||0);

      // Jika lokasi pertama kali didapat, perbarui rute
      if (firstLocation && orderData && orderData.pickup_lat && orderData.dest_lat) {
        firstLocation = false;
        fetchAndDisplayRoutes(
          latitude, longitude,
          orderData.pickup_lat, orderData.pickup_lng,
          orderData.via_lat, orderData.via_lng,
          orderData.dest_lat, orderData.dest_lng
        );
        // Perbarui bounds peta agar semua rute terlihat
        if (routePickupToDest && orderMap) {
          orderMap.fitBounds(routePickupToDest.getBounds(), { padding: [40, 40] });
        }
      }

      let shouldUpdate = false;
      if (lastSentLat === null || lastSentLng === null) {
        shouldUpdate = true;
      } else {
        const dist = calculateDistance(lastSentLat, lastSentLng, latitude, longitude);
        if (dist !== null && dist > LOCATION_THRESHOLD_KM) shouldUpdate = true;
      }
      if (shouldUpdate) {
        database.ref(`driver_locations/${driverUid}`).update({
          latitude, longitude, heading: heading||0, speed: speed||0,
          timestamp: Date.now(), orderId: orderId
        }).catch(()=>{});
        lastSentLat = latitude;
        lastSentLng = longitude;
      }
    },
    (error) => console.warn("Geolocation error:", error.message),
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 5000 }
  );
}

function stopLocationTracking() {
  if (locationWatchId !== null) {
    navigator.geolocation.clearWatch(locationWatchId);
    locationWatchId = null;
    isLocationTracking = false;
  }
}

// ==================== NOTIFICATIONS ====================
async function getOneSignalApiKey() {
  if (onesignalApiKey) return onesignalApiKey;
  const snap = await database.ref('data-jego/PushKey').once('value');
  onesignalApiKey = snap.val();
  return onesignalApiKey;
}
const ONESIGNAL_APP_ID = "007d7eba-9cfc-40d1-a92e-f2299f770282";

async function sendNotificationToCustomer(title, message, extraData = {}) {
  if (!customerId) return false;
  const playerSnap = await database.ref(`users/${customerId}/playerId`).once('value');
  const playerId = playerSnap.val();
  if (!playerId) return false;
  const apiKey = await getOneSignalApiKey();
  if (!apiKey) return false;
  try {
    await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Basic ${apiKey}` },
      body: JSON.stringify({
        app_id: ONESIGNAL_APP_ID,
        include_player_ids: [playerId],
        headings: { en: title },
        contents: { en: message },
        data: { orderId: orderId, type: "chat", ...extraData },
        priority: 10,
        android_priority: "high",
        android_channel_id: "022cc65d-3fb9-4939-85df-07e7cf3df0b8"
      })
    });
    return true;
  } catch (err) { return false; }
}

// ==================== CHAT ====================
function updateUnreadBadge() {
  const badge = document.getElementById('chatBadge');
  if (!chatRef || !driverUid) return;
  chatRef.once('value', snap => {
    const msgs = snap.val() || {};
    let unreadCount = 0;
    for (let key in msgs) {
      const msg = msgs[key];
      if (msg.sender === 'customer') {
        const readBy = msg.readBy || {};
        if (!readBy.driver) unreadCount++;
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

function markMessagesAsRead() {
  if (!chatRef || !driverUid) return;
  chatRef.once('value', snap => {
    const msgs = snap.val() || {};
    const updates = {};
    for (let key in msgs) {
      const msg = msgs[key];
      if (msg.sender === 'customer') {
        const readBy = msg.readBy || {};
        if (!readBy.driver) {
          readBy.driver = true;
          updates[`${key}/readBy`] = readBy;
        }
      }
    }
    if (Object.keys(updates).length > 0) chatRef.update(updates);
    document.getElementById('chatBadge').classList.add('hidden');
  });
}

function openChat() {
  chatOpen = true;
  document.getElementById('chatOverlay').style.display = 'flex';
  document.getElementById('chatOverlay').classList.add('open');
  loadChatHistory();
  markMessagesAsRead();
  document.getElementById('chatBadge').classList.add('hidden');
  document.getElementById('mapActionBtn').style.display = 'none';
}

function closeChat() {
  chatOpen = false;
  document.getElementById('chatOverlay').style.display = 'none';
  document.getElementById('chatOverlay').classList.remove('open');
  updateUnreadBadge();
  updateActionButtons();
}

function loadChatHistory() {
  database.ref(`chat/${orderId}`).once('value', snap => {
    let msgs = snap.val();
    let container = document.getElementById('chatMessages');
    container.innerHTML = '';
    if (msgs) Object.values(msgs).forEach(m => addMessageToChat(m));
  });
}

function addMessageToChat(msg) {
  let div = document.createElement('div');
  let senderClass = (msg.sender === 'driver') ? 'driver' : 'customer';
  div.className = `message ${senderClass}`;
  let timeStr = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : '';
  let tickHtml = '';
  if (msg.sender === 'driver') {
    tickHtml = (msg.readBy && msg.readBy.customer) ? '<span class="tick read">✓✓</span>' : '<span class="tick delivered">✓</span>';
  } else if (msg.sender === 'customer') {
    tickHtml = (msg.readBy && msg.readBy.driver) ? '<span class="tick read">✓✓</span>' : '<span class="tick">✓</span>';
  }
  div.innerHTML = `${escapeHtml(msg.message)}${tickHtml}<span class="time">${timeStr}</span>`;
  document.getElementById('chatMessages').appendChild(div);
  document.getElementById('chatMessages').scrollTop = document.getElementById('chatMessages').scrollHeight;
}

async function sendDriverChatMessage() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;
  const driverData = getDriverData();
  if (!driverData.uid) { showToast('Driver tidak teridentifikasi'); return; }
  try {
    await chatRef.push({
      sender: 'driver',
      sender_id: driverData.uid,
      message: text,
      timestamp: Date.now(),
      readBy: { driver: true, customer: false }
    });
    input.value = '';
    await sendNotificationToCustomer(
      `💬 Pesan dari driver ${driverData.name || 'Driver'}`,
      text.length > 60 ? text.slice(0,60)+'...' : text,
      { chat: true, sender: 'driver' }
    );
  } catch (err) {
    console.error('Gagal mengirim chat:', err);
    showToast('Gagal mengirim pesan');
  }
}

function initChat() {
  if (!orderId) return;
  chatRef = database.ref(`chat/${orderId}`);
  chatRef.off();
  chatRef.on('child_added', (snap) => {
    const msg = snap.val();
    if (chatOpen) addMessageToChat(msg);
    updateUnreadBadge();
  });
  setTimeout(updateUnreadBadge, 1000);
}

async function sendAutoWelcomeMessage() {
  if (!orderId || !chatRef || !driverUid) return;
  try {
    const snap = await database.ref(`orders/${orderId}/auto_welcome_sent`).once('value');
    if (snap.val() === true) return;
    await chatRef.push({
      sender: 'driver',
      sender_id: driverUid,
      message: 'Saya akan segera ke lokasi Anda',
      timestamp: Date.now(),
      readBy: { driver: true, customer: false }
    });
    await database.ref(`orders/${orderId}/auto_welcome_sent`).set(true);
  } catch (err) { console.error('Gagal kirim auto welcome:', err); }
}

// ==================== ORDER FUNCTIONS ====================
async function getOrderId() {
  let id = new URLSearchParams(location.search).get('order_id') || new URLSearchParams(location.search).get('id');
  if (id) return id;
  const driver = getDriverData();
  if (!driver.uid) return null;
  const snapshot = await database.ref('orders').orderByChild('driver_id').equalTo(driver.uid).once('value');
  const orders = snapshot.val();
  if (orders) {
    const activeStatus = ['accepted','on_the_way','arrived','on_trip'];
    for (let key in orders) {
      if (activeStatus.includes(orders[key].status)) return key;
    }
  }
  return null;
}

function openNavigationDirect(lat, lng) {
  if (!lat || !lng) {
    showToast("Koordinat tidak tersedia");
    return false;
  }
  showConfirmPopup(
    '🗺️ Navigasi',
    'Mulai navigasi ke lokasi ini?',
    function() {
      if (typeof Android !== 'undefined' && Android.startNavigation) {
        Android.startNavigation(lat, lng);
      } else {
        var url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
        window.open(url, '_system');
      }
    },
    function() { showToast('Navigasi dibatalkan'); }
  );
  return true;
}

function setupAddressClick() {
  const pickupEl = document.getElementById('pickupAddress');
  const viaEl = document.getElementById('viaAddress');
  const destEl = document.getElementById('destinationAddress');
  if (pickupEl && orderData && orderData.pickup_lat && orderData.pickup_lng) {
    pickupEl.onclick = (e) => { e.stopPropagation(); openNavigationDirect(orderData.pickup_lat, orderData.pickup_lng); };
  }
  if (viaEl && orderData && orderData.via_lat && orderData.via_lng) {
    viaEl.onclick = (e) => { e.stopPropagation(); openNavigationDirect(orderData.via_lat, orderData.via_lng); };
  }
  if (destEl && orderData && orderData.dest_lat && orderData.dest_lng) {
    destEl.onclick = (e) => { e.stopPropagation(); openNavigationDirect(orderData.dest_lat, orderData.dest_lng); };
  }
}

function updateActionButtons() {
  const mapBtn = document.getElementById('mapActionBtn');
  const cancelBtn = document.getElementById('cancelHeaderBtn');
  if (!mapBtn) return;

  if (currentStatus === 'completed' || currentStatus === 'cancelled') {
    mapBtn.style.display = 'none';
    cancelBtn.classList.add('disabled');
    cancelBtn.classList.add('hidden');
    return;
  } else {
    cancelBtn.classList.remove('disabled');
    cancelBtn.classList.remove('hidden');
  }

  switch (currentStatus) {
    case 'accepted':   mapBtn.style.display = 'flex'; mapBtn.innerHTML = '🚗 Saya Berangkat'; break;
    case 'on_the_way': mapBtn.style.display = 'flex'; mapBtn.innerHTML = '📍 Sampai di Lokasi Jemput'; break;
    case 'arrived':    mapBtn.style.display = 'flex'; mapBtn.innerHTML = '🏁 Mulai Perjalanan'; break;
    case 'on_trip':    mapBtn.style.display = 'flex'; mapBtn.innerHTML = '✅ Selesaikan Perjalanan'; break;
    default:           mapBtn.style.display = 'none';
  }
  const subText = document.getElementById('statusSubText');
  if (subText) {
    const map = {
      'accepted':'Menunggu konfirmasi driver',
      'on_the_way':'Sedang menuju lokasi Jemput',
      'arrived':'Anda telah tiba di lokasi',
      'on_trip':'Perjalanan sedang berlangsung',
      'completed':'Perjalanan selesai',
      'cancelled':'Perjalanan dibatalkan'
    };
    subText.textContent = map[currentStatus] || 'Memuat status...';
  }
  const eta = document.getElementById('etaValue');
  if (eta) {
    if (currentStatus === 'on_the_way' || currentStatus === 'accepted') eta.textContent = '5–8 menit';
    else if (currentStatus === 'arrived') eta.textContent = 'Telah tiba';
    else if (currentStatus === 'on_trip') eta.textContent = 'Dalam perjalanan';
    else if (currentStatus === 'completed') eta.textContent = 'Selesai';
    else eta.textContent = '-';
  }
}

async function onMapAction() {
  if (!orderData) { showToast("Data order belum siap"); return; }
  if (currentStatus === 'accepted') {
    await database.ref('orders/'+orderId).update({ status:'on_the_way', updated_at: new Date().toISOString() });
    showToast("Status: Menuju lokasi jemput");
  } else if (currentStatus === 'on_the_way') {
    await database.ref('orders/'+orderId).update({ status:'arrived', arrived_at: new Date().toISOString() });
    showToast("Kami telah memberi tahu customer bahwa Anda telah tiba");
    await sendNotificationToCustomer("📍 Driver Telah Tiba", `Driver ${getDriverData().name||'Anda'} sudah sampai di lokasi jemput.`, { arrived: true });
  } else if (currentStatus === 'arrived') {
    await database.ref('orders/'+orderId).update({ status:'on_trip', trip_started_at: new Date().toISOString() });
    showToast("Perjalanan dimulai");
  } else if (currentStatus === 'on_trip') completeTrip();
  else showToast("Aksi tidak tersedia");
}

// ==================== COMPLETE TRIP ====================
async function completeTrip() {
  if (currentStatus !== 'on_trip') { showToast("Perjalanan belum dimulai"); return; }
  showConfirmPopup(
    'Selesaikan Perjalanan',
    'Apakah Anda yakin ingin menyelesaikan perjalanan ini?',
    async () => {
      try {
        await database.ref('orders/'+orderId).update({ status:'completed', completed_at: new Date().toISOString() });
        const price = orderData.price || 0;
        const [potonganSnap, pajakSnap] = await Promise.all([
          database.ref('data-jego/potongan').once('value'),
          database.ref('data-jego/pajak').once('value')
        ]);
        const potongan = potonganSnap.val() !== null ? potonganSnap.val() : 0;
        const pajak = pajakSnap.val() !== null ? pajakSnap.val() : 0;
        const potonganRupiah = price * (potongan/100);
        const pajakRupiah = potonganRupiah * (pajak/100);
        const totalPotongan = potonganRupiah + pajakRupiah;
        const driverEarnings = price - totalPotongan;
        const driverUid = getDriverData().uid;
        const today = new Date().toISOString().split('T')[0];
        await database.ref(`drivers/${driverUid}/daily_earnings/${today}`).transaction(cur => (cur||0) + price);
        await database.ref(`drivers/${driverUid}/total_earnings`).transaction(cur => (cur||0) + price);
        await database.ref(`drivers/${driverUid}/earnings_history/${orderId}`).set({
          orderId, amount: driverEarnings, originalPrice: price,
          potongan, pajak, totalPotongan,
          completed_at: new Date().toISOString(),
          customer_name: orderData.customer_name || 'Customer'
        });
        showToast("Perjalanan selesai, silakan beri rating");
      } catch (err) {
        console.error('Gagal menyimpan earnings:', err);
        showToast('Gagal menyimpan pendapatan: ' + err.message);
      }
    },
    () => { showToast("Aksi dibatalkan"); }
  );
}

async function createPendingRefund(orderId, bonusUsed, driverId, customerId) {
  if (!bonusUsed || bonusUsed <= 0) return false;
  try {
    const refundRef = database.ref(`customer_refund_pending/${customerId}`).push();
    await refundRef.set({
      orderId, amount: bonusUsed, driverId,
      driverName: getDriverData().name || 'Driver',
      createdAt: new Date().toISOString(),
      status: 'pending'
    });
    return true;
  } catch (err) { return false; }
}

async function cancelTrip() {
  if (currentStatus === 'on_trip') { showToast("Tidak dapat membatalkan perjalanan berlangsung"); return; }
  if (currentStatus === 'completed' || currentStatus === 'cancelled') { showToast("Perjalanan sudah selesai atau dibatalkan"); return; }
  showConfirmPopup(
    '⚠️ Batalkan Perjalanan',
    'Membatalkan perjalanan akan mempengaruhi rating akun Anda. Bonus customer akan masuk ke daftar refund.',
    async () => {
      try {
        const bonusUsed = orderData.bonus_used || 0;
        const custId = orderData.user_id;
        const driver = getDriverData();
        if (bonusUsed > 0 && custId) {
          await createPendingRefund(orderId, bonusUsed, driver.uid, custId);
          showToast("Bonus refund telah dicatat, customer dapat mengklaimnya nanti.");
        }
        await database.ref('orders/'+orderId).update({ status:'cancelled', cancelled_by:'driver', cancelled_at: new Date().toISOString() });
        showToast("Perjalanan dibatalkan.");
        setTimeout(() => { window.location.href = 'index.html'; }, 1500);
      } catch (err) {
        console.error(err);
        showToast("Gagal membatalkan: " + err.message);
      }
    },
    () => { showToast("Aksi dibatalkan"); }
  );
}

// ==================== RATING ====================
function showRatingModal() {
  document.getElementById('ratingModal').style.display = 'flex';
  let stars = document.querySelectorAll('#ratingStars span');
  stars.forEach((star, idx) => {
    star.onclick = () => {
      let val = parseInt(star.dataset.rating);
      selectedRating = val;
      stars.forEach((s, i) => {
        s.innerText = i < val ? '★' : '☆';
        s.classList.toggle('active', i < val);
      });
      generatePresets(val);
    };
  });
}

function generatePresets(rating) {
  let container = document.getElementById('ratingPresetsContainer');
  container.innerHTML = '';
  let presets = { 1:["Tidak sopan","Membuat menunggu lama"], 2:["Kurang kooperatif"], 3:["Cukup"], 4:["Ramah","Tepat waktu"], 5:["Sangat ramah","Perjalanan menyenangkan"] };
  (presets[rating] || []).forEach(text => {
    let btn = document.createElement('button');
    btn.innerText = text;
    btn.className = 'preset-btn';
    btn.onclick = () => { let ta = document.getElementById('ratingComment'); ta.value = ta.value ? ta.value + ', ' + text : text; };
    container.appendChild(btn);
  });
}

async function submitRating() {
  if (selectedRating === 0) { showToast("Pilih rating"); return; }
  let comment = document.getElementById('ratingComment').value;
  let driverData = getDriverData();

  try {
    await database.ref(`ratings/${orderId}/customer_rating`).set({
      rating: selectedRating,
      driver_id: driverData.uid,
      order_id: orderId,
      customer_id: customerId,
      comment: comment,
      created_at: new Date().toISOString()
    });
    closeRatingModal();
    showToast("✅ Rating berhasil! Kembali ke beranda...");
    setTimeout(() => { window.location.href = 'home_pack.html'; }, 1500);
  } catch (err) {
    console.error(err);
    showToast("Gagal menyimpan rating: " + err.message);
  }
}

function closeRatingModal() { document.getElementById('ratingModal').style.display = 'none'; }

// ==================== ROUTE & DISTANCE ====================
function formatDistance(meters) {
  if (meters < 1000) {
    return Math.round(meters) + 'm';
  } else {
    return (meters/1000).toFixed(1) + 'km';
  }
}

function fetchAndDisplayRoutes(driverLat, driverLng, pickupLat, pickupLng, viaLat, viaLng, destLat, destLng) {
  if (!orderMap) return;

  if (routeDriverToPickup) { orderMap.removeLayer(routeDriverToPickup); routeDriverToPickup = null; }
  if (routePickupToDest) { orderMap.removeLayer(routePickupToDest); routePickupToDest = null; }
  distanceLabelMarkers.forEach(m => orderMap.removeLayer(m));
  distanceLabelMarkers = [];

  async function fetchRoute(waypoints) {
    const coordString = waypoints.map(wp => `${wp.lng},${wp.lat}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coordString}?overview=full&geometries=geojson`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const coords = route.geometry.coordinates.map(c => [c[1], c[0]]);
        const distance = route.distance;
        return { coords, distance };
      }
    } catch (e) { console.warn('OSRM error:', e); }
    return null;
  }

  // Rute driver → pickup (garis putus-putus biru)
  if (driverLat && driverLng && pickupLat && pickupLng) {
    const waypoints = [
      { lng: driverLng, lat: driverLat },
      { lng: pickupLng, lat: pickupLat }
    ];
    fetchRoute(waypoints).then(result => {
      if (result) {
        routeDriverToPickup = L.polyline(result.coords, {
          color: '#2196F3',
          weight: 4,
          opacity: 0.7,
          dashArray: '8, 8'
        }).addTo(orderMap);

        const distanceText = formatDistance(result.distance);
        const labelIcon = L.divIcon({
          html: `<div style="font-size:20px; font-weight:900; color:#0d47a1; text-shadow: -2px -2px 0 #fff, 2px -2px 0 #fff, -2px 2px 0 #fff, 2px 2px 0 #fff, 0 0 8px rgba(255,255,255,0.9);">${distanceText}</div>`,
          className: 'distance-label',
          iconSize: [0, 0],
          iconAnchor: [0, 0]
        });
        const label = L.marker([pickupLat, pickupLng], { icon: labelIcon, interactive: false, keyboard: false })
          .addTo(orderMap)
          .setZIndexOffset(10000);
        distanceLabelMarkers.push(label);
        routesDrawn = true;
      }
    });
  }

  // Rute pickup → dest (garis oranye)
  const waypoints2 = [{ lng: pickupLng, lat: pickupLat }];
  if (viaLat && viaLng) waypoints2.push({ lng: viaLng, lat: viaLat });
  waypoints2.push({ lng: destLng, lat: destLat });
  fetchRoute(waypoints2).then(result => {
    if (result) {
      routePickupToDest = L.polyline(result.coords, {
        color: '#FF8A00',
        weight: 5,
        opacity: 0.9
      }).addTo(orderMap);

      const distanceText = formatDistance(result.distance);
      const labelIcon = L.divIcon({
        html: `<div style="font-size:20px; font-weight:900; color:#d32f2f; text-shadow: -2px -2px 0 #fff, 2px -2px 0 #fff, -2px 2px 0 #fff, 2px 2px 0 #fff, 0 0 8px rgba(255,255,255,0.9);">${distanceText}</div>`,
        className: 'distance-label',
        iconSize: [0, 0],
        iconAnchor: [0, 0]
      });
      const label = L.marker([destLat, destLng], { icon: labelIcon, interactive: false, keyboard: false })
        .addTo(orderMap)
        .setZIndexOffset(10000);
      distanceLabelMarkers.push(label);
      routesDrawn = true;
    }
  });
}

// ==================== DISPLAY UI ====================
function updateBonusDisplay() {
  const bonusInfoDiv = document.getElementById('bonusInfoDriver');
  const bonusUsed = orderData.bonus_used || 0;
  const originalPrice = orderData.price || orderData.totalPrice || 0;
  const finalPrice = orderData.price_after_bonus || (originalPrice - bonusUsed);
  if (bonusUsed > 0 && finalPrice > 0) {
    bonusInfoDiv.classList.add('show');
    document.getElementById('originalPriceSpan').innerHTML = 'Rp ' + originalPrice.toLocaleString('id-ID');
    document.getElementById('bonusAmountSpan').innerHTML = 'Rp ' + bonusUsed.toLocaleString('id-ID');
    document.getElementById('finalPriceSpan').innerHTML = 'Rp ' + finalPrice.toLocaleString('id-ID');
    document.getElementById('tripPriceLarge').innerHTML = 'Rp ' + finalPrice.toLocaleString('id-ID');
  } else {
    bonusInfoDiv.classList.remove('show');
    document.getElementById('tripPriceLarge').innerHTML = 'Rp ' + originalPrice.toLocaleString('id-ID');
  }
}

function displayOrderUI() {
  routesDrawn = false;

  document.getElementById('loadingView').style.display = 'none';
  document.getElementById('mainContent').classList.add('show');
  document.getElementById('actionsSection').style.display = 'flex';
  document.getElementById('orderIdDisplay').textContent = '#' + orderId.slice(-6);
  document.getElementById('customerName').innerText = orderData.customer_name || '-';
  document.getElementById('customerPhone').innerText = orderData.customer_phone || '-';
  document.getElementById('customerPhoto').src = orderData.photoURL || 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png';
  let rating = orderData.passenger_rating || 5.0;
  document.getElementById('customerRating').innerText = rating.toFixed(1);
  document.getElementById('pickupAddress').innerText = orderData.pickup_address || '-';
  document.getElementById('destinationAddress').innerText = orderData.destination_address || '-';
  const viaAddress = orderData.via_address;
  const viaItem = document.getElementById('viaRouteItem');
  const viaAddressSpan = document.getElementById('viaAddress');
  if (viaAddress) {
    viaAddressSpan.innerText = viaAddress;
    viaItem.style.display = 'flex';
  } else {
    viaItem.style.display = 'none';
  }
  const deliveryCard = document.getElementById('deliveryInfoCard');
  if (orderData.transport_type && orderData.transport_type.includes('kurir')) {
    document.getElementById('deliveryCategory').textContent = orderData.item_category || '-';
    document.getElementById('deliveryDescription').textContent = orderData.item_description || '-';
    document.getElementById('deliverySender').textContent = orderData.sender_phone || '-';
    document.getElementById('deliveryReceiver').textContent = orderData.receiver_phone || '-';
    deliveryCard.style.display = 'block';
  } else {
    deliveryCard.style.display = 'none';
  }
  updateBonusDisplay();
  let distanceText = '-';
  if (orderData.distance_meters) distanceText = (orderData.distance_meters/1000).toFixed(1)+' km';
  else if (orderData.distance) distanceText = typeof orderData.distance === 'number' ? orderData.distance.toFixed(1)+' km' : orderData.distance;
  else if (orderData.distance_km) distanceText = orderData.distance_km.toFixed(1)+' km';
  else if (orderData.jarak) distanceText = typeof orderData.jarak === 'number' ? orderData.jarak.toFixed(1)+' km' : orderData.jarak;
  document.getElementById('tripDistance').innerText = distanceText;
  setupAddressClick();

  if (orderData.pickup_lat && orderData.dest_lat) {
    document.getElementById('mapSection').style.display = 'block';
    if (!orderMap) {
      orderMap = L.map('orderMap').setView([orderData.pickup_lat, orderData.pickup_lng], 14);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png').addTo(orderMap);
    } else orderMap.setView([orderData.pickup_lat, orderData.pickup_lng], 14);

    L.marker([orderData.pickup_lat, orderData.pickup_lng], {
      icon: L.divIcon({ html: '<div style="background:#4CAF50; width:30px; height:30px; border-radius:50%; text-align:center; line-height:30px; color:#fff; font-weight:700; font-size:14px; box-shadow:0 2px 8px rgba(0,0,0,0.15);">A</div>' })
    }).addTo(orderMap).bindPopup('📍 Penjemputan');

    if (orderData.via_lat && orderData.via_lng) {
      L.marker([orderData.via_lat, orderData.via_lng], {
        icon: L.divIcon({ html: '<div style="background:#3B82F6; width:30px; height:30px; border-radius:50%; text-align:center; line-height:30px; color:#fff; font-weight:700; font-size:14px; box-shadow:0 2px 8px rgba(0,0,0,0.15);">⛽</div>' })
      }).addTo(orderMap).bindPopup('⛽ Titik Singgah');
    }

    L.marker([orderData.dest_lat, orderData.dest_lng], {
      icon: L.divIcon({ html: '<div style="background:#EF4444; width:30px; height:30px; border-radius:50%; text-align:center; line-height:30px; color:#fff; font-weight:700; font-size:14px; box-shadow:0 2px 8px rgba(0,0,0,0.15);">B</div>' })
    }).addTo(orderMap).bindPopup('🏁 Tujuan');

    updateDriverMarker(orderData.pickup_lat, orderData.pickup_lng, 0);

    // Gambar rute & jarak (sementara dengan posisi pickup, nanti diupdate oleh GPS)
    let dLat = currentDriverLat || orderData.pickup_lat;
    let dLng = currentDriverLng || orderData.pickup_lng;
    fetchAndDisplayRoutes(dLat, dLng, orderData.pickup_lat, orderData.pickup_lng, orderData.via_lat, orderData.via_lng, orderData.dest_lat, orderData.dest_lng);

    // Rute OSRM utama (tetap dipertahankan)
    let waypoints = [];
    waypoints.push({ lng: orderData.pickup_lng, lat: orderData.pickup_lat });
    if (orderData.via_lng && orderData.via_lat) waypoints.push({ lng: orderData.via_lng, lat: orderData.via_lat });
    waypoints.push({ lng: orderData.dest_lng, lat: orderData.dest_lat });
    let coordString = waypoints.map(wp => `${wp.lng},${wp.lat}`).join(';');
    fetch(`https://router.project-osrm.org/route/v1/driving/${coordString}?overview=full&geometries=geojson`)
      .then(r => r.json()).then(data => {
        if (data.routes.length) {
          let coords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
          if (routePolyline) orderMap.removeLayer(routePolyline);
          routePolyline = L.polyline(coords, { color: '#FF8A00', weight: 5, opacity: 0.9 }).addTo(orderMap);
          // Jangan fit bounds agar tidak mengganggu rute driver ke pickup
        }
      }).catch(e => console.warn);
  }
  updateStatusDisplay(orderData.status);
}

function updateStatusDisplay(status) {
  currentStatus = status;
  const badge = document.getElementById('statusBadge');
  if (status === 'accepted') badge.innerHTML = '✅ Diterima';
  else if (status === 'on_the_way') badge.innerHTML = '🚗 Menuju';
  else if (status === 'arrived') badge.innerHTML = '📍 Tiba';
  else if (status === 'on_trip') badge.innerHTML = '🛣️ Perjalanan';
  else if (status === 'completed') badge.innerHTML = '🏁 Selesai';
  else if (status === 'cancelled') {
    if (orderData?.cancelled_by === 'driver') badge.innerHTML = '❌ Dibatalkan Driver';
    else if (orderData?.cancelled_by === 'customer') badge.innerHTML = '❌ Dibatalkan Customer';
    else if (orderData?.cancelled_by === 'admin') badge.innerHTML = '❌ Dibatalkan Admin';
    else badge.innerHTML = '❌ Dibatalkan';
  }
  updateActionButtons();
  if (status === 'completed' || status === 'cancelled') {
    document.getElementById('actionsSection').style.display = 'none';
    document.getElementById('mapActionBtn').style.display = 'none';
    stopLocationTracking();
    if (typeof Android !== 'undefined' && Android.endVoiceCall) {
      Android.endVoiceCall();
    }
  } else {
    document.getElementById('actionsSection').style.display = 'flex';
  }
}

function listenOrder() {
  if (orderRef) orderRef.off();
  orderRef = database.ref('orders/' + orderId);
  orderRef.on('value', (snap) => {
    if (snap.exists()) {
      orderData = snap.val();
      updateStatusDisplay(orderData.status);
      updateBonusDisplay();
      if (orderData.status === 'completed' && !window.ratingShown) {
        window.ratingShown = true;
        setTimeout(() => showRatingModal(), 800);
      }
      document.getElementById('pickupAddress').innerText = orderData.pickup_address || '-';
      document.getElementById('destinationAddress').innerText = orderData.destination_address || '-';
      if (orderData.via_address) {
        document.getElementById('viaAddress').innerText = orderData.via_address;
        document.getElementById('viaRouteItem').style.display = 'flex';
      } else {
        document.getElementById('viaRouteItem').style.display = 'none';
      }
      setupAddressClick();
      const deliveryCard = document.getElementById('deliveryInfoCard');
      if (orderData.transport_type && orderData.transport_type.includes('kurir')) {
        document.getElementById('deliveryCategory').textContent = orderData.item_category || '-';
        document.getElementById('deliveryDescription').textContent = orderData.item_description || '-';
        document.getElementById('deliverySender').textContent = orderData.sender_phone || '-';
        document.getElementById('deliveryReceiver').textContent = orderData.receiver_phone || '-';
        deliveryCard.style.display = 'block';
      } else {
        deliveryCard.style.display = 'none';
      }
      updateUnreadBadge();
    } else { showToast("Order tidak ditemukan"); }
  });
}

// ==================== LOAD ORDER ====================
async function loadOrder() {
  let driver = getDriverData();
  if (!driver?.uid) { window.location.href = 'loginDriver.html'; return; }
  driverUid = driver.uid;
  orderId = await getOrderId();
  if (!orderId) {
    document.getElementById('errorView').style.display = 'flex';
    document.getElementById('errorMessage').innerHTML = 'Tidak ada order aktif untuk driver ini. <a href="index.html" style="color:#FF8A00;font-weight:600;">Kembali ke beranda</a>';
    return;
  }
  let snap = await database.ref('orders/' + orderId).once('value');
  if (!snap.exists()) { showErrorPage("Order tidak ditemukan"); return; }
  let o = snap.val();
  if (o.driver_id !== driver.uid) { showErrorPage("Bukan order anda"); return; }
  orderData = o;
  customerId = o.user_id;

  lastSentLat = null;
  lastSentLng = null;

  displayOrderUI();
  listenOrder();
  initChat();
  window.updateCallStatus('idle');

  if (orderData.status === 'accepted') {
    await sendAutoWelcomeMessage();
  }

  startLocationTracking();

  // Event listeners
  document.getElementById('mapActionBtn').addEventListener('click', onMapAction);
  document.getElementById('cancelHeaderBtn').addEventListener('click', cancelTrip);
  document.getElementById('callBtn').addEventListener('click', function() {
    if (this.innerHTML.includes('Akhiri')) {
      if (typeof Android !== 'undefined' && Android.endVoiceCall) {
        Android.endVoiceCall();
      }
    } else {
      showConfirmPopup(
        '📞 Panggil Customer',
        'Anda akan menghubungi customer melalui panggilan suara. Lanjutkan?',
        function() {
          if (typeof Android !== 'undefined' && Android.startVoiceCall) {
    Android.startVoiceCall(orderId, customerId, 'driver');
} else {
            showToast('Fitur tidak tersedia');
          }
        },
        function() { showToast('Panggilan dibatalkan'); }
      );
    }
  });
  document.getElementById('callOverlayEndBtn').addEventListener('click', function() {
    if (typeof Android !== 'undefined' && Android.endVoiceCall) {
      Android.endVoiceCall();
    }
  });
  document.getElementById('chatIconBtn').addEventListener('click', openChat);
  document.getElementById('nativeCallBtn').addEventListener('click', callCustomerNative);
  document.getElementById('chatSendBtn').onclick = sendDriverChatMessage;
  document.getElementById('chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendDriverChatMessage(); }
  });

  document.getElementById('ratingCancelBtn').addEventListener('click', closeRatingModal);
  document.getElementById('ratingSubmitBtn').addEventListener('click', submitRating);
  document.getElementById('closeChatBtn').addEventListener('click', closeChat);
}

function showErrorPage(msg) {
  document.getElementById('loadingView').style.display = 'none';
  document.getElementById('errorView').style.display = 'flex';
  document.getElementById('errorMessage').innerHTML = msg;
}

// ==================== BACK BUTTON ====================
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

window.addEventListener('beforeunload', function() {
  stopLocationTracking();
  if (typeof Android !== 'undefined' && Android.endVoiceCall) {
    Android.endVoiceCall();
  }
});

auth.onAuthStateChanged(user => {
  if (user) loadOrder();
  else { localStorage.removeItem('jego_logged_in_driver'); window.location.href = 'loginDriver.html'; }
});

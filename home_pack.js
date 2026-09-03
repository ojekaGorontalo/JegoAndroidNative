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

let database, auth;
try {
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  database = firebase.database();
  auth = firebase.auth();
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
    .then(() => console.log('🔒 Persistence LOCAL diaktifkan'))
    .catch(err => console.warn('Gagal set persistence:', err));
  console.log('✅ Firebase berhasil diinisialisasi');
} catch (error) {
  console.error('❌ Error inisialisasi Firebase:', error);
}

// ========== FUNGSI UNTUK MENERIMA FCM TOKEN DARI ANDROID ==========
window.updateFCMToken = function(token) {
    if (!token) {
        console.warn('⚠️ Token FCM kosong, lewati penyimpanan.');
        return;
    }
    console.log('📩 FCM Token diterima dari Android:', token.substring(0, 20) + '...');
    localStorage.setItem('fcmToken', token);
    if (!globalCurrentUid) {
        console.warn('⚠️ Belum ada UID driver, token FCM ditunda.');
        localStorage.setItem('pending_fcm_token', token);
        return;
    }
    // Kirim token ke Redis via sync status (tanpa Firebase)
    syncDriverStatusToRedis();
    // Hapus semua pengiriman ke Firebase di sini
};

function processPendingFCMToken() {
    const pendingToken = localStorage.getItem('pending_fcm_token');
    if (pendingToken && globalCurrentUid) {
        console.log('📩 Memproses token FCM tertunda...');
        window.updateFCMToken(pendingToken);
        localStorage.removeItem('pending_fcm_token');
    }
}

// ==================== VARIABEL GLOBAL ====================
let ordersRef = null, ordersListener = null;
let bottomSheetMap = null;
let currentSelectedOrder = null;
let radarTextInterval = null;
let gpsLoadingInterval = null;
let currentDriverData = null;
let autobidEnabled = false, driverLocation = { latitude: null, longitude: null };
let locationWatchId = null, locationTrackingEnabled = false;
let googleApiKey = '';
let countdownInterval = null, countdownOrderId = null, countdownDriverId = null, orderStatusListener = null;
let acceptKurirEnabled = false;
let previousOrderIds = new Set();
let mapMarkers = [];
let globalCurrentUid = null;
let gpsReady = false;
let currentModalOrderListener = null;
let currentModalOrderRef = null;
let autobidOfferedOrders = new Set();
let offerRejectionListener = null;
const savedOffers = JSON.parse(localStorage.getItem('autobid_offered_orders') || '[]');
savedOffers.forEach(id => autobidOfferedOrders.add(id));
console.log(`Loaded ${autobidOfferedOrders.size} offered orders from localStorage`);
let isWaitingForConfirmation = false;
let lastSentLat = null;
let lastSentLng = null;
let orderMap = new Map();
let ordersChildListeners = {};
let isInitialLoad = true;
const MAX_DISTANCE_KM = 20;
const STORAGE_TRACKING = 'jego_location_tracking';
const STORAGE_AUTOBID = 'jego_autobid_enabled';
const STORAGE_ACCEPT_KURIR = 'jego_accept_kurir';
const STORAGE_FLOATING = 'jego_floating_button';
let floatingButtonEnabled = false;

// ==================== CONFIG REDIS ====================
const REDIS_API_URL = 'https://movego.my.id';

// ==================== FUNGSI BANTUAN ====================
function applyTheme() {
  const savedTheme = localStorage.getItem('jego_driver_theme');
  if (savedTheme === 'dark') {
    document.body.classList.add('dark');
  } else {
    document.body.classList.remove('dark');
  }
}
applyTheme();

window.addEventListener('storage', (e) => {
  if (e.key === 'jego_driver_theme') {
    applyTheme();
  }
});

function isAndroidAvailable() {
  return typeof Android !== 'undefined' && Android !== null;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    if (m === '"') return '&quot;';
    return m;
  });
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return null;
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLon/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// ==================== LOAD GOOGLE MAPS DYNAMICALLY ====================
function loadGoogleMaps(apiKey) {
  return new Promise((resolve, reject) => {
    if (typeof google !== 'undefined' && google.maps) {
      console.log('✅ Google Maps sudah termuat sebelumnya');
      resolve();
      return;
    }
    window.initMap = function() {
      console.log('✅ Google Maps callback initMap dipanggil');
      resolve();
    };
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&callback=initMap`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      console.error('❌ Gagal memuat Google Maps');
      reject(new Error('Gagal memuat Google Maps'));
    };
    document.head.appendChild(script);
  });
}

// ==================== TOAST, POPUP, AUDIO ====================
let toastTimeout = null;
function showToast(message, type = 'info') {
  const existingToast = document.querySelector('.toast-notification');
  if (existingToast) existingToast.remove();
  if (toastTimeout) clearTimeout(toastTimeout);

  const toast = document.createElement('div');
  toast.className = `toast-notification ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.classList.add('show'), 10);

  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

function showPopup(title, message, type = 'info', options = {}) {
  document.getElementById('popupTitle').textContent = title;
  document.getElementById('popupMessage').textContent = message;
  const iconMap = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  document.getElementById('popupIcon').innerHTML = iconMap[type] || 'ℹ️';
  
  const confirmBtn = document.getElementById('popupButton');
  confirmBtn.onclick = () => {
    hidePopup();
    if (options.onConfirm && typeof options.onConfirm === 'function') {
      options.onConfirm();
    }
  };
  document.getElementById('popupOverlay').style.display = 'flex';
}
function hidePopup() { 
  document.getElementById('popupOverlay').style.display = 'none'; 
}

function showConfirmPopupTracking(title, message, onConfirm, onCancel) {
    console.log('🔄 showConfirmPopupTracking dipanggil dengan title:', title);
    const overlay = document.getElementById('popupOverlay');
    if (!overlay) {
        console.error('❌ Elemen popupOverlay tidak ditemukan!');
        return Promise.resolve(false);
    }

    const icon = document.getElementById('popupIcon');
    const titleEl = document.getElementById('popupTitle');
    const msg = document.getElementById('popupMessage');
    const footer = document.querySelector('.popup-footer');

    if (!icon || !titleEl || !msg || !footer) {
        console.error('❌ Salah satu elemen popup tidak ditemukan!');
        return Promise.resolve(false);
    }

    icon.textContent = '⚠️';
    titleEl.textContent = title || 'Konfirmasi';
    msg.textContent = message || '';

    footer.innerHTML = `
        <button id="confirmYes" class="popup-button" style="background: #ccc; color: #333; margin-right: 10px;">Batal</button>
        <button id="confirmNo" class="popup-button" style="background: var(--primary);">Lanjutkan</button>
    `;

    return new Promise((resolve) => {
        overlay.style.display = 'flex';
        overlay.classList.add('show');
        requestAnimationFrame(() => {
            overlay.style.opacity = '0.99';
            requestAnimationFrame(() => {
                overlay.style.opacity = '1';
            });
        });
        console.log('✅ Popup tracking ditampilkan');

        document.getElementById('confirmYes').onclick = function(e) {
            e.stopPropagation();
            overlay.classList.remove('show');
            overlay.style.display = 'none';
            if (typeof onCancel === 'function') onCancel();
            resolve(false);
        };
        document.getElementById('confirmNo').onclick = function(e) {
            e.stopPropagation();
            overlay.classList.remove('show');
            overlay.style.display = 'none';
            if (typeof onConfirm === 'function') onConfirm();
            resolve(true);
        };
        overlay.onclick = function(e) {
            if (e.target === overlay) {
                overlay.classList.remove('show');
                overlay.style.display = 'none';
                if (typeof onCancel === 'function') onCancel();
                resolve(false);
            }
        };
    });
}

function stopAllSounds() {
  const soundIds = ['beekSound', 'manualPopupSound', 'autobidSound', 'orderAcceptedSound'];
  soundIds.forEach(id => {
    const audio = document.getElementById(id);
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
  });
}

function createRippleEffect(element) {
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  const size = Math.min(element.offsetWidth, element.offsetHeight) * 0.5;
  ripple.style.width = ripple.style.height = size + 'px';
  ripple.style.left = (element.offsetWidth / 2 - size / 2) + 'px';
  ripple.style.top = (element.offsetHeight / 2 - size / 2) + 'px';
  element.appendChild(ripple);
  setTimeout(() => {
    if (ripple.parentNode) ripple.remove();
  }, 700);
}

// ==================== RADAR ====================
function startRadarMessages() {
  if (radarTextInterval) clearInterval(radarTextInterval);
  const messages = [
    "Menunggu order baru...",
    "Mencari di area yang lebih luas...",
    "Memindai driver terdekat..."
  ];
  let idx = 0;
  const statusEl = document.getElementById('radarStatusText');
  if (statusEl) {
    statusEl.textContent = messages[0];
    radarTextInterval = setInterval(() => {
      idx = (idx + 1) % messages.length;
      statusEl.textContent = messages[idx];
    }, 3000);
  }
}
function stopRadarMessages() {
  if (radarTextInterval) {
    clearInterval(radarTextInterval);
    radarTextInterval = null;
  }
  const statusEl = document.getElementById('radarStatusText');
  if (statusEl) {
    statusEl.textContent = "Menunggu order baru...";
  }
}

// ==================== FUNGSI AMBIL STATUS DARI REDIS ====================
async function getDriverStatusFromRedis(driverId) {
    try {
        const response = await fetch(`${REDIS_API_URL}/api/driver/status/${driverId}`);
        if (!response.ok) {
            console.warn('⚠️ Gagal ambil status dari Redis (HTTP ' + response.status + '), fallback ke localStorage');
            return null;
        }
        const result = await response.json();
        if (result.success && result.data) {
            return result.data; // { tracking_enabled, autobid_enabled, floating_button_enabled, fcmToken, ... }
        }
        return null;
    } catch (error) {
        console.warn('⚠️ Error ambil status dari Redis:', error.message);
        return null;
    }
}

// ==================== SETTINGS ====================
async function loadStoredSettings() {
    // Prioritas: Redis -> localStorage -> default
    if (globalCurrentUid) {
        const redisStatus = await getDriverStatusFromRedis(globalCurrentUid);
        if (redisStatus) {
            if (redisStatus.tracking_enabled !== undefined) {
                locationTrackingEnabled = redisStatus.tracking_enabled;
                localStorage.setItem(STORAGE_TRACKING, locationTrackingEnabled);
            }
            if (redisStatus.autobid_enabled !== undefined) {
                autobidEnabled = redisStatus.autobid_enabled;
                localStorage.setItem(STORAGE_AUTOBID, autobidEnabled);
            }
            if (redisStatus.floating_button_enabled !== undefined) {
                floatingButtonEnabled = redisStatus.floating_button_enabled;
                localStorage.setItem(STORAGE_FLOATING, floatingButtonEnabled);
            }
            if (redisStatus.fcmToken) {
                localStorage.setItem('fcmToken', redisStatus.fcmToken);
            }
            console.log('✅ Status dari Redis:', { locationTrackingEnabled, autobidEnabled, floatingButtonEnabled });
        } else {
            // fallback ke localStorage
            locationTrackingEnabled = localStorage.getItem(STORAGE_TRACKING) === 'true';
            autobidEnabled = localStorage.getItem(STORAGE_AUTOBID) === 'true';
            floatingButtonEnabled = localStorage.getItem(STORAGE_FLOATING) === 'true';
            console.log('📦 Status dari localStorage (fallback)');
        }
    } else {
        locationTrackingEnabled = localStorage.getItem(STORAGE_TRACKING) === 'true';
        autobidEnabled = localStorage.getItem(STORAGE_AUTOBID) === 'true';
        floatingButtonEnabled = localStorage.getItem(STORAGE_FLOATING) === 'true';
    }
    updateTrackingButton();
    updateAutobidButton();
    updateFloatingButtonUI();

    // Sinkronkan dengan Android service
    if (locationTrackingEnabled && isAndroidAvailable()) {
        Android.startDriverTracking();
    } else if (!locationTrackingEnabled && isAndroidAvailable()) {
        Android.stopDriverTracking();
    }
    if (floatingButtonEnabled && isAndroidAvailable()) {
        Android.startFloatingButton();
    } else if (!floatingButtonEnabled && isAndroidAvailable()) {
        Android.stopFloatingButton();
    }
}

// ==================== SINKRON STATUS KE REDIS ====================
async function syncDriverStatusToRedis() {
    try {
        const token = localStorage.getItem('fcmToken') || null;
        const response = await fetch(`${REDIS_API_URL}/api/driver/status`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                driverId: globalCurrentUid,
                tracking_enabled: locationTrackingEnabled,
                autobid_enabled: autobidEnabled,
                floating_button_enabled: floatingButtonEnabled,
                fcmToken: token
            })
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const result = await response.json();
        console.log('✅ Status lengkap terkirim ke Redis:', result);
        return result;
    } catch (error) {
        console.error('❌ Gagal sinkron status ke Redis:', error.message);
    }
}

// Fungsi pengganti sendStatusToRedis (agar kompatibel dengan panggilan lama)
async function sendStatusToRedis() {
    return syncDriverStatusToRedis();
}

function updateTrackingButton() {
  const toggleBtn = document.getElementById('locationToggleBtn');
  if (!toggleBtn) return;
  const icon = toggleBtn.querySelector('.icon');
  if (!icon) return;
  if (locationTrackingEnabled) {
    toggleBtn.classList.add('active');
    icon.textContent = '📡';
  } else {
    toggleBtn.classList.remove('active');
    icon.textContent = '📍';
  }
}

function updateAutobidButton() {
  const toggle = document.getElementById('autobidToggle');
  if (toggle) toggle.checked = autobidEnabled;
}

function updateFloatingButtonUI() {
  const toggle = document.getElementById('floatingToggle');
  if (toggle) toggle.checked = floatingButtonEnabled;
}

// ============ FUNGSI KIRIM KE REDIS ============
async function sendLocationToRedis(lat, lng) {
    try {
        const response = await fetch(`${REDIS_API_URL}/api/driver/location`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                driverId: globalCurrentUid,
                latitude: lat,
                longitude: lng,
                tracking_enabled: locationTrackingEnabled,
                autobid_enabled: autobidEnabled
            })
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const result = await response.json();
        console.log('✅ Lokasi terkirim ke Redis:', result);
        return result;
    } catch (error) {
        console.error('❌ Gagal kirim lokasi ke Redis:', error.message);
    }
}

// ===== TAMBAHAN: fungsi untuk mengatur floating button =====
function toggleFloatingButton() {
  if (!locationTrackingEnabled) {
    showToast('Aktifkan tracking terlebih dahulu untuk mengatur tombol pintasan.', 'warning');
    const toggle = document.getElementById('floatingToggle');
    if (toggle) toggle.checked = floatingButtonEnabled;
    return;
  }

  floatingButtonEnabled = !floatingButtonEnabled;
  localStorage.setItem(STORAGE_FLOATING, floatingButtonEnabled);
  updateFloatingButtonUI();

  if (isAndroidAvailable()) {
    if (floatingButtonEnabled) {
      Android.startFloatingButton();
      console.log('📌 Floating button diaktifkan');
    } else {
      Android.stopFloatingButton();
      console.log('📌 Floating button dimatikan');
    }
  }

  if (globalCurrentUid) {
    // Kirim status ke Redis (tanpa Firebase)
    syncDriverStatusToRedis();
  }
}

// ===== PERBAIKAN: toggleLocationTrackingWithConfirm async =====
async function toggleLocationTrackingWithConfirm() {
    console.log('🔄 toggleLocationTrackingWithConfirm dipanggil');
    
    if (locationTrackingEnabled) {
        const confirmed = await showConfirmPopupTracking(
            '📴 Nonaktifkan Mode',
            'Anda akan berhenti menerima order baru.\n\n⚠️ Order yang sedang berjalan TIDAK akan terpengaruh.',
            () => {},
            () => {}
        );
        if (confirmed) {
            console.log('✅ User mengkonfirmasi NONAKTIF');
            toggleLocationTracking();
        } else {
            console.log('❌ User membatalkan NONAKTIF');
        }
    } else {
        const confirmed = await showConfirmPopupTracking(
            '🚗 Siap Menerima Order',
            'Sekarang kamu akan menerima order dari pelanggan terdekat.\n\n💡 Pastikan:\n• GPS menyala\n• Kuota data stabil\n• Baterai cukup',
            () => {},
            () => {}
        );
        if (confirmed) {
            console.log('✅ User mengkonfirmasi AKTIF');
            toggleLocationTracking();
        } else {
            console.log('❌ User membatalkan AKTIF');
        }
    }
}

function toggleLocationTracking() {
    console.log('🔄 toggleLocationTracking dipanggil');
    locationTrackingEnabled = !locationTrackingEnabled;
    localStorage.setItem(STORAGE_TRACKING, locationTrackingEnabled);

    const toggleBtn = document.getElementById('locationToggleBtn');
    if (!toggleBtn) return;
    const icon = toggleBtn.querySelector('.icon');
    if (!icon) return;

    if (locationTrackingEnabled) {
        toggleBtn.classList.add('active');
        icon.textContent = '📡';
        createRippleEffect(toggleBtn);
        const soundOn = document.getElementById('toggleOnSound');
        if (soundOn) {
            soundOn.currentTime = 0;
            soundOn.play().catch(e => console.log('Audio error:', e));
        }
        if (isAndroidAvailable()) {
            Android.startDriverTracking();
            console.log('📍 Service tracking dimulai dari tombol');
        }
        if (floatingButtonEnabled && isAndroidAvailable()) {
            Android.startFloatingButton();
            console.log('📌 Floating button dinyalakan karena tracking aktif dan tombol pintasan ON');
        }
    } else {
        toggleBtn.classList.remove('active');
        icon.textContent = '📍';
        const soundOff = document.getElementById('toggleOffSound');
        if (soundOff) {
            soundOff.currentTime = 0;
            soundOff.play().catch(e => console.log('Audio error:', e));
        }
        if (isAndroidAvailable()) {
            Android.stopDriverTracking();
            console.log('⏹️ Service tracking dihentikan dari tombol');
        }
        if (floatingButtonEnabled && isAndroidAvailable()) {
            Android.stopFloatingButton();
            console.log('📌 Floating button dimatikan karena tracking dimatikan');
        }
        if (floatingButtonEnabled) {
            floatingButtonEnabled = false;
            localStorage.setItem(STORAGE_FLOATING, false);
            updateFloatingButtonUI();
            if (globalCurrentUid) {
                // Kirim status ke Redis (tanpa Firebase)
                syncDriverStatusToRedis();
            }
        }
    }

    if (globalCurrentUid) {
        // Kirim status ke Redis (tanpa Firebase)
        syncDriverStatusToRedis();
    }
}

function toggleAutobid() {
    if (!locationTrackingEnabled) { showToast('Aktifkan tracking terlebih dahulu', 'warning'); return; }
    autobidEnabled = !autobidEnabled;
    localStorage.setItem(STORAGE_AUTOBID, autobidEnabled);
    updateAutobidButton();

    if (globalCurrentUid) {
        // Kirim status ke Redis (tanpa Firebase)
        syncDriverStatusToRedis();
    }
}

function updateAcceptKurirSetting() {
    const toggle = document.getElementById('acceptKurirToggle');
    if (!toggle) return;
    acceptKurirEnabled = toggle.checked;
    localStorage.setItem(STORAGE_ACCEPT_KURIR, acceptKurirEnabled);
    refreshDisplay();
}

// ==================== GPS ====================
function startGPSMonitoring() {
  const lastLocation = localStorage.getItem('jego_last_driver_location');
  if (lastLocation) {
    try {
      const loc = JSON.parse(lastLocation);
      driverLocation = { latitude: loc.lat, longitude: loc.lng };
      document.getElementById('gpsDot').className = 'gps-dot gps-inactive';
      document.getElementById('gpsText').textContent = 'GPS';
      gpsReady = true;
      if (gpsLoadingInterval) {
        clearInterval(gpsLoadingInterval);
        gpsLoadingInterval = null;
      }
      loadOrders();
    } catch(e) {}
  }

  if (!navigator.geolocation) {
    showToast('GPS tidak didukung di browser ini.', 'warning');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => { updateDriverLocation(position); },
    handleGpsError,
    { timeout: 5000, enableHighAccuracy: true }
  );

  if (locationWatchId) navigator.geolocation.clearWatch(locationWatchId);
  locationWatchId = navigator.geolocation.watchPosition(
    updateDriverLocation,
    handleGpsError,
    { timeout: 5000, enableHighAccuracy: true }
  );
}

function updateDriverLocation(position) {
    if (!position || !position.coords) return;
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    if (!lat || !lng) return;

    const thresholdKm = 0.10;
    let shouldUpdate = false;

    if (lastSentLat === null || lastSentLng === null) {
        shouldUpdate = true;
    } else {
        const dist = calculateDistance(lastSentLat, lastSentLng, lat, lng);
        if (dist !== null && dist > thresholdKm) {
            shouldUpdate = true;
        } else {
            console.log(`⏭️ Lokasi tidak berubah signifikan (${dist?.toFixed(3)} km), lewati update.`);
        }
    }

    driverLocation = { latitude: lat, longitude: lng };
    localStorage.setItem('jego_last_driver_location', JSON.stringify({ lat, lng }));

    document.getElementById('gpsDot').className = 'gps-dot gps-active';
    document.getElementById('gpsText').textContent = 'GPS';

    if (!gpsReady) {
        gpsReady = true;
        if (gpsLoadingInterval) {
            clearInterval(gpsLoadingInterval);
            gpsLoadingInterval = null;
        }
        loadOrders();
        lastSentLat = lat;
        lastSentLng = lng;
        return;
    }

    if (shouldUpdate && locationTrackingEnabled && currentDriverData && globalCurrentUid) {
        // Kirim ke Redis saja (tidak ke Firebase)
        sendLocationToRedis(lat, lng);
        lastSentLat = lat;
        lastSentLng = lng;
        console.log(`📍 Kirim lokasi ke Redis: ${lat}, ${lng}`);
    } else {
        refreshDisplay();
    }
}

function handleGpsError(error) {
    console.warn('GPS error:', error);
    if (error.code === 1) {
        showToast('⚠️ Izin lokasi ditolak. Aktifkan lokasi di pengaturan aplikasi.', 'warning');
        showPopup(
            'Izin Lokasi Diperlukan',
            'Aktifkan izin lokasi Anda untuk menerima order terdekat. Jika sudah diizinkan, refresh halaman.',
            'warning',
            {
                confirmText: 'Refresh',
                onConfirm: () => { window.location.reload(); }
            }
        );
    } else {
        showToast('Gagal mendapatkan lokasi. Gunakan lokasi terakhir.', 'warning');
    }
    if (!driverLocation.latitude) {
        const ordersList = document.getElementById('ordersList');
        if (ordersList) {
            ordersList.innerHTML = `<div class="empty-state"><div>📡</div><p>Lokasi tidak tersedia. Aktifkan GPS atau izinkan lokasi Anda.</p></div>`;
        }
    }
}

// ==================== DRIVER DATA ====================
function checkDriverData() {
  try {
    const driverDataStr = localStorage.getItem('jego_logged_in_driver');
    if (!driverDataStr || driverDataStr === '{}') { showDriverNotRegistered(); return false; }
    const driverData = JSON.parse(driverDataStr);
    if (driverData.uid && driverData.name && globalCurrentUid && driverData.uid === globalCurrentUid) {
      currentDriverData = {
        driverId: driverData.uid,
        fullName: driverData.name,
        phoneNumber: driverData.phone,
        email: driverData.email,
        profilePhotoUrl: driverData.photoUrl || driverData.fotoProfilURL || driverData.profilePhotoUrl || driverData.photoURL || 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png',
        vehicleType: driverData.vehicleType,
        plateNumber: driverData.plateNumber,
        vehicleBrand: driverData.vehicleBrand,
        status: driverData.status || driverData.driverStatus || 'pending',
        rating: driverData.rating || 5,
        perjalanan: driverData.perjalanan || 0,
        balance: driverData.Balance || 0,
        potongan: driverData.Potongan || 0
      };
      document.getElementById('sidebarDriverName').textContent = currentDriverData.fullName;
      document.getElementById('sidebarDriverRating').textContent = currentDriverData.rating.toFixed(1);
      document.getElementById('sidebarDriverTrips').innerHTML = `(${currentDriverData.perjalanan || 0})`;

      const sidebarPhoto = document.getElementById('sidebarDriverPhoto');
      sidebarPhoto.src = currentDriverData.profilePhotoUrl || 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png';
      sidebarPhoto.onerror = function() {
          this.src = 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png';
      };

      return true;
    } else { showDriverNotRegistered(); return false; }
  } catch (error) { showDriverNotRegistered(); return false; }
}

function showDriverNotRegistered() {
  const ordersList = document.getElementById('ordersList');
  if (ordersList) ordersList.innerHTML = `<div class="empty-state"><div>🚫</div><p>Anda belum terdaftar sebagai driver atau belum login</p><p><a href="loginDriver.html" style="color:var(--primary);">Login sebagai Driver</a></p></div>`;
}

// ==================== ORDERS LIST ====================
function detachOrdersListeners() {
    if (ordersRef) {
        if (ordersChildListeners.child_added) {
            ordersRef.off('child_added', ordersChildListeners.child_added);
        }
        if (ordersChildListeners.child_changed) {
            ordersRef.off('child_changed', ordersChildListeners.child_changed);
        }
        if (ordersChildListeners.child_removed) {
            ordersRef.off('child_removed', ordersChildListeners.child_removed);
        }
        ordersChildListeners = {};
    }
}

function isOrderVisible(orderData) {
    if (!orderData) return false;
    const orderType = orderData.transport_type || orderData.vehicle || 'motor';
    const driverVehicleType = currentDriverData?.vehicleType;
    if (!driverVehicleType) return false;

    if (acceptKurirEnabled) {
        if (driverVehicleType === 'motor') {
            if (!(orderType === 'motor' || orderType === 'kurir_motor')) return false;
        } else if (driverVehicleType === 'bentor') {
            if (!(orderType === 'bentor' || orderType === 'kurir_bentor')) return false;
        } else {
            if (orderType !== driverVehicleType) return false;
        }
    } else {
        if (orderType !== driverVehicleType) return false;
    }

    if (!driverLocation.latitude || !driverLocation.longitude) return false;
    if (!orderData.pickup_lat || !orderData.pickup_lng) return false;
    const dist = calculateDistance(
        driverLocation.latitude,
        driverLocation.longitude,
        orderData.pickup_lat,
        orderData.pickup_lng
    );
    return dist !== null && dist <= MAX_DISTANCE_KM;
}

function createOrderElement(order) {
    const customerName = order.customer_name || 'Tidak diketahui';
    const customerPhoto = order.photoURL || 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png';
    const alamatA = order.pickup_address || '-';
    const alamatB = order.destination_address || '-';
    const viaAddress = order.via_address || null;
    const durasi = order.duration_seconds ? Math.round(order.duration_seconds / 60) + ' menit' : '-';
    const jarak = order.distance_meters ? (order.distance_meters / 1000).toFixed(1) + ' km' : '-';
    const harga = order.price || 0;
    const isKurir = order.transport_type && order.transport_type.includes('kurir');

    // ===== BARU: Badge metode pembayaran =====
    const isJePay = order.payment_method === 'jepay';
    const paymentBadge = isJePay 
        ? '<span class="payment-badge jepay">💳 JePay</span>' 
        : '<span class="payment-badge cash">💵 Tunai</span>';
    // =====================================

    let deskripsiBarang = '';
    if (isKurir && order.item_description) {
        deskripsiBarang = `<div class="delivery-desc-card">${escapeHtml(order.item_description)}</div>`;
    }

    let jarakDriver = '-';
    if (driverLocation.latitude && driverLocation.longitude && order.pickup_lat && order.pickup_lng) {
        const dist = calculateDistance(driverLocation.latitude, driverLocation.longitude, order.pickup_lat, order.pickup_lng);
        if (dist !== null) jarakDriver = dist.toFixed(1) + ' km';
    }

    const orderItem = document.createElement('div');
    orderItem.className = 'order-item';
    orderItem.dataset.orderId = order.id;

    let routeHtml = `
        <div class="route-point">
            <div class="point-marker point-marker-a">🟢</div>
            <div class="point-address point-address-a">${escapeHtml(alamatA)}</div>
        </div>
    `;
    if (viaAddress) {
        routeHtml += `
            <div class="route-point">
                <div class="point-marker point-marker-via" style="background-color:#2196F3;">🔵</div>
                <div class="point-address"><strong>Lewat:</strong> ${escapeHtml(viaAddress)}</div>
            </div>
        `;
    }
    routeHtml += `
        <div class="route-point">
            <div class="point-marker point-marker-b">🟠</div>
            <div class="point-address">${escapeHtml(alamatB)}</div>
        </div>
    `;

    orderItem.innerHTML = `
        <div class="order-header">
            <div class="order-badges">
                ${isKurir ? '<span class="kurir-badge">📦 KURIR</span>' : ''}
                ${paymentBadge}
            </div>
        </div>
        <div class="route-info-with-photo">
            <div class="customer-info-left">
                <img src="${customerPhoto}" class="customer-photo-left" onclick="showPhotoModal('${customerPhoto}', '${escapeHtml(customerName)}')">
                <div class="customer-name-left">${escapeHtml(customerName)}</div>
                <div class="customer-rating">
                    <span>★</span>
                    <span class="rating-value">${(order.passenger_rating || 0).toFixed(1)}</span>
                    <span class="trip-count">(${order.perjalanan || 0})</span>
                </div>
                <div class="order-time">${new Date(order.created_at).toLocaleTimeString('id-ID', {hour:'2-digit',minute:'2-digit'})}</div>
            </div>
            <div class="route-addresses-right">
                ${routeHtml}
            </div>
        </div>
        ${deskripsiBarang}
        <div class="order-details">
            <div class="detail-item"><span class="detail-value">${durasi}</span><span class="detail-label">Durasi</span></div>
            <div class="detail-item"><span class="detail-value">${jarak}</span><span class="detail-label">Jarak</span></div>
            <div class="detail-item"><span class="detail-value price-highlight">Rp ${harga.toLocaleString('id-ID')}</span><span class="detail-label">Harga</span></div>
            <div class="detail-item"><span class="detail-value">${jarakDriver}</span><span class="detail-label">Jarak Driver</span></div>
        </div>
    `;

    orderItem.addEventListener('click', () => {
        showOrderDetail({ orderId: order.id, orderData: order }, false);
    });

    return orderItem;
}

function addOrderToDOM(order) {
    const ordersList = document.getElementById('ordersList');
    if (!ordersList) return;
    const el = createOrderElement(order);
    ordersList.appendChild(el);
    updateRadarVisibility();
}

function updateOrderDOM(orderId, orderData) {
    removeOrderDOM(orderId);
    addOrderToDOM(orderData);
}

function removeOrderDOM(orderId) {
    const ordersList = document.getElementById('ordersList');
    if (!ordersList) return;
    const el = ordersList.querySelector(`.order-item[data-order-id="${orderId}"]`);
    if (el) el.remove();
    updateRadarVisibility();
}

function renderAllOrdersFromMap() {
    const ordersList = document.getElementById('ordersList');
    if (!ordersList) return;

    ordersList.innerHTML = '';
    let hasVisible = false;

    for (let [orderId, orderData] of orderMap) {
        if (isOrderVisible(orderData)) {
            addOrderToDOM(orderData);
            hasVisible = true;
        }
    }

    if (!hasVisible) {
        document.getElementById('radarContainer').style.display = 'flex';
        document.querySelector('.container').style.display = 'none';
        startRadarMessages();
    } else {
        document.getElementById('radarContainer').style.display = 'none';
        document.querySelector('.container').style.display = 'block';
        stopRadarMessages();
    }
}

function refreshDisplay() {
    renderAllOrdersFromMap();
}

function updateRadarVisibility() {
    const ordersList = document.getElementById('ordersList');
    if (!ordersList) return;
    const hasOrders = ordersList.children.length > 0;
    if (!hasOrders) {
        document.getElementById('radarContainer').style.display = 'flex';
        document.querySelector('.container').style.display = 'none';
        startRadarMessages();
    } else {
        document.getElementById('radarContainer').style.display = 'none';
        document.querySelector('.container').style.display = 'block';
        stopRadarMessages();
    }
}

function loadOrders() {
    const ordersList = document.getElementById('ordersList');
    if (!ordersList) return;

    if (!gpsReady || !driverLocation.latitude || !driverLocation.longitude) {
        const lastLocation = localStorage.getItem('jego_last_driver_location');
        if (lastLocation) {
            try {
                const loc = JSON.parse(lastLocation);
                driverLocation = { latitude: loc.lat, longitude: loc.lng };
                gpsReady = true;
                console.log('📍 Menggunakan lokasi terakhir dari storage untuk memuat order');
            } catch(e) {}
        }
    }

    if (!globalCurrentUid) {
        ordersList.innerHTML = '<div class="empty-state"><div>🔐</div><p>Menunggu autentikasi driver...</p></div>';
        return;
    }
    if (!checkDriverData()) return;

    if (!gpsReady || !driverLocation.latitude || !driverLocation.longitude) {
        const messages = ["Mencari sinyal GPS...", "Menunggu sinyal stabil...", "Memastikan akurasi lokasi..."];
        let msgIndex = 0;
        if (gpsLoadingInterval) clearInterval(gpsLoadingInterval);
        ordersList.innerHTML = `<div class="loading"><div class="spinner"></div><p id="gpsLoadingMessage">${messages[0]}</p></div>`;
        gpsLoadingInterval = setInterval(() => {
            msgIndex = (msgIndex + 1) % messages.length;
            const msgElement = document.getElementById('gpsLoadingMessage');
            if (msgElement) msgElement.textContent = messages[msgIndex];
        }, 3000);
        return;
    }

    if (!currentDriverData?.vehicleType) {
        ordersList.innerHTML = `<div class="empty-state"><div>⚠️</div><p>Data kendaraan driver tidak lengkap. Silakan perbarui profil kendaraan Anda.</p><p><a href="akun.html" style="color:var(--primary);">Kelola Kendaraan</a></p></div>`;
        return;
    }

    detachOrdersListeners();
    orderMap.clear();
    ordersList.innerHTML = '';

    ordersRef = database.ref('orders')
        .orderByChild('status')
        .equalTo('waiting');

    isInitialLoad = true;

    const childAddedHandler = (snapshot) => {
        const orderId = snapshot.key;
        const orderData = snapshot.val();
        if (!orderData) {
            console.warn(`⚠️ child_added: order ${orderId} tidak memiliki data`);
            return;
        }
        console.log(`📥 [child_added] Order ${orderId} muncul: status=${orderData.status}, created_at=${orderData.created_at}`);
        orderData.id = orderId;
        orderMap.set(orderId, orderData);

        if (!isInitialLoad) {
            if (isOrderVisible(orderData)) {
                addOrderToDOM(orderData);

                let loc = null;
                if (typeof Android !== 'undefined') {
                    try {
                        const locJson = Android.getLastKnownLocation();
                        if (locJson !== 'null') {
                            loc = JSON.parse(locJson);
                            console.log('📍 Lokasi dari Android Service:', loc);
                        }
                    } catch (e) {
                        console.warn('Gagal ambil lokasi dari Android:', e);
                    }
                }
                if (!loc || !loc.lat || !loc.lng) {
                    loc = { lat: driverLocation.latitude, lng: driverLocation.longitude };
                    console.log('📍 Lokasi fallback dari cache HTML:', loc);
                }

                if (loc && loc.lat && loc.lng) {
                    driverLocation.latitude = loc.lat;
                    driverLocation.longitude = loc.lng;

                    if (globalCurrentUid) {
                        // Kirim ke Redis saja (tidak ke Firebase)
                        sendLocationToRedis(loc.lat, loc.lng);
                    }

                    const dist = calculateDistance(
                        loc.lat, loc.lng,
                        orderData.pickup_lat, orderData.pickup_lng
                    );

                    if (dist !== null && dist < 3 && locationTrackingEnabled && !isWaitingForConfirmation) {
                        const isKurir = (orderData.transport_type || '').includes('kurir');
                        const fromAuto = (autobidEnabled && !isKurir);
                        showOrderDetail({ orderId: orderId, orderData: orderData }, fromAuto, true);
                    }
                } else {
                    console.warn('⚠️ Lokasi tidak tersedia, lewati penawaran untuk order', orderId);
                }

                const beepSound = document.getElementById('beekSound');
                if (beepSound) beepSound.play().catch(e => console.log('Audio error:', e));
            }
        }
    };

    const childChangedHandler = (snapshot) => {
        const orderId = snapshot.key;
        const orderData = snapshot.val();
        if (!orderData) return;
        console.log(`🔄 [child_changed] Order ${orderId} berubah: status=${orderData.status}`);
        orderData.id = orderId;
        orderMap.set(orderId, orderData);

        const existingEl = document.querySelector(`.order-item[data-order-id="${orderId}"]`);
        if (existingEl) {
            if (isOrderVisible(orderData)) {
                updateOrderDOM(orderId, orderData);
            } else {
                removeOrderDOM(orderId);
            }
        } else {
            if (isOrderVisible(orderData)) {
                addOrderToDOM(orderData);
            }
        }
    };

    const childRemovedHandler = (snapshot) => {
        const orderId = snapshot.key;
        console.log(`🗑️ [child_removed] Order ${orderId} dihapus dari daftar waiting`);
        orderMap.delete(orderId);
        removeOrderDOM(orderId);
    };

    ordersChildListeners.child_added = childAddedHandler;
    ordersChildListeners.child_changed = childChangedHandler;
    ordersChildListeners.child_removed = childRemovedHandler;

    ordersRef.on('child_added', childAddedHandler);
    ordersRef.on('child_changed', childChangedHandler);
    ordersRef.on('child_removed', childRemovedHandler);

    ordersRef.once('value', function(snapshot) {
        isInitialLoad = false;
        renderAllOrdersFromMap();
        if (gpsLoadingInterval) {
            clearInterval(gpsLoadingInterval);
            gpsLoadingInterval = null;
        }
    });
}

// ==================== ORDER DETAIL BOTTOM SHEET ====================
function createBidOptionsInContainer(originalPrice, orderId, container) {
    if (!container) return;
    container.innerHTML = '';

    const mainBtn = document.createElement('button');
    mainBtn.className = 'bid-option original';
    mainBtn.style.width = '100%';
    mainBtn.style.padding = '14px 12px';
    mainBtn.style.borderRadius = '10px';
    mainBtn.style.border = 'none';
    mainBtn.style.fontWeight = '700';
    mainBtn.style.fontSize = '1.1rem';
    mainBtn.style.cursor = 'pointer';
    mainBtn.style.background = 'var(--primary)';
    mainBtn.style.color = 'white';
    mainBtn.style.boxShadow = '0 2px 8px rgba(255,152,0,0.3)';
    mainBtn.innerHTML = `Terima ${originalPrice.toLocaleString('id-ID')} `;

    mainBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (isWaitingForConfirmation) {
            showToast('Sedang menunggu konfirmasi order lain.', 'warning');
            return;
        }
        mainBtn.disabled = true;
        mainBtn.textContent = 'Mengirim...';
        document.querySelectorAll('#bottomSheetBidOptions .bid-option').forEach(b => b.disabled = true);
        try {
            await sendDriverOffer(false, originalPrice, 0, mainBtn);
        } catch (err) {
            mainBtn.disabled = false;
            mainBtn.innerHTML = `Ambil ${originalPrice.toLocaleString('id-ID')} (tawaran asli)`;
            document.querySelectorAll('#bottomSheetBidOptions .bid-option').forEach(b => b.disabled = false);
        }
    });
    container.appendChild(mainBtn);

    const extraPercentages = [20, 30, 40];
    const extraPrices = extraPercentages.map(pct => {
        let val = originalPrice * (1 + pct / 100);
        val = Math.round(val / 1000) * 1000;
        return { percent: pct, price: val };
    });

    const extraContainer = document.createElement('div');
    extraContainer.style.display = 'flex';
    extraContainer.style.flexWrap = 'nowrap';
    extraContainer.style.overflowX = 'auto';
    extraContainer.style.gap = '8px';
    extraContainer.style.marginTop = '10px';
    extraContainer.style.paddingBottom = '4px';
    extraContainer.style.scrollbarWidth = 'thin';

    extraPrices.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'bid-option plus';
        btn.style.flex = '1 1 0';
        btn.style.minWidth = '0';
        btn.style.padding = '10px 6px';
        btn.style.borderRadius = '8px';
        btn.style.border = '1px solid #ddd';
        btn.style.fontWeight = '600';
        btn.style.cursor = 'pointer';
        btn.style.whiteSpace = 'nowrap';
        btn.style.background = '#f8f9fa';
        btn.style.color = '#333';
        btn.style.textAlign = 'center';
        btn.innerHTML = `Rp ${opt.price.toLocaleString('id-ID')}`;
        btn.dataset.percent = opt.percent;
        btn.dataset.price = opt.price;

        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (isWaitingForConfirmation) {
                showToast('Sedang menunggu konfirmasi order lain.', 'warning');
                return;
            }
            const originalHTML = btn.innerHTML;
            btn.innerHTML = 'Mengirim...';
            btn.disabled = true;
            document.querySelectorAll('#bottomSheetBidOptions .bid-option').forEach(b => b.disabled = true);
            try {
                await sendDriverOffer(false, opt.price, opt.percent, btn);
            } catch (err) {
                btn.innerHTML = originalHTML;
                btn.disabled = false;
                document.querySelectorAll('#bottomSheetBidOptions .bid-option').forEach(b => b.disabled = false);
            }
        });
        extraContainer.appendChild(btn);
    });

    container.appendChild(extraContainer);
}

function initBottomSheetMap() {
    if (typeof google === 'undefined' || !google.maps) {
        console.warn('Google Maps belum siap, coba lagi nanti');
        return;
    }
    const mapContainer = document.getElementById('bottomSheetMap');
    if (!mapContainer) return;
    if (bottomSheetMap) {
        bottomSheetMap = null;
        mapContainer.innerHTML = '';
    }
    bottomSheetMap = new google.maps.Map(mapContainer, {
    center: { lat: 0.5441, lng: 123.0595 },
    zoom: 12,
    mapTypeControl: false,
    fullscreenControl: false,
    streetViewControl: false,
    zoomControl: false,
    rotateControl: false,
    scaleControl: false,
    clickableIcons: false,
    disableDefaultUI: true,
});
}

function showRouteOnBottomSheetMap(order) {
    if (!bottomSheetMap) return;
    if (!order.pickup_lng || !order.pickup_lat || !order.dest_lng || !order.dest_lat) return;

    if (mapMarkers.length) {
        mapMarkers.forEach(m => m.setMap(null));
        mapMarkers = [];
    }

    const bounds = new google.maps.LatLngBounds();
    const pickupPos = { lat: order.pickup_lat, lng: order.pickup_lng };
    const destPos = { lat: order.dest_lat, lng: order.dest_lng };

    const pickupMarker = new google.maps.Marker({
        position: pickupPos,
        map: bottomSheetMap,
        icon: {
            url: 'https://cdn-icons-png.flaticon.com/128/5811/5811823.png',
            scaledSize: new google.maps.Size(40, 40)
        },
        title: 'Jemput'
    });
    mapMarkers.push(pickupMarker);
    bounds.extend(pickupPos);

    if (order.via_lng && order.via_lat) {
        const viaPos = { lat: order.via_lat, lng: order.via_lng };
        const viaMarker = new google.maps.Marker({
            position: viaPos,
            map: bottomSheetMap,
            icon: {
                url: 'https://cdn-icons-png.flaticon.com/128/684/684908.png',
                scaledSize: new google.maps.Size(40, 40)
            },
            title: 'Via'
        });
        mapMarkers.push(viaMarker);
        bounds.extend(viaPos);
    }

    const destMarker = new google.maps.Marker({
        position: destPos,
        map: bottomSheetMap,
        icon: {
            url: 'https://cdn-icons-png.flaticon.com/128/684/684908.png',
            scaledSize: new google.maps.Size(40, 40)
        },
        title: 'Tujuan'
    });
    mapMarkers.push(destMarker);
    bounds.extend(destPos);

    bottomSheetMap.fitBounds(bounds, { padding: 40 });

    const directionsService = new google.maps.DirectionsService();
    const directionsRenderer = new google.maps.DirectionsRenderer({
        map: bottomSheetMap,
        suppressMarkers: true,
        polylineOptions: {
            strokeColor: '#289672',
            strokeWeight: 4
        }
    });

    const waypoints = [];
    if (order.via_lng && order.via_lat) {
        waypoints.push({
            location: { lat: order.via_lat, lng: order.via_lng },
            stopover: true
        });
    }

    directionsService.route({
        origin: pickupPos,
        destination: destPos,
        waypoints: waypoints,
        travelMode: google.maps.TravelMode.DRIVING,
    }, (result, status) => {
        if (status === google.maps.DirectionsStatus.OK) {
            directionsRenderer.setDirections(result);
        } else {
            console.warn('Gagal mengambil rute:', status);
            const line = new google.maps.Polyline({
                path: [pickupPos, destPos],
                geodesic: true,
                strokeColor: '#289672',
                strokeWeight: 4,
                strokeOpacity: 0.7,
                map: bottomSheetMap,
            });
            mapMarkers.push(line);
        }
    });
}

async function showOrderDetail(orderObj, fromAuto = false, isAutoTrigger = false) {
    if (isWaitingForConfirmation) {
        showToast('Anda sedang memproses order lain, harap tunggu.', 'warning');
        return;
    }
    if (!checkDriverData() || !globalCurrentUid) return;
    const { orderId, orderData } = orderObj;
    console.log(`👆 [showOrderDetail] User mengklik order ${orderId}`);
    
    const snapshot = await database.ref(`orders/${orderId}`).once('value');
    const currentOrder = snapshot.val();
    if (!currentOrder || currentOrder.status !== 'waiting') {
        showToast('Order ini sudah tidak tersedia.', 'warning');
        refreshDisplay();
        return;
    }
    currentSelectedOrder = { orderId: orderId, orderData: currentOrder };

    const content = document.getElementById('bottomSheetContent');
    let html = `
        <div id="bottomSheetMap" class="map-container" style="height:180px; margin-bottom:12px;"></div>
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
            <img src="${currentOrder.photoURL || 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png'}" style="width:36px; height:36px; border-radius:50%; object-fit:cover; border:2px solid var(--primary);">
            <div>
                <div style="font-weight:600; font-size:0.95rem;">${escapeHtml(currentOrder.customer_name || 'Customer')}</div>
                <div style="font-size:0.7rem; color:#666;">⭐ ${(currentOrder.passenger_rating || 0).toFixed(1)} (${currentOrder.perjalanan || 0} perjalanan)</div>
            </div>
        </div>
        <div style="display:flex; flex-direction:column; gap:4px; margin-bottom:8px; background:#f8f9fa; padding:8px 10px; border-radius:8px;">
            <div style="display:flex; align-items:flex-start; gap:6px; font-size:0.85rem;">
                <span style="color:var(--primary);">🟢</span>
                <span><strong>Jemput</strong> ${escapeHtml(currentOrder.pickup_address || '-')}</span>
            </div>
            ${currentOrder.via_address ? `
            <div style="display:flex; align-items:flex-start; gap:6px; font-size:0.85rem;">
                <span style="color:#2196F3;">🔵</span>
                <span><strong>Via</strong> ${escapeHtml(currentOrder.via_address)}</span>
            </div>` : ''}
            <div style="display:flex; align-items:flex-start; gap:6px; font-size:0.85rem;">
                <span style="color:var(--secondary);">🟠</span>
                <span><strong>Antar</strong> ${escapeHtml(currentOrder.destination_address || '-')}</span>
            </div>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; background:#f0f0f0; padding:8px; border-radius:8px; margin-bottom:12px; text-align:center;">
            <div><span style="font-size:0.7rem; color:#666;">Durasi</span><br><span style="font-weight:700;">${currentOrder.duration_seconds ? Math.round(currentOrder.duration_seconds / 60) + ' min' : '-'}</span></div>
            <div><span style="font-size:0.7rem; color:#666;">Jarak</span><br><span style="font-weight:700;">${currentOrder.distance_meters ? (currentOrder.distance_meters / 1000).toFixed(1) + ' km' : '-'}</span></div>
            <div><span style="font-size:0.7rem; color:#666;">Harga</span><br><span style="font-weight:700; color:var(--success);">Rp ${(currentOrder.price || 0).toLocaleString('id-ID')}</span></div>
        </div>
        ${currentOrder.item_description ? `<div style="background:#fff3e0; border-left:3px solid var(--primary); padding:6px 8px; border-radius:6px; font-size:0.75rem; margin-bottom:10px;">${escapeHtml(currentOrder.item_description)}</div>` : ''}
        <div id="bottomSheetBidOptions" class="bid-options-container" style="display:flex; flex-direction:column; gap:8px; margin-bottom:8px;"></div>
        <div id="bottomSheetCountdown" style="display:none; margin-bottom:8px;">
            <div class="progress-container"><div id="bottomSheetProgress" class="progress-bar" style="width:100%"></div></div>
            <div class="progress-info"><span>Menunggu konfirmasi customer...</span><span id="bottomSheetSeconds">30 detik</span></div>
        </div>
        <div style="display:flex; gap:8px; margin-top:4px;">
            <button class="ambil-btn" id="bottomSheetAmbilBtn" style="flex:2;">Kirim Penawaran</button>
            <button class="ambil-btn" id="bottomSheetSkipBtn" style="flex:1; background:#ccc; color:#333;">Lewati</button>
        </div>
    `;
    content.innerHTML = html;

    const sheet = document.getElementById('orderBottomSheet');
    sheet.classList.add('open');

    if (typeof google !== 'undefined' && google.maps) {
        initBottomSheetMap();
        setTimeout(() => {
            showRouteOnBottomSheetMap(currentOrder);
        }, 300);
    } else {
        const checkMap = setInterval(() => {
            if (typeof google !== 'undefined' && google.maps) {
                clearInterval(checkMap);
                initBottomSheetMap();
                setTimeout(() => {
                    showRouteOnBottomSheetMap(currentOrder);
                }, 300);
            }
        }, 500);
        setTimeout(() => clearInterval(checkMap), 10000);
    }

    const ambilBtn = document.getElementById('bottomSheetAmbilBtn');
    const skipBtn = document.getElementById('bottomSheetSkipBtn');
    const bidContainer = document.getElementById('bottomSheetBidOptions');
    const countdownContainer = document.getElementById('bottomSheetCountdown');

    if (isWaitingForConfirmation) {
        skipBtn.disabled = true;
        skipBtn.style.opacity = '0.5';
        skipBtn.style.cursor = 'not-allowed';
    } else {
        skipBtn.disabled = false;
        skipBtn.style.opacity = '1';
        skipBtn.style.cursor = 'pointer';
    }

    skipBtn.addEventListener('click', () => {
        if (isWaitingForConfirmation) {
            showToast('Tidak bisa lewati, sedang menunggu konfirmasi customer.', 'warning');
            return;
        }
        closeBottomSheet();
    });

    const isAutoBid = (autobidEnabled && fromAuto);
    if (!isAutoBid) {
        ambilBtn.style.display = 'none';
        createBidOptionsInContainer(currentOrder.price, orderId, bidContainer);
    } else {
        ambilBtn.style.display = 'block';
        ambilBtn.textContent = 'Kirim Penawaran';
        ambilBtn.disabled = false;
    }

    ambilBtn.onclick = function() {
        if (isAutoBid) {
            if (autobidOfferedOrders.has(orderId)) {
                showToast('Penawaran sudah dikirim sebelumnya.', 'info');
                return;
            }
            ambilBtn.disabled = true;
            ambilBtn.textContent = 'Mengirim...';
            sendDriverOffer(true, currentOrder.price, 0, null);
        }
    };

    if (isAutoTrigger && !fromAuto) {
        const manualSound = document.getElementById('manualPopupSound');
        if (manualSound) manualSound.play().catch(e => console.log('Audio error:', e));
    }

    if (currentModalOrderListener && currentModalOrderRef) {
        currentModalOrderRef.off('value', currentModalOrderListener);
    }
    currentModalOrderRef = database.ref(`orders/${orderId}`);
    currentModalOrderListener = currentModalOrderRef.on('value', (snapshot) => {
        const order = snapshot.val();
        if (!order || order.status !== 'waiting' || order.status === 'cancelled_by_user') {
            closeBottomSheet();
            showToast('Order telah dibatalkan oleh customer.', 'warning');
        }
    });

    if (isAutoBid) {
        if (autobidOfferedOrders.has(orderId)) {
            console.log(`Autobid untuk order ${orderId} sudah dikirim sebelumnya, lewat.`);
            return;
        }
        const autoSound = document.getElementById('autobidSound');
        if (autoSound) autoSound.play().catch(e => console.log('Audio error:', e));
        ambilBtn.disabled = true;
        ambilBtn.textContent = 'Mengirim Penawaran...';
        await sendDriverOffer(true, currentOrder.price, 0, null);
    }
}

// ==================== SEND OFFER & COUNTDOWN ====================
async function sendDriverOffer(isAuto = false, bidPrice = null, bidPercent = null, clickedButton = null) {
  if (isWaitingForConfirmation) {
    showToast('Sedang menunggu konfirmasi order lain, tidak bisa mengirim penawaran baru.', 'warning');
    return;
  }
  if (!currentSelectedOrder || !globalCurrentUid) return;
  if (!checkDriverData()) return;
  
  const { orderId, orderData } = currentSelectedOrder;
  const originalPrice = orderData.price;

  if (isAuto && bidPrice === null) {
    bidPrice = originalPrice;
    bidPercent = 0;
  }

  let finalOfferPrice = originalPrice;
  let percentUsed = 0;
  if (bidPrice !== null && bidPercent !== null) {
    finalOfferPrice = bidPrice;
    percentUsed = bidPercent;
  }
  
  if (isAuto && autobidOfferedOrders.has(orderId)) {
    console.log(`Autobid: Order ${orderId} sudah pernah ditawarkan, lewat.`);
    return;
  }
  
  let freshBalance = 0;
  try {
    const driverSnap = await database.ref(`drivers/${globalCurrentUid}/balance`).once('value');
    freshBalance = driverSnap.val() || 0;
    if (currentDriverData) currentDriverData.balance = freshBalance;
    console.log(`Saldo terbaru dari Firebase: Rp ${freshBalance.toLocaleString('id-ID')}`);
  } catch(e) {
    console.warn("Gagal ambil saldo terbaru dari Firebase:", e);
    freshBalance = currentDriverData?.balance || 0;
  }
  
  const driverBalance = freshBalance;
  
  let feePersen = 0, pajakPersen = 0;
  try {
    const potonganSnap = await database.ref('data-jego/potongan').once('value');
    const pajakSnap = await database.ref('data-jego/pajak').once('value');
    feePersen = parseFloat(potonganSnap.val()) || 0;
    pajakPersen = parseFloat(pajakSnap.val()) || 0;
  } catch(e) {
    console.warn("Gagal ambil fee/pajak:", e);
  }
  
  const potonganRupiah = finalOfferPrice * (feePersen / 100);
  const pajakRupiah = potonganRupiah * (pajakPersen / 100);
  const totalPotongan = potonganRupiah + pajakRupiah;
  
  if (driverBalance < totalPotongan) {
    console.log(`Saldo tidak cukup: ${driverBalance} < ${totalPotongan}`);
    showToast(
      `Saldo Anda Rp ${driverBalance.toLocaleString('id-ID')} tidak mencukupi. Silakan isi saldo terlebih dahulu.`,
      'warning'
    );
    if (clickedButton) {
      clickedButton.innerText = clickedButton.dataset.originalText || (clickedButton.innerText === 'Mengirim...' ? 'Ambil' : clickedButton.innerText);
      clickedButton.disabled = false;
      document.querySelectorAll('#bottomSheetBidOptions .bid-option').forEach(btn => btn.disabled = false);
    }
    return;
  }
  
  const ambilBtn = document.getElementById('bottomSheetAmbilBtn');
  if (ambilBtn) {
    ambilBtn.disabled = true;
    ambilBtn.textContent = 'Mengirim...';
  } else {
    document.querySelectorAll('#bottomSheetBidOptions .bid-option').forEach(btn => btn.disabled = true);
  }
  
  const snapshot = await database.ref(`orders/${orderId}`).once('value');
  const currentOrder = snapshot.val();
  if (!currentOrder || currentOrder.status !== 'waiting') {
    showToast('Order ini sudah diambil oleh driver lain.', 'warning');
    closeBottomSheet();
    if (clickedButton) {
      clickedButton.innerText = clickedButton.dataset.originalText || (clickedButton.innerText === 'Mengirim...' ? 'Ambil' : clickedButton.innerText);
      clickedButton.disabled = false;
      document.querySelectorAll('#bottomSheetBidOptions .bid-option').forEach(btn => btn.disabled = false);
    }
    return;
  }
  
  const driverDataForOffer = {
    driver_id: globalCurrentUid,
    driver_name: currentDriverData.fullName,
    driver_plate: currentDriverData.plateNumber,
    driver_type: currentDriverData.vehicleType,
    driver_rating: currentDriverData.rating,
    driver_trips: currentDriverData.perjalanan,
    driver_photo: currentDriverData.profilePhotoUrl || '',
    offered_at: new Date().toISOString(),
    status: 'offered',
    bid_price: finalOfferPrice,
    bid_percent: percentUsed,
    bid_requested: (bidPrice !== null)
  };
  
  try {
    await database.ref(`orders/${orderId}/driver_offers/${globalCurrentUid}`).set(driverDataForOffer);
    
    if (isAuto) {
      autobidOfferedOrders.add(orderId);
      let storedOffers = JSON.parse(localStorage.getItem('autobid_offered_orders') || '[]');
      if (!storedOffers.includes(orderId)) {
        storedOffers.push(orderId);
        localStorage.setItem('autobid_offered_orders', JSON.stringify(storedOffers));
      }
    }
    
    if (ambilBtn) ambilBtn.textContent = 'Menunggu Konfirmasi';
    startCountdown(orderId, globalCurrentUid);
  } catch (err) {
    console.error(err);
    showToast('Gagal mengirim penawaran.', 'error');
    if (ambilBtn) {
      ambilBtn.disabled = false;
      ambilBtn.textContent = 'Kirim Penawaran';
    } else {
      if (clickedButton) {
        clickedButton.innerText = clickedButton.dataset.originalText || (clickedButton.innerText === 'Mengirim...' ? 'Ambil' : clickedButton.innerText);
        clickedButton.disabled = false;
      }
      document.querySelectorAll('#bottomSheetBidOptions .bid-option').forEach(btn => btn.disabled = false);
    }
  }
}

function stopCountdown() {
  isWaitingForConfirmation = false;
  if (countdownInterval) clearInterval(countdownInterval);
  if (orderStatusListener && countdownOrderId) {
    database.ref(`orders/${countdownOrderId}`).off('value', orderStatusListener);
    orderStatusListener = null;
  }
  if (offerRejectionListener && countdownOrderId && countdownDriverId) {
    database.ref(`orders/${countdownOrderId}/driver_offers/${countdownDriverId}/status`).off('value', offerRejectionListener);
    offerRejectionListener = null;
  }
  const container = document.getElementById('bottomSheetCountdown');
  if (container) container.style.display = 'none';
  const ambilBtn = document.getElementById('bottomSheetAmbilBtn');
  if (ambilBtn) { ambilBtn.disabled = false; ambilBtn.textContent = 'Kirim Penawaran'; }
  const closeBtn = document.getElementById('closeBottomSheet');
  if (closeBtn) { closeBtn.classList.remove('disabled'); closeBtn.disabled = false; }
  const skipBtn = document.getElementById('bottomSheetSkipBtn');
  if (skipBtn) {
    skipBtn.disabled = false;
    skipBtn.style.opacity = '1';
    skipBtn.style.cursor = 'pointer';
  }
  countdownOrderId = null; countdownDriverId = null; orderStatusListener = null; countdownInterval = null;
}

function startCountdown(orderId, driverId) {
  stopCountdown();
  countdownOrderId = orderId;
  countdownDriverId = driverId;
  isWaitingForConfirmation = true;
  const container = document.getElementById('bottomSheetCountdown');
  const progress = document.getElementById('bottomSheetProgress');
  const secondsSpan = document.getElementById('bottomSheetSeconds');
  const ambilBtn = document.getElementById('bottomSheetAmbilBtn');
  let timeLeft = 30;
  container.style.display = 'block';
  if (ambilBtn) { ambilBtn.disabled = true; ambilBtn.textContent = 'Menunggu...'; }
  const closeBtn = document.getElementById('closeBottomSheet');
  if (closeBtn) { closeBtn.classList.add('disabled'); closeBtn.disabled = true; }
  const skipBtn = document.getElementById('bottomSheetSkipBtn');
  if (skipBtn) {
    skipBtn.disabled = true;
    skipBtn.style.opacity = '0.5';
    skipBtn.style.cursor = 'not-allowed';
  }

  countdownInterval = setInterval(() => {
    timeLeft--;
    progress.style.width = (timeLeft/30)*100 + '%';
    secondsSpan.textContent = timeLeft + ' detik';
    if (timeLeft <= 0) {
      clearInterval(countdownInterval);
      countdownInterval = null;
      database.ref(`orders/${orderId}/driver_offers/${driverId}`).remove().then(() => closeBottomSheet()).catch(() => closeBottomSheet());
    }
  }, 1000);
  
  orderStatusListener = database.ref(`orders/${orderId}`).on('value', (snapshot) => {
    const order = snapshot.val();
    if (!order) { stopCountdown(); closeBottomSheet(); return; }
    if (order.status === 'accepted') {
      if (order.driver_id === driverId) {
        stopCountdown();
        showToast('✅ Customer menerima penawaran Anda!', 'success');
        const acceptedSound = document.getElementById('orderAcceptedSound');
        if (acceptedSound) {
          acceptedSound.play().catch(e => console.log('Audio error:', e));
          setTimeout(() => {
            localStorage.setItem('jego_driver_active_order', orderId);
            window.location.href = 'orderAccepted.html?id=' + orderId;
          }, 500);
        } else {
          localStorage.setItem('jego_driver_active_order', orderId);
          window.location.href = 'orderAccepted.html?id=' + orderId;
        }
      } else {
        stopCountdown();
        showToast('Order sudah diambil driver lain.', 'warning');
        closeBottomSheet();
      }
    } else if (order.status !== 'waiting') {
      stopCountdown();
      closeBottomSheet();
    }
  });
  
  offerRejectionListener = database.ref(`orders/${orderId}/driver_offers/${driverId}/status`).on('value', (snap) => {
    const status = snap.val();
    if (status === 'rejected') {
      stopCountdown();
      closeBottomSheet();
      showToast('Customer menolak penawaran Anda.', 'warning');
    }
  });
}

function closeBottomSheet() {
  stopAllSounds();
  document.getElementById('orderBottomSheet').classList.remove('open');
  stopCountdown();
  currentSelectedOrder = null;
  if (bottomSheetMap) {
    bottomSheetMap = null;
    document.getElementById('bottomSheetMap').innerHTML = '';
  }
  if (currentModalOrderListener && currentModalOrderRef) {
    currentModalOrderRef.off('value', currentModalOrderListener);
    currentModalOrderListener = null;
    currentModalOrderRef = null;
  }
  refreshDisplay();
}

// ==================== NAVIGATION ====================
function navigateToScreen(screen) {
    if (screen === 'home') window.location.reload();
    else if (screen === 'history') window.location.href = 'riwayat.html';
    else if (screen === 'active_order') window.location.href = 'orderAccepted.html';
    else if (screen === 'account') window.location.href = 'akun.html';
    else if (screen === 'notif_status') window.location.href = 'statusOneSignal.html';
}

// ==================== NOTIFICATIONS ====================
async function initOneSignal() {
  if (typeof median === 'undefined' || !median.onesignal) {
    console.warn("⚠️ Median OneSignal tidak tersedia");
    showToast("OneSignal tidak tersedia.", "warning");
    return false;
  }
  try {
    if (median.onesignal.setConsentGiven) await median.onesignal.setConsentGiven(true);
    await median.onesignal.register();
    if (median.onesignal.promptForPushNotificationsWithUserResponse) {
      await median.onesignal.promptForPushNotificationsWithUserResponse();
    }
    await new Promise(r => setTimeout(r, 8000));
    let playerId = null;
    for (let i = 0; i < 3; i++) {
      const info = await median.onesignal.onesignalInfo();
      playerId = info?.userId || info?.oneSignalUserId || info?.subscription?.id;
      if (playerId) break;
      await new Promise(r => setTimeout(r, 5000));
    }
    if (playerId && globalCurrentUid) {
      // Simpan playerId hanya di Firebase (tanpa waktu)
      await database.ref(`drivers/${globalCurrentUid}`).update({ playerId });
      await database.ref(`driver_locations/${globalCurrentUid}`).update({ playerId });
      showToast("Notifikasi Aktif", "success");
      return true;
    }
    return false;
  } catch (err) {
    console.error("OneSignal error:", err);
    return false;
  }
}

async function checkPlayerIdAndPrompt() {
  if (!globalCurrentUid) return;
  try {
    const snap = await database.ref(`drivers/${globalCurrentUid}/playerId`).once('value');
    if (!snap.val()) {
      document.getElementById('notifPromptModal').style.display = 'flex';
    }
  } catch (err) {}
}
function closeNotifPrompt() { document.getElementById('notifPromptModal').style.display = 'none'; }

let notifListenerRef = null;
let notifListener = null;

function loadDriverNotifications() {
  if (!globalCurrentUid) return;
  const container = document.getElementById('notifListBody');
  if (!container) return;

  container.style.display = 'block';

  if (notifListener && notifListenerRef) {
    notifListenerRef.off('value', notifListener);
  }
  notifListenerRef = database.ref(`driver_notifications/${globalCurrentUid}`);
  notifListener = notifListenerRef.on('value', (snap) => {
    const notifs = [];
    snap.forEach(child => {
      notifs.push({ id: child.key, ...child.val() });
    });
    notifs.sort((a,b) => (b.timestamp||0) - (a.timestamp||0));
    renderNotificationList(notifs);
    const unreadCount = notifs.filter(n => !n.read).length;
    updateNotifBadge(unreadCount);
  });
}

function renderNotificationList(notifs) {
  const container = document.getElementById('notifListBody');
  if (!container) return;
  if (!notifs.length) {
    container.innerHTML = '<div class="empty-state">📭 Belum ada pesan</div>';
    return;
  }
  container.innerHTML = '';
  notifs.forEach(notif => {
    const div = document.createElement('div');
    div.className = `notif-item ${!notif.read ? 'unread' : ''}`;
    div.style.padding = '12px';
    div.style.borderBottom = '1px solid #eee';
    div.style.cursor = 'pointer';
    div.innerHTML = `
      <div style="display:flex; justify-content:space-between;">
        <strong>${escapeHtml(notif.title)}</strong>
        <small>${new Date(notif.timestamp).toLocaleString('id-ID')}</small>
      </div>
      <div style="margin-top:6px; font-size:0.75rem;">${escapeHtml(notif.message)}</div>
    `;
    div.onclick = async () => {
      if (!notif.read) {
        await database.ref(`driver_notifications/${globalCurrentUid}/${notif.id}/read`).set(true);
      }
    };
    container.appendChild(div);
  });
}

function updateNotifBadge(count) {
  const btn = document.getElementById('notifBtn');
  if (!btn) return;
  const existingBadge = btn.querySelector('.notif-badge');
  if (existingBadge) existingBadge.remove();
  if (count > 0) {
    const badge = document.createElement('span');
    badge.className = 'notif-badge';
    badge.textContent = count > 99 ? '99+' : count;
    btn.style.position = 'relative';
    btn.appendChild(badge);
  }
}

window.showPhotoModal = function(photoUrl, name) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'flex';
  modal.innerHTML = `<div class="modal-content" style="max-width:300px; background:transparent;"><div style="text-align:center"><img src="${photoUrl}" style="width:100%; border-radius:12px; border:2px solid white;"><p style="color:white; margin-top:10px;">${escapeHtml(name)}</p><button class="close-btn" style="color:white; margin-top:10px;">Tutup</button></div></div>`;
  document.body.appendChild(modal);
  modal.querySelector('.close-btn').onclick = () => modal.remove();
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
};

// ==================== CHECK ACTIVE ORDER ====================
async function checkDriverActiveOrder() {
  let activeOrderId = localStorage.getItem('jego_driver_active_order');
  if (activeOrderId) {
    const snap = await database.ref(`orders/${activeOrderId}`).once('value');
    const order = snap.val();
    if (order && ['accepted', 'on_the_way', 'arrived', 'on_trip'].includes(order.status)) {
      window.location.href = 'orderAccepted.html?id=' + activeOrderId;
      return true;
    } else {
      localStorage.removeItem('jego_driver_active_order');
    }
  }
  if (!globalCurrentUid) return false;
  const ordersSnap = await database.ref('orders').orderByChild('driver_id').equalTo(globalCurrentUid).once('value');
  const orders = ordersSnap.val();
  if (orders) {
    for (const [orderId, order] of Object.entries(orders)) {
      if (['accepted', 'on_the_way', 'arrived', 'on_trip'].includes(order.status)) {
        localStorage.setItem('jego_driver_active_order', orderId);
        window.location.href = 'orderAccepted.html?id=' + orderId;
        return true;
      }
    }
  }
  return false;
}

// ==================== DOM READY ====================
document.addEventListener('DOMContentLoaded', async () => {
  console.log('📄 DOM siap, memulai inisialisasi...');
  auth.onAuthStateChanged(async (user) => {
    if (user) {
      console.log('🔐 Driver terautentikasi dengan UID:', user.uid);
      globalCurrentUid = user.uid;

      // 🔥 TAMBAHAN: KIRIM UID KE ANDROID (SharedPreferences)
      if (isAndroidAvailable()) {
        try {
          Android.setDriverUid(user.uid);
          console.log('📤 UID dikirim ke Android');
        } catch (e) {
          console.warn('Gagal kirim UID ke Android:', e);
        }
      }

      loadDriverNotifications();
      processPendingFCMToken();

      const driverSnapshot = await database.ref(`drivers/${user.uid}`).once('value');
      const driverDataDB = driverSnapshot.val();
      if (driverDataDB) {
        const status = driverDataDB.status;
        if (status === 'rejected' || status === 'blocked') {
          const ketGagal = driverDataDB.ketGagal || driverDataDB.rejectionReason || driverDataDB.blockReason || 'Tidak ada keterangan.';
          const title = (status === 'rejected') ? 'Akun Ditolak' : 'Akun Diblokir';
          showPopup(title, `Alasan: ${ketGagal}`, 'error', {
            onConfirm: async () => {
              localStorage.removeItem('jego_logged_in_driver');
              localStorage.removeItem('autobid_offered_orders');
              window.location.href = 'loginDriver.html';
            }
          });
          return;
        }
      }
      
      const kompensasiBtn = document.getElementById('kompensasiBtn');
      if (kompensasiBtn) {
        kompensasiBtn.addEventListener('click', () => {
          window.location.href = 'kompensasi.html';
        });
      }

      const notifBtn = document.getElementById('notifBtn');
      if (notifBtn) {
        notifBtn.addEventListener('click', () => {
          const sheet = document.getElementById('notifBottomSheet');
          if (sheet) {
            sheet.classList.add('open');
            loadDriverNotifications();
          }
        });
      }

      const closeNotifSheet = document.getElementById('closeNotifSheet');
      if (closeNotifSheet) {
        closeNotifSheet.addEventListener('click', () => {
          document.getElementById('notifBottomSheet').classList.remove('open');
          document.getElementById('notifListBody').style.display = 'none';
        });
      }
      const notifSheet = document.getElementById('notifBottomSheet');
      if (notifSheet) {
        notifSheet.addEventListener('click', function(e) {
          if (e.target === this) {
            this.classList.remove('open');
            document.getElementById('notifListBody').style.display = 'none';
          }
        });
      }

      if (await checkDriverActiveOrder()) return;
      if (!checkDriverData()) {
        await auth.signOut();
        localStorage.removeItem('jego_logged_in_driver');
        window.location.href = 'loginDriver.html';
        return;
      }
      
      try {
        const keySnap = await database.ref('data-jego/apikey-google-maps').once('value');
        const apiKey = keySnap.val();
        if (apiKey) {
          await loadGoogleMaps(apiKey);
          console.log('✅ Google Maps berhasil dimuat dengan API key dari Firebase');
        } else {
          console.warn('⚠️ API key Google Maps tidak ditemukan di Firebase. Peta tidak akan berfungsi.');
          showToast('API key Google Maps tidak ditemukan', 'warning');
        }
      } catch (error) {
        console.error('❌ Gagal mengambil API key dari Firebase:', error);
        showToast('Gagal memuat Google Maps', 'error');
      }

      // 🔥 PRIORITASKAN AMBIL STATUS DARI REDIS
      await loadStoredSettings();

      // Sinkronkan dengan Android service
      if (locationTrackingEnabled && isAndroidAvailable()) {
        Android.startDriverTracking();
        console.log('📍 Service tracking dimulai (sinkron dari Redis)');
      } else if (!locationTrackingEnabled && isAndroidAvailable()) {
        Android.stopDriverTracking();
        console.log('⏹️ Service tracking dihentikan (sinkron dari Redis)');
      }

      // Load autobid dan floating dari Firebase (untuk kompatibilitas) - sudah ditangani di loadStoredSettings
      // Tidak perlu lagi pengiriman ke Firebase di sini

      loadOrders();
      setTimeout(startGPSMonitoring, 1000);
      await checkPlayerIdAndPrompt();
    } else {
      console.warn('❌ Driver tidak login, redirect ke loginDriver.html');
      window.location.href = 'loginDriver.html';
    }
  });

  const sidebarHeader = document.getElementById('sidebarHeaderProfile');
  if (sidebarHeader) {
    sidebarHeader.addEventListener('click', () => {
      window.location.href = 'akun.html';
    });
  }

  const menuBtn = document.getElementById('menuBtn');
  if (menuBtn) {
    menuBtn.addEventListener('click', () => document.getElementById('sidebar').style.display = 'flex');
  }

  const sidebarOverlay = document.getElementById('sidebarOverlay');
  if (sidebarOverlay) {
    sidebarOverlay.addEventListener('click', () => document.getElementById('sidebar').style.display = 'none');
  }

  document.querySelectorAll('.sidebar-nav-button').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.dataset.url;
      if (url) {
        if (btn.dataset.external === 'true') {
          window.open(url, '_blank');
        } else {
          window.location.href = url;
        }
      } else if (btn.dataset.screen) {
        navigateToScreen(btn.dataset.screen);
      }
    });
  });

  const locationToggleBtn = document.getElementById('locationToggleBtn');
  if (locationToggleBtn) {
      console.log('🔍 Tombol tracking ditemukan');
      locationToggleBtn.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          console.log('🟢 TRACKING BUTTON CLICK');
          toggleLocationTrackingWithConfirm();
      });
  }

  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', refreshData);

  const closeSheetBtn = document.getElementById('closeBottomSheet');
  if (closeSheetBtn) {
      closeSheetBtn.addEventListener('click', closeBottomSheet);
  } else {
      console.warn('⚠️ closeBottomSheet tidak ditemukan di HTML (akan dibuat dinamis)');
  }

  const orderSheet = document.getElementById('orderBottomSheet');
  if (orderSheet) {
      orderSheet.addEventListener('click', function(e) {
          if (e.target === this) closeBottomSheet();
      });
  }

  const autobidToggle = document.getElementById('autobidToggle');
  if (autobidToggle) autobidToggle.addEventListener('change', toggleAutobid);

  const acceptKurirToggle = document.getElementById('acceptKurirToggle');
  if (acceptKurirToggle) acceptKurirToggle.addEventListener('change', updateAcceptKurirSetting);

  const floatingToggle = document.getElementById('floatingToggle');
  if (floatingToggle) floatingToggle.addEventListener('change', toggleFloatingButton);

  const promptAllow = document.getElementById('promptAllowBtn');
  if (promptAllow) {
      promptAllow.addEventListener('click', async () => {
          closeNotifPrompt();
          await initOneSignal();
      });
  }

  const promptLater = document.getElementById('promptLaterBtn');
  if (promptLater) {
      promptLater.addEventListener('click', closeNotifPrompt);
  }
});

function refreshData() {
    refreshDisplay();
}

window.addEventListener('beforeunload', () => { if (locationWatchId) navigator.geolocation.clearWatch(locationWatchId); });
if (gpsLoadingInterval) clearInterval(gpsLoadingInterval);

document.addEventListener("backbutton", function () {
    if (
        window.location.pathname === "/" ||
        window.location.pathname === "/index.html"
    ) {
        navigator.app.exitApp();
    } else {
        history.back();
    }
}, false);
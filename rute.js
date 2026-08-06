// ==================== KONFIGURASI ====================
console.log('🚀 JeGo - Rute Customer (Google Maps)');

const FIREBASE_CONFIG = {
    apiKey: "AIzaSyCD0pgeZio-LdKqYDtWxcdXcZwyL4ngYQI",
    authDomain: "jego-35a2b.firebaseapp.com",
    databaseURL: "https://jego-35a2b-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "jego-35a2b",
    storageBucket: "jego-35a2b.firebasestorage.app",
    messagingSenderId: "600037007040",
    appId: "1:600037007040:web:ac3243ad9b472647ffd725"
};

if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
const auth = firebase.auth();
const database = firebase.database();

const GOOGLE_MAPS_API_KEY = 'AIzaSyA1c0N-_Cx6E_yKXcIN87EC4zqCEkC5ysM';
console.log('✅ Google Maps API Key loaded');

const darkMapStyle = [
    { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
    { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
    { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
    { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#263c3f" }] },
    { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#6b9a76" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#38414e" }] },
    { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#212a37" }] },
    { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#9ca5b3" }] },
    { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#746855" }] },
    { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#1f2835" }] },
    { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#f3d19c" }] },
    { featureType: "transit", elementType: "geometry", stylers: [{ color: "#2f3948" }] },
    { featureType: "transit.station", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] },
    { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#515c6d" }] },
    { featureType: "water", elementType: "labels.text.stroke", stylers: [{ color: "#17263c" }] }
];

// ==================== GLOBAL VARIABLES ====================
let map;
let currentUser = null;
let currentRoute = null;
let pickupCoord = null, destCoord = null;
let pickupAddress = '', destAddress = '';
let viaCoord = null;
let viaAddress = '';
let viaMarker = null;

let pickupMarker = null, destMarker = null;
let selectedTransport = null;
let transportType = null;
let transportIconUrl = '';
let deliveryData = null;
let isCourier = false;
let transportRate = { minimal_distance: 4, minimal_price: 10000, price_per_km: 2200 };
let currentPrice = 0;
let currentOrderId = null;
let orderRef = null, offersRef = null;
let orderStatusCallback = null, offersCallback = null;
let isSearching = false;
let offerTimerInterval = null;
let cleanupInterval = null;
let driversRef = null, driversListener = null;
let mapPickActive = false;
let mapPickCoords = null;
let mapPickAddress = '';
let mapPickResolveTimer = null;
let searchOverlayMode = 'pickup';
let pickFromMapActive = false;
let searchTimeout = null;
let minAllowedNego = 0;
let mapIdleTimer = null;

// Data kendaraan dari Firebase
let transportData = {};
let tariffRates = {};
const transportNameMapping = {
    'Motor': 'motor',
    'JeGo Ride': 'motor',
    'Bentor': 'bentor',
    'JeGo Trike': 'bentor',
    'Mobil': 'mobil',
    'JeGo Car': 'mobil',
    'Kurir Motor': 'kurir_motor',
    'JeGo Send': 'kurir_motor',
    'Kurir Bentor': 'kurir_bentor',
    'JeGo Trike Send': 'kurir_bentor'
};
const SEARCH_HISTORY_KEY = 'jego_search_history';
const MAX_HISTORY = 10;
let selectedVehicleType = null;

// Google Maps services
let geocoder;
let directionsService;
let directionsRenderer;
let autocompleteService = null;

// ==================== CACHE UNTUK SEARCH ====================
let searchCache = {};
let placeDetailsCache = {};
let searchAbortController = null;

// ==================== UTILITY ====================
function showPopup(title, message, onClose = null) {
    document.getElementById('popupTitle').innerText = title;
    document.getElementById('popupMessage').innerHTML = message;
    const overlay = document.getElementById('popupOverlay');
    overlay.classList.add('active');
    const close = () => {
        overlay.classList.remove('active');
        if (onClose) onClose();
        document.getElementById('popupButton').removeEventListener('click', close);
    };
    document.getElementById('popupButton').addEventListener('click', close);
}

function showConfirmPopup(title, message, onConfirm, onCancel) {
    const overlay = document.getElementById('popupOverlay');
    document.getElementById('popupTitle').innerText = title;
    document.getElementById('popupMessage').innerHTML = message;
    const btnContainer = document.getElementById('popupButtons');
    btnContainer.innerHTML = `
        <button class="popup-button popup-button-primary" id="confirmYesBtn">Ya</button>
        <button class="popup-button popup-button-secondary" id="confirmNoBtn">Batal</button>
    `;
    overlay.classList.add('active');
    document.getElementById('confirmYesBtn').addEventListener('click', function() {
        overlay.classList.remove('active');
        if (onConfirm) onConfirm();
    });
    document.getElementById('confirmNoBtn').addEventListener('click', function() {
        overlay.classList.remove('active');
        if (onCancel) onCancel();
    });
}

function formatRupiah(amount) {
    return 'Rp ' + amount.toLocaleString('id-ID');
}

function calculatePrice(distanceMeters) {
    const distanceKm = distanceMeters / 1000;
    let price = 0;
    if (distanceKm <= transportRate.minimal_distance) {
        price = transportRate.minimal_price;
    } else {
        const extraKm = distanceKm - transportRate.minimal_distance;
        price = transportRate.minimal_price + (extraKm * transportRate.price_per_km);
    }
    return Math.round(price / 1000) * 1000;
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
}

function showToast(message, type = 'info') {
    const existingToast = document.querySelector('.custom-toast');
    if (existingToast) existingToast.remove();
    const toast = document.createElement('div');
    toast.className = 'custom-toast';
    toast.innerText = message;
    toast.style.cssText = `
        position: fixed; bottom: 100px; left: 50%; transform: translateX(-50%);
        background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#FF9800'};
        color: white; padding: 10px 20px; border-radius: 30px; font-size: 14px;
        font-weight: 600; z-index: 10001; box-shadow: 0 2px 10px rgba(0,0,0,0.2);
        animation: fadeInOut 2.5s ease forwards; white-space: nowrap; max-width: 90%; text-align: center;
    `;
    if (!document.querySelector('#toastKeyframes')) {
        const style = document.createElement('style');
        style.id = 'toastKeyframes';
        style.textContent = `
            @keyframes fadeInOut {
                0% { opacity: 0; transform: translateX(-50%) translateY(20px); }
                15% { opacity: 1; transform: translateX(-50%) translateY(0); }
                85% { opacity: 1; transform: translateX(-50%) translateY(0); }
                100% { opacity: 0; transform: translateX(-50%) translateY(-20px); }
            }
        `;
        document.head.appendChild(style);
    }
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
}

// ==================== SEARCH HISTORY ====================
function getSearchHistory() {
    try {
        const data = localStorage.getItem(SEARCH_HISTORY_KEY);
        return data ? JSON.parse(data) : [];
    } catch(e) { return []; }
}

function addSearchHistory(address, lng, lat) {
    let history = getSearchHistory();
    history = history.filter(item => item.address !== address);
    history.unshift({ address, lng, lat, timestamp: Date.now() });
    if (history.length > MAX_HISTORY) history = history.slice(0, MAX_HISTORY);
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history));
}

function renderHistoryList() {
    const container = document.getElementById('searchHistoryList');
    const title = document.getElementById('historyTitle');
    const history = getSearchHistory();
    if (history.length === 0) {
        container.innerHTML = '';
        title.style.display = 'none';
        return;
    }
    title.style.display = 'block';
    container.innerHTML = history.map((item, index) => `
        <div class="search-option-item history-item" data-index="${index}" data-address="${escapeHtml(item.address)}" data-lng="${item.lng}" data-lat="${item.lat}">
            <div class="search-option-icon history">🕐</div>
            <div class="search-option-text">${escapeHtml(item.address)}</div>
        </div>
    `).join('');
    container.querySelectorAll('.history-item').forEach(el => {
        el.addEventListener('click', () => {
            const address = el.getAttribute('data-address');
            const lng = parseFloat(el.getAttribute('data-lng'));
            const lat = parseFloat(el.getAttribute('data-lat'));
            selectAddressFromHistory(address, lng, lat);
        });
    });
}

function selectAddressFromHistory(address, lng, lat) {
    const feature = {
        geometry: { coordinates: [lng, lat] },
        properties: { full_address: address, name: address.split(',')[0] }
    };
    selectAddress(feature);
}

// ==================== NEGOSIASI ====================
function initNegosiasi(originalPriceVal) {
    const minimalPrice = transportRate.minimal_price;
    const maxDiskon = originalPriceVal * 0.1;
    let minAllowed = originalPriceVal - maxDiskon;
    if (minAllowed < minimalPrice) minAllowed = minimalPrice;
    minAllowed = Math.round(minAllowed / 1000) * 1000;
    minAllowedNego = minAllowed;

    const input = document.getElementById('negoInput');
    const minTawarLabel = document.getElementById('minTawarLabel');
    const minErrorVal = document.getElementById('minErrorVal');

    minTawarLabel.innerText = formatRupiah(minAllowed);
    minErrorVal.innerText = formatRupiah(minAllowed);
    input.placeholder = `Minimal ${formatRupiah(minAllowed)}`;

    if (!input.value || input.value === '0') {
        input.value = originalPriceVal;
        currentPrice = originalPriceVal;
        document.getElementById('labelTawaran').innerText = formatRupiah(originalPriceVal);
    } else {
        let val = parseInt(input.value);
        if (!isNaN(val) && val > 0) {
            currentPrice = val;
            document.getElementById('labelTawaran').innerText = formatRupiah(val);
        } else {
            currentPrice = 0;
            document.getElementById('labelTawaran').innerText = 'Rp 0';
        }
    }

    document.getElementById('labelRekomendasi').innerText = formatRupiah(originalPriceVal);
    const confirmBtn = document.getElementById('confirmBtn');
    if (confirmBtn) {
        confirmBtn.innerHTML = currentPrice > 0
            ? `🚀 CARI DRIVER | ${formatRupiah(currentPrice)}`
            : '🚀 CARI DRIVER | Rp 0';
    }

    input.removeEventListener('input', handleNegoInput);
    input.addEventListener('input', handleNegoInput);
}

function handleNegoInput() {
    const input = document.getElementById('negoInput');
    const val = input.value.trim();

    if (val === '') {
        currentPrice = 0;
        document.getElementById('labelTawaran').innerText = 'Rp 0';
        const confirmBtn = document.getElementById('confirmBtn');
        if (confirmBtn) confirmBtn.innerHTML = '🚀 CARI DRIVER | Rp 0';
        document.getElementById('negoError').style.display = 'none';
        return;
    }

    const numVal = parseInt(val);
    if (isNaN(numVal) || numVal <= 0) {
        currentPrice = 0;
        document.getElementById('labelTawaran').innerText = 'Rp 0';
        const confirmBtn = document.getElementById('confirmBtn');
        if (confirmBtn) confirmBtn.innerHTML = '🚀 CARI DRIVER | Rp 0';
        document.getElementById('negoError').style.display = 'none';
        return;
    }

    if (numVal < minAllowedNego) {
        document.getElementById('negoError').style.display = 'block';
        document.getElementById('minErrorVal').innerText = formatRupiah(minAllowedNego);
    } else {
        document.getElementById('negoError').style.display = 'none';
    }

    currentPrice = numVal;
    document.getElementById('labelTawaran').innerText = formatRupiah(numVal);
    const confirmBtn = document.getElementById('confirmBtn');
    if (confirmBtn) confirmBtn.innerHTML = `🚀 CARI DRIVER | ${formatRupiah(numVal)}`;
}

// ==================== DARK MODE ====================
function applyDarkMode() {
    const isDark = localStorage.getItem('jego_dark_mode') === 'true';
    if (isDark) {
        document.body.classList.add('dark-mode');
        if (map) {
            map.setOptions({ styles: darkMapStyle });
        }
    } else {
        document.body.classList.remove('dark-mode');
        if (map) {
            map.setOptions({ styles: [] });
        }
    }
}

// ==================== CEK ORDER AKTIF ====================
async function cekOrderAktifDanRedirect() {
    const orderId = localStorage.getItem('current_order_id');
    if (!orderId) return false;
    try {
        const snap = await database.ref(`orders/${orderId}`).once('value');
        const order = snap.val();
        if (!order) { localStorage.removeItem('current_order_id'); return false; }
        if (order.status === 'waiting') return true;
        const statusRedirect = ['accepted', 'on_the_way', 'arrived', 'on_trip'];
        if (statusRedirect.includes(order.status) && orderId && orderId !== 'null') {
            window.location.href = `tracking_customer.html?order_id=${orderId}`;
            return true;
        } else {
            localStorage.removeItem('current_order_id');
            return false;
        }
    } catch(err) { return false; }
}

async function loadWaitingOrderData() {
    const orderId = localStorage.getItem('current_order_id');
    if (!orderId) return false;
    try {
        const snap = await database.ref(`orders/${orderId}`).once('value');
        const order = snap.val();
        if (!order || order.status !== 'waiting') return false;
        pickupCoord = [order.pickup_lng, order.pickup_lat];
        destCoord = [order.dest_lng, order.dest_lat];
        pickupAddress = order.pickup_address;
        destAddress = order.destination_address;
        if (order.via_lng && order.via_lat && order.via_address) {
            viaCoord = [order.via_lng, order.via_lat];
            viaAddress = order.via_address;
            document.getElementById('viaInput').value = viaAddress;
            document.getElementById('clearViaBtn').style.display = 'block';
            document.getElementById('viaAddressRow').style.display = 'flex';
            document.getElementById('routeVia').innerText = viaAddress;
        } else {
            viaCoord = null;
            viaAddress = '';
            document.getElementById('viaInput').value = '';
            document.getElementById('clearViaBtn').style.display = 'none';
            document.getElementById('viaAddressRow').style.display = 'none';
        }
        currentPrice = order.price;
        transportType = order.transport_type;
        transportIconUrl = getDriverIconUrl(transportType);
        initNegosiasi(currentPrice);

        document.getElementById('routeFrom').innerText = pickupAddress;
        document.getElementById('routeTo').innerText = destAddress;
        document.getElementById('routeDuration').innerText = order.duration_seconds ? Math.round(order.duration_seconds / 60) + ' menit' : '-';
        document.getElementById('routePrice').innerHTML = formatRupiah(order.price);
        document.getElementById('routeDetails').style.display = 'block';
        document.getElementById('cancelBtn').classList.add('show');
        document.getElementById('cancelBtn').innerText = '❌ Batalkan Perjalanan';
        document.getElementById('confirmBtn').disabled = false;
        document.getElementById('confirmBtn').innerHTML = `🚀 LANJUTKAN CARI DRIVER | ${formatRupiah(order.price)}`;
        currentOrderId = orderId;
        currentRoute = { distance: order.distance_meters, duration: order.duration_seconds, price: order.price };
        updateMarkers();
        document.getElementById('pickupInput').value = pickupAddress;
        document.getElementById('destInput').value = destAddress;
        document.getElementById('currentVehicleName').innerText = transportType || '-';

        if (map) {
            if (window.directionsRenderer) {
                window.directionsRenderer.setMap(null);
                window.directionsRenderer = null;
            }
            await updateRoute();
        }
        return true;
    } catch(err) { return false; }
}

// ==================== FETCH TRANSPORT DATA ====================
async function fetchTransportData() {
    try {
        const snapshot = await database.ref('data-jego/tarif').once('value');
        const firebaseData = snapshot.val();
        if (!firebaseData) throw new Error('data kosong');
        transportData = {};
        tariffRates = {};
        snapshot.forEach((child) => {
            const data = child.val();
            const transportName = data.nama;
            const internalName = transportNameMapping[transportName];
            if (internalName && data) {
                transportData[internalName] = {
                    name: data.nama,
                    capacity: data.capacity || "Kapasitas standar",
                    description: data.deskripsi || "Layanan terbaik JeGo",
                    icon: data.icon_url || "https://cdn-icons-png.flaticon.com/128/7890/7890227.png",
                    minimalDistance: data.minimal_distance || 4,
                    minimalPrice: data.minimal_price || 10000
                };
                tariffRates[internalName] = data.price_per_km || 2000;
            }
        });
        renderVehicleCards();
    } catch(error) {
        console.error('❌ Gagal fetch transport data:', error);
        loadFallbackData();
    }
}

function loadFallbackData() {
    transportData = {
        motor: { name: "Motor", capacity: "1 Penumpang", description: "Cepat dan lincah di jalan padat", icon: "https://cdn-icons-png.flaticon.com/128/5811/5811823.png", minimalDistance: 4, minimalPrice: 10000 },
        bentor: { name: "Bentor", capacity: "2 Penumpang", description: "Khas Gorontalo, nyaman dan stabil", icon: "https://cdn-icons-png.flaticon.com/128/7890/7890227.png", minimalDistance: 4, minimalPrice: 11000 },
        mobil: { name: "Mobil", capacity: "4 Penumpang + AC", description: "Nyaman untuk perjalanan grup", icon: "https://cdn-icons-png.flaticon.com/128/12689/12689302.png", minimalDistance: 4, minimalPrice: 15000 },
        kurir_motor: { name: "Kurir Motor", capacity: "Paket Kecil", description: "Pengiriman instan dalam kota", icon: "https://cdn-icons-png.flaticon.com/128/9561/9561688.png", minimalDistance: 4, minimalPrice: 10000 },
        kurir_bentor: { name: "Kurir Bentor", capacity: "Paket Sedang", description: "Kirim barang dengan kapasitas besar", icon: "https://cdn-icons-png.flaticon.com/128/7890/7890227.png", minimalDistance: 4, minimalPrice: 10000 }
    };
    tariffRates = { motor: 2200, bentor: 3000, mobil: 4000, kurir_motor: 2100, kurir_bentor: 2100 };
    renderVehicleCards();
}

function renderVehicleCards() {
    const container = document.getElementById('vehicleScroll');
    if (!container) return;
    container.innerHTML = '';
    const order = ['motor', 'bentor', 'mobil', 'kurir_motor', 'kurir_bentor'];
    order.forEach(type => {
        const t = transportData[type];
        if (t) {
            const card = document.createElement('div');
            card.className = 'vehicle-card';
            card.dataset.type = type;
            card.innerHTML = `
                <img src="${t.icon}" alt="${t.name}" loading="lazy">
                <div class="name">${t.name}</div>
                <div class="sub">${t.capacity}</div>
            `;
            card.addEventListener('click', () => showVehicleDetail(type));
            container.appendChild(card);
        }
    });
}

function showVehicleDetail(type) {
    const t = transportData[type];
    if (!t) return;
    selectedVehicleType = type;
    document.getElementById('detailName').innerText = t.name;
    document.getElementById('detailCap').innerText = t.capacity;
    document.getElementById('detailDesc').innerText = t.description;
    document.getElementById('detailPrice').style.display = 'none';
    document.getElementById('vehicleBottomSheet').classList.add('active');
    document.querySelectorAll('.vehicle-card').forEach(c => c.classList.remove('selected'));
    document.querySelector(`.vehicle-card[data-type="${type}"]`)?.classList.add('selected');
}

function selectVehicle(type) {
    const t = transportData[type];
    if (!t) return;
    const transportObj = {
        type: type,
        name: t.name,
        capacity: t.capacity,
        icon: t.icon,
        description: t.description,
        tariff: tariffRates[type],
        minimalDistance: t.minimalDistance,
        minimalPrice: t.minimalPrice
    };
    localStorage.setItem('jego_last_transport', JSON.stringify(transportObj));
    selectedTransport = transportObj;
    transportType = type;
    transportIconUrl = t.icon;
    transportRate = {
        minimal_distance: t.minimalDistance,
        minimal_price: t.minimalPrice,
        price_per_km: tariffRates[type]
    };
    isCourier = type.toLowerCase().includes('kurir');
    document.getElementById('currentVehicleName').innerText = t.name;
    closeVehicleOverlay();
    if (pickupCoord && destCoord) updateRoute();
    showToast(`✅ Kendaraan ${t.name} dipilih`, 'success');
}

// ==================== OVERLAY KENDARAAN ====================
function openVehicleOverlay() {
    document.getElementById('vehicleOverlay').classList.add('active');
    document.getElementById('vehicleBottomSheet').classList.remove('active');
    document.querySelectorAll('.vehicle-card').forEach(c => c.classList.remove('selected'));
    if (selectedVehicleType) {
        document.querySelector(`.vehicle-card[data-type="${selectedVehicleType}"]`)?.classList.add('selected');
    }
}

function closeVehicleOverlay() {
    document.getElementById('vehicleOverlay').classList.remove('active');
    document.getElementById('vehicleBottomSheet').classList.remove('active');
}

// ==================== SESSION & TRANSPORT ====================
async function checkUserSession() {
    return new Promise((resolve, reject) => {
        const unsubscribe = auth.onAuthStateChanged(async (user) => {
            unsubscribe();
            if (!user) { showPopup('Akses Ditolak', 'Anda belum login.', () => window.location.href = 'loginUser.html'); reject(false); return; }
            try {
                const uid = user.uid;
                const snapshot = await database.ref(`users/${uid}`).once('value');
                const data = snapshot.val();
                if (!data) throw new Error();
                currentUser = { id: uid, name: data.name, phone: data.phone, email: data.email, rating: data.rating || 5, perjalanan: data.perjalanan || 0, photoURL: data.photoURL || '' };
                console.log('✅ User session valid:', currentUser.name);
                resolve(true);
            } catch(err) {
                showPopup('Sesi Tidak Valid', 'Silakan login ulang.', () => window.location.href = 'loginUser.html');
                reject(false);
            }
        });
    });
}

async function loadSelectedTransport() {
    const lastTransport = localStorage.getItem('jego_last_transport');
    if (!lastTransport) {
        openVehicleOverlay();
        return false;
    }
    try {
        selectedTransport = JSON.parse(lastTransport);
        transportType = selectedTransport.type;
        isCourier = transportType && transportType.toLowerCase().includes('kurir');
        transportRate = {
            minimal_distance: selectedTransport.minimalDistance,
            minimal_price: selectedTransport.minimalPrice,
            price_per_km: selectedTransport.tariff
        };
        transportIconUrl = selectedTransport.icon || getDriverIconUrl(transportType);
        document.getElementById('currentVehicleName').innerText = selectedTransport.name || transportType;
        if (isCourier && selectedTransport.deliveryData) {
            deliveryData = selectedTransport.deliveryData;
            document.getElementById('deliveryInfoPanel').style.display = 'block';
            document.getElementById('deliveryItemCategory').innerText = deliveryData.itemCategory || '-';
            document.getElementById('deliveryDescription').innerText = deliveryData.description || '-';
            document.getElementById('deliverySender').innerText = deliveryData.senderPhone || '-';
            document.getElementById('deliveryReceiver').innerText = deliveryData.receiverPhone || '-';
        } else if (isCourier && !selectedTransport.deliveryData) {
            showPopup('Data Kurir Tidak Lengkap', 'Silakan pilih kendaraan lagi.', () => { openVehicleOverlay(); });
            return false;
        }
        return true;
    } catch(e) {
        showPopup('Error', 'Gagal memuat data transportasi');
        return false;
    }
}

// ==================== PETA & RUTE ====================
function getFullAddress(feature) {
    const name = feature.properties?.name;
    const fullAddress = feature.properties?.full_address || feature.properties?.address || '';
    if (name && name.trim()) {
        if (fullAddress.toLowerCase().includes(name.toLowerCase())) return fullAddress;
        return `${name}, ${fullAddress}`;
    }
    return fullAddress;
}

function initMap() {
    console.log('🗺️ initMap() dipanggil oleh Google Maps API');
    const isDark = localStorage.getItem('jego_dark_mode') === 'true';
    const mapOptions = {
        center: { lat: 0.5435, lng: 123.0580 },
        zoom: 12,
        mapTypeId: 'roadmap',
        styles: isDark ? darkMapStyle : [],
        zoomControl: true,
        zoomControlOptions: { position: google.maps.ControlPosition.TOP_RIGHT },
        fullscreenControl: true,
        fullscreenControlOptions: { position: google.maps.ControlPosition.TOP_RIGHT }
    };
    map = new google.maps.Map(document.getElementById('map'), mapOptions);
    console.log('✅ Google Maps berhasil diinisialisasi');

    geocoder = new google.maps.Geocoder();
    directionsService = new google.maps.DirectionsService();
    directionsRenderer = new google.maps.DirectionsRenderer({
        map: map,
        suppressMarkers: true,
        polylineOptions: {
            strokeColor: '#FF9800',
            strokeWeight: 5,
            strokeOpacity: 0.8
        }
    });
    window.directionsRenderer = directionsRenderer;

    map.addListener('click', async (e) => {
        if (!pickFromMapActive) return;
        pickFromMapActive = false;
        const lat = e.latLng.lat();
        const lng = e.latLng.lng();
        let address = await reverseGeocode(lng, lat);
        if (!address || address.trim() === '') address = '(Titik di peta)';
        const feature = { geometry: { coordinates: [lng, lat] }, properties: { full_address: address, name: address.split(',')[0] } };
        selectAddress(feature);
        showToast('📍 Lokasi dipilih dari peta', 'success');
    });

    initAutocompleteService();
    window.initMapDone = true;
}

function initAutocompleteService() {
    if (!autocompleteService && google.maps && google.maps.places) {
        try {
            autocompleteService = new google.maps.places.AutocompleteService();
            console.log('✅ AutocompleteService initialized');
        } catch (e) {
            console.warn('⚠️ Gagal init AutocompleteService:', e);
            autocompleteService = null;
        }
    }
}

function reverseGeocode(lng, lat) {
    console.log(`🔍 reverseGeocode: lng=${lng}, lat=${lat}`);
    return new Promise((resolve) => {
        if (!geocoder) {
            geocoder = new google.maps.Geocoder();
        }
        geocoder.geocode({
            location: { lat: lat, lng: lng },
            language: 'id'
        }, (results, status) => {
            console.log(`📥 Geocoding status: ${status}`);
            if (status === 'OK' && results.length > 0) {
                let address = results[0].formatted_address;
                address = address.replace(', Indonesia', '');
                console.log(`✅ reverseGeocode success: ${address}`);
                resolve(address);
            } else if (status === 'REQUEST_DENIED') {
                console.error('❌ API Key tidak memiliki akses ke Geocoding API. Aktifkan di Google Cloud Console.');
                showToast('⚠️ API Geocoding tidak aktif', 'error');
                resolve(null);
            } else {
                console.warn(`⚠️ Geocoding status: ${status}`);
                resolve(null);
            }
        });
    });
}

// ==================== SEARCH ADDRESS ====================
function searchAddress(keyword) {
    console.log(`🔍 searchAddress() dipanggil dengan keyword: "${keyword}"`);
    if (searchAbortController) {
        searchAbortController.abort();
        searchAbortController = null;
    }

    const trimmedKeyword = keyword.trim();
    if (trimmedKeyword.length < 3) {
        console.log('⚠️ Minimal 3 karakter');
        document.getElementById('searchResultList').style.display = 'none';
        document.getElementById('searchDefaultOptions').style.display = 'block';
        document.getElementById('searchLoading').style.display = 'none';
        return;
    }

    document.getElementById('searchDefaultOptions').style.display = 'none';
    document.getElementById('searchResultList').style.display = 'none';
    document.getElementById('searchLoading').style.display = 'block';

    const cacheKey = trimmedKeyword.toLowerCase();
    if (searchCache[cacheKey]) {
        console.log('📦 Pakai cache untuk:', trimmedKeyword);
        const cached = searchCache[cacheKey];
        renderSearchResults(cached);
        return;
    }

    searchAbortController = new AbortController();

    if (!autocompleteService) {
        initAutocompleteService();
    }

    if (autocompleteService && typeof autocompleteService.getPlacePredictions === 'function') {
        const request = {
            input: trimmedKeyword,
            language: 'id',
            componentRestrictions: { country: 'id' },
            locationBias: {
                east: 123.5,
                west: 122.5,
                north: 1.0,
                south: 0.0
            }
        };

        const timeoutId = setTimeout(() => {
            if (searchAbortController) {
                searchAbortController.abort();
                searchAbortController = null;
            }
            document.getElementById('searchLoading').style.display = 'none';
            const resultList = document.getElementById('searchResultList');
            resultList.style.display = 'block';
            resultList.innerHTML = '<div style="text-align:center;padding:20px;color:#f44336;">⏱️ Pencarian terlalu lama, coba kata kunci lain.</div>';
        }, 5000);

        autocompleteService.getPlacePredictions(request, (predictions, status) => {
            clearTimeout(timeoutId);
            if (searchAbortController && searchAbortController.signal.aborted) {
                console.log('⏹️ Pencarian dibatalkan');
                return;
            }
            searchAbortController = null;
            document.getElementById('searchLoading').style.display = 'none';

            if (status === 'OK' && predictions && predictions.length > 0) {
                console.log(`✅ Ditemukan ${predictions.length} prediksi di Gorontalo`);
                const gorontaloResults = predictions.filter(p =>
                    p.description && p.description.toLowerCase().includes('gorontalo')
                );
                if (gorontaloResults.length === 0) {
                    const resultList = document.getElementById('searchResultList');
                    resultList.style.display = 'block';
                    resultList.innerHTML = '<div style="text-align:center;padding:20px;color:#999;">🔍 Tidak ditemukan di Gorontalo. Coba kata kunci lain.</div>';
                    return;
                }
                searchCache[cacheKey] = gorontaloResults;
                renderSearchResults(gorontaloResults);
            } else {
                console.warn('⚠️ Places Autocomplete gagal, status:', status);
                searchAddressFallback(trimmedKeyword);
            }
        });
    } else {
        searchAddressFallback(trimmedKeyword);
    }
}

function renderSearchResults(predictions) {
    const resultList = document.getElementById('searchResultList');
    resultList.innerHTML = '';
    resultList.style.display = 'block';

    const topResults = predictions.slice(0, 8);
    topResults.forEach(prediction => {
        const item = document.createElement('div');
        item.className = 'search-option-item';
        const mainText = prediction.structured_formatting?.main_text || prediction.description;
        const secondaryText = prediction.structured_formatting?.secondary_text || '';
        let display = mainText;
        if (secondaryText && !mainText.includes(secondaryText)) {
            display = mainText + ', ' + secondaryText;
        } else if (!mainText) {
            display = prediction.description;
        }
        const badge = ' <span style="font-size:10px;color:#FF9800;font-weight:bold;">📍 Gorontalo</span>';

        item.innerHTML = `<div class="search-option-icon result">📍</div><div class="search-option-text">${escapeHtml(display)}${badge}</div>`;
        item.addEventListener('click', () => {
            const placeId = prediction.place_id;
            getPlaceDetails(placeId);
        });
        resultList.appendChild(item);
    });
}

function getPlaceDetails(placeId) {
    if (placeDetailsCache[placeId]) {
        console.log('📦 Pakai cache detail untuk:', placeId);
        const cached = placeDetailsCache[placeId];
        const feature = {
            geometry: { coordinates: [cached.lng, cached.lat] },
            properties: { full_address: cached.address, name: cached.name }
        };
        selectAddress(feature);
        return;
    }

    showToast('🔍 Mengambil detail lokasi...', 'info');
    const service = new google.maps.places.PlacesService(document.createElement('div'));
    service.getDetails({
        placeId: placeId,
        fields: ['geometry', 'formatted_address', 'name']
    }, (place, status) => {
        if (status === 'OK' && place && place.geometry) {
            const lat = place.geometry.location.lat();
            const lng = place.geometry.location.lng();
            let address = place.formatted_address || place.name || '';
            address = address.replace(', Indonesia', '');
            placeDetailsCache[placeId] = {
                lat: lat,
                lng: lng,
                address: address,
                name: place.name || address.split(',')[0]
            };
            const feature = {
                geometry: { coordinates: [lng, lat] },
                properties: { full_address: address, name: place.name || address.split(',')[0] }
            };
            selectAddress(feature);
        } else {
            showToast('❌ Gagal mengambil detail lokasi', 'error');
        }
    });
}

function searchAddressFallback(keyword) {
    console.log('📍 searchAddressFallback dipanggil untuk:', keyword);
    if (!geocoder) {
        geocoder = new google.maps.Geocoder();
    }

    const gorontaloBounds = {
        east: 123.5,
        west: 122.5,
        north: 1.0,
        south: 0.0
    };

    const timeoutId = setTimeout(() => {
        document.getElementById('searchLoading').style.display = 'none';
        const resultList = document.getElementById('searchResultList');
        resultList.style.display = 'block';
        resultList.innerHTML = '<div style="text-align:center;padding:20px;color:#f44336;">⏱️ Pencarian terlalu lama, coba lagi.</div>';
    }, 5000);

    geocoder.geocode({
        address: keyword + ', Gorontalo, Indonesia',
        language: 'id',
        region: 'ID',
        bounds: gorontaloBounds
    }, (results, status) => {
        clearTimeout(timeoutId);
        document.getElementById('searchLoading').style.display = 'none';
        const resultList = document.getElementById('searchResultList');
        resultList.innerHTML = '';

        if (status === 'OK' && results && results.length > 0) {
            console.log(`✅ Geocoding fallback ditemukan ${results.length} hasil di Gorontalo`);
            resultList.style.display = 'block';

            const gorontaloResults = results.filter(r => {
                const addr = r.formatted_address.toLowerCase();
                return addr.includes('gorontalo');
            });

            const finalResults = gorontaloResults.length > 0 ? gorontaloResults : results;
            finalResults.slice(0, 8).forEach(result => {
                const item = document.createElement('div');
                item.className = 'search-option-item';
                const display = result.formatted_address.replace(', Indonesia', '');
                const badge = ' <span style="font-size:10px;color:#FF9800;font-weight:bold;">📍 Gorontalo</span>';

                item.innerHTML = `<div class="search-option-icon result">📍</div><div class="search-option-text">${escapeHtml(display)}${badge}</div>`;
                item.addEventListener('click', () => {
                    const lat = result.geometry.location.lat();
                    const lng = result.geometry.location.lng();
                    const feature = {
                        geometry: { coordinates: [lng, lat] },
                        properties: { full_address: display, name: display.split(',')[0] }
                    };
                    selectAddress(feature);
                });
                resultList.appendChild(item);
            });
        } else {
            resultList.style.display = 'block';
            resultList.innerHTML = '<div style="text-align:center;padding:20px;color:#999;">🔍 Tidak ditemukan di Gorontalo. Coba kata kunci lain.</div>';
        }
    });
}

// ==================== SELECT ADDRESS ====================
function selectAddress(feature) {
    const coords = feature.geometry.coordinates;
    const address = getFullAddress(feature);
    console.log(`📍 selectAddress: ${address} (${coords[0]}, ${coords[1]})`);
    addSearchHistory(address, coords[0], coords[1]);

    if (searchOverlayMode === 'pickup') {
        pickupCoord = [coords[0], coords[1]];
        pickupAddress = address;
        document.getElementById('pickupInput').value = pickupAddress;
        updateMarkers();
        if (map) {
            map.setCenter({ lat: coords[1], lng: coords[0] });
            map.setZoom(15);
        }
    } else if (searchOverlayMode === 'via') {
        viaCoord = [coords[0], coords[1]];
        viaAddress = address;
        document.getElementById('viaInput').value = viaAddress;
        document.getElementById('clearViaBtn').style.display = 'block';
        updateMarkers();
    } else {
        destCoord = [coords[0], coords[1]];
        destAddress = address;
        document.getElementById('destInput').value = destAddress;
    }

    if (pickupCoord && destCoord) updateRoute();
    closeSearchOverlay();
    closeVehicleOverlay();
}

// ==================== AUTO FILL PICKUP ====================
async function autoFillPickupLocation() {
    console.log('📍 autoFillPickupLocation() dipanggil');

    const pickupInput = document.getElementById('pickupInput');
    const originalPlaceholder = pickupInput.placeholder;
    pickupInput.placeholder = '⏳ Mendeteksi lokasi Anda...';
    pickupInput.style.color = '#999';

    return new Promise((resolve) => {
        if (!navigator.geolocation) {
            console.warn('⚠️ Geolokasi tidak didukung');
            pickupInput.placeholder = originalPlaceholder;
            pickupInput.style.color = '';
            resolve(false);
            return;
        }

        navigator.geolocation.getCurrentPosition(async (position) => {
            const { latitude, longitude } = position.coords;
            console.log(`📍 Lokasi pengguna: ${latitude}, ${longitude}`);

            pickupInput.placeholder = '⏳ Mengambil alamat...';

            let address = await reverseGeocode(longitude, latitude);
            if (!address || address.trim() === '') address = '(Jalan Tanpa Nama)';

            pickupCoord = [longitude, latitude];
            pickupAddress = address;
            pickupInput.value = pickupAddress;
            pickupInput.placeholder = originalPlaceholder;
            pickupInput.style.color = '';

            updateMarkers();
            if (map) {
                map.setCenter({ lat: latitude, lng: longitude });
                map.setZoom(14);
            }
            if (destCoord) await updateRoute();

            showToast('✅ Lokasi Anda digunakan sebagai titik penjemputan', 'success');
            resolve(true);

        }, () => {
            console.warn('⚠️ Gagal mendapatkan lokasi');
            pickupInput.placeholder = originalPlaceholder;
            pickupInput.style.color = '';
            showToast('⚠️ Gagal mendeteksi lokasi, silakan pilih manual', 'error');
            resolve(false);
        }, { enableHighAccuracy: true, timeout: 10000 });
    });
}

// ==================== UPDATE MARKERS ====================
function updateMarkers() {
    if (pickupMarker) { pickupMarker.setMap(null); pickupMarker = null; }
    if (destMarker) { destMarker.setMap(null); destMarker = null; }
    if (viaMarker) { viaMarker.setMap(null); viaMarker = null; }

    if (pickupCoord) {
        const iconUrl = transportIconUrl || 'https://cdn-icons-png.flaticon.com/128/5811/5811823.png';
        pickupMarker = new google.maps.Marker({
            position: { lat: pickupCoord[1], lng: pickupCoord[0] },
            map: map,
            icon: {
                url: iconUrl,
                scaledSize: new google.maps.Size(35, 35),
                anchor: new google.maps.Point(17, 17)
            },
            title: 'Penjemputan'
        });
    }

    if (destCoord) {
        destMarker = new google.maps.Marker({
            position: { lat: destCoord[1], lng: destCoord[0] },
            map: map,
            icon: {
                url: 'https://maps.google.com/mapfiles/ms/icons/red-dot.png',
                scaledSize: new google.maps.Size(32, 32)
            },
            title: 'Tujuan'
        });
    }

    if (viaCoord) {
        viaMarker = new google.maps.Marker({
            position: { lat: viaCoord[1], lng: viaCoord[0] },
            map: map,
            icon: {
                url: 'https://maps.google.com/mapfiles/ms/icons/blue-dot.png',
                scaledSize: new google.maps.Size(30, 30)
            },
            title: 'Titik Singgah'
        });
    }
}

// ==================== UPDATE ROUTE ====================
async function updateRoute() {
    console.log('🛣️ updateRoute() dipanggil');
    if (!pickupCoord || !destCoord) {
        console.warn('⚠️ updateRoute: pickup atau dest belum ada');
        return;
    }

    if (window.directionsRenderer) {
        window.directionsRenderer.setMap(null);
        window.directionsRenderer = null;
    }

    try {
        const waypoints = [];
        if (viaCoord && viaCoord.length === 2) {
            waypoints.push({
                location: { lat: viaCoord[1], lng: viaCoord[0] },
                stopover: true
            });
        }

        if (!directionsService) {
            directionsService = new google.maps.DirectionsService();
        }

        const request = {
            origin: { lat: pickupCoord[1], lng: pickupCoord[0] },
            destination: { lat: destCoord[1], lng: destCoord[0] },
            waypoints: waypoints,
            travelMode: google.maps.TravelMode.DRIVING,
            language: 'id'
        };

        console.log('📤 Request Directions:', request);

        const result = await new Promise((resolve, reject) => {
            directionsService.route(request, (response, status) => {
                if (status === google.maps.DirectionsStatus.OK) {
                    resolve(response);
                } else {
                    reject(new Error(status));
                }
            });
        });

        const route = result.routes[0];
        const leg = route.legs[0];
        const distanceMeters = leg.distance.value;
        const durationSeconds = leg.duration.value;
        const price = calculatePrice(distanceMeters);
        currentPrice = price;
        initNegosiasi(price);

        currentRoute = { distance: distanceMeters, duration: durationSeconds, price: price };

        document.getElementById('routeFrom').innerText = pickupAddress;
        document.getElementById('routeTo').innerText = destAddress;
        if (viaAddress && viaCoord) {
            document.getElementById('viaAddressRow').style.display = 'flex';
            document.getElementById('routeVia').innerText = viaAddress;
        } else {
            document.getElementById('viaAddressRow').style.display = 'none';
        }
        document.getElementById('routeDuration').innerText = Math.round(durationSeconds / 60) + ' menit';
        document.getElementById('routePrice').innerHTML = formatRupiah(price);
        document.getElementById('routeDetails').style.display = 'block';
        document.getElementById('confirmBtn').disabled = false;
        document.getElementById('confirmBtn').innerHTML = `🚀 CARI DRIVER | ${formatRupiah(price)}`;

        const directionsRenderer = new google.maps.DirectionsRenderer({
            map: map,
            suppressMarkers: true,
            polylineOptions: {
                strokeColor: '#FF9800',
                strokeWeight: 5
            }
        });
        window.directionsRenderer = directionsRenderer;
        directionsRenderer.setDirections(result);

        updateMarkers();

        const bounds = new google.maps.LatLngBounds();
        bounds.extend(new google.maps.LatLng(pickupCoord[1], pickupCoord[0]));
        bounds.extend(new google.maps.LatLng(destCoord[1], destCoord[0]));
        if (viaCoord) bounds.extend(new google.maps.LatLng(viaCoord[1], viaCoord[0]));
        map.fitBounds(bounds, { top: 160, bottom: 220, left: 50, right: 50 });

        console.log('✅ Rute berhasil digambar');
    } catch(err) {
        console.error('❌ updateRoute error:', err);
        showPopup('Error', 'Gagal menghitung rute.');
    }
}

// ==================== OVERLAY PENCARIAN ====================
function openSearchOverlay(type) {
    console.log(`🔍 openSearchOverlay: ${type}`);
    closeVehicleOverlay();
    searchOverlayMode = type;
    const overlay = document.getElementById('searchOverlay');
    const input = document.getElementById('searchOverlayInput');
    const clearBtn = document.getElementById('searchOverlayClear');
    const defaultOptions = document.getElementById('searchDefaultOptions');
    const resultList = document.getElementById('searchResultList');
    const loading = document.getElementById('searchLoading');
    input.value = '';
    clearBtn.classList.remove('visible');
    defaultOptions.style.display = 'block';
    resultList.style.display = 'none';
    resultList.innerHTML = '';
    loading.style.display = 'none';
    renderHistoryList();
    if (type === 'pickup') input.placeholder = 'Cari lokasi penjemputan...';
    else if (type === 'destination') input.placeholder = 'Cari lokasi tujuan...';
    else input.placeholder = 'Cari titik singgah (opsional)...';
    overlay.classList.add('active');
    setTimeout(() => { input.focus(); }, 350);
    initAutocompleteService();
}

function closeSearchOverlay() {
    document.getElementById('searchOverlay').classList.remove('active');
    pickFromMapActive = false;
    if (searchTimeout) clearTimeout(searchTimeout);
}

function useCurrentLocation() {
    closeVehicleOverlay();
    if (!navigator.geolocation) { showToast('⚠️ Geolokasi tidak didukung', 'error'); return; }
    showToast('📍 Mendapatkan lokasi...', 'info');
    navigator.geolocation.getCurrentPosition(async (position) => {
        const { latitude, longitude } = position.coords;
        let address = await reverseGeocode(longitude, latitude);
        if (!address || address.trim() === '') address = '(Lokasi Anda)';
        const feature = { geometry: { coordinates: [longitude, latitude] }, properties: { full_address: address, name: '' } };
        selectAddress(feature);
        showToast('✅ Lokasi Anda digunakan', 'success');
    }, () => { showToast('❌ Gagal mendapatkan lokasi', 'error'); }, { enableHighAccuracy: true, timeout: 10000 });
}

// ==================== FITUR PILIH DI PETA ====================
function pickFromMap() {
    closeSearchOverlay();
    closeVehicleOverlay();
    // Sembunyikan bottom sheet detail rute
    document.getElementById('routeDetails').style.display = 'none';

    if (!map) return;

    mapPickActive = true;
    mapPickCoords = null;
    mapPickAddress = '';

    if (mapIdleTimer) {
        clearTimeout(mapIdleTimer);
        mapIdleTimer = null;
    }

    const pinContainer = document.getElementById('mapCenterPin');
    pinContainer.classList.add('active');

    const pinAddress = document.getElementById('pinAddress');
    pinAddress.textContent = '📍 Geser peta untuk memilih lokasi';
    pinAddress.classList.remove('loading');

    document.getElementById('pinActions').style.display = 'flex';

    const useBtn = document.getElementById('useMapPickBtn');
    useBtn.textContent = '📍 Pilih Lokasi';
    useBtn.className = 'pin-action-btn primary';

    const center = map.getCenter();
    mapPickCoords = [center.lng(), center.lat()];

    reverseGeocode(mapPickCoords[0], mapPickCoords[1]).then(address => {
        if (!mapPickActive) return;
        mapPickAddress = address || '(Alamat tidak ditemukan)';
        if (mapPickAddress && mapPickAddress !== '(Alamat tidak ditemukan)') {
            const streetName = mapPickAddress.split(',')[0] || mapPickAddress;
            pinAddress.textContent = `📍 ${streetName}`;
            useBtn.textContent = '✅ Ok';
            useBtn.className = 'pin-action-btn success';
        } else {
            pinAddress.textContent = '📍 Lokasi tidak dikenal';
        }
    });

    google.maps.event.clearListeners(map, 'dragstart');
    google.maps.event.clearListeners(map, 'dragend');
    map.addListener('dragstart', onMapMoveStart);
    map.addListener('dragend', onMapMoveEnd);

    pickFromMapActive = false;
    showToast('📍 Geser peta, lalu klik "Ok" untuk memilih', 'info');
}

function onMapMoveStart() {
    if (!mapPickActive) {
        document.getElementById('pinActions').style.display = 'none';
        return;
    }

    document.getElementById('pinActions').style.display = 'none';

    const pinAddress = document.getElementById('pinAddress');
    pinAddress.textContent = '⏳ Memuat alamat...';
    pinAddress.classList.add('loading');

    if (mapIdleTimer) {
        clearTimeout(mapIdleTimer);
        mapIdleTimer = null;
    }

    const pinContainer = document.getElementById('mapCenterPin');
    if (pinContainer) pinContainer.classList.add('dragging');

    const useBtn = document.getElementById('useMapPickBtn');
    useBtn.textContent = '📍 Memuat...';
}

function onMapMoveEnd() {
    if (!mapPickActive) {
        document.getElementById('pinActions').style.display = 'none';
        return;
    }

    const pinContainer = document.getElementById('mapCenterPin');
    if (pinContainer) {
        pinContainer.classList.remove('dragging');
        void pinContainer.offsetWidth;
        pinContainer.classList.remove('active');
        void pinContainer.offsetWidth;
        pinContainer.classList.add('active');
    }

    const center = map.getCenter();
    mapPickCoords = [center.lng(), center.lat()];

    if (mapIdleTimer) {
        clearTimeout(mapIdleTimer);
        mapIdleTimer = null;
    }

    mapIdleTimer = setTimeout(async () => {
        if (!mapPickActive) return;

        const address = await reverseGeocode(mapPickCoords[0], mapPickCoords[1]);
        mapPickAddress = address || '(Alamat tidak ditemukan)';

        const pinAddress = document.getElementById('pinAddress');
        const useBtn = document.getElementById('useMapPickBtn');

        if (mapPickAddress && mapPickAddress !== '(Alamat tidak ditemukan)') {
            const streetName = mapPickAddress.split(',')[0] || mapPickAddress;
            pinAddress.textContent = `📍 ${streetName}`;
            pinAddress.classList.remove('loading');
            useBtn.textContent = '✅ Ok';
            useBtn.className = 'pin-action-btn success';
        } else {
            pinAddress.textContent = '📍 Lokasi tidak dikenal';
            pinAddress.classList.remove('loading');
            useBtn.textContent = '📍 Pilih Lokasi';
            useBtn.className = 'pin-action-btn primary';
        }

        document.getElementById('pinActions').style.display = 'flex';
        mapIdleTimer = null;
    }, 3000);
}

function confirmMapPick() {
    if (!mapPickActive) {
        showToast('❌ Mode pilih peta tidak aktif', 'error');
        return;
    }

    if (!mapPickCoords) {
        showToast('❌ Pilih lokasi terlebih dahulu', 'error');
        return;
    }

    if (!mapPickAddress || mapPickAddress === '(Alamat tidak ditemukan)') {
        showToast('⏳ Mengambil alamat...', 'info');
        reverseGeocode(mapPickCoords[0], mapPickCoords[1]).then(address => {
            if (!mapPickActive) return;
            mapPickAddress = address || '(Alamat tidak ditemukan)';
            if (mapPickAddress && mapPickAddress !== '(Alamat tidak ditemukan)') {
                const feature = {
                    geometry: { coordinates: mapPickCoords },
                    properties: { full_address: mapPickAddress, name: mapPickAddress.split(',')[0] }
                };
                selectAddress(feature);
                cancelMapPick();
            } else {
                showToast('❌ Gagal mengambil alamat', 'error');
            }
        });
        return;
    }

    const [lng, lat] = mapPickCoords;
    const feature = {
        geometry: { coordinates: [lng, lat] },
        properties: { full_address: mapPickAddress, name: mapPickAddress.split(',')[0] }
    };
    selectAddress(feature);
    cancelMapPick();
}

function cancelMapPick() {
    mapPickActive = false;

    const pinContainer = document.getElementById('mapCenterPin');
    pinContainer.classList.remove('active', 'dragging');

    document.getElementById('pinActions').style.display = 'none';

    const pinAddress = document.getElementById('pinAddress');
    pinAddress.textContent = '📍 Pilih lokasi di peta';
    pinAddress.classList.remove('loading');

    google.maps.event.clearListeners(map, 'dragstart');
    google.maps.event.clearListeners(map, 'dragend');

    if (mapPickResolveTimer) {
        clearTimeout(mapPickResolveTimer);
        mapPickResolveTimer = null;
    }
    if (mapIdleTimer) {
        clearTimeout(mapIdleTimer);
        mapIdleTimer = null;
    }

    mapPickCoords = null;
    mapPickAddress = '';

    const useBtn = document.getElementById('useMapPickBtn');
    useBtn.textContent = '📍 Pilih Lokasi';
    useBtn.className = 'pin-action-btn primary';
}

function clearViaPoint() {
    if (viaCoord) {
        viaCoord = null;
        viaAddress = '';
        document.getElementById('viaInput').value = '';
        document.getElementById('clearViaBtn').style.display = 'none';
        if (viaMarker) { viaMarker.setMap(null); viaMarker = null; }
        if (pickupCoord && destCoord) updateRoute();
        showToast('🗑️ Titik singgah dihapus', 'info');
    }
}

// ==================== RADAR ====================
function startSlowZoomOut() {}
function stopSlowZoomOut() {}

function activateRadarOnPickup() {
    if (pickupMarker) {
        pickupMarker.setIcon({
            url: 'https://cdn-icons-png.flaticon.com/128/5811/5811823.png',
            scaledSize: new google.maps.Size(45, 45),
            anchor: new google.maps.Point(22, 22)
        });
    }
}

function deactivateRadarOnPickup() {
    if (pickupMarker) {
        const iconUrl = transportIconUrl || 'https://cdn-icons-png.flaticon.com/128/5811/5811823.png';
        pickupMarker.setIcon({
            url: iconUrl,
            scaledSize: new google.maps.Size(35, 35),
            anchor: new google.maps.Point(17, 17)
        });
    }
}

// ==================== ORDER & OFFERS ====================
function renderOffers(offers) {
    const container = document.getElementById('driverOfferList');
    if (!container) return;
    if (!offers || Object.keys(offers).length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:16px;">⏳ Driver akan tampil disini, sedang mencari driver terdekat. Mohon tunggu...</div>';
        return;
    }
    container.innerHTML = '';
    Object.entries(offers).forEach(([driverId, offer]) => {
        const isProcessed = offer.status === 'accepted' || offer.status === 'rejected';
        let bidPriceText = '';
        if (offer.bid_price && offer.bid_price > 0 && offer.bid_requested === true) {
            bidPriceText = `<div class="bid-price-text">💰 Menawar: ${formatRupiah(offer.bid_price)}</div>`;
        }

        let timerHtml = '';
        if (!isProcessed && offer.expired_at) {
            const remaining = Math.max(0, offer.expired_at - Date.now());
            const total = 30000;
            const percent = (remaining / total) * 100;
            timerHtml = `
                <div class="offer-progress-wrapper">
                    <div class="offer-progress-bar" data-expired="${offer.expired_at}" style="transform: scaleX(${Math.min(1, Math.max(0, percent/100))});"></div>
                </div>
            `;
        }

        const card = document.createElement('div');
        card.className = 'driver-offer-card';
        if (offer.expired_at) card.setAttribute('data-expired', offer.expired_at);
        card.innerHTML = `
            <div class="driver-info">
                <img class="driver-photo" src="${offer.driver_photo || 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png'}">
                <div class="driver-details">
                    <div class="driver-name">${escapeHtml(offer.driver_name)}</div>
                    <div class="driver-vehicle">${offer.driver_type || transportType}</div>
                    <div>⭐ ${offer.driver_rating ? parseFloat(offer.driver_rating).toFixed(1) : 5} (${offer.driver_trips || 0} trip)</div>
                    ${bidPriceText}
                    ${timerHtml}
                </div>
            </div>
            <div class="driver-action-buttons">
                ${!isProcessed ? `<button class="accept-btn" data-driver="${driverId}">✅ Terima</button><button class="reject-btn" data-driver="${driverId}">❌ Tolak</button>` : `<span>${offer.status === 'accepted' ? '✓ Diterima' : '✗ Ditolak'}</span>`}
            </div>
        `;
        container.appendChild(card);
    });
    document.querySelectorAll('.accept-btn').forEach(btn => btn.addEventListener('click', () => acceptOffer(btn.getAttribute('data-driver'))));
    document.querySelectorAll('.reject-btn').forEach(btn => btn.addEventListener('click', () => rejectOffer(btn.getAttribute('data-driver'))));
}

function updateOfferTimers() {
    const now = Date.now();
    document.querySelectorAll('.driver-offer-card').forEach(card => {
        const expiredAt = parseInt(card.getAttribute('data-expired'), 10);
        if (!expiredAt) return;
        const progressBar = card.querySelector('.offer-progress-bar');
        if (progressBar) {
            const remaining = Math.max(0, expiredAt - now);
            const total = 30000;
            let percent = (remaining / total);
            percent = Math.min(1, Math.max(0, percent));
            progressBar.style.transform = `scaleX(${percent})`;
        }
    });
}

async function cleanupExpiredOffersCustomer() {
    if (!currentOrderId) return false;
    try {
        const orderSnap = await database.ref(`orders/${currentOrderId}`).once('value');
        const order = orderSnap.val();
        if (!order || order.status !== 'waiting') return false;
        const offers = order.driver_offers || {};
        const now = Date.now();
        let removedCount = 0;
        for (const [driverId, offer] of Object.entries(offers)) {
            if (offer.status === 'offered' && offer.expired_at && offer.expired_at < now) {
                await database.ref(`orders/${currentOrderId}/driver_offers/${driverId}`).remove();
                removedCount++;
            }
        }
        if (removedCount > 0) {
            const freshSnap = await database.ref(`orders/${currentOrderId}/driver_offers`).once('value');
            renderOffers(freshSnap.val());
            showToast(`⏰ ${removedCount} penawaran kadaluarsa, diperbarui`, 'warning');
        }
        return removedCount > 0;
    } catch (err) {
        console.error('Gagal membersihkan offer expired:', err);
        return false;
    }
}

async function acceptOffer(driverId) {
    let orderIdToUse = currentOrderId;
    if (!orderIdToUse || orderIdToUse === 'null') {
        orderIdToUse = localStorage.getItem('current_order_id');
    }
    if (!orderIdToUse || orderIdToUse === 'null') {
        showToast('❌ ID order tidak valid', 'error');
        return;
    }

    const offerSnap = await database.ref(`orders/${orderIdToUse}/driver_offers/${driverId}`).once('value');
    const offerData = offerSnap.val();
    let updateData = { status: 'accepted', driver_id: driverId, accepted_at: new Date().toISOString() };
    if (offerData && offerData.bid_price && offerData.bid_price > 0 && offerData.bid_requested === true) {
        updateData.price = offerData.bid_price;
    }
    await database.ref(`orders/${orderIdToUse}/driver_offers/${driverId}/status`).set('accepted');
    await database.ref(`orders/${orderIdToUse}`).update(updateData);
    localStorage.setItem('current_order_id', orderIdToUse);
    showToast('✅ Driver dipilih, mengalihkan...', 'success');
    if (orderIdToUse && orderIdToUse !== 'null') {
        setTimeout(() => { window.location.href = `tracking_customer.html?order_id=${orderIdToUse}`; }, 1000);
    } else {
        showToast('❌ ID order tidak valid, tidak bisa redirect ke tracking', 'error');
    }
}

async function rejectOffer(driverId) {
    if (!currentOrderId) return;
    await database.ref(`orders/${currentOrderId}/driver_offers/${driverId}/status`).set('rejected');
}

// ==================== FUNGSI UNTUK MENCARI DRIVER TERDEKAT ====================
function isValidCoordinate(lat, lng) {
    if (typeof lat !== 'number' || typeof lng !== 'number') return false;
    if (lat === 0 && lng === 0) return false;
    if (isNaN(lat) || isNaN(lng)) return false;
    if (lat < -90 || lat > 90) return false;
    if (lng < -180 || lng > 180) return false;
    return true;
}

function getDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLon/2)**2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function getDriverIconUrl(vehicleType) {
    if (!vehicleType) return 'https://cdn-icons-png.flaticon.com/128/5811/5811823.png';
    const type = vehicleType.toLowerCase();
    if (type === 'motor') return 'https://cdn-icons-png.flaticon.com/128/5811/5811823.png';
    if (type === 'bentor') return 'https://cdn-icons-png.flaticon.com/128/7890/7890227.png';
    if (type === 'mobil') return 'https://cdn-icons-png.flaticon.com/128/12689/12689302.png';
    if (type === 'kurir_motor') return 'https://cdn-icons-png.flaticon.com/128/9561/9561688.png';
    if (type === 'kurir_bentor') return 'https://cdn-icons-png.flaticon.com/128/7890/7890227.png';
    return 'https://cdn-icons-png.flaticon.com/128/5811/5811823.png';
}

function startSearchDriversForOrder(centerLatLng, radiusKm = 3) {
    if (!database || !centerLatLng) return;
    if (driversListener && driversRef) driversRef.off('value', driversListener);
    driversRef = database.ref('driver_locations');
    driversListener = driversRef.on('value', async (snapshot) => {
        const locations = snapshot.val();
        if (!locations) return;
        const [pickupLng, pickupLat] = centerLatLng;
        const driversInRadius = [];
        Object.keys(locations).forEach(driverId => {
            const driverData = locations[driverId];
            if (driverData && driverData.tracking_enabled === true && driverData.latitude && driverData.longitude) {
                if (!isValidCoordinate(driverData.latitude, driverData.longitude)) return;
                const distance = getDistanceKm(pickupLat, pickupLng, driverData.latitude, driverData.longitude);
                if (distance <= radiusKm) driversInRadius.push(driverId);
            }
        });
        console.log(`📡 Driver dalam radius ${radiusKm}km:`, driversInRadius);
    });
}

// ==================== VALIDASI & CREATE ORDER ====================
async function confirmRoute() {
    console.log('🚀 confirmRoute() dipanggil');
    if (currentOrderId) {
        const snap = await database.ref(`orders/${currentOrderId}`).once('value');
        if (snap.val()?.status === 'waiting') {
            isSearching = true;
            if (pickupCoord) startSearchDriversForOrder(pickupCoord, 3);
            document.getElementById('driverOffers').classList.add('active');
            if (offerTimerInterval) clearInterval(offerTimerInterval);
            if (cleanupInterval) clearInterval(cleanupInterval);
            offerTimerInterval = setInterval(() => { updateOfferTimers(); }, 1000);
            cleanupInterval = setInterval(() => { cleanupExpiredOffersCustomer(); }, 10000);
            orderRef = database.ref(`orders/${currentOrderId}/status`);
            orderStatusCallback = (snap) => {
                const status = snap.val();
                if (status === 'cancelled' || status === 'cancelled_by_user') { cleanupSearch(); showToast('⚠️ Order dibatalkan', 'error'); }
                else if (status === 'accepted') cleanupSearch();
            };
            orderRef.on('value', orderStatusCallback);
            offersRef = database.ref(`orders/${currentOrderId}/driver_offers`);
            offersCallback = (snap) => renderOffers(snap.val());
            offersRef.on('value', offersCallback);
            return;
        }
    }

    if (!currentRoute || !currentUser) { showPopup('Perhatian', 'Lengkapi asal dan tujuan.'); return; }

    const negoInput = document.getElementById('negoInput');
    let offerPrice = parseInt(negoInput.value);
    if (isNaN(offerPrice) || offerPrice <= 0) {
        showPopup('Tawaran Tidak Valid', 'Masukkan harga tawaran yang valid (angka positif).');
        return;
    }
    if (offerPrice < minAllowedNego) {
        showPopup('Tawaran Tidak Valid', `Minimal tawaran ${formatRupiah(minAllowedNego)}`);
        return;
    }
    currentPrice = offerPrice;

    const btn = document.getElementById('confirmBtn');
    btn.disabled = true;
    btn.innerHTML = '⏳ Batalkan Pencarian';
    btn.removeEventListener('click', confirmRoute);
    btn.addEventListener('click', cancelSearchHandler);
    btn.disabled = false;
    setTimeout(() => btn.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
    document.getElementById('routeDetails').style.display = 'none';
    document.getElementById('radar').style.display = 'block';
    setTimeout(() => document.getElementById('radar').classList.add('expanding'), 100);
    activateRadarOnPickup();
    if (map && pickupCoord) {
        map.setCenter({ lat: pickupCoord[1], lng: pickupCoord[0] });
        map.setZoom(15);
        setTimeout(() => {
            map.setCenter({ lat: pickupCoord[1], lng: pickupCoord[0] });
            map.setZoom(11);
        }, 2000);
    }
    const newOrderRef = database.ref('orders').push();
    currentOrderId = newOrderRef.key;

    let feePercent = 7, taxPercent = 11;
    try {
        const potonganSnap = await database.ref('data-jego/potongan').once('value');
        feePercent = potonganSnap.exists() ? parseFloat(potonganSnap.val()) : 7;
        const pajakSnap = await database.ref('data-jego/pajak').once('value');
        taxPercent = pajakSnap.exists() ? parseFloat(pajakSnap.val()) : 11;
    } catch(e) { console.warn('Gagal ambil fee, pakai default'); }

    const orderData = {
        user_id: currentUser.id,
        customer_name: currentUser.name,
        transport_type: transportType,
        pickup_address: pickupAddress,
        pickup_lat: pickupCoord[1],
        pickup_lng: pickupCoord[0],
        destination_address: destAddress,
        dest_lat: destCoord[1],
        dest_lng: destCoord[0],
        distance_meters: currentRoute.distance,
        duration_seconds: currentRoute.duration,
        price: currentPrice,
        fee_percent: feePercent,
        tax_percent: taxPercent,
        status: 'waiting',
        created_at: new Date().toISOString(),
        passenger_rating: currentUser.rating,
        perjalanan: currentUser.perjalanan,
        customer_phone: currentUser.phone || '',
        photoURL: currentUser.photoURL || ''
    };
    if (viaCoord && viaAddress) {
        orderData.via_lat = viaCoord[1];
        orderData.via_lng = viaCoord[0];
        orderData.via_address = viaAddress;
    }
    if (isCourier && deliveryData) {
        orderData.sender_phone = deliveryData.senderPhone;
        orderData.receiver_phone = deliveryData.receiverPhone;
        orderData.item_category = deliveryData.itemCategory;
        orderData.item_description = deliveryData.description;
    }
    await newOrderRef.set(orderData);
    const newOrderId = newOrderRef.key;
    currentOrderId = newOrderId;
    await database.ref(`userOrders/${currentUser.id}/${currentOrderId}`).set(true);
    localStorage.setItem('current_order_id', currentOrderId);
    isSearching = true;
    if (pickupCoord) startSearchDriversForOrder(pickupCoord, 3);
    document.getElementById('driverOffers').classList.add('active');
    if (offerTimerInterval) clearInterval(offerTimerInterval);
    if (cleanupInterval) clearInterval(cleanupInterval);
    offerTimerInterval = setInterval(() => { updateOfferTimers(); }, 1000);
    cleanupInterval = setInterval(() => { cleanupExpiredOffersCustomer(); }, 10000);
    orderRef = database.ref(`orders/${currentOrderId}/status`);
    orderStatusCallback = (snap) => {
        const status = snap.val();
        if (status === 'cancelled' || status === 'cancelled_by_user') { cleanupSearch(); showToast('⚠️ Order dibatalkan', 'error'); }
        else if (status === 'accepted') cleanupSearch();
    };
    orderRef.on('value', orderStatusCallback);
    offersRef = database.ref(`orders/${currentOrderId}/driver_offers`);
    offersCallback = (snap) => renderOffers(snap.val());
    offersRef.on('value', offersCallback);
}

async function cancelSearch() {
    if (!currentOrderId) { cleanupSearch(); localStorage.removeItem('current_order_id'); return; }
    try {
        await database.ref(`orders/${currentOrderId}`).update({ status: 'cancelled_by_user', cancelled_at: new Date().toISOString() });
        cleanupSearch();
        localStorage.removeItem('current_order_id');
        showToast('✅ Perjalanan berhasil dibatalkan', 'success');
    } catch(err) { showToast('❌ Gagal membatalkan order', 'error'); }
}

function cancelSearchHandler() { cancelSearch(); }

function cleanupSearch() {
    if (orderRef && orderStatusCallback) orderRef.off('value', orderStatusCallback);
    if (offersRef && offersCallback) offersRef.off('value', offersCallback);
    isSearching = false;
    document.getElementById('radar').style.display = 'none';
    document.getElementById('radar').classList.remove('expanding');
    document.getElementById('driverOffers').classList.remove('active');
    if (offerTimerInterval) { clearInterval(offerTimerInterval); offerTimerInterval = null; }
    if (cleanupInterval) { clearInterval(cleanupInterval); cleanupInterval = null; }
    if (driversListener && driversRef) { driversRef.off('value', driversListener); driversListener = null; driversRef = null; }
    const btn = document.getElementById('confirmBtn');
    btn.removeEventListener('click', cancelSearchHandler);
    btn.addEventListener('click', confirmRoute);
    btn.innerHTML = currentPrice ? `🚀 CARI DRIVER | ${formatRupiah(currentPrice)}` : '📍 Konfirmasi Rute';
    btn.disabled = (currentPrice === 0);
    document.getElementById('cancelBtn').classList.remove('show');
    document.getElementById('routeDetails').style.display = 'block';
    currentOrderId = null;
    deactivateRadarOnPickup();
    stopSlowZoomOut();
}

// ==================== INISIALISASI ====================
window.onload = async () => {
    console.log('📱 JeGo Rute Customer - window.onload');
    applyDarkMode();

    const loggedIn = await checkUserSession().catch(() => false);
    if (!loggedIn) return;

    await fetchTransportData();

    const orderActive = await cekOrderAktifDanRedirect();

    let attempts = 0;
    while (!window.initMapDone && attempts < 30) {
        await new Promise(r => setTimeout(r, 300));
        attempts++;
    }

    if (!window.initMapDone) {
        console.warn('⚠️ Google Maps belum siap, inisialisasi manual');
        initMap();
    }

    if (orderActive) {
        const loaded = await loadWaitingOrderData();
        if (!loaded) {
            const transportLoaded = await loadSelectedTransport();
            if (!transportLoaded) {
                openVehicleOverlay();
            } else {
                await autoFillPickupLocation();
            }
        }
    } else {
        const transportLoaded = await loadSelectedTransport();
        if (!transportLoaded) {
            openVehicleOverlay();
        } else {
            await autoFillPickupLocation();
        }
    }

    // Force tampilkan tombol cancel jika ada order waiting (backup)
    setTimeout(async () => {
        const orderId = localStorage.getItem('current_order_id');
        if (orderId) {
            try {
                const snap = await database.ref(`orders/${orderId}`).once('value');
                const order = snap.val();
                if (order && order.status === 'waiting') {
                    const cancelBtn = document.getElementById('cancelBtn');
                    cancelBtn.classList.add('show');
                    cancelBtn.innerText = '❌ Batalkan Perjalanan';
                    console.log('✅ Force tampil tombol cancel di dalam bottom sheet dari window.onload');
                }
            } catch(e) {
                console.warn('Gagal cek order:', e);
            }
        }
    }, 1500);

    // Event listeners
    document.getElementById('useMapPickBtn').addEventListener('click', confirmMapPick);
    document.getElementById('cancelMapPickBtn').addEventListener('click', cancelMapPick);
    document.getElementById('pickupInput').addEventListener('click', () => { if (!isSearching) openSearchOverlay('pickup'); });
    document.getElementById('destInput').addEventListener('click', () => { if (!isSearching) openSearchOverlay('destination'); });
    document.getElementById('viaInput').addEventListener('click', () => { if (!isSearching) openSearchOverlay('via'); });
    document.getElementById('clearViaBtn').addEventListener('click', clearViaPoint);

    document.getElementById('searchOverlayBack').addEventListener('click', closeSearchOverlay);
    document.getElementById('searchOverlayClear').addEventListener('click', () => {
        document.getElementById('searchOverlayInput').value = '';
        document.getElementById('searchOverlayClear').classList.remove('visible');
        document.getElementById('searchDefaultOptions').style.display = 'block';
        document.getElementById('searchResultList').style.display = 'none';
        document.getElementById('searchLoading').style.display = 'none';
        document.getElementById('searchOverlayInput').focus();
    });
    const searchInput = document.getElementById('searchOverlayInput');
    searchInput.addEventListener('input', () => {
        const val = searchInput.value;
        const clearBtn = document.getElementById('searchOverlayClear');
        if (val.length > 0) clearBtn.classList.add('visible');
        else clearBtn.classList.remove('visible');
        if (searchTimeout) clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            if (val.length >= 3) {
                searchAddress(val);
            }
        }, 700);
    });
    document.getElementById('useCurrentLocationBtn').addEventListener('click', useCurrentLocation);
    document.getElementById('pickFromMapBtn').addEventListener('click', pickFromMap);
    document.getElementById('searchOverlay').addEventListener('click', function(e) { if (e.target === this) closeSearchOverlay(); });
    document.getElementById('confirmBtn').addEventListener('click', confirmRoute);
    document.getElementById('closeDriverOffers').addEventListener('click', () => {
        document.getElementById('driverOffers').classList.remove('active');
    });
    document.getElementById('cancelBtn').addEventListener('click', cancelSearchHandler);

    document.getElementById('changeVehicleBtn').addEventListener('click', openVehicleOverlay);
    document.getElementById('vehicleCloseBtn').addEventListener('click', closeVehicleOverlay);
    document.getElementById('closeSheetBtn').addEventListener('click', () => {
        document.getElementById('vehicleBottomSheet').classList.remove('active');
    });
    document.getElementById('pilihBtn').addEventListener('click', () => {
        if (selectedVehicleType) {
            selectVehicle(selectedVehicleType);
        } else {
            showToast('Pilih salah satu kendaraan terlebih dahulu', 'error');
        }
    });
    document.getElementById('vehicleOverlay').addEventListener('click', function(e) {
        if (e.target === this) closeVehicleOverlay();
    });

    console.log('✅ Semua event listeners terpasang, siap digunakan');
};

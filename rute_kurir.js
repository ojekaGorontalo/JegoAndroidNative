// ==================== KONFIGURASI FIREBASE ====================
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

// ==================== GLOBAL ====================
let map;
let currentUser = null;
let selectedTransport = null;

let pickup = null;
let destination = null;
let waypoints = [];

let searchMode = 'pickup';
let searchWaypointIndex = -1;

let recommendedPrice = 0;
let offerPrice = 0;
let minOffer = 0;

// Google Maps services
let geocoder;
let directionsService;
let directionsRenderer;
let autocompleteService = null;

// Driver offers
let currentOrderId = null;
let offersListener = null;
let orderStatusListener = null;
let offerTimerInterval = null;
let cleanupInterval = null;

// Marker & polylines
let pickupMarker = null;
let destMarker = null;
let waypointMarkers = [];
let routePolyline = null;

// Cache untuk search
let searchCache = {};
let placeDetailsCache = {};
let searchAbortController = null;

const mainSheet = document.getElementById('mainSheet');
const searchSheet = document.getElementById('searchSheet');
const detailSheet = document.getElementById('detailSheet');
const wpModal = document.getElementById('wpModal');
let wpModalIndex = -1;

// ==================== UTILITY ====================
function showPopup(title, message, onClose = null) {
    document.getElementById('popupTitle').innerText = title;
    document.getElementById('popupMessage').innerHTML = message;
    const overlay = document.getElementById('popupOverlay');
    const btnContainer = document.getElementById('popupButtons');
    btnContainer.innerHTML = `<button class="popup-button popup-button-primary" id="popupButton">OK</button>`;
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

function showLoading(show) {
    document.getElementById('loadingOverlay').classList.toggle('active', show);
}

function formatRupiah(amount) {
    return 'Rp ' + amount.toLocaleString('id-ID');
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
}

// ==================== RIWAYAT PENCARIAN ====================
const HISTORY_KEY = 'jego_search_history';
const MAX_HISTORY = 10;

function getHistory() {
    try {
        const data = localStorage.getItem(HISTORY_KEY);
        return data ? JSON.parse(data) : [];
    } catch (e) { return []; }
}

function saveHistory(addressData) {
    if (!addressData || !addressData.address) return;
    let history = getHistory();
    history = history.filter(item => item.address !== addressData.address);
    history.unshift({
        address: addressData.address,
        lat: addressData.lat || null,
        lng: addressData.lng || null,
        place_id: addressData.place_id || null,
        name: addressData.name || null,
        timestamp: Date.now()
    });
    if (history.length > MAX_HISTORY) history = history.slice(0, MAX_HISTORY);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch (e) {}
    renderHistory();
}

function clearHistory() {
    try { localStorage.removeItem(HISTORY_KEY); } catch (e) {}
    renderHistory();
}

function renderHistory() {
    const container = document.getElementById('historyContainer');
    if (!container) return;
    const history = getHistory();
    if (history.length === 0) {
        container.innerHTML = `
            <div class="history-header"><span class="title">Riwayat Pencarian</span></div>
            <div class="history-empty">Belum ada riwayat pencarian</div>
        `;
        return;
    }
    let html = `
        <div class="history-header">
            <span class="title">Riwayat Pencarian</span>
            <button class="clear-btn" id="clearHistoryBtn">Hapus Riwayat</button>
        </div>
    `;
    history.forEach(item => {
        const timeStr = new Date(item.timestamp).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit' });
        html += `
            <div class="history-item" 
                 data-address="${escapeHtml(item.address)}"
                 data-lat="${item.lat || ''}"
                 data-lng="${item.lng || ''}"
                 data-place-id="${item.place_id || ''}"
                 data-name="${escapeHtml(item.name || '')}">
                <div class="icon">🕐</div>
                <div class="text">${escapeHtml(item.address)}</div>
                <div class="time">${timeStr}</div>
            </div>
        `;
    });
    container.innerHTML = html;

    container.querySelectorAll('.history-item').forEach(el => {
        el.addEventListener('click', function() {
            const address = this.dataset.address;
            const lat = parseFloat(this.dataset.lat);
            const lng = parseFloat(this.dataset.lng);
            const placeId = this.dataset.placeId;
            const name = this.dataset.name;
            if (address) {
                if (lat && lng && !isNaN(lat) && !isNaN(lng)) {
                    selectAddress({ lat, lng, address, place_id: placeId || null, name: name || null });
                    closeSearchSheet();
                    saveHistory({ address, lat, lng, place_id: placeId, name });
                } else {
                    searchHistoryAddress(address);
                }
            }
        });
    });

    const clearBtn = document.getElementById('clearHistoryBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            showConfirmPopup('Hapus Riwayat', 'Yakin ingin menghapus semua riwayat pencarian?',
                clearHistory, function() {}
            );
        });
    }
}

function searchHistoryAddress(address) {
    showLoading(true);
    geocoder.geocode({ address, language: 'id', region: 'ID' }, (results, status) => {
        showLoading(false);
        if (status === 'OK' && results.length > 0) {
            const result = results[0];
            const lat = result.geometry.location.lat();
            const lng = result.geometry.location.lng();
            const formattedAddress = result.formatted_address.replace(', Indonesia', '');
            const placeId = result.place_id || null;
            selectAddress({ lat, lng, address: formattedAddress, place_id: placeId, name: null });
            closeSearchSheet();
            saveHistory({ address: formattedAddress, lat, lng, place_id: placeId, name: null });
        } else {
            showPopup('Error', 'Alamat tidak ditemukan. Coba cari manual.');
        }
    });
}

// ==================== CHECK USER SESSION ====================
async function checkUserSession() {
    return new Promise((resolve, reject) => {
        const unsubscribe = auth.onAuthStateChanged(async (user) => {
            unsubscribe();
            if (!user) {
                showPopup('Akses Ditolak', 'Anda belum login.', () => window.location.href = 'loginUser.html');
                reject(false);
                return;
            }
            try {
                const uid = user.uid;
                const snapshot = await database.ref(`users/${uid}`).once('value');
                const data = snapshot.val();
                if (!data) throw new Error();
                currentUser = {
                    id: uid,
                    name: data.name,
                    phone: data.phone,
                    email: data.email,
                    rating: data.rating || 5,
                    perjalanan: data.perjalanan || 0,
                    photoURL: data.photoURL || ''
                };
                resolve(true);
            } catch (err) {
                showPopup('Sesi Tidak Valid', 'Silakan login ulang.', () => window.location.href = 'loginUser.html');
                reject(false);
            }
        });
    });
}

// ==================== FETCH TRANSPORT DATA ====================
async function fetchTransportData() {
    const storedTransport = localStorage.getItem('jego_last_transport');
    if (storedTransport) {
        try {
            const parsed = JSON.parse(storedTransport);
            if (parsed.type && parsed.icon && parsed.tariff !== undefined) {
                selectedTransport = {
                    type: parsed.type,
                    name: parsed.name || 'Kurir',
                    icon: parsed.icon,
                    minimalDistance: parsed.minimalDistance || 4,
                    minimalPrice: parsed.minimalPrice || 10000,
                    tariff: parsed.tariff || 2100
                };
                return true;
            }
        } catch (e) {}
    }

    try {
        const snapshot = await database.ref('data-jego/tarif').once('value');
        if (!snapshot.exists()) throw new Error();
        let found = false;
        snapshot.forEach((child) => {
            const data = child.val();
            const name = data.nama;
            const lower = name.toLowerCase();
            if (lower.includes('kurir') || lower.includes('send')) {
                let type = null;
                if (lower.includes('motor')) type = 'kurir_motor';
                else if (lower.includes('bentor') || lower.includes('trike')) type = 'kurir_bentor';
                else if (lower.includes('kurir')) type = 'kurir_motor';
                if (type) {
                    selectedTransport = {
                        type: type,
                        name: data.nama,
                        icon: data.icon_url || getDriverIconUrl(type),
                        minimalDistance: data.minimal_distance || 4,
                        minimalPrice: data.minimal_price || 10000,
                        tariff: data.price_per_km || 2100
                    };
                    found = true;
                }
            }
        });
        if (!found) {
            selectedTransport = {
                type: 'kurir_motor',
                name: 'Kurir Motor',
                icon: 'https://cdn-icons-png.flaticon.com/128/9561/9561688.png',
                minimalDistance: 4,
                minimalPrice: 10000,
                tariff: 2100
            };
        }
        return true;
    } catch (error) {
        selectedTransport = {
            type: 'kurir_motor',
            name: 'Kurir Motor',
            icon: 'https://cdn-icons-png.flaticon.com/128/9561/9561688.png',
            minimalDistance: 4,
            minimalPrice: 10000,
            tariff: 2100
        };
        return true;
    }
}

function getDriverIconUrl(type) {
    if (type === 'kurir_motor') return 'https://cdn-icons-png.flaticon.com/128/9561/9561688.png';
    if (type === 'kurir_bentor') return 'https://cdn-icons-png.flaticon.com/128/7890/7890227.png';
    return 'https://cdn-icons-png.flaticon.com/128/9561/9561688.png';
}

// ==================== RENDER MAIN SHEET ====================
function renderMainSheet() {
    const container = document.getElementById('addressList');
    let html = '';

    html += `
        <div class="address-item" data-mode="pickup">
            <div class="icon pickup">📍</div>
            <div class="content">
                <div class="label">Penjemputan</div>
                <div class="address ${pickup ? '' : 'placeholder'}">${pickup ? escapeHtml(pickup.address) : 'Klik untuk pilih lokasi'}</div>
            </div>
        </div>
    `;

    waypoints.forEach((wp, index) => {
        html += `
            <div class="address-item" data-mode="waypoint" data-index="${index}">
                <div class="icon waypoint">📌</div>
                <div class="content">
                    <div class="label">Perhentian ${index+1}</div>
                    <div class="address ${wp.address ? '' : 'placeholder'}">${wp.address ? escapeHtml(wp.address) : 'Klik untuk pilih lokasi'}</div>
                </div>
            </div>
        `;
    });

    html += `
        <div class="address-item" data-mode="destination">
            <div class="icon destination">🏁</div>
            <div class="content">
                <div class="label">Tujuan</div>
                <div class="address ${destination ? '' : 'placeholder'}">${destination ? escapeHtml(destination.address) : 'Klik untuk pilih lokasi'}</div>
            </div>
        </div>
    `;

    container.innerHTML = html;

    container.querySelectorAll('.address-item').forEach(el => {
        el.addEventListener('click', () => {
            const mode = el.dataset.mode;
            if (mode === 'pickup') {
                searchMode = 'pickup';
                openSearchSheet('Cari lokasi penjemputan');
            } else if (mode === 'destination') {
                searchMode = 'destination';
                openSearchSheet('Cari lokasi tujuan');
            } else if (mode === 'waypoint') {
                searchMode = 'waypoint';
                searchWaypointIndex = parseInt(el.dataset.index, 10);
                openSearchSheet('Cari perhentian');
            }
        });
    });

    const offerCard = document.getElementById('offerCard');
    if (pickup && destination) {
        offerCard.style.display = 'block';
        calculateRouteAndPrice().then(price => {
            recommendedPrice = price;
            minOffer = Math.round(price * 0.9 / 1000) * 1000;
            if (minOffer < selectedTransport.minimalPrice) minOffer = selectedTransport.minimalPrice;
            document.getElementById('recommendedPrice').innerText = formatRupiah(price);
            document.getElementById('minOfferHint').innerText = formatRupiah(minOffer);
            const input = document.getElementById('offerInput');
            if (!input.value || parseInt(input.value) === 0) {
                input.value = price;
                offerPrice = price;
            }
            input.min = minOffer;
            input.placeholder = `Minimal ${formatRupiah(minOffer)}`;
        });
    } else {
        offerCard.style.display = 'none';
    }
}

// ==================== REVERSE GEOCODE ====================
function reverseGeocode(lat, lng) {
    return new Promise((resolve) => {
        geocoder.geocode({
            location: { lat, lng },
            language: 'id'
        }, (results, status) => {
            if (status === 'OK' && results.length > 0) {
                let address = results[0].formatted_address;
                address = address.replace(', Indonesia', '');
                resolve({
                    address: address,
                    place_id: results[0].place_id || null,
                    name: results[0].name || null
                });
            } else {
                resolve(null);
            }
        });
    });
}

// ==================== HITUNG RUTE ====================
function calculateRouteDetails() {
    return new Promise((resolve) => {
        if (!pickup || !destination) return resolve(null);

        const waypointsList = waypoints.filter(wp => wp.lat && wp.lng).map(wp => ({
            location: new google.maps.LatLng(wp.lat, wp.lng),
            stopover: true
        }));

        const request = {
            origin: new google.maps.LatLng(pickup.lat, pickup.lng),
            destination: new google.maps.LatLng(destination.lat, destination.lng),
            waypoints: waypointsList,
            travelMode: google.maps.TravelMode.DRIVING,
            language: 'id',
            unitSystem: google.maps.UnitSystem.METRIC
        };

        directionsService.route(request, (result, status) => {
            if (status === 'OK' && result.routes.length > 0) {
                const route = result.routes[0];
                const leg = route.legs.reduce((acc, cur) => {
                    acc.distance += cur.distance.value;
                    acc.duration += cur.duration.value;
                    return acc;
                }, { distance: 0, duration: 0 });
                resolve({ distance: leg.distance, duration: leg.duration, route: route });
            } else {
                resolve(null);
            }
        });
    });
}

async function calculateRouteAndPrice() {
    if (!pickup || !destination) return 0;
    const route = await calculateRouteDetails();
    if (!route) return 0;
    const distanceKm = route.distance / 1000;
    let price = 0;
    const minDist = selectedTransport.minimalDistance || 4;
    const minPrice = selectedTransport.minimalPrice || 10000;
    const perKm = selectedTransport.tariff || 2100;
    if (distanceKm <= minDist) {
        price = minPrice;
    } else {
        price = minPrice + (distanceKm - minDist) * perKm;
    }
    return Math.round(price / 1000) * 1000;
}

// ==================== INIT MAP ====================
function initMap() {
    const center = { lat: 0.5435, lng: 123.0580 };
    const isDark = localStorage.getItem('jego_dark_mode') === 'true';
    const styles = isDark ? [
        { featureType: "all", elementType: "geometry", stylers: [{ color: "#242f3e" }] },
        { featureType: "all", elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
        { featureType: "all", elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
        { featureType: "road", elementType: "geometry", stylers: [{ color: "#38414e" }] },
        { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#212a37" }] },
        { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] }
    ] : [];

    map = new google.maps.Map(document.getElementById('map'), {
        center: center,
        zoom: 12,
        mapTypeId: 'roadmap',
        styles: styles
    });

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

    map.addListener('click', function(e) {
        if (mapPickMode) {
            const lat = e.latLng.lat();
            const lng = e.latLng.lng();
            handleMapPick(lat, lng);
        }
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

// ==================== SEARCH PLACES (seperti rute_jego.html) ====================
function searchPlaces(keyword) {
    console.log(`🔍 searchPlaces() dipanggil dengan keyword: "${keyword}"`);
    
    if (searchAbortController) {
        searchAbortController.abort();
        searchAbortController = null;
    }

    const trimmedKeyword = keyword.trim();
    if (trimmedKeyword.length < 3) {
        document.getElementById('searchResults').style.display = 'none';
        document.getElementById('searchDefault').style.display = 'block';
        document.getElementById('searchLoading').style.display = 'none';
        document.getElementById('searchNoResult').style.display = 'none';
        return;
    }

    document.getElementById('searchDefault').style.display = 'none';
    document.getElementById('searchResults').style.display = 'none';
    document.getElementById('searchLoading').style.display = 'block';
    document.getElementById('searchNoResult').style.display = 'none';

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
            document.getElementById('searchResults').style.display = 'block';
            document.getElementById('searchNoResult').style.display = 'block';
            document.getElementById('searchNoResult').textContent = '⏱️ Pencarian terlalu lama, coba kata kunci lain.';
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
                console.log(`✅ Ditemukan ${predictions.length} prediksi`);
                const gorontaloResults = predictions.filter(p =>
                    p.description && p.description.toLowerCase().includes('gorontalo')
                );
                if (gorontaloResults.length === 0) {
                    document.getElementById('searchResults').style.display = 'block';
                    document.getElementById('searchNoResult').style.display = 'block';
                    document.getElementById('searchNoResult').textContent = '🔍 Tidak ditemukan di Gorontalo. Coba kata kunci lain.';
                    return;
                }
                searchCache[cacheKey] = gorontaloResults;
                renderSearchResults(gorontaloResults);
            } else {
                console.warn('⚠️ Places Autocomplete gagal, status:', status);
                searchPlacesFallback(trimmedKeyword);
            }
        });
    } else {
        searchPlacesFallback(trimmedKeyword);
    }
}

function renderSearchResults(predictions) {
    const container = document.getElementById('searchResults');
    container.innerHTML = '';
    container.style.display = 'block';
    document.getElementById('searchNoResult').style.display = 'none';

    const topResults = predictions.slice(0, 8);
    topResults.forEach(prediction => {
        const item = document.createElement('div');
        item.className = 'result-item';
        const mainText = prediction.structured_formatting?.main_text || prediction.description;
        const secondaryText = prediction.structured_formatting?.secondary_text || '';
        let display = mainText;
        if (secondaryText && !mainText.includes(secondaryText)) {
            display = mainText + ', ' + secondaryText;
        } else if (!mainText) {
            display = prediction.description;
        }
        const badge = ' <span style="font-size:10px;color:#FF9800;font-weight:bold;">📍 Gorontalo</span>';

        item.innerHTML = `<div class="icon">📍</div><div class="text">${escapeHtml(display)}${badge}</div>`;
        item.addEventListener('click', () => {
            const placeId = prediction.place_id;
            getPlaceDetails(placeId);
        });
        container.appendChild(item);
    });
}

function getPlaceDetails(placeId) {
    if (placeDetailsCache[placeId]) {
        console.log('📦 Pakai cache detail untuk:', placeId);
        const cached = placeDetailsCache[placeId];
        selectAddress({ lat: cached.lat, lng: cached.lng, address: cached.address, place_id: cached.place_id, name: cached.name });
        closeSearchSheet();
        return;
    }

    showLoading(true);
    const service = new google.maps.places.PlacesService(document.createElement('div'));
    service.getDetails({
        placeId: placeId,
        fields: ['geometry', 'formatted_address', 'name', 'place_id']
    }, (place, status) => {
        showLoading(false);
        if (status === 'OK' && place && place.geometry) {
            const lat = place.geometry.location.lat();
            const lng = place.geometry.location.lng();
            let address = place.formatted_address || place.name || '';
            address = address.replace(', Indonesia', '');
            placeDetailsCache[placeId] = {
                lat: lat,
                lng: lng,
                address: address,
                place_id: place.place_id,
                name: place.name || address.split(',')[0]
            };
            selectAddress({ lat, lng, address, place_id: place.place_id, name: place.name || address.split(',')[0] });
            closeSearchSheet();
        } else {
            showPopup('Error', 'Gagal mengambil detail lokasi.');
        }
    });
}

function searchPlacesFallback(keyword) {
    console.log('📍 searchPlacesFallback dipanggil untuk:', keyword);
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
        document.getElementById('searchResults').style.display = 'block';
        document.getElementById('searchNoResult').style.display = 'block';
        document.getElementById('searchNoResult').textContent = '⏱️ Pencarian terlalu lama, coba lagi.';
    }, 5000);

    geocoder.geocode({
        address: keyword + ', Gorontalo, Indonesia',
        language: 'id',
        region: 'ID',
        bounds: gorontaloBounds
    }, (results, status) => {
        clearTimeout(timeoutId);
        document.getElementById('searchLoading').style.display = 'none';
        const container = document.getElementById('searchResults');
        container.innerHTML = '';
        document.getElementById('searchNoResult').style.display = 'none';

        if (status === 'OK' && results && results.length > 0) {
            console.log(`✅ Geocoding fallback ditemukan ${results.length} hasil di Gorontalo`);
            container.style.display = 'block';

            const gorontaloResults = results.filter(r => {
                const addr = r.formatted_address.toLowerCase();
                return addr.includes('gorontalo');
            });

            const finalResults = gorontaloResults.length > 0 ? gorontaloResults : results;
            finalResults.slice(0, 8).forEach(result => {
                const item = document.createElement('div');
                item.className = 'result-item';
                const display = result.formatted_address.replace(', Indonesia', '');
                const badge = ' <span style="font-size:10px;color:#FF9800;font-weight:bold;">📍 Gorontalo</span>';

                item.innerHTML = `<div class="icon">📍</div><div class="text">${escapeHtml(display)}${badge}</div>`;
                item.addEventListener('click', () => {
                    const lat = result.geometry.location.lat();
                    const lng = result.geometry.location.lng();
                    const placeId = result.place_id || null;
                    selectAddress({ lat, lng, address: display, place_id: placeId, name: null });
                    closeSearchSheet();
                });
                container.appendChild(item);
            });
        } else {
            container.style.display = 'block';
            document.getElementById('searchNoResult').style.display = 'block';
            document.getElementById('searchNoResult').textContent = '🔍 Tidak ditemukan di Gorontalo. Coba kata kunci lain.';
        }
    });
}

// ==================== SELECT ADDRESS ====================
function selectAddress(data) {
    const { lat, lng, address, place_id, name } = data;
    
    let finalAddress = address;
    if (name && name.trim() && !address.includes(name)) {
        finalAddress = name + ', ' + address;
    }

    const addressData = { 
        address: finalAddress, 
        lat, 
        lng,
        place_id: place_id || null,
        name: name || null
    };

    if (searchMode === 'pickup') {
        pickup = addressData;
    } else if (searchMode === 'destination') {
        destination = addressData;
    } else if (searchMode === 'waypoint') {
        const index = searchWaypointIndex;
        if (index >= 0 && index < waypoints.length) {
            waypoints[index] = addressData;
        } else {
            waypoints.push(addressData);
        }
    }

    if (finalAddress && finalAddress.trim()) {
        saveHistory(addressData);
    }

    closeSearchSheet();
    renderMainSheet();
    updateMap();
    wpModal.classList.remove('open');
    updateDetailPriceDisplay();

    searchMode = 'pickup';
    searchWaypointIndex = -1;
}

// ==================== PILIH DI PETA ====================
let mapPickMode = false;
let mapPickMarker = null;
let mapPickListener = null;

document.getElementById('pickOnMapBtn').addEventListener('click', () => {
    closeSearchSheet();
    mainSheet.classList.add('closed');
    detailSheet.classList.remove('open');

    mapPickMode = true;
    const center = map.getCenter();
    showPickMapPin(center.lat(), center.lng());

    if (mapPickListener) {
        google.maps.event.removeListener(mapPickListener);
    }
    mapPickListener = map.addListener('center_changed', () => {
        if (mapPickMode && mapPickMarker) {
            const c = map.getCenter();
            mapPickMarker.setPosition(c);
        }
    });
});

function showPickMapPin(lat, lng) {
    if (mapPickMarker) {
        mapPickMarker.setMap(null);
        mapPickMarker = null;
    }
    const icon = {
        url: 'https://maps.google.com/mapfiles/ms/icons/red-dot.png',
        scaledSize: new google.maps.Size(48, 48)
    };
    mapPickMarker = new google.maps.Marker({
        position: { lat, lng },
        map: map,
        icon: icon,
        draggable: false,
        animation: google.maps.Animation.DROP,
        title: 'Lokasi yang dipilih'
    });

    const oldBtn = document.getElementById('mapPickConfirmBtn');
    if (oldBtn) oldBtn.remove();

    const confirmBtn = document.createElement('button');
    confirmBtn.id = 'mapPickConfirmBtn';
    confirmBtn.innerText = '✅ OK - Gunakan lokasi ini';
    confirmBtn.style.position = 'fixed';
    confirmBtn.style.bottom = '120px';
    confirmBtn.style.left = '50%';
    confirmBtn.style.transform = 'translateX(-50%)';
    confirmBtn.style.background = '#4CAF50';
    confirmBtn.style.color = 'white';
    confirmBtn.style.border = 'none';
    confirmBtn.style.borderRadius = '40px';
    confirmBtn.style.padding = '14px 24px';
    confirmBtn.style.fontWeight = '700';
    confirmBtn.style.fontSize = '16px';
    confirmBtn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
    confirmBtn.style.zIndex = '3000';
    confirmBtn.style.cursor = 'pointer';
    confirmBtn.addEventListener('click', confirmMapPick);
    document.body.appendChild(confirmBtn);
}

function handleMapPick(lat, lng) {
    if (mapPickMarker) {
        mapPickMarker.setPosition({ lat, lng });
        map.setCenter({ lat, lng });
    }
}

async function confirmMapPick() {
    if (!mapPickMode) return;
    const pos = mapPickMarker.getPosition();
    const lat = pos.lat();
    const lng = pos.lng();

    const result = await reverseGeocode(lat, lng);
    if (result) {
        selectAddress({ lat, lng, address: result.address, place_id: result.place_id, name: result.name });
    } else {
        selectAddress({ lat, lng, address: '(Titik di peta)', place_id: null, name: null });
    }

    mapPickMode = false;
    if (mapPickMarker) {
        mapPickMarker.setMap(null);
        mapPickMarker = null;
    }
    if (mapPickListener) {
        google.maps.event.removeListener(mapPickListener);
        mapPickListener = null;
    }
    const btn = document.getElementById('mapPickConfirmBtn');
    if (btn) btn.remove();
    mainSheet.classList.remove('closed');
}

// ==================== UPDATE MAP ====================
function updateMap() {
    clearMarkers();

    const allCoords = [];

    if (pickup) {
        pickupMarker = new google.maps.Marker({
            position: { lat: pickup.lat, lng: pickup.lng },
            map: map,
            icon: {
                url: selectedTransport ? selectedTransport.icon : 'https://cdn-icons-png.flaticon.com/128/9561/9561688.png',
                scaledSize: new google.maps.Size(36, 36),
                origin: new google.maps.Point(0, 0),
                anchor: new google.maps.Point(18, 18)
            },
            title: 'Penjemputan'
        });
        allCoords.push({ lat: pickup.lat, lng: pickup.lng });
    }

    if (destination) {
        destMarker = new google.maps.Marker({
            position: { lat: destination.lat, lng: destination.lng },
            map: map,
            icon: {
                url: 'https://maps.google.com/mapfiles/ms/icons/orange-dot.png',
                scaledSize: new google.maps.Size(40, 40)
            },
            title: 'Tujuan'
        });
        allCoords.push({ lat: destination.lat, lng: destination.lng });
    }

    waypoints.forEach(wp => {
        if (!wp.lat || !wp.lng) return;
        const marker = new google.maps.Marker({
            position: { lat: wp.lat, lng: wp.lng },
            map: map,
            icon: {
                url: 'https://maps.google.com/mapfiles/ms/icons/blue-dot.png',
                scaledSize: new google.maps.Size(32, 32)
            },
            title: 'Perhentian'
        });
        waypointMarkers.push(marker);
        allCoords.push({ lat: wp.lat, lng: wp.lng });
    });

    if (allCoords.length > 0) {
        const bounds = new google.maps.LatLngBounds();
        allCoords.forEach(c => bounds.extend(new google.maps.LatLng(c.lat, c.lng)));
        map.fitBounds(bounds, { top: 80, bottom: 280, left: 40, right: 40 });
    }

    drawRoute();
}

function clearMarkers() {
    if (pickupMarker) { pickupMarker.setMap(null); pickupMarker = null; }
    if (destMarker) { destMarker.setMap(null); destMarker = null; }
    waypointMarkers.forEach(m => m.setMap(null));
    waypointMarkers = [];
    if (routePolyline) { routePolyline.setMap(null); routePolyline = null; }
    directionsRenderer.setMap(null);
    directionsRenderer.setMap(map);
}

async function drawRoute() {
    if (!pickup || !destination) return;
    const routeData = await calculateRouteDetails();
    if (!routeData) return;

    const route = routeData.route;
    if (route && route.overview_path) {
        if (routePolyline) routePolyline.setMap(null);
        routePolyline = new google.maps.Polyline({
            path: route.overview_path,
            geodesic: true,
            strokeColor: '#FF9800',
            strokeWeight: 5,
            strokeOpacity: 0.9,
            map: map
        });
        directionsRenderer.setDirections({ routes: [route] });
    }
}

// ==================== SEARCH SHEET ====================
let searchTimeout = null;

function openSearchSheet(placeholder) {
    document.getElementById('searchInput').value = '';
    document.getElementById('searchInput').placeholder = placeholder;
    document.getElementById('searchResults').style.display = 'none';
    document.getElementById('searchDefault').style.display = 'block';
    document.getElementById('searchLoading').style.display = 'none';
    document.getElementById('searchNoResult').style.display = 'none';
    document.getElementById('historyContainer').style.display = 'block';
    renderHistory();

    searchSheet.classList.add('open');
    setTimeout(() => document.getElementById('searchInput').focus(), 300);
    initAutocompleteService();
}

function closeSearchSheet() {
    searchSheet.classList.remove('open');
    if (searchTimeout) clearTimeout(searchTimeout);
}

document.getElementById('searchInput').addEventListener('input', function() {
    const val = this.value.trim();
    if (searchTimeout) clearTimeout(searchTimeout);

    if (val.length === 0) {
        document.getElementById('searchResults').style.display = 'none';
        document.getElementById('searchDefault').style.display = 'block';
        document.getElementById('searchLoading').style.display = 'none';
        document.getElementById('searchNoResult').style.display = 'none';
        document.getElementById('historyContainer').style.display = 'block';
        renderHistory();
        return;
    }

    document.getElementById('historyContainer').style.display = 'none';

    if (val.length < 3) {
        document.getElementById('searchResults').style.display = 'none';
        document.getElementById('searchDefault').style.display = 'block';
        document.getElementById('searchLoading').style.display = 'none';
        document.getElementById('searchNoResult').style.display = 'none';
        return;
    }

    searchTimeout = setTimeout(() => searchPlaces(val), 500);
});

document.getElementById('searchBackBtn').addEventListener('click', closeSearchSheet);

// ==================== GPS ====================
document.getElementById('useGpsBtn').addEventListener('click', () => {
    if (!navigator.geolocation) {
        showPopup('Error', 'Geolokasi tidak didukung.');
        return;
    }
    navigator.geolocation.getCurrentPosition(async (position) => {
        const { latitude, longitude } = position.coords;
        const result = await reverseGeocode(latitude, longitude);
        if (result) {
            selectAddress({ lat: latitude, lng: longitude, address: result.address, place_id: result.place_id, name: result.name });
        } else {
            selectAddress({ lat: latitude, lng: longitude, address: '(Lokasi Anda)', place_id: null, name: null });
        }
        closeSearchSheet();
    }, () => {
        showPopup('Error', 'Gagal mendapatkan lokasi.');
    }, { enableHighAccuracy: true, timeout: 10000 });
});

// ==================== WAYPOINT MODAL ====================
function openWpModal(index) {
    wpModalIndex = index;
    const wp = waypoints[index];
    if (!wp) return;
    document.getElementById('wpModalTitle').innerText = `Perhentian ${index+1}`;
    document.getElementById('wpModalAddrText').innerText = wp.address || '(Kosong)';
    wpModal.classList.add('open');
}

function closeWpModal() {
    wpModal.classList.remove('open');
    wpModalIndex = -1;
}

document.getElementById('wpModalAddress').addEventListener('click', () => {
    if (wpModalIndex < 0) return;
    closeWpModal();
    searchMode = 'waypoint';
    searchWaypointIndex = wpModalIndex;
    openSearchSheet('Ubah alamat perhentian');
});

document.getElementById('wpDeleteBtn').addEventListener('click', () => {
    if (wpModalIndex < 0) return;
    waypoints.splice(wpModalIndex, 1);
    closeWpModal();
    renderMainSheet();
    updateMap();
    renderDetailWaypoints();
    updateDetailPriceDisplay();
});

document.getElementById('wpCancelBtn').addEventListener('click', closeWpModal);

// ==================== DETAIL SHEET ====================
function renderDetailWaypoints() {
    const container = document.getElementById('waypointList');
    if (waypoints.length === 0) {
        container.innerHTML = '<div style="color:#999; font-size:0.9rem;">Belum ada perhentian.</div>';
        return;
    }
    container.innerHTML = waypoints.map((wp, i) => `
        <div class="waypoint-item" data-index="${i}">
            <span class="wp-label">📌 ${i+1}</span>
            <span class="wp-addr">${wp.address || '(Kosong)'}</span>
            <span class="wp-edit">✎</span>
        </div>
    `).join('');
    container.querySelectorAll('.waypoint-item').forEach(el => {
        el.addEventListener('click', () => {
            const idx = parseInt(el.dataset.index, 10);
            openWpModal(idx);
        });
    });
}

function updateDetailPriceDisplay() {
    const val = parseInt(document.getElementById('offerInput').value);
    if (!isNaN(val) && val > 0) {
        document.getElementById('detailOfferValue').innerText = formatRupiah(val);
    } else {
        document.getElementById('detailOfferValue').innerText = formatRupiah(offerPrice || 0);
    }
}

function openDetailSheet() {
    if (!pickup || !pickup.address) {
        showPopup('Perhatian', 'Lengkapi alamat penjemputan.');
        return;
    }
    if (!destination || !destination.address) {
        showPopup('Perhatian', 'Lengkapi alamat tujuan.');
        return;
    }
    document.getElementById('senderPhone').value = currentUser.phone || '';
    document.getElementById('detailPickup').innerText = pickup.address;
    document.getElementById('detailDest').innerText = destination.address;
    renderDetailWaypoints();
    updateDetailPriceDisplay();
    detailSheet.classList.add('open');
    mainSheet.classList.remove('open');
    mainSheet.classList.add('closed');

    setTimeout(() => google.maps.event.trigger(map, 'resize'), 400);
}

function closeDetailSheet() {
    detailSheet.classList.remove('open');
    mainSheet.classList.remove('closed');
    mainSheet.classList.add('open');

    setTimeout(() => google.maps.event.trigger(map, 'resize'), 400);
}

document.getElementById('nextToDetailBtn').addEventListener('click', openDetailSheet);
document.getElementById('backToMainBtn').addEventListener('click', closeDetailSheet);
document.getElementById('closeDetailSheet').addEventListener('click', closeDetailSheet);

document.getElementById('addWpFromDetail').addEventListener('click', () => {
    if (waypoints.length >= 5) {
        showPopup('Batasan', 'Maksimal 5 perhentian.');
        return;
    }
    closeDetailSheet();
    waypoints.push({ address: '', lat: null, lng: null, place_id: null, name: null });
    renderMainSheet();
    searchMode = 'waypoint';
    searchWaypointIndex = waypoints.length - 1;
    openSearchSheet('Cari perhentian');
});

// ==================== TAWARAN ====================
document.getElementById('offerInput').addEventListener('input', function() {
    const val = parseInt(this.value);
    if (!isNaN(val) && val > 0) {
        offerPrice = val;
    } else {
        offerPrice = 0;
    }
    updateDetailPriceDisplay();
});

// ==================== DRIVER OFFERS ====================
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
                    <div class="driver-vehicle">${offer.driver_type || selectedTransport?.type || 'Kurir Motor'}</div>
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
            let percent = Math.min(1, Math.max(0, remaining / total));
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
        }
        return removedCount > 0;
    } catch (err) { return false; }
}

async function acceptOffer(driverId) {
    let orderIdToUse = currentOrderId;
    if (!orderIdToUse || orderIdToUse === 'null') {
        orderIdToUse = localStorage.getItem('current_order_id');
    }
    if (!orderIdToUse || orderIdToUse === 'null') {
        showPopup('Error', 'ID order tidak valid');
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
    showPopup('Berhasil', 'Driver dipilih, mengalihkan ke halaman tracking...');
    if (orderIdToUse && orderIdToUse !== 'null') {
        setTimeout(() => { window.location.href = `tracking_customer.html?order_id=${orderIdToUse}`; }, 1500);
    } else {
        showPopup('Error', 'ID order tidak valid, tidak bisa redirect ke tracking');
    }
}

async function rejectOffer(driverId) {
    if (!currentOrderId) return;
    await database.ref(`orders/${currentOrderId}/driver_offers/${driverId}/status`).set('rejected');
}

// ==================== CLEANUP & BATAL ====================
function cleanupDriverOffers(showDetail = true) {
    if (offersListener) {
        database.ref(`orders/${currentOrderId}/driver_offers`).off('value', offersListener);
        offersListener = null;
    }
    if (orderStatusListener) {
        database.ref(`orders/${currentOrderId}/status`).off('value', orderStatusListener);
        orderStatusListener = null;
    }
    if (offerTimerInterval) { clearInterval(offerTimerInterval); offerTimerInterval = null; }
    if (cleanupInterval) { clearInterval(cleanupInterval); cleanupInterval = null; }

    document.getElementById('driverOffers').classList.remove('active');
    currentOrderId = null;

    if (showDetail) {
        detailSheet.classList.add('open');
        mainSheet.classList.remove('open');
        mainSheet.classList.add('closed');
        document.getElementById('detailPickup').innerText = pickup.address;
        document.getElementById('detailDest').innerText = destination.address;
        renderDetailWaypoints();
        updateDetailPriceDisplay();
        document.getElementById('senderPhone').value = document.getElementById('senderPhone').value || currentUser.phone || '';
    }
}

document.getElementById('cancelSearchBtn').addEventListener('click', function() {
    showConfirmPopup('Batalkan Pencarian?', 'Apakah Anda yakin ingin membatalkan pencarian driver kurir?.',
        function() {
            if (currentOrderId) {
                database.ref(`orders/${currentOrderId}`).update({ status: 'cancelled_by_user' });
            }
            cleanupDriverOffers(true);
            showPopup('Info', 'Pencarian dibatalkan. Anda dapat mengedit pesanan kembali.');
        },
        function() {}
    );
});

// ==================== SIMPAN ORDER ====================
document.getElementById('saveOrderBtn').addEventListener('click', async function() {
    const inputVal = parseInt(document.getElementById('offerInput').value);
    if (isNaN(inputVal) || inputVal < minOffer) {
        showPopup('Tawaran Tidak Valid', `Minimal tawaran ${formatRupiah(minOffer)}`, function() {
            closeDetailSheet();
            setTimeout(function() {
                const input = document.getElementById('offerInput');
                if (input) {
                    input.focus();
                    input.select();
                }
            }, 400);
        });
        return;
    }
    offerPrice = inputVal;

    const senderPhone = document.getElementById('senderPhone').value.trim();
    const receiverPhone = document.getElementById('receiverPhone').value.trim();
    const category = document.getElementById('itemCategory').value;
    if (!senderPhone) {
        showPopup('Perhatian', 'Masukkan nomor ponsel pengirim.');
        return;
    }
    if (!receiverPhone) {
        showPopup('Perhatian', 'Masukkan nomor ponsel penerima.');
        return;
    }
    if (!category) {
        showPopup('Perhatian', 'Pilih kategori barang.');
        return;
    }

    showLoading(true);
    const route = await calculateRouteDetails();
    if (!route) {
        showLoading(false);
        showPopup('Error', 'Gagal menghitung rute, periksa alamat dan koneksi.');
        return;
    }
    showLoading(false);

    let feePercent = 7, taxPercent = 11;
    try {
        const potonganSnap = await database.ref('data-jego/potongan').once('value');
        feePercent = potonganSnap.exists() ? parseFloat(potonganSnap.val()) : 7;
        const pajakSnap = await database.ref('data-jego/pajak').once('value');
        taxPercent = pajakSnap.exists() ? parseFloat(pajakSnap.val()) : 11;
    } catch (e) { console.warn('Gagal ambil fee, pakai default'); }

    const orderData = {
        user_id: currentUser.id,
        customer_name: currentUser.name,
        customer_phone: currentUser.phone || '',
        transport_type: selectedTransport.type,
        pickup_address: pickup.address,
        pickup_lat: pickup.lat,
        pickup_lng: pickup.lng,
        destination_address: destination.address,
        dest_lat: destination.lat,
        dest_lng: destination.lng,
        waypoints: waypoints.map(wp => ({ address: wp.address, lat: wp.lat, lng: wp.lng })),
        distance_meters: route.distance,
        duration_seconds: route.duration,
        price: offerPrice,
        fee_percent: feePercent,
        tax_percent: taxPercent,
        sender_phone: senderPhone,
        receiver_phone: receiverPhone,
        item_category: category,
        item_description: document.getElementById('itemDesc').value.trim() || '',
        status: 'waiting',
        created_at: new Date().toISOString(),
        passenger_rating: currentUser.rating,
        perjalanan: currentUser.perjalanan || 0,
        photoURL: currentUser.photoURL || ''
    };

    showLoading(true);
    try {
        const newOrderRef = database.ref('orders').push();
        await newOrderRef.set(orderData);
        await database.ref(`userOrders/${currentUser.id}/${newOrderRef.key}`).set(true);
        currentOrderId = newOrderRef.key;
        localStorage.setItem('current_order_id', currentOrderId);
        showLoading(false);

        detailSheet.classList.remove('open');
        document.getElementById('driverOffers').classList.add('active');
        document.getElementById('driverOfferList').innerHTML = '<div style="text-align:center; padding:16px;">⏳ Menunggu penawaran driver...</div>';

        const offersRef = database.ref(`orders/${currentOrderId}/driver_offers`);
        offersListener = offersRef.on('value', (snap) => {
            renderOffers(snap.val());
        });

        if (offerTimerInterval) clearInterval(offerTimerInterval);
        if (cleanupInterval) clearInterval(cleanupInterval);
        offerTimerInterval = setInterval(() => { updateOfferTimers(); }, 1000);
        cleanupInterval = setInterval(() => { cleanupExpiredOffersCustomer(); }, 10000);

        const orderStatusRef = database.ref(`orders/${currentOrderId}/status`);
        orderStatusListener = orderStatusRef.on('value', (snap) => {
            const status = snap.val();
            if (status === 'accepted') {
                window.location.href = `tracking_customer.html?order_id=${currentOrderId}`;
            } else if (status === 'cancelled' || status === 'cancelled_by_user') {
                cleanupDriverOffers(true);
            }
        });

        showPopup('Pesanan Dibuat', 'Menunggu kurir memberikan tawaran...', null);
    } catch (err) {
        showLoading(false);
        showPopup('Error', 'Gagal menyimpan pesanan: ' + err.message);
    }
});

// ==================== KONTAK ====================
document.getElementById('openContactsBtn').addEventListener('click', function() {
    if (window.Android && typeof window.Android.pickContact === 'function') {
        window.Android.pickContact();
        return;
    }
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.pickContact) {
        window.webkit.messageHandlers.pickContact.postMessage({});
        return;
    }
    const mockNumber = prompt('Masukkan nomor kontak (mock):', '08123456789');
    if (mockNumber !== null) {
        document.getElementById('receiverPhone').value = mockNumber;
    }
});
window.onContactPicked = function(phoneNumber) {
    if (phoneNumber) {
        document.getElementById('receiverPhone').value = phoneNumber;
    }
};

// ==================== CLOSE MAIN SHEET ====================
document.getElementById('closeMainSheet').addEventListener('click', () => {
    showConfirmPopup('Keluar?', 'Data alamat yang belum disimpan akan hilang. Yakin ingin keluar?',
        () => { window.history.back(); },
        () => {}
    );
});

// ==================== INIT ====================
window.onload = async () => {
    if (localStorage.getItem('jego_dark_mode') === 'true') {
        document.body.classList.add('dark-mode');
    }

    const loggedIn = await checkUserSession().catch(() => false);
    if (!loggedIn) return;

    await fetchTransportData();

    if (typeof google === 'undefined' || !google.maps) {
        showPopup('Error', 'Google Maps tidak dapat dimuat. Periksa koneksi internet.');
        return;
    }

    initMap();
    renderMainSheet();
};

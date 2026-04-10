/* ═══════════════════════════════════════════════════
   WEDDING PHOTO BOOTH — app.js
   ═══════════════════════════════════════════════════ */

// ── WEDDING CONFIG ──────────────────────────────────
const WEDDING = {
  names: 'María & Carlos',
  date:  '30 · Marzo · 2026',
};

// ── ADMIN CONFIG ─────────────────────────────────────
// Cambia este PIN antes de desplegar
const ADMIN_PIN = '2603';

// ── CAPTURE DIMENSIONS ───────────────────────────────
const CAPTURE_W = 1080;
const CAPTURE_H = 1920;

// ── FILTER OVERLAY ───────────────────────────────────
const overlayImg = new Image();
overlayImg.src = 'overlay.png';

// ── FIREBASE CONFIG (optional) ──────────────────────
// Fill this in to enable real-time cross-device gallery sharing.
// Leave empty ({}) to use local storage only.
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyDfeE4i2oVsgPt5V9LnpouZzAq2Nq6--sI",
  authDomain:        "fibo-38afb.firebaseapp.com",
  projectId:         "fibo-38afb",
  storageBucket:     "fibo-38afb.firebasestorage.app",
  messagingSenderId: "619724835025",
  appId:             "1:619724835025:web:1cb51eebe8fc583eec1df0",
};

/* ═══════════════════════════════════════════════════
   STATE
   ═══════════════════════════════════════════════════ */
let stream          = null;
let facingMode      = 'user'; // 'user' (front) | 'environment' (back)
let photos          = [];     // { id, url, timestamp }
let capturedDataURL = null;
let useFirebase     = false;
let adminMode       = sessionStorage.getItem('admin') === '1';

/* ═══════════════════════════════════════════════════
   DOM REFS
   ═══════════════════════════════════════════════════ */
const $ = id => document.getElementById(id);
const video          = $('video');
const previewCanvas  = $('preview-canvas');
const previewCtx     = previewCanvas.getContext('2d');
const countdown      = $('countdown');
const flash          = $('flash');
const captureBtn     = $('capture-btn');
const flipBtn        = $('flip-btn');
const openGalleryBtn = $('open-gallery-btn');
const backBtn        = $('back-btn');
const retakeBtn      = $('retake-btn');
const saveBtn        = $('save-btn');
const photoGrid      = $('photo-grid');
const emptyState     = $('empty-state');
const photoCount     = $('photo-count');
const galleryCount   = $('gallery-count');
const modal          = $('photo-modal');
const modalImg       = $('modal-img');
const downloadBtn    = $('download-btn');
const closeModalBtn  = $('close-modal-btn');
const modalBackdrop  = modal.querySelector('.modal-backdrop');
const bgMusic        = $('bg-music');
const filterOverlayEl = $('filter-overlay');
const musicBtn       = $('music-btn');
const musicIconOn    = $('music-icon-on');
const musicIconOff   = $('music-icon-off');
let musicMuted = false;

const adminModal       = $('admin-modal');
const adminPinInput    = $('admin-pin-input');
const adminPinError    = $('admin-pin-error');
const adminPinConfirm  = $('admin-pin-confirm');
const adminPinCancel   = $('admin-pin-cancel');

/* ═══════════════════════════════════════════════════
   FIREBASE INIT
   ═══════════════════════════════════════════════════ */
function initFirebase() {
  if (!FIREBASE_CONFIG.apiKey) return;
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    useFirebase = true;
    console.log('[Firebase] Initialized – real-time sharing enabled.');
    subscribeToPhotos();
  } catch (e) {
    console.warn('[Firebase] Init failed:', e.message);
  }
}

async function savePhotoFirebase(dataURL) {
  // Compress to max 900px wide / quality 0.65 to stay well under Firestore's 1MB doc limit
  const compressed = await compressImage(dataURL, 900, 0.65);
  const id = `photo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  await firebase.firestore().collection('photos').doc(id).set({
    url:       compressed,
    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
  });
}

function compressImage(dataURL, maxWidth, quality) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const scale  = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = dataURL;
  });
}

function subscribeToPhotos() {
  firebase.firestore()
    .collection('photos')
    .orderBy('timestamp', 'desc')
    .onSnapshot(snap => {
      photos = snap.docs.map(d => ({ id: d.id, url: d.data().url }));
      renderGallery();
    });
}

/* ═══════════════════════════════════════════════════
   LOCAL STORAGE FALLBACK
   ═══════════════════════════════════════════════════ */
function savePhotoLocal(dataURL) {
  const id = `photo_${Date.now()}`;
  photos.unshift({ id, url: dataURL });
  if (photos.length > 200) photos = photos.slice(0, 200);
  try {
    localStorage.setItem('wedding_photos', JSON.stringify(photos));
  } catch (_) { /* storage full */ }
  renderGallery();
}

function loadPhotosLocal() {
  try {
    const raw = localStorage.getItem('wedding_photos');
    if (raw) photos = JSON.parse(raw);
  } catch (_) {}
  renderGallery();
}

/* ═══════════════════════════════════════════════════
   CAMERA
   ═══════════════════════════════════════════════════ */
async function startCamera() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode, width: { ideal: CAPTURE_W }, height: { ideal: CAPTURE_H } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
  } catch (err) {
    console.error('Camera error:', err);
    alert('No se pudo acceder a la cámara. Asegúrate de dar permiso.');
  }
}

/* ═══════════════════════════════════════════════════
   CAPTURE
   ═══════════════════════════════════════════════════ */
function triggerCountdown() {
  captureBtn.disabled = true;
  let count = 3;
  countdown.textContent = count;
  countdown.classList.remove('hidden');

  const interval = setInterval(() => {
    count--;
    if (count > 0) {
      countdown.textContent = count;
    } else {
      clearInterval(interval);
      countdown.classList.add('hidden');
      capturePhoto();
      captureBtn.disabled = false;
    }
  }, 1000);
}

function capturePhoto() {
  // Flash effect
  flash.classList.remove('hidden', 'go');
  void flash.offsetWidth;
  flash.classList.add('go');
  setTimeout(() => flash.classList.add('hidden'), 500);

  const vw = video.videoWidth  || video.offsetWidth;
  const vh = video.videoHeight || video.offsetHeight;
  const isLandscape = vw > vh;

  // Canvas siempre portrait (igual que Instagram Stories)
  // Si el video es landscape: ancho = vh, alto = vw → crop central sin rotación
  const cw = isLandscape ? vh : vw;
  const ch = isLandscape ? vw : vh;

  const cap = document.createElement('canvas');
  cap.width  = cw;
  cap.height = ch;
  const capCtx = cap.getContext('2d');

  // Cover fit: escala el video para llenar el canvas portrait, recorta los lados
  const scale   = Math.max(cw / vw, ch / vh);
  const drawW   = vw * scale;
  const drawH   = vh * scale;
  const offsetX = (cw - drawW) / 2;
  const offsetY = (ch - drawH) / 2;

  if (facingMode === 'user') {
    capCtx.translate(cw, 0);
    capCtx.scale(-1, 1);
  }
  capCtx.drawImage(video, offsetX, offsetY, drawW, drawH);

  // Overlay completo sobre el canvas portrait
  capCtx.setTransform(1, 0, 0, 1, 0, 0);
  if (overlayImg.complete && overlayImg.naturalWidth > 0) {
    capCtx.drawImage(overlayImg, 0, 0, cw, ch);
  }

  capturedDataURL = cap.toDataURL('image/jpeg', 0.92);

  previewCanvas.width  = cw;
  previewCanvas.height = ch;
  previewCtx.drawImage(cap, 0, 0);

  showScreen('screen-preview');
}

/* ═══════════════════════════════════════════════════
   GALLERY
   ═══════════════════════════════════════════════════ */
function renderGallery() {
  [...photoGrid.children].forEach(el => {
    if (el !== emptyState) el.remove();
  });

  if (photos.length === 0) {
    emptyState.classList.remove('hidden');
    galleryCount.textContent = '0 fotos';
    photoCount.classList.add('hidden');
    return;
  }

  emptyState.classList.add('hidden');
  galleryCount.textContent = `${photos.length} foto${photos.length !== 1 ? 's' : ''}`;
  photoCount.textContent   = photos.length > 99 ? '99+' : photos.length;
  photoCount.classList.remove('hidden');

  photos.forEach(photo => {
    const div = document.createElement('div');
    div.className = 'photo-thumb';
    const img = document.createElement('img');
    img.src     = photo.url;
    img.alt     = 'Foto de boda';
    img.loading = 'lazy';
    const overlay = document.createElement('div');
    overlay.className = 'thumb-overlay';
    overlay.innerHTML = '<span class="download-icon">📥</span>';
    div.append(img, overlay);
    div.addEventListener('click', () => openModal(photo.url));

    if (adminMode) {
      const delBtn = document.createElement('button');
      delBtn.className = 'delete-photo-btn';
      delBtn.title = 'Borrar foto';
      delBtn.innerHTML = '🗑';
      delBtn.addEventListener('click', e => { e.stopPropagation(); deletePhoto(photo.id); });
      div.append(delBtn);
    }

    photoGrid.prepend(div);
  });
}

function openModal(url) {
  modalImg.src = url;
  modal.classList.remove('hidden');
  downloadBtn.onclick = () => {
    const a = document.createElement('a');
    a.href     = url;
    a.download = `boda-${Date.now()}.jpg`;
    a.click();
  };
}

function closeModal() {
  modal.classList.add('hidden');
  modalImg.src = '';
}

/* ═══════════════════════════════════════════════════
   SCREEN NAVIGATION
   ═══════════════════════════════════════════════════ */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.toggle('active', s.id === id);
    s.classList.toggle('hidden', s.id !== id);
  });
  if (id === 'screen-gallery') {
    if (!musicMuted) bgMusic.play().catch(() => {});
  } else {
    bgMusic.pause();
  }
}

function toggleMusic() {
  musicMuted = !musicMuted;
  musicIconOn.classList.toggle('hidden', musicMuted);
  musicIconOff.classList.toggle('hidden', !musicMuted);
  if (musicMuted) {
    bgMusic.pause();
  } else {
    bgMusic.play().catch(() => {});
  }
}

/* ═══════════════════════════════════════════════════
   EVENT LISTENERS
   ═══════════════════════════════════════════════════ */
captureBtn.addEventListener('click', capturePhoto);

flipBtn.addEventListener('click', () => {
  facingMode = facingMode === 'user' ? 'environment' : 'user';
  startCamera();
});

openGalleryBtn.addEventListener('click', () => showScreen('screen-gallery'));
backBtn.addEventListener('click',        () => showScreen('screen-camera'));

retakeBtn.addEventListener('click', () => {
  capturedDataURL = null;
  showScreen('screen-camera');
});

saveBtn.addEventListener('click', async () => {
  if (!capturedDataURL) return;
  saveBtn.disabled    = true;
  saveBtn.textContent = 'Guardando…';
  try {
    if (useFirebase) {
      await savePhotoFirebase(capturedDataURL);
    } else {
      savePhotoLocal(capturedDataURL);
    }
    showScreen('screen-gallery');
  } catch (err) {
    console.error('Save error:', err);
    alert('No se pudo guardar la foto. Inténtalo de nuevo.');
  } finally {
    saveBtn.disabled    = false;
    saveBtn.textContent = 'Guardar ✓';
    capturedDataURL     = null;
  }
});

closeModalBtn.addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', closeModal);
musicBtn.addEventListener('click', toggleMusic);

adminPinConfirm.addEventListener('click', submitAdminPin);
adminPinCancel.addEventListener('click',  closeAdminModal);
adminPinInput.addEventListener('keydown', e => { if (e.key === 'Enter') submitAdminPin(); });

/* ═══════════════════════════════════════════════════
   ADMIN
   ═══════════════════════════════════════════════════ */
function checkAdminHash() {
  if (window.location.hash === '#admin') {
    history.replaceState(null, '', window.location.pathname);
    if (!adminMode) openAdminModal();
  }
}

window.addEventListener('hashchange', checkAdminHash);

function openAdminModal() {
  adminPinInput.value = '';
  adminPinError.classList.add('hidden');
  adminModal.classList.remove('hidden');
  setTimeout(() => adminPinInput.focus(), 100);
}

function closeAdminModal() {
  adminModal.classList.add('hidden');
}

function submitAdminPin() {
  if (adminPinInput.value === ADMIN_PIN) {
    adminMode = true;
    sessionStorage.setItem('admin', '1');
    closeAdminModal();
    renderGallery();
    showScreen('screen-gallery');
  } else {
    adminPinError.classList.remove('hidden');
    adminPinInput.value = '';
    adminPinInput.focus();
  }
}

async function deletePhoto(id) {
  if (!confirm('¿Borrar esta foto?')) return;
  if (useFirebase) {
    await firebase.firestore().collection('photos').doc(id).delete();
  } else {
    photos = photos.filter(p => p.id !== id);
    try { localStorage.setItem('wedding_photos', JSON.stringify(photos)); } catch (_) {}
    renderGallery();
  }
}

/* ═══════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════ */
(async function init() {
  checkAdminHash();
  initFirebase();
  if (!useFirebase) loadPhotosLocal();
  await startCamera();
})();

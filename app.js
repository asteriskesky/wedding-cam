// Zawa & Rayyan's Wedding Photo App
const CONFIG = {
  // ── Cloudinary: free image/video hosting (25 GB, no credit card) ───────
  cloudinary: {
    cloudName: 'dxfzmuldc',
    uploadPreset: 'wedding-cam',
  },

  // ── Firebase: auth + Firestore metadata only (free Spark plan) ──────────
  firebase: {
    enabled: true,
    apiKey: 'AIzaSyDsvtADJaJVYGDBfcgraLGfTjWfoFRtIJA',
    authDomain: 'zawa-rayyan-wedding.firebaseapp.com',
    projectId: 'zawa-rayyan-wedding',
    storageBucket: 'zawa-rayyan-wedding.firebasestorage.app',
    messagingSenderId: '513049560495',
    appId: '1:513049560495:web:4363a43778e649b6ee1b5a',
    measurementId: 'G-S1YRG6WZHR',
  },
  wedding: {
    couple: "Zawa & Rayyan",
    events: ['retro', 'mehendi', 'nikah'],
    eventLabels: { retro: 'Retro', mehendi: 'Mehendi', nikah: 'Nikah' },
  },
};

// ── INDEXED_DB (Ghost Backup) ──────────────────────────────
const IDB_NAME = 'WeddingGhostBackup';
const IDB_VERSION = 1;
const STORE_NAME = 'media';

const dbPromise = new Promise((resolve, reject) => {
  const request = indexedDB.open(IDB_NAME, IDB_VERSION);
  request.onupgradeneeded = (e) => {
    const db = e.target.result;
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      db.createObjectStore(STORE_NAME, { keyPath: 'id' });
    }
  };
  request.onsuccess = (e) => resolve(e.target.result);
  request.onerror = (e) => reject(e.target.error);
});

async function saveToGhostBackup(photo) {
  try {
    const db = await dbPromise;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    // We store the full photo object including blob
    await store.put({
      ...photo,
      synced: false,
      ts: photo.ts || Date.now()
    });
    return true;
  } catch (err) {
    console.warn('Ghost Backup failed:', err);
    return false;
  }
}

async function markAsSynced(id) {
  try {
    const db = await dbPromise;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const item = await new Promise((res, rej) => {
      const g = store.get(id);
      g.onsuccess = () => res(g.result);
      g.onerror = () => rej(g.error);
    });
    if (item) {
      item.synced = true;
      await store.put(item);
    }
  } catch (err) { console.warn('Sync marking failed:', err); }
}

async function getUnsyncedMedia() {
  try {
    const db = await dbPromise;
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    return new Promise((res) => {
      const items = [];
      store.openCursor().onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          if (!cursor.value.synced) items.push(cursor.value);
          cursor.continue();
        } else {
          res(items);
        }
      };
    });
  } catch (err) { return []; }
}

async function cleanupOldBackups() {
  // Keep only last 48 hours of synced backups to save guest space
  try {
    const db = await dbPromise;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const now = Date.now();
    const expiry = 48 * 60 * 60 * 1000;

    store.openCursor().onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        if (cursor.value.synced && (now - cursor.value.ts > expiry)) {
          cursor.delete();
        }
        cursor.continue();
      }
    };
  } catch (e) { }
}

// UTILITIES

/**
 * Returns the default event based on the current date:
 * - April 2nd: Mehendi
 * - April 4th: Nikah
 * - Otherwise: Retro
 */
function getDefaultEvent() {
  const now = new Date();
  const month = now.getMonth(); // 0 is January, 3 is April
  const date = now.getDate();

  if (month === 3) { // April
    if (date === 2) return 'mehendi';
    if (date === 4) return 'nikah';
  }
  return 'retro';
}

/**
 * Collects a non-invasive device fingerprint for security/audit.
 * This helps identifying miscreants while respecting privacy.
 */
function getDeviceMeta() {
  const { width, height } = window.screen;
  return {
    ua: navigator.userAgent,
    plt: navigator.platform,
    lang: navigator.language,
    scr: `${width}x${height}`,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    hc: navigator.hardwareConcurrency || 'n/a',
    mem: navigator.deviceMemory || 'n/a',
    ref: document.referrer || 'direct'
  };
}

// FIREBASE REFERENCES
let db = null;   // Firestore
let fbAuth = null;   // Firebase Auth
let currentUid = null;   // Logged-in anonymous UID

// Active Firestore real-time listener (unsubscribe fn)
let photosUnsubscribe = null;

const LIMITS = {
  photo: 10 * 1024 * 1024,   // 10MB Cloudinary limit
  video: 100 * 1024 * 1024,  // 100MB Cloudinary limit
};

// STATE
let state = {
  guest: { name: '', avatar: '🌸' },
  mode: 'camera',            // 'camera' | 'gallery' | 'gallery-preview'
  activeEvent: getDefaultEvent(),
  cameraStream: null,
  facingMode: 'environment', // 'user' | 'environment'
  flashEnabled: false,
  isRecording: false,
  mediaRecorder: null,
  recordedChunks: [],
  recordedSize: 0,
  recordingStartTime: null,
  recordingTimer: null,
  photos: [],                // normalised [{id, srcUrl, guestName, guestAvatar, event, type, ts}]
  exploreFilter: { event: 'all', guest: 'all', type: 'all', search: '', myPhotosOnly: false },
  photoPage: 0,
  photosPerPage: 12,
  multiselect: false,
  selectedIds: new Set(),
  lightboxPhoto: null,
  pendingBatch: [],
  // Camera Filters
  filters: {
    aperture: 0,
    brightness: 1,
    portrait: false,
    retro: false,
    monochrome: false,
    vignette: false,
    lowlight: false
  },
  prefs: {
    autosave: false
  }
};

// AVATAR PICKER
const AVATARS = [
  '🌸', '💍', '🕊️', '✨', '🌹', '🎊', '💫', '👑', '🌺', '🌙',
  '🦋', '🍃', '🌷', '🪷', '❤️', '🌟', '🎉', '🥂', '🕌', '🌼',
];

function initAvatarGrid() {
  const grid = document.getElementById('avatar-grid');
  grid.innerHTML = '';
  AVATARS.forEach(emoji => {
    const btn = document.createElement('button');
    btn.className = 'avatar-option';
    btn.textContent = emoji;
    btn.setAttribute('aria-label', `Select avatar ${emoji}`);
    btn.onclick = () => selectAvatar(emoji, btn);
    grid.appendChild(btn);
  });
  grid.firstChild?.classList.add('selected');
  state.guest.avatar = AVATARS[0];
}

function selectAvatar(emoji, btn) {
  document.querySelectorAll('.avatar-option').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  state.guest.avatar = emoji;
}

// ONBOARDING FLOW
function showStep(id) {
  document.querySelectorAll('.welcome-step').forEach(s => s.classList.add('hidden'));
  const el = document.getElementById(id);
  el.classList.remove('hidden');
  el.style.animation = 'none';
  requestAnimationFrame(() => { el.style.animation = 'fadeUp 0.45s ease both'; });
}

function goToAvatar() {
  const nameInput = document.getElementById('guest-name-input');
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.focus();
    nameInput.style.borderColor = 'rgba(200,80,80,0.6)';
    setTimeout(() => nameInput.style.borderColor = '', 1500);
    return;
  }
  state.guest.name = name;
  initAvatarGrid();
  showStep('step-avatar');
}

async function enterApp() {
  // Save guest locally and to Firestore
  saveGuestLocal();
  await saveGuestRemote();

  updateHeaderAvatar();
  showScreen('screen-app');
  selectTab(getDefaultEvent());
  loadAppPreferences();
  startCamera();
}

// GUEST PERSISTENCE

// ── Local (fallback) ──────────────────────────────────────
const GUEST_KEY = 'wedding_guest_v2';

function saveGuestLocal() {
  localStorage.setItem(GUEST_KEY, JSON.stringify({
    name: state.guest.name,
    avatar: state.guest.avatar,
    uid: currentUid,
  }));
}

function loadGuestLocal() {
  try {
    const raw = localStorage.getItem(GUEST_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    state.guest = { name: data.name || '', avatar: data.avatar || '🌸' };
    return !!state.guest.name;
  } catch { return false; }
}

// ── Remote (Firebase) ─────────────────────────────────────
async function saveGuestRemote() {
  if (!db || !currentUid) return;
  try {
    await db.collection('users').doc(currentUid).set({
      name: state.guest.name,
      avatar: state.guest.avatar,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
      meta: getDeviceMeta(),
    }, { merge: true });
  } catch (e) { console.warn('Firestore user save failed:', e); }
}

async function updateLastSeen() {
  if (!db || !currentUid) return;
  try {
    await db.collection('users').doc(currentUid).update({
      lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch { }
}

// ── Preferences (App Settings) ────────────────────────────
function saveAppPreferences() {
  state.prefs.autosave = document.getElementById('pref-autosave').checked;
  localStorage.setItem('wedding_prefs', JSON.stringify(state.prefs));
  if (state.prefs.autosave) showToast('✦ Auto-save enabled');
}

function loadAppPreferences() {
  try {
    const raw = localStorage.getItem('wedding_prefs');
    if (raw) {
      state.prefs = JSON.parse(raw);
      document.getElementById('pref-autosave').checked = !!state.prefs.autosave;
    }
  } catch (e) { }
}

// SCREEN MANAGEMENT
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active');
    s.classList.add('hidden');
  });
  const target = document.getElementById(id);
  target.classList.remove('hidden');
  requestAnimationFrame(() => target.classList.add('active'));
}

function updateHeaderAvatar() {
  document.getElementById('header-avatar-emoji').textContent = state.guest.avatar;
  document.getElementById('menu-avatar-emoji').textContent = state.guest.avatar;
  document.getElementById('menu-name-display').textContent = state.guest.name ? `Hey ${state.guest.name} 👋🏻` : 'Hey Guest 👋🏻';
}

function showProfile() { toggleMenu(); }

async function resetUser() {
  // 1. Clear local state synchronously
  localStorage.removeItem(GUEST_KEY);
  state.guest = { name: '', avatar: '🌸' };
  currentUid = null;

  // 2. Stop hardware
  stopCamera();

  // 3. Immediate UI transition for responsiveness
  showScreen('screen-welcome');
  showStep('step-greet');

  // 4. Firebase sign out (async)
  if (fbAuth) {
    try {
      await fbAuth.signOut();
    } catch (e) {
      console.warn('Firebase signout error:', e);
    }
  }
}

// TAB MANAGEMENT
function selectTab(event) {
  CONFIG.wedding.activeEvent = event;
  state.activeEvent = event;

  // Update internal state
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(t => t.classList.remove('active'));

  // Find all tabs for this event (could be in main or explore)
  const eventTabs = document.querySelectorAll(`[id="tab-${event}"], [onclick*="selectTab('${event}')"]`);
  eventTabs.forEach(t => t.classList.add('active'));

  // Update UI labels
  const label = document.getElementById('event-label-main');
  if (label) label.innerText = CONFIG.wedding.eventLabels[event];

  // CORE NAVIGATION FIX:
  // When switching tabs/events, always return to the camera view
  if (document.getElementById('screen-explore') && !document.getElementById('screen-explore').classList.contains('hidden')) {
    closeExplore();
  }

  setMode('camera');
  console.log("Selected event:", event);
}

// CAMERA
async function startCamera() {
  const video = document.getElementById('camera-feed');
  const placeholder = document.getElementById('camera-placeholder');
  try {
    if (state.cameraStream) state.cameraStream.getTracks().forEach(t => t.stop());

    // Request BOTH video and audio for video capture support
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: state.facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: true, // Enable audio for videos
    });
    state.cameraStream = stream;
    video.srcObject = stream;
    video.classList.remove('hidden');
    placeholder.classList.add('hidden');
    document.getElementById('btn-flash').style.display = 'flex';
    video.style.transform = state.facingMode === 'user' ? 'scaleX(-1)' : 'none';
    setMode('camera');
  } catch (err) {
    console.warn('Camera error:', err);
    placeholder.classList.remove('hidden');
    video.classList.add('hidden');
  }
}

function stopCamera() {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach(t => t.stop());
    state.cameraStream = null;
  }
}

async function flipCamera() {
  state.facingMode = state.facingMode === 'user' ? 'environment' : 'user';
  await startCamera();
}

function toggleFlash() {
  state.flashEnabled = !state.flashEnabled;
  const btn = document.getElementById('btn-flash');
  btn.classList.toggle('active', state.flashEnabled);
  btn.style.opacity = state.flashEnabled ? '1' : '0.5';
  if (state.cameraStream) {
    const track = state.cameraStream.getVideoTracks()[0];
    if (track?.getCapabilities?.().torch) {
      track.applyConstraints({ advanced: [{ torch: state.flashEnabled }] });
    }
  }
}

// ADVANCED CAMERA OPTIONS
function toggleCameraOptions() {
  const panel = document.getElementById('camera-options-panel');
  panel.classList.toggle('hidden');
}

function updateCameraFilter() {
  const aperture = document.getElementById('input-aperture').value;
  const brightness = document.getElementById('input-brightness').value;
  state.filters.aperture = parseFloat(aperture);
  state.filters.brightness = parseFloat(brightness);

  const video = document.getElementById('camera-feed');
  let filterStr = `brightness(${state.filters.brightness}) blur(${state.filters.aperture}px)`;

  if (state.filters.retro) {
    filterStr += ` sepia(0.3) contrast(1.1) saturate(0.9)`;
  }

  if (state.filters.monochrome) {
    filterStr += ` grayscale(1) contrast(1.1)`;
  }

  if (state.filters.lowlight) {
    filterStr += ` brightness(1.4) contrast(0.8) saturate(1.2)`;
  }

  video.style.filter = filterStr;
}

function togglePortraitMode() {
  state.filters.portrait = !state.filters.portrait;
  const btn = document.getElementById('btn-portrait');
  const container = document.getElementById('camera-area');

  btn.classList.toggle('active', state.filters.portrait);
  container.classList.toggle('portrait-mode-active', state.filters.portrait);
}

function toggleRetroFilter() {
  state.filters.retro = !state.filters.retro;
  const btn = document.getElementById('btn-retro-filter');
  btn.classList.toggle('active', state.filters.retro);
  updateCameraFilter();
}

function toggleBWFilter() {
  state.filters.monochrome = !state.filters.monochrome;
  const btn = document.getElementById('btn-bw-filter');
  btn.classList.toggle('active', state.filters.monochrome);
  updateCameraFilter();
}

function toggleVignette() {
  state.filters.vignette = !state.filters.vignette;
  const btn = document.getElementById('btn-vignette');
  const container = document.getElementById('camera-area');
  btn.classList.toggle('active', state.filters.vignette);
  container.classList.toggle('vignette-active', state.filters.vignette);
}

function toggleLowLight() {
  state.filters.lowlight = !state.filters.lowlight;
  const btn = document.getElementById('btn-lowlight');
  btn.classList.toggle('active', state.filters.lowlight);
  updateCameraFilter();
}

function resetCameraFilters() {
  state.filters = { aperture: 0, brightness: 1, portrait: false, retro: false, monochrome: false, vignette: false, lowlight: false };

  document.getElementById('input-aperture').value = 0;
  document.getElementById('input-brightness').value = 1;
  document.querySelectorAll('.option-pills').forEach(b => b.classList.remove('active'));

  document.getElementById('camera-area').classList.remove('portrait-mode-active');
  document.getElementById('camera-area').classList.remove('vignette-active');

  updateCameraFilter();
  showToast('✦ Filters reset');
}

// MODE SWITCHING
function setMode(mode) {
  state.mode = mode;
  const video = document.getElementById('camera-feed');
  const preview = document.getElementById('preview-image');
  document.getElementById('btn-cam-mode').classList.toggle('active', mode === 'camera');
  document.getElementById('btn-gal-mode').classList.toggle('active', mode === 'gallery');

  if (mode === 'camera') {
    video.classList.remove('hidden');
    preview.classList.add('hidden');
  } else {
    video.classList.add('hidden');
    preview.classList.add('hidden');
    document.getElementById('gallery-input').click();
  }
}

function handleGalleryFile(event) {
  const files = Array.from(event.target.files);
  if (!files.length) { setMode('camera'); return; }

  state.pendingBatch = [];
  const grid = document.getElementById('batch-preview-grid');
  const linksContainer = document.getElementById('batch-links-container');
  const notice = document.getElementById('large-file-notice');

  grid.innerHTML = '';
  linksContainer.innerHTML = '';
  notice.classList.add('hidden');

  document.getElementById('batch-event-select').value = state.activeEvent;
  document.getElementById('batch-count').textContent = files.length;

  let hasLargeFiles = false;

  files.forEach((file, index) => {
    const isVideo = file.type.startsWith('video/');
    const limit = isVideo ? LIMITS.video : LIMITS.photo;
    const isTooLarge = file.size > limit;
    const id = Date.now() + index;
    const previewUrl = URL.createObjectURL(file);

    state.pendingBatch.push({ id, file, dataUrl: previewUrl, type: isVideo ? 'video' : 'photo', isTooLarge });

    // Preview
    const item = document.createElement('div');
    item.className = `batch-preview-item ${isTooLarge ? 'too-large' : ''}`;
    item.id = `batch-item-${id}`;

    let media = isVideo ? `<video src="${previewUrl}" muted></video>` : `<img src="${previewUrl}" alt="" />`;
    let badge = isTooLarge ? `<div class="too-large-badge">⚠️<br/>Large File</div>` : '';

    item.innerHTML = `
      ${media}
      ${badge}
      <button class="batch-remove-btn" onclick="removeFromBatch(${id})">✕</button>
    `;
    grid.appendChild(item);

    if (isTooLarge) {
      hasLargeFiles = true;
      const input = document.createElement('input');
      input.type = 'url';
      input.className = 'gold-input';
      input.id = `link-for-${id}`;
      input.placeholder = `Paste Drive/Cloud link for ${file.name.slice(0, 15)}...`;
      input.style.fontSize = '12px';
      input.style.padding = '10px';
      linksContainer.appendChild(input);
    }
  });

  if (hasLargeFiles) notice.classList.remove('hidden');

  document.getElementById('batch-modal').classList.remove('hidden');
  event.target.value = '';
}

function removeFromBatch(id) {
  state.pendingBatch = state.pendingBatch.filter(item => item.id !== id);
  const el = document.getElementById(`batch-item-${id}`);
  if (el) el.remove();
  const input = document.getElementById(`link-for-${id}`);
  if (input) input.remove();

  const hasLarge = state.pendingBatch.some(it => it.isTooLarge);
  if (!hasLarge) document.getElementById('large-file-notice').classList.add('hidden');

  document.getElementById('batch-count').textContent = state.pendingBatch.length;
  if (state.pendingBatch.length === 0) closeBatchModal();
}

/**
 * Generates a lightweight JPEG thumbnail for large files so we can
 * still show a preview in the gallery even if the video is on GDrive.
 */
async function generateThumbnail(file, type) {
  const url = URL.createObjectURL(file);
  return new Promise((resolve) => {
    if (type === 'photo') {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX = 480;
        let w = img.width; let h = img.height;
        if (w > h) { if (w > MAX) { h *= MAX / w; w = MAX; } }
        else { if (h > MAX) { w *= MAX / h; h = MAX; } }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.65));
      };
      img.src = url;
    } else {
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.onloadeddata = () => {
        video.currentTime = 0.5; // grab frame at 0.5s
      };
      video.onseeked = () => {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.65));
      };
      video.src = url;
      video.load();
    }
  });
}

function closeBatchModal() {
  document.getElementById('batch-modal').classList.add('hidden');
  state.pendingBatch = [];
  setMode('camera');
}

async function startBatchUpload() {
  const event = document.getElementById('batch-event-select').value;
  const count = state.pendingBatch.length;
  if (!count) return;

  const btn = document.getElementById('btn-batch-upload');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = 'Uploading...';

  // Process all uploads
  const uploadPromises = state.pendingBatch.map(async (item) => {
    const linkInput = document.getElementById(`link-for-${item.id}`);
    const externalLink = linkInput ? linkInput.value.trim() : null;

    // Use a thumbnail for external links so we still have a nice preview in the gallery
    const dataUrl = item.isTooLarge
      ? await generateThumbnail(item.file, item.type)
      : item.dataUrl;

    const photo = {
      id: `photo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      dataUrl,
      guestName: state.guest.name,
      guestAvatar: state.guest.avatar,
      uid: currentUid,
      event: event,
      type: item.type,
      ts: Date.now(),
      externalUrl: externalLink,
      isExternal: !!externalLink
    };

    // Optimistically add to state for instant UI update behind modal
    state.photos.unshift({ ...photo, srcUrl: photo.dataUrl });

    if (CONFIG.firebase.enabled) {
      return uploadPhotoToFirebase(photo, true); // Added 'silent' flag
    } else {
      return Promise.resolve();
    }
  });

  try {
    showToast(`Sharing ${count} moments with the Collective...`);
    await Promise.all(uploadPromises);
    if (!CONFIG.firebase.enabled) {
      savePhotosLocal();
    }
  } catch (err) {
    console.error('Batch upload error:', err);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
    document.getElementById('batch-modal').classList.add('hidden');
    state.pendingBatch = [];
    renderPhotoGrid();
    showToast('All moments shared successfully! ✦');
    setMode('camera');
  }
}

// CAPTURE
async function capturePhoto() {
  const btn = document.getElementById('capture-btn');
  btn.classList.add('flash');
  setTimeout(() => btn.classList.remove('flash'), 500);

  let dataUrl = null;
  let type = 'photo';

  if (state.mode === 'gallery-preview' && state._pendingGalleryFile) {
    dataUrl = state._pendingGalleryFile.dataUrl;
    type = state._pendingGalleryFile.type;
    state._pendingGalleryFile = null;
    setMode('camera');
  } else if (state.mode === 'camera' && state.cameraStream) {
    const video = document.getElementById('camera-feed');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');

    // Apply Filters (Brightness, Aperture/Blur, Retro, Monochrome)
    let filters = [];
    if (state.filters.brightness !== 1) filters.push(`brightness(${state.filters.brightness})`);
    if (state.filters.aperture > 0) filters.push(`blur(${state.filters.aperture}px)`);
    if (state.filters.retro) filters.push(`sepia(0.3) contrast(1.1) saturate(0.9)`);
    if (state.filters.monochrome) filters.push(`grayscale(1) contrast(1.1)`);
    if (state.filters.lowlight) filters.push(`brightness(1.4) contrast(0.8) saturate(1.2)`);

    if (filters.length > 0) ctx.filter = filters.join(' ');

    if (state.facingMode === 'user') { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }

    if (state.filters.portrait) {
      // Draw sharp base
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = canvas.width;
      tempCanvas.height = canvas.height;
      const tctx = tempCanvas.getContext('2d');
      tctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Draw blurred version on main canvas
      ctx.save();
      ctx.filter = (ctx.filter !== 'none' ? ctx.filter + ' ' : '') + 'blur(12px)';
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      ctx.restore();

      // Mask out the center of the blurred version to reveal sharp version
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = canvas.width;
      maskCanvas.height = canvas.height;
      const mctx = maskCanvas.getContext('2d');
      const grad = mctx.createRadialGradient(
        canvas.width * 0.5, canvas.height * 0.45, 0,
        canvas.width * 0.5, canvas.height * 0.45, canvas.height * 0.7
      );
      grad.addColorStop(0.15, 'rgba(0,0,0,1)');
      grad.addColorStop(0.65, 'rgba(0,0,0,0)');
      mctx.fillStyle = grad;
      mctx.fillRect(0, 0, canvas.width, canvas.height);

      const sharpPart = document.createElement('canvas');
      sharpPart.width = canvas.width;
      sharpPart.height = canvas.height;
      const sctx = sharpPart.getContext('2d');
      sctx.drawImage(tempCanvas, 0, 0);
      sctx.globalCompositeOperation = 'destination-in';
      sctx.drawImage(maskCanvas, 0, 0);

      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(sharpPart, 0, 0);
    } else {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    }

    if (state.filters.vignette) {
      const vGrad = ctx.createRadialGradient(
        canvas.width / 2, canvas.height / 2, 0,
        canvas.width / 2, canvas.height / 2, canvas.height * 0.9
      );
      vGrad.addColorStop(0, 'rgba(0,0,0,0)');
      vGrad.addColorStop(0.7, 'rgba(0,0,0,0)');
      vGrad.addColorStop(1, 'rgba(0,0,0,0.5)');
      ctx.fillStyle = vGrad;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    flashScreen();
    dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    type = 'photo';
  } else {
    showToast('Open camera or select from gallery first');
    return;
  }

  processCapturedMedia(dataUrl, type, null); // Photos don't need direct blob for now as canvas is efficient
}

function processCapturedMedia(dataUrl, type, blob = null) {
  const photo = {
    id: `photo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    dataUrl,
    blob, // Store the raw blob for direct upload if available
    guestName: state.guest.name,
    guestAvatar: state.guest.avatar,
    uid: currentUid,
    event: state.activeEvent,
    type,
    ts: Date.now(),
    uploadedAt: new Date().toISOString(),
  };

  // For immediate local preview, use Blob URL if available, otherwise dataUrl
  const localSrc = blob ? URL.createObjectURL(blob) : photo.dataUrl;

  // Optimistically add to local state for instant UI feedback
  state.photos.unshift({ ...photo, srcUrl: localSrc });
  if (!CONFIG.firebase.enabled) {
    savePhotosLocal();
    renderPhotoGrid();
  }

  showToast(`✦ ${type === 'video' ? 'Video' : 'Captured'} for ${CONFIG.wedding.eventLabels[state.activeEvent]}!`);

  // Upload to Firebase (async — UI already updated)
  if (CONFIG.firebase.enabled) {
    uploadPhotoToFirebase(photo);
  }

  // Ghost Backup: Save full quality locally in background
  saveToGhostBackup(photo);

  // Auto-save to phone (if enabled in preferences)
  if (state.prefs.autosave) {
    const filename = `${state.activeEvent}_${state.guest.name || 'guest'}_${photo.id}.${type === 'video' ? 'webm' : 'jpg'}`;
    downloadPhotoByUrl(localSrc, filename);
  }
}

/* ── Video Recording Logic ── */
let longPressTimer = null;
const LONG_PRESS_DELAY = 450;

function initCaptureHandlers() {
  const btn = document.getElementById('capture-btn');
  if (!btn) return;

  const startTap = (e) => {
    if (e.type === 'touchstart') e.preventDefault(); // prevent double firing
    if (state.mode !== 'camera') {
      capturePhoto(); // from gallery preview
      return;
    }

    longPressTimer = setTimeout(() => {
      longPressTimer = null; // Reset ID so endTap knows we've already started
      if (state.isPaused) {
        resumeRecording();
      } else {
        startRecording();
      }
    }, LONG_PRESS_DELAY);
  };

  let resumeTapCount = 0;
  const endTap = (e) => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;

      if (state.isRecording) {
        pauseRecording();
      } else if (state.isPaused) {
        // Tap doesn't continue, counts towards a hint toast
        resumeTapCount++;
        if (resumeTapCount >= 3) {
          showToast("Long press to keep the memory rolling! ✨");
          resumeTapCount = 0;
        }
      } else if (!state.isPaused) {
        capturePhoto();
      }
    } else if (state.isRecording) {
      // Already recording, release to pause
      pauseRecording();
    }
  };

  // Reset tap count on successful resume
  window.addEventListener('recording-resume', () => { resumeTapCount = 0; });

  btn.addEventListener('mousedown', startTap);
  btn.addEventListener('touchstart', startTap, { passive: false });
  btn.addEventListener('mouseup', endTap);
  btn.addEventListener('touchend', endTap);
}

async function startRecording() {
  if (!state.cameraStream || state.isRecording) return;

  try {
    state.recordedChunks = [];
    state.recordedSize = 0;
    updateSizeProgress(0); // Reset UI
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';

    state.mediaRecorder = new MediaRecorder(state.cameraStream, { mimeType });

    state.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        state.recordedChunks.push(e.data);
        state.recordedSize += e.data.size;
        updateSizeProgress(state.recordedSize);
      }
    };

    state.mediaRecorder.onstop = async () => {
      const blob = new Blob(state.recordedChunks, { type: 'video/webm' });

      // Clean up UI state
      document.body.classList.remove('is-reviewing');
      document.getElementById('capture-btn').classList.remove('recording');
      state.isPaused = false;
      state.isRecording = false;

      if (state.recordedSize > LIMITS.video) {
        triggerLocalSave(blob);
      } else {
        processCapturedMedia(null, 'video', blob);
      }
    };

    state.mediaRecorder.start(100); // chunk every 100ms to keep size updated
    state.isRecording = true;
    state.isPaused = false;
    state.recordingStartTime = Date.now();
    state.totalElapsedBeforePause = 0;

    // UI Updates
    document.body.classList.add('is-recording');
    document.getElementById('capture-btn').classList.add('recording');
    document.getElementById('recording-indicator').classList.add('active');

    state.recordingTimer = setInterval(updateRecordingTimer, 1000);
    if ('vibrate' in navigator) navigator.vibrate(60);

  } catch (err) {
    console.error('Recording start failed:', err);
    state.isRecording = false;
  }
}

function pauseRecording() {
  if (!state.isRecording || !state.mediaRecorder) return;
  if (state.mediaRecorder.state !== 'recording') return;

  state.mediaRecorder.pause();
  state.isRecording = false;
  state.isPaused = true;

  // Store the elapsed time
  state.totalElapsedBeforePause += (Date.now() - state.recordingStartTime);

  clearInterval(state.recordingTimer);
  document.body.classList.remove('is-recording');
  document.body.classList.add('is-reviewing');
  document.getElementById('capture-btn').classList.remove('recording');

  if ('vibrate' in navigator) navigator.vibrate(30);
}

function resumeRecording() {
  if (!state.isPaused || !state.mediaRecorder) return;

  state.mediaRecorder.resume();
  state.isRecording = true;
  state.isPaused = false;
  state.recordingStartTime = Date.now();

  document.body.classList.remove('is-reviewing');
  document.body.classList.add('is-recording');
  document.getElementById('capture-btn').classList.add('recording');
  document.getElementById('recording-indicator').classList.add('active');

  // Reset help counter
  window.dispatchEvent(new Event('recording-resume'));

  state.recordingTimer = setInterval(updateRecordingTimer, 1000);
  if ('vibrate' in navigator) navigator.vibrate(40);
}

function finishAndSaveRecording() {
  if (!state.mediaRecorder) return;
  state.mediaRecorder.stop();

  // UI cleanup
  clearInterval(state.recordingTimer);
  document.getElementById('recording-timer').textContent = 'REC 00:00';
  document.body.classList.remove('is-recording', 'is-reviewing');
  document.getElementById('recording-indicator').classList.remove('active');
  if ('vibrate' in navigator) navigator.vibrate([40, 40]);
}

function discardRecording() {
  const modal = document.getElementById('delete-modal');
  document.getElementById('delete-modal-title').textContent = "Discard video?";
  document.getElementById('delete-modal-text').textContent = "This will permanently remove the current recording session.";
  const btn = document.getElementById('btn-confirm-delete');
  btn.textContent = "Discard Forever";
  btn.onclick = () => {
    if (state.mediaRecorder) {
      state.mediaRecorder.onstop = null; // Don't process the blob
      state.mediaRecorder.stop();
    }
    state.isRecording = false;
    state.isPaused = false;
    state.recordedChunks = [];

    clearInterval(state.recordingTimer);
    document.getElementById('recording-timer').textContent = 'REC 00:00';
    document.body.classList.remove('is-recording', 'is-reviewing');
    document.getElementById('recording-indicator').classList.remove('active');
    updateSizeProgress(0);
    showToast("Moment discarded");
    closeDeleteModal();
  };
  modal.classList.remove('hidden');
}

function stopRecording() {
  pauseRecording();
}

function updateRecordingTimer() {
  const currentElapsed = Date.now() - state.recordingStartTime;
  const totalMs = (state.totalElapsedBeforePause || 0) + currentElapsed;
  const elapsed = Math.floor(totalMs / 1000);

  const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
  const s = (elapsed % 60).toString().padStart(2, '0');
  document.getElementById('recording-timer').textContent = `REC ${m}:${s}`;
}

function updateSizeProgress(bytes) {
  const limit = LIMITS.video; // 100MB
  const percent = Math.min(100, (bytes / limit) * 100);
  const isOver = bytes > limit;

  // Update ring
  const circle = document.getElementById('size-progress-bar');
  if (circle) {
    const radius = 14;
    const circumference = 2 * Math.PI * radius; // ~88
    const offset = circumference - (percent / 100) * circumference;
    circle.style.strokeDashoffset = offset;
    circle.classList.toggle('limit-reached', isOver);
  }

  // Update icons
  const cloud = document.getElementById('size-icon-cloud');
  const phone = document.getElementById('size-icon-phone');
  if (cloud && phone) {
    if (isOver) {
      cloud.classList.add('hidden');
      phone.classList.remove('hidden');
      phone.classList.add('limit-reached');
    } else {
      cloud.classList.remove('hidden');
      phone.classList.add('hidden');
    }
  }
}

function triggerLocalSave(blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `wedding_video_large_${Date.now()}.webm`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }, 100);

  // Notify user
  showOversizeNotification();
}

function showOversizeNotification() {
  // Use a custom alert or reuse toast with longer duration
  const msg = "That was a big moment! It’s too large (100MB+) to upload directly. Saved it to phone storage. You can upload it later from gallery";

  // Custom styled alert for this "big" notification
  const overlay = document.createElement('div');
  overlay.className = 'modal active';
  overlay.style.zIndex = '2000';
  overlay.innerHTML = `
    <div class="modal-backdrop" onclick="this.parentElement.remove()"></div>
    <div class="modal-content" style="text-align:center; padding: 24px;">
      <div class="modal-icon" style="background: rgba(184, 148, 42, 0.1); color: var(--gold); margin-bottom: 16px;">
        <span class="material-symbols-rounded">phone_iphone</span>
      </div>
      <h3 class="modal-title">Moment Saved!</h3>
      <p class="modal-text" style="font-size: 14px; line-height: 1.6;">${msg}</p>
      <button class="btn-gold" style="margin-top: 20px;" onclick="this.closest('.modal').remove()">Got it!</button>
    </div>
  `;
  document.body.appendChild(overlay);
}

function flashScreen() {
  const flash = document.createElement('div');
  flash.style.cssText = 'position:fixed;inset:0;background:white;z-index:999;opacity:0.8;pointer-events:none;animation:flashFade 0.25s ease forwards;';
  if (!document.getElementById('flash-style')) {
    const s = document.createElement('style');
    s.id = 'flash-style';
    s.textContent = '@keyframes flashFade{from{opacity:0.8}to{opacity:0}}';
    document.head.appendChild(s);
  }
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 300);
}

// PHOTO UPLOAD
async function uploadPhotoToFirebase(photo, silent = false) {
  if (!db || !currentUid) return;
  const originalId = photo.id;

  try {
    if (!silent) showToast('⬆ Starting upload...');

    // 1. Get the blob (direct or from dataUrl)
    let blob = photo.blob;
    if (!blob && photo.dataUrl) {
      blob = await (await fetch(photo.dataUrl)).blob();
    }

    if (!blob) throw new Error('No media blob available');

    const cloudinaryData = await new Promise((resolve, reject) => {
      const formData = new FormData();
      const ext = photo.type === 'video' ? 'webm' : 'jpg';
      formData.append('file', blob, `${photo.id}.${ext}`);
      formData.append('upload_preset', CONFIG.cloudinary.uploadPreset);
      formData.append('folder', `wedding/${photo.event}`);
      formData.append('tags', [photo.event, photo.type, photo.guestName.replace(/\s+/g, '_')].join(','));

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `https://api.cloudinary.com/v1_1/${CONFIG.cloudinary.cloudName}/auto/upload`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = (e.loaded / e.total) * 100;
          updateGlobalProgress(originalId, percent);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          reject(new Error(`Cloudinary Error: ${xhr.statusText}`));
        }
      };
      xhr.onerror = () => reject(new Error('Network connection error during upload'));
      xhr.send(formData);
    });

    const url = cloudinaryData.secure_url;

    // 2. Save Cloudinary URL + metadata to Firestore
    await db.collection('photos').doc(photo.id).set({
      url: photo.externalUrl || url,
      srcUrl: url, // Thumbnail/Preview image
      guestName: photo.guestName,
      guestAvatar: photo.guestAvatar,
      uid: currentUid,
      event: photo.event,
      type: photo.type,
      ts: photo.ts,
      isExternal: photo.isExternal || false,
      uploadedAt: firebase.firestore.FieldValue.serverTimestamp(),
      meta: getDeviceMeta(),
    });

    updateGlobalProgress(originalId, 100);
    if (!silent) showToast(`✦ Saved to ${CONFIG.wedding.eventLabels[photo.event]}!`);

    // Mark as successfully backed up/synced
    markAsSynced(originalId);

  } catch (err) {
    updateGlobalProgress(originalId, 100);
    console.error('Upload failed:', err);
    if (!silent) showToast('Upload failed — saved locally only');
  }
}

// LOCAL STORAGE
const PHOTOS_KEY = 'wedding_photos_v2';

function savePhotosLocal() {
  try {
    const toStore = state.photos.map(p => ({
      ...p,
      dataUrl: p.dataUrl?.slice(0, 500000) || '',
    }));
    localStorage.setItem(PHOTOS_KEY, JSON.stringify(toStore));
  } catch (e) { console.warn('localStorage quota reached'); }
}

async function loadPhotosLocal() {
  try {
    const raw = localStorage.getItem(PHOTOS_KEY);
    let localPhotos = [];
    if (raw) {
      localPhotos = JSON.parse(raw).map(p => ({ ...p, srcUrl: p.cloudUrl || p.dataUrl }));
    }

    // Add unsynced ghost backups to the local list so they appear in gallery even if page reloaded
    const unsynced = await getUnsyncedMedia();
    const unsyncedNormalised = unsynced.map(p => ({
      ...p,
      srcUrl: p.blob ? URL.createObjectURL(p.blob) : p.dataUrl,
      isPending: true
    }));

    // Merge and sort
    const all = [...localPhotos];
    unsyncedNormalised.forEach(up => {
      if (!all.find(p => p.id === up.id)) all.unshift(up);
    });

    state.photos = all.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    renderPhotoGrid();
  } catch { state.photos = []; }
}

// TOAST
let toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById('upload-toast');
  document.getElementById('toast-msg').textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 2800);
}

// UPLOAD PROGRESS
let activeUploads = new Map();

function updateGlobalProgress(id, progress) {
  const container = document.getElementById('global-progress');
  if (!container) return;
  const bar = document.getElementById('progress-bar');
  const label = document.getElementById('progress-label');

  if (progress >= 100) {
    activeUploads.delete(id);
  } else if (progress >= 0) {
    activeUploads.set(id, progress);
  }

  if (activeUploads.size === 0) {
    if (progress >= 100) {
      bar.style.width = '100%';
      setTimeout(() => {
        if (activeUploads.size === 0) {
          container.style.opacity = '0';
          setTimeout(() => {
            if (activeUploads.size === 0) {
              container.classList.add('hidden');
              bar.style.width = '0%';
              container.style.opacity = '1';
            }
          }, 300);
        }
      }, 1000);
    } else {
      container.classList.add('hidden');
    }
    return;
  }

  container.classList.remove('hidden');
  container.style.opacity = '1';

  let totalProg = 0;
  activeUploads.forEach(val => totalProg += val);
  const avg = totalProg / activeUploads.size;

  bar.style.width = `${Math.max(5, avg)}%`;

  if (activeUploads.size > 1) {
    label.textContent = `Uploading ${activeUploads.size} moments — ${Math.round(avg)}%`;
  } else {
    label.textContent = `Sharing your moment — ${Math.round(avg)}%`;
  }
}

// EXPLORE GALLERY
function showExplore() {
  document.querySelectorAll('#tab-bar .tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-explore').classList.add('active');
  showScreen('screen-explore');

  state.photoPage = 0;
  state.exploreFilter = { event: 'all', guest: 'all', type: 'all', search: '', myPhotosOnly: false };

  // UI: Show guest filter for normal explore
  const guestGrp = document.getElementById('guest-filter-group');
  if (guestGrp) guestGrp.classList.remove('hidden');

  // Reset filter UI
  document.querySelectorAll('#event-chips .chip').forEach(c => c.classList.remove('active'));
  document.querySelector('#event-chips .chip[data-event="all"]')?.classList.add('active');
  const gf = document.getElementById('guest-filter');
  const tf = document.getElementById('type-filter');
  if (gf) gf.value = 'all';
  if (tf) tf.value = 'all';

  if (CONFIG.firebase.enabled && db) {
    subscribeToPhotos();
    // Also check for unsynced backups to reassure the user
    getUnsyncedMedia().then(unsynced => {
      if (unsynced.length > 0) {
        showToast(`✦ ${unsynced.length} moments awaiting connection...`);
        retryUnsyncedBackups();
        // Force a local load to show these unsynced ones
        loadPhotosLocal();
      }
    });
  } else {
    loadPhotosLocal();
    populateGuestFilter();
    renderPhotoGrid();
  }
}

function closeExplore() {
  // Stop Firestore listener when leaving gallery
  if (photosUnsubscribe) {
    photosUnsubscribe();
    photosUnsubscribe = null;
  }
  showScreen('screen-app');
  selectTab(state.activeEvent);
  if (!state.cameraStream) startCamera();
}

/* ── Firestore real-time listener ─────────────────────────── */
function subscribeToPhotos(onFirstLoad) {
  // Tear down previous listener if any
  if (photosUnsubscribe) { photosUnsubscribe(); photosUnsubscribe = null; }

  // No orderBy — avoid Firestore index requirement; sort client-side
  let gotData = false;
  const query = db.collection('photos');

  photosUnsubscribe = query.onSnapshot(snapshot => {
    gotData = true;
    const cloudPhotos = snapshot.docs
      .map(doc => {
        const d = doc.data();
        return {
          id: doc.id,
          srcUrl: d.url || d.srcUrl || '',
          dataUrl: d.url || d.srcUrl || '',
          url: d.url || d.srcUrl || '',
          guestName: d.guestName || 'Guest',
          guestAvatar: d.guestAvatar || '🌸',
          uid: d.uid || '',
          event: d.event || 'retro',
          type: d.type || 'photo',
          isExternal: d.isExternal || false,
          ts: d.ts || 0,
        };
      });

    // Merge Unsynced Ghost Backups
    getUnsyncedMedia().then(unsynced => {
      const pending = unsynced.map(p => ({
        ...p,
        srcUrl: p.blob ? URL.createObjectURL(p.blob) : p.dataUrl,
        isPending: true
      }));

      const all = [...cloudPhotos];
      // Only add pending if they aren't already in cloud list
      pending.forEach(p => {
        if (!all.find(cp => cp.id === p.id)) all.push(p);
      });

      state.photos = all.sort((a, b) => (b.ts || 0) - (a.ts || 0));
      populateGuestFilter();
      renderPhotoGrid();
    });

    if (onFirstLoad) { onFirstLoad(); onFirstLoad = null; }
  }, err => {
    console.error('Firestore photos error — code:', err.code, '|', err.message);

    if (!gotData) {
      // Only show error if we haven't already received a successful snapshot
      // and we don't have any photos from a previous successful load in this session
      if (state.photos.length === 0) {
        if (err.code === 'permission-denied') {
          showToast('Gallery unavailable — check Firestore rules');
          console.warn('%c[Firebase] PERMISSION DENIED on /photos — publish your Firestore rules', 'color:red;font-weight:bold');
        } else {
          showToast('Could not load gallery — using local photos');
        }
        loadPhotosLocal();
        renderPhotoGrid();
      }
      if (onFirstLoad) { onFirstLoad(); onFirstLoad = null; }
    }
    // If photos already loaded from a prior snapshot, fail silently
  });
}



/* ── Filters ──────────────────────────────────────────────── */
function filterEvent(btn) {
  document.querySelectorAll('#event-chips .chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  state.exploreFilter.event = btn.dataset.event;
  state.photoPage = 0;
  renderPhotoGrid();
}

function applyFilters() {
  state.exploreFilter.guest = document.getElementById('guest-filter').value;
  state.exploreFilter.type = document.getElementById('type-filter').value;
  state.photoPage = 0;
  renderPhotoGrid();
}

function getFilteredPhotos() {
  const { event, guest, type, myPhotosOnly } = state.exploreFilter;
  return state.photos.filter(p => {
    if (myPhotosOnly && p.uid !== currentUid) return false;
    if (event !== 'all' && p.event !== event) return false;
    if (guest !== 'all' && p.guestName !== guest) return false;
    if (type !== 'all' && p.type !== type) return false;
    return true;
  });
}

function populateGuestFilter() {
  const sel = document.getElementById('guest-filter');
  const guests = [...new Set(state.photos.map(p => p.guestName).filter(Boolean))];
  const cur = sel.value;
  sel.innerHTML = '<option value="all">All Guests</option>';
  guests.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g; opt.textContent = g;
    if (g === cur) opt.selected = true;
    sel.appendChild(opt);
  });
}

/* ── Render grid ──────────────────────────────────────────── */
function renderPhotoGrid() {
  const grid = document.getElementById('photo-grid');
  const emptyEl = document.getElementById('empty-state');
  const btnReveal = document.getElementById('btn-reveal');
  const filtered = getFilteredPhotos();
  const end = (state.photoPage + 1) * state.photosPerPage;
  const visible = filtered.slice(0, end);

  grid.innerHTML = '';

  if (filtered.length === 0) {
    emptyEl.classList.remove('hidden');
    btnReveal.classList.add('hidden');
  } else {
    emptyEl.classList.add('hidden');
    btnReveal.classList.toggle('hidden', end >= filtered.length);
    visible.forEach(photo => {
      const card = createPhotoCard(photo);
      if (state.multiselect) {
        card.classList.add('selectable');
        if (state.selectedIds.has(photo.id)) card.classList.add('selected');
      }
      grid.appendChild(card);
    });
  }
}

function createPhotoCard(photo) {
  const card = document.createElement('div');
  card.className = 'photo-card';
  card.dataset.id = photo.id;

  const src = photo.srcUrl || photo.dataUrl || '';
  const isExt = photo.isExternal;
  const isPending = photo.isPending;

  if (isPending) card.classList.add('is-pending');

  let mediaHtml = '';
  if (isExt) {
    card.classList.add('external-card');
    mediaHtml = `
      <div class="external-placeholder">
        <div class="external-placeholder-icon">
          <span class="material-symbols-rounded" style="font-size: 26px">link</span>
        </div>
        <div class="external-placeholder-subtitle">Shared Memory</div>
        <div class="external-placeholder-title">${photo.type === 'video' ? 'Video' : 'Photo'} File</div>
        
        <div class="external-hover-overlay">
          <span class="material-symbols-rounded">arrow_outward</span>
          <span class="external-hover-text">Click to View</span>
        </div>
      </div>`;
  } else if (photo.type === 'video' && !isExt) {
    mediaHtml = `<video src="${src}" muted loop playsinline preload="metadata"></video>
                 <div class="video-badge"><svg width="10" height="10" viewBox="0 0 10 10"><polygon points="2,1 9,5 2,9" fill="white"/></svg> VIDEO</div>`;
  } else {
    // Show thumbnail for normal photos
    mediaHtml = src
      ? `<img src="${src}" alt="By ${photo.guestName}" loading="lazy" />`
      : `<div class="no-preview-placeholder">
           <span class="material-symbols-rounded" style="font-size:28px">visibility_off</span>
           <span>Preview Pending<br/>Click to view</span>
         </div>`;
  }

  const extBadge = (!isExt && photo.isExternal) ? `<div class="external-badge"><span class="material-symbols-rounded" style="font-size:12px">link</span> DRIVE</div>` : '';
  const syncBadge = isPending ? `<div class="syncing-badge"><span></span> SYNCING</div>` : '';

  card.innerHTML = `
    ${mediaHtml}
    ${extBadge}
    ${syncBadge}
    <div class="photo-card-overlay">
      <div class="photo-card-guest">${photo.guestAvatar || ''} ${photo.guestName || 'Guest'}</div>
      <div class="photo-card-event">${CONFIG.wedding.eventLabels[photo.event] || photo.event}</div>
    </div>`;


  card.onclick = () => openLightbox(photo);

  const vid = card.querySelector('video');
  if (vid) {
    card.addEventListener('mouseenter', () => vid.play());
    card.addEventListener('mouseleave', () => { vid.pause(); vid.currentTime = 0; });
  }
  return card;
}

function loadMorePhotos() {
  state.photoPage++;
  renderPhotoGrid();
}

// LIGHTBOX
function openLightbox(photo) {
  if (state.multiselect) { toggleSelectPhoto(photo.id); return; }
  state.lightboxPhoto = photo;
  const src = photo.srcUrl || photo.dataUrl || '';
  const isExt = photo.isExternal;

  const img = document.getElementById('lightbox-img');
  const video = document.getElementById('lightbox-video');
  const extPlaceholder = document.getElementById('lightbox-external-placeholder');
  const extTypeLabel = document.getElementById('lightbox-external-type');

  if (isExt) {
    img.classList.add('hidden');
    video.classList.add('hidden');
    extPlaceholder.classList.remove('hidden');
    extTypeLabel.textContent = `${photo.type === 'video' ? 'Video' : 'Photo'} File`;
  } else if (photo.type === 'video') {
    img.classList.add('hidden');
    extPlaceholder.classList.add('hidden');
    video.src = src;
    video.classList.remove('hidden');
    video.play().catch(() => { });
  } else {
    img.src = src;
    img.classList.remove('hidden');
    video.classList.add('hidden');
    extPlaceholder.classList.add('hidden');
  }

  // Click handled by openExternalUrl if isExt is true
  img.onclick = (e) => {
    if (isExt) openExternalUrl(e);
  };

  document.getElementById('lightbox-guest').textContent = `${photo.guestAvatar} ${photo.guestName}`;
  document.getElementById('lightbox-event').textContent = (CONFIG.wedding.eventLabels[photo.event] || photo.event) + (photo.isExternal ? ' (Large File)' : '');

  // For external links, the user specifically wants the redirect link, and a delete button below.
  // The existing download button should either be hidden or still redirect?
  // User says "no need for externally word display for redirect".

  const extBtn = document.getElementById('lightbox-external-btn');
  // Since the middle area now redirects, maybe we don't need the button at all anymore?
  // "just show a good placeholder ... upon clicking redirect".
  extBtn.classList.add('hidden');

  // Show delete button only for own photos
  const delBtn = document.getElementById('lightbox-del');
  const isOwn = (photo.uid && photo.uid === currentUid) || (!photo.uid && !CONFIG.firebase.enabled);
  delBtn.classList.toggle('hidden', !isOwn);

  document.getElementById('lightbox').classList.remove('hidden');
}

async function closeLightbox() {
  const lightbox = document.getElementById('lightbox');
  const video = document.getElementById('lightbox-video');

  if (video) {
    video.pause();
    video.src = '';
  }

  lightbox.classList.add('hidden');
}

function downloadLightboxPhoto(e) {
  if (e) e.stopPropagation();
  if (!state.lightboxPhoto) return;
  const p = state.lightboxPhoto;
  // External links are not direct downloads
  if (p.isExternal) {
    window.open(p.url, '_blank');
    return;
  }
  downloadPhotoByUrl(p.srcUrl || p.dataUrl, `${p.event}_${p.guestName || 'guest'}_${p.id}.jpg`);
}

function openExternalUrl(e) {
  if (e) e.stopPropagation();
  if (state.lightboxPhoto?.url) {
    window.open(state.lightboxPhoto.url, '_blank');
  }
}

function deleteLightboxPhoto(e) {
  if (e) e.stopPropagation();
  if (!state.lightboxPhoto) return;

  document.getElementById('delete-modal-title').textContent = "Delete Photo?";
  document.getElementById('delete-modal-text').textContent = "This will permanently remove this photo from the wedding gallery.";
  const btn = document.getElementById('btn-confirm-delete');
  btn.textContent = "Delete Forever";
  btn.onclick = confirmDelete;

  document.getElementById('delete-modal').classList.remove('hidden');
}

function closeDeleteModal() {
  document.getElementById('delete-modal').classList.add('hidden');
}

async function confirmDelete() {
  if (!state.lightboxPhoto) return;
  const p = state.lightboxPhoto;

  const btn = document.getElementById('btn-confirm-delete');
  btn.disabled = true;
  btn.textContent = 'Deleting...';

  try {
    // 1. Remove from local state immediately for speed
    state.photos = state.photos.filter(item => item.id !== p.id);
    renderPhotoGrid();
    closeDeleteModal();
    closeLightbox();

    // 2. Remove from Firestore
    if (db && currentUid) {
      await db.collection('photos').doc(p.id).delete();
      showToast('Photo removed from gallery');
    }
  } catch (err) {
    console.error('Delete failed:', err);
    showToast('Failed to delete — try again');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Delete Forever';
  }
}

async function deletePhoto(photoId) {
  // Legacy / Direct delete
  state.photos = state.photos.filter(p => p.id !== photoId);
  renderPhotoGrid();
  if (db && currentUid) {
    try {
      await db.collection('photos').doc(photoId).delete();
    } catch (err) { console.error(err); }
  }
}



// BATCH UPLOAD MODAL
function toggleMenu() {
  document.getElementById('menu-panel').classList.toggle('hidden');
}



/* ============================================================
   MULTISELECT & DOWNLOAD
   ============================================================ */
function toggleMultiselect() {
  state.multiselect = !state.multiselect;
  state.selectedIds.clear();

  const bar = document.getElementById('multiselect-bar');
  const dlIconBtn = document.getElementById('btn-multiselect');   // download icon button
  const selAllBtn = document.getElementById('btn-select-all');    // checkbox+label button
  const content = document.getElementById('explore-content');

  if (state.multiselect) {
    // Swap: hide download icon, show checkbox+label
    dlIconBtn.classList.add('hidden');
    selAllBtn.classList.remove('hidden');
    bar.classList.remove('hidden');
    content.classList.add('has-multibar');
  } else {
    // Swap back
    dlIconBtn.classList.remove('hidden');
    selAllBtn.classList.add('hidden');
    bar.classList.add('hidden');
    content.classList.remove('has-multibar');
  }
  renderPhotoGrid();
}

function toggleSelectPhoto(id) {
  if (state.selectedIds.has(id)) state.selectedIds.delete(id);
  else state.selectedIds.add(id);
  updateSelectionUI();
}

function selectAllPhotos() {
  const filtered = getFilteredPhotos();
  const allSel = filtered.length > 0 && filtered.every(p => state.selectedIds.has(p.id));
  if (allSel) state.selectedIds.clear();
  else filtered.forEach(p => state.selectedIds.add(p.id));
  // Update tick visibility on the checkbox
  const tick = document.getElementById('select-all-tick');
  if (tick) tick.style.opacity = allSel ? '0' : '1';
  updateSelectionUI();
  renderPhotoGrid();
}

function clearSelection() {
  state.selectedIds.clear();
  state.multiselect = false;
  document.getElementById('multiselect-bar').classList.add('hidden');
  document.getElementById('btn-multiselect').classList.remove('hidden');
  document.getElementById('btn-select-all').classList.add('hidden');
  document.getElementById('explore-content').classList.remove('has-multibar');
  // Reset tick opacity
  const tick = document.getElementById('select-all-tick');
  if (tick) tick.style.opacity = '0';
  renderPhotoGrid();
}

function updateSelectionUI() {
  const count = state.selectedIds.size;
  document.getElementById('sel-count').textContent =
    count === 0 ? 'No photos selected' : `${count} photo${count > 1 ? 's' : ''} selected`;
  document.querySelectorAll('.photo-card').forEach(card => {
    card.classList.toggle('selected', state.selectedIds.has(card.dataset.id));
  });
}

async function downloadSelected() {
  if (state.selectedIds.size === 0) { showToast('Select photos first'); return; }
  const photos = state.photos.filter(p => state.selectedIds.has(p.id));
  showToast(`Downloading ${photos.length} photo${photos.length > 1 ? 's' : ''}…`);
  for (const p of photos) {
    await downloadPhotoByUrl(p.srcUrl || p.dataUrl, `${p.event}_${p.guestName || 'guest'}.jpg`);
    await new Promise(r => setTimeout(r, 150));
  }
}

function downloadPhotoByUrl(url, filename) {
  return new Promise(resolve => {
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); resolve(); }, 100);
  });
}

// FIREBASE INIT
function initFirebase() {
  if (!CONFIG.firebase.enabled) return;

  try {
    firebase.initializeApp(CONFIG.firebase);
    db = firebase.firestore();
    fbAuth = firebase.auth();

    fbAuth.onAuthStateChanged(handleAuthStateChange);
  } catch (err) {
    console.error('Firebase init failed:', err);
    fallbackToLocal();
  }
}


function fallbackToLocal() {
  hideLoadingScreen();
  if (loadGuestLocal() && state.guest.name) {
    updateHeaderAvatar();
    loadPhotosLocal();
    showScreen('screen-app');
    selectTab(getDefaultEvent());
    loadAppPreferences();
    startCamera();
  } else {
    showStep('step-greet');
  }
}

async function handleAuthStateChange(user) {
  // Clear the loading block as soon as we have a result from Firebase
  hideLoadingScreen();

  // Try to sync any ghost backups that didn't make it
  if (user) {
    retryUnsyncedBackups();
    cleanupOldBackups();
  }

  if (!user) {
    // If no user is logged in, and we're not already on the app screen,
    // make sure the welcome greet step is shown.
    if (!document.querySelector('.screen.active#screen-app')) {
      showStep('step-greet');
    }
    return;
  }

  currentUid = user.uid;

  // Update local storage with UID
  const localData = JSON.parse(localStorage.getItem(GUEST_KEY) || '{}');
  localStorage.setItem(GUEST_KEY, JSON.stringify({ ...localData, uid: currentUid }));

  // Check if user already has a profile in Firestore
  try {
    const userDoc = await db.collection('users').doc(currentUid).get();

    if (userDoc.exists) {
      // ── Returning guest — load profile, skip onboarding ──
      const data = userDoc.data();
      state.guest = { name: data.name || '', avatar: data.avatar || '🌸' };
      saveGuestLocal();
      updateHeaderAvatar();
      subscribeToPhotos();

      if (!document.getElementById('screen-app').classList.contains('active')) {
        showScreen('screen-app');
        selectTab(getDefaultEvent());
        loadAppPreferences();
        startCamera();
      }
    } else {
      // ── New guest or missing profile in Firestore ──
      // Check if we have anything locally to pre-fill
      loadGuestLocal();
      if (state.guest.name) {
        // If we had a local name but no remote profile (guest cleared cookies but verified phone), save remote
        await saveGuestRemote();
        subscribeToPhotos();
        showScreen('screen-app');
        selectTab(getDefaultEvent());
        startCamera();
      } else {
        // No name anywhere → ask for it
        showStep('step-name');
      }
    }
  } catch (err) {
    console.error('Firestore user check failed:', err);
    fallbackToLocal();
  }
}

// MULTI-PROVIDER AUTH
async function loginWithGoogle() {
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    await fbAuth.signInWithPopup(provider);
  } catch (err) {
    console.error('Google login failed:', err);
    if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
      showToast('Google login failed — try another method');
    }
  }
}

async function loginWithEmail() {
  const email = document.getElementById('auth-email').value.trim();
  const pass = document.getElementById('auth-password').value;

  if (!email || !pass || pass.length < 6) {
    showToast('Enter valid email and 6-char password');
    return;
  }

  const btn = document.getElementById('btn-email-auth');
  btn.disabled = true;
  btn.textContent = 'Authenticating...';

  try {
    // 1. Try to Login
    await fbAuth.signInWithEmailAndPassword(email, pass);
  } catch (err) {
    console.warn('Login attempt failed, checking if new user:', err.code);

    // If 'invalid-credential' or 'user-not-found', try creating account
    if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
      try {
        await fbAuth.createUserWithEmailAndPassword(email, pass);
        // Success -> Auth listener takes over
      } catch (signupErr) {
        if (signupErr.code === 'auth/email-already-in-use') {
          // If we couldn't create because email exists, THEN we know the password was just wrong
          showToast('Incorrect password for this email');
        } else {
          showToast(signupErr.message || 'Authentication failed');
        }
        btn.disabled = false;
        btn.textContent = 'Confirm & Continue →';
      }
    } else {
      showToast(err.message || 'Login failed');
      btn.disabled = false;
      btn.textContent = 'Confirm & Continue →';
    }
  }
}


async function loginAnonymously() {
  try {
    showToast('Entering as Guest...');
    await fbAuth.signInAnonymously();
  } catch (err) {
    console.error('Anon login failed:', err);
    showToast('Login failed — try refresh');
  }
}

async function retryUnsyncedBackups() {
  if (!navigator.onLine) return;
  const unsynced = await getUnsyncedMedia();
  if (unsynced.length > 0) {
    console.log(`Ghost Backup: Retrying ${unsynced.length} unsynced items`);
    // Attempt to upload each one silently
    unsynced.forEach(photo => {
      uploadPhotoToFirebase(photo, true);
    });
  }
}

// Signs the user out and returns to the auth choice screen.
// Used by the "Back to options" link on step-name (shown after
// Google / Guest auth when the user hasn't set a name yet).
async function backToAuthOptions() {
  try {
    await fbAuth.signOut();
  } catch (e) { /* ignore */ }
  showStep('step-auth-choice');
}



// INIT
document.addEventListener('DOMContentLoaded', () => {
  if (CONFIG.firebase.enabled) {
    // Firebase path: auth state change drives the flow
    initFirebase();
    // Show a brief loading indicator while Firebase initialises
    showLoadingScreen();
  } else {
    // Local-only path
    fallbackToLocal();
  }

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeLightbox();
      const menu = document.getElementById('menu-panel');
      if (!menu.classList.contains('hidden')) toggleMenu();
    }
  });

  // Capture Button: Long-press for Video, Tap for Photo
  initCaptureHandlers();

  // Prevent bounce scroll on iOS for non-scroll areas
  document.body.addEventListener('touchmove', e => {
    if (e.target.closest('.explore-content')) return;
    e.preventDefault();
  }, { passive: false });
});

/* ── Show a subtle loading state while Firebase auth resolves ─ */
function showLoadingScreen() {
  // step-greet starts hidden in HTML; nothing to block — just set a safety net
  // to ensure the greet step is shown if Firebase is slow/fails.
  setTimeout(hideLoadingScreen, 3000);
}

function hideLoadingScreen() {
  // If no screen is active and no welcome step is visible, show the greet step.
  if (!document.querySelector('.screen.active#screen-app') &&
    !document.querySelector('.welcome-step:not(.hidden)')) {
    showStep('step-greet');
  }
}

// SERVICE WORKER
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.onupdatefound = () => {
        const sw = reg.installing;
        if (sw) {
          sw.onstatechange = () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              // New version available! Reload to apply.
              window.location.reload();
            }
          };
        }
      };
    }).catch(() => { });
  });

  // Handle redundant service worker claims
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });
}

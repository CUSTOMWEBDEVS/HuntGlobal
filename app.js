const API_URL = 'https://script.google.com/macros/s/AKfycbxYwLykDO9ARhVZ4oSi21P8gZThrncfCAcbVdnoigiSVoHS27mAfdq8H8RoQ7J_hqG8/exec';

// State
let deviceId = localStorage.getItem('deviceId') || null;
let groupCode = localStorage.getItem('groupCode') || '';
let displayName = localStorage.getItem('displayName') || '';
let groupMap = null;
let groupMarkers = {};
let currentGuideStep = 0;

const guideSteps = [
  {
    title: "Position the deer",
    text: "Lay the deer on its back with the head uphill if possible. This keeps organs from pushing toward the chest and makes cuts easier."
  },
  {
    title: "Make the initial cut",
    text: "Starting at the pelvis, gently pinch the hide and make a shallow cut. Use two fingers to lift the hide and cut up toward the sternum, keeping the blade away from organs."
  },
  {
    title: "Open the body cavity",
    text: "Carefully continue the cut up the belly to the base of the ribcage. Avoid puncturing the stomach or intestines as they can taint the meat."
  },
  {
    title: "Free the diaphragm",
    text: "Reach in and cut the thin muscle wall (diaphragm) separating chest and abdomen. Work around the ribs to loosen everything."
  },
  {
    title: "Cut the windpipe",
    text: "Reach up into the chest, find the windpipe, and cut it as high toward the throat as you can. This releases the heart and lungs."
  },
  {
    title: "Remove the organs",
    text: "Gently pull the organs out, rolling them away from the carcass. If anything resists, check for connective tissue and cut it free."
  },
  {
    title: "Clean and cool",
    text: "Tip the deer on its side to drain blood. Wipe out debris with a clean cloth or snow. Prop the cavity open to cool as quickly as possible."
  }
];

document.addEventListener('DOMContentLoaded', () => {
  initState();
  initTabs();
  initAuthControls();
  initGroupMap();
  initGroupActions();
  initMovement();
  initFeed();
  initGuide();
  registerServiceWorker();
});

function initState() {
  if (!deviceId) {
    deviceId = 'dev_' + Math.random().toString(36).substring(2, 12);
    localStorage.setItem('deviceId', deviceId);
  }
  const nameInput = document.getElementById('displayNameInput');
  const groupInput = document.getElementById('groupCodeInput');
  if (displayName) nameInput.value = displayName;
  if (groupCode) groupInput.value = groupCode;
}

function initTabs() {
  const tabs = document.querySelectorAll('.tab');
  const panels = document.querySelectorAll('.tab-panel');
  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const id = btn.dataset.tab;
      document.getElementById(`tab-${id}`).classList.add('active');
    });
  });
}

function initAuthControls() {
  document.getElementById('joinGroupBtn').addEventListener('click', async () => {
    const nameInput = document.getElementById('displayNameInput');
    const groupInput = document.getElementById('groupCodeInput');
    displayName = nameInput.value.trim() || 'Hunter';
    groupCode = groupInput.value.trim().toUpperCase();

    const body = {
      action: 'registerDevice',
      deviceId,
      displayName,
      groupCode,
      groupName: groupCode ? '' : 'Hunt Group'
    };

    const res = await callApi(body);
    if (!res.ok === false || res.error) {
      alert('Error joining group: ' + res.error);
      return;
    }
    groupCode = res.groupCode;
    displayName = res.displayName;
    localStorage.setItem('groupCode', groupCode);
    localStorage.setItem('displayName', displayName);
    groupInput.value = groupCode;
    // Immediately load group state
    refreshGroupState();
  });
}

function initGroupMap() {
  const mapEl = document.getElementById('groupMap');
  groupMap = L.map(mapEl).setView([38.0, -90.0], 8);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
  }).addTo(groupMap);

  // Start periodic ping if we have groupCode
  if (groupCode) {
    refreshGroupState();
  }

  if ('geolocation' in navigator) {
    // Ping every 30s
    setInterval(() => {
      pingLocation();
    }, 30000);
    // Ping once at load
    pingLocation();
  }
}

async function pingLocation() {
  if (!groupCode) return;
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(async pos => {
    const { latitude, longitude } = pos.coords;
    const body = {
      action: 'ping',
      groupCode,
      deviceId,
      displayName,
      lat: latitude,
      lng: longitude
    };
    await callApi(body);
    // Refresh state after ping
    refreshGroupState();
  }, err => {
    console.warn('Geolocation error: ', err);
  }, { enableHighAccuracy: true });
}

function initGroupActions() {
  // Alert buttons
  document.querySelectorAll('.alert-btn').forEach(btn => {
    btn.addEventListener('click', () => sendAlert(btn.dataset.alert));
  });

  document.getElementById('saveStandBtn').addEventListener('click', () => {
    if (!navigator.geolocation) {
      alert('Geolocation not available');
      return;
    }
    const standName = prompt('Stand name:');
    if (!standName) return;
    navigator.geolocation.getCurrentPosition(async pos => {
      const { latitude, longitude } = pos.coords;
      const body = {
        action: 'saveStand',
        groupCode,
        deviceId,
        name: standName,
        lat: latitude,
        lng: longitude,
        notes: ''
      };
      const res = await callApi(body);
      if (res && res.standId) {
        loadStands();
      }
    });
  });
}

async function sendAlert(type) {
  if (!groupCode) {
    alert('Join a group first.');
    return;
  }
  if (!navigator.geolocation) {
    alert('Geolocation not available');
    return;
  }
  navigator.geolocation.getCurrentPosition(async pos => {
    const sex = (type === 'DEER_DOWN' || type === 'DEER_SEEN')
      ? (prompt('Buck or Doe? (leave blank if N/A)') || '').toUpperCase()
      : '';
    const terrain = (type === 'DEER_DOWN' || type === 'DEER_SEEN')
      ? (prompt('Terrain (field edge, woods, bottom, ridge, etc.)') || '')
      : '';
    const notes = prompt('Notes (optional)') || '';
    const { latitude, longitude } = pos.coords;
    const body = {
      action: 'alert',
      groupCode,
      deviceId,
      displayName,
      type,
      lat: latitude,
      lng: longitude,
      sex,
      terrain,
      notes
    };
    const res = await callApi(body);
    if (res && res.weather) {
      // Optional: toast or something
      console.log('Alert logged with weather:', res.weather);
    }
    refreshGroupState();
  });
}

async function refreshGroupState() {
  if (!groupCode) return;
  const res = await callApi({
    action: 'getGroupState',
    groupCode,
    lookbackHours: 24
  });
  if (!res || res.error) return;

  // Update markers
  updateGroupMarkers(res.members);
  // Update stands & alerts list
  loadStands();
  renderAlerts(res.alerts);
}

async function loadStands() {
  if (!groupCode) return;
  const res = await callApi({
    action: 'listStands',
    groupCode
  });
  if (!res || res.error) return;
  renderStands(res.stands || []);
}

function updateGroupMarkers(members) {
  if (!groupMap) return;
  // Remove old markers
  Object.values(groupMarkers).forEach(m => groupMap.removeLayer(m));
  groupMarkers = {};
  members.forEach(m => {
    if (!m.lat || !m.lng) return;
    const marker = L.marker([m.lat, m.lng]).addTo(groupMap);
    marker.bindPopup(`<strong>${m.displayName || 'Hunter'}</strong><br><small>Last seen: ${m.lastSeen}</small>`);
    groupMarkers[m.deviceId] = marker;
  });
  // Adjust view if we have members
  if (members.length > 0) {
    const group = new L.featureGroup(Object.values(groupMarkers));
    groupMap.fitBounds(group.getBounds().pad(0.3));
  }
}

function renderStands(stands) {
  const list = document.getElementById('standsList');
  list.innerHTML = '';
  stands.forEach(s => {
    const li = document.createElement('li');
    li.innerHTML = `<strong>${s.name}</strong><br>
      <span class="meta">${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}</span>`;
    list.appendChild(li);
  });
}

function renderAlerts(alerts) {
  const list = document.getElementById('alertsList');
  list.innerHTML = '';
  alerts.forEach(a => {
    const li = document.createElement('li');
    li.innerHTML = `<strong>${a.type.replace('_',' ')}</strong> by ${a.displayName || 'Hunter'}<br>
      <div class="meta">${new Date(a.timestamp).toLocaleString()} · ${a.weather || ''}</div>`;
    list.appendChild(li);
  });
}

/******** DEER MOVEMENT ********/

function initMovement() {
  document.getElementById('refreshMovementBtn').addEventListener('click', loadMovement);
}

async function loadMovement() {
  if (!navigator.geolocation) {
    alert('Geolocation required for movement data.');
    return;
  }
  navigator.geolocation.getCurrentPosition(async pos => {
    const { latitude, longitude } = pos.coords;
    const res = await callApi({
      action: 'getDeerMovement',
      lat: latitude,
      lng: longitude,
      radiusMiles: 50,
      lookbackHours: 168,
      groupCode
    });
    if (!res || res.error) {
      alert('Error loading movement: ' + (res && res.error));
      return;
    }
    renderMovement(res.events || []);
  });
}

function renderMovement(events) {
  const list = document.getElementById('movementList');
  const summaryEl = document.getElementById('movementSummary');
  list.innerHTML = '';

  if (!events.length) {
    summaryEl.textContent = 'No deer activity recorded within 50 miles for the selected time window.';
    return;
  }

  // Quick stats: buck vs doe, most active hour
  let buckCount = 0, doeCount = 0;
  const hourBuckets = new Array(24).fill(0);

  events.forEach(e => {
    if (e.sex === 'BUCK') buckCount++;
    if (e.sex === 'DOE') doeCount++;
    const hour = new Date(e.timestamp).getHours();
    hourBuckets[hour]++;
  });

  const peakHour = hourBuckets.reduce((best, val, idx) => val > best.val ? { val, idx } : best, { val: -1, idx: 0 }).idx;

  summaryEl.textContent = `Events: ${events.length} · Bucks: ${buckCount} · Does: ${doeCount} · Peak hour (local): ${peakHour}:00`;

  events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  events.forEach(e => {
    const li = document.createElement('li');
    li.innerHTML = `
      <strong>${e.type.replace('_',' ')}</strong> ${e.sex ? '· ' + e.sex : ''}<br>
      <div class="meta">
        ${new Date(e.timestamp).toLocaleString()} · ${e.distanceMiles.toFixed(1)} mi away · ${e.weather || ''}
      </div>
    `;
    list.appendChild(li);
  });
}

/******** FEED ********/

function initFeed() {
  document.getElementById('postFeedBtn').addEventListener('click', postFeed);
  // Load initial
  loadFeed();
}

async function postFeed() {
  if (!groupCode) {
    alert('Join a group first.');
    return;
  }
  const caption = document.getElementById('feedCaption').value.trim();
  const species = document.getElementById('feedSpecies').value;
  const sex = document.getElementById('feedSex').value;
  const locationLbl = document.getElementById('feedLocationLbl').value.trim();
  const imageUrl = document.getElementById('feedImageUrl').value.trim();

  const res = await callApi({
    action: 'postHarvest',
    groupCode,
    deviceId,
    displayName,
    caption,
    species,
    sex,
    locationLbl,
    imageUrl
  });
  if (res && res.rowId) {
    document.getElementById('feedCaption').value = '';
    document.getElementById('feedImageUrl').value = '';
    loadFeed();
  }
}

async function loadFeed() {
  const res = await callApi({
    action: 'getFeed',
    groupCode,
    limit: 50
  });
  if (!res || res.error) return;
  renderFeed(res.posts || []);
}

function renderFeed(posts) {
  const list = document.getElementById('feedList');
  list.innerHTML = '';
  posts.forEach(p => {
    const li = document.createElement('li');
    li.className = 'feed-item';
    li.innerHTML = `
      <div class="feed-header">
        <span>${p.displayName || 'Hunter'}</span>
        <span class="meta">${new Date(p.timestamp).toLocaleString()}</span>
      </div>
      <div class="feed-caption">${p.caption || ''}</div>
      <div class="feed-meta">
        ${p.species || ''} ${p.sex || ''} · ${p.locationLbl || ''}
      </div>
      ${p.imageUrl ? `<div class="feed-meta"><a href="${p.imageUrl}" target="_blank">View Image</a></div>` : ''}
      <div class="feed-meta">Comments:</div>
      <ul class="list comments" data-rowid="${p.rowId}"></ul>
      <div class="comment-input">
        <input placeholder="Add comment..." data-rowid="${p.rowId}">
      </div>
    `;
    list.appendChild(li);
  });

  // Load comments per post
  posts.forEach(p => loadCommentsForPost(p.rowId));

  // Attach comment input handlers
  list.querySelectorAll('.comment-input input').forEach(inp => {
    inp.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') {
        const text = inp.value.trim();
        if (!text) return;
        postComment(inp.dataset.rowid, text);
        inp.value = '';
      }
    });
  });
}

async function loadCommentsForPost(rowId) {
  const res = await callApi({
    action: 'getComments',
    feedRowId: Number(rowId)
  });
  if (!res || res.error) return;
  const list = document.querySelector(`.comments[data-rowid="${rowId}"]`);
  if (!list) return;
  list.innerHTML = '';
  (res.comments || []).forEach(c => {
    const li = document.createElement('li');
    li.innerHTML = `<strong>${c.displayName || 'Hunter'}:</strong> ${c.text}`;
    list.appendChild(li);
  });
}

async function postComment(rowId, text) {
  await callApi({
    action: 'postComment',
    feedRowId: Number(rowId),
    deviceId,
    displayName,
    text
  });
  loadCommentsForPost(rowId);
}

/******** GUIDE ********/

function initGuide() {
  renderGuideStep();
  document.getElementById('prevStepBtn').addEventListener('click', () => {
    if (currentGuideStep > 0) currentGuideStep--;
    renderGuideStep();
  });
  document.getElementById('nextStepBtn').addEventListener('click', () => {
    if (currentGuideStep < guideSteps.length - 1) currentGuideStep++;
    renderGuideStep();
  });
}

function renderGuideStep() {
  const step = guideSteps[currentGuideStep];
  const el = document.getElementById('guideStep');
  el.innerHTML = `
    <h3>Step ${currentGuideStep + 1}: ${step.title}</h3>
    <p>${step.text}</p>
  `;
}

/******** UTIL ********/

async function callApi(body) {
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      // IMPORTANT: no headers here at all, just the body
      body: JSON.stringify(body)
    });

    return await res.json();
  } catch (err) {
    console.error('API error', err);
    return { ok: false, error: String(err) };
  }
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => {
      console.warn('SW registration failed', err);
    });
  }
}

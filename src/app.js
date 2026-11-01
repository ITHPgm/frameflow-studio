const DB_NAME = 'frameflow-studio';
const DB_VERSION = 1;
const ASSET_STORE = 'assets';
const PROJECT_STORE = 'projects';

const state = {
  assets: [],
  clips: [],
  captions: [],
  selectedClipId: null,
  selectedCaptionId: null,
  activePanel: 'media',
  mediaFilter: 'all',
  aspect: '16:9',
  zoom: 58,
  playhead: 0,
  isPlaying: false,
  muted: false,
  history: [],
  historyIndex: -1,
  objectUrls: new Map(),
  db: null,
  saving: false,
  name: 'Untitled project',
};

const $ = (id) => document.getElementById(id);
const video = $('previewVideo');
const image = $('previewImage');
const stage = $('previewStage');
const lane = $('videoLane');

function uid(prefix = 'id') { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function fmt(seconds = 0) {
  const safe = Math.max(0, Number(seconds) || 0);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const frames = Math.floor((safe % 1) * 30);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}${frames ? `:${String(frames).padStart(2, '0')}` : ''}`;
}
function totalDuration() { return state.clips.reduce((sum, clip) => sum + clipDuration(clip), 0); }
function clipDuration(clip) { return Math.max(0.1, Number(clip.outPoint) - Number(clip.inPoint)); }
function clipStartAt(index) { return state.clips.slice(0, index).reduce((sum, clip) => sum + clipDuration(clip), 0); }
function activeClipAt(time) {
  let cursor = 0;
  for (let i = 0; i < state.clips.length; i++) {
    const clip = state.clips[i];
    const end = cursor + clipDuration(clip);
    if (time < end || i === state.clips.length - 1) return { clip, index: i, localTime: clamp(time - cursor, 0, clipDuration(clip)), timelineStart: cursor };
    cursor = end;
  }
  return null;
}
function getAsset(id) { return state.assets.find((asset) => asset.id === id); }
function getUrl(asset) {
  if (!asset) return '';
  if (!state.objectUrls.has(asset.id)) state.objectUrls.set(asset.id, URL.createObjectURL(asset.blob));
  return state.objectUrls.get(asset.id);
}
function bytesLabel(bytes = 0) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('toastRegion').append(el);
  window.setTimeout(() => el.remove(), 3400);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ASSET_STORE)) db.createObjectStore(ASSET_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(PROJECT_STORE)) db.createObjectStore(PROJECT_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function storeRequest(storeName, mode, action) {
  return new Promise((resolve, reject) => {
    const transaction = state.db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let request;
    try { request = action(store); } catch (error) { reject(error); return; }
    if (request) {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    } else {
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => reject(transaction.error);
    }
  });
}
async function persistAsset(asset) {
  await storeRequest(ASSET_STORE, 'readwrite', (store) => store.put(asset));
}
async function removeAssetFromDB(id) {
  await storeRequest(ASSET_STORE, 'readwrite', (store) => store.delete(id));
}
async function saveProject(silent = false) {
  if (!state.db) return;
  state.saving = true;
  $('saveState').textContent = 'Saving…';
  const project = {
    id: 'current', name: state.name, aspect: state.aspect,
    clips: state.clips, captions: state.captions, updatedAt: new Date().toISOString(),
  };
  try {
    await storeRequest(PROJECT_STORE, 'readwrite', (store) => store.put(project));
    $('saveState').textContent = 'Saved locally';
    if (!silent) toast('Project saved in this browser.', 'success');
  } catch (error) {
    console.error(error);
    $('saveState').textContent = 'Save failed';
    toast('Could not save the project. Check browser storage permissions.', 'error');
  } finally { state.saving = false; }
}
async function restoreProject() {
  const saved = await storeRequest(PROJECT_STORE, 'readonly', (store) => store.get('current'));
  if (!saved) return;
  state.name = saved.name || state.name;
  state.aspect = saved.aspect || state.aspect;
  state.clips = Array.isArray(saved.clips) ? saved.clips : [];
  state.captions = Array.isArray(saved.captions) ? saved.captions : [];
  $('projectName').value = state.name;
  $('aspectSelect').value = state.aspect;
}

function rememberHistory() {
  const snapshot = JSON.stringify({ clips: state.clips, captions: state.captions, selectedClipId: state.selectedClipId, selectedCaptionId: state.selectedCaptionId });
  state.history = state.history.slice(0, state.historyIndex + 1);
  state.history.push(snapshot);
  if (state.history.length > 40) state.history.shift();
  state.historyIndex = state.history.length - 1;
  updateHistoryButtons();
  scheduleSave();
}
function updateHistoryButtons() {
  $('undoBtn').disabled = state.historyIndex <= 0;
  $('redoBtn').disabled = state.historyIndex < 0 || state.historyIndex >= state.history.length - 1;
}
function applyHistory(direction) {
  const next = state.historyIndex + direction;
  if (next < 0 || next >= state.history.length) return;
  state.historyIndex = next;
  const snapshot = JSON.parse(state.history[next]);
  state.clips = snapshot.clips;
  state.captions = snapshot.captions;
  state.selectedClipId = snapshot.selectedClipId;
  state.selectedCaptionId = snapshot.selectedCaptionId;
  updateHistoryButtons();
  renderAll();
  scheduleSave();
}
let saveTimer;
function scheduleSave() {
  window.clearTimeout(saveTimer);
  $('saveState').textContent = 'Unsaved changes';
  saveTimer = window.setTimeout(() => saveProject(true), 650);
}

function assetKind(file) {
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('audio/')) return 'audio';
  return null;
}
async function readMediaDuration(asset) {
  if (asset.kind === 'image') return 5;
  const url = getUrl(asset);
  const element = document.createElement(asset.kind === 'audio' ? 'audio' : 'video');
  element.preload = 'metadata';
  element.src = url;
  return new Promise((resolve) => {
    element.onloadedmetadata = () => resolve(Number.isFinite(element.duration) ? element.duration : 5);
    element.onerror = () => resolve(5);
    window.setTimeout(() => resolve(5), 9000);
  });
}
async function importFiles(files) {
  const accepted = [...files].filter((file) => assetKind(file));
  if (!accepted.length) { toast('Choose a supported video, image or audio file.', 'error'); return; }
  let added = 0;
  for (const file of accepted) {
    const kind = assetKind(file);
    const asset = { id: uid('asset'), name: file.name, type: file.type, kind, size: file.size, blob: file, createdAt: Date.now(), duration: 5 };
    asset.duration = await readMediaDuration(asset);
    await persistAsset(asset);
    state.assets.push(asset);
    added++;
  }
  renderAssets();
  toast(`${added} file${added === 1 ? '' : 's'} imported.`, 'success');
}

function addAssetToTimeline(assetId) {
  const asset = getAsset(assetId);
  if (!asset) return;
  if (asset.kind === 'audio') {
    toast('Audio is in the library. Dedicated audio-track mixing is part of the next editing milestone.');
    return;
  }
  const clip = {
    id: uid('clip'), assetId, name: asset.name, kind: asset.kind,
    inPoint: 0, outPoint: Math.max(.2, asset.duration),
  };
  state.clips.push(clip);
  state.selectedClipId = clip.id;
  state.selectedCaptionId = null;
  state.playhead = Math.max(0, totalDuration() - clipDuration(clip));
  rememberHistory();
  renderAll();
  toast(`${asset.name} added to the timeline.`, 'success');
}
function selectClip(id) {
  state.selectedClipId = id;
  state.selectedCaptionId = null;
  const index = state.clips.findIndex((clip) => clip.id === id);
  if (index >= 0) state.playhead = clipStartAt(index);
  renderAll();
}
function removeSelected() {
  if (state.selectedCaptionId) {
    state.captions = state.captions.filter((caption) => caption.id !== state.selectedCaptionId);
    state.selectedCaptionId = null;
  } else if (state.selectedClipId) {
    const index = state.clips.findIndex((clip) => clip.id === state.selectedClipId);
    state.clips = state.clips.filter((clip) => clip.id !== state.selectedClipId);
    state.selectedClipId = null;
    state.playhead = clamp(state.playhead, 0, totalDuration());
    if (index > 0 && state.clips[index - 1]) state.selectedClipId = state.clips[index - 1].id;
  } else return;
  rememberHistory();
  renderAll();
}
function splitSelected() {
  const active = activeClipAt(state.playhead);
  if (!active) { toast('Add and select a video clip before splitting.'); return; }
  const clip = active.clip;
  const splitAt = clip.inPoint + active.localTime;
  if (splitAt <= clip.inPoint + .08 || splitAt >= clip.outPoint - .08) { toast('Move the playhead inside the selected clip to split it.'); return; }
  const first = { ...clip, id: uid('clip'), outPoint: splitAt };
  const second = { ...clip, id: uid('clip'), inPoint: splitAt };
  state.clips.splice(active.index, 1, first, second);
  state.selectedClipId = second.id;
  rememberHistory();
  renderAll();
  toast('Clip split at the playhead.', 'success');
}
function addCaption(text = 'Your title goes here') {
  const caption = { id: uid('caption'), text, start: Math.max(0, state.playhead), end: Math.min(Math.max(4, totalDuration()), Math.max(0, state.playhead) + 4), style: 'bold' };
  if (caption.end <= caption.start) caption.end = caption.start + 4;
  state.captions.push(caption);
  state.selectedCaptionId = caption.id;
  state.selectedClipId = null;
  rememberHistory();
  renderAll();
}
function changeClipProperty(key, value) {
  const clip = state.clips.find((item) => item.id === state.selectedClipId);
  if (!clip) return;
  const number = Number(value);
  if (key === 'inPoint') clip.inPoint = clamp(number, 0, clip.outPoint - .1);
  if (key === 'outPoint') clip.outPoint = clamp(number, clip.inPoint + .1, getAsset(clip.assetId)?.duration || number);
  rememberHistory(); renderAll();
}
function changeCaptionProperty(key, value) {
  const caption = state.captions.find((item) => item.id === state.selectedCaptionId);
  if (!caption) return;
  if (key === 'start') caption.start = Math.max(0, Number(value));
  if (key === 'end') caption.end = Math.max(caption.start + .1, Number(value));
  if (key === 'text') caption.text = value;
  rememberHistory(); renderAll();
}

function renderAssets() {
  const filter = state.mediaFilter;
  const assets = state.assets.filter((asset) => filter === 'all' || asset.kind === filter);
  $('assetCount').textContent = String(state.assets.length);
  $('assetGrid').innerHTML = '';
  if (!assets.length) {
    $('assetGrid').innerHTML = `<div class="empty-state"><span class="empty-icon">▧</span><strong>${state.assets.length ? 'No matching assets' : 'Your media lives here'}</strong><p>${state.assets.length ? 'Choose another media filter.' : 'Import footage, images and audio to start building your story.'}</p></div>`;
    return;
  }
  for (const asset of assets) {
    const card = document.createElement('div');
    card.className = 'asset-card';
    card.draggable = true;
    card.addEventListener('dragstart', (event) => event.dataTransfer.setData('text/frameflow-asset', asset.id));
    const thumb = document.createElement('div'); thumb.className = 'asset-thumb';
    if (asset.kind === 'image') {
      const img = document.createElement('img'); img.src = getUrl(asset); img.alt = ''; thumb.append(img);
    } else if (asset.kind === 'video') {
      const v = document.createElement('video'); v.src = getUrl(asset); v.muted = true; v.preload = 'metadata'; v.alt = ''; thumb.append(v);
    } else {
      const symbol = document.createElement('span'); symbol.textContent = '♫'; symbol.style.cssText = 'font-size:28px;color:#d7a7f4'; thumb.append(symbol);
    }
    const type = document.createElement('span'); type.className = 'asset-type'; type.textContent = asset.kind.toUpperCase(); thumb.append(type);
    const add = document.createElement('button'); add.className = 'asset-add'; add.textContent = '+'; add.title = 'Add to timeline'; add.addEventListener('click', (event) => { event.stopPropagation(); addAssetToTimeline(asset.id); }); thumb.append(add);
    const info = document.createElement('div'); info.className = 'asset-info';
    const name = document.createElement('strong'); name.textContent = asset.name;
    const meta = document.createElement('span'); meta.textContent = `${bytesLabel(asset.size)}${asset.kind === 'audio' ? '' : ` · ${fmt(asset.duration)}`}`;
    info.append(name, meta); card.append(thumb, info);
    card.addEventListener('click', () => addAssetToTimeline(asset.id));
    $('assetGrid').append(card);
  }
}

function timelineScale() { return Number(state.zoom); }
function renderRuler() {
  const duration = Math.max(20, totalDuration() + 8);
  const px = timelineScale();
  const width = Math.max(700, duration * px);
  const ruler = $('ruler');
  ruler.style.width = `${width}px`;
  ruler.style.setProperty('--px', `${px}px`);
  ruler.innerHTML = '';
  for (let t = 0; t <= duration; t += Math.max(1, Math.round(60 / px))) {
    const mark = document.createElement('span'); mark.className = 'ruler-tick'; mark.style.left = `${t * px}px`; mark.textContent = fmt(t); ruler.append(mark);
  }
  for (const laneEl of [$('videoLane'), $('audioLane'), $('textLane')]) {
    laneEl.style.width = `${width}px`; laneEl.style.setProperty('--px', `${px}px`);
  }
  $('playhead').style.left = `${104 + state.playhead * px}px`;
  $('playhead').style.transform = `translateX(-0.5px)`;
  $('timelineDuration').textContent = `${fmt(totalDuration())} total duration`;
  $('clipCount').textContent = `${state.clips.length} clip${state.clips.length === 1 ? '' : 's'}`;
}
function renderVideoLane() {
  lane.innerHTML = '';
  if (!state.clips.length) { lane.innerHTML = '<div class="lane-empty">Drag media here or add it from the library</div>'; return; }
  const px = timelineScale();
  state.clips.forEach((clip, index) => {
    const asset = getAsset(clip.assetId);
    const el = document.createElement('div');
    el.className = `timeline-clip ${state.selectedClipId === clip.id ? 'selected' : ''}`;
    el.style.width = `${Math.max(62, clipDuration(clip) * px)}px`;
    el.title = `${clip.name} · ${fmt(clipDuration(clip))}`;
    const thumb = document.createElement(asset?.kind === 'image' ? 'img' : 'span');
    if (asset?.kind === 'image') { thumb.src = getUrl(asset); thumb.alt = ''; thumb.className = 'clip-thumb'; }
    else { thumb.className = 'clip-thumb'; thumb.textContent = '▶'; thumb.style.cssText = 'display:grid;place-items:center;color:#b6d8e3;background:#27475a'; }
    const name = document.createElement('span'); name.className = 'clip-name'; name.textContent = clip.name;
    const time = document.createElement('span'); time.className = 'clip-duration'; time.textContent = fmt(clipDuration(clip));
    el.append(thumb, name, time);
    el.addEventListener('click', () => selectClip(clip.id));
    lane.append(el);
  });
}
function renderCaptionLane() {
  const textLane = $('textLane'); textLane.innerHTML = '';
  if (!state.captions.length) { textLane.innerHTML = '<div class="lane-empty">Titles and captions</div>'; return; }
  const px = timelineScale();
  for (const caption of state.captions) {
    const el = document.createElement('div');
    el.className = `timeline-clip text-clip ${state.selectedCaptionId === caption.id ? 'selected' : ''}`;
    el.style.width = `${Math.max(50, (caption.end - caption.start) * px)}px`;
    el.style.left = `${caption.start * px}px`;
    const name = document.createElement('span'); name.className = 'clip-name'; name.textContent = caption.text;
    el.append(name); el.addEventListener('click', () => { state.selectedCaptionId = caption.id; state.selectedClipId = null; state.playhead = caption.start; renderAll(); }); textLane.append(el);
  }
}
function renderPreview() {
  const active = activeClipAt(state.playhead);
  const overlayCaption = state.captions.find((caption) => state.playhead >= caption.start && state.playhead <= caption.end);
  $('previewOverlay').textContent = overlayCaption?.text || '';
  if (!active) {
    video.pause(); video.classList.remove('visible'); image.classList.remove('visible');
    $('previewPlaceholder').classList.remove('hidden');
    $('previewClipName').textContent = 'No clip selected';
    $('previewTime').textContent = `${fmt(state.playhead)} / ${fmt(totalDuration())}`;
    return;
  }
  const asset = getAsset(active.clip.assetId);
  $('previewPlaceholder').classList.add('hidden');
  $('previewClipName').textContent = active.clip.name;
  $('previewTime').textContent = `${fmt(state.playhead)} / ${fmt(totalDuration())}`;
  if (asset?.kind === 'image') {
    video.pause(); video.classList.remove('visible');
    image.src = getUrl(asset); image.classList.add('visible');
  } else if (asset?.kind === 'video') {
    image.classList.remove('visible');
    const url = getUrl(asset);
    if (video.dataset.assetId !== asset.id) {
      video.pause(); video.src = url; video.dataset.assetId = asset.id; video.load();
      video.onloadedmetadata = () => syncVideoToPlayhead();
    } else syncVideoToPlayhead();
    video.classList.add('visible');
    video.muted = state.muted;
    if (state.isPlaying && video.paused) video.play().catch(() => {});
    if (!state.isPlaying && !video.paused) video.pause();
  }
}
function syncVideoToPlayhead() {
  const active = activeClipAt(state.playhead);
  if (!active || active.clip.kind !== 'video' || !Number.isFinite(video.duration)) return;
  const target = clamp(active.clip.inPoint + active.localTime, 0, Math.max(0, video.duration - .04));
  if (Math.abs(video.currentTime - target) > .35) {
    try { video.currentTime = target; } catch (_) { /* Metadata can still be settling. */ }
  }
}

function renderInspector() {
  const selectedCaption = state.captions.find((caption) => caption.id === state.selectedCaptionId);
  const selectedClip = state.clips.find((clip) => clip.id === state.selectedClipId);
  const root = $('inspectorContent'); root.innerHTML = '';
  if (selectedCaption) {
    root.innerHTML = `<div class="inspector-section"><h3>TEXT LAYER</h3><div class="field"><label for="captionText">Content</label><textarea id="captionText" maxlength="160"></textarea></div><div class="field-row"><div class="field"><label for="captionStart">Start (sec)</label><input id="captionStart" type="number" min="0" step="0.1"></div><div class="field"><label for="captionEnd">End (sec)</label><input id="captionEnd" type="number" min="0.1" step="0.1"></div></div><p class="inspector-note">Text overlays are included in the preview and browser WebM export.</p><button class="mini-button" id="deleteCaptionBtn">Delete text layer</button></div>`;
    $('captionText').value = selectedCaption.text;
    $('captionStart').value = selectedCaption.start.toFixed(1);
    $('captionEnd').value = selectedCaption.end.toFixed(1);
    $('captionText').addEventListener('change', (e) => changeCaptionProperty('text', e.target.value));
    $('captionStart').addEventListener('change', (e) => changeCaptionProperty('start', e.target.value));
    $('captionEnd').addEventListener('change', (e) => changeCaptionProperty('end', e.target.value));
    $('deleteCaptionBtn').addEventListener('click', removeSelected);
    return;
  }
  if (!selectedClip) {
    root.innerHTML = `<div class="inspector-empty"><div class="inspector-empty-icon">⌑</div><strong>Nothing selected</strong><p>Select a clip on the timeline to adjust its properties, timing and appearance.</p></div>`;
    return;
  }
  const asset = getAsset(selectedClip.assetId);
  root.innerHTML = `<div class="inspector-section"><h3>CLIP DETAILS</h3><div class="field"><label>File name</label><input id="clipName" value="" readonly></div><div class="field"><label>Media type</label><input value="${selectedClip.kind.toUpperCase()}" readonly></div></div><div class="inspector-section"><h3>TRIM & TIMING</h3><div class="field-row"><div class="field"><label for="clipIn">In point (sec)</label><input id="clipIn" type="number" min="0" step="0.1"></div><div class="field"><label for="clipOut">Out point (sec)</label><input id="clipOut" type="number" min="0.1" step="0.1"></div></div><div class="field"><label>Clip duration</label><input id="clipDuration" readonly value=""></div><p class="inspector-note">Trim points reference the original source file. Clips are arranged sequentially in this starter timeline.</p></div><div class="inspector-section"><h3>QUICK ACTIONS</h3><div class="field-row"><button class="mini-button" id="clipToStartBtn">Move playhead to start</button><button class="mini-button" id="duplicateClipBtn">Duplicate clip</button></div><button class="mini-button" id="removeClipBtn">Remove from timeline</button></div>`;
  $('clipName').value = selectedClip.name;
  $('clipIn').value = selectedClip.inPoint.toFixed(1);
  $('clipOut').value = selectedClip.outPoint.toFixed(1);
  $('clipOut').max = asset?.duration || selectedClip.outPoint;
  $('clipDuration').value = `${clipDuration(selectedClip).toFixed(2)} seconds`;
  $('clipIn').addEventListener('change', (e) => changeClipProperty('inPoint', e.target.value));
  $('clipOut').addEventListener('change', (e) => changeClipProperty('outPoint', e.target.value));
  $('clipToStartBtn').addEventListener('click', () => { const index = state.clips.findIndex((clip) => clip.id === selectedClip.id); state.playhead = clipStartAt(index); renderAll(); });
  $('duplicateClipBtn').addEventListener('click', () => { const index = state.clips.findIndex((clip) => clip.id === selectedClip.id); const clone = { ...selectedClip, id: uid('clip') }; state.clips.splice(index + 1, 0, clone); state.selectedClipId = clone.id; rememberHistory(); renderAll(); });
  $('removeClipBtn').addEventListener('click', removeSelected);
}
function renderAspect() {
  $('previewFrame').className = `preview-frame frame-${state.aspect.replace(':', '-')}`;
}
function renderAll() {
  renderAssets(); renderRuler(); renderVideoLane(); renderCaptionLane(); renderPreview(); renderInspector(); renderAspect(); updateHistoryButtons();
}

function setPanel(name) {
  state.activePanel = name;
  document.querySelectorAll('.rail-btn[data-panel]').forEach((button) => button.classList.toggle('active', button.dataset.panel === name));
  const titles = { media: 'Media library', scenes: 'Scene builder', text: 'Text & captions', audio: 'Audio library' };
  $('panelTitle').textContent = titles[name] || 'Media library';
  if (name === 'scenes') showSceneBuilder();
  else if (name === 'text') showTextPanel();
  else if (name === 'audio') { state.mediaFilter = 'audio'; document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.filter === 'audio')); renderAssets(); }
  else { state.mediaFilter = 'all'; document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.filter === 'all')); renderAssets(); }
}
function showSceneBuilder() {
  $('assetGrid').innerHTML = `<div class="empty-state"><span class="empty-icon">▦</span><strong>Build a visual story</strong><p>Write a brief in the creative assistant below and draft a scene outline. Add your media to turn the outline into an edit.</p></div><div class="scene-shortcuts"><button class="mini-button" id="sceneProductBtn">Product video</button><button class="mini-button" id="sceneTutorialBtn">Tutorial</button><button class="mini-button" id="sceneSocialBtn">Social reel</button></div>`;
  $('sceneProductBtn')?.addEventListener('click', () => { $('promptInput').value = 'Create a short product launch video with a bold hook, product benefits, a demonstration and a clear call to action.'; $('promptInput').focus(); });
  $('sceneTutorialBtn')?.addEventListener('click', () => { $('promptInput').value = 'Create a beginner tutorial with a clear introduction, three practical steps and a concise recap.'; $('promptInput').focus(); });
  $('sceneSocialBtn')?.addEventListener('click', () => { $('promptInput').value = 'Create a vertical social video with a strong opening, fast visual changes, captions and a memorable closing line.'; $('promptInput').focus(); });
}
function showTextPanel() {
  $('assetGrid').innerHTML = `<div class="empty-state"><span class="empty-icon">T</span><strong>Titles and captions</strong><p>Add editable text overlays to your sequence. Select a text layer to adjust its copy and timing.</p><button class="mini-button" id="panelAddTextBtn">＋ Add text layer</button></div>`;
  $('panelAddTextBtn')?.addEventListener('click', () => addCaption());
}
function draftScenes() {
  const prompt = $('promptInput').value.trim();
  if (!prompt) { toast('Describe the video you want to make first.'); $('promptInput').focus(); return; }
  const templates = [
    ['01 · HOOK', 'Open with the strongest visual and a one-line promise.'],
    ['02 · CONTEXT', 'Introduce the subject, problem or opportunity.'],
    ['03 · MAIN STORY', 'Show the key demonstration, explanation or transformation.'],
    ['04 · CLOSE', 'End with the takeaway and a clear call to action.'],
  ];
  const container = $('assetGrid');
  container.innerHTML = `<div class="scene-note">LOCAL STORYBOARD DRAFT <span>Not generated by an AI model</span></div>`;
  templates.forEach(([title, description], index) => {
    const card = document.createElement('div'); card.className = 'scene-card';
    const h = document.createElement('strong'); h.textContent = title;
    const p = document.createElement('p'); p.textContent = description;
    const brief = document.createElement('small'); brief.textContent = prompt.length > 76 ? `${prompt.slice(0, 76)}…` : prompt;
    const add = document.createElement('button'); add.className = 'mini-button'; add.textContent = 'Add scene title';
    add.addEventListener('click', () => addCaption(index === 0 ? 'THE BIG IDEA' : index === 1 ? 'WHY IT MATTERS' : index === 2 ? 'SEE HOW IT WORKS' : 'GET STARTED TODAY'));
    card.append(h, p, brief, add); container.append(card);
  });
  toast('Storyboard structure drafted locally. Connect an AI provider for generated scripts and scene assets.', 'success');
}

function updatePlayhead(time) {
  state.playhead = clamp(time, 0, totalDuration());
  renderRuler(); renderPreview();
  if (!state.isPlaying) renderVideoLane();
}
function togglePlayback() {
  if (!state.clips.length) { toast('Import media and add a clip to start playback.'); return; }
  if (state.isPlaying) {
    state.isPlaying = false; video.pause(); $('playBtn').textContent = '▶'; $('previewStatus').textContent = 'PAUSED';
  } else {
    if (state.playhead >= totalDuration()) state.playhead = 0;
    state.isPlaying = true; $('playBtn').textContent = 'Ⅱ'; $('previewStatus').textContent = 'PLAYING';
    const active = activeClipAt(state.playhead);
    if (active?.clip.kind === 'video') { renderPreview(); video.play().catch(() => { state.isPlaying = false; $('playBtn').textContent = '▶'; }); }
  }
  renderPreview();
}
let previousFrame = 0;
function animationLoop(timestamp) {
  if (state.isPlaying) {
    if (previousFrame) {
      const delta = Math.min(.08, (timestamp - previousFrame) / 1000);
      const next = state.playhead + delta;
      if (next >= totalDuration()) {
        state.playhead = totalDuration(); state.isPlaying = false; video.pause(); $('playBtn').textContent = '▶'; $('previewStatus').textContent = 'PREVIEW';
      } else state.playhead = next;
      const active = activeClipAt(state.playhead);
      if (active?.clip.kind === 'video') {
        const asset = getAsset(active.clip.assetId);
        if (video.dataset.assetId !== asset?.id) renderPreview();
        else {
          const expected = active.clip.inPoint + active.localTime;
          if (Math.abs(video.currentTime - expected) > .75) syncVideoToPlayhead();
        }
      } else if (!active) renderPreview();
      $('playhead').style.left = `${104 + state.playhead * timelineScale()}px`;
      $('previewTime').textContent = `${fmt(state.playhead)} / ${fmt(totalDuration())}`;
      const cap = state.captions.find((caption) => state.playhead >= caption.start && state.playhead <= caption.end);
      $('previewOverlay').textContent = cap?.text || '';
    }
    previousFrame = timestamp;
  } else previousFrame = 0;
  requestAnimationFrame(animationLoop);
}

function drawCover(context, source, width, height) {
  const sw = source.videoWidth || source.naturalWidth || width;
  const sh = source.videoHeight || source.naturalHeight || height;
  const ratio = Math.min(width / sw, height / sh);
  const w = sw * ratio, h = sh * ratio;
  context.fillStyle = '#080a10'; context.fillRect(0, 0, width, height);
  context.drawImage(source, (width - w) / 2, (height - h) / 2, w, h);
}
function drawCanvasCaptions(context, timelineTime, width, height) {
  const active = state.captions.find((caption) => timelineTime >= caption.start && timelineTime <= caption.end);
  if (!active) return;
  context.save();
  const fontSize = Math.round(width * .045);
  context.font = `700 ${fontSize}px Arial, sans-serif`;
  context.textAlign = 'center'; context.textBaseline = 'middle';
  const lines = String(active.text).split('\n').slice(0, 3);
  const lineHeight = fontSize * 1.25;
  const baseY = height * .82 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, i) => {
    context.lineWidth = Math.max(4, fontSize * .13); context.strokeStyle = 'rgba(0,0,0,.82)'; context.lineJoin = 'round';
    context.strokeText(line, width / 2, baseY + i * lineHeight, width * .84);
    context.fillStyle = '#fff'; context.fillText(line, width / 2, baseY + i * lineHeight, width * .84);
  });
  context.restore();
}
function canvasDimensions(aspect) {
  if (aspect === '9:16') return [720, 1280];
  if (aspect === '1:1') return [1080, 1080];
  if (aspect === '4:5') return [864, 1080];
  return [1280, 720];
}
function waitForMedia(element, eventName, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Media loading timed out.')), timeout);
    element.addEventListener(eventName, () => { clearTimeout(timer); resolve(); }, { once: true });
    element.addEventListener('error', () => { clearTimeout(timer); reject(new Error('A media file could not be decoded.')); }, { once: true });
  });
}
function waitSeek(element, time) {
  return new Promise((resolve) => {
    if (Math.abs(element.currentTime - time) < .03) return resolve();
    element.addEventListener('seeked', resolve, { once: true });
    element.currentTime = time;
  });
}
async function exportVideo() {
  if (!state.clips.length) { toast('Add at least one video or image clip before exporting.'); return; }
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
    toast('This browser does not support canvas video recording. Try a recent Chrome or Edge browser.', 'error'); return;
  }
  const [width, height] = canvasDimensions(state.aspect);
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  const stream = canvas.captureStream(30);
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type)) || '';
  const chunks = [];
  let recorder;
  try {
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  } catch (error) { toast(`Export could not start: ${error.message}`, 'error'); return; }
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
  const button = $('exportBtn'); button.disabled = true; button.textContent = 'Rendering…';
  recorder.start(250);
  try {
    let globalTime = 0;
    for (const clip of state.clips) {
      const asset = getAsset(clip.assetId);
      if (!asset) continue;
      const duration = clipDuration(clip);
      if (asset.kind === 'image') {
        const img = new Image(); img.src = getUrl(asset);
        if (!img.complete) await waitForMedia(img, 'load');
        const started = performance.now();
        while ((performance.now() - started) / 1000 < duration) {
          drawCover(context, img, width, height); drawCanvasCaptions(context, globalTime + (performance.now() - started) / 1000, width, height);
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
      } else if (asset.kind === 'video') {
        const source = document.createElement('video'); source.src = getUrl(asset); source.preload = 'auto'; source.muted = true; source.playsInline = true;
        source.style.position = 'fixed'; source.style.left = '-10000px'; document.body.append(source);
        try {
          await waitForMedia(source, 'loadedmetadata');
          await waitSeek(source, clip.inPoint);
          await source.play();
          const started = performance.now();
          while (source.currentTime < clip.outPoint - .025 && (performance.now() - started) / 1000 < duration + 2) {
            drawCover(context, source, width, height);
            drawCanvasCaptions(context, globalTime + (source.currentTime - clip.inPoint), width, height);
            await new Promise((resolve) => requestAnimationFrame(resolve));
          }
        } finally { source.pause(); source.remove(); }
      }
      globalTime += duration;
    }
    await new Promise((resolve) => setTimeout(resolve, 180));
    recorder.stop(); await stopped;
    const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = `${(state.name || 'frameflow-project').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()}.webm`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast('WebM video exported. This starter exports a silent visual track; audio mixing and MP4 encoding are planned next.', 'success');
  } catch (error) {
    console.error(error);
    if (recorder.state !== 'inactive') recorder.stop();
    await stopped;
    toast(`Export stopped: ${error.message}`, 'error');
  } finally {
    stream.getTracks().forEach((track) => track.stop());
    button.disabled = false; button.innerHTML = '<span class="button-icon">↗</span> Export video';
  }
}

function exportProjectFile() {
  const project = { format: 'frameflow-project', version: 1, name: state.name, aspect: state.aspect, clips: state.clips, captions: state.captions, exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${state.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase() || 'frameflow-project'}.frameflow.json`; a.click(); URL.revokeObjectURL(url);
  toast('Project edit data exported. Media files are not embedded; keep the originals.', 'success');
}
function showGuide() {
  toast('Quick start: Import media → add clips to the timeline → select a clip to trim → add text → export a silent WebM preview. See README.md for current limits and the build roadmap.');
}

function bindEvents() {
  $('fileInput').addEventListener('change', (event) => { importFiles(event.target.files); event.target.value = ''; });
  lane.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.timeline-clip')) return;
    const bounds = lane.getBoundingClientRect();
    state.isPlaying = false; video.pause(); $('playBtn').textContent = '▶';
    updatePlayhead((event.clientX - bounds.left) / timelineScale());
  });
  $('textLane').addEventListener('pointerdown', (event) => {
    if (event.target.closest('.timeline-clip')) return;
    const bounds = $('textLane').getBoundingClientRect();
    state.isPlaying = false; video.pause(); $('playBtn').textContent = '▶';
    updatePlayhead((event.clientX - bounds.left) / timelineScale());
  });
  lane.addEventListener('dragover', (event) => { event.preventDefault(); lane.classList.add('dragover'); });
  lane.addEventListener('dragleave', () => lane.classList.remove('dragover'));
  lane.addEventListener('drop', (event) => { event.preventDefault(); lane.classList.remove('dragover'); const id = event.dataTransfer.getData('text/frameflow-asset'); if (id) addAssetToTimeline(id); });
  $('uploadZone').addEventListener('dragover', (event) => { event.preventDefault(); $('uploadZone').classList.add('dragover'); });
  $('uploadZone').addEventListener('dragleave', () => $('uploadZone').classList.remove('dragover'));
  $('uploadZone').addEventListener('drop', (event) => { event.preventDefault(); $('uploadZone').classList.remove('dragover'); importFiles(event.dataTransfer.files); });
  document.querySelectorAll('.rail-btn[data-panel]').forEach((button) => button.addEventListener('click', () => setPanel(button.dataset.panel)));
  document.querySelectorAll('.tab').forEach((button) => button.addEventListener('click', () => {
    state.mediaFilter = button.dataset.filter; document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab === button)); renderAssets();
  }));
  $('splitBtn').addEventListener('click', splitSelected);
  $('deleteBtn').addEventListener('click', removeSelected);
  $('undoBtn').addEventListener('click', () => applyHistory(-1));
  $('redoBtn').addEventListener('click', () => applyHistory(1));
  $('addTextBtn').addEventListener('click', () => addCaption());
  $('playBtn').addEventListener('click', togglePlayback);
  $('backBtn').addEventListener('click', () => { state.isPlaying = false; $('playBtn').textContent = '▶'; updatePlayhead(state.playhead - 1); });
  $('forwardBtn').addEventListener('click', () => { state.isPlaying = false; $('playBtn').textContent = '▶'; updatePlayhead(state.playhead + 1); });
  $('muteBtn').addEventListener('click', () => { state.muted = !state.muted; video.muted = state.muted; $('muteBtn').textContent = state.muted ? '◌' : '◖'; });
  $('aspectSelect').addEventListener('change', (event) => { state.aspect = event.target.value; renderAspect(); scheduleSave(); });
  $('zoomRange').addEventListener('input', (event) => { state.zoom = Number(event.target.value); renderAll(); });
  $('zoomInBtn').addEventListener('click', () => { state.zoom = clamp(state.zoom + 8, 30, 110); $('zoomRange').value = state.zoom; renderAll(); });
  $('zoomOutBtn').addEventListener('click', () => { state.zoom = clamp(state.zoom - 8, 30, 110); $('zoomRange').value = state.zoom; renderAll(); });
  $('draftBtn').addEventListener('click', draftScenes);
  $('exportBtn').addEventListener('click', exportVideo);
  $('saveProjectBtn').addEventListener('click', () => saveProject());
  $('panelMoreBtn').addEventListener('click', exportProjectFile);
  $('projectName').addEventListener('change', (event) => { state.name = event.target.value.trim() || 'Untitled project'; $('projectName').value = state.name; scheduleSave(); });
  $('fullscreenBtn').addEventListener('click', () => { if (stage.requestFullscreen) stage.requestFullscreen().catch(() => toast('Fullscreen is not available in this browser.')); });
  $('fitBtn').addEventListener('click', () => { state.playhead = 0; renderAll(); });
  $('helpBtn').addEventListener('click', showGuide);
  $('clearAssetsBtn').addEventListener('click', async () => {
    if (!confirm('Remove all imported media from this browser? Timeline clips that use these files will also be removed.')) return;
    for (const asset of state.assets) { await removeAssetFromDB(asset.id); URL.revokeObjectURL(state.objectUrls.get(asset.id) || ''); }
    state.assets = []; state.clips = []; state.captions = []; state.selectedClipId = null; state.selectedCaptionId = null; rememberHistory(); renderAll();
  });
  $('promptInput').addEventListener('keydown', (event) => { if (event.key === 'Enter') draftScenes(); });
  document.addEventListener('keydown', (event) => {
    const tag = event.target?.tagName;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); applyHistory(event.shiftKey ? 1 : -1); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); applyHistory(1); return; }
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.code === 'Space') { event.preventDefault(); togglePlayback(); }
    if (event.key === 'Delete' || event.key === 'Backspace') removeSelected();
  });
}

async function init() {
  bindEvents();
  try {
    state.db = await openDatabase();
    const assets = await storeRequest(ASSET_STORE, 'readonly', (store) => store.getAll());
    state.assets = assets || [];
    await restoreProject();
    $('saveState').textContent = 'Saved locally';
  } catch (error) {
    console.error(error);
    toast('Browser storage is unavailable. You can still use the editor for this session.', 'error');
  }
  rememberHistory();
  renderAll();
  requestAnimationFrame(animationLoop);
}

init();

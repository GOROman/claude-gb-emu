// Game Boy Color emulator frontend
'use strict';

let Module = null;
let running = false;
let muted = false;
let buttons = 0;
let audioCtx = null, workletNode = null, scriptNode = null;
let romKey = null;         // localStorage key for battery save
let saveTimer = 0;

const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
const imageData = ctx.createImageData(160, 144);
const status = document.getElementById('status');
const dropHint = document.getElementById('dropHint');

// ---------------------------------------------------------------- WASM init
createGbModule().then((m) => {
  Module = m;
  Module._gb_init(44100);
  status.textContent = 'ROMを読み込んでください';
  const params = new URLSearchParams(location.search);
  if (params.get('rom')) loadRomFromUrl(params.get('rom'));
});

// ---------------------------------------------------------------- audio
async function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
  Module._gb_init(audioCtx.sampleRate);
  try {
    await audioCtx.audioWorklet.addModule('audio-worklet.js?v=' + window.GB_VER);
    workletNode = new AudioWorkletNode(audioCtx, 'gb-audio', { outputChannelCount: [2] });
    workletNode.connect(audioCtx.destination);
  } catch (e) {
    // non-HTTPS fallback
    const ring = new Float32Array(16384 * 2);
    let rp = 0, wp = 0, avail = 0, lastL = 0, lastR = 0;
    scriptNode = audioCtx.createScriptProcessor(2048, 0, 2);
    scriptNode.onaudioprocess = (ev) => {
      const L = ev.outputBuffer.getChannelData(0), R = ev.outputBuffer.getChannelData(1);
      for (let i = 0; i < L.length; i++) {
        if (avail > 0) { lastL = ring[rp * 2]; lastR = ring[rp * 2 + 1]; rp = (rp + 1) % 16384; avail--; }
        L[i] = lastL; R[i] = lastR;
      }
    };
    scriptNode.connect(audioCtx.destination);
    scriptNode._push = (s) => {
      const frames = s.length >> 1;
      for (let i = 0; i < frames; i++) {
        if (avail >= 16384) break;
        ring[wp * 2] = s[i * 2]; ring[wp * 2 + 1] = s[i * 2 + 1];
        wp = (wp + 1) % 16384; avail++;
      }
    };
  }
}

function pushAudio() {
  if (!Module || muted) { Module && Module._gb_audio_clear(); return; }
  const n = Module._gb_audio_sample_count();
  if (n <= 0) return;
  const ptr = Module._gb_audio_buffer() >> 2;
  const samples = Module.HEAPF32.slice(ptr, ptr + n * 2);
  if (workletNode) workletNode.port.postMessage(samples, [samples.buffer]);
  else if (scriptNode) scriptNode._push(samples);
  Module._gb_audio_clear();
}

// ---------------------------------------------------------------- ROM load
function loadRom(bytes, name) {
  if (!Module) return;
  const buf = Module._gb_rom_buffer();
  if (bytes.length > Module._gb_rom_buffer_size()) { status.textContent = 'ROMが大きすぎます'; return; }
  Module.HEAPU8.set(bytes, buf);
  if (!Module._gb_load_rom(bytes.length)) {
    status.textContent = 'ROMの読み込みに失敗しました: ' + name;
    return;
  }
  // battery save key: title + simple checksum
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 97) sum = (sum * 31 + bytes[i]) >>> 0;
  const titlePtr = Module._gb_rom_title();
  let title = '';
  for (let i = 0; i < 16; i++) {
    const c = Module.HEAPU8[titlePtr + i];
    if (!c) break;
    title += String.fromCharCode(c);
  }
  romKey = 'gbsave:' + title + ':' + sum.toString(16);
  loadBattery();
  const cgb = Module._gb_is_cgb();
  status.textContent = (title || name) + (cgb ? ' [CGB]' : ' [DMG]');
  dropHint.style.display = 'none';
  running = true;
}

async function loadRomFromUrl(url) {
  try {
    status.textContent = 'ダウンロード中…';
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    loadRom(new Uint8Array(await res.arrayBuffer()), url.split('/').pop());
  } catch (e) {
    status.textContent = 'ROMの取得に失敗: ' + e;
  }
}

document.getElementById('romFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  await initAudio();
  audioCtx && audioCtx.resume();
  loadRom(new Uint8Array(await file.arrayBuffer()), file.name);
  e.target.value = '';
});

document.body.addEventListener('dragover', (e) => e.preventDefault());
document.body.addEventListener('drop', async (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (!file) return;
  await initAudio();
  audioCtx && audioCtx.resume();
  loadRom(new Uint8Array(await file.arrayBuffer()), file.name);
});

// ---------------------------------------------------------------- battery save
function saveBattery() {
  if (!Module || !romKey || !Module._gb_has_battery()) return;
  const size = Module._gb_sram_size();
  if (size <= 0) return;
  const ptr = Module._gb_sram();
  const data = Module.HEAPU8.slice(ptr, ptr + size);
  let bin = '';
  for (let i = 0; i < data.length; i++) bin += String.fromCharCode(data[i]);
  try { localStorage.setItem(romKey, btoa(bin)); } catch (e) {}
}

function loadBattery() {
  if (!Module || !romKey || !Module._gb_has_battery()) return;
  const b64 = localStorage.getItem(romKey);
  if (!b64) return;
  try {
    const bin = atob(b64);
    const size = Module._gb_sram_size();
    const ptr = Module._gb_sram();
    for (let i = 0; i < Math.min(bin.length, size); i++) Module.HEAPU8[ptr + i] = bin.charCodeAt(i);
  } catch (e) {}
}

window.addEventListener('beforeunload', saveBattery);

// ---------------------------------------------------------------- input
const KEYMAP = {
  ArrowRight: 0x01, ArrowLeft: 0x02, ArrowUp: 0x04, ArrowDown: 0x08,
  KeyX: 0x10, KeyZ: 0x20, ShiftLeft: 0x40, ShiftRight: 0x40, Enter: 0x80,
};
window.addEventListener('keydown', (e) => {
  const b = KEYMAP[e.code];
  if (b) { buttons |= b; e.preventDefault(); }
  if (e.code === 'KeyR') Module && Module._gb_reset();
  if (e.code === 'KeyF') toggleFullscreen();
});
window.addEventListener('keyup', (e) => {
  const b = KEYMAP[e.code];
  if (b) { buttons &= ~b; e.preventDefault(); }
});

// gamepad
function pollGamepad() {
  const gps = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of gps) {
    if (!gp) continue;
    let b = 0;
    const bt = gp.buttons;
    if (bt[0] && bt[0].pressed) b |= 0x10;         // A
    if (bt[1] && bt[1].pressed) b |= 0x20;         // B (swap feel: 0=bottom)
    if (bt[2] && bt[2].pressed) b |= 0x20;
    if (bt[8] && bt[8].pressed) b |= 0x40;         // select
    if (bt[9] && bt[9].pressed) b |= 0x80;         // start
    if (bt[12] && bt[12].pressed) b |= 0x04;
    if (bt[13] && bt[13].pressed) b |= 0x08;
    if (bt[14] && bt[14].pressed) b |= 0x02;
    if (bt[15] && bt[15].pressed) b |= 0x01;
    if (gp.axes.length >= 2) {
      if (gp.axes[0] < -0.5) b |= 0x02;
      if (gp.axes[0] > 0.5) b |= 0x01;
      if (gp.axes[1] < -0.5) b |= 0x04;
      if (gp.axes[1] > 0.5) b |= 0x08;
    }
    if (b) return b;
  }
  return 0;
}

// touch pad
if ('ontouchstart' in window) document.body.classList.add('touch');
let touchButtons = 0;
for (const el of document.querySelectorAll('[data-btn]')) {
  const bit = parseInt(el.dataset.btn, 10);
  const press = (e) => { e.preventDefault(); touchButtons |= bit; el.classList.add('pressed'); };
  const release = (e) => { e.preventDefault(); touchButtons &= ~bit; el.classList.remove('pressed'); };
  el.addEventListener('touchstart', press, { passive: false });
  el.addEventListener('touchend', release, { passive: false });
  el.addEventListener('touchcancel', release, { passive: false });
}

// ---------------------------------------------------------------- UI buttons
document.getElementById('btnReset').addEventListener('click', () => {
  Module && Module._gb_reset();
});
document.getElementById('btnMute').addEventListener('click', (e) => {
  muted = !muted;
  e.target.textContent = muted ? '🔇 Muted' : '🔊 Sound';
});
function toggleFullscreen() {
  const wrap = document.getElementById('screenWrap');
  if (document.fullscreenElement) document.exitFullscreen();
  else wrap.requestFullscreen && wrap.requestFullscreen();
}
document.getElementById('btnFull').addEventListener('click', toggleFullscreen);

// ---------------------------------------------------------------- main loop
const FRAME_MS = 1000 / 59.7275;
let lastTime = 0, acc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  if (!Module || !running) return;
  if (!lastTime) lastTime = now;
  acc += now - lastTime;
  lastTime = now;
  if (acc > 100) acc = 100;      // avoid spiral after tab switch

  let ran = false;
  while (acc >= FRAME_MS) {
    acc -= FRAME_MS;
    Module._gb_set_buttons(buttons | touchButtons | pollGamepad());
    Module._gb_frame();
    ran = true;
  }
  if (ran) {
    pushAudio();
    const ptr = Module._gb_framebuffer();
    imageData.data.set(Module.HEAPU8.subarray(ptr, ptr + 160 * 144 * 4));
    ctx.putImageData(imageData, 0, 0);
    if (++saveTimer >= 300) { saveTimer = 0; saveBattery(); } // autosave every ~5s
  }
}
requestAnimationFrame(frame);

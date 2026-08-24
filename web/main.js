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
const dropHint = document.getElementById('drop-hint');

// ---------------------------------------------------------------- WASM init
createGbModule().then((m) => {
  Module = m;
  Module._gb_init(44100);
  const params = new URLSearchParams(location.search);
  if (params.get('fm') === '1') setFm(true);
  if (params.get('rom')) loadRomFromUrl(params.get('rom'));
});

// ---------------------------------------------------------------- audio
async function initAudio() {
  if (audioCtx) { audioCtx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  try { audioCtx = new AC({ sampleRate: 44100 }); }
  catch (e) { audioCtx = new AC(); }        // some browsers reject the sampleRate option
  // resume synchronously inside the user gesture (required on iOS) —
  // everything after the first await runs outside the gesture call stack
  audioCtx.resume();
  Module && Module._gb_init(audioCtx.sampleRate);
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
  audioCtx.resume();
}

// audio can only start from a user gesture — arm on the first one, and keep
// resuming on later gestures in case the context got suspended (iOS does this
// on background/incoming calls, and a failed first resume needs a retry)
function armAudio() {
  if (!audioCtx) { initAudio(); return; }
  if (audioCtx.state !== 'running') audioCtx.resume();
}
window.addEventListener('pointerdown', armAudio);
window.addEventListener('touchstart', armAudio, { passive: true });
window.addEventListener('keydown', armAudio);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && audioCtx && audioCtx.state !== 'running') audioCtx.resume();
});

function pushAudio() {
  if (!Module) return;
  if (muted) { Module._gb_audio_clear(); return; }
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
    if (!res.ok) throw new Error('HTTP ' + res.status);
    loadRom(new Uint8Array(await res.arrayBuffer()), url.split('/').pop());
    // reflect the ROM URL in the address bar so the link is shareable
    const p = new URLSearchParams(location.search);
    p.set('rom', url);
    history.replaceState(null, '', '?' + p.toString());
  } catch (e) {
    status.textContent = 'ROMの取得に失敗: ' + (e.message || e);
  }
}

document.getElementById('rom-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  await initAudio();
  loadRom(new Uint8Array(await file.arrayBuffer()), file.name);
  e.target.value = '';
});

document.body.addEventListener('dragover', (e) => e.preventDefault());
document.body.addEventListener('drop', async (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (!file) return;
  await initAudio();
  loadRom(new Uint8Array(await file.arrayBuffer()), file.name);
});

// URL load row
document.getElementById('btn-url').addEventListener('click', () => {
  document.body.classList.toggle('url-on');
  if (document.body.classList.contains('url-on')) document.getElementById('url-input').focus();
});
async function loadFromUrlField() {
  const url = document.getElementById('url-input').value.trim();
  if (!url) return;
  await initAudio();
  loadRomFromUrl(url);
}
document.getElementById('btn-url-load').addEventListener('click', loadFromUrlField);
document.getElementById('url-input').addEventListener('keydown', (e) => {
  e.stopPropagation();               // don't feed the emulator while typing
  if (e.key === 'Enter') loadFromUrlField();
});
document.getElementById('url-input').addEventListener('keyup', (e) => e.stopPropagation());

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
  if (e.code === 'KeyD') toggleDebug();
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
    if (bt[1] && bt[1].pressed) b |= 0x20;         // B
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

// virtual pad
let touchButtons = 0;
for (const el of document.querySelectorAll('.pbtn')) {
  const bit = parseInt(el.dataset.btn, 10);
  const press = (e) => { e.preventDefault(); touchButtons |= bit; el.classList.add('active'); };
  const release = (e) => { e.preventDefault(); touchButtons &= ~bit; el.classList.remove('active'); };
  el.addEventListener('pointerdown', press);
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('pointerleave', release);
}

// ---------------------------------------------------------------- UI buttons
document.getElementById('btn-reset').addEventListener('click', () => {
  Module && Module._gb_reset();
});
function setFm(on) {
  if (!Module) return;
  Module._gb_set_fm(on ? 1 : 0);
  const btn = document.getElementById('btn-fm');
  btn.classList.toggle('fm-on', on);
  btn.textContent = on ? 'FM ♪' : 'FM';
  const p = new URLSearchParams(location.search);
  if (on) p.set('fm', '1'); else p.delete('fm');
  const q = p.toString();
  history.replaceState(null, '', q ? '?' + q : location.pathname);
}
document.getElementById('btn-fm').addEventListener('click', () => {
  setFm(!Module._gb_get_fm());
});
document.getElementById('btn-mute').addEventListener('click', (e) => {
  muted = !muted;
  e.target.textContent = muted ? '🔇' : '🔊';
});
// ---------------------------------------------------------------- debug panel
const dbgCpu = document.getElementById('dbg-cpu');
const dbgApu = document.getElementById('dbg-apu');
const dbgMem = document.getElementById('dbg-mem');
const dbgAddr = document.getElementById('dbg-addr');

function toggleDebug() {
  document.body.classList.toggle('debug-on');
  updateDebug();
}
document.getElementById('btn-debug').addEventListener('click', toggleDebug);
dbgAddr.addEventListener('keydown', (e) => e.stopPropagation());
dbgAddr.addEventListener('keyup', (e) => e.stopPropagation());
for (const el of document.querySelectorAll('.dbg-jump')) {
  el.addEventListener('click', () => { dbgAddr.value = el.dataset.addr; updateDebug(); });
}

const hex2 = (v) => v.toString(16).toUpperCase().padStart(2, '0');
const hex4 = (v) => v.toString(16).toUpperCase().padStart(4, '0');

const APU_NAMES = [
  'NR10', 'NR11', 'NR12', 'NR13', 'NR14', '----', 'NR21', 'NR22', 'NR23', 'NR24',
  'NR30', 'NR31', 'NR32', 'NR33', 'NR34', '----', 'NR41', 'NR42', 'NR43', 'NR44',
  'NR50', 'NR51', 'NR52',
];

function updateDebug() {
  if (!Module || !document.body.classList.contains('debug-on')) return;
  // CPU
  const r = Module._gb_cpu_regs();
  const m = Module.HEAPU8.subarray(r, r + 20);
  const pc = m[0] | (m[1] << 8), sp = m[2] | (m[3] << 8);
  const f = m[5];
  const flags = ((f & 0x80) ? 'Z' : '-') + ((f & 0x40) ? 'N' : '-') +
                ((f & 0x20) ? 'H' : '-') + ((f & 0x10) ? 'C' : '-');
  const frameCount = m[16] | (m[17] << 8) | (m[18] << 16) | (m[19] << 24);
  dbgCpu.textContent =
    `PC=${hex4(pc)}  SP=${hex4(sp)}\n` +
    `A=${hex2(m[4])}  F=${flags}\n` +
    `BC=${hex2(m[6])}${hex2(m[7])}  DE=${hex2(m[8])}${hex2(m[9])}  HL=${hex2(m[10])}${hex2(m[11])}\n` +
    `IME=${m[12]} HALT=${m[13]} SPEED=${m[14] ? '2x' : '1x'} ${m[15] ? 'CGB' : 'DMG'}\n` +
    `FRAME=${frameCount >>> 0}`;
  // APU (FF10-FF26 + wave RAM)
  const a = Module._gb_apu_regs();
  const ar = Module.HEAPU8.subarray(a, a + 0x30);
  let apuText = '';
  for (let i = 0; i <= 0x16; i++) {
    apuText += `${APU_NAMES[i]} FF${hex2(0x10 + i)}=${hex2(ar[i])}` + ((i % 2 === 0) ? '  ' : '\n');
  }
  apuText += '\nWAVE ';
  for (let i = 0x20; i < 0x30; i++) apuText += hex2(ar[i]);
  dbgApu.textContent = apuText;
  // memory dump: 16 lines x 16 bytes
  let base = parseInt(dbgAddr.value, 16);
  if (isNaN(base)) base = 0xC000;
  base = Math.max(0, Math.min(0xFF00, base & 0xFFF0));
  let memText = '';
  for (let row = 0; row < 16; row++) {
    const addr = base + row * 16;
    memText += hex4(addr) + ':';
    let ascii = '';
    for (let i = 0; i < 16; i++) {
      const v = Module._gb_peek(addr + i);
      memText += ' ' + hex2(v);
      ascii += (v >= 0x20 && v < 0x7F) ? String.fromCharCode(v) : '.';
    }
    memText += '  ' + ascii + '\n';
  }
  dbgMem.textContent = memText;
}
setInterval(updateDebug, 250);   // keeps the panel fresh while paused too

function toggleFullscreen() {
  const app = document.getElementById('app');
  if (document.fullscreenElement) document.exitFullscreen();
  else app.requestFullscreen && app.requestFullscreen();
}
document.getElementById('btn-full').addEventListener('click', toggleFullscreen);

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

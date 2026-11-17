import { PRESETS, Timer, makeTask, formatTime } from './timer-core.mjs';
import { saveTimingRecord } from './agenda-adapter.mjs';

const $ = id => document.getElementById(id);
const fields = ['preset', 'title', 'green', 'yellow', 'red', 'sound'];
const STORAGE = 'toastmasters-timer-settings-v1';
const RECORDS = 'toastmasters-timer-records-v1';
const labels = { neutral: '未到提示时间', green: '绿色提示', yellow: '黄色提示', red: '红色提示' };
let timer = null;
let lastColor = 'neutral';
let mode = 'number';
let audioContext = null;
let wakeLock = null;
async function keepScreenAwake() {
  if (!document.body.classList.contains('presenting') || document.visibilityState !== 'visible') return;
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
}
function leaveDisplay() {
  document.body.classList.remove('presenting');
  $('exit-display').hidden = true;
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  $('fullscreen').focus();
}


function parseTime(value) {
  const match = /^(\d{1,3}):([0-5]\d)$/.exec(value.trim());
  if (!match) throw new Error('时间请填写为 分钟:秒，例如 02:30。');
  return Number(match[1]) * 60 + Number(match[2]);
}
function timeInput(seconds) { return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
function settings() { return Object.fromEntries(fields.map(id => [id, id === 'sound' ? $(id).checked : $(id).value])); }
function saveSettings() { try { localStorage.setItem(STORAGE, JSON.stringify(settings())); } catch {} }
function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE));
    if (!saved || typeof saved !== 'object') return;
    for (const id of fields) if (id in saved) {
      if (id === 'sound') $(id).checked = Boolean(saved[id]);
      else $(id).value = String(saved[id]);
    }
    if (saved.preset === 'speech' && saved.title === '国际演讲') $('title').value = '备稿演讲';
  } catch {}
}
function config() {
  const title = $('title').value.trim();
  if (!title) throw new Error('请填写标题。');
  return { title, activity: $('preset').value, agendaSource: null,
    thresholds: { green: parseTime($('green').value), yellow: parseTime($('yellow').value), red: parseTime($('red').value) } };
}
function setError(message = '') { $('error').textContent = message; }
function lockSettings(locked) { for (const id of ['preset', 'title', 'green', 'yellow', 'red']) $(id).disabled = locked; }
function playCue(color) {
  if (!$('sound').checked || color === 'neutral') return;
  try {
    audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'sine'; oscillator.frequency.value = { green: 520, yellow: 660, red: 790 }[color];
    gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, audioContext.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.25);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(); oscillator.stop(audioContext.currentTime + 0.26);
  } catch {}
}
function render() {
  const state = timer?.state ?? 'idle';
  const color = timer?.color ?? 'neutral';
  if (color !== lastColor) { playCue(color); lastColor = color; }
  $('display').className = `display ${color}${mode === 'color' ? ' pure' : ''}`;
  $('digits').textContent = formatTime(timer?.seconds ?? 0);
  $('display-title').textContent = timer?.task.title ?? $('title').value.trim() ?? '';
  $('color-label').textContent = labels[color];
  $('status').textContent = { idle: '准备就绪', running: '正在计时', paused: '已暂停', finished: '本轮已结束' }[state];
  $('display-state').textContent = { idle: '准备开始', running: labels[color], paused: '已暂停', finished: '计时结束' }[state];
  $('start').disabled = state !== 'idle';
  $('pause').disabled = !['running', 'paused'].includes(state);
  $('pause').textContent = state === 'paused' ? '继续' : '暂停';
  $('finish').disabled = !['running', 'paused'].includes(state);
}
function records() { try { return JSON.parse(localStorage.getItem(RECORDS)) || []; } catch { return []; } }
function renderRecords() {
  const list = $('records-list'); list.replaceChildren();
  const items = records();
  if (!items.length) { list.textContent = '暂无记录'; return; }
  for (const task of items.slice(0, 10)) {
    const row = document.createElement('div'); row.className = 'record';
    const info = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = task.title;
    const date = document.createElement('small'); date.textContent = new Date(task.startedAt).toLocaleString('zh-CN');
    const result = document.createElement('span'); result.textContent = formatTime((task.result?.elapsedMs ?? 0) / 1000);
    info.append(title, date); row.append(info, result); list.append(row);
  }
}
$('preset').addEventListener('change', () => {
  const preset = PRESETS[$('preset').value];
  if (preset) {
    $('title').value = preset.title;
    for (const key of ['green', 'yellow', 'red']) $(key).value = timeInput(preset[key]);
  }
  setError(); saveSettings(); render();
});
for (const id of fields) $(id).addEventListener('input', () => { saveSettings(); setError(); if (id === 'title') render(); });
$('start').addEventListener('click', () => {
  try { timer = new Timer(makeTask(config())); timer.start(); lockSettings(true); saveSettings(); setError(); render(); }
  catch (error) { setError(error.message); }
});
$('pause').addEventListener('click', () => { if (timer?.state === 'running') timer.pause(); else timer?.resume(); render(); });
$('finish').addEventListener('click', async () => {
  const task = timer?.finish(); if (!task) return;
  try { localStorage.setItem(RECORDS, JSON.stringify([task, ...records()].slice(0, 100))); }
  catch { setError('本地存储已满，无法保存记录。请先导出已有记录。'); }
  try { await saveTimingRecord(task); } catch { /* A future adapter can report sync failure here. */ }
  render(); renderRecords();
});
$('reset').addEventListener('click', () => { timer = null; lastColor = 'neutral'; lockSettings(false); setError(); render(); });
function setMode(next) {
  mode = next;
  for (const [id, value] of [['number-mode', 'number'], ['color-mode', 'color']]) {
    $(id).classList.toggle('selected', next === value); $(id).setAttribute('aria-pressed', String(next === value));
  }
  render();
}
$('number-mode').addEventListener('click', () => setMode('number'));
$('color-mode').addEventListener('click', () => setMode('color'));
$('fullscreen').addEventListener('click', () => {
  document.body.classList.add('presenting');
  $('exit-display').hidden = false;
  $('exit-display').focus();
  // CSS fills the viewport even on phones without the Fullscreen API.
  const request = $('timer-panel').requestFullscreen;
  if (request) request.call($('timer-panel')).catch(() => {});
  keepScreenAwake();
});
$('exit-display').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  leaveDisplay();
});
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) leaveDisplay();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && document.body.classList.contains('presenting')) leaveDisplay();
});
document.addEventListener('visibilitychange', keepScreenAwake);
$('export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(records(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = 'speech-timing-records.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
loadSettings(); renderRecords(); render();
setInterval(render, 100);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});

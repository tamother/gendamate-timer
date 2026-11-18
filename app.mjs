import { PRESETS, MULTI_SCENES, nextSpeakerName, Timer, makeTask, formatTime, thresholdsForDuration, presentationState } from './timer-core.mjs?v=20';
import { timingStatus, editRecord, normalizeStatusOverride, reportTimingWindow, activityName, groupRecords, reportText, reportCsv, standardTime } from './report.mjs?v=20';
import { parseAgendaImport, upgradeAgendaPlans, saveTimingRecord } from './agenda-adapter.mjs?v=20';

const $ = id => document.getElementById(id);
const fields = ['preset', 'title', 'green', 'yellow', 'red', 'sound', 'topics-minutes', 'topics-seconds', 'session-scene'];
const STORAGE = 'toastmasters-timer-settings-v1';
const RECORDS = 'toastmasters-timer-records-v1';
const labels = { neutral: '未到提示时间', green: '绿色提示', yellow: '黄色提示', red: '红色提示' };
const DATA = 'toastmasters-meetings-v1';
function localDate() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`; }
function newMeeting(name = '头马例会') { return { id: crypto.randomUUID(), name, date: localDate(), records: [] }; }
function loadData() {
  try { const saved = JSON.parse(localStorage.getItem(DATA)); if (saved?.meetings?.length && saved.meetings.every(m => Array.isArray(m.records))) { for (const meeting of saved.meetings) if (Array.isArray(meeting.plannedTasks)) meeting.plannedTasks = upgradeAgendaPlans(meeting.plannedTasks,meeting.records); return saved; } } catch {}
  const meeting = newMeeting();
  try {
    const old = JSON.parse(localStorage.getItem(RECORDS));
    if (Array.isArray(old) && old.length) {
      meeting.name = '历史记录（待整理）';
      meeting.records = old.filter(t => t.result && t.thresholds).reverse().map(t => ({ ...t, meetingId: meeting.id, speaker: t.speaker || '', activityLabel: t.activityLabel || PRESETS[t.activity]?.title || '自定义环节' }));
    }
  } catch {}
  return { activeId: meeting.id, meetings: [meeting] };
}
let data = loadData();
function currentMeeting() { return data.meetings.find(m => m.id === data.activeId) || data.meetings[0]; }
function persist(next) { localStorage.setItem(DATA, JSON.stringify(next)); data = next; }
function changeData(change) { const next = structuredClone(data); change(next); persist(next); }
function storeTask(task) { changeData(next => { const meeting = next.meetings.find(m => m.id === task.meetingId); if (!meeting) throw new Error('会议不存在'); if (!meeting.records.some(t => t.id === task.id)) meeting.records.push(task); }); }
let segmentTimer = null;
let segmentCount = 0;
let completedSegment = null;
let activePlan = null;
let importPreview = null;
let agendaPopup = null;
let importNonce = null;
let editId = null;
let timer = null;
let awaitingNext = false;
let lastSavedNote = "";
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
  if (!match) throw new Error('请检查分、秒输入：分钟为 0–999，秒数为 0–59。');
  return Number(match[1]) * 60 + Number(match[2]);
}
function timeInput(seconds) { return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
function setDuration(id, seconds) {
  const value = Math.max(0, Math.min(59999, Math.round(seconds)));
  $(id).value = timeInput(value);
  $(`${id}-minutes`).value = String(Math.floor(value / 60)).padStart(2, '0');
  $(`${id}-seconds`).value = String(value % 60).padStart(2, '0');
}
function readParts(prefix) {
  const minutes = $(`${prefix}-minutes`).value;
  const seconds = $(`${prefix}-seconds`).value;
  if (!/^\d+$/.test(minutes) || !/^\d+$/.test(seconds) || Number(minutes) > 999 || Number(seconds) > 59) throw new Error('分钟请填 0–999，秒数请填 0–59。');
  return Number(minutes) * 60 + Number(seconds);
}
function showCustomDuration() {
  const session = $('preset').value === 'tableTopicsSession';
  $('custom-duration').hidden = $('preset').value !== 'custom';
  $('topics-duration').hidden = !session;
  document.querySelector('.thresholds').hidden = false;
  $('threshold-title').textContent = session ? '每人提示牌时间' : '提示牌时间';
  document.querySelector('.duration-help').hidden = false;
  $('segments').hidden = !session;
  $('topics-budget').hidden = !session;

  const total = parseTime($('red').value || '07:00');
  $('total-minutes').value = Math.floor(total / 60);
  $('total-seconds').value = total % 60;
  $('auto-rule').textContent = '超过3分钟且不超过10分钟：剩余2分钟绿牌、剩余1分钟黄牌、时间到红牌。';
}
function applyCustomDuration() {
  try {
    const seconds = readParts('total');
    if (seconds <= 0) throw new Error('总时长需要大于 0 秒。');
    if (seconds > 180 && seconds <= 600) {
      const thresholds = thresholdsForDuration(seconds);
      for (const key of ['green','yellow','red']) setDuration(key, thresholds[key]);
      $('auto-rule').textContent = `已自动填写：绿牌 ${timeInput(thresholds.green)} · 黄牌 ${timeInput(thresholds.yellow)} · 红牌 ${timeInput(thresholds.red)}。`;
    } else {
      $('auto-rule').textContent = '当前总时长不在自动范围内，请手动调整下方三张牌；红牌时间作为最终总时长。';
    }
    setError(); saveSettings();
  } catch (error) { setError(error.message); }
}
for (const id of ['green','yellow','red']) {
  for (const part of ['minutes','seconds']) {
    const field = $(`${id}-${part}`);
    field.addEventListener('input', () => {
      try {
        $(id).value = timeInput(readParts(id));
        if ($('preset').value === 'tableTopicsSession') $('session-scene').value = 'manual';
        if ($('preset').value === 'custom') $('auto-rule').textContent = '已手动调整提示时间。修改总时长可重新自动计算。';
        setError(); saveSettings();
      } catch(error) { $(id).value = ''; setError(error.message); }
    });
    field.addEventListener('change', () => { try { setDuration(id, readParts(id)); } catch {} });
  }
}
for (const button of document.querySelectorAll('[data-duration]')) button.addEventListener('click', () => {
  const id = button.dataset.duration;
  try { setDuration(id, readParts(id) + Number(button.dataset.step)); if ($('preset').value === 'tableTopicsSession') $('session-scene').value = 'manual'; if ($('preset').value === 'custom') $('auto-rule').textContent = '已手动调整提示时间。修改总时长可重新自动计算。'; setError(); saveSettings(); } catch(error) { setError(error.message); }
});
for (const id of ['total-minutes','total-seconds']) $(id).addEventListener('input', applyCustomDuration);
$('session-scene').addEventListener('change', () => {
  const scene = MULTI_SCENES[$('session-scene').value];
  if (scene) { for (const key of ['green','yellow','red']) setDuration(key,scene[key]); $('title').value = scene.title; }
  setError(); saveSettings(); render();
});
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
  if ($('preset').value === 'custom' && readParts('total') <= 0) throw new Error('请填写大于 0 秒的总时长。');
  const title = $('title').value.trim();
  if (!title) throw new Error('请填写标题。');
  const session = $('preset').value === 'tableTopicsSession';
  const targetSeconds = session ? readParts('topics') : null;
  if (session && targetSeconds <= 0) throw new Error('请填写大于 0 秒的即兴总时长。');
  return { targetSeconds, lightsEnabled: !session, title, activityLabel: title, speaker: $('speaker').value.trim() || nextSpeakerName(records()), meetingId: currentMeeting().id, activity: $('preset').value, agendaSource: activePlan?.agendaSource || null, plannedId: activePlan?.id || null, estimatedMinutes: activePlan?.estimatedMinutes ?? null,
    thresholds: { green: parseTime($('green').value), yellow: parseTime($('yellow').value), red: parseTime($('red').value) } };
}
function setError(message = '') { $('error').textContent = message; }
function lockSettings(locked) { for (const id of ['preset', 'title', 'green', 'yellow', 'red','total-minutes','total-seconds','topics-minutes','topics-seconds','session-scene']) $(id).disabled = locked; document.querySelectorAll('.duration-control input,.duration-control button').forEach(field => { field.disabled = locked; }); }
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
  const session = (timer?.task.activity || $('preset').value) === 'tableTopicsSession';
  const view = presentationState(timer, segmentTimer, completedSegment);
  const { shown, color } = view;
  $('segments').hidden = !session;
  $('topics-budget').hidden = !session;
  $('speaker-label').textContent = session ? '环节主持人' : '发言人姓名';
  $('start').textContent = awaitingNext ? (session ? '开始下一环节' : '开始下一位') : session ? '开始多人发言' : '开始本轮计时';
  const busyNow = ['running','paused'].includes(state);
  $('quick-types').hidden = state !== 'idle';
  $('live-speaker-label').hidden = session;
  $('quick-heading').textContent = busyNow ? '当前发言人' : awaitingNext ? '等待下一位' : '快速开始';
  $('quick-note').textContent = busyNow ? '可随时补填姓名，不影响计时。' : lastSavedNote || '选择类型后即可开始，无需先填写姓名。';
  document.querySelectorAll('[data-quick]').forEach(button => {
    const scene = button.dataset.quick;
    const selected = MULTI_SCENES[scene] ? session && $('session-scene').value === scene : !session && $('preset').value === scene;
    button.setAttribute('aria-pressed',String(selected));
  });
  $('next').hidden = !(currentMeeting().plannedTasks || []).length;
  $('add-segment').textContent = segmentTimer ? '保存并开始下一位' : segmentCount ? '开始下一位' : '开始第一位';
  $('next').textContent = session ? '下一环节' : '下一位';
  if (session) {
    let remaining = view.remaining;
    if (remaining === null) { try { remaining = readParts('topics'); } catch { remaining = 0; } }
    $('topics-budget').classList.toggle('overdue', !!timer && remaining <= 0);
    $('topics-remaining').textContent = `${remaining < 0 ? '+' : ''}${formatTime(Math.ceil(Math.abs(remaining)))}`;
    $('topics-budget-note').textContent = remaining <= 0 ? '环节已到时 · 提示牌仍跟随当前分段' : state === 'paused' ? '已暂停 · 总计时与分段同步暂停' : '环节到点仅此栏标红，不影响分段提示牌';
  }

  if (color !== lastColor) { playCue(color); lastColor = color; }
  $('display').className = `display ${color}${mode === 'color' ? ' pure' : ''}`;
  $('digits').textContent = session && !segmentTimer ? '— : —' : formatTime(view.seconds ?? 0);
  $('display-title').textContent = shown ? `${shown.task.speaker} · ${shown.task.activityLabel}` : $('title').value.trim();
  $('color-label').textContent = session && !segmentTimer ? '等待发言 · 不展示提示牌' : labels[color];
  $('status').textContent = awaitingNext && state === 'idle' ? '等待下一位 · 串场不计时' : { idle: '准备就绪', running: '正在计时', paused: '已暂停', finished: '本轮已结束' }[state];
  $('display-state').textContent = awaitingNext && state === 'idle' ? '上一轮已保存 · 等待开始' : session && !segmentTimer ? (state === 'finished' ? '本环节已结束' : '新增分段，为下一位发言人计时') : { idle: '准备开始', running: labels[color], paused: '已暂停', finished: '计时结束' }[state];
  $('start').disabled = state !== 'idle';
  $('pause').disabled = !['running', 'paused'].includes(state);
  $('pause').textContent = state === 'paused' ? '继续' : '暂停';
  $('finish').disabled = !['running', 'paused'].includes(state);
  $('next').disabled = state !== 'finished';
  const busy = ['running', 'paused'].includes(state);
  for (const id of ['meeting-select', 'meeting-name', 'meeting-date', 'new-meeting', 'import-agenda']) $(id).disabled = busy;
  document.querySelectorAll('.queue-load').forEach(button => { button.disabled = busy; });
  $('add-segment').disabled = !session || state !== 'running';
  $('end-segment').disabled = !session || !segmentTimer || !['running', 'paused'].includes(state);
  $('total-time').textContent = `本轮累计 ${formatTime(timer?.seconds ?? 0)}`;
  $('segment-hint').textContent = segmentTimer ? `第 ${segmentCount} 段 · ${segmentTimer.task.speaker}。新增分段会保存当前段并开始下一段。` : segmentCount ? `已记录 ${segmentCount} 个分段。可继续新增，总计时仍在累计。` : '开始本轮计时后，可逐位新增分段。总用时持续累计。';

}
function records() { return currentMeeting().records; }
function renderMeetings() {
  const select = $('meeting-select'); select.replaceChildren();
  for (const meeting of data.meetings) { const option = document.createElement('option'); option.value = meeting.id; option.textContent = `${meeting.date} · ${meeting.name}`; select.append(option); }
  select.value = currentMeeting().id;
  $('meeting-name').value = currentMeeting().name;
  $('meeting-date').value = currentMeeting().date;
}
function renderRecords() {
  renderQueue();
  const list = $('records-list'); list.replaceChildren();
  const items = records();
  $('report-summary').textContent = `${currentMeeting().date} · ${currentMeeting().name} · ${items.filter(t=>!['tableTopicsSession','sessionTotal'].includes(t.activity)).length} 次个人发言，${items.filter(t=>['tableTopicsSession','sessionTotal'].includes(t.activity)).length} 条环节总用时记录。按意犹未尽、从容收官、精彩加时排列；以红牌为目标，前后5%为从容收官（整秒，宽限最少1秒、最多10秒）。`;
  if (!items.length) { list.textContent = '本场还没有记录，结束计时后会自动加入。'; return; }
  for (const [name, tasks] of groupRecords(items)) {
    const heading = document.createElement('h3'); heading.textContent = name; list.append(heading);
    for (const task of tasks) {
      const row = document.createElement('div'); row.className = 'record report-row';
      const info = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = task.speaker || '待补姓名';
      const range = document.createElement('small'); range.textContent = task.lightsEnabled === false ? standardTime(task) : `标准 ${standardTime(task)}`;
      const result = document.createElement('div'); const status = timingStatus(task);
      const time = document.createElement('strong'); time.className = `result-time ${status.color}`; time.textContent = formatTime(task.result.elapsedMs / 1000);
      const description = document.createElement('small'); description.className = `status-description ${status.state}`; description.textContent = status.text;
      result.append(time, description); info.append(title, range);
      const actions = document.createElement('div'); actions.className = 'record-actions';
      const edit = document.createElement('button'); edit.textContent = '修正'; edit.addEventListener('click', () => { editId = task.id; $('edit-speaker').value = task.speaker || ''; $('edit-activity').value = activityName(task); const override = normalizeStatusOverride(task.statusOverride); $('status-auto').checked = override === 'auto'; document.querySelectorAll('[name="record-status"]').forEach(input => { input.checked = input.value === timingStatus(task).state; }); const window = reportTimingWindow(task); $('status-rule').textContent = `目标 ${formatTime(window.target)} · 从容收官 ${formatTime(window.lower)}–${formatTime(window.upper)}。以红牌为目标，前后5%取整秒，宽限最少1秒、最多10秒。`; $('edit-error').textContent = ''; $('edit-record').showModal(); });
      const remove = document.createElement('button'); remove.textContent = '删除'; remove.addEventListener('click', () => { if (!confirm(`删除 ${task.speaker || '待补姓名'} 的这条记录？`)) return; try { changeData(next => { const meeting = next.meetings.find(m => m.id === data.activeId); meeting.records = meeting.records.filter(t => t.id !== task.id); }); renderRecords(); } catch { $('report-message').textContent = '删除未保存，请检查浏览器存储。'; } });
      actions.append(edit, remove); row.append(info, result, actions); list.append(row);
    }
  }
}
function resetPerson() { awaitingNext = false; lastSavedNote = ''; activePlan = null; segmentTimer = null; completedSegment = null; segmentCount = 0; timer = null; lastColor = 'neutral'; lockSettings(false); setError(); render(); }
$('next').addEventListener('click', () => { resetPerson(); $('live-speaker').value = ''; const next = (currentMeeting().plannedTasks || []).find(t => !isPlanDone(t)); if (next) loadPlan(next); else { $('speaker').value = ''; $('live-speaker').value = ''; render(); } });
$('meeting-select').addEventListener('change', () => { try { changeData(next => { next.activeId = $('meeting-select').value; }); resetPerson(); renderMeetings(); renderRecords(); render(); } catch { setError('切换会议未保存。'); } });
$('new-meeting').addEventListener('click', () => { try { const meeting = newMeeting(); changeData(next => { next.meetings.push(meeting); next.activeId = meeting.id; }); resetPerson(); renderMeetings(); renderRecords(); render(); $('meeting-name').focus(); } catch { setError('无法保存新会议，请检查浏览器存储。'); } });
for (const id of ['meeting-name','meeting-date']) $(id).addEventListener('change', () => { try { if (!$('meeting-name').value.trim() || !$('meeting-date').value) throw new Error(); changeData(next => { const m = next.meetings.find(m => m.id === data.activeId); m.name = $('meeting-name').value.trim(); m.date = $('meeting-date').value; }); renderMeetings(); renderRecords(); } catch { setError('会议名称和日期不能为空，且需要可用的本地存储。'); } });
document.querySelectorAll('[name="record-status"]').forEach(input => ['click','change'].forEach(event => input.addEventListener(event, () => { $('status-auto').checked = false; })));
$('status-auto').addEventListener('change', () => {
  if (!$('status-auto').checked) return;
  const task = records().find(task => task.id === editId);
  if (task) document.querySelectorAll('[name="record-status"]').forEach(input => { input.checked = input.value === timingStatus({...task,statusOverride:'auto'}).state; });
});
$('cancel-edit').addEventListener('click', () => $('edit-record').close());
$('edit-form').addEventListener('submit', event => { event.preventDefault(); try { const speaker = $('edit-speaker').value.trim(); const activity = $('edit-activity').value.trim(); if (!speaker || !activity) throw new Error(); changeData(next => { const task = next.meetings.find(m => m.id === data.activeId).records.find(t => t.id === editId); if (!task) throw new Error(); const statusOverride = $('status-auto').checked ? 'auto' : document.querySelector('[name="record-status"]:checked')?.value; Object.assign(task,editRecord(task,{speaker,activityLabel:activity,statusOverride})); }); $('edit-record').close(); renderRecords(); } catch { $('edit-error').textContent = '请填写姓名、环节并选择状态，同时确认本地存储可用。'; } });
function saveSegment() {
  if (!segmentTimer) return true;
  const task = segmentTimer.finish();
  if (!task) return false;
  try { storeTask(task); completedSegment = segmentTimer; segmentTimer = null; renderRecords(); return true; }
  catch { segmentTimer.state = 'paused'; setError('分段保存失败，请检查存储后重试。'); return false; }
}
$('add-segment').addEventListener('click', () => {
  if (timer?.state !== 'running' || timer.task.activity !== 'tableTopicsSession') return;
  if (segmentTimer && !saveSegment()) { timer.pause(); render(); return; }
  segmentCount += 1;
  const task = makeTask({ ...timer.task, plannedId: null, title: timer.task.title, activity: 'tableTopics', targetSeconds:timer.task.thresholds.red, lightsEnabled:true,
    activityLabel: `${timer.task.activityLabel} · 分段`,
    speaker: $('segment-name').value.trim() || nextSpeakerName(records()),
    thresholds: timer.task.thresholds });
  task.parentTaskId = timer.task.id; task.segmentIndex = segmentCount;
  segmentTimer = new Timer(task); segmentTimer.start(); completedSegment = null;
  $('segment-name').value = ''; lastColor = 'neutral'; setError(); render();
});
$('end-segment').addEventListener('click', () => { if (!saveSegment()) timer.pause(); render(); });

function isPlanDone(plan) { return records().some(task => task.plannedId === plan.id); }
function loadPlan(plan) {
  if (['running','paused'].includes(timer?.state)) return;
  resetPerson(); activePlan = plan;
  $('live-speaker').value = plan.speaker;
  $('preset').value = plan.activity; $('title').value = plan.activityLabel; $('speaker').value = plan.speaker;
  for (const key of ['green','yellow','red']) setDuration(key, plan.thresholds[key]);
  if (plan.activity === 'tableTopicsSession') { $('session-scene').value = plan.scene || 'manual'; const seconds = (plan.estimatedMinutes || 20) * 60; $('topics-minutes').value = Math.floor(seconds/60); $('topics-seconds').value = Math.round(seconds%60); }
  showCustomDuration();
  setError(plan.warning || ''); saveSettings(); render();
  $('start').scrollIntoView({ block: 'center', behavior: 'smooth' });
}
function renderQueue() {
  const plans = currentMeeting().plannedTasks || [];
  $('agenda-queue').hidden = !plans.length;
  $('queue-count').textContent = `${plans.filter(isPlanDone).length} / ${plans.length} 已完成`;
  const list = $('queue-list'); list.replaceChildren();
  for (const plan of plans) {
    const row = document.createElement('div'); row.className = 'queue-row';
    const info = document.createElement('div'); const title = document.createElement('strong'); title.textContent = plan.activityLabel;
    const meta = document.createElement('small'); meta.textContent = `${plan.speaker || '姓名待补'} · 原定 ${plan.estimatedMinutes ?? '待补'} 分钟 · ${plan.activity === 'tableTopicsSession' ? `多人发言 · ${MULTI_SCENES[plan.scene]?.title || '每人时间可设置'}` : PRESETS[plan.activity]?.title + '预设'}${plan.warning ? ' · 请调整时长' : ''}`;
    info.append(title, meta);
    const button = document.createElement('button'); button.className = 'queue-load'; button.textContent = isPlanDone(plan) ? '已完成 · 再次载入' : '载入计时'; button.addEventListener('click',()=>loadPlan(plan));
    row.append(info, button); list.append(row);
  }
}
function showImportPreview(raw) {
  try {
    importPreview = parseAgendaImport(raw);
    $('import-status').textContent = `${importPreview.name} · ${importPreview.date || '日期待补'} · ${importPreview.tasks.length} 个环节。优先识别即兴演讲、嘉宾介绍和真情分享为多人发言；其余环节按时长匹配。原定时长将保留。`;
    const list = $('import-preview'); list.replaceChildren();
    for (const task of importPreview.tasks) { const line = document.createElement('p'); line.textContent = `${task.activityLabel} · ${task.speaker || '姓名待补'} · ${task.estimatedMinutes ?? '待补'} 分钟 → ${task.activity === 'tableTopicsSession' ? `多人发言 · ${MULTI_SCENES[task.scene]?.title || '每人时间可设置'}` : PRESETS[task.activity].title}${task.warning ? '（需调整）' : ''}`; list.append(line); }
    $('confirm-import').disabled = false;
  } catch(error) { importPreview = null; $('confirm-import').disabled = true; $('import-status').textContent = error.message; }
}
$('import-agenda').addEventListener('click', () => { $('import-dialog').showModal(); });
$('close-import').addEventListener('click', () => $('import-dialog').close());
$('open-agenda').addEventListener('click', () => {
  importNonce = crypto.randomUUID();
  agendaPopup = window.open(`https://a.gendamate.cn/timer-import.html#${encodeURIComponent(importNonce)}`, 'agendamate-timer-import', 'popup,width=620,height=760');
  $('import-status').textContent = agendaPopup ? '请在 AgendaMate 窗口选择议程。确认发送后会在这里预览。' : '浏览器阻止了新窗口，请允许弹出窗口后重试。';
});
window.addEventListener('message', event => {
  if (event.origin !== 'https://a.gendamate.cn' || event.source !== agendaPopup || !importNonce) return;
  if (event.data?.type !== 'agendamate:timer-agenda' || event.data.nonce !== importNonce) return;
  showImportPreview(event.data.payload); importNonce = null;
  $('import-dialog').showModal();
});
$('agenda-file').addEventListener('change', async event => { const file = event.target.files[0]; if (!file) return; if (file.size > 2_000_000) { $('import-status').textContent = '文件请小于 2 MB。'; return; } try { showImportPreview(await file.text()); } catch { $('import-status').textContent = '文件读取失败。'; } });
$('confirm-import').addEventListener('click', () => {
  if (!importPreview || ['running','paused'].includes(timer?.state)) return;
  try {
    let selectedId;
    changeData(next => {
      let meeting = next.meetings.find(m => m.agendaSourceId === importPreview.sourceId);
      if (!meeting) { meeting = newMeeting(importPreview.name); meeting.date = importPreview.date || localDate(); meeting.agendaSourceId = importPreview.sourceId; meeting.plannedTasks = []; next.meetings.push(meeting); }
      const existing = new Set(meeting.plannedTasks.map(t => t.id));
      for (const task of importPreview.tasks) {
        if (!existing.has(task.id)) meeting.plannedTasks.push(task);
        else if (!meeting.records.some(record => record.plannedId === task.id)) {
          const index = meeting.plannedTasks.findIndex(plan => plan.id === task.id);
          meeting.plannedTasks[index] = task;
        }
      }
      selectedId = meeting.id; next.activeId = selectedId;
    });
    resetPerson(); renderMeetings(); renderRecords(); render(); $('agenda-queue').open = true; $('import-dialog').close();
    const next = currentMeeting().plannedTasks.find(t => !isPlanDone(t)); if (next) loadPlan(next);
  } catch { $('import-status').textContent = '导入未保存，请检查本地存储后重试。'; }
});
$('preset').addEventListener('change', () => {
  const preset = PRESETS[$('preset').value];
  if ($('preset').value === 'tableTopicsSession') { $('session-scene').value = 'topics'; $('title').value = '即兴演讲'; for (const key of ['green','yellow','red']) setDuration(key, PRESETS.tableTopics[key]); }
  if (preset) {
    $('title').value = preset.title;
    for (const key of ['green', 'yellow', 'red']) setDuration(key, preset[key]);
  }
  showCustomDuration();
  if (!preset && $('preset').value === 'custom') { if (Object.values(PRESETS).some(p => p.title === $('title').value)) $('title').value = '自定义环节'; applyCustomDuration(); }
  setError(); saveSettings(); render();
});
for (const id of fields) $(id).addEventListener('input', () => { saveSettings(); setError(); if (id === 'title') render(); });
$('start').addEventListener('click', () => {
  try { const task = makeTask(config()); $('speaker').value = task.speaker; $('live-speaker').value = task.speaker; awaitingNext = false; lastSavedNote = ''; if (!currentMeeting().startedAt) changeData(next => { next.meetings.find(m => m.id === data.activeId).startedAt = new Date().toISOString(); }); timer = new Timer(task); timer.start(); lockSettings(true); saveSettings(); setError(); render(); }
  catch (error) { setError(error.message); }
});
for (const id of ['speaker','live-speaker']) $(id).addEventListener('input', () => {
  const value = $(id).value;
  $(id === 'speaker' ? 'live-speaker' : 'speaker').value = value;
  if (timer && ['running','paused'].includes(timer.state)) timer.task.speaker = value.trim() || nextSpeakerName(records());
  render();
});
for (const button of document.querySelectorAll('[data-quick]')) button.addEventListener('click', () => {
  if (['running','paused'].includes(timer?.state)) return;
  const type = button.dataset.quick;
  $('preset').value = MULTI_SCENES[type] ? 'tableTopicsSession' : type;
  $('preset').dispatchEvent(new Event('change'));
  if (MULTI_SCENES[type]) { $('session-scene').value = type; $('session-scene').dispatchEvent(new Event('change')); }
});
$('pause').addEventListener('click', () => { if (timer?.state === 'running') { timer.pause(); segmentTimer?.pause(); } else { timer?.resume(); segmentTimer?.resume(); } render(); });
$('finish').addEventListener('click', async () => {
  if (segmentTimer && !saveSegment()) { timer.pause(); render(); return; }
  const task = timer?.finish(); if (!task) return;
  if (segmentCount && task.activity !== 'tableTopicsSession') { task.activity = 'sessionTotal'; task.activityLabel += ' · 总用时'; task.segmentCount = segmentCount; }
  try { storeTask(task); }
  catch { timer.state = 'paused'; setError('保存失败，请导出已有记录并检查存储，再重试结束保存。'); render(); return; }
  if (!(currentMeeting().plannedTasks || []).length) {
    resetPerson(); $('speaker').value = ''; $('live-speaker').value = '';
    awaitingNext = true; lastSavedNote = `${task.speaker} · ${formatTime(task.result.elapsedMs/1000)} 已保存。串场不计时，下一位开口时再开始。`;
  }
  render(); renderRecords();
  try { await saveTimingRecord(task); } catch { /* A future adapter can report sync failure here. */ }
});
$('reset').addEventListener('click', () => { if (timer && timer.state !== 'finished' && !confirm('重置会丢弃当前未保存的计时，已保存的分段仍保留。')) return; resetPerson(); });
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
function download(content, type, extension) {
  const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement('a');
  link.href = url; link.download = `计时报告-${currentMeeting().date}.${extension}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('copy-report').addEventListener('click', async () => { const text = reportText(currentMeeting(), records()); try { await navigator.clipboard.writeText(text); $('report-message').textContent = '报告已复制，可粘贴到微信群。'; } catch { $('copy-fallback').hidden = false; $('copy-fallback').value = text; $('copy-fallback').focus(); $('copy-fallback').select(); $('report-message').textContent = '请长按或选择下面的文字复制。'; } });
$('csv-report').addEventListener('click', () => download(reportCsv(currentMeeting(), records()), 'text/csv;charset=utf-8', 'csv'));
$('html-report').addEventListener('click', () => {
  try {
    const id = crypto.randomUUID();
    localStorage.setItem('timer-report-preview', JSON.stringify({ id, meeting: currentMeeting(), records: records() }));
    const url = `./report.html?id=${encodeURIComponent(id)}`;
    if (!window.open(url, '_blank')) {
      $('report-message').textContent = '请点击打开报告：';
      const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.textContent = '打开报告'; $('report-message').append(link);
    }
  } catch { $('report-message').textContent = '无法生成预览，请检查浏览器存储后重试。'; }
});
loadSettings();
for (const key of ['green','yellow','red']) { try { setDuration(key, parseTime($(key).value)); } catch { setDuration(key, PRESETS.speech[key]); } }
showCustomDuration(); renderMeetings(); renderRecords(); render();
setInterval(render, 100);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {});

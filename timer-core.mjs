export const PRESETS = Object.freeze({
  speech: { title: '备稿演讲', green: 300, yellow: 360, red: 420 },
  evaluation: { title: '点评', green: 120, yellow: 150, red: 180 },
  tableTopics: { title: '即兴演讲', green: 60, yellow: 90, red: 120 },
});

export const MULTI_SCENES = Object.freeze({
  topics: { title:'即兴演讲', green:60, yellow:90, red:120 },
  guests: { title:'嘉宾介绍', green:20, yellow:25, red:30 },
  sharing: { title:'真情分享', green:40, yellow:50, red:60 },
});

export function validateThresholds({ green, yellow, red }) {
  const values = [green, yellow, red].map(Number);
  if (values.some(value => !Number.isFinite(value) || value <= 0) ||
      !(values[0] < values[1] && values[1] < values[2])) {
    throw new Error('阈值必须是递增的正数：绿 < 黄 < 红。');
  }
  return { green: values[0], yellow: values[1], red: values[2] };
}

export function thresholdsForDuration(seconds) {
  if (!Number.isInteger(seconds) || seconds <= 180 || seconds > 600) {
    throw new Error('自动规则适用于超过 3 分钟且不超过 10 分钟的总时长。');
  }
  return { green: seconds - 120, yellow: seconds - 60, red: seconds };
}

export function colorAt(seconds, thresholds) {
  if (seconds >= thresholds.red) return 'red';
  if (seconds >= thresholds.yellow) return 'yellow';
  if (seconds >= thresholds.green) return 'green';
  return 'neutral';
}

export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function presentationState(timer, segmentTimer = null, completedSegment = null) {
  const session = timer?.task.activity === 'tableTopicsSession';
  const shown = session ? segmentTimer : segmentTimer || completedSegment || timer;
  return {
    shown,
    color: shown?.color || 'neutral',
    seconds: shown ? shown.seconds : (session ? null : 0),
    remaining: session ? (timer.task.targetSeconds ?? 1200) - timer.seconds : null,
  };
}

export function makeTask(config, id = crypto.randomUUID()) {
  const thresholds = validateThresholds(config.thresholds);
  return {
    schemaVersion: 1, id, title: config.title.trim(), activity: config.activity,
    speaker: config.speaker ?? '', meetingId: config.meetingId ?? null,
    activityLabel: config.activityLabel ?? config.title.trim(),
    plannedId: config.plannedId ?? null, estimatedMinutes: config.estimatedMinutes ?? null,
    targetSeconds: config.targetSeconds ?? null, lightsEnabled: config.lightsEnabled !== false,
    agendaSource: config.agendaSource ?? null,
    thresholds, startedAt: null, endedAt: null,
    result: null,
  };
}

export class Timer {
  constructor(task, now = () => performance.now(), wallNow = () => new Date().toISOString()) {
    this.task = task;
    this.now = now;
    this.wallNow = wallNow;
    this.elapsedMs = 0;
    this.runningSince = null;
    this.state = 'idle';
  }
  get seconds() {
    return (this.elapsedMs + (this.state === 'running' ? Math.max(0, this.now() - this.runningSince) : 0)) / 1000;
  }
  get color() { return this.task.lightsEnabled === false ? 'neutral' : colorAt(this.seconds, this.task.thresholds); }
  start() {
    if (this.state !== 'idle') return;
    this.task.startedAt = this.wallNow();
    this.runningSince = this.now();
    this.state = 'running';
  }
  pause() {
    if (this.state !== 'running') return;
    this.elapsedMs += Math.max(0, this.now() - this.runningSince);
    this.runningSince = null;
    this.state = 'paused';
  }
  resume() {
    if (this.state !== 'paused') return;
    this.runningSince = this.now();
    this.state = 'running';
  }
  finish() {
    if (this.state === 'idle' || this.state === 'finished') return null;
    if (this.state === 'running') this.pause();
    this.task.endedAt = this.wallNow();
    this.task.result = { elapsedMs: Math.round(this.elapsedMs), finalColor: this.color };
    this.state = 'finished';
    return structuredClone(this.task);
  }
  reset() {
    this.elapsedMs = 0;
    this.runningSince = null;
    this.state = 'idle';
    this.task.startedAt = null;
    this.task.endedAt = null;
    this.task.result = null;
  }
}

export function nextSpeakerName(records = []) {
  const people = records.filter(task => !['tableTopicsSession','sessionTotal'].includes(task.activity));
  const largest = Math.max(0, ...people.map(task => Number(/^发言人\s+(\d+)$/.exec(task.speaker || '')?.[1] || 0)));
  return `发言人 ${String(Math.max(people.length,largest)+1).padStart(2,'0')}`;
}

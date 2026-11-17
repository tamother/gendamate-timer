export const PRESETS = Object.freeze({
  speech: { title: '备稿演讲', green: 300, yellow: 360, red: 420 },
  evaluation: { title: '点评', green: 120, yellow: 150, red: 180 },
  tableTopics: { title: '即兴演讲', green: 60, yellow: 90, red: 120 },
});

export function validateThresholds({ green, yellow, red }) {
  const values = [green, yellow, red].map(Number);
  if (values.some(value => !Number.isFinite(value) || value <= 0) ||
      !(values[0] < values[1] && values[1] < values[2])) {
    throw new Error('阈值必须是递增的正数：绿 < 黄 < 红。');
  }
  return { green: values[0], yellow: values[1], red: values[2] };
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

export function makeTask(config, id = crypto.randomUUID()) {
  const thresholds = validateThresholds(config.thresholds);
  return {
    schemaVersion: 1, id, title: config.title.trim(), activity: config.activity,
    speaker: config.speaker ?? '', meetingId: config.meetingId ?? null,
    activityLabel: config.activityLabel ?? config.title.trim(),
    plannedId: config.plannedId ?? null, estimatedMinutes: config.estimatedMinutes ?? null,
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
  get color() { return colorAt(this.seconds, this.task.thresholds); }
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

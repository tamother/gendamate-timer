import { PRESETS } from './timer-core.mjs?v=7';

export function presetForMinutes(minutes) {
  if (Number.isFinite(minutes) && minutes > 0 && minutes <= 2) return 'tableTopics';
  if (Number.isFinite(minutes) && minutes > 2 && minutes <= 3) return 'evaluation';
  return 'speech';
}

export function parseAgendaImport(input) {
  const envelope = typeof input === 'string' ? JSON.parse(input) : input;
  if (!envelope || typeof envelope !== 'object') throw new Error('没有找到议程数据。');
  const meeting = envelope.meeting || envelope.agenda?.meeting || envelope;
  const rows = Array.isArray(meeting.agenda) ? meeting.agenda : null;
  if (!rows?.length || rows.length > 300) throw new Error('议程应包含 1–300 个环节。');
  const clubId = String(envelope.clubId || 'local');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(meeting.mDate) ? meeting.mDate : '';
  const sourceId = String(envelope.meetingId || `${clubId}:${date}:${meeting.mNo || ''}`);
  const occurrences = new Map();
  const tasks = rows.map((row, index) => {
    if (!row || typeof row !== 'object') throw new Error(`第 ${index + 1} 个环节格式不正确。`);
    const title = String(row.i ?? row.title ?? '').trim().slice(0, 160) || `环节 ${index + 1}`;
    const value = row.d ?? row.durationMinutes;
    const minutes = typeof value === 'number' || (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim())) ? Number(value) : NaN;
    const valid = Number.isFinite(minutes) && minutes > 0 && minutes <= 1440;
    const activity = presetForMinutes(valid ? minutes : null);
    const preset = PRESETS[activity];
    const speaker = String(row.n ?? row.speaker ?? '').trim().slice(0, 100);
    const signature = JSON.stringify([title, speaker, valid ? minutes : null]);
    const occurrence = (occurrences.get(signature) || 0) + 1;
    occurrences.set(signature, occurrence);
    const itemId = String(row.id ?? `${signature}:${occurrence}`);
    return { id: `${sourceId}:${itemId}`, title, activityLabel: title,
      speaker, activity,
      estimatedMinutes: valid ? minutes : null,
      thresholds: { green: preset.green, yellow: preset.yellow, red: preset.red },
      agendaSource: { provider: 'agendamate', clubId, meetingId: sourceId, itemId },
      warning: valid ? '' : '原定时长待补，暂选备稿预设，请调整。' };
  });
  return { name: [envelope.clubName, meeting.mNo, meeting.theme].filter(Boolean).map(String).join(' · ').slice(0, 160) || 'AgendaMate 例会', date, sourceId, tasks };
}

export function taskConfigFromAgendaItem(item) {
  return {
    title: item.title,
    activity: item.activity ?? 'custom', speaker: item.speaker || '', activityLabel: item.title,
    agendaSource: item.agendaSource || { provider: 'agendamate', meetingId: item.meetingId, itemId: item.id },
    thresholds: item.thresholds,
  };
}

export async function loadAgendaTasks(_meetingId) {
  return []; // Replace with AgendaMate read adapter when its API is available.
}

export async function saveTimingRecord(_task) {
  // Replace with AgendaMate write adapter when its API is available.
}

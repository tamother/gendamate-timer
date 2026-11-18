import { sceneForAgendaTitle } from './agenda-adapter.mjs?v=18';
import { MULTI_SCENES, formatTime, PRESETS } from './timer-core.mjs?v=18';

export const STATUS_OPTIONS = Object.freeze({ short:'意犹未尽', onTime:'从容收官', overTime:'精彩加时' });
const STATUS_COLORS = Object.freeze({ short:'yellow', onTime:'green', overTime:'red' });
export function normalizeStatusOverride(value) {
  if (Object.hasOwn(STATUS_OPTIONS,value)) return value;
  const legacy = {neutral:'short',green:'onTime',yellow:'onTime',red:'overTime'};
  return Object.hasOwn(legacy,value) ? legacy[value] : 'auto';
}
export function reportTimingWindow(task) {
  const session = task.lightsEnabled === false || ['tableTopicsSession','sessionTotal'].includes(task.activity);
  const target = session && Number(task.targetSeconds) > 0 ? Number(task.targetSeconds) : Number(task.thresholds.red);
  const tolerance = Math.min(10, Math.max(1, Math.round(target*0.05)));
  return { target, tolerance, lower:Math.max(0,target-tolerance), upper:target+tolerance };
}
export function editRecord(task, { speaker, activityLabel, statusOverride = 'auto' }) {
  if (!speaker?.trim() || !activityLabel?.trim() || (statusOverride !== 'auto' && !Object.hasOwn(STATUS_OPTIONS,statusOverride))) throw new Error('请填写姓名、环节并选择有效的用时状态。');
  return { ...task, speaker:speaker.trim(), activityLabel:activityLabel.trim(), statusOverride };
}
export function timingStatus(task) {
  const seconds = (task.result?.elapsedMs ?? 0) / 1000;
  const { lower, upper } = reportTimingWindow(task);
  const override = normalizeStatusOverride(task.statusOverride);
  const state = override !== 'auto' ? override : seconds < lower ? 'short' : seconds > upper ? 'overTime' : 'onTime';
  return { state, color:STATUS_COLORS[state], text:STATUS_OPTIONS[state] + (override === 'auto' ? '' : '（手动调整）') };
}
export function standardTime(task) {
  const { target, tolerance } = reportTimingWindow(task);
  return `${task.lightsEnabled === false ? '总时长 ' : ''}${formatTime(target)} ± ${formatTime(tolerance)}`;
}
export function activityName(task) { return task.activityLabel || PRESETS[task.activity]?.title || '自定义环节'; }
export function groupRecords(records) {
  const groups = new Map();
  const byId = new Map(records.map(task => [task.id,task]));
  for (const task of records) {
    const parent = byId.get(task.parentTaskId);
    const label = activityName(parent || task).replace(/\s*·\s*(分段|总用时)$/, '');
    const scene = sceneForAgendaTitle(label);
    const key = scene ? MULTI_SCENES[scene].title : label;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(task);
  }
  const rank = task => ['tableTopicsSession','sessionTotal'].includes(task.activity) ? 4 : ({short:0,onTime:1,overTime:2}[timingStatus(task).state] ?? 0);
  for (const [key,tasks] of groups) groups.set(key,[...tasks].sort((a,b) => rank(a)-rank(b)));
  return groups;
}
export function reportText(meeting, records) {
  const lines = [`${meeting.name} · 计时员报告`, meeting.date, ''];
  for (const [name, tasks] of groupRecords(records)) {
    lines.push(`【${name}】`);
    for (const task of tasks) lines.push(`${task.speaker || '待补姓名'}：${formatTime(task.result.elapsedMs / 1000)}，${timingStatus(task).text}（标准 ${standardTime(task)}）`);
    lines.push('');
  }
  lines.push(`共 ${records.filter(t => !['tableTopicsSession','sessionTotal'].includes(t.activity)).length} 次个人发言，${records.filter(t => ['tableTopicsSession','sessionTotal'].includes(t.activity)).length} 条总用时记录。以红牌时间为目标，前后5%为从容收官（整秒，宽限最少1秒、最多10秒）；状态可由计时员修正。`);
  return lines.join('\n');
}
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function reportCsv(meeting, records) {
  const rows = [['会议', '日期', '姓名', '环节', '标准用时', '实际用时', '时间状态', '绿灯秒', '黄灯秒', '红灯秒', '实际毫秒', '开始时间', '结束时间', '任务ID']];
  for (const tasks of groupRecords(records).values()) for (const task of tasks) rows.push([meeting.name, meeting.date, task.speaker || '待补姓名', activityName(task), `${standardTime(task)}`, formatTime(task.result.elapsedMs / 1000), timingStatus(task).text, task.thresholds.green, task.thresholds.yellow, task.thresholds.red, task.result.elapsedMs, task.startedAt, task.endedAt, task.id]);
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}
const escape = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
export function reportHtml(meeting, records) {
  let body = `<h1>${escape(meeting.name)} · 计时员报告</h1><p>${escape(meeting.date)} · 共 ${records.filter(t => !['tableTopicsSession','sessionTotal'].includes(t.activity)).length} 次个人发言，${records.filter(t => ['tableTopicsSession','sessionTotal'].includes(t.activity)).length} 条总用时记录</p>`;
  for (const [name, tasks] of groupRecords(records)) {
    body += `<h2>${escape(name)}</h2><table><thead><tr><th>姓名</th><th>标准用时</th><th>实际用时</th><th>时间状态</th></tr></thead><tbody>`;
    for (const task of tasks) {
      const status = timingStatus(task);
      body += `<tr><td>${escape(task.speaker || '待补姓名')}</td><td>${standardTime(task)}</td><td class="${status.color}">${formatTime(task.result.elapsedMs / 1000)}</td><td>${escape(status.text)}</td></tr>`;
    }
    body += '</tbody></table>';
  }
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>计时员报告</title><style>body{font-family:system-ui,sans-serif;margin:24px;line-height:1.6;color:#182635}table{border-collapse:collapse;width:100%;margin-bottom:24px}th,td{text-align:left;padding:10px;border-bottom:1px solid #ddd}.neutral{color:#596579}.green{color:#08733d}.yellow{color:#a65d13}.red{color:#c12531}td:nth-child(3){font-weight:bold;font-size:20px;font-variant-numeric:tabular-nums}@media(max-width:500px){body{margin:12px}td,th{padding:6px;font-size:13px}}@media print{tr{break-inside:avoid}}</style><body>${body}<p>以红牌时间为目标，前后5%为从容收官（整秒，宽限最少1秒、最多10秒）；状态可由计时员修正。CSV 为纯文本，彩色样式请使用本报告。</p></body></html>`;
}

export function reportCanvasData(meeting, records) {
  const rows = [];
  for (const [activity, tasks] of groupRecords(records)) {
    rows.push({ heading: activity });
    for (const task of tasks) rows.push({ name: task.speaker || '待补姓名', time: formatTime(task.result.elapsedMs / 1000), range: `${standardTime(task)}`, ...timingStatus(task) });
  }
  const startedAt = meeting.startedAt || records.map(t => t.startedAt).filter(Boolean).sort()[0];
  const endedAt = records.map(t => t.endedAt).filter(Boolean).sort().at(-1);
  const clock = iso => iso ? new Date(iso).toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit' }) : '—';
  return { name: meeting.name, date: meeting.date, span: `${clock(startedAt)} — ${clock(endedAt)}`, rows };
}

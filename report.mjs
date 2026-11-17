import { formatTime, PRESETS } from './timer-core.mjs?v=6';

export function timingStatus(task) {
  const seconds = (task.result?.elapsedMs ?? 0) / 1000;
  const { green, yellow, red } = task.thresholds;
  if (seconds < green) return { color: 'neutral', text: `意犹未尽 · 距绿灯 ${formatTime(Math.ceil(green - seconds))}` };
  if (seconds < yellow) return { color: 'green', text: '从容收官 · 绿灯区' };
  if (seconds < red) return { color: 'yellow', text: '踩准节奏 · 黄灯区' };
  return { color: 'red', text: seconds === red ? '红灯亮啦 · 刚好到点' : `精彩加时 · 超过红灯 ${formatTime(seconds - red)}` };
}
export function activityName(task) { return task.activityLabel || PRESETS[task.activity]?.title || '自定义环节'; }
export function groupRecords(records) {
  const groups = new Map();
  for (const task of records) {
    const key = activityName(task);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(task);
  }
  return groups;
}
export function reportText(meeting, records) {
  const lines = [`${meeting.name} · 计时员报告`, meeting.date, ''];
  for (const [name, tasks] of groupRecords(records)) {
    lines.push(`【${name}】`);
    for (const task of tasks) lines.push(`${task.speaker || '待补姓名'}：${formatTime(task.result.elapsedMs / 1000)}，${timingStatus(task).text}（标准 ${formatTime(task.thresholds.green)}–${formatTime(task.thresholds.red)}）`);
    lines.push('');
  }
  lines.push(`共 ${records.filter(t => !['tableTopicsSession','sessionTotal'].includes(t.activity)).length} 次个人发言，${records.filter(t => ['tableTopicsSession','sessionTotal'].includes(t.activity)).length} 条总用时记录。状态仅描述提示灯时间，不判定比赛资格。`);
  return lines.join('\n');
}
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function reportCsv(meeting, records) {
  const rows = [['会议', '日期', '姓名', '环节', '标准用时', '实际用时', '时间状态', '绿灯秒', '黄灯秒', '红灯秒', '实际毫秒', '开始时间', '结束时间', '任务ID']];
  for (const task of records) rows.push([meeting.name, meeting.date, task.speaker || '待补姓名', activityName(task), `${formatTime(task.thresholds.green)}–${formatTime(task.thresholds.red)}`, formatTime(task.result.elapsedMs / 1000), timingStatus(task).text, task.thresholds.green, task.thresholds.yellow, task.thresholds.red, task.result.elapsedMs, task.startedAt, task.endedAt, task.id]);
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}
const escape = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
export function reportHtml(meeting, records) {
  let body = `<h1>${escape(meeting.name)} · 计时员报告</h1><p>${escape(meeting.date)} · 共 ${records.filter(t => !['tableTopicsSession','sessionTotal'].includes(t.activity)).length} 次个人发言，${records.filter(t => ['tableTopicsSession','sessionTotal'].includes(t.activity)).length} 条总用时记录</p>`;
  for (const [name, tasks] of groupRecords(records)) {
    body += `<h2>${escape(name)}</h2><table><thead><tr><th>姓名</th><th>标准用时</th><th>实际用时</th><th>时间状态</th></tr></thead><tbody>`;
    for (const task of tasks) {
      const status = timingStatus(task);
      body += `<tr><td>${escape(task.speaker || '待补姓名')}</td><td>${formatTime(task.thresholds.green)}–${formatTime(task.thresholds.red)}</td><td class="${status.color}">${formatTime(task.result.elapsedMs / 1000)}</td><td>${escape(status.text)}</td></tr>`;
    }
    body += '</tbody></table>';
  }
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>计时员报告</title><style>body{font-family:system-ui,sans-serif;margin:24px;line-height:1.6;color:#182635}table{border-collapse:collapse;width:100%;margin-bottom:24px}th,td{text-align:left;padding:10px;border-bottom:1px solid #ddd}.neutral{color:#596579}.green{color:#08733d}.yellow{color:#926500}.red{color:#c12531}td:nth-child(3){font-weight:bold;font-size:20px;font-variant-numeric:tabular-nums}@media(max-width:500px){body{margin:12px}td,th{padding:6px;font-size:13px}}@media print{tr{break-inside:avoid}}</style><body>${body}<p>状态仅描述提示灯时间，不判定比赛资格。CSV 为纯文本，彩色样式请使用本报告。</p></body></html>`;
}

export function reportCanvasData(meeting, records) {
  const rows = [];
  for (const [activity, tasks] of groupRecords(records)) {
    rows.push({ heading: activity });
    for (const task of tasks) rows.push({ name: task.speaker || '待补姓名', time: formatTime(task.result.elapsedMs / 1000), range: `${formatTime(task.thresholds.green)}–${formatTime(task.thresholds.red)}`, ...timingStatus(task) });
  }
  const startedAt = meeting.startedAt || records.map(t => t.startedAt).filter(Boolean).sort()[0];
  const endedAt = records.map(t => t.endedAt).filter(Boolean).sort().at(-1);
  const clock = iso => iso ? new Date(iso).toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit' }) : '—';
  return { name: meeting.name, date: meeting.date, span: `${clock(startedAt)} — ${clock(endedAt)}`, rows };
}

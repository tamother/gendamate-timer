import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, Timer, makeTask, colorAt, formatTime, validateThresholds } from './timer-core.mjs';

test('预设阈值和颜色切换', () => {
  assert.deepEqual([PRESETS.speech.green, PRESETS.speech.yellow, PRESETS.speech.red], [300, 360, 420]);
  assert.equal(PRESETS.speech.title, '备稿演讲');
  assert.deepEqual([PRESETS.evaluation.green, PRESETS.evaluation.yellow, PRESETS.evaluation.red], [120, 150, 180]);
  assert.deepEqual([PRESETS.tableTopics.green, PRESETS.tableTopics.yellow, PRESETS.tableTopics.red], [60, 90, 120]);
  assert.deepEqual([299, 300, 360, 420].map(s => colorAt(s, PRESETS.speech)), ['neutral', 'green', 'yellow', 'red']);
  assert.equal(formatTime(421.9), '07:01');
});

test('暂停、继续、结束使用单调时间且保留记录', () => {
  let now = 0; let wall = '2026-11-17T00:00:00.000Z';
  const task = makeTask({ title: ' 测试演讲 ', activity: 'speech', thresholds: PRESETS.speech, agendaSource: null }, 'task-1');
  const timer = new Timer(task, () => now, () => wall);
  timer.start(); now = 300500; assert.equal(timer.color, 'green');
  timer.pause(); now = 900000; assert.equal(timer.seconds, 300.5);
  timer.resume(); now = 959500; assert.equal(timer.color, 'yellow');
  wall = '2026-11-17T00:10:00.000Z';
  const saved = timer.finish();
  assert.equal(saved.result.elapsedMs, 360000);
  assert.equal(saved.result.finalColor, 'yellow');
  assert.equal(saved.title, '测试演讲');
  assert.equal(saved.startedAt, '2026-11-17T00:00:00.000Z');
  assert.equal(saved.endedAt, wall);
  timer.reset(); assert.equal(timer.seconds, 0); assert.equal(timer.state, 'idle');
});

test('自定义阈值必须递增', () => {
  assert.deepEqual(validateThresholds({ green: 10, yellow: 20, red: 30 }), { green: 10, yellow: 20, red: 30 });
  assert.throws(() => validateThresholds({ green: 30, yellow: 20, red: 10 }));
  assert.throws(() => validateThresholds({ green: 0, yellow: 20, red: 30 }));
});

import { timingStatus, reportText, reportCsv, reportHtml } from './report.mjs';
test('报告边界、转义及同一人多次记录', () => {
  const task = { id:'1', speaker:'<张三>', title:'不展示题目', activity:'speech', thresholds:PRESETS.speech, result:{elapsedMs:300000} };
  assert.equal(timingStatus(task).color, 'green');
  assert.equal(timingStatus({...task,result:{elapsedMs:360000}}).color, 'yellow');
  assert.equal(timingStatus({...task,result:{elapsedMs:420000}}).text, '红灯亮啦 · 刚好到点');
  assert.match(timingStatus({...task,result:{elapsedMs:421000}}).text, /00:01/);
  const meeting = { name:'测试会议',date:'2026-11-17' };
  assert.equal(reportText(meeting,[task,task]).split('<张三>').length,3);
  assert.ok(!reportText(meeting,[task]).includes('不展示题目'));
  assert.match(reportHtml(meeting,[task]), /&lt;张三&gt;/);
  assert.match(reportCsv(meeting,[{...task,speaker:'=SUM(A1)'}]), /'=SUM/);
});
test('即兴整场与个人计时相互独立', () => {
  let now = 0;
  const make = id => new Timer(makeTask({title:'即兴',activity:'tableTopics',meetingId:'meeting-1',speaker:id,thresholds:PRESETS.tableTopics},id),()=>now);
  const whole = make('whole'); const person = make('person');
  whole.start(); now = 10000; person.start(); now = 70000;
  const saved = person.finish(); assert.equal(saved.result.elapsedMs,60000);
  person.reset(); now = 80000; assert.equal(whole.seconds,80);
  whole.pause(); now = 90000; assert.equal(whole.seconds,80);
  assert.equal(saved.meetingId,'meeting-1'); assert.equal(saved.speaker,'person');
});

import { reportCanvasData } from './report.mjs';
test('长图数据保留全部记录，会议起止自动来自首轮和最后记录', () => {
  const tasks = Array.from({length:40},(_,i)=>({id:String(i),speaker:`发言人${i}`,activity:'tableTopics',title:'不展示题目',thresholds:PRESETS.tableTopics,startedAt:'2026-11-17T10:00:00.000Z',endedAt:'2026-11-17T12:00:00.000Z',result:{elapsedMs:90000}}));
  const result=reportCanvasData({name:'本场例会',date:'2026-11-17'},tasks);
  assert.equal(result.rows.filter(r=>!r.heading).length,40);
  assert.equal(result.rows.at(-1).name,'发言人39');
  assert.equal(result.rows.at(-1).color,'yellow');
  assert.ok(!JSON.stringify(result).includes('不展示题目'));
  assert.ok(!result.span.includes('— —'));
});

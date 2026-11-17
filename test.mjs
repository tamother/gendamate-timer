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

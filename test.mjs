import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, Timer, makeTask, colorAt, formatTime, validateThresholds } from './timer-core.mjs';
import { thresholdsForDuration, presentationState } from './timer-core.mjs';

test('自定义总时长按剩余2分钟、1分钟和到点计算，并验证范围', () => {
  assert.deepEqual(thresholdsForDuration(480), {green:360,yellow:420,red:480});
  assert.deepEqual(thresholdsForDuration(510), {green:390,yellow:450,red:510});
  assert.deepEqual(thresholdsForDuration(181), {green:61,yellow:121,red:181});
  assert.deepEqual(thresholdsForDuration(600), {green:480,yellow:540,red:600});
  for (const value of [0,180,601,NaN,480.5]) assert.throws(() => thresholdsForDuration(value));
});

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
test('报告三类边界、转义及同一人多次记录', () => {
  const task = { id:'1', speaker:'<张三>', title:'不展示题目', activity:'speech', thresholds:PRESETS.speech, result:{elapsedMs:300000} };
  assert.equal(timingStatus(task).state,'short');
  for (const ms of [410000,420000,430000]) assert.equal(timingStatus({...task,result:{elapsedMs:ms}}).state,'onTime');
  assert.equal(timingStatus({...task,result:{elapsedMs:409999}}).state,'short');
  assert.equal(timingStatus({...task,result:{elapsedMs:430001}}).state,'overTime');
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

import { parseAgendaImport, presetForMinutes } from './agenda-adapter.mjs';
test('AgendaMate 真实字段导入全部环节，按原定时长匹配预设', () => {
  const imported=parseAgendaImport({clubId:'club-1',clubName:'PRO',meeting:{mDate:'2026-11-17',mNo:'第793期',theme:'例会',agenda:[{id:'a',i:'Call to Order',n:'Linda',d:'2'},{id:'b',i:'Individual Evaluation',n:'Nora',d:3},{id:'c',i:'Prepared Speech',n:'Smile',d:7},{id:'d',i:'Table Topics Session',n:'Jae',d:20},{id:'e',i:'Closing Remarks',n:'President',d:2}]}});
  assert.equal(imported.tasks.length,5);
  assert.deepEqual(imported.tasks.map(t=>t.activity),['tableTopics','evaluation','speech','tableTopicsSession','tableTopics']);
  assert.equal(imported.tasks[3].estimatedMinutes,20);
  assert.equal(imported.tasks[0].speaker,'Linda');
  assert.equal(imported.tasks[0].agendaSource.clubId,'club-1');
  assert.equal(imported.tasks[0].agendaSource.itemId,'a');
  assert.equal(imported.date,'2026-11-17');
  assert.deepEqual([1,2,2.5,3,3.1,7].map(presetForMinutes),['tableTopics','tableTopics','evaluation','evaluation','speech','speech']);
});
test('缺失字段不猜测，重复导入的来源标识稳定', () => {
  const input={meeting:{agenda:[{i:'未知时长',d:'随意',n:''}]}};
  const a=parseAgendaImport(input), b=parseAgendaImport(JSON.stringify(input));
  assert.equal(a.tasks[0].estimatedMinutes,null);
  assert.ok(a.tasks[0].warning);
  assert.equal(a.tasks[0].id,b.tasks[0].id);
  assert.throws(()=>parseAgendaImport({meeting:{agenda:[]}}));
  assert.throws(()=>parseAgendaImport('not json'));
});

test('即兴环节总时长不变牌，仅当前2分钟分段变牌', () => {
  let now=0;
  const total=new Timer(makeTask({title:'即兴环节',activity:'tableTopicsSession',targetSeconds:1200,lightsEnabled:false,thresholds:PRESETS.tableTopics},'session'),()=>now);
  const part=new Timer(makeTask({title:'分段',activity:'tableTopics',thresholds:PRESETS.tableTopics},'part'),()=>now);
  total.start();now=1100000;
  assert.equal(total.color,'neutral');
  assert.equal(presentationState(total).color,'neutral');
  assert.equal(presentationState(total).seconds,null);
  assert.equal(presentationState(total).remaining,100);
  part.start();now+=60000;assert.equal(presentationState(total,part).color,'green');
  now+=30000;assert.equal(presentationState(total,part).color,'yellow');
  now+=30000;assert.equal(presentationState(total,part).color,'red');
  part.finish();assert.equal(presentationState(total,null,part).color,'neutral');
  assert.equal(presentationState(total,null,part).remaining,-20);
  total.pause();now+=10000;assert.equal(presentationState(total).remaining,-20);
  assert.equal(timingStatus(total.finish()).state,'overTime');
});

test('总时长已超出时，嘉宾分段仍按自定义阈值独立变牌', () => {
  let now=0;
  const thresholds={green:20,yellow:25,red:30};
  const session=new Timer(makeTask({title:'嘉宾介绍',activity:'tableTopicsSession',targetSeconds:1,lightsEnabled:false,thresholds},'guest-session'),()=>now);
  const person=new Timer(makeTask({title:'嘉宾介绍 · 分段',activity:'tableTopics',thresholds},'guest'),()=>now);
  session.start();person.start();now=20000;
  assert.ok(presentationState(session,person).remaining<0);
  assert.equal(presentationState(session,person).color,'green');
  now=25000;assert.equal(presentationState(session,person).color,'yellow');
  now=30000;assert.equal(presentationState(session,person).color,'red');
  person.finish();assert.equal(presentationState(session,null,person).color,'neutral');
});

import { sceneForAgendaTitle, upgradeAgendaPlans } from './agenda-adapter.mjs';
test('三类多人环节优先按中英文名称匹配，保留总时长和主持人', () => {
  const names=[['即兴演讲','topics',20,[60,90,120]],['Table Topics Session','topics',15,[60,90,120]],['宾客介绍','guests',5,[20,25,30]],['嘉宾介绍','guests',3,[20,25,30]],['Guest Introduction','guests',5,[20,25,30]],['真情时刻','sharing',5,[40,50,60]],['真情分享','sharing',7,[40,50,60]],['Moment of Truth','sharing',4,[40,50,60]],['宾客介绍 / Guest Introduction','guests',4,[20,25,30]]];
  for(const [title,scene,duration,thresholds] of names){
    const [plan]=parseAgendaImport({meeting:{agenda:[{i:title,n:'主持人',d:duration}]}}).tasks;
    assert.equal(plan.activity,'tableTopicsSession',title);
    assert.equal(plan.scene,scene,title);
    assert.deepEqual(Object.values(plan.thresholds),thresholds,title);
    assert.equal(plan.estimatedMinutes,duration);
    assert.equal(plan.speaker,'主持人');
  }
});
test('点评和其他普通环节不误匹配为多人发言', () => {
  for(const title of ['即兴演讲点评','TT Evaluation','Guest Introduction Evaluation','时间官规则介绍','分享收获','Prepared Speech']){
    assert.equal(sceneForAgendaTitle(title),null,title);
    const [plan]=parseAgendaImport({meeting:{agenda:[{i:title,d:3}]}}).tasks;
    assert.equal(plan.activity,'evaluation',title);
  }
});
test('旧议程只更新未完成的导入条目，保留标识顺序与已调好的每人时间', () => {
  const source={provider:'agendamate'};
  const plans=[
    {id:'done',title:'宾客介绍',activity:'speech',thresholds:PRESETS.speech,agendaSource:source},
    {id:'pending',title:'真情时刻',activity:'speech',thresholds:PRESETS.speech,estimatedMinutes:5,agendaSource:source},
    {id:'manual',title:'嘉宾介绍',activity:'speech',thresholds:PRESETS.speech},
    {id:'tuned',title:'即兴演讲',activity:'tableTopicsSession',scene:'topics',thresholds:{green:30,yellow:45,red:60},agendaSource:source}
  ];
  const result=upgradeAgendaPlans(plans,[{plannedId:'done'}]);
  assert.deepEqual(result.map(p=>p.id),plans.map(p=>p.id));
  assert.equal(result[0],plans[0]);
  assert.equal(result[1].scene,'sharing');
  assert.deepEqual(result[1].thresholds,{green:40,yellow:50,red:60});
  assert.equal(result[1].estimatedMinutes,5);
  assert.equal(result[2],plans[2]);
  assert.equal(result[3],plans[3]);
  assert.deepEqual(upgradeAgendaPlans(result,[{plannedId:'done'}]),result);
  assert.equal(plans[1].activity,'speech');
});

import * as core from './timer-core.mjs';
import * as report from './report.mjs';
test('未填写姓名也可使用不重复的临时编号，忽略环节总用时', () => {
  assert.equal(core.nextSpeakerName([]),'发言人 01');
  assert.equal(core.nextSpeakerName([{speaker:'发言人 03',activity:'speech'},{speaker:'主持人',activity:'tableTopicsSession'}]),'发言人 04');
});
test('三类手动状态覆盖全部报告，恢复自动后按原始用时判断', () => {
  const task={id:'edit',speaker:'发言人 01',activity:'speech',thresholds:PRESETS.speech,result:{elapsedMs:20000,finalColor:'neutral'}};
  const edited=report.editRecord(task,{speaker:'张三',activityLabel:'备稿演讲',statusOverride:'onTime'});
  assert.equal(report.timingStatus(edited).state,'onTime');
  assert.equal(report.timingStatus(edited).color,'green');
  assert.match(report.timingStatus(edited).text,/从容收官/);
  assert.deepEqual(edited.result,task.result);assert.equal(task.speaker,'发言人 01');
  const meeting={name:'本场例会',date:'2026-11-18'};
  assert.match(report.reportText(meeting,[edited]),/从容收官/);assert.match(report.reportCsv(meeting,[edited]),/从容收官/);
  assert.match(report.reportHtml(meeting,[edited]),/class="green"/);
  assert.equal(report.reportCanvasData(meeting,[edited]).rows[1].color,'green');
  const restored=report.editRecord(edited,{speaker:'张三',activityLabel:'备稿演讲',statusOverride:'auto'});
  assert.equal(report.timingStatus(restored).state,'short');
  for(const statusOverride of ['short','onTime','overTime']) assert.equal(report.timingStatus(report.editRecord(task,{speaker:'甲',activityLabel:'点评',statusOverride})).state,statusOverride);
  assert.throws(()=>report.editRecord(task,{speaker:'甲',activityLabel:'点评',statusOverride:'invalid'}));
});
test('多人环节集中归类，同状态按发言顺序展示，总用时放在组末尾', () => {
  const record=(id,speaker,activityLabel,parentTaskId=null)=>({id,speaker,activityLabel,parentTaskId,activity:parentTaskId?'tableTopics':'speech',thresholds:PRESETS.tableTopics,result:{elapsedMs:90000}});
  const parent={...record('total','主持人','Guest Introduction'),activity:'tableTopicsSession',lightsEnabled:false,targetSeconds:300,result:{elapsedMs:240000}};
  const records=[record('g1','嘉宾甲','Guest Introduction · 分段','total'),record('speech','讲者','备稿演讲'),record('g2','嘉宾乙','Guest Introduction · 分段','total'),parent,record('t','即兴甲','即兴演讲 · 分段','topics')];
  const groups=report.groupRecords(records);
  assert.deepEqual([...groups.keys()],['嘉宾介绍','备稿演讲','即兴演讲']);
  const data=report.reportCanvasData({name:'例会',date:'2026-11-18'},records);
  assert.deepEqual(data.rows.filter(r=>!r.heading).map(r=>r.name),['嘉宾甲','嘉宾乙','主持人','讲者','即兴甲']);
  assert.equal(data.rows.find(r=>r.name==='主持人').time,'04:00');
  const text=report.reportText({name:'例会',date:'2026-11-18'},records);
  assert.match(text,/嘉宾甲/);assert.ok(text.indexOf('嘉宾乙')<text.indexOf('【备稿演讲】'));
  assert.ok(!text.includes('【Guest Introduction · 分段】'));
});

test('报告每组按不足时、刚好、超时排序，保留同类顺序且不修改原始记录', () => {
  const make=(id,ms,statusOverride)=>({id,speaker:id,activity:'speech',activityLabel:'备稿演讲',thresholds:PRESETS.speech,result:{elapsedMs:ms},statusOverride});
  const records=[make('超时甲',450000),make('刚好甲',410000),make('不足讲者',300000),make('刚好乙',430000),make('手调超时',10000,'overTime')];
  const before=structuredClone(records);
  const ordered=[...report.groupRecords(records).values()][0];
  assert.deepEqual(ordered.map(t=>t.id),['不足讲者','刚好甲','刚好乙','超时甲','手调超时']);
  assert.deepEqual(records,before);
  const meeting={name:'例会',date:'2026-11-18'};
  assert.deepEqual(report.reportCanvasData(meeting,records).rows.filter(r=>!r.heading).map(r=>r.name),ordered.map(t=>t.id));
  for(const output of [report.reportText(meeting,records),report.reportCsv(meeting,records),report.reportHtml(meeting,records)]) assert.ok(output.indexOf('不足讲者')<output.indexOf('刚好甲')&&output.indexOf('刚好甲')<output.indexOf('超时甲'));
});
test('以红牌为目标，5%宽限取整且封顶10秒，环节总用时使用总目标', () => {
  const task=red=>({thresholds:{green:red/3,yellow:red/2,red},result:{elapsedMs:red*1000}});
  for(const [target,tolerance] of [[420,10],[180,9],[120,6],[60,3],[30,2],[600,10]]) {
    const window=report.reportTimingWindow(task(target));
    assert.deepEqual(window,{target,tolerance,lower:target-tolerance,upper:target+tolerance});
    assert.equal(report.timingStatus({...task(target),result:{elapsedMs:(target-tolerance)*1000}}).state,'onTime');
    assert.equal(report.timingStatus({...task(target),result:{elapsedMs:(target+tolerance)*1000}}).state,'onTime');
    assert.equal(report.timingStatus({...task(target),result:{elapsedMs:(target+tolerance)*1000+1}}).state,'overTime');
  }
  assert.equal(report.reportTimingWindow({...task(120),activity:'tableTopicsSession',lightsEnabled:false,targetSeconds:1200}).target,1200);
});
test('旧版手动灯色与新状态兼容，自动结果不再使用灰色', () => {
  assert.deepEqual(['neutral','green','yellow','red','auto'].map(report.normalizeStatusOverride),['short','onTime','onTime','overTime','auto']);
  const task={thresholds:PRESETS.speech,result:{elapsedMs:500000}};
  assert.notEqual(report.timingStatus({...task,result:{elapsedMs:1000}}).color,report.timingStatus(task).color);
  assert.equal(report.timingStatus({...task,statusOverride:'neutral'}).state,'short');
  assert.equal(report.timingStatus({...task,statusOverride:'red'}).state,'overTime');
});

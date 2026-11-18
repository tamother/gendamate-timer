import { reportCanvasData } from './report.mjs?v=22';
import { drawWebsiteQr, QR_MODULES } from './report-qr.mjs?v=22';
const id = new URL(location.href).searchParams.get('id');
let snapshot;
try { snapshot = JSON.parse(localStorage.getItem('timer-report-preview')); } catch {}
if (!snapshot || snapshot.id !== id) {
  document.querySelector('.preview').textContent = '报告预览已更新，请回计时器重新打开报告。';
  document.getElementById('download').disabled = true;
  throw new Error('Report snapshot unavailable');
}
const data = reportCanvasData(snapshot.meeting, snapshot.records);
const canvas=document.getElementById('report-image');
canvas.width=1080;canvas.height=Math.max(1500,820+data.rows.reduce((n,r)=>n+(r.heading?100:150),0));
const ctx=canvas.getContext('2d');
ctx.fillStyle='#f9fbf8';ctx.fillRect(0,0,canvas.width,canvas.height);
ctx.fillStyle='#235d46';ctx.fillRect(0,0,1080,14);
function text(value,x,y,size,color='#203c2d',weight=400,maxWidth=940){ctx.fillStyle=color;ctx.font=weight+' '+size+'px system-ui,sans-serif';ctx.fillText(value,x,y,maxWidth);}
function fit(value,max){let str=String(value);while(ctx.measureText(str).width>max&&str.length>1)str=str.slice(0,-1);return str!==String(value)?str.slice(0,-1)+'…':str;}
text('会议计时报告',70,120,32,'#658675',500);
ctx.font='700 54px system-ui,sans-serif';text(fit(data.name,940),70,210,54,'#203c2d',700);
text(data.date+'  ·  '+data.span,70,275,27,'#748477');
ctx.strokeStyle='#d9e4db';ctx.beginPath();ctx.moveTo(70,320);ctx.lineTo(1010,320);ctx.stroke();
text('发言人 / 标准用时',70,385,23,'#748477');text('实际用时',720,385,23,'#748477');
text('目标为红牌时间 · 前后5%为从容收官（整秒，宽限1–10秒）',70,414,18,'#748477');
const colors={neutral:'#718292',green:'#188447',yellow:'#b06a16',red:'#c43843'};
let y=440;
for(const row of data.rows){if(row.heading){text(row.heading,70,y+35,28,'#235d46',650);y+=100;continue;}
ctx.fillStyle='#edf3ed';ctx.fillRect(60,y-8,960,130);
ctx.font='600 34px system-ui,sans-serif';text(fit(row.name,600),85,y+35,34,'#203c2d',600,600);
text(row.range.startsWith('总时长')?row.range:'标准 '+row.range,85,y+84,23,'#748477');text(row.time,730,y+38,42,colors[row.color],700,270);
text(row.text,560,y+86,20,colors[row.color],450,430);y+=150;}
text('每一分钟，都值得被认真记录。',70,canvas.height-130,26,'#658675',500,650);
text('头马例会计时，就用 timer.gendamate.cn',70,canvas.height-78,21,'#8b988d',400,650);
const qrSize=QR_MODULES.length*6;
const qrX=canvas.width-70-qrSize;
drawWebsiteQr(ctx,qrX,canvas.height-310,6);
ctx.save();ctx.textAlign='center';text('扫码打开计时器',qrX+qrSize/2,canvas.height-42,22,'#658675',500,qrSize);ctx.restore();
document.getElementById('download').onclick=()=>canvas.toBlob(blob=>{if(!blob){document.getElementById('message').textContent='图片生成失败，请尝试浏览器截图。';return;}const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='计时报告-'+data.date+'.png';link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);},'image/png');

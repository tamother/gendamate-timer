import { reportCanvasData } from './report.mjs?v=13';
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
canvas.width=1080;canvas.height=Math.max(1500,650+data.rows.reduce((n,r)=>n+(r.heading?135:110),0));
const ctx=canvas.getContext('2d');
ctx.fillStyle='#f9fbf8';ctx.fillRect(0,0,canvas.width,canvas.height);
ctx.fillStyle='#235d46';ctx.fillRect(0,0,1080,14);
function text(value,x,y,size,color='#203c2d',weight=400,maxWidth=940){ctx.fillStyle=color;ctx.font=weight+' '+size+'px system-ui,sans-serif';ctx.fillText(value,x,y,maxWidth);}
function fit(value,max){let str=String(value);while(ctx.measureText(str).width>max&&str.length>1)str=str.slice(0,-1);return str!==String(value)?str.slice(0,-1)+'…':str;}
text('会议计时报告',70,120,32,'#658675',500);
ctx.font='700 54px system-ui,sans-serif';text(fit(data.name,940),70,210,54,'#203c2d',700);
text(data.date+'  ·  '+data.span,70,275,27,'#748477');
ctx.strokeStyle='#d9e4db';ctx.beginPath();ctx.moveTo(70,320);ctx.lineTo(1010,320);ctx.stroke();
const colors={neutral:'#718292',green:'#188447',yellow:'#a27812',red:'#c43843'};
const legend=[['neutral','未到绿灯'],['green','绿灯区'],['yellow','黄灯区'],['red','红灯区']];
for(const [i,[color,label]] of legend.entries()) { ctx.fillStyle=colors[color];ctx.beginPath();ctx.arc(83+i*235,375,9,0,Math.PI*2);ctx.fill();text(label,105+i*235,384,25,'#65786a'); }
let y=435;
for(const row of data.rows){
 if(row.heading){text(row.heading,70,y+40,36,'#235d46',700);text(row.summary,70,y+85,24,'#748477',400,940);y+=135;continue;}
 ctx.fillStyle='#edf3ed';ctx.fillRect(60,y-3,960,96);
 ctx.fillStyle=colors[row.color];ctx.fillRect(60,y-3,5,96);
 const detail=[row.showRange?'标准 '+row.range:'',row.text.includes('手动调整')?'状态已修正':''].filter(Boolean).join(' · ');
 ctx.font='600 40px system-ui,sans-serif';text(fit(row.name,590),85,y+(detail?40:58),40,'#203c2d',600,590);
 if(detail)text(detail,85,y+76,22,'#748477',400,620);
 text(row.time,750,y+58,48,colors[row.color],700,260);y+=110;
}
text('每一分钟，都值得被认真记录。',70,canvas.height-130,26,'#658675',500);
text('颜色表示用时状态；计时员可修正，供例会参考。',70,canvas.height-78,21,'#8b988d');
document.getElementById('download').onclick=()=>canvas.toBlob(blob=>{if(!blob){document.getElementById('message').textContent='图片生成失败，请尝试浏览器截图。';return;}const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='计时报告-'+data.date+'.png';link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);},'image/png');

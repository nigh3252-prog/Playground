// An original pixel-art view of the bell foundry at sundown.
(() => {
  const picture = document.getElementById('landscape');
  const c = picture.getContext('2d');
  const W = 576, H = 244;
  picture.width = W; picture.height = H;
  let seed = 7331;
  function random() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
  function rect(x,y,w,h,color) { c.fillStyle=color; c.fillRect(Math.round(x),Math.round(y),Math.ceil(w),Math.ceil(h)); }
  function poly(points, color) {
    c.fillStyle=color; c.beginPath();
    points.forEach(([x,y],i) => i ? c.lineTo(x,y) : c.moveTo(x,y)); c.closePath(); c.fill();
  }
  const sky=c.createLinearGradient(0,0,0,181);
  sky.addColorStop(0,'#304459');sky.addColorStop(.44,'#9f7472');sky.addColorStop(.82,'#f2aa83');sky.addColorStop(1,'#f7cc9e');
  rect(0,0,W,H,sky);
  for(let i=0;i<100;i++){const x=random()*W,y=random()*100;rect(x,y,random()<.08?2:1,1,'#e4d3b486');}
  for(let y=-43;y<=43;y++){
    const dx=Math.floor(Math.sqrt(43*43-y*y));rect(373-dx,64+y,2*dx,1,y>12?'#ffcca0':'#ffdfae');
  }
  for(let i=0;i<50;i++){
    const x=random()*W,y=16+random()*93;
    rect(x,y,8+random()*64,1+random()*2,y>53?'#c98d8088':'#9c838380');
  }
  function ridge(bottom,top,amp,step,color){
    const points=[[0,bottom]];
    for(let x=-step;x<=W+step;x+=step)points.push([x,top+Math.sin(x*.025)*amp+random()*amp]);
    points.push([W,bottom]);poly(points,color);
  }
  ridge(185,94,15,13,'#87767a');ridge(190,110,14,8,'#716c76');ridge(191,132,14,7,'#566474');
  for(let i=0;i<54;i++){
    const x=random()*W,y=126+random()*22,w=3+random()*7;
    rect(x,y,w,30,'#56636a');rect(x,y-1,w+1,2,'#847b78');if(i%5===0)rect(x+2,y-9,2,11,'#646971');
  }
  const water=c.createLinearGradient(0,164,0,H);water.addColorStop(0,'#839595');water.addColorStop(.28,'#51727c');water.addColorStop(1,'#263e50');rect(0,164,W,H,water);
  for(let i=0;i<360;i++){
    const x=random()*W,y=165+random()*78,ref=Math.abs(x-373)<(y-140)*.66;
    rect(x,y,2+random()*(ref?18:10),1,ref?'#efb68a99':(i%3?'#94aaac55':'#2e536873'));
  }
  function pine(x,y,h,color){rect(x-1,y-h,2,h,color);for(let i=0;i<4;i++){const t=.16+i*.17;poly([[x,y-h+h*t-4],[x-h*t*.36-2,y-h+h*(t+.36)],[x+h*t*.36+2,y-h+h*(t+.36)]],color);}}
  for(let i=0;i<72;i++){const x=random()*W;if(x<238||x>480)pine(x,165+random()*12,8+random()*23,'#394f58');}
  function tower(x,y,w,h){
    rect(x,y,w,h,'#293e48');rect(x+w-3,y,3,h,'#6c6462');rect(x-2,y-2,w+4,3,'#995e56');
    for(let row=0;row<h-4;row+=6)for(let col=0;col<w;col+=8)if(random()<.54)rect(x+col+(row%4),y+row,3,1,'#465459');
    for(let col=x+4;col<x+w-3;col+=8){rect(col,y+5,3,6,'#182d37');rect(col+1,y+7,1,4,'#e5a675');}
  }
  // A broken aqueduct, bell tower, gantry and operating furnace sit over the tide.
  for(let x=207;x<521;x+=22){rect(x,137,5,43,'#344957');rect(x+4,143,2,32,'#776d68');poly([[x,145],[x+6,154],[x+13,146],[x+22,146],[x+22,136],[x,136]],'#354854');}
  rect(205,135,305,4,'#283f4a');rect(205,134,305,1,'#cb9676');
  for(let x=206;x<509;x+=7)rect(x,130,1,5,'#4d565b');rect(206,130,305,1,'#697074');
  tower(405,109,31,27);tower(435,91,13,44);tower(461,115,31,22);tower(492,106,19,33);
  poly([[402,109],[418,95],[438,109]],'#37464e');poly([[458,115],[475,101],[495,115]],'#33414b');
  rect(432,89,19,4,'#263a46');rect(435,69,2,22,'#2b3a46');rect(446,69,2,22,'#2b3a46');
  rect(436,68,11,1,'#dda37c');poly([[430,70],[441,54],[453,70]],'#283a49');rect(441,48,1,8,'#4f5053');
  poly([[441,73],[443,74],[445,82],[447,84],[437,84],[439,81],[440,74]],'#c08661');rect(441,85,2,2,'#f0c38e');
  rect(471,85,5,20,'#2e404a');rect(470,83,7,3,'#5b5557');
  for(let i=0;i<14;i++){let x=475+i*2+Math.sin(i/2)*4,y=81-i*2;rect(x,y,3+i*.8,2+i*.3,'#8a727457');}
  const cliff=[[0,166],[55,155],[95,166],[137,164],[173,180],[192,180],[204,189],[224,190],[233,199],[201,206],[181,221],[140,222],[105,244],[0,244]];
  poly(cliff,'#223a45');for(let x=0;x<171;x+=4+Math.round(random()*6))pine(x,165+Math.max(0,x-110)*.17,20+random()*36,'#243c45');
  poly([[526,149],[545,148],[555,137],[576,132],[576,244],[499,244],[502,214],[514,209]],'#233842');
  for(let x=535;x<580;x+=4+Math.round(random()*5))pine(x,155-(x-535)*.33,20+random()*45,'#263a43');
  for(let i=0;i<22;i++){let x=493+random()*10,y=143+random()*51;rect(x,y,1,4+random()*8,'#b1cbbe77');}
  rect(374,127,2,5,'#1d3038');rect(373,125,3,2,'#ffb17e');rect(371,129,3,2,'#c36e58');rect(373,132,1,2,'#243943');rect(376,132,1,2,'#243943');
  for(let i=0;i<7;i++){let x=337+random()*25,y=40+random()*14;rect(x,y,2,1,'#796f72');rect(x+2,y+1,1,1,'#796f72');rect(x+3,y,2,1,'#796f72');}
})();

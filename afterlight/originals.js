(() => {
  'use strict';
  const TAU = 2 * Math.PI, cream = '#fff0cd', ink = '#233c41';
  const vec = {left:[-1,0], right:[1,0], up:[0,-1], down:[0,1]};
  const clamp = (v,a,b) => Math.max(a,Math.min(v,b));
  const dist = (x,y,p) => Math.hypot(x-p[0],y-p[1]);
  const add = game => registerGame({...game,kind:'Original',sources:[],best:'Either'});
  function rect(c,x,y,w,h,color){ c.fillStyle=color; c.fillRect(x,y,w,h); }
  function oval(c,x,y,rx,ry,color,angle=0){ c.beginPath();c.ellipse(x,y,rx,ry,angle,0,TAU);c.fillStyle=color;c.fill(); }
  function path(c,pts,color,width=0,close=false){
    c.beginPath();pts.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));if(close)c.closePath();
    if(width){c.lineWidth=width;c.lineCap='round';c.lineJoin='round';c.strokeStyle=color;c.stroke();}
    else{c.fillStyle=color;c.fill();}
  }
  function arc(c,x,y,r,start,end,color,width){c.beginPath();c.arc(x,y,r,start,end);c.lineWidth=width;c.lineCap='round';c.strokeStyle=color;c.stroke();}
  function type(c,s,x,y,size,color=ink,align='left'){c.font=`bold ${size}px system-ui,sans-serif`;c.textAlign=align;c.textBaseline='middle';c.fillStyle=color;c.fillText(s,x,y);}
  function pill(c,s,x,y,w,color=ink){ c.fillStyle=color;c.beginPath();c.roundRect(x,y,w,29,14);c.fill();type(c,s,x+w/2,y+14,14,cream,'center'); }
  function glint(c,x,y,size,color){path(c,[[x,y-size],[x+size*.24,y-size*.24],[x+size,y],[x+size*.24,y+size*.24],[x,y+size],[x-size*.24,y+size*.24],[x-size,y],[x-size*.24,y-size*.24]],color);}
  function moveFocus(points,i,k){
    if(!vec[k])return i;
    const [vx,vy]=vec[k], from=points[i];let best=Infinity,pick=i;
    points.forEach((p,j)=>{if(!p)return;const dx=p[0]-from[0],dy=p[1]-from[1],along=dx*vx+dy*vy,across=Math.abs(dx*vy-dy*vx);if(along<7||across>along*1.4)return;const cost=along+2*across;if(cost<best){best=cost;pick=j;}});return pick;
  }
  function mark(c,x,y,r,t){for(let i=0;i<4;i++)arc(c,x,y,r,TAU*i/4+.15,TAU*i/4+.85,'#fff3a5',3+Math.sin(t*4)*.6);}
  function icon(c,name,x,y,scale=1){
    c.save();c.translate(x,y);c.scale(scale,scale);
    if(name==='duck'){
      oval(c,-1,4,13,8,'#eaa435');oval(c,6,-5,7,7,'#ffd661');oval(c,-2,3,11,6,'#ffd661');oval(c,-4,5,6,3,'#e2a033',-.2);path(c,[[11,-6],[19,-3],[11,-2]],'#f58443');oval(c,8,-7,1.5,1.5,ink);
    }else if(name==='key'){
      arc(c,-7,0,6,0,TAU,'#e6b54f',4);path(c,[[-1,0],[14,0],[14,5]],'#b57431',4);path(c,[[8,0],[8,5]],'#e6b54f',3);
    }else if(name==='wheel'){arc(c,0,0,10,0,TAU,'#ce6747',5);for(let i=0;i<4;i++){const a=i*TAU/4;path(c,[[0,0],[9*Math.cos(a),9*Math.sin(a)]],'#f5cc7d',2);}oval(c,0,0,3,3,ink);
    }else if(name==='ring'){arc(c,0,3,8,0,TAU,'#b87525',4);path(c,[[-5,-7],[0,-13],[6,-7],[0,-2]],'#7dd9cf');
    }else if(name==='cap'){const pts=Array.from({length:24},(_,i)=>{const a=i*TAU/24,r=i%2?9:12;return [r*Math.cos(a),r*Math.sin(a)];});path(c,pts,'#ce6b57');arc(c,0,0,7,0,TAU,'#f6c58b',2);glint(c,0,0,4,cream);
    }else if(name==='kelp'){for(let i=-1;i<=1;i++)path(c,[[0,10],[i*4,-1],[i*8-2,-7],[i*8,-13]],'#569b55',4);
    }else if(name==='mussel'){oval(c,0,0,8,13,'#383e62',.7);path(c,[[-7,8],[0,2],[7,-8]],'#8998b6',2);
    }else if(name==='shrimp'){arc(c,0,-2,9,-1.2,1.9,'#ee8b75',6);path(c,[[-2,8],[-11,11],[-8,3]],'#e5806a');oval(c,5,-9,1.8,1.8,ink);path(c,[[6,-9],[13,-15],[17,-14]],'#d77b61',1.5);
    }else if(name==='shell'){oval(c,0,0,13,10,'#c19cdd',-.25);arc(c,-2,0,7,-.8,4.8,'#815e9a',2.5);arc(c,-2,0,3,0,4,'#815e9a',2);
    }else if(name==='crab'||name==='hermit'){
      for(const d of [-1,1]){for(let i=0;i<3;i++)path(c,[[d*6,1+i*2],[d*(12+i*2),i*3],[d*(15+i*2),i*3+3]],'#a84f41',2);oval(c,d*13,-5,5,4,'#e9845b',d*.55);}
      oval(c,0,1,10,7,'#ee9f68');for(const d of [-1,1]){oval(c,d*4,-5,2.6,3,cream);oval(c,d*4,-6,1.2,1.5,ink);}if(name==='hermit'){oval(c,0,4,7,5,'#ba806b');arc(c,-1,3,3,0,4,cream,1);}
    }else if(name==='octo'){
      for(let i=0;i<5;i++){const xx=(i-2)*4;path(c,[[xx,4],[xx*1.5,11],[xx*2,8]],'#ce6e79',4);}oval(c,0,-2,11,12,'#ec9295');for(const d of [-1,1]){oval(c,d*4,-2,2.5,3,cream);oval(c,d*4,-2,1.3,1.7,ink);}
    }else if(name==='carrot'){path(c,[[-8,-6],[8,-6],[0,16]],'#ef8f47');path(c,[[-3,-5],[-6,-13],[0,-9],[4,-16],[5,-6]],'#78a565');path(c,[[-4,0],[1,1]],'#b95e31',1.5);
    }else if(name==='button'){oval(c,0,0,10,10,'#ecc462');arc(c,0,0,7,0,TAU,'#aa7637',1.5);for(const xx of [-2,2])for(const yy of [-2,2])oval(c,xx,yy,1.2,1.2,'#83582c');
    }else if(name==='rocket'){path(c,[[-6,6],[-9,13],[-1,9],[8,13],[6,5]],'#ef947e');oval(c,0,-1,6,13,'#f4dcb4');oval(c,0,-3,3,3,'#519caa');
    }else if(name==='bee'){oval(c,-4,-7,4,8,'#e1f3ea',-.6);oval(c,4,-7,4,8,'#e1f3ea',.6);oval(c,0,2,11,7,'#edba55');path(c,[[-4,-3],[-4,7]],ink,3);path(c,[[1,-3],[1,7]],ink,3);oval(c,7,0,1.5,1.5,ink);
    }else if(name==='whale'){oval(c,0,2,12,8,'#67b2c3');path(c,[[-8,2],[-18,-5],[-15,4],[-10,7]],'#67b2c3');oval(c,7,0,1.5,1.5,ink);path(c,[[2,-7],[1,-12],[-2,-14]],'#a3d5d8',2);
    }else if(name==='star'){glint(c,0,0,14,'#ffee9e');oval(c,0,0,3,3,'#df9e5d');}
    c.restore();
  }
  // The coil reveals silhouettes only nearby. A separate wind-up action leaves time to beachcomb.
  add({id:'saltprint-atlas',title:'Low Tide Lost & Found',genre:'Adventure',accent:'#e6bd75',buttons:{a:'Dig',b:'Wind'},
    description:'Sweep a beach for pieces of a wind-up duck. A couple of other things washed up, too.',
    controls:'Tap the sand to dig, or drag the detector and lift to dig. Steer with the pad and press A. Tap the finished duck or press B to wind it.',
    create(g){
      const loot=[[135,224,'key'],[343,287,'wheel'],[468,157,'duck'],[547,302,'ring'],[257,135,'cap']];
      const names=['Wind-up key','Paddle wheel','Tin duck','Sea-glass ring','Strawberry soda cap'];
      const found=new Set(),holes=[];let x=135,y=224,t=0,burst=null,trail=[],launch=0,done=false;
      const parts=()=>loot.slice(0,3).filter((_,i)=>found.has(i)).length;
      const hud=()=>g.hud(`${parts()}/3 duck parts · ${found.size-parts()}/2 pocket finds`);
      hud();g.say('Tap the glint to dig. Sweep the sand for more.');
      function scan(px,py){x=clamp(px,12,628);y=clamp(py,94,346);if(!trail.length||dist(x,y,trail[trail.length-1])>12){trail.push([x,y,t]);if(trail.length>20)trail.shift();}}
      function dig(){
        if(done||launch)return;
        const i=loot.findIndex((p,i)=>!found.has(i)&&dist(x,y,p)<34);
        if(i<0){if(!holes.some(p=>dist(x,y,p)<13)){holes.push([x,y]);if(holes.length>45)holes.shift();}return;}
        x=loot[i][0];y=loot[i][1];found.add(i);holes.push([x,y]);burst=[i,t];g.tone(440+i*75,.16);hud();
        g.say(parts()===3?'Duck assembled! Tap it to wind it up.':names[i]+'!');
      }
      function wind(){if(parts()===3&&!launch&&!done){launch=.001;g.tone(730,.15);g.say('Off it goes!');}}
      function tap(px,py){if(py>=350){if(px>=425)wind();return;}if(px>=0&&py>74){scan(px,py);dig();}}
      return {tap,drag(px,py){if(py<350)scan(px,py);},release(){if(!launch&&y<350)dig();},press(k){if(vec[k])scan(x+vec[k][0]*13,y+vec[k][1]*13);if(k==='a')dig();if(k==='b')wind();},update(dt){t+=dt;
        if(launch){launch+=dt;if(launch>1.35&&!done){done=true;g.win('Your tin duck paddled out to sea. Pocket finds: '+(found.size-3)+'/2.');}return;}
        const dx=Number(g.held('right'))-Number(g.held('left')),dy=Number(g.held('down'))-Number(g.held('up'));if(dx||dy)scan(x+dx*170*dt,y+dy*170*dt);
      },draw(c){
        rect(c,0,0,640,420,'#e9c488');const beach=(offset,color)=>{const pts=[[0,0],[640,0]];for(let xx=640;xx>=0;xx-=8)pts.push([xx,68+offset+13*Math.sin(xx/75+t*.35)+9*Math.sin(xx/136+1.5)]);path(c,pts,color);};
        beach(16,'#d8af78');beach(8,'#f7ead0');beach(3,'#86c7bb');beach(-7,'#55a9ad');beach(-26,'#438f9e');
        for(let j=0;j<15;j++){const xx=(j*113+12)%630,yy=12+j*17%38+Math.sin(t+j)*1.7;path(c,[[xx,yy],[xx+7,yy+1],[xx+14,yy-1],[xx+20,yy]],'#8bc9c0',1.2);}
        for(const [xx,yy,size] of [[65,134,.6],[593,257,.7],[317,180,.5],[209,318,.45]]){c.save();c.translate(xx,yy);c.scale(size,size);path(c,[[-8,0],[-8,-5],[-4,-9],[0,-8],[4,-9],[8,-5],[8,0],[0,5]],'#f3d4a8');for(let j=-1;j<=1;j++)path(c,[[0,4],[j*5,-6]],'#c69c76',1.4);c.restore();}
        const crabx=37+14*Math.sin(t*.55);icon(c,'crab',crabx,94+Math.sin(t*3)*.7,.42);
        for(let i=0;i<116;i++){const xx=(i*137+41)%646,yy=98+(i*79)%252;oval(c,xx,yy,i%4===0?2:1,1,i%3?'#daae75':'#f5d9a1');}
        for(const [xx,yy] of [[32,278],[592,120],[395,115],[201,326]]){path(c,[[xx,yy],[xx+5,yy-8],[xx+14,yy-4],[xx+19,yy-13]],'#86986b',3);}
        holes.forEach(([xx,yy])=>{oval(c,xx,yy+3,19,9,'#f2d498');oval(c,xx,yy,15,7,'#b58d60');oval(c,xx+2,yy+1,11,5,'#c59b69');});
        loot.forEach((p,i)=>{if(found.has(i))return;const d=dist(x,y,p);glint(c,p[0],p[1],(i<3?4.4:2.2)+Math.sin(t*3+i)*1.5,i<3?'#fff7c0':'#f2dca3');if(d<72){c.globalAlpha=clamp(1-d/85,.17,.85);icon(c,p[2],p[0],p[1],1.25);c.globalAlpha=1;}});
        if(!launch){const d=Math.min(120,...loot.map((p,i)=>found.has(i)?160:dist(x,y,p)));trail.forEach(([xx,yy,when])=>{if(t-when<.5){c.globalAlpha=.2*(1-(t-when)/.5);arc(c,xx,yy,24,0,TAU,cream,2);}});c.globalAlpha=1;
          path(c,[[x+8,y-9],[x+53,y-62]],'#374e50',5);path(c,[[x+45,y-53],[x+59,y-66]],'#d47d45',9);
          c.save();c.translate(x,y);c.scale(1,.71);arc(c,0,0,25,0,TAU,'#2d545b',5);arc(c,0,0,20,0,TAU,d<45?'#ffdc72':'#92c7be',2);c.restore();
          for(let j=0;j<4;j++)rect(c,x+34+j*4,y-40-j*2,3,4+j*2,d<100-j*19?'#ffe58f':'#819a88');}
        if(burst&&t-burst[1]<1){const n=1-(t-burst[1]);icon(c,loot[burst[0]][2],loot[burst[0]][0],loot[burst[0]][1]-24-20*(1-n),1.65);}
        rect(c,0,354,640,66,'#a37453');rect(c,0,359,640,61,'#845c46');type(c,'POCKET',18,389,12,'#ffe3b4');
        loot.forEach((p,i)=>{const xx=111+i*60;oval(c,xx,388,24,20,'#6c5144');if(found.has(i))icon(c,p[2],xx,388,1.13);else type(c,i<3?'·':'?',xx,388,20,'#cbab86','center');});
        if(parts()===3&&!launch){pill(c,'Wind it up  ›',461,374,151);icon(c,'duck',450,385,1.05);}
        else if(!launch)type(c,'Find the duck parts',523,387,15,'#ffe3b4','center');
        if(launch){const u=clamp(launch/1.35,0,1);const xx=515-103*u,yy=370-345*u;oval(c,xx-8,yy+10,24,5,'#e6ede077');icon(c,'duck',xx,yy+2*Math.sin(t*22),1.7);}
      }};
    }});
  add({id:'heron-house',title:'Rockpool Picnic',genre:'Puzzle',accent:'#87d8b6',buttons:{a:'Peek / give',b:'Bag'},
    description:'Lift the rocks and bring two snacks to a small octopus. A hermit crab is house-hunting nearby.',
    controls:'Tap a rock to lift it. Tap food to pocket it. Tap a hungry animal to share what it wants, or drag food from your bag. The pad selects a rock, A interacts, B cycles your bag.',
    create(g){
      const stones=[[120,139,'kelp'],[324,123,'crab'],[525,147,'octo'],[153,285,'hermit'],[351,268,'shrimp'],[534,290,'shell']];
      const bag=[],lifted=new Set(),taken=new Set(),eaten=new Set(),openedAt=[];let focus=0,t=0,crabFed=false,rehomed=false,bagAt=0,carry=null,joy=null,inkTime=0,finished=false,pad=false;
      const want=()=>['shrimp','mussel'].filter(x=>!eaten.has(x));
      const itemAt=i=>i===1&&crabFed?'mussel':stones[i][2];
      function hud(){g.hud(`${eaten.size}/2 octopus snacks${rehomed?' · Hermit moved in!':''}`);}hud();g.say('Tap a rock to peek underneath.');
      function interact(i,chosen){
        if(i<0||finished||inkTime)return;focus=i;
        if(!lifted.has(i)){lifted.add(i);openedAt[i]=t;g.tone(200+i*24,.07);g.say('Tap what you found.');return;}
        const thing=itemAt(i);
        if(['kelp','shrimp','shell','mussel'].includes(thing)&&!taken.has(i)){
          bag.push(thing);taken.add(i);bagAt=bag.length-1;joy=[i,t];g.tone(455,.12);g.say('In your bag: '+thing+'.');return;
        }
        const requests=i===2?want():i===1&&!crabFed?['kelp']:i===3&&!rehomed?['shell']:[];
        if(i===2&&!requests.length){inkTime=.001;g.say('One very happy octopus!');return;}
        const meal=requests.find(n=>bag.includes(n)&&(!chosen||chosen===n));
        if(!meal){if(requests.length)g.say('Looking for '+requests.join(' or ')+'.');return;}
        bag.splice(bag.indexOf(meal),1);bagAt=Math.max(0,Math.min(bagAt,bag.length-1));joy=[i,t];
        if(i===1){crabFed=true;g.say('The crab left a mussel! Tap to pick it up.');}
        if(i===2){eaten.add(meal);g.say(eaten.size===2?'Both snacks eaten! Tap the octopus to see it off.':'One more snack.');}
        if(i===3){rehomed=true;g.say('A perfect fit. The hermit left you a pearl!');}g.tone(680,.14);hud();
      }
      function hit(x,y){return stones.findIndex(p=>dist(x,y,p)<62);}
      return {tap(x,y){pad=false;if(y>355){const j=Math.floor((x-123)/60);if(j>=0&&j<bag.length){bagAt=j;carry=[bag[j],x,y];}return;}interact(hit(x,y));},drag(x,y){if(carry){carry[1]=x;carry[2]=y;}},release(){if(carry){const i=hit(carry[1],carry[2]);if(i>=0)interact(i,carry[0]);carry=null;}},press(k){pad=true;if(vec[k])focus=moveFocus(stones,focus,k);if(k==='a')interact(focus);if(k==='b'&&bag.length){bagAt=(bagAt+1)%bag.length;g.say('In hand: '+bag[bagAt]+'.');}},update(dt){t+=dt;if(inkTime){inkTime+=dt;if(inkTime>1&&!finished){finished=true;g.win('The octopus ate both snacks and swam home.'+(rehomed?' Your hermit moved into its lavender shell and left a pearl.':''));}}},draw(c){
        rect(c,0,0,640,420,'#d1bc93');const bank=[[0,38],[69,54],[122,31],[201,47],[262,34],[359,49],[430,19],[551,37],[640,12],[640,348],[548,339],[457,359],[353,337],[293,348],[188,338],[91,356],[0,329]];
        path(c,bank,'#94bc9c');c.save();c.translate(0,9);path(c,bank,'#70b5a6');c.restore();
        for(let j=0;j<33;j++){let xx=(j*137)%637,yy=64+(j*67)%267;path(c,[[xx,yy],[xx+11,yy-2+Math.sin(t+j)*1.5],[xx+23,yy]],'#8bcabb',1.7);}
        for(const [xx,yy] of [[50,204],[232,171],[456,282],[601,148],[96,331],[430,82]]){for(let j=-2;j<=2;j++)path(c,[[xx,yy],[xx+j*3,yy-7],[xx+j*7+Math.sin(t+j)*1.5,yy-17-Math.cos(j)*5]],'#4d957c',2.7);}
        stones.forEach(([xx,yy],i)=>{
          const wobble=Math.sin(t*2+i)*1.9,open=lifted.has(i),u=open?clamp((t-openedAt[i])*7,0,1):0;
          oval(c,xx+4,yy+9,50,20,'#559a8c');oval(c,xx,yy+4,43,16,'#7fa58e');
          if(open){let name=itemAt(i);if(i===1&&crabFed&&taken.has(i))name='';if(i===3&&rehomed)name='hermit';
            if(!taken.has(i)||i===3){if(name)icon(c,name,xx,yy+wobble,1.75);}
            if(i===3&&rehomed){icon(c,'shell',xx-4,yy+8,1.12);oval(c,xx+28,yy+7,5,5,'#fff6db');}
            const wants=i===2?want():i===1&&!crabFed?['kelp']:i===3&&!rehomed?['shell']:[];
            if(wants.length){const bx=xx+29,by=yy-30,bw=wants.length*22+8;c.fillStyle='#fcf3d5';c.beginPath();c.roundRect(bx-bw/2,by-13,bw,26,12);c.fill();path(c,[[bx-8,by+10],[bx-13,by+17],[bx,by+12]],'#fcf3d5');wants.forEach((n,j)=>icon(c,n,bx+(j-(wants.length-1)/2)*22,by,.75));}
            if(i===2&&eaten.size===2&&!inkTime)pill(c,'Wave bye',xx-43,yy+24,86);
          }
          if(u<1||!open){c.save();c.translate(xx-u*43,yy-u*36);c.rotate(-u*.65+[-.14,.15,-.1,.07,-.08,.13][i]);c.scale([.95,1.1,.93,1.05,1,1.06][i],[1,.90,1.11,.94,1.08,.88][i]);c.globalAlpha=1-u;
            const rock=[[-48,7],[-42,-12],[-22,-26],[8,-30],[34,-18],[48,0],[35,12],[-17,17]];
            path(c,rock,['#718d83','#778b92','#778d84','#8e9380','#869689','#788e92'][i]);path(c,[rock[0],rock[1],rock[2],rock[3],[11,-17],[-26,-6]],'#adc1a8');path(c,[rock[3],rock[4],rock[5],rock[6],[15,4]],'#657d75');
            for(let j=0;j<7;j++)oval(c,-22+(j*13)%45,-9+(j*9)%17,2.2,1.3,'#a8b6a1');if(i%2===1){for(let k=0;k<3;k++){oval(c,12+k*5,-9+(k%2)*5,3,2,'#bdc6af');oval(c,12+k*5,-9+(k%2)*5,1.1,.8,'#708879');}}if(i===0&&!lifted.size)glint(c,4,-12,7+Math.sin(t*3),cream);c.restore();}
          if(pad&&i===focus)mark(c,xx,yy,46,t);if(joy&&i===joy[0]&&t-joy[1]<.6)glint(c,xx,yy-24-20*(t-joy[1]),10*(1-(t-joy[1])/.6),cream);
        });
        rect(c,0,358,640,62,'#314f50');type(c,'BAG',35,389,15,'#d2e7c5');bag.forEach((n,i)=>{const xx=151+i*60;oval(c,xx,389,22,22,i===bagAt?'#a4c2a2':'#668c82');icon(c,n,xx,389,1.2);});if(!bag.length)type(c,'Empty',135,389,14,'#a7c6ad');
        for(let j=0;j<2;j++){const xx=521+j*55;oval(c,xx,389,21,20,'#537976');const n=['shrimp','mussel'][j];if(eaten.has(n))icon(c,n,xx,389,1.12);else type(c,'?',xx,389,16,'#a2c0ae','center');}
        if(carry)icon(c,carry[0],carry[1],carry[2],1.5);
        if(inkTime){const u=clamp(inkTime,0,1);for(let j=0;j<7;j++)oval(c,525-40*u+12*Math.sin(j),148-42*u+6*j,8+u*15,6+u*11,'#526e8177');icon(c,'octo',525+140*u,147-110*u,1.8);}
      }};
    }});
  function train(c,x,y,heading,t){
    c.save();c.translate(x,y);c.rotate(heading);oval(c,1,6,25,12,'#283e4944');rect(c,-19,-10,34,19,'#bc4f3d');rect(c,-21,-12,15,24,'#ef7355');rect(c,-19,-9,10,17,'#5a7d80');rect(c,-5,-8,20,16,'#dc9051');oval(c,10,0,5,6,'#464f4c');oval(c,12,0,3,3,'#806d56');rect(c,15,-9,4,18,'#e3c293');for(const u of [-12,7])for(const v of [-11,11])oval(c,u,v,5,2.8,'#4b514c');for(let j=0;j<3;j++){const a=(t*1.8+j/3)%1;oval(c,8-19*a,-4-20*a,2+3*a,2+3*a,'#fff3d366');}c.restore();
  }
  add({id:'moth-exchange',title:'Parcel Railway',genre:'Puzzle',accent:'#ed956d',buttons:{a:'Switch / run',b:'Run / pack'},
    description:'Flip three switches on a wooden railway. Each siding has a parcel to bring home.',
    controls:'Tap a striped switch to set a route. Tap the engine to run it. The pad selects the engine or switches, A operates them, B runs the train or packs up after three parcels.',
    create(g){
      const nodes=[[59,205],[197,205],[341,122],[341,283],[540,71],[540,162],[540,245],[540,327]];
      const edgeIds=[[0,1],[1,2],[1,3],[2,4],[2,5],[3,6],[3,7]],curves=edgeIds.map(([a,b])=>{
        const p=nodes[a],q=nodes[b],m=(p[0]+q[0])/2;return Array.from({length:31},(_,j)=>{const u=j/30,v=1-u;return [v*v*v*p[0]+3*v*v*u*m+3*v*u*u*m+u*u*u*q[0],v*v*v*p[1]+3*v*v*u*p[1]+3*v*u*u*q[1]+u*u*u*q[1]];});});
      const levers=[0,0,0],opened=new Set(),names=['Pocket rocket','Clockwork bee','Blue whale','Wishing star'],toys=['rocket','bee','whale','star'];let t=0,ride=null,focus=0,pad=false,finished=false;
      const normal=()=>[0,1,2].filter(i=>opened.has(i)).length;
      function hud(){g.hud(`${normal()}/3 parcels${opened.has(3)?' · Star siding found':''}`);}hud();g.say('Tap the engine. Flip a switch to try another siding.');
      function route(){const fork=levers[0],end=2*fork+levers[1+fork];return {end,edges:[0,1+fork,3+end]};}
      function dispatch(){if(ride||finished)return;ride={...route(),time:0,unwrapped:false};g.tone(550,.17);g.say('Parcel run!');}
      function pack(){if(!ride&&!finished&&normal()===3){finished=true;g.win('Three parcels delivered: a pocket rocket, a clockwork bee and a blue whale.'+(opened.has(3)?' A wishing star rode home in the caboose.':''));}}
      function act(i){if(ride||finished)return;if(i===0){dispatch();return;}levers[i-1]^=1;g.tone(280+i*45,.08);g.say('Switch set. Tap the engine to run.');}
      return {tap(x,y){pad=false;if(y>365){if(x>400&&normal()===3)pack();else if(x<212)dispatch();return;}const i=nodes.slice(0,4).findIndex(p=>dist(x,y,p)<42);if(i>=0){focus=i;act(i);}},press(k){pad=true;if(vec[k])focus=moveFocus(nodes.slice(0,4),focus,k);if(k==='a')act(focus);if(k==='b'){if(normal()===3)pack();else dispatch();}},update(dt){t+=dt;if(!ride)return;ride.time+=dt;if(ride.time>=1.15&&!ride.unwrapped){ride.unwrapped=true;opened.add(ride.end);g.tone(570+ride.end*80,.15);hud();g.say(names[ride.end]+'!');}if(ride.time>2.75){ride=null;if(normal()===3)g.say('Three parcels home. Pack up or try another siding.');}},draw(c){
        rect(c,0,0,640,420,'#c7c59a');for(let j=0;j<56;j++){let xx=(j*97+7)%640,yy=(j*71+18)%359;path(c,[[xx,yy],[xx+4,yy-3],[xx+9,yy]],'#aab18a',1.5);}
        path(c,[[0,0],[153,0],[175,20],[132,43],[111,66],[70,73],[36,100],[0,95]],'#8db6af');path(c,[[640,349],[640,282],[615,292],[603,320],[573,341],[554,361]],'#91b9ae');
        for(const [xx,yy,size] of [[61,115,1],[92,97,.77],[195,79,.85],[227,63,1],[257,79,.7],[381,42,.8],[395,47,.66],[219,302,.8],[194,325,.72],[414,207,.86],[437,207,.65],[582,206,.7]]){
          oval(c,xx+5,yy+3,12*size,5*size,'#8e9f7b');rect(c,xx-2,yy-7*size,4,12*size,'#80664b');path(c,[[xx-12*size,yy-3],[xx,yy-33*size],[xx+12*size,yy-3]],'#597d6b');path(c,[[xx,yy-32*size],[xx+12*size,yy-3],[xx+3*size,yy-6]],'#79977b');}
        const chosen=(ride||route()).edges;
        curves.forEach((points,i)=>{path(c,points,'#a6a780',18);path(c,points,'#dcb781',15);for(let j=1;j<30;j+=2){const p=points[j],q=points[j+1],a=Math.atan2(q[1]-p[1],q[0]-p[0])+Math.PI/2;path(c,[[p[0]-6*Math.cos(a),p[1]-6*Math.sin(a)],[p[0]+6*Math.cos(a),p[1]+6*Math.sin(a)]],'#b08b60',2);}
          for(const side of [-1,1]){const rail=points.map((p,j)=>{const q=points[Math.min(30,j+1)],prev=points[Math.max(0,j-1)],a=Math.atan2(q[1]-prev[1],q[0]-prev[0])+Math.PI/2;return [p[0]+side*4*Math.cos(a),p[1]+side*4*Math.sin(a)];});path(c,rail,chosen.includes(i)?'#775840':'#947e60',1.7);}});
        for(let i=1;i<=3;i++){const [xx,yy]=nodes[i],dir=levers[i-1]?1:-1;oval(c,xx,yy,18,15,'#67594b');arc(c,xx,yy,13,0,TAU,'#e8cd8f',2);path(c,[[xx,yy],[xx+19,yy+dir*13]],'#724f42',7);path(c,[[xx+10,yy+dir*7],[xx+21,yy+dir*14]],'#df7358',8);path(c,[[xx+13,yy+dir*9],[xx+15,yy+dir*10]],cream,7);oval(c,xx,yy,4,4,'#ecd499');}
        nodes.slice(4).forEach(([xx,yy],i)=>{rect(c,xx-13,yy-15,42,30,'#8d8264');rect(c,xx-10,yy-13,39,26,'#dbb682');if(i===3&&!opened.has(i)){for(let j=0;j<4;j++)oval(c,xx+26+j*4,yy-2-j%2*8,11,8,'#779679');glint(c,xx+24,yy-11,4+Math.sin(t*2),cream);}else if(opened.has(i)){icon(c,toys[i],xx+7,yy-9+Math.sin(t*2+i),1.2);}else{rect(c,xx-3,yy-17,24,20,['#c97961','#7c99ad','#bf985d'][i]);rect(c,xx+6,yy-17,5,20,'#f2d295');rect(c,xx-3,yy-11,24,4,'#f2d295');}});
        let xx=nodes[0][0],yy=nodes[0][1],a=0;
        if(ride){const u=ride.time<1.15?ride.time/1.15:ride.time<1.6?1:clamp(1-(ride.time-1.6)/1.15,0,1);const d=Math.min(89.999,u*90),s=Math.floor(d/30),j=Math.floor(d%30),part=d%1;const pts=curves[ride.edges[s]],p=pts[j],q=pts[j+1];xx=p[0]+(q[0]-p[0])*part;yy=p[1]+(q[1]-p[1])*part;a=Math.atan2(q[1]-p[1],q[0]-p[0]);if(ride.unwrapped&&ride.time>1.6)icon(c,toys[ride.end],xx+26,yy-8,1);}
        train(c,xx,yy,a,t);if(!opened.size&&!ride)mark(c,xx,yy,29,t);if(pad)mark(c,...nodes[focus],28,t);
        rect(c,0,363,640,57,'#645443');pill(c,'▶   Run train',19,377,139,'#a75740');for(let i=0;i<4;i++){const x=233+i*46;oval(c,x,391,19,17,'#82745a');if(opened.has(i))icon(c,toys[i],x,390,.9);else type(c,'?',x,391,15,'#c4b392','center');}if(normal()===3)pill(c,'Pack up  ›',472,377,145);else type(c,'Parcel shelf',533,391,15,'#eddfb4','center');
      }};
    }});
  function rabbit(c,x,y,dir,stretch=1){
    c.save();c.translate(x,y);c.scale(dir/stretch,stretch);oval(c,-12,-12,6,6,'#f5e1be');oval(c,-1,-12,14,10,'#debb8e');oval(c,8,-21,9,8,'#f6dab4');oval(c,4,-31,4,10,'#f6dab4',-.29);oval(c,10,-33,3.5,11,'#ebc79d',.14);oval(c,10,-32,1.3,7,'#d28f80',.14);oval(c,12,-22,1.7,1.7,'#3c3f48');oval(c,16,-19,2,1.5,'#c58076');oval(c,0,-3,9,3,'#f6dab4');path(c,[[-10,-9],[-17,-12]],'#c99962',2);arc(c,-19,-13,4,0,TAU,'#dbad65',2);c.restore();
  }
  add({id:'rain-remembers',title:'Shelf Hopper',genre:'Adventure',accent:'#e6af98',buttons:{a:'Hop',b:'Home'},
    description:'Hop a wind-up rabbit across the bedroom furniture. Bring three wooden carrots back to its cardboard hutch.',
    controls:'Tap a shelf to hop. The dotted landing spots show your reach. Use the pad to choose a landing and A to jump. B returns to the starting rug. Bounce on the cushion to see what is underneath.',
    create(g){
      const pads=[[67,345],[203,285],[361,235],[508,173],[354,117],[182,104],[567,91],[549,325]],carrots=[1,3,4],collected=new Set();
      let here=0,focus=1,rabbitX=67,rabbitY=345,dir=1,t=0,jump=null,button=false,buttonShown=false,padMode=false,done=false,feedback=null;
      const reachable=(a,b)=>Math.abs(pads[a][0]-pads[b][0])<=220&&pads[a][1]-pads[b][1]<=99&&Math.hypot(pads[a][0]-pads[b][0],(pads[a][1]-pads[b][1])*.7)<=225;
      function hud(){g.hud(`${collected.size}/3 wooden carrots${button?' · Brass button':''}`);}hud();g.say('Tap the carrot on the books to hop.');
      function land(i){here=i;const [x,y]=pads[i];rabbitX=x;rabbitY=y;g.tone(190+i*25,.055);
        if(carrots.includes(i)&&!collected.has(i)){collected.add(i);hud();feedback=[i,t];g.tone(530+collected.size*75,.12);g.say(collected.size===3?'Three carrots! Hop into the hutch.':'Wooden carrot!');}
        if(i===5){if(buttonShown&&!button){button=true;g.tone(840,.2);hud();g.say('A brass button from the cushion!');}else if(!buttonShown){buttonShown=true;g.say('Something bounced out. Tap the cushion again!');}}
        if(i===6){if(collected.size===3){done=true;g.win('The wind-up rabbit brought three wooden carrots home.'+(button?' It found the missing brass button, too.':''));}else g.say('The hutch has room for three carrots.');}
        focus=pads.map((_,j)=>j).find(j=>reachable(i,j)&&carrots.includes(j)&&!collected.has(j))??(reachable(i,6)?6:i);
      }
      function hop(i,x,y){if(done||jump)return;const from=pads[here];if(i>=0){if(!reachable(here,i)){g.say('Try one of the dotted landing spots first.');return;}[x,y]=pads[i];}else{const dx=x-from[0];x=from[0]+clamp(dx,-204,204);y=clamp(y,from[1]-90,354);}
        if(x!==from[0])dir=Math.sign(x-from[0]);jump={i,x,y,from,age:0,duration:.32+Math.min(.23,Math.abs(x-from[0])/890)};g.tone(350,.06);
      }
      function nearest(x,y){let pick=-1,d=Infinity;pads.forEach((p,j)=>{const dx=Math.abs(x-p[0]),dy=y-p[1];if(dx<=58&&dy>=-55&&dy<=30&&dx+Math.abs(dy)<d){d=dx+Math.abs(dy);pick=j;}});return pick;}
      return {tap(x,y){padMode=false;hop(nearest(x,y),x,y);},press(k){padMode=true;if(jump||done)return;if(vec[k]){const candidates=pads.map((p,j)=>reachable(here,j)?p:null);focus=moveFocus(candidates,focus,k);}if(k==='a')hop(focus);if(k==='b'){here=0;rabbitX=pads[0][0];rabbitY=pads[0][1];focus=1;g.say('Back on the rug.');}},update(dt){t+=dt;if(!jump)return;jump.age+=dt;const u=clamp(jump.age/jump.duration,0,1);rabbitX=jump.from[0]*(1-u)+jump.x*u;rabbitY=jump.from[1]*(1-u)+jump.y*u-55*4*u*(1-u);
        if(u>=1){if(jump.i<0){if(jump.age<jump.duration+.35){rabbitY+=1200*(jump.age-jump.duration)**2;return;}jump=null;land(here);g.say('Boing! Aim for a dotted shelf.');}else{const i=jump.i;jump=null;land(i);}}},draw(c){
        rect(c,0,0,640,420,'#87979d');for(let j=0;j<16;j++)rect(c,j*44,0,2,370,'#93a2a5');
        rect(c,47,49,44,54,'#8c7467');rect(c,50,52,38,47,'#d7c9a9');rect(c,54,56,30,38,'#b1bca9');path(c,[[54,85],[64,70],[73,79],[78,73],[84,83],[84,94],[54,94]],'#7e9a88');oval(c,74,64,4,4,'#edcf97');
        path(c,[[404,16],[456,24],[516,16],[575,24],[640,13]],'#748a90',1.5);for(let j=0;j<7;j++){const xx=415+j*34,yy=17+Math.sin(j*1.7)*3;path(c,[[xx,yy],[xx+13,yy+2],[xx+7,yy+15]],['#c5a192','#aeba9b','#d5ba8e'][j%3]);}rect(c,0,364,640,56,'#a16d55');rect(c,0,354,640,10,'#ded0ac');
        for(let j=0;j<8;j++){const xx=j*99-28;path(c,[[xx,419],[xx+12,365]],'#875d4d',1.5);}rect(c,246,25,126,148,'#647783');rect(c,251,30,116,138,'#d8c7a6');rect(c,257,36,104,126,'#7f9fa7');oval(c,286,60,13,13,'#f2d69b');path(c,[[257,116],[278,100],[294,112],[325,87],[360,111],[360,162],[257,162]],'#729187');rect(c,306,36,5,126,'#c0ad90');rect(c,257,96,104,4,'#c0ad90');rect(c,242,168,133,5,'#ad977a');
        const rug=pads[0];oval(c,rug[0],rug[1]+6,63,12,'#ad725f');oval(c,rug[0],rug[1]+4,55,9,'#d9a276');oval(c,rug[0],rug[1]+4,43,5,'#c78b6b');
        function book(x,y,w,h,col){rect(c,x,y,w,h,col);rect(c,x+7,y+3,w-11,h-6,'#d7c49f');rect(c,x+9,y+h/2,w-15,1,'#bead8d');rect(c,x,y,6,h,col);}
        book(140,332,125,21,'#a36c65');book(156,313,120,19,'#729789');book(136,295,122,19,'#bd8a6c');book(149,285,115,13,'#736b7b');
        rect(c,309,236,104,10,'#9d6951');rect(c,314,245,7,108,'#806b5e');rect(c,400,245,6,108,'#806b5e');path(c,[[309,236],[317,229],[407,229],[413,236]],'#c7a47d');
        rect(c,457,173,103,9,'#a27354');path(c,[[469,182],[485,182],[469,196]],'#795f50');path(c,[[532,182],[548,182],[548,197]],'#795f50');
        rect(c,307,117,98,7,'#af825f');path(c,[[316,124],[332,124],[316,135]],'#80674f');path(c,[[380,124],[394,124],[394,135]],'#80674f');
        rect(c,119,108,123,8,'#9d7258');oval(c,180,104,53,13,'#8c7487');oval(c,180,99,50,12,'#b995a6');path(c,[[135,99],[165,105],[199,105],[223,100]],'#d2b0ab',2);
        rect(c,517,92,111,8,'#a57d5d');path(c,[[532,93],[532,60],[563,36],[601,58],[601,93]],'#c49768');path(c,[[527,61],[562,33],[608,57],[601,63],[562,43],[533,67]],'#a67d59');c.fillStyle='#685d56';c.beginPath();c.roundRect(552,62,29,32,[13,13,0,0]);c.fill();
        rect(c,494,325,109,30,'#7e9b93');rect(c,490,324,116,6,'#a4bbb0');rect(c,503,336,92,2,'#b1c6b8');
        carrots.forEach(i=>{if(!collected.has(i))icon(c,'carrot',pads[i][0],pads[i][1]-23+Math.sin(t*3+i)*2,1.12);});if(buttonShown&&!button)icon(c,'button',183,81,1.1);
        pads.forEach(([x,y],i)=>{if(!reachable(here,i)||(i===here&&i!==5))return;for(let j=-1;j<=1;j++)oval(c,x+j*7,y-3,1.8,1.8,'#fff0bb');if(padMode&&focus===i)mark(c,x,y-12,23,t);});
        if(feedback&&t-feedback[1]<.55){const u=(t-feedback[1])/.55;for(let j=0;j<5;j++){const a=j*TAU/5;glint(c,pads[feedback[0]][0]+Math.cos(a)*u*30,pads[feedback[0]][1]-19+Math.sin(a)*u*30,4*(1-u),cream);}}
        rabbit(c,rabbitX,rabbitY,dir,jump?1+Math.sin(Math.PI*clamp(jump.age/jump.duration,0,1))*.16:1+Math.sin(t*3)*.016);
        for(let i=0;i<3;i++){oval(c,268+i*48,391,17,16,'#896047');if(i<collected.size)icon(c,'carrot',268+i*48,391,.88);}if(button)icon(c,'button',429,390,.85);
      }};
    }});
  add({id:'sounding-glass',title:'Marble Mint',genre:'Puzzle',accent:'#eed17a',buttons:{a:'Turn',b:'Roll'},
    description:'Turn the brass rings and roll a marble into three toy capsules. An unmarked pocket has something inside, too.',
    controls:'Tap or drag each ring to aim its gap at a capsule, then tap the center to roll. Inner rings also turn their neighbor. On the pad, up/down selects a ring, left/right or A turns it, B rolls. Select the shelf below the rings to finish.',
    create(g){
      const cx=241,cy=209,radii=[44,78,111],angles=[1,1,0],shown=[1,1,0],slots=[1,3,6,7],toys=['rocket','bee','whale','star'],found=new Set();
      const mod=n=>(n%8+8)%8,rad=n=>n*Math.PI/4-Math.PI/2,spot=(r,n)=>[cx+r*Math.cos(rad(n)),cy+r*Math.sin(rad(n))];
      let focus=2,t=0,flight=null,dragging=-1,pad=false,done=false,shake=0;
      const count=()=>[1,3,6].filter(i=>found.has(i)).length;
      function hud(){g.hud(`${count()}/3 capsules${found.has(7)?' · Hidden star':''}`);}hud();g.say('Tap the outer ring near the top-right capsule. Tap the marble to roll.');
      function finish(){if(!done&&!flight&&count()===3){done=true;g.win('Three pocket toys rolled out of the mint.'+(found.has(7)?' You cracked the hidden star capsule, too.':''));}}
      function turn(i,d){if(flight||done||i<0||i>2||!d)return;angles[i]+=d;if(i<2)angles[i+1]+=d;g.tone(230+i*80,.055);}
      function setAngle(i,x,y){const n=mod(Math.round((Math.atan2(y-cy,x-cx)+Math.PI/2)/(Math.PI/4)));const d=mod(n-angles[i]+4)-4;turn(i,d);}
      function roll(){if(flight||done)return;const heading=mod(angles[0]);const stop=angles.findIndex(n=>mod(n)!==heading);const reach=stop<0?155:radii[stop]-11;flight={age:0,heading,reach,hit:false,clear:stop<0};g.tone(350,.07);}
      function arrive(f){if(!f.clear){shake=.28;g.say('The marble hit a ring. Line up the next gap.');g.tone(138,.07);return;}const j=slots.indexOf(f.heading);if(j<0){g.say('Empty pocket. Aim for a capsule.');return;}found.add(f.heading);hud();g.tone(630+j*70,.16);g.say(count()===3?'Three toys collected! Tap the shelf to finish.':['Pocket rocket!','A clockwork bee!','A little blue whale!','A star in the unmarked pocket!'][j]);}
      return {tap(x,y){pad=false;dragging=-1;if(x>429){if(y>=330&&count()===3)finish();else if(y>271&&y<329)roll();return;}const r=Math.hypot(x-cx,y-cy);if(r<26){roll();return;}const i=radii.findIndex(v=>Math.abs(r-v)<17);if(i>=0){focus=i;dragging=i;setAngle(i,x,y);}},drag(x,y){if(dragging>=0)setAngle(dragging,x,y);},release(){dragging=-1;},press(k){pad=true;if(k==='up')focus=Math.max(0,focus-1);if(k==='down')focus=Math.min(count()===3?3:2,focus+1);if(k==='left')turn(focus,-1);if(k==='right')turn(focus,1);if(k==='a'){if(focus===3)finish();else turn(focus,1);}if(k==='b')roll();},update(dt){t+=dt;shake=Math.max(0,shake-dt);shown.forEach((_,i)=>{shown[i]+=(angles[i]-shown[i])*Math.min(1,dt*18);});if(flight){flight.age+=dt;if(flight.age>=.43&&!flight.hit){flight.hit=true;arrive(flight);}if(flight.age>=.92)flight=null;}},draw(c){
        rect(c,0,0,640,420,'#333d4e');for(let i=0;i<30;i++){const yy=i*16;path(c,[[0,yy],[191,yy+2],[338,yy-1],[640,yy+1]],'#3c4758',1);}
        const oct=(r,color)=>path(c,Array.from({length:8},(_,i)=>spot(r,i+.5)),color);oct(215,'#252f41');oct(208,'#a9774b');oct(204,'#ceac70');oct(198,'#655648');
        oval(c,cx,cy,176,176,'#414e55');arc(c,cx,cy,174,0,TAU,'#b5a070',3);oval(c,cx,cy,139,139,'#293e45');for(let i=0;i<8;i++){const p=spot(132,i),q=spot(17,i);path(c,[q,p],'#5c7775',2);}
        for(let i=0;i<8;i++){
          const [x,y]=spot(152,i),j=slots.indexOf(i);oval(c,x+1,y+3,18,18,'#303a42');if(j>=0&&found.has(i)){oval(c,x,y,17,17,'#648b85');icon(c,toys[j],x,y,1.05);}
          else if(j>=0&&j<3){oval(c,x,y,18,18,['#d88a76','#c3ac6c','#84b2bb'][j]);arc(c,x-1,y-1,14,3.4,4.8,'#f5dfb0',2);path(c,[[x-16,y+4],[x+15,y-4]],'#5e655d',2);type(c,'?',x,y,16,cream,'center');}
          else{oval(c,x,y,13,13,'#49585a');arc(c,x,y,10,0,TAU,'#616d67',1);if(j===3)glint(c,x+2,y-2,3+Math.sin(t*2)*1.5,'#dbc990');}}
        radii.forEach((r,i)=>{const a=rad(shown[i]),jig=shake?Math.sin(shake*75)*shake*4:0;arc(c,cx+jig,cy+2,r,a+.21,a+TAU-.21,'#172f37',13);arc(c,cx+jig,cy,r,a+.21,a+TAU-.21,['#d68a68','#91bdb1','#dfbd76'][i],9);arc(c,cx+jig,cy-1,r+2,a+.24,a+TAU-.24,['#f4bd91','#b8d5bc','#f9d99a'][i],1.8);
          for(let n=1;n<8;n++){const p=spot(r,shown[i]+n);oval(c,p[0],p[1],1.7,1.7,'#62736a');}if(pad&&focus===i){c.setLineDash([3,7]);arc(c,cx,cy,r+9,0,TAU,'#feebb4',1.3);c.setLineDash([]);}const p=spot(r,shown[i]);for(const s of [-1,1]){const tip=[cx+r*Math.cos(a+s*.21),cy+r*Math.sin(a+s*.21)];oval(c,...tip,3.4,3.4,cream);}if(!found.size&&i===2)glint(c,p[0],p[1],4+Math.sin(t*3),cream);});
        let bx=cx,by=cy;if(flight){const f=flight;const progress=f.age<.43?(f.age/.43)**1.5:f.clear?1:Math.max(0,1-(f.age-.43)/.48);[bx,by]=spot(f.reach*progress,f.heading);}oval(c,bx+2,by+4,11,10,'#172e34');oval(c,bx,by,11,11,'#e6cf9d');oval(c,bx-3,by-3,6,6,'#fff1c8');oval(c,bx-4,by-4,2.5,2.5,'#fffcef');
        rect(c,447,35,174,349,'#273440');rect(c,452,40,164,339,'#53615c');type(c,'TOY SHELF',534,66,15,'#f1dfb3','center');for(let i=0;i<4;i++){const x=494+i%2*78,y=122+Math.floor(i/2)*91;oval(c,x,y+6,28,24,'#3c4c4b');if(found.has(slots[i]))icon(c,toys[i],x,y,1.7);else type(c,i===3?'·':'?',x,y,26,'#899783','center');rect(c,x-32,y+25,64,6,'#a98c64');}
        pill(c,'●  Roll marble',464,278,141,'#304746');if(count()===3){pill(c,'Pack up  ›',464,333,141,pad&&focus===3?'#935940':'#785e45');}else type(c,'Line up the gaps',534,349,14,'#e1d5b1','center');
      }};
    }});
})();

(() => {
  'use strict';

  const tau = Math.PI * 2;
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const dir = (g, axis) => axis === 'x' ? +g.held('right') - +g.held('left') : +g.held('down') - +g.held('up');
  function label(c, str, x, y, color = '#faf0d0', size = 12, align = 'left') {
    c.save(); c.fillStyle = color; c.textAlign = align; c.font = 'bold ' + size + 'px monospace'; c.fillText(str, x, y); c.restore();
  }
  function line(c, x, y, xx, yy, color, w = 2) {
    c.strokeStyle = color; c.lineWidth = w; c.beginPath(); c.moveTo(x,y); c.lineTo(xx,yy); c.stroke();
  }
  function dot(c, x, y, r, color, outline = false, width = 2) {
    c.beginPath(); c.arc(x,y,Math.max(0.01,r),0,tau);
    if (outline) { c.strokeStyle=color; c.lineWidth=width; c.stroke(); }
    else { c.fillStyle=color; c.fill(); }
  }
  function poly(c, points, color) {
    c.fillStyle=color; c.beginPath(); points.forEach(([x,y],i)=>i ? c.lineTo(x,y):c.moveTo(x,y)); c.closePath(); c.fill();
  }
  function rect(c,x,y,w,h,color) { c.fillStyle=color; c.fillRect(x,y,w,h); }
  function bg(c, top, bottom) {
    const grd=c.createLinearGradient(0,0,0,420); grd.addColorStop(0,top); grd.addColorStop(1,bottom); rect(c,0,0,640,420,grd);
  }
  function skyDots(c, n, t, col, height=260) {
    for(let i=0;i<n;i++) { const x=(i*137.9+32)%640, y=(i*i*17.31+12)%height; dot(c,x,y,0.55+(1+Math.sin(t+i))*.42,col); }
  }
  function bar(c,x,y,w,h,f,col,back='#111b22') {
    rect(c,x,y,w,h,back); rect(c,x+1,y+1,(w-2)*clamp(f,0,1),h-2,col);
  }
  function band(c, area, goal, note) {
    rect(c,0,0,640,49,'rgba(10,17,26,.90)');
    label(c,area,15,20,'#fff2ce',15); label(c,goal,15,38,'#c0cfd0',11);
    if(note) label(c,note,625,21,'#ffcf92',11,'right');
  }

  registerGame({
    id:'brasswater-bellworks',title:'Brasswater Bellworks',genre:'Adventure',kind:'Remix',accent:'#e6b067',
    description:'Wade into a drowned foundry where marching shields follow sound. Build hammer momentum, steal a foundry tool, and sound the cracked bell.',
    controls:'Move to pump the hammer. A swings or strikes a nearby bell. B hooks the nearest guard toward you. Walk through a marked door to travel.',
    best:'Either',sources:[['Hammer Formation Encounter v4','Drive','Footwork pumps the hammer chain and each marching shield breaks separately.'],['Clockwork Heist','PR #34','Guards abandon their patrol to investigate a ringing bell.'],['Hookshot','PR #35','Yank a guard across a hot drain or pull yourself to a bronze pivot.']],
    create(g) {
      const rooms = [
        {name:'Receiving dock', bell:[177,123], drain:[335,232], exits:[['PUMP HOUSE',600,133,1],['ANNEALING',600,313,2]]},
        {name:'Pump house', bell:[190,280], drain:[383,180], exits:[['BELFRY',600,213,3]]},
        {name:'Annealing yard', bell:[165,132], drain:[383,291], exits:[['BELFRY',600,213,3]]},
        {name:'The cracked belfry', bell:[505,193], drain:[361,260], exits:[]}
      ];
      const p={x:81,y:220}; let room=0,units=[],tempo=0,ang=0,t=0,heat=0,hook=0,clang=0,shock=0,
        health=4,grace=0,tool='',done=false,tapped=null,target=null,firstClear=false;
      let pull=null;
      const asPoint=([x,y])=>({x,y});
      function init() {
        units=Array.from({length:room===3?3:2},(_,i)=>({x:410+(i%2)*36,y:160+i*34,hp:room===0?1:2,stun:0,flash:0}));
        p.x=84; p.y=223; tempo=.28; health=4; grace=1.3; clang=0; shock=0; tapped=null; target=null; pull=null; firstClear=false;
      }
      init();
      g.say('The dock watch carries individual shields. Move to wind the chain, then swing A near a shield.');
      function knock(e,n) {
        if(e.hp<=0)return;
        e.hp=Math.max(0,e.hp-n); e.flash=.32; e.stun=.95; g.tone(e.hp?177:88,.10);
      }
      function act(key) {
        if(done)return;
        const r=rooms[room],bell=asPoint(r.bell),d=dist(p,bell);
        if(key==='a' && heat<=0) {
          heat=.38; shock=.32;
          if(d<58) {
            if(room===3 && units.every(e=>!e.hp)) {
              done=true; g.tone(488,.5); g.win('The cracked bell carries across Brasswater. The '+tool.toLowerCase()+' is engraved on its new clapper.'); return;
            }
            clang=4.5; target=bell; g.tone(366,.33); g.say('The watch breaks formation and follows the bell.');
          }
          const power=tempo>=(tool==='Flywheel'?.37:.52)?2:1;
          units.forEach(e=>{if(e.hp&&dist(p,e)<(tool==='Flywheel'?88:72))knock(e,power);});
          tempo*=.48; g.tone(106+80*power,.07);
        } else if(key==='b' && hook<=0) {
          hook=tool==='Grapnel'?.45:.70;
          const near=units.filter(e=>e.hp>0).sort((a,b)=>dist(a,p)-dist(b,p))[0];
          if(near && dist(near,p)<(tool==='Grapnel'?325:238)) {
            const vx=p.x-near.x,vy=p.y-near.y,l=Math.hypot(vx,vy)||1,step=Math.min(tool==='Grapnel'?150:94,l);
            const at={x:near.x,y:near.y}; near.x+=vx/l*step;near.y+=vy/l*step; near.stun=1.1;pull={from:at,to:{...p},time:.27};
            const drain=asPoint(r.drain);
            for(let k=0;k<=8;k++)if(dist({x:at.x+(near.x-at.x)*k/8,y:at.y+(near.y-at.y)*k/8},drain)<36){knock(near,2);break;}
          } else {
            const pivot={x:311,y:115},d=dist(p,pivot);
            if(d<280 && d>16) { pull={from:{...p},to:pivot,time:.29};p.x+=(pivot.x-p.x)*.60;p.y+=(pivot.y-p.y)*.60;tempo=.9; }
          }
          g.tone(540,.055);
        }
      }
      function enter(n) {
        room=n; if(n===1)tool='Grapnel'; if(n===2)tool='Flywheel';
        init(); g.say(n===1?'The pump keeper fits a long grapnel. B reaches farther and hauls harder.':n===2?'The annealer fits a flywheel. Heavy swings charge faster and reach farther.':'Clear the last watch, then strike the cracked bell with A.');
      }
      return {
        press:act,tap(x,y){tapped={x,y};},
        update(dt) {
          if(done)return; t+=dt; heat-=dt; hook-=dt; shock-=dt;clang-=dt;grace-=dt;
          if(pull && (pull.time-=dt)<=0)pull=null;
          const r=rooms[room]; let dx=dir(g,'x'),dy=dir(g,'y');
          if(dx||dy)tapped=null;
          if(tapped){const l=dist(p,tapped);if(l<8)tapped=null;else{dx=(tapped.x-p.x)/l;dy=(tapped.y-p.y)/l;}}
          const l=Math.hypot(dx,dy);
          if(l){p.x=clamp(p.x+dx/l*dt*134,33,615);p.y=clamp(p.y+dy/l*dt*134,78,367);}
          tempo=clamp(tempo+dt*(l?.54:-.13),0,1); ang+=dt*(2+tempo*9);
          units.forEach((e,i)=>{
            e.flash-=dt; e.stun-=dt;if(!e.hp||e.stun>0)return;
            const goal=clang>0?target:dist(e,p)<143?p:{x:393+Math.sin(t*.58)*71+(i%2)*31,y:198+Math.cos(t*.58)*31+i*32};
            const ex=goal.x-e.x,ey=goal.y-e.y,el=Math.hypot(ex,ey)||1;
            if(el>10){e.x+=ex/el*(clang>0?68:44)*dt;e.y+=ey/el*(clang>0?68:44)*dt;}
            if(dist(e,asPoint(r.drain))<29){knock(e,2);return;}
            if(dist(e,p)<23 && grace<=0){health--;grace=1.2; knock(e,0);if(health<=0){init();g.say('The keeper fishes you out. This room begins again.');}}
          });
          if(units.every(e=>!e.hp)) {
            if(!firstClear){firstClear=true;g.say(room===0?'Both gates open. The upper pump offers a stronger hook. The lower annealer improves the hammer.':room===3?'The watch lays down its shields. Strike the great bell.':'The belfry gate opens on the east wall.');}
            for(const [,x,y,n] of r.exits) if(dist(p,{x,y})<32){enter(n);break;}
          }
          g.hud('Watch '+units.filter(e=>e.hp).length+' · '+(tool||'Dock hammer')+' · Hearts '+health);
        },
        draw(c) {
          const r=rooms[room],cleared=units.every(e=>!e.hp); bg(c,'#263b43','#0d272d');
          for(let i=0;i<9;i++){const x=i*82-25; rect(c,x,49,15,320,'#263a3b');rect(c,x+2,49,3,315,'#49524b');for(let y=61;y<368;y+=39)dot(c,x+8,y,2,'#151e22');}
          for(let i=0;i<32;i++){const y=70+i*9.5;const x=(i*113+t*(4+i%4))%706-32;line(c,x,y,x+20+i%33,y,'#406166',1);}
          for(let i=0;i<4;i++){const x=42+i*157;line(c,x,49,x+22,96,'#9d865e',4);dot(c,x+24,99,6,'#a99364',true,3);}
          const [hx,hy]=r.drain;dot(c,hx,hy,36,'#673f2c');dot(c,hx,hy,30,'#ed9856');for(let k=-2;k<=2;k++)line(c,hx+k*10,hy-19,hx+k*10,hy+19,'#603b2c',4);
          dot(c,311,115,9,'#d0a35d',true,3);
          r.exits.forEach(([name,x,y])=>{rect(c,x-10,y-26,32,52,cleared?'#5d957f':'#4f5149');for(let j=0;j<4;j++)line(c,x-6+j*7,y-24,x-6+j*7,y+24,'#202e30',2);label(c,name,x-16,y+4,cleared?'#b9eac7':'#96a498',10,'right');});
          const [bx,by]=r.bell; const bellSize=room===3?1.5:1;
          c.save();c.translate(bx,by);c.scale(bellSize,bellSize);line(c,0,-42,0,-24,'#a69b78',3);
          poly(c,[[-17,7],[-12,-4],[-9,-19],[0,-24],[9,-19],[12,-3],[18,7]],'#c99b58');rect(c,-19,7,38,4,'#f4c784');dot(c,0,13,4,'#967040');
          if(room===3){line(c,3,-17,-2,-7,'#52493c',2);line(c,-2,-7,5,3,'#52493c',2);}c.restore();
          if(clang>0)dot(c,bx,by,23+(4.5-clang)*58%85,'rgba(238,196,122,.6)',true);
          units.forEach(e=>{if(!e.hp){line(c,e.x-7,e.y+6,e.x+8,e.y+5,'#778783',3);return;}dot(c,e.x,e.y+4,12,'#20252b');dot(c,e.x,e.y-6,8,e.flash>0?'#fff2b6':'#9ca49a');poly(c,[[e.x-13,e.y-1],[e.x-1,e.y-4],[e.x,e.y+12],[e.x-7,e.y+16],[e.x-14,e.y+9]],e.hp===2?'#cf8957':'#92aaa3');});
          if(grace<=0||Math.floor(t*12)%2){dot(c,p.x,p.y+2,10,'#f3ac66');dot(c,p.x,p.y-8,7,'#efe4bf');rect(c,p.x-8,p.y-2,15,5,'#a84037');}
          const rad=shock>0?55:19+tempo*8;const mx=p.x+Math.cos(ang)*rad,my=p.y+Math.sin(ang)*rad;
          line(c,p.x,p.y,mx,my,'#d8c59a',2);c.save();c.translate(mx,my);c.rotate(ang);rect(c,-5,-8,10,16,'#c2d2c9');c.restore();
          if(shock>0)dot(c,p.x,p.y,30+(.32-shock)*120,'#dfb674',true,2);
          if(pull)line(c,pull.from.x,pull.from.y,pull.to.x,pull.to.y,'#dbe6be',3);
          rect(c,0,379,640,41,'#14222a');label(c,'CHAIN',16,402,'#c4cbc0',10);bar(c,62,392,100,10,tempo,'#e7ae64');
          label(c,'A  SWING / TOLL      B  GRAPNEL',623,402,'#c9c2ae',11,'right');
          band(c,r.name,cleared?(room===3?'Strike the cracked bell.':'Walk into an open gate.'):'Break each shield. The hot drain can crack one instantly.',tool||'BRASSWATER');
        }
      };
    }
  });

  registerGame({
    id:'cinderline-courier',title:'Cinderline Courier',genre:'Adventure',kind:'Remix',accent:'#f49271',
    description:'Carry a coal-warm letter across a runaway sleeper. Rocket over the couplings or recall a signal iron through brake lamps.',
    controls:'Left/right run. A fires your jump rocket; press again for an air boost. B throws the signal iron, then recalls it. Reach the locomotive.',
    best:'Backbone',sources:[['Runaway Express','PR #34','Patrolling opponents and broken couplings turn the moving train roof into a brawler.'],['Boomerang','PR #35','The signal iron hits on its outward flight and its return.'],['Rocket','PR #35','Rocket blasts propel the courier over gaps and shove enemies nearby.']],
    create(g){
      const cars=[
        [0,255,292],[298,530,278],[566,754,266],[804,984,295],
        [1034,1245,269],[1294,1480,285],[1542,1740,255],[1784,1995,281],[2050,2340,263]
      ];
      const ledges=[[352,467,210],[646,750,201],[1090,1202,198],[1602,1728,187],[1876,1982,209]];
      const brakes=[{x:462,y:253},{x:944,y:271},{x:1407,y:262}],foes=[{x:646,car:2},{x:1140,car:4},{x:1670,car:6},{x:1910,car:7}];
      const p={x:58,y:292,vx:0,vy:0}; let air=0,ground=true,facing=1,t=0,cam=0,iron=null,flare=0,inv=0,checkpoint=0,kit='',done=false,parcel=false,route='';let hearts=3;
      const pack={x:723,y:181};
      function jump() {
        if(!ground && air>=(kit==='Aux tank'?2:1))return;
        if(!ground)air++; p.vy=ground?-281:-225; ground=false;flare=.22;g.tone(96,.09);
        foes.forEach(f=>{if(!f.out && Math.abs(f.x-p.x)<60 && Math.abs(cars[f.car][2]-p.y)<63)f.out=true;});
      }
      function press(k){
        if(done)return;
        if(k==='a')jump();
        if(k==='b'){
          if(iron) iron.back=true;
          else{iron={x:p.x,y:p.y-15,v:facing*341,back:false,age:0};g.tone(733,.06);}
        }
      }
      function respawn(){hearts=3;p.x=cars[checkpoint][0]+36;p.y=cars[checkpoint][2];p.vy=0;p.vx=0;iron=null;ground=true;air=0;inv=1.1;g.say('The mail tether catches you at the last carriage.');}
      return {press,tap(x,y){press(y<230?'a':'b');},
        update(dt){
          if(done)return;t+=dt;inv-=dt;flare-=dt;
          const dx=dir(g,'x');if(dx)facing=dx; p.vx+=(dx*153-p.vx)*Math.min(1,dt*14);p.x=clamp(p.x+p.vx*dt,14,2310);
          const old=p.y;p.vy+=555*dt;p.y+=p.vy*dt;ground=false;
          for(const [l,r,h] of [...ledges,...cars]){
            if(p.x>=l-3&&p.x<=r+3&&p.vy>=0&&old<=h+1&&p.y>=h){p.y=h;p.vy=0;ground=true;air=0;break;}
          }
          const car=cars.findIndex(([l,r,h])=>p.x>l+14&&p.x<r-17&&ground&&p.y===h);
          if(car>=0)checkpoint=car;
          if(p.y>427)respawn();
          if(!parcel && Math.hypot(p.x-pack.x,p.y-14-pack.y)<32){parcel=true;kit='Aux tank';g.say('The high rack holds an auxiliary tank. Two air boosts per jump.');}
          if(!kit && p.x>780){kit='Long iron';g.say('The guard van lends a long iron. The signal iron now flies farther.');}
          if(iron){
            iron.age+=dt;
            if(iron.age>(kit==='Long iron'?.84:.52))iron.back=true;
            if(iron.back){const dx=p.x-iron.x,dy=p.y-14-iron.y,l=Math.hypot(dx,dy)||1;iron.x+=dx/l*420*dt;iron.y+=dy/l*420*dt;if(l<14)iron=null;}
            else iron.x+=iron.v*dt;
            if(iron){
              brakes.forEach(b=>{if(!b.on && Math.hypot(iron.x-b.x,iron.y-b.y)<29){b.on=true;g.tone(581,.14);g.say('Brake lamp latched. Two lit lamps let the post train coast into the valley.');}});
              foes.forEach(f=>{if(!f.out && Math.hypot(iron.x-f.x,iron.y-(cars[f.car][2]-13))<24){f.out=true;g.tone(165,.07);}});
            }
          }
          foes.forEach((f,i)=>{if(f.out)return;const [l,r,h]=cars[f.car];f.x=(l+r)/2+Math.sin(t*1.13+i)*47;
            if(inv<=0&&Math.abs(p.x-f.x)<17&&Math.abs(p.y-h)<21){hearts--;inv=1.3;p.vy=-169;ground=false;if(!hearts)respawn();}
          });
          cam=clamp(p.x-206,0,1720);
          if(p.x>2260){done=true;route=brakes.filter(b=>b.on).length>=2?'The valley lamps turn green. You stop at every village on the old post road.':'The express clears the last ridge. The letter reaches the lighthouse before dawn.';g.win(route);}
          g.hud('Car '+(checkpoint+1)+'/9 · Lamps '+brakes.filter(b=>b.on).length+'/3 · '+(kit||'Mail rocket')+' · Hearts '+hearts);
        },
        draw(c){
          bg(c,'#383854','#f8a383');dot(c,459-cam*.028,139,43,'#f4bb8c');
          for(let j=0;j<2;j++){const off=(cam*(.08+j*.09)+t*(3+j*3))%230;for(let i=-1;i<5;i++)poly(c,[[i*230-off,311],[i*230+113-off,150+j*37+Math.sin(i)*30],[i*230+257-off,311]],j?'#775c70':'#9c7c83');}
          for(let i=-1;i<13;i++){const x=i*70-(cam*.45+t*32)%70;line(c,x,323,x,390,'#514657',5);line(c,x,327,x+70,385,'#695263',3);}
          c.save();c.translate(-cam,0);
          cars.forEach(([l,r,h],i)=>{if(r<cam-10||l>cam+650)return;
            rect(c,l+3,h+9,r-l-6,72,'#512f3b');rect(c,l,h,r-l,9,'#f6b078');rect(c,l+3,h+13,r-l-6,6,'#be5954');
            for(let j=l+17;j<r-19;j+=37){rect(c,j,h+27,24,25,'#302f41');rect(c,j+3,h+29,16,12,'#dc8971');}
            rect(c,l+10,h+65,r-l-20,6,'#cb7862');[l+30,r-32].forEach(x=>{dot(c,x,h+84,14,'#342d39');dot(c,x,h+84,6,'#a76a66');});
            if(i<8)line(c,r,h+51,cars[i+1][0],cars[i+1][2]+51,'#302b3b',6);
          });
          ledges.forEach(([l,r,h])=>{rect(c,l,h,r-l,5,'#e6aa82');line(c,l+5,h+5,l+5,h+43,'#714450',3);line(c,r-5,h+5,r-5,h+44,'#714450',3);});
          brakes.forEach(b=>{line(c,b.x,b.y+9,b.x,b.y+23,'#594457',4);dot(c,b.x,b.y,11,'#363443');dot(c,b.x,b.y,7,b.on?'#a7e1ac':'#f3a657');});
          if(!parcel){rect(c,pack.x-8,pack.y-4,16,13,'#c4e4d5');rect(c,pack.x-2,pack.y-7,4,17,'#67918c');}
          foes.forEach(f=>{if(f.out)return;const y=cars[f.car][2];rect(c,f.x-7,y-20,14,18,'#513747');dot(c,f.x,y-23,6,'#e7a487');rect(c,f.x-10,y-28,17,4,'#333243');});
          if(inv<=0||Math.floor(t*10)%2){rect(c,p.x-7,p.y-21,14,16,'#496a75');dot(c,p.x,p.y-25,7,'#f3d5a6');rect(c,p.x-7,p.y-30,15,4,'#e65a48');line(c,p.x,p.y-18,p.x-facing*16,p.y-15+Math.sin(t*15)*2,'#fa8b64',3);line(c,p.x-3,p.y-5,p.x-5,p.y,'#272d40',4);line(c,p.x+3,p.y-5,p.x+7,p.y,'#272d40',4);}
          if(flare>0)poly(c,[[p.x-6,p.y-2],[p.x+6,p.y-2],[p.x,p.y+12+flare*48]],'#ffdc8e');
          if(iron){c.save();c.translate(iron.x,iron.y);c.rotate(t*19);line(c,-9,-3,0,2,'#c2e3dc',4);line(c,0,2,4,-7,'#c2e3dc',4);c.restore();}
          rect(c,2257,200,6,63,'#353744');poly(c,[[2263,200],[2295,208],[2263,216]],'#a9d2ad');c.restore();
          band(c,'Cinderline · westbound','Cross the couplings. Throw the iron through amber brake lamps.',kit||'MAIL ROOF');
          rect(c,0,390,640,30,'#352e40');bar(c,17,403,181,5,p.x/2260,'#ed9c7e');label(c,'WESTERN POST  /  EXPRESS 07',622,410,'#e2b59d',11,'right');
        }
      };
    }
  });

  registerGame({
    id:'ember-ascent',title:'The Ember Ascent',genre:'Adventure',kind:'Remix',accent:'#b4dced',
    description:'Scale a glacial wall with one recallable spear. Choose hearth ash or an ice ferrule, then open a route through the crown thorns.',
    controls:'Directions climb between linked holds. A casts your spear at the nearest knot or recalls it. B plants a piton to rest. Tap an adjacent hold to climb.',
    best:'Either',sources:[['Frost Summit','PR #34','Grip runs down between ledges and planted pitons give recovery.'],['Spearbound','PR #34','The single spear stays embedded until recalled.'],['Thornwood','PR #34','Carrying a hearth ember lets the spear burn away thorn gates.']],
    create(g) {
      const holds=[
        [292,352,'base','Base camp'],[217,304,'rock','West step'],[368,304,'rock','East step'],
        [127,252,'ash','Ash keeper'],[451,250,'ice','Rime forge'],[225,208,'rock','Rook ledge'],
        [358,203,'rock','Blue shelf'],[302,150,'thorn','Crown briar'],[414,132,'rock','Needle ledge'],
        [218,107,'cache','Names cairn'],[311,78,'top','Summit fire']
      ];
      const paths=[[0,1],[0,2],[1,3],[2,4],[3,5],[4,6],[5,7],[6,7],[6,8],[8,7],[7,9],[7,10],[9,10]];
      let at=0,from=0,moving=1,grip=4,pitons=2,kit='',ember=false,open=false,cache=false,shaft=-1,stuck=0,rest=0,repeat=.08,t=0,done=false;
      const neighbors=()=>paths.filter(e=>e.includes(at)).map(([a,b])=>a===at?b:a);
      function finish(){done=true;g.tone(570,.35);g.win(cache?'You light the signal with the names of the lost tucked under its stone. The valley answers with eleven lamps.':'A ribbon of orange unrolls over the summit. The first winter caravan can climb.');}
      function arrival(){
        const kind=holds[at][2];
        if(kind==='base'){grip=4;pitons=2;}
        if(kind==='ash'||kind==='ice'){
          ember=true;grip=4;pitons=2;
          if(!kit){kit=kind==='ash'?'Hearth ash':'Ice ferrule';g.say(kit==='Hearth ash'?'Hearth ash lights your spear. Cast and recall once beside the crown briar.':'The rime forge lights your spear and adds an ice ferrule. You can strike the crown from farther away.');}
        }
        if(kind==='cache'&&!cache){cache=true;g.say('In the cairn are eleven names. Carry them to the summit.');}
        if(kind==='top')finish();
      }
      function climb(n){
        if(done||moving<1||rest>0||!neighbors().includes(n))return;
        if(n===7&&!open){g.say('The crown briar has sealed this hold. Cast A from a nearby ledge, then recall A.');return;}
        if(shaft>=0){g.say('Recall your spear with A before climbing.');return;}
        if(grip<=0){g.say('Your hands are cold. Plant a piton with B to recover.');return;}
        grip--;from=at;at=n;moving=0;g.tone(260+n*7,.055);
      }
      function cast(){
        if(shaft>=0){
          if(shaft===7){open=true;g.say('The returning spear pulls a burning seam through the briar. The crown opens.');}
          shaft=-1;g.tone(352,.12);
        }else if(ember&&!open&&Math.hypot(holds[at][0]-holds[7][0],holds[at][1]-holds[7][1])<(kit==='Ice ferrule'?193:139)){
          shaft=7;g.say('The ember tip catches. A recalls the spear and tears the thorn roots free.');g.tone(634,.08);
        }else{const n=neighbors().find(i=>holds[i][1]<holds[at][1])??neighbors()[0];shaft=n;g.say(ember?'The spear finds bare stone. Recall it and approach the crown.':'Cold steel bites the wall. A recalls it. Find a lit forge on either trail.');}
      }
      function direction(k) {
        const vector={left:[-1,0],right:[1,0],up:[0,-1],down:[0,1]}[k];if(!vector)return;
        const [x,y]=holds[at], next=neighbors().map(n=>{const dx=holds[n][0]-x,dy=holds[n][1]-y;return [n,(dx*vector[0]+dy*vector[1])/Math.hypot(dx,dy)];}).sort((a,b)=>b[1]-a[1]);
        if(next[0][1]>.25)climb(next[0][0]);
      }
      function press(k){
        if(done||moving<1||rest>0)return;
        if(k==='a')cast();
        else if(k==='b'){
          if(grip>=4){g.say('Grip is full. Follow a rope to the next hold.');return;}
          if(pitons>0){pitons--;rest=.65;g.say('The piton holds. Warm your hands.');}
          else{rest=2.1;g.say('Out of pitons. A slow rope rest will restore your grip.');}
        } else{direction(k);repeat=.44;}
      }
      return {press,tap(x,y){const n=neighbors().find(n=>Math.hypot(holds[n][0]-x,holds[n][1]-y)<28);if(n!==undefined)climb(n);},
        update(dt){if(done)return;t+=dt;stuck+=dt;repeat-=dt;
          if(moving<1){moving=Math.min(1,moving+dt*3.6);if(moving===1)arrival();}
          if(rest>0){rest-=dt;if(rest<=0){grip=4;g.tone(281,.12);}}
          if(moving===1&&rest<=0&&repeat<=0){for(const k of ['up','left','right','down'])if(g.held(k)){direction(k);repeat=.42;break;}}
          g.hud('Grip '+grip+'/4 · Pitons '+pitons+' · '+(kit||'Cold spear'));
        },
        draw(c){
          bg(c,'#587489','#d6d9cc');skyDots(c,40,t,'#e7f2dd',275);
          for(let i=-1;i<7;i++){const x=i*124;poly(c,[[x,328],[x+88,121+Math.cos(i)*46],[x+170,359]],'#7092a3');poly(c,[[x+88,121+Math.cos(i)*46],[x+113,179],[x+89,169],[x+70,181]],'#dae4db');}
          poly(c,[[15,385],[95,269],[153,175],[233,123],[305,52],[354,88],[402,78],[464,187],[531,222],[611,386]],'#506b78');
          poly(c,[[306,54],[277,144],[304,187],[229,253],[263,386],[119,386],[173,297],[178,220],[226,176]],'#3d5465');
          poly(c,[[354,88],[390,148],[369,227],[421,287],[417,384],[543,384],[474,252],[451,194]],'#395162');
          for(const [a,b] of paths){const [x,y]=holds[a],[xx,yy]=holds[b];line(c,x,y,xx,yy,(a===at||b===at)?'#f5d187':'#92aab1',a===at||b===at?2.5:1);}
          holds.forEach(([x,y,kind,name],i)=>{
            const col=kind==='thorn'&&!open?'#d88a76':kind==='ash'||kind==='top'?'#ffb674':kind==='ice'?'#98ebee':'#d4d8c7';
            poly(c,[[x-13,y+4],[x-5,y-4],[x+8,y-3],[x+17,y+5],[x+2,y+9]],'#263f50');line(c,x-11,y+3,x+11,y+3,col,3);
            if(kind==='ash'||kind==='ice'||kind==='top'){poly(c,[[x-5,y],[x-3,y-10],[x,y-6],[x+3,y-14-Math.sin(t*5)*2],[x+6,y]],col);}
            if(kind==='thorn'&&!open){for(let j=-2;j<=2;j++){line(c,x+j*4,y+5,x+j*8-3,y-13,'#db927a',2);line(c,x+j*6,y-5,x+j*6+4,y-10,'#db927a',1);}}
            if(i===3||i===4||i===7||i===9||i===10)label(c,name,x+(i===3||i===9?-12:12),y+17,col,10,i===3||i===9?'right':'left');
          });
          const x=holds[from][0]+(holds[at][0]-holds[from][0])*moving,y=holds[from][1]+(holds[at][1]-holds[from][1])*moving-Math.sin(moving*Math.PI)*11;
          if(shaft>=0){const [sx,sy]=holds[shaft];line(c,x,y-13,sx,sy-8,'#ddceb3',1);line(c,sx-11,sy-22,sx+4,sy-5,'#e8be95',3);}
          else{line(c,x-9,y+1,x+6,y-25,'#d4c6b1',2);dot(c,x+6,y-25,3,ember?'#ef995e':'#d3ecf2');}
          line(c,x,y-10,x-7,y-2,'#253b4b',3);line(c,x,y-10,x+6,y-2,'#253b4b',3);
          rect(c,x-5,y-17,10,10,'#df825d');dot(c,x,y-21,5,'#f1d9b6');
          for(let i=0;i<27;i++){const sx=(i*89+t*(14+i%3))%640,sy=(i*137+t*17)%420;line(c,sx,sy,sx-2,sy+2,'#ccdbd8',1);}
          band(c,'The Ember Ascent',open?'The crown is open. Reach the summit or detour to the names cairn.':'Find either forge. Cast and recall beside the crown briar.',kit||'COLD SPEAR');
          rect(c,0,380,640,40,'#263e50');label(c,holds[at][3],16,405,'#e5e7d9',13);
          label(c,rest>0?'WARMING HANDS':shaft>=0?'A  RECALL':'GRIP  '+grip+'/4     PITONS  '+pitons,621,405,'#c4e8e3',12,'right');
        }
      };
    }
  });

  registerGame({
    id:'pearl-tilt-sea',title:'Pearl of the Tilt Sea',genre:'Adventure',kind:'Remix',accent:'#76ded2',
    description:'Spin a lacquered diving top through three oyster courts. Bank barnacles off coral pins and recover the pearl under the atoll.',
    controls:'Steer with directions. Hold A to rev, release to rush. B plants a charge and primes nearby barnacles; press B again to erupt. Enter the open oyster.',
    best:'Either',sources:[['Top','PR #35','Rev a spinning fighter and spend the stored speed on a sumo shove.'],['Bumper Crypt','PR #34','Bank enemies off pinball bumpers to smash their shells.'],['Coverfire','PR #32','Prime enemies with a planted charge, then detonate the marked group.']],
    create(g){
      const layouts=[[[220,154],[386,156],[306,293]],[[194,228],[316,143],[396,276]],[[236,152],[236,295],[397,222]]];
      const rooms=['The mother-of-pearl court','The salt mosaic','The sleeping oyster'];
      const p={x:111,y:218,vx:0,vy:0};let foes=[],room=0,t=0,rev=0,pressedA=false,boost=0,face=0,cd=0,mine=null,rings=[],kit='',done=false,hit=0,hp=4,open=false;
      const gate={x:558,y:213};
      function setup(){
        p.x=110;p.y=219;p.vx=p.vy=0;rev=0;boost=0;mine=null;open=false;hp=4;hit=.7;cd=0;pressedA=false;
        foes=Array.from({length:room===2?3:2},(_,i)=>({x:332+i*57,y:190+(i%2)*67,vx:0,vy:0,hp:room===0?1:2,marked:false,stun:0,flash:0}));
      }
      setup();
      function pulse(x,y,col,size){rings.push({x,y,col,size,life:.38});}
      function damage(f,n){if(f.hp<=0)return;f.hp=Math.max(0,f.hp-n);f.flash=.3;f.stun=.9;pulse(f.x,f.y,'#f5cf83',26);g.tone(f.hp?235:129,.11);}
      function kick(f,x,y,s){const dx=f.x-x,dy=f.y-y,l=Math.hypot(dx,dy)||1;f.vx=dx/l*s;f.vy=dy/l*s;f.stun=.85;}
      function burst(key){
        if(done)return;
        if(key==='a'){pressedA=true;rev=Math.max(rev,.22);}
        if(key==='b'&&cd<=0){
          if(mine){
            foes.forEach(f=>{if(f.hp&&(f.marked||dist(f,mine)<96)){kick(f,mine.x,mine.y,264);damage(f,1);f.marked=false;}});
            pulse(mine.x,mine.y,'#ffba89',110);mine=null;cd=.4;g.tone(133,.13);
          }else{
            mine={x:p.x,y:p.y};foes.forEach(f=>{if(f.hp&&dist(f,mine)<(kit==='Echo nacre'?160:118))f.marked=true;});pulse(p.x,p.y,'#e99481',65);cd=.14;g.tone(432,.08);
          }
        }
      }
      function launch(){const v=110+rev*(kit==='Iron tip'?380:290);p.vx+=Math.cos(face)*v;p.vy+=Math.sin(face)*v;boost=.34+rev*.25;rev=0;g.tone(147,.07);}
      return {press:burst,tap(x,y){if(x<320){face=Math.atan2(y-p.y,x-p.x);rev=.8;launch();}else burst('b');},
        update(dt){
          if(done)return;t+=dt;hit-=dt;boost-=dt;cd-=dt;
          rings.forEach(r=>r.life-=dt);rings=rings.filter(r=>r.life>0);
          let dx=dir(g,'x'),dy=dir(g,'y'),l=Math.hypot(dx,dy);
          if(l){dx/=l;dy/=l;face=Math.atan2(dy,dx);}
          if(g.held('a')){pressedA=true;rev=clamp(rev+dt*.98,0,1);}
          else if(pressedA){pressedA=false;launch();}
          const drag=boost>0?.985:.938;
          p.vx=p.vx*Math.pow(drag,dt*60)+dx*(boost>0?95:495)*dt;p.vy=p.vy*Math.pow(drag,dt*60)+dy*(boost>0?95:495)*dt;
          p.x+=p.vx*dt;p.y+=p.vy*dt;
          function rail(a,lo,hi,key,v){if(a[key]<lo||a[key]>hi){a[key]=clamp(a[key],lo,hi);a[v]*=-.76;return true;}return false;}
          rail(p,62,578,'x','vx');rail(p,92,345,'y','vy');
          for(const f of foes){
            if(!f.hp)continue;f.stun-=dt;f.flash-=dt;const d=dist(p,f)||1;
            if(f.stun<=0){f.vx+=(p.x-f.x)/d*74*dt;f.vy+=(p.y-f.y)/d*74*dt;}
            f.vx*=Math.pow(f.stun>0?.987:.953,dt*60);f.vy*=Math.pow(f.stun>0?.987:.953,dt*60);f.x+=f.vx*dt;f.y+=f.vy*dt;
            let wall=rail(f,63,577,'x','vx');wall=rail(f,91,345,'y','vy')||wall;
            if(wall&&Math.hypot(f.vx,f.vy)>85)damage(f,1);
            if(mine&&dist(f,mine)<(kit==='Echo nacre'?160:118))f.marked=true;
            if(dist(f,p)<24){
              if(boost>0){kick(f,p.x,p.y,kit==='Iron tip'?417:335);boost=0;damage(f,1);}
              else if(f.stun<=0&&hit<=0){hp--;hit=1.45;kick(f,p.x,p.y,130);if(hp<=0){setup();g.say('A tide lifts the top back to the court entrance.');break;}}
            }
            for(const [x,y] of layouts[room]){const d=Math.hypot(f.x-x,f.y-y);
              if(d<32&&d>.01){const nx=(f.x-x)/d,ny=(f.y-y)/d,dotv=f.vx*nx+f.vy*ny;f.x=x+nx*33;f.y=y+ny*33;if(dotv<0){f.vx-=2*dotv*nx;f.vy-=2*dotv*ny;if(Math.abs(dotv)>60){damage(f,1);pulse(x,y,'#91e6cd',40);}}}
            }
          }
          if(!open && foes.every(f=>!f.hp)){open=true;g.say(room===0?'The oyster opens. Enter above its center for an iron tip, below for echo nacre.':'Follow the white pearl to the next chamber.');}
          if(open&&dist(p,gate)<35){
            if(room===2){done=true;g.win(kit==='Iron tip'?'The iron-tipped diver breaks the last hinge. A thousand seed pearls fall into the tide.':'The echo nacre sings to the oyster. It lends the pearl until the next new moon.');}
            else{if(room===0)kit=p.y<gate.y?'Iron tip':'Echo nacre';room++;setup();g.say(kit==='Iron tip'?'Iron tip fitted. Rushes carry farther and hit harder.':'Echo nacre fitted. Your charge now primes a wider circle.');}
          }
          g.hud('Court '+(room+1)+'/3 · Shells '+foes.filter(f=>f.hp).length+' · Hull '+hp+' · '+(kit||'Diving top'));
        },
        draw(c){
          bg(c,'#0a2939','#123f46');for(let i=0;i<24;i++){const x=(i*149+(i%2?1:-1)*9*Math.sin(t*.5+i)+640)%640,y=402-(i*59+t*(4+i%3))%345;dot(c,x,y,2+i%4,'#406d70',true,1);}
          c.save();c.translate(320,218);c.scale(1,.51);dot(c,0,0,288,'#b1b7a0');dot(c,0,0,281,'#48696a');dot(c,0,0,274,'#27535a');for(let r=40;r<270;r+=36)dot(c,0,0,r,'#3c6569',true,1);c.restore();
          for(let i=0;i<13;i++){const x=95+i*35;line(c,x,104,x-31,328,'rgba(171,214,181,.08)',2);}
          layouts[room].forEach(([x,y])=>{dot(c,x,y+4,20,'#163f48');dot(c,x,y,18,'#75ac9d');dot(c,x,y,12,'#d7c49b');dot(c,x,y,7,'#b87d73');dot(c,x-3,y-3,3,'#efd9ac');});
          for(let i=-3;i<=3;i++){const a=-Math.PI/2+i*.19;line(c,gate.x,gate.y+18,gate.x+Math.cos(a)*32,gate.y+18+Math.sin(a)*38,open?'#d9bcac':'#817e78',5);}
          dot(c,gate.x,gate.y+7,open?10:5,open?'#fff2cb':'#8ca299');if(open)dot(c,gate.x-3,gate.y+3,3,'#fff');
          if(mine){dot(c,mine.x,mine.y,kit==='Echo nacre'?160:118,'rgba(254,177,132,.28)',true,1);dot(c,mine.x,mine.y,6,'#ed9675');}
          foes.forEach((f,i)=>{if(!f.hp)return;const col=f.flash>0?'#fff1cb':f.hp>1?'#ce827a':'#d8ad8d';for(let j=0;j<8;j++){const a=j*tau/8+t*.3+i;line(c,f.x,f.y,f.x+Math.cos(a)*16,f.y+Math.sin(a)*16,col,4);}dot(c,f.x,f.y,10,'#864e57');dot(c,f.x-2,f.y-2,5,col);if(f.marked)dot(c,f.x,f.y,20,'#f2a876',true,2);});
          c.save();c.translate(p.x,p.y);c.rotate(t*(6+rev*22));dot(c,0,0,17,hit>0?'#d7d9c9':'#e5ab6f');dot(c,0,0,13,'#285269');for(let j=0;j<3;j++){const a=j*tau/3;line(c,0,0,Math.cos(a)*11,Math.sin(a)*11,'#a9dfcd',3);}dot(c,0,0,4,'#fce4b0');c.restore();
          line(c,p.x+Math.cos(face)*18,p.y+Math.sin(face)*18,p.x+Math.cos(face)*25,p.y+Math.sin(face)*25,'#f4e0b7',3);
          rings.forEach(r=>dot(c,r.x,r.y,(1-r.life/.38)*r.size+2,r.col,true,2));
          band(c,rooms[room],open?'Enter the oyster at the east rail.':'Prime barnacles with B. Bank rushed enemies into coral pins.',kit||'TILT SEA');
          rect(c,0,377,640,43,'#102c37');label(c,'REV',15,404,'#a8c8ba',11);bar(c,51,394,131,11,rev,'#f3be80');label(c,mine?'B  DETONATE':'B  PLANT CHARGE',622,404,'#efd5ac',12,'right');
        }
      };
    }
  });

  registerGame({
    id:'nightglass-observatory',title:'Nightglass Observatory',genre:'Adventure',kind:'Original',accent:'#bba8e4',
    description:'Work one night at a tidal observatory. Track wild silhouettes through two spectral filters and assemble a field record of the sky whale.',
    controls:'Move the viewfinder with directions or tap the sky. B swaps amber and violet glass. Press A to expose, then keep the creature framed until the shutter closes.',
    best:'Either',sources:[],
    create(g){
      const aim={x:320,y:208};
      const animals=[
        {name:'Lantern moth',zone:'WILLOW BANK',filter:0,ink:'#fac87f',pos:t=>[130+Math.sin(t*.74)*68,201+Math.sin(t*1.15)*25]},
        {name:'Mirror hind',zone:'BIRCH ISLAND',filter:1,ink:'#d3b9f4',pos:t=>[457+Math.sin(t*.37)*68,262+Math.cos(t*.71)*8]},
        {name:'Reed comet',zone:'REED BED',filter:0,ink:'#f3a998',pos:t=>[338+Math.sin(t*.64)*79,311-Math.abs(Math.sin(t*.93))*45]},
        {name:'Sky whale',zone:'NORTHERN SKY',filter:1,ink:'#a9dddc',pos:t=>[332+Math.sin(t*.29)*97,118+Math.cos(t*.53)*11]}
      ];
      let seen=[false,false,false,false],glass=0,kit='',t=0,expose=0,exposureLength=.76,quality=[0,0,0,0],flash=0,toast=0,done=false,goal=null;
      const count=()=>seen.filter(Boolean).length;
      const active=i=>i!==3||count()>=2;
      const radius=()=>kit==='Wide iris'?55:43;
      function press(k){
        if(done||expose>0)return;
        if(k==='b'){glass=1-glass;g.tone(glass?380:281,.07);}
        if(k==='a'){quality=[0,0,0,0];exposureLength=kit==='Fast shutter'?.43:.70;expose=exposureLength;g.tone(522,.035);}
      }
      function finish(){
        let best=-1;
        quality.forEach((v,i)=>{if(!seen[i]&&v>exposureLength*.55&&(best<0||v>quality[best]))best=i;});
        if(best<0){toast=1.4;g.say('Blank plate. Match the glass to the glint, and keep it inside the viewfinder until the shutter closes.');return;}
        seen[best]=true;flash=.28;g.tone(521+best*49,.15);
        if(!kit){kit=best===1?'Fast shutter':'Wide iris';g.say(kit==='Fast shutter'?'Mirror hind recorded. Its quicksilver plate halves the exposure time.':'First plate recorded. The keeper fits a wide iris for a larger frame.');}
        else if(best!==3)g.say(count()>=2?'Two field records chart a path overhead. Seek the sky whale in violet glass.':animals[best].name+' recorded.');
        if(best===3){done=true;g.win(count()===4?'Your four-plate atlas brings the whole marsh into print. The sky whale carries its own constellation.':'The sky whale appears on the final plate. Its luminous wake becomes the observatory’s first star chart.');}
      }
      function creature(c,i,x,y,on){
        const col=on?animals[i].ink:'#657683';const shadow=on?'#56566c':'#435363';
        c.save();c.translate(x,y);
        if(i===0){
          const w=8+Math.abs(Math.sin(t*8))*10;
          for(const sign of [-1,1]){poly(c,[[0,0],[sign*w,-13],[sign*(w+2),-4],[sign*8,5],[sign*4,7]],col);dot(c,sign*w*.7,-5,2,shadow);}line(c,0,-5,0,8,shadow,3);
        }else if(i===1){
          poly(c,[[-21,-4],[-11,-11],[5,-10],[15,-17],[18,-27],[23,-26],[21,-14],[12,-4],[5,0],[-11,1]],col);
          for(let j=0;j<4;j++){const lx=-13+j*8;line(c,lx,-3,lx+Math.sin(t*3+j)*3,12,col,2);}
          for(let j=0;j<2;j++){const xx=17+j*5;line(c,xx,-23,xx-4+j*6,-37,col,2);line(c,xx-1,-28,xx-7+j*11,-32,col,2);}
        }else if(i===2){
          for(let j=0;j<4;j++)line(c,-6,2+j,-27-j*5,4+j*4,j%2?shadow:col,2);
          poly(c,[[-12,2],[1,-6],[9,-3],[15,0],[4,3],[-10,6]],col);dot(c,6,-2,1.6,shadow);
        }else{
          c.beginPath();c.moveTo(-44,0);c.bezierCurveTo(-28,-22,10,-21,32,-9);c.quadraticCurveTo(43,-8,53,-19);c.quadraticCurveTo(57,-8,45,0);c.quadraticCurveTo(53,5,55,14);c.quadraticCurveTo(40,13,33,5);c.bezierCurveTo(11,18,-31,15,-44,0);c.fillStyle=col;c.fill();
          poly(c,[[-6,7],[10,8],[2,20],[-8,21]],col);dot(c,-27,-2,2.3,shadow);for(let j=0;j<6;j++)dot(c,-13+j*6,-6+Math.sin(j)*3,1.4,shadow);
        }
        c.restore();
      }
      return {press,tap(x,y){goal={x:clamp(x,42,597),y:clamp(y,70,331)};},
        update(dt){
          if(done)return;t+=dt;flash-=dt;toast-=dt;
          let dx=dir(g,'x'),dy=dir(g,'y');if(dx||dy)goal=null;
          if(goal){const d=dist(aim,goal);if(d<5){aim.x=goal.x;aim.y=goal.y;goal=null;}else{dx=(goal.x-aim.x)/d;dy=(goal.y-aim.y)/d;}}
          const l=Math.hypot(dx,dy);if(l){aim.x=clamp(aim.x+dx/l*(goal?360:182)*dt,35,605);aim.y=clamp(aim.y+dy/l*(goal?360:182)*dt,64,334);}
          if(expose>0){
            animals.forEach((a,i)=>{const [x,y]=a.pos(t);if(active(i)&&glass===a.filter&&Math.hypot(aim.x-x,aim.y-y)<radius())quality[i]+=dt;});
            expose-=dt;if(expose<=0)finish();
          }
          g.hud('Plates '+count()+'/4 · '+(glass?'Violet':'Amber')+' · '+(kit||'Field lens'));
        },
        draw(c){
          bg(c,glass?'#292844':'#443340',glass?'#9292a7':'#cd997e');skyDots(c,88,t,'#d9cfc5',216);
          dot(c,519,97,23,glass?'#dad9e1':'#f4c994');dot(c,512,92,2,'#bdb2b1');dot(c,526,102,3,'#bdb2b1');
          for(let layer=0;layer<2;layer++){const points=[[0,301]];for(let i=0;i<=20;i++)points.push([i*32,202+layer*34+Math.sin(i*.68+layer)*19+Math.cos(i*.32)*11]);points.push([640,338],[0,338]);poly(c,points,layer?'#565769':'#727080');}
          rect(c,0,282,640,68,glass?'#555b78':'#796879');
          for(let i=0;i<37;i++){const x=(i*83+Math.sin(t+i)*8)%640,y=287+(i*23)%57;line(c,x,y,x+11+i%16,y,glass?'#777a96':'#a3878a',1);}
          for(const [cx,cy] of [[64,259],[100,254],[467,266],[498,269],[538,265]]){
            line(c,cx,cy,cx-2,cy-55,'#4a495a',3);for(let k=0;k<5;k++)line(c,cx-1,cy-18-k*6,cx+(k%2?1:-1)*(9+k),cy-30-k*7,'#4a495a',2);
          }
          for(let i=0;i<48;i++){const x=i*23%640,y=350+Math.sin(i)*3;line(c,x,y,x+Math.sin(t*.9+i)*4,y-8-i%13,'#3f4855',2);}
          if(count()>=2){for(let i=0;i<15;i++){const x=206+i*16,y=107+Math.sin(i*.36+t*.25)*9;dot(c,x,y,1.5,'#aeafb9');}}
          animals.forEach((a,i)=>{if(!active(i))return;const [x,y]=a.pos(t),on=glass===a.filter;creature(c,i,x,y,on);if(!seen[i]){const glint=on?a.ink:i===1||i===3?'#c5a4db':'#e1b47c';dot(c,x,y-24-i%2*14,2+Math.sin(t*3+i)*.7,glint);}});
          const col=glass?'#ead3ff':'#ffe0ac',r=radius();dot(c,aim.x,aim.y,r,expose>0?'#fff3d7':col,true,1.4);
          for(let i=0;i<4;i++){const a=i*tau/4,dx=Math.cos(a),dy=Math.sin(a);line(c,aim.x+dx*(r-4),aim.y+dy*(r-4),aim.x+dx*(r+5),aim.y+dy*(r+5),col,2);}
          if(expose>0){c.beginPath();c.arc(aim.x,aim.y,r+5,-Math.PI/2,-Math.PI/2+tau*(1-expose/exposureLength));c.strokeStyle='#fff3ce';c.lineWidth=3;c.stroke();}
          dot(c,aim.x,aim.y,1.6,col);
          band(c,'Nightglass Observatory',count()>=2?'A constellation is moving. Track the northern sky in violet glass.':'Photograph two species. Amber and violet glass reveal different glints.',glass?'VIOLET GLASS':'AMBER GLASS');
          rect(c,0,350,640,70,'#222633');animals.forEach((a,i)=>{
            const x=14+i*157;rect(c,x,360,147,45,seen[i]?'#485057':'#303542');rect(c,x,360,3,45,seen[i]?'#c4d4b0':'#626271');
            label(c,seen[i]?a.name:active(i)?a.zone:'…',x+9,378,seen[i]?'#f0e9d4':'#abb1c0',11);
            label(c,seen[i]?'PLATE FILED':active(i)?a.filter?'VIOLET':'AMBER':'UNMAPPED',x+9,395,seen[i]?'#bdcfae':a.ink,9);
          });if(flash>0)rect(c,0,50,640,299,'rgba(255,246,216,'+flash*.75+')');
          if(toast>0)label(c,'BLANK PLATE',aim.x,clamp(aim.y+r+20,82,343),'#ffe2b3',11,'center');
        }
      };
    }
  });
})();

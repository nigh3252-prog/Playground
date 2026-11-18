(() => {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const gap = (a, b) => Math.hypot(a.x-b.x, a.y-b.y);
  const axis = (g, positive, negative) => Number(g.held(positive)) - Number(g.held(negative));
  const mix = (a,b,f) => a+(b-a)*f;
  function rect(c,x,y,w,h,color) { c.fillStyle=color; c.fillRect(x,y,w,h); }
  function ellipse(c,x,y,rx,ry,color) {
    c.fillStyle=color;c.beginPath();c.ellipse(x,y,rx,ry,0,0,TAU);c.fill();
  }
  function dot(c,x,y,r,color) { ellipse(c,x,y,r,r,color); }
  function stroke(c,x,y,xx,yy,color,width=2) {
    c.strokeStyle=color;c.lineWidth=width;c.beginPath();c.moveTo(x,y);c.lineTo(xx,yy);c.stroke();
  }
  function poly(c,points,color) {
    c.fillStyle=color;c.beginPath();c.moveTo(...points[0]);for(const p of points.slice(1))c.lineTo(...p);c.closePath();c.fill();
  }
  function sky(c,top,bottom) {
    const fill=c.createLinearGradient(0,0,0,420);fill.addColorStop(0,top);fill.addColorStop(1,bottom);rect(c,0,0,640,420,fill);
  }
  function print(c,s,x,y,size,color) {
    c.fillStyle=color;c.font='700 '+size+'px system-ui,sans-serif';c.fillText(s,x,y);
  }
  function effects(g) {
    const bits=[],rings=[];let shake=0,t=0;
    return {
      burst(x,y,color,power=1) {
        for(let i=0;i<8+power*3;i++){
          const a=Math.random()*TAU,v=(22+Math.random()*74)*power;
          bits.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v-23,color,life:.18+Math.random()*.3});
        }
        rings.push({x,y,color,r:5,life:.27});
        shake=Math.max(shake,power*1.4);g.impact?.(power);
      },
      tick(dt) {
        t+=dt;shake=Math.max(0,shake-24*dt);
        for(let i=bits.length-1;i>=0;i--){const b=bits[i];b.x+=b.vx*dt;b.y+=b.vy*dt;b.vy+=170*dt;if((b.life-=dt)<=0)bits.splice(i,1);}
        for(let i=rings.length-1;i>=0;i--){rings[i].r+=dt*92;if((rings[i].life-=dt)<=0)rings.splice(i,1);}
      },
      shake(c){c.translate(Math.sin(t*150)*shake,Math.cos(t*117)*shake*.55);},
      draw(c){
        c.save();
        for(const b of bits){c.globalAlpha=Math.min(1,b.life*5);stroke(c,b.x,b.y,b.x-b.vx*.024,b.y-b.vy*.024,b.color,2.7);}
        for(const r of rings){c.globalAlpha=r.life*2.6;c.strokeStyle=r.color;c.lineWidth=2;c.beginPath();c.arc(r.x,r.y,r.r,0,TAU);c.stroke();}
        c.restore();
      }
    };
  }

  registerGame({
    id:'cinderline-courier',title:'Freight Hop',genre:'Adventure',kind:'Remix',best:'Either',accent:'#f69a46',
    description:'Skate a pair of rolling freight trains. Jump the couplings, crack parcels with a returning wrench, and pick a branch at the switch.',
    controls:'Tap a roof to jump to that track. Tap a parcel to throw the wrench. Up/down jump tracks, A vaults, B throws or recalls. Left brakes and right accelerates.',
    buttons:{a:'Vault',b:'Wrench'},
    sources:[['Runaway Express','PR #34','Board moving car roofs and jump the open couplings.'],['Boomerang','PR #35','The wrench breaks cargo crates on the way out and on its return.'],['Rocket','PR #35','A second blast in mid-air buys more height and clears a longer gap.']],
    create(g){
      const fx=effects(g),p={x:82,z:1,h:0,vh:0,vx:0};
      const levelY=z=>240+z*83;
      const cars=[];
      for(let lane=0;lane<2;lane++){
        for(let i=-1;i<10;i++){
          const x=i*266+(lane?0:100);
          cars.push({x,lane,w:i===7?241:228-(i%3===2?17:0),engine:i===7,
            crate:i>=0&&i<7&&(lane===0||i%2===0),cat:lane===1&&i===0,hit:false,i});
        }
      }
      let t=0,runTime=0,cam=0,active=false,done=false,boost=0,lane=1,air=0,ground=true;
      let tool=null,cat=false,count=0,route='',last=p.x,lastLane=lane,squash=0;
      const offset=car=>car.x+Math.sin(runTime*.73+car.lane*1.9)*27+(car.lane?0:Math.sin(runTime*.4)*14);
      function floor(x,z){return cars.some(car=>car.lane===z&&x>offset(car)-3&&x<offset(car)+car.w+4);}
      function status(){g.hud((route||'Switchyard')+' · '+count+' parcels'+(cat?' · Cab cat aboard':''));}
      function start(){if(!active){active=true;g.say('');}}
      function vault(to=lane){
        start();
        if(ground||air<1||to!==lane){
          air=ground?0:1;ground=false;lane=to;p.vh=air?275:328;boost=.24;
          fx.burst(p.x,levelY(p.z)-p.h,'#fff1a2',.72);g.tone(air?245:145,.05);
        }
      }
      function send(target){
        start();if(tool){tool.back=true;return;}
        const y=levelY(p.z)-p.h-15;
        tool={x:p.x+11,y,vx:550,vy:0,back:false,age:0};
        if(target){const dx=offset(target)+target.w*.65-tool.x,dy=levelY(target.lane)-15-y;
          const len=Math.hypot(dx,dy)||1;tool.vx=dx/len*590;tool.vy=dy/len*590;}
        g.tone(410,.045);
      }
      function press(k){
        if(done)return;start();
        if(k==='up')vault(0);if(k==='down')vault(1);
        if(k==='a')vault();if(k==='b')send();
      }
      function pick(x,y){
        const wx=x+cam;
        return cars.find(car=>car.crate&&!car.hit&&Math.abs(wx-offset(car)-car.w*.65)<27&&Math.abs(y-levelY(car.lane)+16)<30);
      }
      let touchLane=null;
      function tap(x,y){if(done)return;const box=pick(x,y);touchLane=null;if(box)send(box);else{touchLane=y<278?0:1;vault(touchLane);}}
      function update(dt){
        t+=dt;fx.tick(dt);if(done||!active)return;
        runTime+=dt;boost=Math.max(0,boost-dt);squash=Math.max(0,squash-dt);
        const speed=axis(g,'right','left');
        const target=185+speed*76+(boost>0?42:0)+(route==='Canal line'&&lane===0?27:0);
        p.vx=mix(p.vx,target,1-Math.exp(-dt*9));p.x+=p.vx*dt;
        p.z=mix(p.z,lane,1-Math.exp(-dt*11));
        if(ground){
          if(!floor(p.x,lane)){ground=false;p.vh=0;air=0;}
          else{last=p.x;lastLane=lane;}
        }
        if(!ground){
          p.vh-=715*dt;p.h+=p.vh*dt;
          if(p.h<=0&&p.h>-23&&p.vh<=0&&floor(p.x,lane)){
            p.h=0;p.vh=0;ground=true;air=0;squash=.13;
            fx.burst(p.x,levelY(p.z),'#ffe3a0',.4);
          }
          if(p.h < -78){
            fx.burst(p.x,levelY(lane)+45,'#ffb764',1.35);g.tone(95,.08);
            p.x=last-28;p.z=lane=lastLane;p.h=p.vh=p.vx=0;ground=true;air=0;active=false;
            g.say('Back on the roof. Tap the next car to clear the gap.');
          }
        }
        if(tool){
          tool.age+=dt;if(tool.age>.49)tool.back=true;
          if(tool.back){const dx=p.x-tool.x,dy=levelY(p.z)-p.h-15-tool.y,len=Math.hypot(dx,dy)||1;
            if(len<14){tool=null;}else{tool.vx=dx/len*770;tool.vy=dy/len*770;}}
          if(tool){
            tool.x+=tool.vx*dt;tool.y+=tool.vy*dt;
            for(const car of cars){
              if(!car.crate||car.hit)continue;const x=offset(car)+car.w*.65,y=levelY(car.lane)-17;
              if(Math.hypot(x-tool.x,y-tool.y)<26){car.hit=true;count++;fx.burst(x,y,'#ffe0a2',1.35);g.tone(330,.07);
                if(car.cat){cat=true;g.say('A cab cat! It rides on your shoulder.');}status();}
            }
          }
        }
        if(!route&&p.x>760){route=lane===0?'Canal line':'Orchard line';g.say(route=== 'Canal line'?'Canal express! The back track picks up speed.':'Orchard local! Fruit vans carry extra parcels.');
          if(lane===1)cars.forEach(car=>{if(car.lane===1&&car.i>2&&car.i<7)car.crate=true;});status();}
        cam=clamp(p.x-172,0,1570);
        if(p.x>1960&&ground){done=true;g.win(route+' to the terminus. '+count+' parcels opened.'+(cat?' The cab cat claims the driver’s seat.':''));}
      }
      function drawCar(c,car){
        const x=offset(car),y=levelY(car.lane),w=car.w;if(x+w<cam-14||x>cam+652)return;
        const colors=car.engine?['#234c53','#6caca5']:car.lane===0?['#3a6770','#80a8a1']:car.i%2?['#a64d33','#eb8856']:['#995334','#df9c57'];
        rect(c,x+4,y+6,w-9,45,'#34383b');rect(c,x,y+4,w,37,colors[0]);
        poly(c,[[x,y+3],[x+10,y-6],[x+w-9,y-6],[x+w,y+3]],colors[1]);
        rect(c,x,y,w,4,'#f5d595');
        for(let a=12;a<w-7;a+=19)stroke(c,x+a,y+7,x+a,y+35,colors[1],2);
        for(const q of [21,39,w-40,w-21]){dot(c,x+q,y+50,9,'#25333a');dot(c,x+q,y+50,4,'#777768');}
        if(car.engine){rect(c,x+73,y-37,53,31,colors[0]);rect(c,x+81,y-31,30,14,'#c7e3c1');rect(c,x+68,y-39,63,6,colors[1]);rect(c,x+144,y-20,9,15,'#3d4443');}
        else if(car.i>=0){rect(c,x+17,y+13,40,17,colors[0]);print(c,'F / '+String(19+car.i*7).padStart(2,'0'),x+20,y+25,9,'#eedca8');}
        if(car.crate&&!car.hit){const xx=x+w*.65;rect(c,xx-16,y-31,30,30,'#62452f');rect(c,xx-14,y-29,26,25,'#eec16e');
          stroke(c,xx-12,y-6,xx+11,y-27,'#976335',4);stroke(c,xx-12,y-26,xx+11,y-6,'#976335',3);
          if(car.cat){poly(c,[[xx-8,y-30],[xx-6,y-38],[xx-1,y-30],[xx+5,y-38],[xx+7,y-30]],'#343a39');}}
      }
      function skater(c){
        const x=p.x,y=levelY(p.z)-p.h,q=Math.sin(t*17)*1.7;
        ellipse(c,x,levelY(p.z)+1,15,3,'#3b443966');
        c.save();c.translate(x,y);c.rotate(ground?0:clamp(p.vh*.00036,-.21,.14));if(squash)c.scale(1.08,.91);
        stroke(c,-16,-3,14,-3,'#354b50',5);for(const q of [-10,9])dot(c,q,0,3,'#ffe5a5');
        stroke(c,-5,-6,-2,-15,'#283e4b',4);stroke(c,6,-6,2,-15,'#283e4b',4);
        poly(c,[[-8,-14],[-4,-28],[4,-28],[8,-15]],'#ecc953');dot(c,3,-32,6,'#ab6847');
        poly(c,[[-4,-33],[-2,-40],[8,-39],[12,-34]],'#f45442');stroke(c,-3,-26,-17,-24+q,'#e4533d',3);
        stroke(c,4,-24,11,-18,'#734b38',3);
        if(cat){dot(c,-7,-25,5,'#293d43');poly(c,[[-12,-28],[-12,-34],[-8,-29],[-4,-33],[-3,-27]],'#293d43');}
        if(boost>0)poly(c,[[-15,-5],[-29-boost*25,-1],[-15,0]],'#ffec9b');c.restore();
      }
      function draw(c){
        sky(c,route==='Canal line'?'#81c6c4':'#f0c49a','#ffe5a9');fx.shake(c);dot(c,477-cam*.04,75,37,'#fff0ad');
        for(let i=0;i<9;i++){const x=i*128-(cam*.16)%128-75,h=32+(i%3)*16;
          poly(c,[[x,199],[x+26,175-h],[x+70,165-h],[x+146,199]],'#a3a48a');}
        if(route==='Orchard line'){
          for(let i=0;i<14;i++){const x=i*61-cam*.25%61;rect(c,x,171,6,40,'#777050');ellipse(c,x,162,28,22,'#858f5d');dot(c,x-7,157,3,'#df975d');}
        }else{
          for(let i=-1;i<9;i++){const x=i*102-cam*.28%102;rect(c,x,172,82,25,'#869b8b');poly(c,[[x,172],[x+33,153],[x+33,171],[x+69,153],[x+69,172]],'#788d82');}
        }
        for(let i=0;i<3;i++){
          const x=i*326+69-(cam*.36)%326;stroke(c,x,201,x,111,'#778d80',4);
          stroke(c,x,112,x+70,91,'#778d80',4);stroke(c,x,129,x+47,99,'#778d80',2);
          stroke(c,x+60,95,x+60,136,'#8b9481',1.4);rect(c,x+56,136,8,5,'#8b8876');
        }
        rect(c,0,202,640,219,route==='Canal line'?'#71a9a6':'#a7a478');
        for(let j=0;j<48;j++){const x=(j*91-cam*.7)%650,y=206+(j*43)%204;stroke(c,x,y,x+9+j%11,y,'#d4c798',1);}
        for(const z of [0,1]){
          const y=levelY(z);
          rect(c,0,y+52,640,16,'#7f7965');
          for(let x=-25-(cam*1.02)%26;x<650;x+=26)stroke(c,x,y+60,x+13,y+68,'#5c6058',5);
          rect(c,0,y+59,640,3,'#ddc49a');
          c.save();c.translate(-cam,0);cars.filter(car=>car.lane===z).forEach(car=>drawCar(c,car));
          if(Math.round(p.z)===z)skater(c);c.restore();
        }
        c.save();c.translate(-cam,0);
        if(cam<885&&cam+640>710){stroke(c,759,174,759,235,'#4d645b',5);rect(c,725,158,77,22,'#455e56');print(c,'⑂  SWITCH',729,173,11,'#f8e5ac');}
        if(tool){c.save();c.translate(tool.x,tool.y);c.rotate(t*22);stroke(c,-10,0,7,0,'#f6f0bd',4);stroke(c,6,0,10,-4,'#e0f0dc',4);stroke(c,6,0,10,4,'#e0f0dc',4);c.restore();}
        fx.draw(c);c.restore();
      }
      status();g.say('Tap a roof to leap. Tap a crate to crack it.');
      return {draw,update,press,tap,drag(x,y){const z=y<278?0:1;if(touchLane!==null&&z!==touchLane){touchLane=z;vault(z);}},release(){touchLane=null;}};
    }
  });

  registerGame({
    id:'ember-ascent',title:'Snapline Summit',genre:'Adventure',kind:'Remix',best:'Either',accent:'#ffad5f',
    description:'Fire an ice axe into a hold and let the stretched line fling you up a red-rock spire. A spiral in the cliff marks a fossil pocket.',
    controls:'Tap or drag across a chalked hold to hook it. On a pad, aim with directions and press A to throw. B releases the line with a kick. A ledge restores your grip.',
    buttons:{a:'Hook',b:'Kick'},
    sources:[['Spearbound','PR #34','One retrievable ice axe sticks in a chosen hold. Its cord carries the climber to it.'],['Frost Summit','PR #34','Grip drains on the wall and refills on a ledge. A slip returns the climber to the last ledge.'],['SLING','PR #35','Stretching the cord and releasing it launches the climber with stored momentum.']],
    create(g){
      // The left fork passes a visible ammonite and rejoins the central spire.
      const holds=[
        [303,1015,'camp'],[246,905],[395,903],[146,814,'ledge'],[316,795,'ledge'],[463,778,'ledge'],
        [100,680,'fossil'],[218,673],[399,656],[509,631],[280,557,'ledge'],[416,526,'ledge'],
        [162,505],[215,391],[332,396],[475,389],[285,287,'ledge'],[423,278,'ledge'],[346,173],[376,78,'summit']
      ].map(([x,y,type='crag'],i)=>({x,y,type,i}));
      const p={x:303,y:1015,vx:0,vy:0}, fx=effects(g);
      let t=0,cam=660,latch=holds[0],rest=holds[0],pin=null,grip=1,fossil=false,done=false,active=false;
      let aim={x:0,y:-1},lineAge=0,face=1,dragPin=null;
      const onLedge=h=>h&&['camp','ledge','fossil','summit'].includes(h.type);
      function status(){g.hud(Math.max(0,Math.round((1015-p.y)*.12))+' m · Grip '+Math.round(grip*100)+'%'+(fossil?' · Ammonite':''));}
      function available(){return holds.filter(h=>h!==latch&&gap(h,p)<200);}
      function next(){
        const options=available().filter(h=>h!==pin);
        const score=h=>{const dx=h.x-p.x,dy=h.y-p.y,d=Math.hypot(dx,dy)||1;return (dx*aim.x+dy*aim.y)/d-d*.0009;};
        return options.sort((a,b)=>score(b)-score(a))[0];
      }
      function throwTo(h){
        if(done||!h||h===pin||gap(h,p)>=205)return;
        if(!active){active=true;g.say('');}
        pin=h;latch=null;lineAge=0;face=Math.sign(h.x-p.x)||face;
        const d=gap(p,h)||1;p.vx=p.vx*.25+(h.x-p.x)/d*205;p.vy=p.vy*.25+(h.y-p.y)/d*205;
        fx.burst(h.x,h.y,'#ffebaa',.55);g.tone(435,.045);
      }
      function land(h){
        latch=h;pin=null;p.x=h.x;p.y=h.y;p.vx=p.vy=0;
        if(onLedge(h)){rest=h;grip=1;}
        fx.burst(h.x,h.y,'#ffd891',.62);
        if(h.type==='fossil'&&!fossil){fossil=true;g.say('An ammonite comes free of the cliff.');g.tone(585,.09);}
        if(h.type==='summit'){done=true;g.win(fossil?'112 metres. You brought a Jurassic ammonite to the summit.':'112 metres. Your flag flies above the whole canyon.');}
      }
      function kick(){
        if(done)return;
        if(!active){active=true;g.say('');}
        const spring=pin?Math.min(180,gap(p,pin))*.85:0;
        p.vx=clamp(p.vx*.72+aim.x*(180+spring),-340,340);
        p.vy=clamp(p.vy*.5-175+Math.min(0,aim.y)*(70+spring),-405,110);
        pin=latch=null;lineAge=0;fx.burst(p.x,p.y,'#fff2be',.75);g.tone(195,.055);
      }
      function choose(x,y){
        const point={x,y:y+cam};const options=available();
        const h=options.sort((a,b)=>gap(point,a)-gap(point,b))[0];
        if(h&&gap(point,h)<70){dragPin=h;throwTo(h);}
      }
      function update(dt){
        t+=dt;fx.tick(dt);if(done)return;
        const dx=axis(g,'right','left'),dy=axis(g,'down','up');
        if(dx||dy){const d=Math.hypot(dx,dy);aim={x:dx/d,y:dy/d};if(dx)face=Math.sign(dx);}
        if(active){
          if(!onLedge(latch))grip=Math.max(0,grip-dt*(latch?.07:.045));
          if(pin){
            lineAge+=dt;const tx=pin.x-p.x,ty=pin.y-p.y;
            p.vx+=(tx*47-p.vx*8)*dt;p.vy+=(ty*47-p.vy*8+34)*dt;
            p.x+=p.vx*dt;p.y+=p.vy*dt;
            if(gap(p,pin)<13||lineAge>1.05)land(pin);
          }else if(!latch){
            p.vy+=605*dt;p.vx+=(dx*315-p.vx*.7)*dt;p.x=clamp(p.x+p.vx*dt,35,605);p.y+=p.vy*dt;
            if(p.vy>0){const h=holds.find(h=>Math.abs(p.x-h.x)<24&&p.y>=h.y&&p.y-h.y<15);if(h)land(h);}
          }
          if(grip<=0||p.y>rest.y+180||p.y>1090){
            fx.burst(p.x,p.y,'#ffdeb1',1);land(rest);g.say('Caught by the safety line.');}
        }
        cam=mix(cam,clamp(p.y-273,0,680),1-Math.exp(-dt*6));status();
      }
      function rock(c){
        poly(c,[[70,1100],[109,858],[50,716],[89,621],[175,502],[180,382],[233,277],[286,210],[294,140],[377,46],[421,119],[420,198],[486,254],[515,375],[485,445],[556,577],[532,745],[596,850],[550,1100]],'#b7583e');
        poly(c,[[70,1100],[109,858],[50,716],[89,621],[175,502],[180,382],[233,277],[286,210],[294,140],[377,46],[320,221],[346,294],[256,426],[269,504],[180,659],[185,753],[126,850],[177,1100]],'#e08a58');
        poly(c,[[439,815],[369,725],[402,622],[351,553],[409,473],[389,373],[417,328],[405,246],[462,260],[478,376],[446,467],[498,569],[483,657],[516,715]],'#923f3c');
        for(let j=0;j<19;j++){
          const y=261+j*41,x=224+Math.sin(j*2.6)*45,w=47+(j*23)%130;
          c.strokeStyle=j%3?'#c66a49':'#dc8458';c.lineWidth=j%4===0?4:2;c.beginPath();c.moveTo(x,y);
          c.lineTo(x+w*.31,y-6);c.lineTo(x+w*.32,y-11);c.lineTo(x+w*.82,y-16);c.lineTo(x+w,y-24);c.stroke();
        }
        for(let i=0;i<40;i++){
          const x=167+(i*73)%258,y=220+(i*53)%790;
          stroke(c,x,y,x+16+i%30,y-4,'#e19462',2);
        }
        poly(c,[[287,166],[296,128],[377,46],[416,107],[425,133],[393,118],[372,132],[356,114],[334,152],[324,142]],'#f5e8ce');
      }
      function draw(c){
        sky(c,'#68bfc6','#f6dfbc');fx.shake(c);dot(c,109,78,38,'#ffdfaa');
        for(let j=0;j<2;j++){
          const y=250+j*47-cam*(.032+j*.024);
          for(let i=-1;i<6;i++){const x=i*145+42*j;
            poly(c,[[x,y+100],[x+23,y+67],[x+39,y+64],[x+47,y+10],[x+83,y],[x+92,y+55],[x+119,y+66],[x+157,y+100]],j?'#b98c77':'#c0a596');}
        }
        c.save();c.translate(0,-cam);rock(c);
        const candidate=next();
        for(const h of holds){
          if(h.y<cam-35||h.y>cam+440)continue;
          const wide=onLedge(h)?33:14;
          poly(c,[[h.x-wide,h.y+4],[h.x-14,h.y-3],[h.x+7,h.y-5],[h.x+wide,h.y+1],[h.x+15,h.y+11],[h.x-7,h.y+13]],'#783f35');
          stroke(c,h.x-wide+3,h.y+3,h.x+wide-3,h.y-1,onLedge(h)?'#f5d7a1':'#ffc78b',4);
          if(h.type==='fossil'&&!fossil){c.strokeStyle='#fff0c3';c.lineWidth=2.5;c.beginPath();for(let j=0;j<75;j++){const a=j*.17,r=j*.15;const x=h.x+Math.cos(a)*r,y=h.y-13+Math.sin(a)*r;j?c.lineTo(x,y):c.moveTo(x,y);}c.stroke();}
          if(h===candidate&&!pin){c.strokeStyle='#fff8d3';c.lineWidth=2;c.setLineDash([3,5]);c.beginPath();c.ellipse(h.x,h.y,wide+8,11,0,0,TAU);c.stroke();c.setLineDash([]);}
          if(h.type==='summit'){stroke(c,h.x,h.y,h.x,h.y-51,'#573e37',3);poly(c,[[h.x+1,h.y-50],[h.x+27,h.y-44+Math.sin(t*4)*3],[h.x+2,h.y-35]],'#ff613d');}
          if(h.type==='camp'){poly(c,[[h.x-69,h.y+1],[h.x-47,h.y-28],[h.x-25,h.y+2]],'#3e737a');poly(c,[[h.x-54,h.y+1],[h.x-47,h.y-18],[h.x-39,h.y+1]],'#31464a');}
        }
        if(pin){const k=Math.min(1,lineAge*14),xx=mix(p.x,pin.x,k),yy=mix(p.y-9,pin.y,k);
          stroke(c,p.x,p.y-10,xx,yy,'#594936',3);stroke(c,p.x,p.y-10,xx,yy,'#ffdf6d',1);
          stroke(c,xx-5,yy+8,xx+4,yy-4,'#354755',3);stroke(c,xx+4,yy-4,xx+10,yy-2,'#ffedc6',3);}
        c.save();c.translate(p.x,p.y);c.scale(face,1);c.rotate(clamp(p.vx*.0006,-.32,.32));
        stroke(c,-4,-4,-7,4,'#263e51',4);stroke(c,2,-6,8,0,'#263e51',4);
        rect(c,-9,-21,11,15,'#234e62');poly(c,[[-7,-7],[-6,-24],[5,-23],[7,-6]],'#f59b35');
        dot(c,1,-26,5.5,'#bd7554');ellipse(c,0,-30,7,4,'#fff0a9');
        stroke(c,3,-19,9,pin?-28:-15,'#5c403c',3);if(!pin)stroke(c,9,-13,12,-25,'#dfd7b5',2);
        c.restore();fx.draw(c);c.restore();
      }
      status();g.say('Tap a chalked hold. Your axe pulls you up.');
      return {draw,update,tap:choose,drag(x,y){if(!dragPin||Math.hypot(x-dragPin.x,y+cam-dragPin.y)>36)choose(x,y);},release(){dragPin=null;},
        press(k){if(k==='a')throwTo(next());if(k==='b')kick();
          if(['left','right','up','down'].includes(k))aim={x:k==='right'?1:k==='left'?-1:0,y:k==='down'?1:k==='up'?-1:0};}};
    }
  });

  registerGame({
    id:'pearl-tilt-sea',title:'Shell Racket',kind:'Remix',genre:'Adventure',best:'Either',accent:'#65d8b7',
    description:'Roll a spinning sea snail into hermit crabs. Their shells ricochet off the reef and spill pearls you can reel back to the skiff.',
    controls:'Tap a crab to ram it. Drag through water to swim and reel in pearls. On a pad, steer, press A for a spinning rush, and B for the pearl magnet. Return three to the left-hand skiff.',
    buttons:{a:'Spin',b:'Reel'},
    sources:[['Top','PR #35','A spinning fighter rams opponents and transfers its speed on contact.'],['Bumper Crypt','PR #34','Creatures turn into rolling pinballs that rebound off walls, bumpers and one another.'],['Magnet','PR #35','The snail’s magnet pulls freed pearls across the water into its shell.']],
    create(g){
      const W=1020,p={x:104,y:218,vx:0,vy:0},fx=effects(g);
      const crabs=[[255,213],[500,302],[695,148],[890,280]].map(([x,y],i)=>({x,y,hx:x,hy:y,i,state:'home',vx:0,vy:0,spin:0,clock:0}));
      const pegs=[[352,209,24],[196,82,24],[486,133,32],[561,344,27],[730,279,36],[927,128,31]];
      const pearls=[],wake=[];let t=0,cam=0,face=0,dash=0,cd=0,reel=0,wp=null,aimed=null,bag=0,gold=false,done=false,active=false,aimTime=0;
      function status(){g.hud(bag+(bag>=3?' pearls':' / 3 pearls')+(gold?' · Sun pearl':'')+(bag>=3?' · Return to skiff':' · Oyster Bank'));}
      function start(){if(!active){active=true;g.say('');}}
      function launch(x,y){
        if(cd>0||done)return;start();face=Math.atan2(y-p.y,x-p.x);
        p.vx=Math.cos(face)*685;p.vy=Math.sin(face)*685;dash=.45;cd=.26;
        fx.burst(p.x,p.y,'#bcf7ba',.58);g.tone(195,.055);
      }
      function magnet(){start();reel=.85;fx.burst(p.x,p.y,'#aff2d7',.3);g.tone(435,.045);}
      function tap(x,y){
        if(done)return;start();const hit={x:x+cam,y};const target=crabs.find(b=>b.state==='home'&&gap(b,hit)<40);
        if(target){wp=null;aimed=target;if(gap(p,target)<262){launch(target.x,target.y);aimed=null;}}
        else{wp=hit;aimed=null;magnet();}
      }
      function knock(b,vx,vy){
        const len=Math.hypot(vx,vy)||1;b.vx=vx/len*586;b.vy=vy/len*586;b.state='loose';b.clock=0;
        fx.burst(b.x,b.y,'#ffa877',1.3);g.tone(145,.075);
      }
      function crack(b){
        if(b.state!=='loose')return;b.state='bare';pearls.push({x:b.x,y:b.y,vx:-b.vx*.13,vy:-b.vy*.13,gold:b.i===3});
        fx.burst(b.x,b.y,b.i===3?'#ffeaa4':'#ffecca',1.8);g.tone(645,.09);
      }
      function rim(o,r){
        let hit=false;
        for(const [key,vel,mi,ma] of [['x','vx',26+r,W-26-r],['y','vy',39+r,384-r]]){
          if(o[key]<mi||o[key]>ma){o[key]=clamp(o[key],mi,ma);o[vel]*=-.91;hit=true;}
        }
        for(const [x,y,rad] of pegs){
          const dx=o.x-x,dy=o.y-y,d=Math.hypot(dx,dy)||1;if(d>=rad+r)continue;
          const nx=dx/d,ny=dy/d,v=o.vx*nx+o.vy*ny;o.x=x+nx*(rad+r+.3);o.y=y+ny*(rad+r+.3);
          if(v<0){o.vx-=1.95*v*nx;o.vy-=1.95*v*ny;hit=true;}
        }
        return hit;
      }
      function swimBearing(dest) {
        const distance=gap(p,dest)||1,ux=(dest.x-p.x)/distance,uy=(dest.y-p.y)/distance;
        for(const [x,y,r] of pegs){
          const along=(x-p.x)*ux+(y-p.y)*uy,side=(x-p.x)*uy-(y-p.y)*ux;
          if(along<0||along>Math.min(distance,100)||Math.abs(side)>r+15)continue;
          const clearance=r+23;
          const ways=[-1,1].map(sign=>({x:x-uy*sign*clearance,y:y+ux*sign*clearance}));
          const cost=w=>gap(w,p)+gap(w,dest)+(w.y<54||w.y>365?250:0);
          const w=cost(ways[0])<cost(ways[1])?ways[0]:ways[1];
          return [w.x-p.x,w.y-p.y];
        }
        return [ux,uy];
      }
      function step(dt){
        let dx=axis(g,'right','left'),dy=axis(g,'down','up');
        if(dx||dy){wp=aimed=null;aimTime=.22;}
        if(aimed){
          if(aimed.state!=='home')aimed=null;
          else if(gap(p,aimed)<237&&cd<=0){launch(aimed.x,aimed.y);aimed=null;}
        }
        const dest=aimed||wp;
        if(dest){const len=gap(dest,p);if(len<10){wp=null;}else{[dx,dy]=swimBearing(dest);}}
        const len=Math.hypot(dx,dy);
        if(len){dx/=len;dy/=len;if(dash<=0)face=Math.atan2(dy,dx);}
        if(dash<=0){const f=1-Math.exp(-dt*9);p.vx=mix(p.vx,dx*245,f);p.vy=mix(p.vy,dy*245,f);}
        p.x+=p.vx*dt;p.y+=p.vy*dt;
        if(rim(p,12)&&dash>0){fx.burst(p.x,p.y,'#8af8d3',.47);face=Math.atan2(p.vy,p.vx);}
        for(const b of crabs){
          if(b.state==='home'){
            b.x=b.hx+Math.cos(t*1.5+b.i)*6;b.y=b.hy+Math.sin(t*1.9+b.i)*7;
            if(dash>0&&gap(p,b)<32){knock(b,p.vx,p.vy);p.vx*=-.25;p.vy*=-.25;dash=.08;}
          }else if(b.state==='loose'){
            b.clock+=dt;b.spin+=dt*15;b.x+=b.vx*dt;b.y+=b.vy*dt;
            const bank=rim(b,17);
            for(const other of crabs){if(other!==b&&other.state==='home'&&gap(b,other)<35){knock(other,b.vx,b.vy);crack(b);break;}}
            if(bank)crack(b);
          }
        }
        for(let i=pearls.length-1;i>=0;i--){
          const q=pearls[i];const d=gap(p,q);
          if((reel>0||g.held('b'))&&d<250){q.vx+=(p.x-q.x)*dt*20;q.vy+=(p.y-q.y)*dt*20;}
          q.vx*=Math.exp(-dt*4);q.vy*=Math.exp(-dt*4);
          q.x=clamp(q.x+q.vx*dt,38,W-38);q.y=clamp(q.y+q.vy*dt,50,372);
          if(d<26){bag++;if(q.gold)gold=true;fx.burst(q.x,q.y,'#fff2b3',.85);g.tone(572,.085);pearls.splice(i,1);status();
            if(q.gold)g.say('A sun pearl from the far cove.');else if(bag===3)g.say('Three pearls! Take them back to the skiff.');}
        }
        if(bag>=3&&p.x<119&&Math.abs(p.y-218)<74){done=true;g.win(bag+' pearls aboard the skiff.'+(gold?' The sun pearl glows through the hull.':''));}
      }
      function update(dt){
        t+=dt;fx.tick(dt);if(done)return;
        cd-=dt;dash-=dt;reel-=dt;aimTime-=dt;
        for(let n=0;n<3&&!done;n++)step(dt/3);
        if(Math.hypot(p.vx,p.vy)>45){wake.push({x:p.x,y:p.y,life:.28});}
        for(const w of wake)w.life-=dt;while(wake.length&&wake[0].life<=0)wake.shift();
        cam=clamp(p.x-240,0,W-640);
      }
      function crab(c,b){
        c.save();c.translate(b.x,b.y);c.rotate(b.state==='loose'?b.spin:0);
        if(b.state==='bare'){for(let i of [-1,1]){stroke(c,0,6,i*9,9,'#e78468',2);dot(c,i*6,1,2,'#efae82');}ellipse(c,0,5,7,4,'#be6359');c.restore();return;}
        for(let j=-1;j<=1;j++)for(const s of [-1,1])stroke(c,s*8,4+j*3,s*(17+Math.sin(t*8+b.i)*1.5),5+j*6,'#f9986c',3);
        ellipse(c,0,4,14,10,'#af574e');dot(c,0,-3,14,b.i===3?'#f3b645':'#ea8b6d');dot(c,-2,-4,8,b.i===3?'#cc883a':'#bc5952');dot(c,-2,-3,4,'#f2be88');
        for(const s of [-1,1]){dot(c,s*8,6,3,'#f4d4a0');dot(c,s*8,7,1.4,'#362e3b');}
        c.restore();
      }
      function draw(c){
        sky(c,'#123f50','#17685e');fx.shake(c);c.save();c.translate(-cam,0);
        for(let i=0;i<29;i++){const x=(i*117)%W,y=22+i*31%379;
          c.strokeStyle='#307f78';c.lineWidth=2;c.beginPath();c.ellipse(x,y,31+i%4*7,4+i%3,0,.15,2.9);c.stroke();}
        for(let s=0;s<2;s++){
          const base=s?408:12,sign=s?-1:1;
          for(let i=-1;i<23;i++){const x=i*53,depth=14+(i*i+5)%20;
            ellipse(c,x,base,52,depth+11,'#174441');ellipse(c,x+6,base,40,depth,'#397a68');
            for(let j=0;j<3;j++){const px=x+j*11,py=base+sign*(depth-1);
              stroke(c,px,py,px+Math.sin(t*2+i+j)*4,py+sign*(9+j*4),'#70a780',2.2);}
          }
        }
        for(const [x,y,r] of pegs){
          for(let s=-1;s<=1;s++){
            const xx=x+r*.6+s*4,yy=y+r*.39;
            stroke(c,xx,yy,xx+s*10+4,yy-19+s*3,'#da857a',3);
            stroke(c,xx+s*5,yy-8,xx+s*12-3,yy-13,'#e79b87',2);
          }
          ellipse(c,x+4,y+8,r+5,r,'#103e4699');dot(c,x,y,r,'#c1816f');dot(c,x-2,y-3,r*.87,'#d19a78');
          for(let j=0;j<3;j++){const xx=x-r*.55+j*5,yy=y-r*.25-j%2*4;
            stroke(c,xx,yy,xx-2,yy-7-j*2,'#edb492',3.8);
            ellipse(c,xx-2,yy-7-j*2,2.3,1.2,'#925e68');}
          for(let i=0;i<6;i++){const a=i*1.9,d=i%2?r*.55:r*.32;ellipse(c,x+Math.cos(a)*d,y+Math.sin(a)*d,4,2.9,'#a2696b');}
          stroke(c,x-r*.63,y-r*.35,x-r*.28,y-r*.68,'#eed2a1',3);
        }
        const bob=Math.sin(t*2)*2;
        poly(c,[[45,183+bob],[62,173+bob],[85,185+bob],[92,254+bob],[73,266+bob],[51,250+bob]],'#163d40');
        poly(c,[[46,178+bob],[64,167+bob],[84,183+bob],[88,245+bob],[72,258+bob],[52,244+bob]],'#e2b174');
        poly(c,[[53,183+bob],[64,175+bob],[78,185+bob],[81,242+bob],[71,250+bob],[58,240+bob]],'#72594b');
        for(let y=191;y<239;y+=20)stroke(c,55,y+bob,81,y+bob,'#e6c08b',5);
        for(const w of wake)ellipse(c,w.x,w.y,w.life*26+2,w.life*16+1,'#6fd7b454');
        for(const b of crabs)crab(c,b);
        for(const q of pearls){const y=q.y+Math.sin(t*4)*2;dot(c,q.x,y,9,q.gold?'#f3c855':'#edd5c2');dot(c,q.x-3,y-3,3,'#fffbe5');}
        if(reel>0||g.held('b')){c.save();c.strokeStyle='#a4fbd699';c.lineWidth=2;c.setLineDash([3,8]);c.beginPath();c.arc(p.x,p.y,24+(1+(t*2)%1)*24,0,TAU);c.stroke();c.restore();}
        c.save();c.translate(p.x,p.y);c.rotate(face);
        ellipse(c,0,4,19,13,'#163f49');ellipse(c,3,0,17,10,'#98d9ae');for(const s of [-1,1]){stroke(c,10,s*3,19,s*8,'#bde4a9',2);dot(c,20,s*8,2.6,'#fff0b7');}
        c.rotate(dash>0?t*19:0);dot(c,-2,-2,12,'#f4ce7f');dot(c,-3,-2,8,'#be7c61');dot(c,-3,-3,4,'#f4ce7f');
        c.restore();fx.draw(c);c.restore();
      }
      status();g.say('Tap a crab to ram it. Reel in three pearls.');
      return {draw,update,tap,drag(x,y){if(!done&&!aimed&&dash<=0){wp={x:x+cam,y};reel=.45;}},release(){},
        press(k){if(done)return;start();if(k==='a'){
          const options=crabs.filter(b=>b.state==='home'&&gap(p,b)<265);
          const chosen=options.filter(b=>!aimTime||Math.cos(Math.atan2(b.y-p.y,b.x-p.x)-face)>.35).sort((a,b)=>gap(a,p)-gap(b,p))[0];
          if(chosen)launch(chosen.x,chosen.y);else launch(p.x+Math.cos(face)*100,p.y+Math.sin(face)*100);
        }if(k==='b')magnet();}};
    }
  });

  registerGame({
    id:'nightglass-observatory',title:'Kingfisher Bend',kind:'Original',genre:'Adventure',best:'Either',accent:'#75badf',
    description:'Skim a summer creek and fold your wings to catch minnows. Bring three fish to the nest. Something gold flickers under the drowned willow.',
    controls:'Tap or drag in the sky to fly. Tap a fish to line up a dive. Tap the willow roots to call fish out. Steer on a pad, A dives and B calls. Return to the nest on the left.',
    buttons:{a:'Dive',b:'Call'},sources:[],
    create(g){
      const W=1430,water=255,nest={x:123,y:155},p={x:135,y:139,vx:0,vy:0};
      const fish=[[280,288],[410,318],[553,281],[716,309],[865,290],[1020,307],[1180,281],[1301,309]].map(([x,y],i)=>({hx:x,hy:y,x,y,i,hidden:i===7,caught:false}));
      const fx=effects(g),trail=[];let t=0,cam=0,face=1,wp=null,target=null,mode='air',diveTime=0;
      let carried=0,fed=0,gold=false,found=false,callTime=0,flash=0,done=false,active=false,entered=false;
      function status(){g.hud(fed+' / 3 fed · '+carried+' in beak'+(gold?' · Gold loach':''));}
      function start(){if(!active){active=true;g.say('');}}
      function call(){
        if(done)return;start();callTime=1.15;g.tone(695,.055);
        fx.burst(p.x,p.y,'#f4eec4',.4);
        if(Math.abs(p.x-1300)<235&&!found){
          found=true;fish[7].hidden=false;fx.burst(1300,water+14,'#f5d06f',.9);g.say('A gold loach slips out of the willow roots.');
        }
      }
      function diveAt(q){
        if(done||mode==='dive')return;start();target=q;wp=null;
        if(Math.abs(q.x-p.x)>155||p.y>water-22){mode='lineup';return;}
        launch(q);
      }
      function launch(q){
        mode='dive';diveTime=0;entered=false;
        const lead=q.i===undefined?0:(Math.cos(t*1.15+q.i)*15);
        const a=Math.atan2(Math.max(45,q.y-p.y),q.x+lead-p.x);p.vx=Math.cos(a)*570;p.vy=Math.sin(a)*570;face=Math.sign(p.vx)||face;
        fx.burst(p.x,p.y,'#e9d9a4',.42);g.tone(205,.06);
      }
      function tap(x,y){
        if(done)return;start();const point={x:x+cam,y};
        if(point.x>1235&&y>water-48&&y<water+24&&!found){wp={x:1260,y:174,call:true};target=null;if(mode!=='dive')mode='air';if(Math.abs(p.x-1300)<235)call();return;}
        if(y>water-4){
          const q=fish.filter(f=>!f.hidden&&!f.caught).sort((a,b)=>gap(a,point)-gap(b,point))[0];
          diveAt(q&&gap(q,point)<82?q:point);return;
        }
        if(mode==='dive')return;
        target=null;mode='air';wp={x:point.x,y:clamp(y,53,water-9)};
      }
      function catchFish(q){
        q.caught=true;carried++;if(q.i===7)gold=true;status();flash=.3;fx.burst(q.x,q.y,q.i===7?'#ffdf72':'#b4ead5',1.15);g.tone(498,.08);
        if(carried+fed===3)g.say('The chicks are hungry. Fly back to the nest on the left.');
      }
      function rise(){
        mode='rise';target=null;p.vx*=.48;p.vy=-420;
      }
      function update(dt){
        t+=dt;fx.tick(dt);callTime-=dt;flash-=dt;if(done)return;
        for(const q of fish){q.x=q.hx+Math.sin(t*1.15+q.i)*21;
          q.y=q.hy+Math.sin(t*1.8+q.i)*4-(callTime>0&&Math.abs(q.x-p.x)<270?Math.sin(clamp((1.15-callTime)/1.15,0,1)*Math.PI)*37:0);}
        let dx=axis(g,'right','left'),dy=axis(g,'down','up');
        if(mode==='air'||mode==='lineup'){
          if((dx||dy)&&mode==='air')wp=null;
          if(mode==='lineup'&&target){
            const spot={x:target.x-face*36,y:Math.min(180,water-64)};const d=gap(p,spot);
            if(Math.abs(p.x-target.x)<102&&p.y<water-30)launch(target);
            else{dx=(spot.x-p.x)/(d||1);dy=(spot.y-p.y)/(d||1);}
          }else if(wp){
            const d=gap(p,wp);if(d<9){if(wp.call)call();wp=null;}
            else{dx=(wp.x-p.x)/d;dy=(wp.y-p.y)/d;}
          }
          if(mode!=='dive'){
            const d=Math.hypot(dx,dy)||1,f=1-Math.exp(-dt*10);
            p.vx=mix(p.vx,dx/d*271,f);p.vy=mix(p.vy,dy/d*209,f);
            p.x+=p.vx*dt;p.y=clamp(p.y+p.vy*dt,42,water-7);if(Math.abs(p.vx)>12)face=Math.sign(p.vx);
          }
        }
        if(mode==='dive'){
          diveTime+=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;
          if(p.y>=water&&!entered){entered=true;fx.burst(p.x,water,'#d6f3dd',1.3);}
          let got=false;
          for(const q of fish)if(!q.hidden&&!q.caught&&gap(q,p)<24){catchFish(q);got=true;break;}
          if(got||p.y>347||diveTime>.95)rise();
        }else if(mode==='rise'){
          const was=p.y;p.vy+=dt*260;p.x+=p.vx*dt;p.y+=p.vy*dt;
          if(was>water&&p.y<=water)fx.burst(p.x,water,'#f5ffe2',.92);
          if(p.y<170){mode='air';p.vy=-34;}
        }
        p.x=clamp(p.x,36,W-36);
        if(carried&&gap(p,nest)<53&&mode==='air'){
          fed+=carried;carried=0;fx.burst(nest.x,nest.y,'#ffe0a3',1.15);g.tone(675,.09);status();
          if(fed>=3){done=true;g.win(fed+' fish delivered. The chicks beat their wings on the branch.'+(gold?' One glittering gold scale stays in the nest.':''));}
        }
        cam=clamp(p.x-249,0,W-640);
        if(mode==='dive'||mode==='rise')trail.push({x:p.x,y:p.y,life:.22});
        for(const w of trail)w.life-=dt;while(trail[0]?.life<=0)trail.shift();
      }
      function willow(c,x,y,scale,muted=false){
        c.save();c.translate(x,y);c.scale(scale,scale);const wood=muted?'#7e9a7c':'#625e45';
        poly(c,[[-14,0],[-5,-55],[-9,-95],[0,-128],[6,-92],[5,-60],[18,0]],wood);
        stroke(c,-1,-68,-31,-110,wood,7);stroke(c,2,-82,30,-121,wood,5);
        for(let j=0;j<5;j++){const xx=-40+j*20,yy=-117-Math.sin(j*.8)*15;
          ellipse(c,xx,yy,30,27,muted?'#9aae87':j%2?'#668a53':'#769758');
          for(let k=0;k<5;k++){const xe=xx-17+k*8,l=20+((j*11+k*19)%40);stroke(c,xe,yy+7,xe+Math.sin(t*1.4+j)*3,yy+l,muted?'#a1b18c':'#779958',2.3);}
        }c.restore();
      }
      function fishArt(c,q){
        if(q.caught)return;
        const flip=Math.cos(t*1.15+q.i)>0?1:-1;
        c.save();c.translate(q.x,q.y);c.scale(flip,1);
        if(q.hidden){if(Math.sin(t*2.6)>.5)stroke(c,-5,-14,4,-14,'#fbd46a',2);c.restore();return;}
        const col=q.i===7?'#f4d05b':'#add5b0';
        poly(c,[[-9,0],[-17,-6],[-16,6]],col);ellipse(c,0,0,12,4.5,col);
        stroke(c,-4,0,5,-2,q.i===7?'#ac8248':'#648f83',1.5);dot(c,7,-1,1.4,'#284e50');
        if(callTime>0&&Math.abs(q.x-p.x)<265){c.strokeStyle='#e0f3bd';c.lineWidth=1.3;c.beginPath();c.ellipse(0,0,20,10,0,0,TAU);c.stroke();}
        c.restore();
      }
      function bird(c){
        const angle=mode==='dive'?Math.atan2(p.vy,Math.abs(p.vx))*.84:mode==='rise'?-.72:clamp(p.vy/650,-.3,.32);
        c.save();c.translate(p.x,p.y);c.scale(face,1);c.rotate(angle);
        poly(c,[[-8,2],[-28,7],[-20,0],[-29,-3],[-7,-4]],'#216477');
        ellipse(c,0,1,14,8,'#d58b4c');poly(c,[[-12,1],[-5,-7],[8,-7],[9,1]],'#287d93');
        const flap=mode==='dive'?5:Math.sin(t*(Math.abs(p.vx)>30?13:7))*10;
        poly(c,[[-8,0],[-14,-13+flap],[-6,-17+flap],[5,-3]],'#21617a');
        stroke(c,-9,-8+flap*.4,-1,-3,'#64b9bc',2);
        dot(c,9,-6,7,'#247788');stroke(c,5,-6,12,-8,'#75c9ca',2);dot(c,12,-6,1.5,'#152f37');
        poly(c,[[14,-7],[31,-6],[15,-3]],'#343c3e');
        if(carried){ellipse(c,22,-3,3.4,6,gold?'#efd35f':'#c0d5ac');poly(c,[[22,1],[18,7],[25,6]],'#9dab88');}
        c.restore();
      }
      function draw(c){
        sky(c,'#9ccfd0','#ffe9b8');fx.shake(c);dot(c,462-cam*.05,68,29,'#ffdf9e');
        for(let i=0;i<12;i++){const x=i*86-(cam*.18)%86-45;ellipse(c,x,211,83,38+(i%3)*8,'#adbb99');}
        for(let i=0;i<9;i++)willow(c,i*122-cam*.31%122,249,.49+(i%3)*.07,true);
        for(let i=-1;i<20;i++){const x=i*41-cam*.42%41;ellipse(c,x,247,31,7+(i*i)%8,i%2?'#87a382':'#91ac88');}
        rect(c,0,water-7,640,7,'#adc394');rect(c,0,water,640,166,'#669e98');
        const deep=c.createLinearGradient(0,water,0,420);deep.addColorStop(0,'#86bab0');deep.addColorStop(1,'#397b7b');rect(c,0,water+3,640,163,deep);
        c.save();c.translate(-cam,0);
        for(let i=0;i<90;i++){const x=(i*107)%W,y=water+5+(i*21)%142;stroke(c,x+Math.sin(t+i)*2,y,x+8+i%4*5,y,'#abcec03d',1.5);}
        for(let i=0;i<24;i++){const x=i*75;
          poly(c,[[x-32,420],[x+11,388+Math.sin(i)*11],[x+33,382+Math.sin(i)*10],[x+69,420]],i%2?'#497d72':'#538473');
          for(let j=0;j<4;j++)stroke(c,x+j*5,411,x+j*6+Math.sin(t*2+i)*4,385-(j*13+i)%26,'#629984',2.5);}
        willow(c,43,water-3,.98);stroke(c,41,178,152,146,'#615e42',9);
        poly(c,[[94,144],[147,142],[140,157],[124,164],[105,157]],'#927850');
        for(let i=0;i<8;i++)stroke(c,98+i*5,147+i%2*4,114+i*4,155-i%2*4,'#c49d67',2);
        for(let i=0;i<3;i++){const x=112+i*10,y=145+(i%2)*3;dot(c,x,y,4.5,'#916747');poly(c,[[x+3,y],[x+7,y-6],[x+7,y]],'#f6bd65');}
        willow(c,1328,water+3,1.18);
        for(let j=0;j<6;j++){c.strokeStyle=j%2?'#637463':'#4f685c';c.lineWidth=5-j*.4;c.beginPath();c.moveTo(1321+j*2,water-12);c.bezierCurveTo(1314-j*3,water+16,1279+j*5,water+17,1274+j*13,water+41+j%2*15);c.stroke();}
        for(const q of fish)fishArt(c,q);
        for(const w of trail)ellipse(c,w.x,w.y,1+w.life*16,1+w.life*11,w.y>water?'#b7e8d7aa':'#f7dea677');
        bird(c);
        if(callTime>0){c.strokeStyle='#fff1c3';c.lineWidth=2;c.beginPath();c.arc(p.x,p.y,15+(1.15-callTime)*31,-.85,.85);c.stroke();}
        if(flash>0){c.strokeStyle='#e9f8d3';c.lineWidth=2;c.beginPath();c.ellipse(p.x,water,14+(1-flash/.3)*19,3,0,0,TAU);c.stroke();}
        fx.draw(c);c.restore();
      }
      status();g.say('Tap a minnow to dive. Bring three back to the nest.');
      return {draw,update,tap,drag(x,y){if(mode==='air'&&y<water-5){wp={x:x+cam,y:clamp(y,44,water-8)};target=null;}},release(){},
        press(k){if(done)return;start();if(k==='b')call();if(k==='a'){
          const options=fish.filter(q=>!q.hidden&&!q.caught&&Math.abs(q.x-p.x)<215);
          const nearest=options.sort((a,b)=>Math.abs(a.x-p.x)-Math.abs(b.x-p.x))[0];
          diveAt(nearest||{x:clamp(p.x+face*64,36,W-36),y:water+62});
        }}};
    }
  });
})();

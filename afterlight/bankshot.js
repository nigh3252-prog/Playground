(() => {
  'use strict';
  const tau = Math.PI * 2;
  const clamp = (v,min,max) => Math.max(min,Math.min(max,v));
  const rounds = [
    [[242,210],[352,210],[463,210]],
    [[220,142],[336,91],[448,140],[235,283],[349,345],[476,303]],
    [[230,209],[349,126],[348,293],[440,80],[446,340],[535,201]],
    [[222,137],[223,281],[350,94],[350,327],[510,210,1]]
  ];
  const green='#cefa65', orange='#ff693e', pink='#ff497b', black='#121c26';
  function disk(c,x,y,r,color){c.fillStyle=color;c.beginPath();c.arc(x,y,r,0,tau);c.fill();}
  function line(c,x,y,xx,yy,color,w){c.strokeStyle=color;c.lineWidth=w;c.beginPath();c.moveTo(x,y);c.lineTo(xx,yy);c.stroke();}
  function block(c,x,y,w,h,color){c.fillStyle=color;c.fillRect(x,y,w,h);}
  function capsule(c,x,y,w,h,r,color){c.fillStyle=color;c.beginPath();c.roundRect(x,y,w,h,r);c.fill();}
  function nearestOnSegment(ax,ay,bx,by,px,py){
    const dx=bx-ax,dy=by-ay;
    const t=clamp(((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy||1),0,1);
    return Math.hypot(px-ax-dx*t,py-ay-dy*t);
  }

  registerGame({
    id:'bankshot',title:'Bankshot',kind:'Remix',genre:'Adventure',best:'Touch',accent:green,
    description:'Punch one robot through a whole row. Bank the loose bots off the rails.',
    controls:'Tap a bot to punch. Drag the green striker to line up a shot. On a controller, move along the rail and press A to punch the marked target. B cycles targets.',
    sources:[['Tap Jab Stamina Melee','Drive','The striker lunges toward the touch and snaps back.'],['Hammer Formation Encounter v4','Drive','Hitting an individual unit breaks it out of a moving formation as a loose body.'],['SLING','PR #35','Launched bodies bank off the rails to clear targets.']],
    create(g){
      const p={x:77,y:210};
      const bits=[],rings=[];
      let bots=[],pegs=[],fist=null,buffer=null,round=0,score=0,hearts=3,shots=0,bestChain=0,age=0;
      let active=false,mode='live',nextIn=0,shake=0,hitstop=0,clock=0,selected=0,dragging=false;
      let padLock=false,dyInput=0,aim={x:242,y:210};
      function spawn(){
        const pattern=rounds[round];
        bots=pattern.map(([x,y,boss],i)=>({x,y,homeY:y,r:boss?31:18,hp:boss?5:1,boss:!!boss,
          vx:0,vy:0,spin:0,angle:0,depth:0,state:'live',flash:0,ttl:0,index:i}));
        pegs=round===1?[[405,208,21]]:round===2?[[332,55,18],[332,365,18],[451,210,21]]:round===3?[[440,58,18],[440,362,18]]:[];
        clock=0;selected=0;fist=null;buffer=null;nextIn=0;padLock=false;
        g.say(round===0?'Tap a robot to punch it.':round===3?'Slam a loose bot into the big one.':'');
        status();
      }
      function status(){g.hud('Pack '+(round+1)+'/4   ·   '+score+' points   ·   '+hearts+' lives'+(bestChain>1?'   ·   '+bestChain+'× chain':''));}
      function burst(x,y,color,count,power){
        for(let i=0;i<count;i++){
          const a=Math.random()*tau, speed=power*(.35+Math.random()*.75);
          bits.push({x,y,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,life:.14+Math.random()*.27,c:color});
        }
      }
      function ring(x,y,color){rings.push({x,y,r:6,life:.21,c:color});}
      function strike(bot,dx,dy,depth){
        if(bot.state!=='live')return;
        bot.hp-=depth>1?3:1;bot.flash=.16;
        burst(bot.x,bot.y,depth>1?green:'#ffc064',depth>1?18:11,240);
        ring(bot.x,bot.y,'#fff4be');shake=Math.max(shake,depth>1?5:3);hitstop=Math.max(hitstop,.018);
        g.impact?.(depth);
        if(depth>1)g.tone(Math.min(730,300+depth*83),.075);
        score+=20*depth;bestChain=Math.max(bestChain,depth);
        if(bot.hp<=0){
          const length=Math.hypot(dx,dy)||1;
          bot.state='loose';bot.depth=depth;bot.vx=dx/length*910;bot.vy=dy/length*910;
          bot.spin=6+depth*2;bot.ttl=1.4;score+=30*depth;
        }
        status();
      }
      function target(){
        const live=bots.filter(b=>b.state==='live');
        if(!live.length)return null;
        if(padLock)return live[selected%live.length];
        return live.reduce((best,b)=>
          Math.abs(b.y-p.y)*2+b.x < Math.abs(best.y-p.y)*2+best.x ? b:best);
      }
      function fire(tx,ty){
        if(mode==='lost'){round=score=shots=bestChain=0;hearts=3;p.y=210;active=false;mode='live';bits.length=rings.length=0;spawn();return;}
        if(mode!=='live'||nextIn)return;
        if(fist){buffer={x:tx,y:ty};return;}
        active=true;shots++;g.say('');
        const dx=Math.max(28,tx-p.x),dy=ty-p.y,len=Math.hypot(dx,dy);
        aim={x:tx,y:ty};
        fist={x:p.x,y:p.y,ux:dx/len,uy:dy/len,d:0,reach:Math.min(615,len+24),back:false,marks:new Set()};
        g.tone(180,.045);burst(p.x+15,p.y,'#cfeb91',5,115);
      }
      function tap(x,y){
        dragging=false;
        if(mode==='lost'){fire(x,y);return;}
        if(x<129){dragging=true;p.y=clamp(y,49,371);padLock=false;return;}
        fire(x,y);
      }
      function press(k){
        if(k==='a'){const t=target()||aim;fire(t.x,t.y);}
        if(k==='b'){const live=bots.filter(b=>b.state==='live');if(live.length){const current=live.indexOf(target());selected=(current+1)%live.length;padLock=true;}}
      }
      function advanceFist(dt){
        const f=fist;if(!f)return;
        const oldX=f.x,oldY=f.y;
        f.d+=dt*(f.back?-2510:2350);
        if(f.d>=f.reach){f.d=f.reach;f.back=true;}
        f.x=p.x+f.ux*Math.max(0,f.d);f.y=p.y+f.uy*Math.max(0,f.d);
        for(const b of bots){
          if(b.state!=='live'||f.marks.has(b)||nearestOnSegment(oldX,oldY,f.x,f.y,b.x,b.y)>b.r+10)continue;
          f.marks.add(b);strike(b,f.ux,f.uy,1);f.back=true;break;
        }
        if(f.d<=0){fist=null;if(buffer){const q=buffer;buffer=null;fire(q.x,q.y);}}
      }
      function moveLoose(b,dt){
        const oldX=b.x,oldY=b.y;b.x+=b.vx*dt;b.y+=b.vy*dt;b.ttl-=dt;b.angle+=b.spin*dt;
        const wall=(axis,low,high,velocity)=>{
          if(b[axis]>=low&&b[axis]<=high)return;
          b[axis]=clamp(b[axis],low,high);b[velocity]*=-.92;
          ring(b.x,b.y,'#70d6cc');g.tone(208,.045);
        };
        wall('y',28+b.r,392-b.r,'vy');wall('x',26+b.r,614-b.r,'vx');
        for(const [px,py,r] of pegs){
          const dx=b.x-px,dy=b.y-py,d=Math.hypot(dx,dy)||1;
          if(d>r+b.r)continue;
          const nx=dx/d,ny=dy/d,dot=b.vx*nx+b.vy*ny;
          b.x=px+nx*(r+b.r+1);b.y=py+ny*(r+b.r+1);
          if(dot<0){b.vx-=2*dot*nx;b.vy-=2*dot*ny;ring(px,py,green);g.tone(355,.05);}
        }
        for(const other of bots){
          if(other.state!=='live'||nearestOnSegment(oldX,oldY,b.x,b.y,other.x,other.y)>b.r+other.r-2)continue;
          const dx=other.x-b.x,dy=other.y-b.y;
          strike(other,b.vx*.88+dx*3,b.vy*.88+dy*3,b.depth+1);
          b.state='gone';burst(b.x,b.y,'#e78060',5,100);return;
        }
        if(b.ttl<=0)b.state='gone';
      }
      function loseLife(b){
        b.state='gone';hearts--;shake=6;burst(b.x,b.y,pink,14,140);g.tone(68,.14);status();
        if(hearts===0){mode='lost';g.say('Tap to play again.');}
      }
      function step(dt){
        const key=dyInput;
        if(key){p.y=clamp(p.y+key*360*dt,49,371);padLock=false;}
        advanceFist(dt);
        for(const b of bots){
          b.flash=Math.max(0,b.flash-dt);
          if(b.state==='loose'){moveLoose(b,dt);continue;}
          if(b.state!=='live'||!active)continue;
          b.x-=(b.boss?12:9+round*3.2)*dt;
          b.y=b.homeY+Math.sin(clock*(round===2?2.8:1.4)+b.index*.36)*(round===0?0:round===2?18:8);
          if(b.x-b.r<76)loseLife(b);
          if(mode==='lost')return;
        }
      }
      function update(dt){
        age+=dt;shake=Math.max(0,shake-dt*22);
        for(let i=bits.length-1;i>=0;i--){const b=bits[i];b.x+=b.vx*dt;b.y+=b.vy*dt;b.vx*=Math.exp(-dt*4);b.vy*=Math.exp(-dt*4);if((b.life-=dt)<=0)bits.splice(i,1);}
        for(let i=rings.length-1;i>=0;i--){rings[i].r+=dt*155;if((rings[i].life-=dt)<=0)rings.splice(i,1);}
        if(mode!=='live')return;
        if(nextIn>0){
          if((nextIn-=dt)<=0){if(++round===rounds.length){round--;mode='won';g.win(score+' points in '+shots+' punches. Longest chain: '+bestChain+'.');}else spawn();}return;
        }
        if(hitstop>0){hitstop-=dt;return;}
        clock+=dt;
        dyInput=+g.held('down')-+g.held('up');
        if(!dyInput)dyInput=+g.held('right')-+g.held('left');
        for(let n=0;n<3&&mode==='live';n++)step(dt/3);
        if(mode==='live'&&bots.every(b=>b.state!=='live')){nextIn=.35;g.tone(680,.09);}
      }
      function botArt(c,b){
        if(b.state==='gone')return;
        const {x,y,r}=b,isBoss=b.boss,loose=b.state==='loose';
        c.save();c.translate(x,y);c.rotate(loose?b.angle:Math.sin(age*4+b.index)*.045);
        const color=b.flash>0?'#fffbd4':isBoss?pink:orange;
        capsule(c,-r-3,-r*.7+5,r*2+6,r*1.54,7,'#07171e');
        for(const side of [-1,1]){capsule(c,-r*.7,side*r*.72-4,r*1.45,8,3,'#10151c');block(c,-r*.3,side*r*.72-3,7,6,'#ced4be');}
        capsule(c,-r-2,-r*.72,r*2+4,r*1.46,6,black);capsule(c,-r,-r*.74,r*2,r*1.35,5,color);
        block(c,-r+4,-r*.4,r*.42,r*.79,'#351e2b');block(c,-r+4,-r*.27,4,3,'#ffedb8');
        line(c,-r*.55,-r*.76,-r*.28,-r*1.08,'#13252d',2);disk(c,-r*.25,-r*1.1,2.8,'#ffe28e');
        for(let i=-1;i<=1;i++)block(c,i*6-3,r*.79,3,3,'#9baaa5');
        block(c,2,-r*.42,r*.61,3,'#ffbf81');block(c,3,-r*.05,r*.46,3,'#732e39');
        if(isBoss){for(let j=0;j<5;j++)block(c,-r+2+j*11,r*.45,8,4,j<b.hp?'#fff3ce':'#47253a');}
        c.restore();
      }
      function draw(c){
        c.save();block(c,0,0,640,420,'#09181c');
        if(shake)c.translate(Math.sin(age*150)*shake,Math.cos(age*105)*shake*.6);
        capsule(c,17,18,606,384,24,'#657a72');capsule(c,21,22,598,376,21,'#1d3439');
        const paint=c.createLinearGradient(0,0,625,420);paint.addColorStop(0,'#24484c');paint.addColorStop(1,'#124047');
        capsule(c,26,28,588,364,16,paint);
        for(let x=43;x<610;x+=28)for(let y=44;y<389;y+=28)disk(c,x,y,1,'#437074');
        for(let x=40;x<606;x+=28){block(c,x,20,14,3,'#91a7a0');block(c,x,397,14,3,'#91a7a0');}
        for(let y=50;y<383;y+=21){line(c,607,y,612,y-5,'#72928b',2);line(c,32,y,37,y-5,'#72928b',2);}
        for(let x=312;x<600;x+=87){c.strokeStyle='#447074';c.lineWidth=2;c.beginPath();c.arc(x,210,48,-.95,.95);c.stroke();}
        c.setLineDash([6,10]);line(c,95,37,95,384,'#9ba97d',2);c.setLineDash([]);
        for(const [x,y,r] of pegs){disk(c,x,y+3,r+2,'#0c2428');disk(c,x,y,r,'#89ddbd');disk(c,x,y,r-5,'#274947');disk(c,x,y,r*.32,green);}
        const t=target();
        if(t&&!fist&&mode==='live'){
          const pulse=.5+.5*Math.sin(age*5);c.setLineDash([3,10]);line(c,p.x+15,p.y,t.x-t.r,t.y,'#a5d99888',2);c.setLineDash([]);
          c.strokeStyle=green;c.lineWidth=2;
          for(let i=0;i<4;i++){c.beginPath();c.arc(t.x,t.y,t.r+6+pulse*3,i*Math.PI/2+.12,i*Math.PI/2+.64);c.stroke();}
        }
        for(const b of bots){
          if(b.state==='loose')line(c,b.x-b.vx*.04,b.y-b.vy*.04,b.x,b.y,'#ffad4e99',b.r*1.2);
          botArt(c,b);
        }
        const slide=fist?Math.min(28,fist.d*.3):0;
        capsule(c,p.x-29+slide,p.y-15,49,33,9,'#102023');capsule(c,p.x-26+slide,p.y-18,44,30,8,green);
        line(c,p.x-29+slide,p.y-5,p.x-39+slide,p.y-5,'#83aea5',4);line(c,p.x-29+slide,p.y+6,p.x-36+slide,p.y+6,'#83aea5',4);
        block(c,p.x-17+slide,p.y-10,15,6,'#567258');block(c,p.x-5+slide,p.y+3,15,3,'#66865e');
        const fx=fist?fist.x:p.x+26,fy=fist?fist.y:p.y;
        line(c,p.x+8+slide,p.y,fx,fy,'#122d32',8);c.setLineDash([5,4]);line(c,p.x+8+slide,p.y,fx,fy,'#bbd0b7',4);c.setLineDash([]);
        c.save();c.translate(fx,fy);c.rotate(fist?Math.atan2(fist.uy,fist.ux):0);
        capsule(c,-9,-12,24,25,5,'#132928');capsule(c,-8,-13,22,21,5,'#d5fb68');for(let j=0;j<3;j++)capsule(c,6,-11+j*7,11,6,3,'#f4ffaf');
        capsule(c,-8,-17,13,7,3,'#a5cd42');c.restore();
        for(const b of bits){c.globalAlpha=Math.min(1,b.life*7);line(c,b.x,b.y,b.x-b.vx*.022,b.y-b.vy*.022,b.c,3);}
        for(const b of rings){c.globalAlpha=clamp(b.life*5,0,1);c.strokeStyle=b.c;c.lineWidth=3;c.beginPath();c.arc(b.x,b.y,b.r,0,tau);c.stroke();}
        c.globalAlpha=1;
        if(mode==='lost'){block(c,0,0,640,420,'#08171eb8');disk(c,320,210,40,green);c.fillStyle=black;c.beginPath();c.moveTo(310,189);c.lineTo(339,210);c.lineTo(310,231);c.fill();}
        c.restore();
      }
      spawn();
      return {draw,update,press,tap,drag(x,y){if(dragging)p.y=clamp(y,49,371);},release(){dragging=false;}};
    }
  });
})();

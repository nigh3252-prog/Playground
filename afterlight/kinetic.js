(() => {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
  const mix = (a,b,t) => a+(b-a)*t;
  const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
  const point = (x,y) => ({x,y});
  const source = (n,pr,how) => [n,'PR #'+pr,how];
  const color = (c,col) => { c.fillStyle=col; };
  function box(c,x,y,w,h,col){color(c,col);c.fillRect(x,y,w,h);}
  function dot(c,x,y,r,col){color(c,col);c.beginPath();c.arc(x,y,r,0,TAU);c.fill();}
  function oval(c,x,y,rx,ry,col,angle=0){color(c,col);c.beginPath();c.ellipse(x,y,rx,ry,angle,0,TAU);c.fill();}
  function line(c,pts,col,w=2,dash=[]){
    c.save();c.beginPath();c.strokeStyle=col;c.lineWidth=w;c.lineCap='round';c.lineJoin='round';c.setLineDash(dash);
    pts.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.stroke();c.restore();
  }
  function shape(c,p,col){color(c,col);c.beginPath();p.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fill();}
  function label(c,s,x,y,col,size=12,align='left'){
    c.save();c.font='700 '+size+'px system-ui,sans-serif';c.textAlign=align;c.fillStyle=col;c.fillText(s,x,y);c.restore();
  }
  function ring(c,x,y,r,col,w=2){c.beginPath();c.strokeStyle=col;c.lineWidth=w;c.arc(x,y,r,0,TAU);c.stroke();}
  function sparkles(){
    let pieces=[];
    return {pop(x,y,col,n=10,power=100){for(let i=0;i<n;i++){const a=TAU*(i+.23)/n,v=power*(.48+(i*7%11)/16);
      pieces.push({x,y,vx:v*Math.cos(a),vy:v*Math.sin(a)-18,t:.34+(i%4)*.07,col});}},
      tick(dt){for(const p of pieces){p.t-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=170*dt;}pieces=pieces.filter(p=>p.t>0);},
      draw(c){pieces.forEach(p=>box(c,p.x,p.y,2+3*p.t,2+3*p.t,p.col));}};
  }
  const setHint=(g,s)=>g.say?.(s);

  // Each excavated vent adds a lava bumper. The blue geode gives every later shot a twin.
  registerGame({id:'carom-quarry',title:'Magma Marble',buttons:{a:'Fire',b:'Recall'},genre:'Puzzle',kind:'Remix',accent:'#ff8648',best:'Either',
    description:'Punch through the basalt with a pinball drill. Three hot springs are trying to reach the surface.',
    controls:'Tap or drag to aim and fire. Bank off the marked wall to crack the silver cap. Left/right select a seam or bank. A fires. B recalls the drill.',
    sources:[source('Sling',35,'Launch a marble and bank it off the crater walls.'),source('Bumper Crypt',34,'Living vent bumpers kick the ball back into the rock.'),source('Mole Mech',34,'Drill through seams to uncover an upgrade inside a blue geode.')],
    create(g){
      const origin=point(320,357), bankMark=point(608,203), dust=sparkles();
      const marks=[[125,124],[284,85],[470,129],[540,238],[188,228],[372,190],[72,221],[390,65]];
      const seams=marks.map(([x,y],i)=>({x,y,i,r:i===3?23:34+(i%3)*3,hp:i===3?1:i<3?2:1,flash:0}));
      let balls=[],springs=0,twins=false,age=0,finish=0,ended=false,selected=1,aim=seams[selected],dragging=false,dragMoved=false;
      const status=()=>g.hud(springs+' / 3 hot springs'+(twins?'   ·   Twin drill':''));
      setHint(g,'Shoot the orange cracks.');status();
      function fire(x,y){
        if(ended||finish)return;
        const dx=x-origin.x,dy=Math.min(-25,y-origin.y),len=Math.hypot(dx,dy);
        const a=Math.atan2(dy/len,dx/len);
        balls=(twins?[a-.07,a+.07]:[a]).map(angle=>({x:origin.x,y:origin.y,vx:Math.cos(angle)*570,vy:Math.sin(angle)*570,life:2.4,tail:[],last:-1,lock:0,banks:0}));
        g.tone(250,.055);setHint(g,'');dust.pop(origin.x,origin.y,'#ffd880',5,53);
      }
      function chip(s,b){
        if(s.hp>0){
          if(s.i===2&&!b.banks){s.flash=.13;dust.pop(b.x,b.y,'#b6d4ce',8,80);g.tone(170,.06);setHint(g,'Silver cap. Bank off the marked right wall.');return;}
          s.hp--;s.flash=.17;dust.pop(s.x,s.y,s.i===3?'#68e5ed':'#ffb364',s.hp?10:19,s.hp?80:148);g.impact?.(1);
          if(!s.hp&&s.i<3){springs++;g.tone(340+springs*105,.13);if(springs===3)finish=.95;}
          else if(!s.hp&&s.i===3){twins=true;setHint(g,'Blue geode! Two marbles per shot.');g.tone(860,.11);}
          else g.tone(s.hp?224:308,.05);
          if(!s.hp&&aim===s){const next=seams.find(v=>v.hp&&v.i<3)||seams.find(v=>v.hp);if(next)aim=next;}
          status();
        }else{dust.pop(b.x,b.y,'#ff783a',7,76);g.tone(450,.04);}
      }
      function moveBall(b,dt){
        b.life-=dt;b.lock-=dt;
        b.x+=b.vx*dt;b.y+=b.vy*dt;
        if(b.x<32||b.x>608){b.x=clamp(b.x,32,608);b.vx*=-1;b.banks++;dust.pop(b.x,b.y,'#e6d09d',4,38);}
        if(b.y<35){b.y=35;b.vy=Math.abs(b.vy);b.banks++;}if(b.y>381)b.life=0;
        for(const s of seams){
          if(!s.hp&&s.i>=3)continue;
          const r=s.hp?s.r:17,L=distance(b,s);
          if(L>=r+7||(!L)||(b.last===s.i&&b.lock>0))continue;
          const nx=(b.x-s.x)/L,ny=(b.y-s.y)/L,v=b.vx*nx+b.vy*ny;
          if(v>=0)continue;
          chip(s,b);b.vx-=2*v*nx;b.vy-=2*v*ny;b.x=s.x+nx*(r+7.5);b.y=s.y+ny*(r+7.5);
          b.last=s.i;b.lock=.07;break;
        }
      }
      function select(step){
        const live=seams.filter(s=>s.hp);if(seams[2].hp)live.splice(live.indexOf(seams[2])+1,0,bankMark);if(!live.length)return;
        selected=(live.indexOf(aim)+step+live.length)%live.length;aim=live[selected];
      }
      function shootAt(x,y){aim=distance(bankMark,point(x,y))<23?bankMark:point(x,y);fire(aim.x,aim.y);}
      return {tap(x,y){dragging=true;shootAt(x,y);},drag(x,y){if(distance(aim,point(x,y))>3)dragMoved=true;aim=point(x,y);},release(){if(dragging&&balls.length&&distance(aim,origin)>40&&dragMoved)fire(aim.x,aim.y);dragging=false;dragMoved=false;},
        press(k){if(k==='a')fire(aim.x,aim.y);if(k==='b'){balls=[];setHint(g,'Pick a new seam.');}if(k==='left'||k==='up')select(-1);if(k==='right'||k==='down')select(1);},
        update(dt){age+=dt;dust.tick(dt);for(const s of seams)s.flash=Math.max(0,s.flash-dt);
          for(const b of balls){b.tail.push([b.x,b.y]);if(b.tail.length>6)b.tail.shift();for(let i=0;i<4;i++)moveBall(b,dt/4);}
          balls=balls.filter(b=>b.life>0);
          if(finish>0){finish-=dt;if(finish<=0&&!ended){ended=true;g.win('Three hot springs broke through the crater.');}}},
        draw(c){
          box(c,0,0,640,420,'#251c26');
          for(let j=0;j<3;j++){
            const ridge=[],bottom=270+j*43;
            for(let x=0;x<=640;x+=20)ridge.push([x,bottom+Math.sin(x*.026+j*1.7)*19+Math.cos(x*.062-j)*8]);
            shape(c,[[0,420],...ridge,[640,420]],['#33252e','#422b32','#583137'][j]);
            line(c,ridge,['#48303c','#52333c','#723f3e'][j],2);
          }
          for(let i=0;i<12;i++){let y=21+i*32;line(c,[[0,y+14],[92,y-4],[208,y+13],[310,y-7],[436,y+12],[554,y-6],[640,y+3]],i%3?'#342833':'#46323b',3);}
          shape(c,[[0,0],[29,0],[21,80],[29,153],[24,322],[46,396],[0,420]],'#67505a');
          shape(c,[[640,0],[608,0],[619,101],[612,202],[616,320],[590,390],[640,420]],'#67505a');
          for(const s of seams){
            if(!s.hp&&s.i<3){const wave=Math.sin(age*4+s.i)*3;
              line(c,[[s.x,s.y+6],[s.x+7,s.y+56],[s.x-5,s.y+87],[s.x+15,339],[s.x+34,396]],'#74392d',15);
              line(c,[[s.x,s.y+6],[s.x+7,s.y+56],[s.x-5,s.y+87],[s.x+15,339],[s.x+34,396]],'#f47a36',6);
              oval(c,s.x,s.y+3,22,15,'#ad422b');oval(c,s.x,s.y+wave,16,10,'#ffb346');dot(c,s.x-4,s.y-8+wave,5,'#ffe4a0');
              for(let k=0;k<3;k++){let t=(age*.9+k*.33)%1;dot(c,s.x+(k-1)*6,s.y-15-t*30,3*(1-t)+.5,'#ffca72');}continue;}
            if(!s.hp)continue;
            const pts=Array.from({length:9},(_,j)=>{const t=TAU*j/9+s.i*.43,r=s.r*(.87+(j*3%5)*.044);return [s.x+Math.cos(t)*r,s.y+Math.sin(t)*r];});
            shape(c,pts.map(([x,y])=>[x+2,y+6]),'#151820');shape(c,pts,s.flash?'#ffe1a2':s.i===3?'#30758c':s.i<3?'#71505a':'#4c4856');
            shape(c,[pts[0],pts[1],pts[2],[s.x+2,s.y+5]],s.i===3?'#3f8e9b':s.i<3?'#815a59':'#5d5361');
            shape(c,[pts[4],pts[5],pts[6],[s.x-5,s.y-8]],s.i===3?'#37798c':s.i<3?'#63434c':'#484350');
            line(c,pts.slice(4,8),s.i===3?'#76e9ec':'#96757b',2);
            const glow=s.i===3?'#8afffa':s.i<3?'#ffab5c':'#867987';
            line(c,[[s.x-13,s.y-17],[s.x-2,s.y-6],[s.x-8,s.y+3],[s.x+6,s.y+8],[s.x+3,s.y+20]],glow,s.hp===1&&s.i<3?5:3);
            if(s.i===2){line(c,[[s.x-28,s.y+16],[s.x-16,s.y+29],[s.x+3,s.y+34],[s.x+23,s.y+25]],'#b5c5bd',4);dot(c,s.x-16,s.y+29,2,'#eff0d7');}
            if(s.i<3)line(c,[[s.x-4,s.y],[s.x+7,s.y-4],[s.x+15,s.y-11]],glow,2);
          }
          const lava=[];for(let i=0;i<=64;i++){const x=i*10;lava.push([x,390+Math.sin(age*2+x*.035)*2+Math.sin(x*.06)*2]);}
          shape(c,[...lava,[640,420],[0,420]],'#d75a33');line(c,lava,'#f1964c',3);
          for(let i=0;i<15;i++){const x=(i*71+age*(3+i%3))%670-14,y=398+i*13%22;line(c,[[x,y],[x+9,y-1],[x+16,y]],i%3?'#ee8040':'#feb45b',2);}
          for(let j=0;j<2;j++){const px=j?609:24;for(let i=0;i<7;i++){const x=px+(j?-1:1)*(i*11%48),y=360+(i*17%28);
            shape(c,[[x-6,y+17],[x-8,y-6],[x-4,y-13-i%4*3],[x+3,y-14],[x+8,y-8],[x+7,y+16]],i%2?'#71434a':'#62414c');line(c,[[x-4,y-11],[x-2,y+10]],'#8e5957',1.5);}}
          
          if(seams[2].hp){ring(c,bankMark.x,bankMark.y,11,'#b6c8b9',2);line(c,[[bankMark.x-7,bankMark.y+5],[bankMark.x+1,bankMark.y],[bankMark.x-7,bankMark.y-5]],'#e8e7bd',2);}
          if(seams.includes(aim)||aim===bankMark){
            const r=aim.r?aim.r+5:16;
            for(let i=0;i<4;i++){const t=i*Math.PI/2+.35;line(c,[[aim.x+Math.cos(t)*r,aim.y+Math.sin(t)*r],[aim.x+Math.cos(t+.12)*(r+1),aim.y+Math.sin(t+.12)*(r+1)],[aim.x+Math.cos(t+.24)*r,aim.y+Math.sin(t+.24)*r]],'#e6d9a7',2);}
          }
          const a=Math.atan2(Math.min(-25,aim.y-origin.y),aim.x-origin.x);
          line(c,[[origin.x,origin.y],[origin.x+Math.cos(a)*82,origin.y+Math.sin(a)*82]],'#d0abab',2,[2,7]);
          c.save();c.translate(origin.x,origin.y);c.rotate(a);box(c,-13,-13,47,26,'#263641');box(c,-6,-8,42,16,'#839697');box(c,22,-11,11,22,'#f3bd75');c.restore();
          oval(c,origin.x,origin.y+13,35,10,'#1d2229');dot(c,origin.x,origin.y,14,'#475665');dot(c,origin.x,origin.y,7,'#f0c376');
          for(const b of balls){line(c,b.tail,'#ff9e57',4);dot(c,b.x,b.y,7,'#ffe0a2');dot(c,b.x-2,b.y-2,3,'#fff9e5');}
          dust.draw(c);label(c,'HOT SPRINGS',41,26,'#e6b7a1',10);for(let i=0;i<3;i++)dot(c,126+i*13,22,4,i<springs?'#ffae53':'#70535a');
        }};
    }});

  const fruitColors=['#eb624d','#9a78ce','#e8b746','#98c9b6'];
  const trackY=[88,148,221,281],forks=[point(129,199),point(255,119),point(255,252)];
  function routeFor(n){
    const y=trackY[n],fork=forks[n<2?1:2];
    return [[54,199],[129,199],[205,fork.y],[255,fork.y],[303,y],[406,y],[457,Math.round((y+199)/2)],[511,199],[566,199],[591,222],[591,317],[564,348],[81,348],[48,320],[48,224],[54,199]];
  }
  function rails(c,path){
    line(c,path,'#586456',8);
    for(let i=1;i<path.length;i++){
      const [a,b]=path[i-1],[x,y]=path[i],d=Math.hypot(x-a,y-b);
      for(let t=3;t<d;t+=13){const px=mix(a,x,t/d),py=mix(b,y,t/d),nx=-(y-b)/d*6,ny=(x-a)/d*6;line(c,[[px-nx,py-ny],[px+nx,py+ny]],'#716854',3);}
    }
    line(c,path,'#c0b7a1',4);line(c,path,'#59645c',1.5);
  }
  function orchardFruit(c,x,y,i,r=7){
    if(i===3){ring(c,x,y,r,'#aaf2dc',3);line(c,[[x,y],[x+r+4,y-4],[x+r+4,y-9]],'#436b5a',2);return;}
    oval(c,x,y,r*(i===2?.77:1),r,fruitColors[i],i===2?.2:0);dot(c,x-2,y-2,Math.max(1,r*.22),'#ffe3a8');line(c,[[x,y-r+2],[x+2,y-r-3]],'#59422c',2);oval(c,x+4,y-r-2,4,2,'#5e8546',-.35);
  }
  registerGame({id:'rail-foundry',title:'Jam Tram',buttons:{a:'Switch',b:'Whistle'},genre:'Puzzle',kind:'Remix',accent:'#ffc45e',best:'Either',
    description:'Throw the orchard switches and tow three fruit wagons to the jam kitchen. A fourth siding holds a winding key.',
    controls:'Tap a lever to flip it, or a siding to route there. Drag between sidings to change the route. Pad arrows choose a lever, A flips it, B blows the speed whistle.',
    sources:[source('Magnet',35,'Pull the steel wagon off its siding with a magnetic coupling.'),source('Salvage Tug',34,'Tow a spring-mounted cargo car behind your engine.'),source('Runaway Express',34,'Detach the last car from the moving train at the unloading platform.')],
    create(g){
      let bits=[0,0,0],focus=0,seg=0,dist=0,path=routeFor(0),route=0,age=0,whistle=0,delivered=new Set(),load=-1,coupled=null,windup=false,ended=false,finish=0,active=false;
      const engine={x:54,y:199,a:0},dust=sparkles(),freight=Array.from({length:4},(_,i)=>point(357,trackY[i]-18));
      function status(){g.hud(delivered.size+' / 3 fruit wagons'+(windup?'   ·   Winding key fitted':''));}
      status();setHint(g,'Tap a fruit siding to send the tram.');
      function routeTo(n){bits[0]=n<2?0:1;bits[n<2?1:2]=n%2;focus=n<2?1:2;active=true;setHint(g,'');}
      function flip(i){bits[i]^=1;active=true;g.tone(290+i*80,.05);setHint(g,'');}
      function pick(x,y){
        for(let i=0;i<3;i++)if(distance(forks[i],point(x,y))<22){focus=i;flip(i);return;}
        if(x>275&&x<448&&y>46&&y<310){let n=0;for(let i=1;i<4;i++)if(Math.abs(y-trackY[i])<Math.abs(y-trackY[n]))n=i;routeTo(n);g.tone(310+n*55,.04);return;}
        active=true;whistle=1.25;g.tone(790,.1);
      }
      function currentSegment(){
        // Once the front wheels pass a switch the choice stays latched for this pass.
        if(seg===1){route=bits[0]*2+bits[bits[0]+1];path=routeFor(route);}
        if(seg===3){route=(route<2?0:2)+bits[route<2?1:2];path=routeFor(route);}
      }
      function station(){
        if(load<0)return;
        const item=load;load=-1;coupled=null;dust.pop(531,177,fruitColors[item],17,86);
        if(item===3){windup=true;setHint(g,'Winding key fitted. The tram runs faster.');}
        else delivered.add(item);
        g.tone(530+item*77,.11);status();
        if(delivered.size===3)finish=.68;
      }
      function step(dt){
        let rem=dt*(windup?237:190)*(whistle>0?1.8:1);
        while(rem>0){
          const [ax,ay]=path[seg],[bx,by]=path[seg+1],L=Math.hypot(bx-ax,by-ay),step=Math.min(L-dist,rem);
          dist+=step;rem-=step;engine.x=mix(ax,bx,dist/L);engine.y=mix(ay,by,dist/L);engine.a=Math.atan2(by-ay,bx-ax);
          if(seg===4&&load<0&&engine.x>322&&!delivered.has(route)&&!(route===3&&windup)){
            load=route;coupled={...freight[route],vx:0,vy:0};dust.pop(coupled.x,coupled.y,'#f6f0bd',7,54);g.tone(390,.05);
          }
          if(seg===7&&engine.x>=525&&load>=0)station();
          if(dist>=L-.0001){dist=0;seg=(seg+1)%(path.length-1);currentSegment();}
        }
        if(coupled){
          const tx=engine.x-24*Math.cos(engine.a),ty=engine.y-24*Math.sin(engine.a);
          for(let n=0;n<3;n++){const h=dt/3;coupled.vx+=((tx-coupled.x)*220-coupled.vx*22)*h;coupled.vy+=((ty-coupled.y)*220-coupled.vy*22)*h;coupled.x+=coupled.vx*h;coupled.y+=coupled.vy*h;}
        }
      }
      function cart(c,x,y,n){c.save();c.translate(x,y);c.scale(1.22,1.22);x=0;y=0;box(c,x-11,y-6,22,10,'#865e42');for(let j=0;j<3;j++)orchardFruit(c,x-6+j*6,y-7-(j%2)*3,n,4);line(c,[[x-11,y-1],[x+11,y-1]],'#c09363',2);dot(c,x-7,y+5,3,'#283930');dot(c,x+7,y+5,3,'#283930');c.restore();}
      return {tap:pick,drag(x,y){if(x>299&&x<438&&y>59&&y<300){let n=trackY.reduce((a,b,i)=>Math.abs(y-b)<Math.abs(y-trackY[a])?i:a,0);routeTo(n);}},
        press(k){if(k==='left'||k==='up')focus=(focus+2)%3;if(k==='right'||k==='down')focus=(focus+1)%3;if(k==='a')flip(focus);if(k==='b'){active=true;whistle=1.35;g.tone(800,.12);}},
        update(dt){age+=dt;dust.tick(dt);whistle=Math.max(0,whistle-dt);if(active&&!ended)step(dt);if(finish>0){finish-=dt;if(finish<=0&&!ended){ended=true;g.win('Apple, plum and pear jam are cooling on the windowsill.');}}},
        draw(c){
          box(c,0,0,640,420,'#d5d9a1');
          for(let i=0;i<10;i++)oval(c,i*77-9,411,98,45+i%3*4,i%2?'#9abd82':'#a6c48a');
          for(let i=0;i<60;i++){const x=(i*79+19)%641,y=(i*i*11+43)%413;line(c,[[x-2,y-2],[x,y],[x+2,y-3]],'#b4bd88',1.5);}
          for(let i=0;i<11;i++){const x=12+i*61+(i%3)*5,y=36+(i%3)*5;oval(c,x+4,y+9,13,4,'#bcc38f');box(c,x-2,y-6,5,15,'#847154');oval(c,x,y-9,13,15,'#8ba76f');dot(c,x-6,y-9,8,'#a1b77e');for(let j=0;j<4;j++)dot(c,x-8+j*5,y-7-(j*5%11),2,i%3===1?'#c78e6d':'#b3c379');}
          for(let i=0;i<4;i++)rails(c,routeFor(i).slice(1,8));
          rails(c,[[54,199],[129,199]]);rails(c,routeFor(0).slice(7));line(c,routeFor(bits[0]*2+bits[bits[0]+1]).slice(1,6),'#dd9d3b',2);
          for(let i=0;i<4;i++){if(delivered.has(i)||(windup&&i===3)||load===i)continue;
            cart(c,freight[i].x,freight[i].y,i);line(c,[[326,trackY[i]-17],[343,trackY[i]-17]],'#a1a083',2,[1,4]);}
          for(let i=0;i<3;i++){
            const f=forks[i],dy=bits[i]?10:-10;
            if(i===focus)ring(c,f.x,f.y,15,'#ffed9c',3);
            dot(c,f.x,f.y,8,'#3f5648');line(c,[[f.x,f.y],[f.x+7,f.y+dy]],'#4b5445',4);dot(c,f.x+7,f.y+dy,5,'#e77b49');
          }
          box(c,486,106,82,65,'#f2dab0');box(c,482,163,90,10,'#716758');
          shape(c,[[477,111],[500,85],[555,85],[577,111]],'#b85b49');box(c,550,69,11,28,'#ae755d');
          label(c,'JAM',528,138,'#955747',14,'center');
          for(let i=0;i<3;i++){box(c,501+i*18,145,12,12,delivered.has(i)?fruitColors[i]:'#cbbd9b');box(c,500+i*18,143,14,3,'#726953');}
          if(coupled){line(c,[[engine.x,engine.y],[coupled.x,coupled.y]],'#465b50',3);cart(c,coupled.x,coupled.y,load);}
          c.save();c.translate(engine.x,engine.y);c.rotate(engine.a);box(c,-14,-8,26,16,'#345d53');box(c,-12,-10,10,19,'#e8b650');box(c,-15,-11,14,3,'#7d543e');box(c,2,-6,9,12,'#d56743');dot(c,11,0,4,'#f8e6aa');for(const x of [-8,7])for(const y of [-8,8])dot(c,x,y,2.4,'#35453f');c.restore();
          if(active){for(let i=0;i<3;i++){const t=(age*1.3+i*.34)%1;oval(c,engine.x-6-t*11,engine.y-13-t*18,2+t*4,2+t*3,'#f2ebce');}}
          dust.draw(c);label(c,'ORCHARD LOOP',33,392,'#4f654e',11);for(let i=0;i<3;i++){orchardFruit(c,470+i*49,391,i,8);if(delivered.has(i))label(c,'✓',483+i*49,396,'#48643d',15);}
        }};
    }});

  function fractionOnLine(a,b,p){
    const dx=b.x-a.x,dy=b.y-a.y;
    return clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1),0,1);
  }
  function scissors(c,x,y,a,age){
    c.save();c.translate(x,y);c.rotate(a);const spread=4+Math.sin(age*18)*2;
    shape(c,[[-4,-2],[19,-spread],[7,1],[-4,3]],'#e9e6de');shape(c,[[-4,2],[21,spread],[6,-1],[-4,-3]],'#a6c1c0');
    ring(c,-8,-5,5,'#ed7955',3);ring(c,-8,5,5,'#ed7955',3);dot(c,0,0,2.5,'#554543');c.restore();
  }
  registerGame({id:'afterimage-loom',title:'Snipline',buttons:{a:'Zip',b:'Recall'},genre:'Puzzle',kind:'Remix',accent:'#ef9279',best:'Either',
    description:'Zip a pair of scissors between brass eyelets. Cut the four knots holding a quilted whale to its hoop.',
    controls:'Tap an eyelet or drag from the scissors to zip. Pad arrows choose an eyelet. A zips and B recalls the last throw.',
    sources:[source('Hookshot',35,'Latch onto a distant eyelet and pull the tool to it.'),source('Tether',35,'Sweep the taut line through a knotted target to cut it.'),source('Spearbound',34,'Recall the thrown tool to its last anchor.')],
    create(g){
      const pins=[[101,292],[137,95],[317,67],[521,105],[551,300],[307,343],[318,206]].map(([x,y])=>point(x,y));
      const cuts=[[0,2,'#ef985e'],[2,4,'#f2c454'],[4,0,'#8ccbc5'],[1,4,'#e799a1']].map(([a,b,col],i)=>{
        const t=[.54,.52,.51,.6][i];return {x:mix(pins[a].x,pins[b].x,t),y:mix(pins[a].y,pins[b].y,t),col,done:false,reel:0,side:i%2?1:-1};});
      const charm={x:mix(pins[1].x,pins[5].x,.49),y:mix(pins[1].y,pins[5].y,.49)},fx=sparkles();
      let cur=0,last=0,sel=2,pos={...pins[0]},from={...pos},flight=null,age=0,unlocked=false,won=false,finish=0,dragging=false,pointer=point(0,0),heading=-.8;
      function status(){g.hud(cuts.filter(s=>s.done).length+' / 4 knots cut'+(unlocked?'   ·   Middle eyelet open':''));}
      status();setHint(g,'Zip across the striped knots.');
      function target(x,y){
        return pins.slice(0,unlocked?7:6).reduce((best,p,i)=>distance(p,point(x,y))<distance(pins[best],point(x,y))?i:best,0);
      }
      function zip(i){
        if(i===cur||flight||won||finish)return;
        last=cur;cur=i;from={...pos};flight={to:pins[i],t:0,span:distance(pos,pins[i])/750};heading=Math.atan2(pins[i].y-pos.y,pins[i].x-pos.x);
        setHint(g,'');g.tone(375,.045);sel=i;
      }
      function hit(a,b,p,r){
        const t=fractionOnLine(a,b,p);
        return Math.hypot(mix(a.x,b.x,t)-p.x,mix(a.y,b.y,t)-p.y)<r;
      }
      function whale(c,x,y){
        c.save();c.translate(x,y);c.rotate(Math.sin(age*2)*.014);
        shape(c,[[38,12],[75,-8],[83,-39],[99,-20],[123,-29],[119,-5],[93,2],[65,30]],'#6b9baf');
        oval(c,-4,6,90,44,'#719eae',-.08);
        shape(c,[[-45,-33],[-14,-37],[17,-27],[1,25],[-29,35],[-49,10]],'#80adb5');
        shape(c,[[-88,12],[-48,17],[-20,37],[6,43],[-48,42],[-79,28]],'#c5c5b3');
        line(c,[[-46,-32],[-48,10],[-23,34]],'#e2d9c9',2,[3,5]);
        line(c,[[-87,12],[-48,17],[-24,35]],'#e2d9c9',2,[3,5]);
        oval(c,-10,29,24,9,'#558398',.32);dot(c,-58,-3,4,'#293d51');dot(c,-59,-4,1.2,'#fff1d0');c.restore();
      }
      return {tap(x,y){pointer=point(x,y);dragging=distance(pos,pointer)<35;if(!dragging)zip(target(x,y));},
        drag(x,y){if(dragging){pointer=point(x,y);sel=target(x,y);}},release(){if(dragging&&distance(pos,pointer)>35)zip(sel);dragging=false;},
        press(k){if(k==='a')zip(sel);else if(k==='b')zip(last);else if(['left','right','up','down'].includes(k)){
          const n=unlocked?7:6,sign=k==='left'||k==='up'?-1:1;do{sel=(sel+sign+n)%n;}while(sel===cur);}},
        update(dt){
          age+=dt;fx.tick(dt);for(const t of cuts)if(t.done)t.reel=Math.min(1,t.reel+dt*1.9);
          if(flight){
            const prev={...pos};flight.t+=dt;const t=Math.min(1,flight.t/flight.span);
            pos={x:mix(from.x,flight.to.x,t),y:mix(from.y,flight.to.y,t)};
            for(const k of cuts){if(k.done||!hit(prev,pos,k,17))continue;k.done=true;fx.pop(k.x,k.y,k.col,16,100);g.tone(510+80*cuts.filter(s=>s.done).length,.07);g.impact?.(1);status();}
            if(!unlocked&&hit(prev,pos,charm,15)){unlocked=true;fx.pop(charm.x,charm.y,'#fbe8b4',17,100);setHint(g,'A hidden eyelet popped open.');status();}
            if(t===1){flight=null;sel=(cur+2)%(unlocked?7:6);if(cuts.every(s=>s.done)&&!finish&&!won)finish=1.5;}
          }
          if(finish>0){finish-=dt;if(finish<=0&&!won){won=true;g.win('The patchwork whale swam off the quilt.');}}
        },
        draw(c){
          box(c,0,0,640,420,'#414052');
          for(let x=0;x<640;x+=8)line(c,[[x,0],[x,420]],'#464555',1);
          for(let y=0;y<420;y+=9)line(c,[[0,y],[640,y]],'#4b4758',1);
          oval(c,319,210,289,191,'#6b4b4c');oval(c,319,205,286,189,'#c99571');oval(c,319,205,277,181,'#93705f');oval(c,319,205,273,177,'#435b69');
          c.save();c.beginPath();c.ellipse(319,205,271,175,0,0,TAU);c.clip();
          for(let y=47;y<385;y+=13)for(let x=45;x<613;x+=24){let xx=x+(y%2)*11;line(c,[[xx,y],[xx+8,y+1]],'#526c78',1);}
          for(let j=0;j<3;j++){const wave=[];for(let x=34;x<617;x+=8)wave.push([x,245+j*38+Math.sin(x*.043+j*2)*5]);line(c,wave,'#607a86',2,[6,6]);}
          const swim=finish?Math.pow(1-finish/1.5,2)*330:0;whale(c,314+swim,212-cuts.filter(k=>k.done).length*4+Math.sin(age*2)*2);
          for(const k of cuts){
            if(k.reel>=1)continue;
            const rest=1-k.reel,ax=k.x-38*rest,by=k.y-44*rest;
            line(c,[[ax,by],[k.x-13*rest,k.y-13*rest],[k.x,k.y],[k.x+18*rest,k.y+19*rest],[k.x+37*rest,k.y+39*rest]],k.col,4);
            if(!k.done){oval(c,k.x,k.y,14,9,k.col,.62);for(let j=-5;j<8;j+=5)line(c,[[k.x+j-3,k.y-6],[k.x+j+2,k.y+5]],'#593e49',2);}
          }
          for(let j=0;j<cuts.length;j++){
            const k=cuts[j];if(!k.done||k.reel>=1)continue;
            const q=k.reel,xx=k.x+k.side*53*q,yy=k.y-36*Math.sin(q*Math.PI)+q*q*31;
            for(let n=0;n<4;n++)ring(c,xx+n*2,yy,5-n*.6,k.col,1.6);
            line(c,[[xx+4,yy+1],[xx+10,yy+5],[xx+8,yy+10],[xx+17,yy+12]],k.col,1.8);
          }
          if(!unlocked){shape(c,[[charm.x,charm.y-7],[charm.x+7,charm.y],[charm.x,charm.y+7],[charm.x-7,charm.y]],'#ffe2a2');}
          if(!flight&&sel!==cur)line(c,[[pos.x,pos.y],[pins[sel].x,pins[sel].y]],'#a3b4ad',1,[2,8]);
          pins.forEach((p,i)=>{if(i===6&&!unlocked)return;dot(c,p.x+1,p.y+3,9,'#324453');dot(c,p.x,p.y,9,'#c79465');ring(c,p.x,p.y,7,'#f5d6a0',2);dot(c,p.x,p.y,3,'#524853');if(i===sel)ring(c,p.x,p.y,14,'#f4dcb4',1.5);});
          if(flight)line(c,[[from.x,from.y],[pos.x,pos.y]],'#f4d2a1',2);
          scissors(c,pos.x,pos.y,heading,flight?age:0);fx.draw(c);c.restore();
          box(c,296,11,44,11,'#94735c');box(c,300,9,36,5,'#e5bb82');
        }};
    }});

  const ground=x=>273+6*Math.sin(x*.017)+4*Math.sin(x*.035);
  function duck(c,x,y,dir,bob=0){
    c.save();c.translate(x,y+bob);c.scale(dir,1);line(c,[[-3,0],[-4,4]],'#b67540',2);line(c,[[3,0],[4,4]],'#b67540',2);
    oval(c,-1,-4,8,5,'#edbb48');dot(c,4,-9,5,'#ffe082');shape(c,[[8,-10],[13,-8],[8,-7]],'#ca7846');dot(c,5,-10,1,'#373e38');c.restore();
  }
  function critter(c,x,y,form,dir,t){
    c.save();c.translate(x,y);c.scale(dir*1.35,1.35);
    if(form==='frog'){
      oval(c,-4,-3,12,5,'#63934c');oval(c,0,-8,13,8,'#85aa52');oval(c,8,-12,9,7,'#aac766');dot(c,9,-18,4,'#bbd977');dot(c,10,-18,1.7,'#273e39');
      line(c,[[-9,-9],[-14,-1],[-5,-1]],'#426b48',3);line(c,[[9,-6],[12,0],[16,0]],'#587c4b',2);
    }else if(form==='mole'){
      oval(c,-1,-8,16,10,'#795866');shape(c,[[6,-13],[22,-8],[9,-5]],'#a87a7e');dot(c,20,-8,3,'#e99c96');dot(c,8,-12,1.5,'#2b2932');
      oval(c,9,-2,7,3,'#daaaa2',-.22);line(c,[[-12,-5],[-17,-4],[-20,-9]],'#735260',2);dot(c,-2,-17,3,'#906b74');
    }else{
      oval(c,-1,-8,11,8,'#c6835a');dot(c,5,-16,7,'#d29869');dot(c,3,-22,4,'#b47a59');dot(c,8,-17,1.5,'#242e31');
      line(c,[[-9,-7],[-19,-10],[-17,-22]],'#995d4b',5);line(c,[[-3,-3],[-5+Math.sin(t)*2,0]],'#765643',2);
    }
    c.restore();
  }
  registerGame({id:'return-post',title:'Puddle Parade',buttons:{a:'Call / dig',b:'Borrow'},genre:'Adventure',kind:'Remix',accent:'#b8d971',best:'Either',
    description:'Borrow a frog to cross the marsh and a mole to get under the hill. Bring the three lost ducklings to the ferry.',
    controls:'Tap or drag to walk. Tap a marked animal to borrow it, a duckling to call it, or the hill to dig. Pad left/right walk, A calls or digs, B borrows a nearby animal.',
    sources:[source('Borrowed Skins',34,'Possess a local animal to cross terrain its body can traverse.'),source('Mole Mech',34,'Excavate a lasting passage under a blocked ridge.'),source('Flockward',34,'Whistle to bring separated birds into a following flock.')],
    create(g){
      let x=59,cam=0,dir=1,form='shrew',goal=null,act=null,age=0,walk=0,signal=0,dig=0,shortcut=false,won=false,finish=0;
      const party=[],seen=new Set(),homes=[{x:201,form:'frog'},{x:609,form:'mole'}],babies=[{x:117},{x:491},{x:1022}];
      const fx=sparkles(),signs=[{x:159,txt:'FROG'},{x:561,txt:'MOLE'},{x:1084,txt:'FERRY →'}];
      function status(){g.hud(party.length+' / 3 ducklings   ·   '+form);}
      status();setHint(g,'Find the ducklings. Tap the first one.');
      function borrow(h){
        form=h.form;seen.add(form);fx.pop(x,ground(x)-10,form==='mole'?'#e3a19b':'#c4e58b',12,75);g.tone(form==='frog'?340:208,.1);status();
        setHint(g,form==='frog'?'Frogs can swim.':'Dig where the earth is cracked.');
      }
      function call(){
        signal=.65;g.tone(710,.09);
        for(const b of babies){
          if(b.joined||Math.abs(x-b.x)>95)continue;
          b.joined=true;b.followX=b.x;party.push(b);fx.pop(b.x,ground(b.x)-12,'#f7d17b',9,65);status();setHint(g,'');
        }
      }
      function actOn(a){
        if(a?.form){borrow(a);return;}
        if(a==='door'){
          if(form==='mole'&&Math.abs(x-710)<125){dig=1;fx.pop(729,258,'#a87b55',24,102);g.tone(150,.12);setHint(g,'The tunnel stays open.');}
          else setHint(g,'Borrow the mole beside the hill.');return;
        }
        if(a==='cache'){
          if(form==='mole'&&Math.abs(x-640)<76&&!shortcut){shortcut=true;fx.pop(650,273,'#f2c67e',19,113);setHint(g,'A beetle cart! Your parade moves faster.');g.tone(880,.1);}return;
        }
        call();
      }
      function choose(wx){
        if(won||finish)return;goal=clamp(wx,28,1216);act=null;
        const h=homes.find(v=>Math.abs(wx-v.x)<28);if(h){act=h;goal=h.x;return;}
        const b=babies.find(v=>!v.joined&&Math.abs(wx-v.x)<30);if(b){act=b;goal=b.x;return;}
        if(!shortcut&&Math.abs(wx-654)<14){act='cache';goal=644;return;}
        if(!dig&&wx>699&&wx<834){act='door';goal=691;return;}
      }
      function move(dx,dt){
        const old=x;let n=clamp(x+dx*dt*(shortcut?221:158)*(form==='frog'&&x>282&&x<425?1.22:1),24,1218);
        if(!dig&&n>696&&n<838)n=old<=696?696:838;
        if(form!=='frog'&&n>284&&n<419)n=old<=284?284:419;
        x=n;if(Math.abs(x-old)<.02){if(goal!==null){goal=null;act=null;}setHint(g,n===284||n===419?'Borrow the frog to swim.':'Borrow the mole and dig at the hill.');return;}
        dir=Math.sign(x-old);walk+=dt*12;
      }
      function interact(){
        if(!dig&&Math.abs(x-707)<52)return actOn('door');
        if(!shortcut&&form==='mole'&&Math.abs(x-654)<23)return actOn('cache');
        call();
      }
      function actorY(px,body){if(px>282&&px<421)return 285+Math.sin(age*5+px*.035)*2;if(dig&&px>693&&px<840)return 289+3*Math.sin(px*.12);
        return ground(px)-(body==='frog'&&walk?Math.max(0,Math.sin(walk))*5:0);}
      function tree(c,xx,yy,s){c.save();c.translate(xx,yy);c.scale(s,s);box(c,-4,-32,8,34,'#826e56');oval(c,-8,-44,17,27,'#709970',-.32);oval(c,8,-52,18,32,'#82a271',.21);oval(c,2,-62,12,19,'#a2b77c');c.restore();}
      return {tap(sx){choose(cam+sx);if(goal!==null&&Math.abs(goal-x)<20&&act){actOn(act);act=null;goal=null;}},
        drag(sx){const wx=cam+sx;if(Math.abs(wx-(goal??x))>10)choose(wx);},
        press(k){if(k==='a')interact();if(k==='b'){let h=homes.find(v=>Math.abs(x-v.x)<95);if(!h)h=homes.find(v=>seen.has(v.form)&&v.form!==form);if(h)borrow(h);else setHint(g,'Stand beside a frog or mole to borrow it.');}
          if(k==='left'||k==='right'){goal=null;act=null;move(k==='right'?1:-1,.09);}},
        update(dt){
          age+=dt;fx.tick(dt);signal=Math.max(0,signal-dt);if(won)return;
          const pad=(g.held('right')?1:0)-(g.held('left')?1:0);
          if(!finish){
            if(pad){act=null;goal=null;move(pad,dt);}
            else if(goal!==null){const d=goal-x;if(Math.abs(d)<5){goal=null;const a=act;act=null;if(a)actOn(a);}else move(Math.sign(d),Math.min(dt,Math.abs(d)/(shortcut?221:158)));}
          }
          let prev=x;for(const b of party){const gap=prev-b.followX;if(Math.abs(gap)>21)b.followX+=(gap-Math.sign(gap)*21)*Math.min(1,dt*6);prev=b.followX;}
          cam+= (clamp(x-250,0,618)-cam)*Math.min(1,dt*6);
          if(x>1167&&party.length===3&&!finish){finish=.85;setHint(g,'');}
          if(x>1167&&party.length<3)setHint(g,'The ferry is waiting for all three ducklings.');
          if(finish>0){finish-=dt;if(finish<=0){won=true;g.win('All three ducklings caught the afternoon ferry.');}}
        },
        draw(c){
          box(c,0,0,640,420,'#d8e6bf');dot(c,502-cam*.12,72,24,'#f3e6af');
          for(let i=0;i<12;i++)oval(c,i*133-cam*.2-50,197,107,44+(i%3)*15,'#b4cba4');
          for(let i=0;i<16;i++)oval(c,i*88-cam*.45-32,221,76,37+(i%4)*10,'#9db998');
          c.save();c.translate(-cam,0);
          for(let i=0;i<15;i++)tree(c,38+i*84,247+(i%3)*4,.58+(i%4)*.095);
          box(c,0,274,1258,146,'#927b55');
          for(const [l,r] of [[0,283],[421,1258]]){const bank=[];for(let px=l;px<r;px+=12)bank.push([px,ground(px)]);bank.push([r,ground(r)]);shape(c,[[l,420],...bank,[r,420]],'#917354');line(c,bank,'#79945d',12);line(c,bank.map(([a,b])=>[a,b-5]),'#b2bf78',3);}
          for(let j=0;j<95;j++){const xx=j*59%1258,yy=305+j*29%110;line(c,[[xx,yy],[xx+8,yy-2]],'#ac8964',2);}
          shape(c,[[280,271],[304,278],[392,278],[423,269],[413,295],[397,305],[318,308],[289,294]],'#73ae9f');for(let j=0;j<6;j++){const xx=292+j*21;line(c,[[xx,282+j%2*5],[xx+11,282+j%2*5]],'#cae3bb',2);}
          for(let j=0;j<6;j++){const rx=(j<3?267:414)+(j%3)*5,ry=276;line(c,[[rx,ry],[rx-2,ry-20-j%3*5]],'#70885c',1.6);oval(c,rx-2,ry-22-j%3*5,2,5,'#967551',-.1);}
          for(let j=0;j<4;j++){const tx=291+j*36;oval(c,tx,279+Math.sin(j)*3,9,2,'#83a865');}
          shape(c,[[688,275],[703,251],[720,233],[748,201],[774,194],[795,209],[818,247],[846,274]],'#ad8360');line(c,[[693,269],[715,239],[745,204],[775,195],[799,214],[826,255]],'#9aaa68',8);
          if(dig){shape(c,[[688,278],[704,257],[724,249],[749,263],[768,272],[805,247],[826,250],[846,276],[846,298],[688,298]],'#534d46');line(c,[[693,294],[728,290],[772,293],[813,286],[839,291]],'#c39b68',4);}
          else line(c,[[708,263],[721,256],[717,246],[728,242]],'#765a4d',3);
          if(!shortcut){shape(c,[[646,273],[652,266],[657,274]],'#e0aa55');line(c,[[650,271],[648,264]],'#b97640',2);}
          for(let i=0;i<18;i++){const px=i*67+17;if(px>280&&px<424)continue;for(let j=0;j<3;j++)line(c,[[px+j*3,ground(px)-4],[px-5+j*7,ground(px)-13-j%2*3]],'#72945c',2);}
          for(const s of signs){box(c,s.x,ground(s.x)-45,3,39,'#907453');box(c,s.x-20,ground(s.x)-59,53,17,'#ddc795');label(c,s.txt,s.x+7,ground(s.x)-47,'#725f45',9,'center');}
          homes.forEach(h=>{critter(c,h.x,ground(h.x)-2,h.form,-1,age);if(!seen.has(h.form)){dot(c,h.x,ground(h.x)-37,7,'#eee5b3');label(c,'↔',h.x,ground(h.x)-34,'#456c58',10,'center');}});
          babies.forEach(b=>{if(!b.joined){duck(c,b.x,ground(b.x)-2,Math.sin(age)>.8?-1:1,Math.sin(age*3));if(Math.sin(age*4)>.2)label(c,'♪',b.x+10,ground(b.x)-24,'#9a7847',12);}});
          shape(c,[[1124,272],[1212,272],[1201,288],[1141,289]],'#76634f');box(c,1147,244,49,25,'#c49865');box(c,1142,239,61,6,'#8f6553');box(c,1153,248,14,11,'#697e75');box(c,1173,248,14,11,'#697e75');line(c,[[1140,268],[1140,225],[1161,225]],'#87745d',2);shape(c,[[1141,225],[1158,225],[1151,231],[1141,231]],'#d6815b');
          for(const b of party)duck(c,b.followX,actorY(b.followX,'duck'),dir,Math.sin(age*8+b.x)*1.8);
          if(goal!==null&&Math.abs(goal-x)>25){
            const gy=ground(goal)-4;line(c,[[goal-4,gy-2],[goal,gy+1],[goal+4,gy-2]],'#f7e8a8',2);
          }
          const yy=actorY(x,form);if(form==='frog'&&x>282&&x<421){oval(c,x-5*dir,yy+1,18,3,'#a9d3b5');line(c,[[x-22*dir,yy+3],[x-27*dir,yy+3]],'#c8e4c0',2);}
          if(shortcut){box(c,x-14,yy-2,26,4,'#aa8051');dot(c,x-9,yy+3,4,'#534e41');dot(c,x+9,yy+3,4,'#534e41');}
          critter(c,x,yy-(shortcut?4:0),form,dir,walk);if(signal>0)ring(c,x,yy-11,(1-signal/.66)*55+4,'#fff3bd',2);
          fx.draw(c);c.restore();
          for(let i=0;i<3;i++){dot(c,36+i*33,34,13,i<party.length?'#e1cf8a':'#bfccad');if(i<party.length)duck(c,36+i*33,40,1);else ring(c,36+i*33,34,5,'#8d9d82',1);}
        }};
    }});

  const bank=point(73,221), burrow=point(564,187),shell=point(326,303);
  const depths=[{x:284,y:171,rx:51,ry:35},{x:450,y:274,rx:48,ry:33}];
  const stoneCols=['#dba47e','#99aaa5','#cea6a0'];
  function tideCrab(c,x,y,dir,t,pearl){
    c.save();c.translate(x,y);c.scale(dir*1.28,1.28);
    for(let i=0;i<3;i++){
      const xx=i*5-9,b=Math.sin(t+i)*2;
      line(c,[[xx,-3],[xx-6,2+b],[xx-8,5+b]],'#954c3f',2.5);
      line(c,[[xx+7,-2],[xx+12,2-b],[xx+15,4-b]],'#ad5e48',2);
    }
    oval(c,0,-5,12,7,'#e28258');dot(c,6,-11,3,'#f29c68');dot(c,7,-12,1,'#333d40');
    line(c,[[7,-4],[14,-7],[16,-11]],'#c36e50',2);oval(c,17,-12,4,3,'#f0a374',-.4);
    oval(c,-5,-10,10,9,pearl?'#e7c8d9':'#e9b58a',-.4);line(c,[[-11,-9],[-9,-14],[-3,-15],[1,-11],[-1,-7],[-5,-8],[-5,-10]],pearl?'#ad86a5':'#b57c63',1.8);c.restore();
  }
  registerGame({id:'fold-office',title:'Little Low Tide',buttons:{a:'Next stone',b:'Call'},genre:'Puzzle',kind:'Original',accent:'#e5aa82',best:'Either',
    description:'A hermit crab needs stepping stones to reach its burrow. Fish the stones out behind it and lay them ahead.',
    controls:'Drag a loose stone into shallow water, or tap a stone then its destination. Pad A chooses a movable stone, arrows shift it, and B calls the crab. The dark pools are too deep.',
    sources:[],create(g){
      const stones=[point(155,229),point(215,286),point(345,224)],fx=sparkles();
      let occupied=-1,sel=0,pressed=false,moved=false,start=null,placing=false,age=0,active=false,hop=null,pearl=false,finished=false,finish=0,dir=1,ghost=null,padTimer=0;
      const crab={...bank};
      function status(){g.hud(finished?'Home':pearl?'Pink shell   ·   Longer hops':'Find the burrow');}
      status();setHint(g,'Drag stones ahead of the crab.');
      const reach=()=>pearl?135:109;
      const fixed=i=>i===occupied||hop?.i===i;
      function cycle(){
        for(let i=1;i<=stones.length;i++){const n=(sel+i)%stones.length;if(!fixed(n)){sel=n;break;}}
      }
      function towards(){
        if(hop||finish||finished||pressed)return;
        const spots=[...stones,burrow];let best=-1,furthest=0;
        spots.forEach((s,i)=>{const gain=distance(crab,burrow)-distance(s,burrow);if(i!==occupied&&distance(crab,s)<=reach()&&gain>furthest+2){best=i;furthest=gain;}});
        if(best<0)return;
        const to=spots[best];hop={from:{...crab},to:{...to},t:0,i:best};dir=to.x>=crab.x?1:-1;
        g.tone(288+Math.round(to.x/4),.035);
      }
      function valid(p){
        return !depths.some(d=>((p.x-d.x)/d.rx)**2+((p.y-d.y)/d.ry)**2<1);
      }
      function place(x,y){
        if(fixed(sel))return;
        const p=point(clamp(x,91,540),clamp(y,85,336));
        if(!valid(p)){setHint(g,'Too deep. Try the pale water.');fx.pop(p.x,p.y,'#a4e2d5',7,58);return;}
        stones[sel]=p;active=true;setHint(g,'');fx.pop(p.x,p.y,'#deebc4',6,45);g.tone(168,.042);
      }
      function tap(x,y){
        if(finished||finish)return;const p=point(x,y);
        const n=stones.findIndex((s,i)=>!fixed(i)&&distance(p,s)<25);
        if(n>=0){sel=n;pressed=true;moved=false;start=p;placing=true;ghost={...stones[n]};active=true;return;}
        if(placing){place(x,y);placing=false;ghost=null;}
        else{active=true;towards();}
      }
      function shift(k,amount){
        if(fixed(sel))cycle();const s=stones[sel],dx=k==='left'?-1:k==='right'?1:0,dy=k==='up'?-1:k==='down'?1:0;
        place(s.x+dx*amount,s.y+dy*amount);placing=false;ghost=null;
      }
      return {tap,drag(x,y){if(pressed){if(distance(start,point(x,y))>5)moved=true;ghost=point(x,y);}},
        release(){if(pressed&&moved){place(ghost.x,ghost.y);placing=false;}pressed=false;ghost=null;},
        press(k){if(finished)return;if(k==='a'){cycle();active=true;placing=true;}if(k==='b'){active=true;towards();}if(['left','right','up','down'].includes(k)){shift(k,14);padTimer=.21;}},
        update(dt){
          age+=dt;fx.tick(dt);padTimer-=dt;
          const h=['left','right','up','down'].find(k=>g.held(k));if(h&&padTimer<=0){shift(h,8);padTimer=.065;}
          if(!active||finished)return;
          if(hop){
            hop.t+=dt*2.55;const t=Math.min(hop.t,1);crab.x=mix(hop.from.x,hop.to.x,t);crab.y=mix(hop.from.y,hop.to.y,t)-Math.sin(t*Math.PI)*25;
            if(t===1){occupied=hop.i;hop=null;fx.pop(crab.x,crab.y,'#d4e5be',6,44);
              if(!pearl&&distance(crab,shell)<44){pearl=true;g.tone(880,.14);setHint(g,'A light pink shell! Now the crab hops farther.');status();}
              if(occupied===stones.length){finish=.65;setHint(g,'');}
              if(occupied===sel)cycle();
            }
          }else if(!finish)towards();
          if(finish>0){finish-=dt;if(finish<=0){finished=true;status();g.win('The little hermit crab is home for high tide.');}}
        },
        draw(c){
          box(c,0,0,640,420,'#edddbd');box(c,0,20,640,368,'#759c91');box(c,0,24,640,358,'#9ec8b3');
          for(let i=0;i<74;i++){const xx=(i*137+11)%640,yy=41+(i*47)%318;line(c,[[xx,yy],[xx+7,yy-1],[xx+13,yy]],i%3?'#aad1bc':'#b5d6bf',1.5);}
          for(const d of depths){oval(c,d.x,d.y,d.rx+12,d.ry+8,'#88b9a7');oval(c,d.x,d.y,d.rx,d.ry,'#78aa9d');oval(c,d.x+2,d.y+2,d.rx*.66,d.ry*.58,'#71a497');
            for(let i=0;i<3;i++){const t=(age*.46+i*.34)%1;ring(c,d.x+(i-1)*12,d.y+8-t*20,1+t*2.5,'#b1d4bc',1);}}
          shape(c,[[0,25],[77,24],[98,61],[74,106],[100,149],[86,187],[102,212],[100,245],[78,260],[69,305],[45,338],[57,382],[0,382]],'#e0c9a5');
          shape(c,[[640,24],[589,24],[565,65],[577,98],[550,134],[525,165],[526,202],[550,228],[536,251],[561,283],[550,325],[573,383],[640,383]],'#e9d0a8');
          for(let i=0;i<46;i++){let xx=i%2?i*17%53:590+i*17%45,yy=39+(i*43)%325;dot(c,xx,yy,1+(i%3)*.6,'#c4ac8a');}
          for(let i=0;i<32;i++){
            const side=i%2?622:9,px=side+(i%2?-1:1)*(i*29%32),py=46+i*71%322;
            line(c,[[px,py],[px-3,py-10],[px+2,py-14]],'#688b72',2);oval(c,px-4,py-6,3,6,'#86a383',-.5);
          }
          oval(c,burrow.x+6,burrow.y,26,14,'#bf9b75');oval(c,burrow.x+7,burrow.y+1,18,10,'#625447');
          for(let i=0;i<5;i++){const a=Math.PI+i*Math.PI/4;oval(c,burrow.x+7+Math.cos(a)*22,burrow.y+Math.sin(a)*13,6,4,'#d8b48d',a);}
          if(!pearl){
            c.save();c.translate(shell.x,shell.y);c.rotate(-.3);
            for(let i=0;i<5;i++){const a=-Math.PI*.85+i*Math.PI*.17;line(c,[[0,5],[Math.cos(a)*12,Math.sin(a)*12]],'#d99b9c',6);}
            dot(c,0,4,4,'#f5c6b9');c.restore();
          }
          function drawStone(s,i,selected){
            oval(c,s.x+2,s.y+6,24,10,'#80aa98');oval(c,s.x,s.y+1,23,10,'#7c8171');oval(c,s.x-1,s.y-2,22,10,stoneCols[i],-.1);
            line(c,[[s.x-15,s.y-4],[s.x-7,s.y-7],[s.x+3,s.y-7]],'#e6cdb2',2);
            if(selected&&!fixed(i)){c.save();c.setLineDash([3,5]);c.beginPath();c.strokeStyle='#faf0cb';c.lineWidth=2;c.ellipse(s.x,s.y,28,16,0,0,TAU);c.stroke();c.restore();}
          }
          stones.forEach((s,i)=>{if(!(moved&&pressed&&i===sel))drawStone(s,i,i===sel);});
          if(pressed&&moved&&ghost){line(c,[[stones[sel].x,stones[sel].y],[ghost.x,ghost.y]],'#eef0ca',2,[2,6]);drawStone(ghost,sel,true);}
          if(!hop&&!finish&&!finished){c.save();c.setLineDash([1,10]);c.beginPath();c.strokeStyle='#e0ead1';c.lineWidth=1.5;c.arc(crab.x,crab.y,reach(),-.92,.92);c.stroke();c.restore();}
          if(!finished)tideCrab(c,crab.x,crab.y-3,dir,hop?age*16:age*3,pearl);fx.draw(c);
          box(c,0,379,640,5,'#b9c2a8');box(c,0,384,640,7,'#799588');label(c,'LOW TIDE',25,408,'#7b7461',10);label(c,'BURROW  ↗',606,147,'#7b6851',10,'right');
        }};
    }});
})();

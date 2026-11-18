(() => {
  'use strict';
  const tau = Math.PI*2;
  const dirs = [[0,-1],[1,0],[0,1],[-1,0]];
  const keys = ['up','right','down','left'];
  const clamp=(x,a,b)=>Math.max(a,Math.min(x,b));
  const lerp=(a,b,t)=>a+(b-a)*t;
  const drive=(name,rule)=>[name,'Drive',rule];
  const adventure=(name,rule)=>[name,'PR #34',rule];
  function rect(c,x,y,w,h,color){c.fillStyle=color;c.fillRect(x,y,w,h);}
  function ellipse(c,x,y,rx,ry,color,angle=0){c.beginPath();c.ellipse(x,y,rx,ry,angle,0,tau);c.fillStyle=color;c.fill();}
  function path(c,pts,color,thick=0){c.beginPath();pts.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));if(thick){c.strokeStyle=color;c.lineWidth=thick;c.lineCap='round';c.lineJoin='round';c.stroke();}else{c.closePath();c.fillStyle=color;c.fill();}}
  function text(c,s,x,y,size=16,color='#fff6d5',align='left',font='sans-serif'){c.fillStyle=color;c.textAlign=align;c.textBaseline='middle';c.font='bold '+size+'px '+font;c.fillText(s,x,y);}
  function round(c,x,y,w,h,r,color){c.beginPath();c.roundRect(x,y,w,h,r);c.fillStyle=color;c.fill();}
  function sky(c,a,b){const grad=c.createLinearGradient(0,0,0,420);grad.addColorStop(0,a);grad.addColorStop(1,b);rect(c,0,0,640,420,grad);}
  function star(c,x,y,r,ink){const a=[];for(let i=0;i<10;i++){const t=i*Math.PI/5-Math.PI/2,s=i%2?r*.48:r;a.push([x+Math.cos(t)*s,y+Math.sin(t)*s]);}path(c,a,ink);}
  function particles(){
    let dots=[];
    return {
      burst(x,y,color,n=12,force=1){for(let i=0;i<n;i++){const a=i*2.4+Math.random()*.4,s=(24+Math.random()*62)*force;dots.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-20,life:.38+Math.random()*.3,color});}},
      update(dt){dots=dots.filter(p=>p.life>0);for(const p of dots){p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=90*dt;}},
      draw(c){for(const p of dots){const r=Math.max(.4,p.life*5);ellipse(c,p.x,p.y,r,r,p.color);}}
    };
  }

  registerGame({
    id:'reedwire',title:'Crumb Gobbler',genre:'Puzzle',kind:'Remix',accent:'#fbb780',best:'Either',buttons:{a:'Turn',b:'Undo'},
    description:'A four-square vacuum has escaped onto the kitchen counter. Slide it around the jars, eat the crumbs, then chase dessert.',
    controls:'Swipe anywhere to slide until something stops you. Tap the vacuum to turn it. D-pad slides, A turns, B undoes.',
    sources:[drive('Mobile Tetromino Board','Turn an already-placed four-square piece on the board.'),adventure('Rune Golem','Slide until a solid obstruction stops the piece, collecting items along the way.'),drive('Pocket Hole Hoarder','Eat small objects to unlock a larger edible object.')],
    create(g){
      const boards=[
        {start:[1,1],shape:[[0,0],[1,0],[0,1],[1,1]],jars:[[3,3]],crumbs:[[4,1],[5,2]],cake:[6,4],name:'Toast crumbs'},
        {start:[0,0],shape:[[0,0],[1,0],[2,0],[0,1]],jars:[[6,4],[1,2]],crumbs:[[3,2],[0,3],[6,1]],cake:[4,1],name:'Ginger snaps'},
        {start:[0,1],shape:[[0,0],[1,0],[2,0],[1,1]],jars:[[3,2],[0,3],[3,0]],crumbs:[[3,1],[5,4],[4,0]],cake:[3,3],name:'Birthday cake'}
      ];
      const step=62,ox=100,oy=69,fx=particles();
      let level=0,board,x,y,shape,crumbs,history,t=0,phase=0,done=false,from=null,start=null,dragged=false;
      const center=(a,b)=>[ox+(a+.5)*step,oy+(b+.5)*step];
      function status(){g.hud('Counter '+(level+1)+'/3 · '+(crumbs.length?crumbs.length+' crumbs':'Dessert is ready'));}
      function setup(){board=boards[level];[x,y]=board.start;shape=board.shape;crumbs=board.crumbs.slice();history=[];from=null;status();g.say(level?'Slide and turn around the jars. Grab the cake last.':'Swipe right to gobble both crumbs. Then slide down to the cake.');}
      function fits(nx,ny,piece){return piece.every(([a,b])=>nx+a>=0&&nx+a<7&&ny+b>=0&&ny+b<5&&!board.jars.some(([j,k])=>nx+a===j&&ny+b===k));}
      function snack(){
        const on=([a,b])=>shape.some(([dx,dy])=>x+dx===a&&y+dy===b);
        const eaten=crumbs.filter(on);crumbs=crumbs.filter(p=>!on(p));
        for(const [a,b] of eaten){fx.burst(...center(a,b),'#ffda64');g.tone(400+(board.crumbs.length-crumbs.length)*100,.07);}
        if(eaten.length&&!crumbs.length)g.say('The cake cover popped off. Slide over dessert!');
        if(!crumbs.length&&on(board.cake)){phase=.9;fx.burst(...center(...board.cake),'#fc96ac',32,1.6);g.tone(800,.15);}
      }
      function move(d){
        const [dx,dy]=dirs[d];if(!fits(x+dx,y+dy,shape))return;
        history.push([x,y,shape,crumbs.slice()]);from={x,y,k:0};do{x+=dx;y+=dy;snack();}while(!phase&&fits(x+dx,y+dy,shape));status();
      }
      function turn(){
        const rotated=shape.map(([a,b])=>[-b,a]),mx=Math.min(...rotated.map(p=>p[0])),my=Math.min(...rotated.map(p=>p[1]));
        const next=rotated.map(([a,b])=>[a-mx,b-my]);if(!fits(x,y,next)){g.say('The jar is in the way. Slide clear to turn.');return;}
        history.push([x,y,shape,crumbs.slice()]);shape=next;snack();g.tone(310,.06);status();
      }
      function press(k){if(done||phase)return;const d=keys.indexOf(k);if(d>=0)move(d);if(k==='a')turn();if(k==='b'&&history.length){[x,y,shape,crumbs]=history.pop();from=null;g.say('One move back.');status();}}
      function swipe(tx,ty){if(!start||dragged)return;const dx=tx-start[0],dy=ty-start[1];if(Math.hypot(dx,dy)>18){dragged=true;press(Math.abs(dx)>Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'down':'up'));}}
      setup();
      return {press,tap(tx,ty){start=[tx,ty];dragged=false;},drag:swipe,release(){if(start&&!dragged){const [tx,ty]=start;const a=Math.floor((tx-ox)/step),b=Math.floor((ty-oy)/step);if(shape.some(([dx,dy])=>a===x+dx&&b===y+dy))press('a');else if(a>=0&&a<7&&b>=0&&b<5){const dx=a-x-.5,dy=b-y-.5;press(Math.abs(dx)>Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'down':'up'));}}start=null;},
        update(dt){t+=dt;fx.update(dt);if(from){from.k=Math.min(1,from.k+dt*5);if(from.k===1)from=null;}if(phase>0){phase-=dt;if(phase<=0){phase=0;if(level===2){done=true;g.win('Three clean counters. The little vacuum ate the birthday cake, too.');}else{level++;setup();}}}},
        draw(c){
          sky(c,'#c77558','#e6a577');for(let j=0;j<9;j++)path(c,[[0,j*61+5],[640,j*61-13]],'#b16b52',2);
          round(c,ox-10,oy-9,7*step+20,5*step+22,14,'#74483b');round(c,ox-6,oy-6,7*step+12,5*step+12,10,'#fbddb1');
          for(let i=0;i<35;i++)round(c,ox+i%7*step+1,oy+Math.floor(i/7)*step+1,step-2,step-2,5,(i%7+Math.floor(i/7))%2?'#f0c995':'#f6d6a9');
          text(c,board.name,ox,35,25,'#482e29','left','Georgia');text(c,(level+1)+' / 3',ox+7*step,35,16,'#582e27','right');
          for(const [a,b] of board.jars){const [px,py]=center(a,b);ellipse(c,px,py+16,24,11,'#b88b6c');round(c,px-20,py-18,40,43,12,'#ae6964');ellipse(c,px,py-14,21,11,'#a2454f');ellipse(c,px,py-19,23,10,'#ee8f80');ellipse(c,px,py-20,15,5,'#f6b196');round(c,px-14,py,28,13,4,'#f9deb1');}
          for(const [a,b] of crumbs){const [px,py]=center(a,b);ellipse(c,px,py+6,14,6,'#c79572');path(c,[[px-12,py+3],[px-8,py-8],[px+7,py-11],[px+14,py+4],[px+4,py+10]],'#be803c');ellipse(c,px-4,py-2,3,3,'#7b4b38');ellipse(c,px+6,py+1,2,2,'#8a5034');}
          const [cx,cy]=center(...board.cake);ellipse(c,cx,cy+10,23,8,'#c89574');path(c,[[cx-16,cy+8],[cx-16,cy-2],[cx+10,cy-11],[cx+16,cy+9]],'#a1544a');path(c,[[cx-16,cy-3],[cx+9,cy-15],[cx+16,cy-4],[cx,cy+2]],'#f68fa7');ellipse(c,cx+4,cy-12,5,5,'#d93c59');
          if(crumbs.length){c.save();c.globalAlpha=.78;ellipse(c,cx,cy,26,22,'#a1c4bd');c.restore();round(c,cx-28,cy+12,56,4,2,'#71958c');ellipse(c,cx,cy-23,5,4,'#846d5a');}else star(c,cx+20,cy-18+Math.sin(t*5)*3,5,'#fff3ac');
          const k=from?1-(1-from.k)**3:1,xx=from?lerp(from.x,x,k):x,yy=from?lerp(from.y,y,k):y;
          for(const [a,b] of shape){const [px,py]=center(xx+a,yy+b);for(const [dx,dy] of [[1,0],[0,1]])if(shape.some(([u,v])=>u===a+dx&&v===b+dy)){path(c,[[px,py],[px+dx*step,py+dy*step]],'#345e62',29);path(c,[[px,py-3],[px+dx*step,py+dy*step-3]],'#72bbb1',24);}}
          shape.forEach(([a,b],i)=>{const [px,py]=center(xx+a,yy+b);round(c,px-28,py-24,56,54,13,'#345e62');round(c,px-28,py-28,56,52,13,'#68b9af');round(c,px-22,py-24,44,41,10,'#89d5b9');if(i){for(let j=-1;j<=1;j++)round(c,px-11,py+j*6,22,3,2,'#5a9b8f');}else{for(const u of [-10,10]){ellipse(c,px+u,py-6,6,8,'#fff7cf');ellipse(c,px+u+2,py-5,3,5,'#334a48');}path(c,[[px-10,py+9],[px-3,py+13],[px+5,py+13],[px+11,py+8]],'#345659',3);}});
          fx.draw(c);text(c,'Swipe to slide     •     Tap the gobbler to turn',320,401,15,'#563a2b','center');
        }};
    }
  });

  registerGame({
    id:'paper-nautilus',title:'Paper Nautilus',genre:'Adventure',kind:'Remix',accent:'#7edccc',best:'Either',buttons:{a:'Gust',b:'Unhook'},
    description:'Sail a paper boat over two reefs. Hook a shape under the water, tow it back to the jetty, and see what comes out.',
    controls:'Tap or drag on the water to sail, or hold the D-pad. Sail near a shadow to hook it. Tow it to the striped dock, then sail east. A or tapping the boat gives a gust. B unhooks.',
    sources:[adventure('Salvage Tug','Haul physical cargo on a spring cable.'),drive('Pocket Hole Hoarder','A short-range magnet pulls nearby salvage into reach.'),drive('Air Dash Arcana','A directional gust gathers and carries an attached object forward with its caster.')],
    create(g){
      const reefs=[
        {name:'Button Bay',spots:[[205,187,'fan shell'],[384,284,'hermit crab'],[486,115,'glass float']],rocks:[[265,96,51,24],[407,369,67,32],[525,271,29,18]]},
        {name:'Whale Tail Reef',spots:[[202,317,'sea horse'],[380,144,'flying fish'],[485,279,'baby ray']],rocks:[[203,88,61,29],[345,282,39,23],[503,64,63,22]]}
      ];
      let level=0,x=91,y=224,vx=0,vy=0,angle=0,aim=null,heldCargo=null,finds=[],reef,spots,opened=false,t=0,gust=0,cool=0,lastDock='',done=false,wakes=[],wakeAt=0,reveal=0;
      const fx=particles(),dock=[83,226];
      const kit=()=>finds.includes('glass float')||finds.includes('flying fish');
      function status(){g.hud(reef.name+' · '+finds.length+' finds'+(opened?' · East passage open':''));}
      function enter(){reef=reefs[level];spots=reef.spots.map(([sx,sy,name])=>({x:sx,y:sy,name,found:false}));opened=false;heldCargo=null;aim=null;x=91;y=224;vx=0;vy=0;angle=0;lastDock='';reveal=0;wakes=[];status();g.say(level?'Another reef! Tow one shape ashore to open the way home.':'Sail over the nearby shell-shaped shadow. Tow it to the striped jetty.');}
      function steer(tx,ty){if(done)return;aim=[clamp(tx,14,634),clamp(ty,48,398)];}
      function boost(){if(done||cool>0)return;cool=.9;gust=.24;g.tone(330,.10);fx.burst(x,y,'#dcffef',10);if(heldCargo){heldCargo.vx+=Math.cos(angle)*160;heldCargo.vy+=Math.sin(angle)*160;}}
      function releaseCargo(){if(heldCargo){heldCargo.lock=1.3;heldCargo=null;g.say('Towline free.');}}
      function keepClear(o,r){
        for(const [rx,ry,a,b] of reef.rocks){const dx=o.x-rx,dy=o.y-ry,ax=a+r,by=b+r,d=Math.hypot(dx/ax,dy/by);if(d<1){const normal=d||1;o.x=rx+(dx||.1)/normal;o.y=ry+(dy||.1)/normal;}}
      }
      function wreck(c,index,px,py){
        c.save();c.translate(px,py);const body='#286d78',edge='#529998';
        if(index===0){path(c,[[-21,6],[-23,-2],[-17,-11],[-8,-13],[-3,-17],[5,-15],[10,-15],[21,-8],[24,2],[18,10],[2,15],[-7,13]],body);for(let j=-2;j<=2;j++)path(c,[[0,10],[j*8,-8]],edge,2);}
        else if(index===1){c.rotate(-.34);round(c,-15,-9,30,25,10,body);path(c,[[-7,-7],[-7,-20],[6,-20],[6,-7]],body);path(c,[[-8,-20],[7,-20]],edge,3);path(c,[[-12,7],[10,7]],edge,2);}
        else{c.rotate(.15);round(c,-18,-11,36,23,4,body);path(c,[[-18,-2],[18,-2]],edge,3);for(const u of [-11,11])path(c,[[u,-11],[u,12]],edge,2);}
        c.restore();
      }
      function showItem(c,name,px,py,s,hidden){
        c.save();c.translate(px,py);c.scale(s,s);const a=hidden?'#2c797e':'#f6aa7c',b=hidden?'#36888a':'#f7db9c';
        if(name==='fan shell'){path(c,[[-15,6],[-21,-4],[-17,-14],[-10,-17],[-5,-21],[2,-18],[8,-20],[17,-14],[21,-5],[15,7],[3,17],[-3,16]],a);for(let j=-2;j<=2;j++)path(c,[[0,12],[j*7,-12+Math.abs(j)*2]],b,2);}
        else if(name==='hermit crab'){for(let i=-1;i<=1;i++){path(c,[[-5,0],[-16,i*6+8],[-20,i*6+3]],a,3);path(c,[[6,0],[17,i*6+7],[21,i*6+2]],a,3);}ellipse(c,0,-2,13,12,b);ellipse(c,-1,-3,7,6,a);ellipse(c,1,-3,3,3,b);}
        else if(name==='glass float'){ellipse(c,0,0,16,16,hidden?a:'#76dacc');for(let i=-1;i<=1;i++)path(c,[[i*8,-13],[i*10,1],[i*6,14]],b,2);path(c,[[-14,-5],[14,-5]],b,2);path(c,[[-14,6],[14,6]],b,2);}
        else if(name==='sea horse'){path(c,[[5,-17],[13,-12],[16,-8],[7,-8],[2,-3],[7,3],[8,11],[3,17],[-6,17],[-9,11],[-5,8]],a,7);path(c,[[1,-11],[-6,-5],[-3,1]],b,4);}
        else if(name==='flying fish'){ellipse(c,0,0,17,6,a);path(c,[[-5,-1],[1,-20],[11,-14],[5,0]],b);path(c,[[-5,1],[1,18],[9,13],[5,1]],b);path(c,[[-13,0],[-23,-7],[-23,6]],a);}
        else{path(c,[[-23,-6],[-6,-4],[0,-12],[7,-4],[23,-9],[12,7],[0,11],[-11,7]],a);path(c,[[0,8],[3,18],[12,22]],a,2);}
        c.restore();
      }
      function deposit(){const name=heldCargo.name;heldCargo.found=true;heldCargo=null;finds.push(name);lastDock=name;reveal=2.6;opened=true;fx.burst(...dock,'#ffdc96',25);g.tone(690,.16);status();g.say('A '+name+'! '+(name==='glass float'||name==='flying fish'?'Your sail is faster. ':name==='fan shell'||name==='baby ray'?'Your magnet reaches farther. ':'')+'Sail east or fish for another.');}
      enter();
      return {press(k){if(keys.includes(k))aim=null;if(k==='a')boost();if(k==='b')releaseCargo();},tap(tx,ty){if(Math.hypot(tx-x,ty-y)<20){boost();return;}steer(tx,ty);},drag:steer,
        update(dt){if(done)return;t+=dt;reveal=Math.max(0,reveal-dt);fx.update(dt);cool=Math.max(0,cool-dt);gust=Math.max(0,gust-dt);wakeAt-=dt;
          let dx=Number(g.held('right'))-Number(g.held('left')),dy=Number(g.held('down'))-Number(g.held('up'));
          if(dx||dy)aim=null;else if(aim){dx=aim[0]-x;dy=aim[1]-y;if(Math.hypot(dx,dy)<6){aim=null;dx=dy=0;}}
          const mag=Math.hypot(dx,dy),speed=(heldCargo?111:152)+(kit()?30:0);
          if(mag){angle=Math.atan2(dy,dx);dx/=mag;dy/=mag;}
          const pull=1-Math.exp(-dt*6);vx=lerp(vx,gust?Math.cos(angle)*330:dx*speed,pull);vy=lerp(vy,gust?Math.sin(angle)*330:dy*speed,pull);
          const p={x:clamp(x+vx*dt,15,631),y:clamp(y+vy*dt,54,395)};keepClear(p,7);x=p.x;y=p.y;
          if(!opened||y<172||y>275)x=Math.min(604,x);
          if(wakeAt<=0&&Math.hypot(vx,vy)>15){wakeAt=.09;wakes.push({x:x-Math.cos(angle)*12,y:y-Math.sin(angle)*12,t:1});}wakes=wakes.filter(w=>(w.t-=dt)>0);
          if(heldCargo){const h=heldCargo,ax=x-Math.cos(angle)*24,ay=y-Math.sin(angle)*24;
            h.vx+=(ax-h.x)*dt*23;h.vy+=(ay-h.y)*dt*23;const damp=Math.exp(-dt*6);h.vx*=damp;h.vy*=damp;h.x+=h.vx*dt;h.y+=h.vy*dt;
            if(Math.hypot(h.x-dock[0],h.y-dock[1])<49||Math.hypot(x-dock[0],y-dock[1])<32)deposit();
          }else{for(const s of spots){s.lock=Math.max(0,(s.lock||0)-dt);if(!s.found&&!s.lock&&Math.hypot(x-s.x,y-s.y)<(finds.includes('fan shell')||finds.includes('baby ray')?64:39)){heldCargo=s;s.vx=vx*.3;s.vy=vy*.3;fx.burst(s.x,s.y,'#ace4d4',12);g.tone(440,.09);g.say('Hooked something! Tow it back to the striped jetty on the left.');break;}}}
          if(x>616&&y>=172&&y<=275&&opened){if(level===0){level++;enter();}else{done=true;g.win('Back in port with '+finds.length+' finds: '+finds.join(', ')+'.');}}
        },
        draw(c){
          sky(c,level?'#468e9b':'#65bbbf',level?'#235e85':'#358e9d');
          for(let i=0;i<63;i++){const px=(i*113)%640,py=40+(i*59)%365;const s=Math.sin(t*1.8+i);path(c,[[px,py],[px+5,py-1.5+s],[px+10,py]],i%5?'#75c5bf':'#a9dbcb',1);}
          for(let i=0;i<13;i++){const ax=114+(i*79)%482,ay=67+(i*103)%319;for(let j=-1;j<=1;j++){path(c,[[ax,ay+8],[ax+j*4,ay+2],[ax+j*5+Math.sin(t+i)*2,ay-3-Math.abs(j)*3]],level?'#578e95':'#5daaa6',2);}}
          for(let i=0;i<12;i++){const px=83+(i*77)%510+Math.sin(t*.65+i)*15,py=60+(i*47)%320+Math.sin(t+i)*3;ellipse(c,px,py,5,2,'#3a8c92');path(c,[[px-4,py],[px-8,py-3],[px-8,py+2]],'#3a8c92');}
          for(const [rx,ry,a,b] of reef.rocks){ellipse(c,rx+1,ry+3,a+10,b+8,'#8ecbb4');ellipse(c,rx,ry,a+2,b+3,'#e0d2a7');ellipse(c,rx-1,ry-3,a-2,b-2,'#9faf89');for(let i=0;i<4;i++){const u=rx+(i-1.6)*a*.35,by=ry-3-(i%2)*5;if(level===0&&a>40&&i%2===0){path(c,[[u,by+7],[u+1,by-1],[u+4,by-13]],'#826e4e',3);for(let j=-2;j<=2;j++){const ex=u+4+j*6;path(c,[[u+4,by-13],[u+3+j*3,by-21+Math.abs(j)],[ex,by-14+Math.abs(j)*2]],j%2?'#5b8c6a':'#699c76',3);}}else{path(c,[[u-9,by+5],[u-6,by-4],[u+1,by-8],[u+8,by-3],[u+10,by+5]],i%2?'#83947f':'#849686');path(c,[[u-6,by-4],[u+1,by-8],[u+4,by-3]],'#bdc0a3');}}}
          path(c,[[0,137],[27,148],[48,165],[53,203],[66,244],[40,292],[0,304]],'#e6d4a7');
          for(let i=0;i<8;i++){const ax=25+i*8;rect(c,ax,211,8,29,i%2?'#f4d8a6':'#b46852');}
          rect(c,32,240,63,4,'#805e48');for(const p of [32,85])rect(c,p,238,5,10,'#775f53');
          if(lastDock)showItem(c,lastDock,34,187,.74,false);
          if(reveal){const py=144-Math.min(12,(2.6-reveal)*60);round(c,17,py-36,134,58,10,'#245a62');showItem(c,lastDock,48,py-9,1.02,false);text(c,lastDock.split(' ')[0],80,py-18,14,'#ffedbd');text(c,lastDock.split(' ')[1],80,py,14,'#ffedbd');}
          text(c,'DOCK',65,267,12,'#163f52','center');
          for(const py of [164,281]){ellipse(c,614,py+1,11,6,'#c1debd');round(c,609,py-7,9,13,3,'#eb9b77');}
          if(!opened){for(let i=0;i<9;i++)ellipse(c,613,174+i*12,4,3,i%2?'#faf0c8':'#cb805d');}
          else{path(c,[[604,211],[618,223],[604,235]],'#fff3b6',4);text(c,level?'HOME':'REEF',597,253,12,'#fff5cb','center');}
          for(const s of spots){if(s.found||s===heldCargo)continue;ellipse(c,s.x,s.y+5,28,13,'#419398');wreck(c,spots.indexOf(s),s.x,s.y+Math.sin(t+s.x)*2);for(let i=0;i<3;i++){const off=(t*15+i*10)%30;ellipse(c,s.x+12+Math.sin(i+off*.15)*4,s.y-6-off,2,2,'#bae4d6');}}
          for(const w of wakes){c.globalAlpha=w.t*.55;ellipse(c,w.x,w.y,3+(1-w.t)*11,2+(1-w.t)*5,'#d5eee0');}c.globalAlpha=1;
          if(heldCargo){path(c,[[x,y],[(x+heldCargo.x)/2,(y+heldCargo.y)/2+5],[heldCargo.x,heldCargo.y]],'#faf1c8',2);wreck(c,spots.indexOf(heldCargo),heldCargo.x,heldCargo.y);}
          c.save();c.translate(x,y);c.rotate(angle);ellipse(c,0,4,20,9,'#427f83');path(c,[[-16,-10],[22,0],[-16,12],[-9,0]],'#ffedc7');path(c,[[-9,0],[22,0],[-16,12]],'#da927d');path(c,[[-9,0],[-3,-15],[8,-2]],'#fff9df');path(c,[[-9,0],[22,0]],'#a28d7b',1);c.restore();
          fx.draw(c);round(c,15,12,225,32,16,'#235966');text(c,reef.name,29,28,19,'#f9eccb','left','Georgia');text(c,(level+1)+'/2',225,29,13,'#c3e3da','right');
        }};
    }
  });

  registerGame({
    id:'brass-heron',title:'Knock on Wood',genre:'Adventure',kind:'Remix',accent:'#edb97f',best:'Either',buttons:{a:'Peck',b:'Listen'},
    description:'Be a woodpecker on a hollow tree. Break its bark, set off amber pockets, and find the three noisy chicks inside.',
    controls:'Tap or drag to peck a path. Hold a direction to climb and peck, or press A to peck ahead. B sends a ripple toward the missing chicks.',
    sources:[drive('Tap Jab Stamina Melee','The bird thrusts forward and snaps back after each tap.'),drive('Thunder Line / Circuit Line','A hit jumps down a chain of neighboring amber nodes.'),adventure('Mole Mech','Excavate persistent paths through rock and discover buried prizes.')],
    create(g){
      const grid=['.ww#Wwwww','..w#AwwCw','.wwAAw#ww','CwAw#wAGw','wwwBwwAwC'];
      const W=9,H=5,cell=55,ox=72,oy=77,fx=particles();
      let cells=grid.join('').split(''),x=0,y=1,face=1,goal=null,time=0,wait=0,poke=0,slide=null,listen=0,found=0,grubs=0,done=false;
      const chicks=[],cracks=[],bolts=[];let ending=0;
      const idx=(a,b)=>b*W+a;
      const center=(a,b)=>[ox+(a+.5)*cell,oy+(b+.5)*cell];
      function status(){g.hud(found+'/3 chicks · '+grubs+' grubs');}
      function neighbors(i){const a=i%W,b=Math.floor(i/W);return dirs.map(([dx,dy])=>[a+dx,b+dy]).filter(([cx,cy])=>cx>=0&&cx<W&&cy>=0&&cy<H).map(([cx,cy])=>idx(cx,cy));}
      function expose(i){
        const kind=cells[i];if(kind==='.'||kind==='#')return;const a=i%W,b=Math.floor(i/W),[cx,cy]=center(a,b);
        cells[i]='.';fx.burst(cx,cy,kind==='A'?'#ffcd61':'#e0a66a',13);
        if(kind==='C'){chicks.push({x:a,y:b});found++;goal=null;g.tone(700+found*75,.14);g.say(found===3?'All three chicks are out!':'A chick! Listen for another hollow.');if(found===3)ending=.85;}
        if(kind==='G'||kind==='B'){grubs++;g.say(kind==='G'?'A green inchworm! It curls around your wing.':'A fat beetle grub! Your peck is faster.');}
        if(kind==='W'){g.say('A wood mouse! Follow its seeds to a grub.');cracks.push(i);}
        status();
      }
      function knock(i){const before=cells[i];if(before==='#'){g.say('A hard knot. Go around it.');goal=null;return;}if(before==='A'){
        const q=[i],seen=new Set(q);for(let n=0;n<q.length;n++){const at=q[n];for(const v of neighbors(at)){if(cells[v]==='A'&&!seen.has(v)){seen.add(v);q.push(v);bolts.push({a:at,b:v,t:.46});}}}for(const at of q){expose(at);for(const v of neighbors(at))if(cells[v]!=='A'&&cells[v]!=='#')expose(v);}
        g.tone(530,.12);if(!found&&!grubs)g.say('Amber! The crack runs through the whole pocket.');
      }else expose(i);poke=1;g.tone(before==='A'?450:150,.06);}
      function advance(d){if(done||ending||d<0)return;face=d;const [dx,dy]=dirs[d],a=x+dx,b=y+dy;
        if(a<0||a>=W||b<0||b>=H){goal=null;return;}const i=idx(a,b);if(cells[i]!=='.')knock(i);else{slide=[x,y];x=a;y=b;poke=0;}wait=grubs?.104:.16;
      }
      function cellAt(tx,ty){const a=Math.floor((tx-ox)/cell),b=Math.floor((ty-oy)/cell);return a>=0&&b>=0&&a<W&&b<H?idx(a,b):null;}
      function nextStep(){const start=idx(x,y);if(goal===start){goal=null;return -1;}
        const open=[{i:start,d:-1,cost:0}],seen=new Set();while(open.length){open.sort((a,b)=>b.cost-a.cost);const s=open.pop();if(seen.has(s.i))continue;seen.add(s.i);if(s.i===goal)return s.d;
          for(const j of neighbors(s.i)){if(cells[j]==='#'||seen.has(j))continue;const delta=j-s.i,d=delta===1?1:delta===-1?3:delta===W?2:0;open.push({i:j,d:s.d===-1?d:s.d,cost:s.cost+(cells[j]==='.'?1:2.1)});}
        }goal=null;return -1;
      }
      function point(tx,ty){if(done||ending)return;const i=cellAt(tx,ty);if(i===null)return;if(i===idx(x,y)){listen=2;return;}if(cells[i]==='#'){g.say('Solid knot. Try a cracked patch of bark.');return;}goal=i;if(wait<=0)advance(nextStep());}
      function press(k){if(done||ending)return;const d=keys.indexOf(k);if(d>=0){goal=null;advance(d);}if(k==='a'){goal=null;advance(face);}if(k==='b'){listen=2;g.tone(530,.10);g.say('Watch for the three rippling hollows.');}}
      function chick(c,cx,cy,s){c.save();c.translate(cx,cy);c.scale(s,s);ellipse(c,0,5,10,9,'#efc65e');ellipse(c,3,-3,8,8,'#ffde83');path(c,[[9,-5],[17,-2],[9,1]],'#f38a50');ellipse(c,5,-5,1.5,2,'#442d27');path(c,[[-3,-10],[-3,-15],[1,-10]],'#f0b656',2);c.restore();}
      status();g.say('Tap the cracked hollows to peck toward them. Find three chicks.');
      return {press,tap:point,drag:point,update(dt){if(done)return;time+=dt;fx.update(dt);listen=Math.max(0,listen-dt);wait=Math.max(0,wait-dt);poke=Math.max(0,poke-dt*6);bolts.forEach(p=>p.t-=dt);while(bolts.length&&bolts[0].t<=0)bolts.shift();
        if(ending>0){ending-=dt;if(ending<=0){done=true;g.win('Three chicks follow you out of the tree. You found '+grubs+'/2 grubs'+(cracks.length?' and the wood mouse.':'.'));}return;}
        if(wait<=0){slide=null;const d=keys.findIndex(k=>g.held(k));if(d>=0){goal=null;advance(d);}else if(goal!==null)advance(nextStep());}},
        draw(c){
          sky(c,'#91bbb0','#e8d5a2');for(let i=0;i<15;i++){const ax=i*48;path(c,[[ax-25,420],[ax+5,100+(i*31)%130],[ax+39,420]],'#7e9e82');}
          const left=ox-9,right=ox+W*cell+10;path(c,[[left-17,420],[left-2,270],[left-7,135],[left-24,0],[right+10,0],[right,166],[right-4,291],[right+30,420]],'#714632');
          for(let j=0;j<16;j++){const ux=left+j*34;path(c,[[ux,0],[ux+7,42],[ux-4,65]],'#925e40',3);path(c,[[ux,368],[ux+8,391],[ux,420]],'#845538',3);}
          text(c,'Knock on Wood',ox,37,26,'#ffe7b1','left','Georgia');for(let j=0;j<3;j++)chick(c,right-30-j*25,36,found>j?1:.56);
          for(let i=0;i<cells.length;i++){
            const a=i%W,b=Math.floor(i/W),cx=ox+a*cell,cy=oy+b*cell,[px,py]=center(a,b),v=cells[i],shade=['#ad704b','#b77b53','#a86b45','#b6794f'][(a*7+b)%4];
            rect(c,cx,cy,cell+.4,cell+.4,v==='.'?'#53382d':v==='#'?'#8b583e':shade);
            if(v==='.'){ellipse(c,px+3,py+14,18,4,'#4b3027');if(cracks.includes(i)){ellipse(c,px,py+2,13,9,'#aa9991');ellipse(c,px+7,py-5,7,6,'#c0ada2');ellipse(c,px+9,py-6,1.5,2,'#3f302b');}continue;}
            for(let n=0;n<4;n++){const q=cx+6+n*13,len=13+(i*7+n*5)%21;path(c,[[q,cy+3],[q-2,cy+len*.6],[q+1,cy+len]],v==='#'?'#744634':'#97613f',1.4);}
            if(v==='#'){for(let j=0;j<3;j++){c.beginPath();c.ellipse(px,py,17-j*4,22-j*5,-.18,0,tau);c.strokeStyle='#6f4634';c.lineWidth=2;c.stroke();}}
            if(v==='A'){for(let j=-1;j<=1;j++){const uv=px+j*6;path(c,[[uv-4,py+5],[uv-2,py-4-j*3],[uv+2,py-7-j*2],[uv+5,py+6]],j%2?'#deb05d':'#f0bf63');}}
            if('CWGB'.includes(v)){ellipse(c,px,py,9,14,'#845134');path(c,[[px-5,py-12],[px,py-5],[px-4,py+1],[px+2,py+6],[px-2,py+13]],'#543929',2);if(v==='C'&&(listen||Math.sin(time*2+i)> .88)){for(let j=0;j<2;j++){c.beginPath();c.arc(px,py,13+j*6+Math.sin(time*6)*2,-.8,.8);c.strokeStyle='#ffdc82';c.lineWidth=2;c.stroke();}}}
          }
          if(cracks.length){const mouse=cracks[0],start=center(mouse%W,Math.floor(mouse/W));const grub=cells.findIndex(v=>v==='B'||v==='G');
            if(grub>=0){const end=center(grub%W,Math.floor(grub/W)),n=Math.ceil(Math.hypot(end[0]-start[0],end[1]-start[1])/20);for(let j=1;j<n;j++){const u=j/n;ellipse(c,lerp(start[0],end[0],u),lerp(start[1],end[1],u)+Math.sin(u*9)*4,2,3,'#ead098',u*5);}}}
          for(const p of bolts){const a=center(p.a%W,Math.floor(p.a/W)),b=center(p.b%W,Math.floor(p.b/W));path(c,[a,[(a[0]+b[0])*.5+4,(a[1]+b[1])*.5-5],b],'#fff4ad',3);}
          if(goal!==null){const [px,py]=center(goal%W,Math.floor(goal/W));c.beginPath();c.arc(px,py,14,0,tau);c.lineWidth=2;c.strokeStyle='#f6d294';c.stroke();}
          let px=x,py=y;if(slide&&wait){const v=1-clamp(wait/(grubs?.104:.16),0,1);px=lerp(slide[0],x,v);py=lerp(slide[1],y,v);}const [bx,by]=center(px,py),[dx,dy]=dirs[face],p=Math.sin(poke*Math.PI);
          chicks.forEach((v,j)=>chick(c,bx-14-(j%2)*13,by+14+Math.sin(time*5+j)*3,.65));c.save();c.translate(bx+dx*p*17,by+dy*p*17);if(face===3)c.scale(-1,1);
          path(c,[[-9,8],[-25,20],[-18,3]],'#283c39');ellipse(c,-3,2,15,13,'#283f3c',-.5);ellipse(c,-1,4,9,10,'#ece4c2');ellipse(c,5,-10,10,10,'#f8e9c8');path(c,[[-5,-12],[-12,-20],[1,-18],[7,-21],[13,-12]],'#d95644');path(c,[[11,-10],[25+p*4,-7],[12,-4]],'#d99d59');ellipse(c,8,-10,2,2,'#253b36');ellipse(c,-8,1,10,5,'#48625a',-.55);c.restore();fx.draw(c);
          text(c,'Hollow bark chirps. Amber cracks spread.',320,389,15,'#ffe5b2','center');
        }};
    }
  });

  registerGame({
    id:'sunpost',title:'Peach Truck',genre:'Arcade',kind:'Remix',accent:'#ffad78',best:'Either',buttons:{a:'Magnet',b:'Brake'},
    description:'Steer an old pickup down orchard roads. Scoop up peach crates, swing alongside a fruit stand, and take the next fork.',
    controls:'Drag across the road to steer or hold left and right. Tap your truck or press A to pull in nearby crates. B or down brakes. Deliver a crate to three striped stands.',
    sources:[drive('Maze Drift','Steering carries momentum, and braking cuts speed and the lateral slide.'),adventure('Night Courier','Drive a delivery vehicle to successive drop-off points.'),drive('Pocket Hole Hoarder','A magnet pulse pulls nearby objects into pickup range.')],
    create(g){
      const fx=particles(),cycle=820;
      let distance=0,lateral=0,dx=0,aim=0,velocity=90,hand=false,pulse=0,cool=0,brake=0,load=0,drops=0,passed=0,route=0,time=0,events=[],done=false,sway=0,splash=0,lastPickup=0;
      const themes=[['#ffca97','#ffdfad','#a7b778','#79a66f','#dcc193','#896754'],['#93d4d7','#f1e9bd','#80baac','#569b9e','#c2cdb0','#7b7163']];
      function status(){g.hud(drops+'/3 stands · '+load+(load===1?' crate':' crates')+' aboard');}
      function addLeg(n){const start=n*cycle,side=n%2?1:-1;
        for(const [z,lane,type] of [[155,0,'crate'],[250,side*.66,'crate'],[345,-side*.7,'crate'],[425,-side*.3,'hay'],[570,side*.75,'stand'],[738,0,'fork']])events.push({z:start+z,lane,type,done:false});}
      function project(z,lane){const q=clamp(1-z/610,0,1),scale=q*q;const bend=Math.sin((distance+z)*.004+route*.6)*25*q*(1-q)*4;
        return {x:320+bend+lane*(30+scale*214)-lateral*(7+scale*22),y:132+scale*220,s:.11+scale*.89};}
      function activate(){if(cool>0||done)return;cool=1.0;pulse=.52;g.tone(375,.08);}
      function point(x,y){if(done)return;if(y>300&&Math.abs(x-project(0,lateral).x)<37){activate();return;}hand=true;aim=clamp((x-320)/202,-1.03,1.03);}
      function peach(c,x,y,s){ellipse(c,x-s*2,y,7*s,7*s,'#f5a165');ellipse(c,x+s*2,y,6*s,7*s,'#f5ab72');ellipse(c,x+2*s,y-7*s,5*s,2*s,'#5d8969',-.45);}
      function crate(c,x,y,s){c.save();c.translate(x,y);c.scale(s,s);ellipse(c,0,0,24,5,'#a18b6a');for(let j=-1;j<2;j++)peach(c,j*10,-13+(j%2)*2,.78);path(c,[[-19,-10],[18,-10],[16,1],[-17,1]],'#a66b49');path(c,[[-17,-6],[16,-6]],'#e2a76c',2);c.restore();}
      function tree(c,x,y,s,river){rect(c,x-3*s,y-31*s,6*s,34*s,'#825e49');if(river){for(let j=0;j<3;j++)path(c,[[x-18*s+j*3*s,y-15*s-j*9*s],[x,y-48*s-j*7*s],[x+19*s-j*3*s,y-15*s-j*9*s]],['#50877c','#609888','#79a08c'][j]);}else{ellipse(c,x-6*s,y-31*s,18*s,18*s,'#6c9764');ellipse(c,x+6*s,y-40*s,19*s,18*s,'#83a767');for(let j=0;j<4;j++)ellipse(c,x+Math.sin(j*3+1)*13*s,y-(28+j*4)*s,2.6*s,2.6*s,'#e5a26a');}}
      function stand(c,x,y,s){c.save();c.translate(x,y);c.scale(s,s);ellipse(c,0,0,41,8,'#a78c6a');rect(c,-29,-55,58,50,'#ba835c');rect(c,-25,-47,50,25,'#675e4c');rect(c,-32,-20,64,17,'#a4764f');for(let j=-2;j<=2;j++)peach(c,j*8,-22,.55);for(let j=0;j<7;j++){path(c,[[-35+j*10,-65],[-25+j*10,-65],[-21+j*10,-49],[-32+j*10,-49]],j%2?'#e57c68':'#fff0c9');}round(c,-22,-86,44,17,4,'#5c7756');text(c,'FRUIT',0,-77,11,'#fff3d7','center');c.restore();}
      addLeg(0);addLeg(1);status();g.say('Steer into a peach crate. Swing left to deliver at the first striped stand.');
      return {press(k){if(k==='a')activate();if(k==='b'||k==='down')brake=.6;if(k==='left'||k==='right'){hand=false;aim=clamp(lateral+(k==='left'?-.43:.43),-1.05,1.05);}},tap:point,drag(x){hand=true;aim=clamp((x-320)/202,-1.03,1.03);},
        update(dt){if(done)return;time+=dt;fx.update(dt);cool=Math.max(0,cool-dt);pulse=Math.max(0,pulse-dt);brake=Math.max(0,brake-dt);splash=Math.max(0,splash-dt);lastPickup=Math.max(0,lastPickup-dt);
          const steer=Number(g.held('right'))-Number(g.held('left')),slow=g.held('b')||g.held('down')||brake>0;
          if(steer){aim=clamp(aim+steer*dt*2,-1.04,1.04);hand=false;}
          const grip=slow?12:7;dx=lerp(dx,(aim-lateral)*(hand?6:5),1-Math.exp(-dt*grip));lateral=clamp(lateral+dx*dt,-1.05,1.05);
          velocity=lerp(velocity,slow?45:splash?72:124,1-Math.exp(-dt*3));distance+=velocity*dt;sway=lerp(sway,dx,dt*5);
          for(const ev of events){if(ev.done)continue;const dz=ev.z-distance;
            if(ev.type==='crate'&&dz<(pulse?95:16)&&dz>-20&&Math.abs(lateral-ev.lane)<(pulse?1.12:.29)){
              load++;lastPickup=.45;ev.done=true;fx.burst(project(0,lateral).x,324,'#ffe19d',15);g.tone(555,.075);status();g.say('Crate aboard. Pull alongside the fruit stand.');continue;
            }
            if(dz>0)continue;ev.done=true;
            if(ev.type==='stand'){if(Math.abs(lateral-ev.lane)<.46&&load){load--;drops++;g.tone(750,.15);fx.burst(project(0,lateral).x,280,'#ffe4a5',28);status();g.say('Delivered! '+(drops<3?'Pick a side at the fork.':'The last stand is stocked.'));if(drops===3){done=true;g.win('Three fruit stands stocked. The truck still has '+load+' peach crate'+(load===1?'':'s')+' to take home.');return;}}
              else g.say(load?'That stand was on the '+(ev.lane<0?'left':'right')+'. Another is coming.':'You need a peach crate. Pick one up on the next stretch.');}
            if(ev.type==='hay'&&Math.abs(lateral-ev.lane)<.23){splash=.7;fx.burst(project(0,lateral).x,330,'#e9c487',18);g.tone(145,.10);}
            if(ev.type==='fork'){route=lateral<0?0:1;g.say(route?'Riverside road. Watch for the striped stand.':'Orchard road. Watch for the striped stand.');}
          }
          if(distance>=(passed+1)*cycle){passed++;events=events.filter(e=>!e.done);addLeg(passed+1);}
        },
        draw(c){
          const [top,bottom,far,grass,road,edge]=themes[route];sky(c,top,bottom);ellipse(c,487,67,38,38,'#fff0c3');
          for(let j=0;j<2;j++){const pts=[[0,153]];for(let i=0;i<=32;i++)pts.push([i*20,122+Math.sin(i*.3+distance*.0004+j)*17-j*9+Math.sin(i*.75+j)*5]);pts.push([640,158]);path(c,pts,j?'#98b19a':far);}
          rect(c,0,135,640,285,grass);if(route)path(c,[[0,140],[239,139],[165,166],[0,264]],'#7dbec1');
          for(let i=0;i<23;i++){const az=610-i*28,bz=az-28,a=project(az,-1.16),b=project(az,1.16),d=project(bz,-1.16),e=project(bz,1.16);
            path(c,[[a.x,a.y],[b.x,b.y],[e.x,e.y+1],[d.x,d.y+1]],road);
            if(Math.floor((distance+az)/60)%2===0){for(const sign of [-1,1]){const l=project(az,sign*1.08),r=project(bz,sign*1.08);path(c,[[l.x,l.y],[r.x,r.y]],'#e9d399',Math.max(1,4*r.s));}}
          }
          const left=project(0,-1.16),right=project(0,1.16);path(c,[[left.x,left.y-1],[right.x,right.y-1],[700,420],[-65,420]],road);
          const drawables=[];for(let j=0;j<20;j++){const z=((j*81-distance)%810+810)%810;if(z>600)continue;const pr=project(z,(j%2?1:-1)*(1.44+(j%3)*.28));drawables.push({z,fn:()=>tree(c,pr.x,pr.y,pr.s*1.4,route)});}
          for(const ev of events){const z=ev.z-distance;if(ev.done||z>610||z<0)continue;const {x,y,s}=project(z,ev.lane);drawables.push({z,fn:()=>{if(ev.type==='crate')crate(c,x,y,s*1.22);if(ev.type==='stand')stand(c,x,y,s);if(ev.type==='hay'){round(c,x-s*21,y-s*20,s*42,s*22,4*s,'#cba159');for(const k of [-9,9])rect(c,x+k*s,y-s*19,2*s,s*20,'#946e43');}if(ev.type==='fork'){rect(c,x-3*s,y-49*s,6*s,s*49,'#86664b');round(c,x-43*s,y-65*s,86*s,23*s,3*s,'#546f56');text(c,'‹  TREE  /  RIVER  ›',x,y-53*s,Math.max(4,8*s),'#f8eac5','center');}}});}
          drawables.sort((a,b)=>b.z-a.z).forEach(d=>d.fn());const tx=project(0,lateral).x,ty=343+Math.sin(distance*.13)*.9;
          if(pulse){c.beginPath();c.ellipse(tx,ty-8,40+(1-pulse/.52)*74,14+(1-pulse/.52)*28,0,0,tau);c.strokeStyle='#fff0aa';c.lineWidth=3;c.stroke();}
          c.save();c.translate(tx,ty);c.rotate(clamp(sway*.05,-.12,.12));ellipse(c,0,6,51,11,edge);round(c,-42,-6,14,21,4,'#3e4943');round(c,28,-6,14,21,4,'#3e4943');round(c,-35,-44,70,46,9,'#679a91');round(c,-26,-40,52,21,5,'#b7d3bb');path(c,[[-23,-38],[2,-38],[-12,-21],[-23,-21]],'#d4e3cb');round(c,-44,-19,88,28,6,'#cd7554');round(c,-40,-19,80,12,3,'#89583f');for(let i=0;i<Math.min(load,4);i++)crate(c,-25+i*16,-11-(i===Math.min(3,load-1)?Math.sin(lastPickup/.45*Math.PI)*14:0),.51);rect(c,-36,-3,72,9,'#e18d5e');for(const j of [-35,29])round(c,j,-3,7,5,1,'#f8d69a');rect(c,-42,8,84,4,'#e3c8a0');c.restore();fx.draw(c);
          round(c,15,12,153,32,16,'#526e55');text(c,route?'Riverside road':'Orchard road',29,28,18,'#fff0cc','left','Georgia');
          const next=events.find(e=>e.type==='stand'&&!e.done);if(next){text(c,next.lane<0?'‹  FRUIT STAND':'FRUIT STAND  ›',620,29,14,'#594d3e','right');}
          text(c,load+' '+(load===1?'crate':'crates')+' aboard',320,394,16,'#694c3d','center');
        }};
    }
  });

  registerGame({
    id:'hushwater-darkroom',title:'Thumbprint Pottery',genre:'Puzzle',kind:'Original',accent:'#e4a289',best:'Either',buttons:{a:'Glaze',b:'Undo'},
    description:'Shape a spinning lump of clay with your thumb. Make an egg cup, a tulip vase and a round little teapot, then dip each in glaze.',
    controls:'Drag either edge of the clay toward the dotted outline. Tap Glaze when it fits. Up and down choose height, left and right shape it, A glazes and B undoes.',
    sources:[],
    create(g){
      const pots=[
        {name:'Egg cup',widths:[69,68,57,39,29,35,46],color:'#74aaa3',dark:'#456b6d'},
        {name:'Tulip vase',widths:[36,29,33,53,69,65,43],color:'#ad89a1',dark:'#6d5874'},
        {name:'Little teapot',widths:[38,59,76,85,81,63,43],color:'#dda254',dark:'#946143'}
      ];
      const cx=301,top=103,spacing=27,fx=particles(),tol=9;
      let level=0,radii=[],chosen=3,undo=[],t=0,spin=0,phase=0,done=false,pressed=false,was=null,note='';
      const rowY=i=>top+i*spacing;
      function score(){return radii.filter((v,i)=>Math.abs(v-pots[level].widths[i])<=tol).length;}
      function status(){g.hud(pots[level].name+' · '+score()+'/7 bands shaped');}
      function setup(){radii=[47,49,51,53,53,51,49];chosen=3;undo=[];pressed=false;was=null;note='';status();g.say(level?'Follow the outline of the '+pots[level].name.toLowerCase()+'.':'Drag the clay wider at the rim and narrower in the middle. Follow the dotted outline.');}
      function tweak(i,r){const v=clamp(r,19,96),change=v-radii[i];radii[i]=v;for(const j of [i-1,i+1])if(j>=0&&j<7)radii[j]=clamp(radii[j]+change*.15,19,96);spin=1;note='';status();}
      function glaze(){if(phase||done)return;if(score()<7){chosen=radii.findIndex((v,i)=>Math.abs(v-pots[level].widths[i])>tol);note=radii[chosen]>pots[level].widths[chosen]?'Pinch the glowing band inward.':'Pull the glowing band outward.';g.say(note);g.tone(220,.08);return;}phase=2.2;pressed=false;fx.burst(cx,190,pots[level].color,32);g.tone(700,.18);g.say(['The egg fits perfectly.','The tulips stand upright.','The teapot is ready for tea.'][level]);}
      function press(k){if(done||phase)return;if(k==='up')chosen=Math.max(0,chosen-1);if(k==='down')chosen=Math.min(6,chosen+1);if(k==='left'||k==='right'){undo.push(radii.slice());tweak(chosen,radii[chosen]+(k==='left'?-5:5));}if(k==='a')glaze();if(k==='b'&&undo.length){radii=undo.pop();status();note='';}}
      function drag(x,y){if(!pressed||done||phase)return;chosen=clamp(Math.round((y-top)/spacing),0,6);tweak(chosen,Math.abs(cx-x));}
      function pot(c,px,py,scale,widths,color,dark,completed,kind){
        c.save();c.translate(px,py);c.scale(scale,scale);
        if(completed&&kind===2){c.beginPath();c.ellipse(71,83,32,37,0,0,tau);c.strokeStyle=dark;c.lineWidth=13;c.stroke();path(c,[[-56,103],[-92,79],[-112,40],[-96,43],[-78,66],[-55,73]],color);}
        c.beginPath();c.moveTo(-widths[0],0);
        for(let i=1;i<6;i++)c.quadraticCurveTo(-widths[i],i*spacing,-(widths[i]+widths[i+1])*.5,(i+.5)*spacing);
        c.lineTo(-widths[6],6*spacing);c.quadraticCurveTo(0,6*spacing+14,widths[6],6*spacing);
        for(let i=5;i>0;i--)c.quadraticCurveTo(widths[i],i*spacing,(widths[i]+widths[i-1])*.5,(i-.5)*spacing);
        c.lineTo(widths[0],0);c.closePath();
        const clay=c.createLinearGradient(-90,0,91,0);clay.addColorStop(0,dark);clay.addColorStop(.34,color);clay.addColorStop(.7,color);clay.addColorStop(1,dark);c.fillStyle=clay;c.fill();
        c.save();c.clip();for(let i=0;i<24;i++){const yp=i*8+4;c.beginPath();c.ellipse(0,yp,105,6,0,0,Math.PI);c.strokeStyle=completed?'#ffffff23':'#733d3028';c.lineWidth=1;c.stroke();}
        if(completed){for(let j=0;j<12;j++){const angle=t*.7+j*tau/12,ex=Math.sin(angle)*90;if(Math.cos(angle)>0){ellipse(c,ex,91,2+Math.cos(angle)*4,6,'#f5dfb3');ellipse(c,ex+3,107,2+Math.cos(angle)*3,4,'#eed9b3');}}}
        c.restore();ellipse(c,0,0,widths[0],7,dark);ellipse(c,0,-2,widths[0]-3,4,completed?'#473e3a':'#70473a');
        if(completed&&kind===0){ellipse(c,0,-22,23,32,'#f4dfb1',.06);ellipse(c,-6,-31,7,12,'#fff0c9',.3);}
        if(completed&&kind===1){for(let j=-1;j<=1;j++){const h=45+(j+1)%2*21;path(c,[[j*3,-2],[j*10,-h*.5],[j*16,-h]],'#668568',3);ellipse(c,j*10+5,-h*.5,8,3,'#87a378',-.55);path(c,[[j*16-9,-h-8],[j*16-5,-h-14],[j*16,-h-9],[j*16+6,-h-14],[j*16+9,-h-8],[j*16+6,-h+2],[j*16,-h+5],[j*16-6,-h+2]],['#dda3a0','#e4b575','#c88183'][j+1]);}}
        if(completed&&kind===2){ellipse(c,0,-1,41,9,color);ellipse(c,0,-10,9,7,dark);}
        c.restore();
      }
      setup();return {press,tap(x,y){if(done||phase)return;if(x>454&&x<608&&y>276&&y<330){glaze();return;}if(Math.abs(x-cx)>123||y<top-18||y>rowY(6)+18)return;pressed=true;was=radii.slice();drag(x,y);},drag,release(){if(pressed&&was)undo.push(was);pressed=false;was=null;},
        update(dt){if(done)return;t+=dt*(1+spin);spin=Math.max(0,spin-dt*2);fx.update(dt);if(phase>0){phase-=dt;if(phase<=0){phase=0;if(level===2){done=true;g.win('An egg cup, a tulip vase, and a teapot are cooling on your shelf.');}else{level++;setup();}}}},
        draw(c){
          sky(c,'#e6c7ac','#f5dfbd');rect(c,0,302,640,118,'#a36e56');rect(c,0,305,640,4,'#795741');
          for(let j=0;j<5;j++)path(c,[[0,326+j*23],[170,324+j*23],[380,328+j*23],[640,325+j*23]],'#95644e',1);
          round(c,23,26,115,236,8,'#c09a78');round(c,29,32,103,224,6,'#90aca0');rect(c,76,32,7,223,'#c6a37e');rect(c,29,129,103,6,'#c6a37e');rect(c,20,256,120,8,'#93775f');
          for(let j=0;j<4;j++){ellipse(c,47+j%2*63,244-j%3*7,10,14,'#698975',(j%2-.5)*.5);path(c,[[69,255],[49+j%2*55,233]],'#627b60',2);}
          text(c,pots[level].name,180,36,27,'#654539','left','Georgia');text(c,'PIECE  '+(level+1)+' / 3',180,63,12,'#875d50');
          ellipse(c,cx,334,120,19,'#865a44');round(c,cx-80,311,160,20,8,'#78695d');ellipse(c,cx,308,117,24,'#796f64');ellipse(c,cx,303,117,21,'#b4a28d');
          for(let j=0;j<3;j++){c.beginPath();c.ellipse(cx,303,40+j*24,6+j*4,0,0,tau);c.strokeStyle='#927e6f';c.lineWidth=1;c.stroke();}
          for(let j=0;j<7;j++){const a=t*2+j*tau/7;ellipse(c,cx+99*Math.cos(a),303+15*Math.sin(a),2.2,1.3,'#7f7064');}
          const fired=!!phase||done;pot(c,cx,top,1,radii,fired?pots[level].color:'#d9906c',fired?pots[level].dark:'#a55f48',fired,level);
          if(!fired){for(const sign of [-1,1]){c.save();c.setLineDash([3,5]);path(c,pots[level].widths.map((w,i)=>[cx+sign*w,rowY(i)]),'#fff7ce',2.5);c.restore();}
            const yy=rowY(chosen),rr=radii[chosen];for(const d of [-1,1]){ellipse(c,cx+d*rr,yy,5,5,'#fff5c8');path(c,[[cx+d*(rr+9),yy],[cx+d*(rr+19),yy]],'#8b5e4c',2);}
          }
          text(c,'GLAZE TEST',522,84,12,'#805d4c','center');for(let i=0;i<7;i++){const good=Math.abs(radii[i]-pots[level].widths[i])<=tol;round(c,474,108+i*18,96,9,4,'#cba88e');round(c,474,108+i*18,good?96:40,9,4,good?'#789784':'#d59068');if(chosen===i&&!fired)ellipse(c,462,112+i*18,3,3,'#7b574d');}
          text(c,score()+' of 7 bands',523,249,15,'#775541','center');round(c,460,281,138,43,22,score()===7?'#507c6f':'#886950');text(c,phase?'Drying…':'Glaze',529,302,18,'#fff0ce','center');
          for(let j=0;j<level;j++){pot(c,57+j*59,326,.27,pots[j].widths,pots[j].color,pots[j].dark,true,j);}
          fx.draw(c);text(c,note||'Drag the edge of the spinning clay.',320,382,16,'#ffead0','center');
        }};
    }
  });
})();

(() => {
  'use strict';
  const keys = ['up', 'right', 'down', 'left'];
  const steps = [[0,-1],[1,0],[0,1],[-1,0]];
  const tau = Math.PI * 2;
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const rect = (c,x,y,w,h,ink) => { c.fillStyle=ink; c.fillRect(x,y,w,h); };
  function text(c,s,x,y,size=15,ink='#fff4dd',align='left',font='monospace') {
    c.fillStyle=ink; c.font='bold '+size+'px '+font; c.textAlign=align; c.textBaseline='middle'; c.fillText(s,x,y);
  }
  function line(c,points,color,width=2) {
    c.beginPath(); points.forEach(([x,y],i)=>i ? c.lineTo(x,y) : c.moveTo(x,y)); c.strokeStyle=color; c.lineWidth=width; c.lineCap='round'; c.stroke();
  }
  function poly(c,points,color) {
    c.beginPath(); points.forEach(([x,y],i)=>i ? c.lineTo(x,y) : c.moveTo(x,y)); c.closePath(); c.fillStyle=color; c.fill();
  }
  function oval(c,x,y,rx,ry,color,tilt=0) {
    c.beginPath(); c.ellipse(x,y,rx,ry,tilt,0,tau); c.fillStyle=color; c.fill();
  }
  function wash(c,a,b) {
    const grad=c.createLinearGradient(0,0,0,420); grad.addColorStop(0,a); grad.addColorStop(1,b); rect(c,0,0,640,420,grad);
  }
  function heading(c,title,subtitle,accent) {
    text(c,title,24,28,25,accent,'left','Georgia'); text(c,subtitle,25,54,13);
  }
  function footer(c,s) { rect(c,0,382,640,38,'#101b25'); text(c,s,18,400,14,'#f9efd9'); }
  function selectCell(x,y,ox,oy,cell,w,h) {
    const col=Math.floor((x-ox)/cell), row=Math.floor((y-oy)/cell);
    return col>=0&&row>=0&&col<w&&row<h ? row*w+col : -1;
  }
  const drive=(name,role)=>[name,'Drive',role];
  registerGame({
    id:'reedwire',title:'Reedwire Conservatory',genre:'Puzzle',kind:'Remix',accent:'#a9e0a2',best:'Touch',
    description:'Restore three night-blooming specimens by turning their copper stems into living circuits.',
    controls:'Tap a tile or select it with the D-pad and press A to rotate. B spends lantern oil to reveal the route.',
    sources:[drive('Mobile Tetromino Board','Quarter-turn pieces already placed on a board.'),drive('Thunder Line / Circuit Line','Carry a pulse along a chain of connected objects.'),['Lantern Deep','PR #34','Spend a limited supply of lantern oil to expose a hidden route.']],
    create(g) {
      const paths=[[6,7,13,14,8,9,10,16,17],[18,19,13,7,8,14,15,9,3,4,10,11],[0,6,12,13,7,8,14,20,21,15,9,10,16,17]];
      const names=['Vesper fern','Bell orchid','Glass anemone'];
      const cell=65,ox=24,oy=88;
      let level=0,tiles=[],route,focus=0,lit=new Set(),lamp=0,oil=2,time=0,bloom=0,done=false;
      function facing(a,b) {return a+6===b?2:a-6===b?0:a+1===b?1:3;}
      function setup() {
        route=paths[level]; focus=route[0]; oil=2; lamp=0; bloom=0;
        tiles=Array.from({length:24},(_,i)=>{
          const p=route.indexOf(i);
          if(p<0) return {shape:[0,((i+level)%3===1?2:1)],turn:(i*7+level)%4};
          return {shape:[p===0?3:facing(i,route[p-1]),p===route.length-1?1:facing(i,route[p+1])],turn:(i*7+p+level+1)%4};
        }); circuit();
      }
      function ports(i){ return tiles[i].shape.map(d=>(d+tiles[i].turn)%4); }
      function circuit() {
        lit=new Set(); if(ports(route[0]).includes(3)) {
          const todo=[route[0]]; lit.add(route[0]);
          while(todo.length) {
            const i=todo.pop(); for(const d of ports(i)) {
              const [dx,dy]=steps[d],x=i%6+dx,y=Math.floor(i/6)+dy,j=y*6+x;
              if(x>=0&&x<6&&y>=0&&y<4&&!lit.has(j)&&ports(j).includes((d+2)%4)){lit.add(j);todo.push(j);}
            }
          }
        }
        const end=route[route.length-1];
        if(lit.has(end)&&ports(end).includes(1)){bloom=1.15;g.tone(660,.23);g.say(names[level]+' is flowering.');}
        g.hud('Glasshouse '+(level+1)+'/3  ·  Oil '+oil);
      }
      function press(k){
        if(done||bloom>0)return;
        const d=keys.indexOf(k);
        if(d>=0){const [dx,dy]=steps[d];focus=clamp(focus%6+dx,0,5)+6*clamp(Math.floor(focus/6)+dy,0,3);}
        if(k==='a'){tiles[focus].turn=(tiles[focus].turn+1)%4;g.tone(220+focus*8,.045);circuit();}
        if(k==='b'){if(oil>0){oil--;lamp=4;circuit();}else g.say('The lantern is empty. Follow the copper stems.');}
      }
      setup();
      return {press,tap(x,y){const i=selectCell(x,y,ox,oy,cell,6,4);if(i>=0){focus=i;press('a');}else if(x>430)press('b');},
        update(dt){time+=dt;lamp=Math.max(0,lamp-dt);if(bloom>0){bloom-=dt;if(bloom<=0){if(++level===3){done=true;level=2;g.win('All three night flowers open. The glasshouse starts breathing again.');}else setup();}}},
        draw(c){
          wash(c,'#183f39','#092624');heading(c,'Reedwire Conservatory','GLASSHOUSE '+(level+1)+'  /  '+names[level].toUpperCase(),'#b9edb3');
          for(let i=0;i<24;i++){const x=ox+i%6*cell,y=oy+Math.floor(i/6)*cell,cx=x+32,cy=y+32;
            rect(c,x+1,y+1,63,63,focus===i?'#5c7554':(i%2?'#274738':'#294b40'));
            if(lamp&&route.includes(i)){for(const d of tiles[i].shape){const [dx,dy]=steps[d];line(c,[[cx,cy],[cx+dx*31,cy+dy*31]],'#9ba176',14);}}
            for(const d of ports(i)){const [dx,dy]=steps[d];line(c,[[cx,cy],[cx+dx*31,cy+dy*31]],lit.has(i)?'#e5f6a3':'#aa906e',7);}
            oval(c,cx,cy,6,6,lit.has(i)?'#faffb0':'#deb990');
            if(focus===i){c.strokeStyle='#f4eebc';c.lineWidth=2;c.strokeRect(x+3,y+3,59,59);}
          }
          const startY=oy+Math.floor(route[0]/6)*cell+32,endY=oy+Math.floor(route[route.length-1]/6)*cell+32;
          poly(c,[[5,startY-9],[20,startY],[5,startY+9]],'#f8e383');line(c,[[414,endY],[426,endY],[434,endY-8]],'#e7c086',4);
          const bx=526,by=275;oval(c,bx,324,73,11,'#18382b');
          poly(c,[[482,276],[567,276],[554,323],[497,323]],'#9f684f');rect(c,477,269,95,11,'#d49a70');
          for(let j=0;j<5;j++){const ex=bx+Math.sin(j*2.4+level)*45,ey=by-48-j*21;
            line(c,[[bx,by],[bx+(ex-bx)*.4,ey+20],[ex,ey]],'#86b88b',4);
            oval(c,ex-7,ey+6,12,5,'#79a58c',-.45);oval(c,ex+8,ey+3,13,5,'#99c78f',.4);
            const spread=bloom>0||done?10:4;for(let n=0;n<5;n++)oval(c,ex+Math.cos(n*tau/5+time*.14)*spread,ey+Math.sin(n*tau/5+time*.14)*spread,6,5,['#dbafa8','#edcc8c','#c5b9f0'][level]);
          }
          text(c,'B  LANTERN ×'+oil,527,353,13,'#eee5ae','center');footer(c,lamp?'The pale traces show the original stems.':'Join the inlet arrow to the brass outlet.');}
      };
    }
  });
  registerGame({
    id:'paper-nautilus',title:'Paper Nautilus',genre:'Adventure',kind:'Remix',accent:'#80cee2',best:'Either',
    description:'Pilot a folded-paper salvage boat. Play the wind in your hand to recover three pearls from each reef.',
    controls:'D-pad or tap the chart to aim. B selects a card, A plays it. Tap a card to play it directly.',
    sources:[drive('Bone Choir × Deck Dash','Three-card hand with spent cards returning through a discard cycle.'),drive('Air Dash Arcana','A directed burst carries the boat across an intervening reef.'),['MAGNET','PR #35','Pull a pearl toward the boat along the selected bearing.']],
    create(g){
      const charts=[
        ['..*..#.','.#.#...','S.#.*.D','..#.#..','...*...'],
        ['.*.#..D','.#..#..','..#.*#.','S#.....','...#.*.']
      ];
      const cardNames=['Oar','Gust','Hook'],cardRules=['Sail 1 square','Leap 2 squares','Pull within 2'];
      const inks=['#b1dbcc','#e8cda7','#f0ac95'],cell=52,ox=21,oy=76;
      let level=0,x,y,headingDir=1,hand,deck,selected,pearls,phase=0,trail=null,time=0,done=false,note='';
      function setup(){
        hand=[0,1,2]; deck=[1,2,0]; selected=0;pearls=new Set();trail=null;note='Bring the pearls to the striped pier.';
        charts[level].forEach((row,r)=>[...row].forEach((v,col)=>{if(v==='S'){x=col;y=r;} if(v==='*')pearls.add(r*7+col);}));
        g.hud('Chart '+(level+1)+'/2  ·  Pearls 0/3');
      }
      function water(nx,ny){return nx>=0&&nx<7&&ny>=0&&ny<5&&charts[level][ny][nx]!=='#';}
      function play(){
        if(done||phase)return;
        const card=hand[selected], [dx,dy]=steps[headingDir],oldX=x,oldY=y;
        if(card===2){
          let pulled=false;for(let n=1;n<=2;n++){
            const px=x+dx*n,py=y+dy*n;if(!water(px,py))break;
            if(pearls.delete(py*7+px)){trail={x:px,y:py,px:x,py:y,t:.45};pulled=true;break;}
          }
          note=pulled?'A pearl rolls into the hold.':'Aim the hook down a clear line.';
        }else{
          const dist=card+1,nx=x+dx*dist,ny=y+dy*dist;
          if(water(nx,ny)){x=nx;y=ny;trail={x:oldX,y:oldY,px:x,py:y,t:.35};note='';}
          else note='No safe landing on that bearing.';
        }
        deck.push(card);hand[selected]=deck.shift();g.tone([285,440,610][card],.1);
        g.hud('Chart '+(level+1)+'/2  ·  Pearls '+(3-pearls.size)+'/3');
        if(!pearls.size&&charts[level][y][x]==='D'){phase=.8;note='Cargo secured at the pier.';}
        else if(!pearls.size)note='All aboard. Sail to the striped pier.';
      }
      function press(k){if(done||phase)return;const d=keys.indexOf(k);if(d>=0)headingDir=d;if(k==='a')play();if(k==='b')selected=(selected+1)%3;}
      function pearl(c,cx,cy){oval(c,cx,cy+4,13,7,'#396e7b');oval(c,cx,cy,8,8,'#f4dcbe');oval(c,cx-2,cy-3,3,2,'#fffbe4');}
      setup();
      return {press,tap(tx,ty){
        if(ty>=200&&ty<353&&tx>=408){selected=clamp(Math.floor((ty-200)/50),0,2);play();return;}
        const id=selectCell(tx,ty,ox,oy,cell,7,5);if(id<0)return;const dx=id%7-x,dy=Math.floor(id/7)-y;
        if(dx||dy)headingDir=Math.abs(dx)>Math.abs(dy)?(dx>0?1:3):(dy>0?2:0);
      },update(dt){time+=dt;if(trail){trail.t-=dt;if(trail.t<=0)trail=null;}if(phase){phase=Math.max(0,phase-dt);if(!phase){if(level===1){done=true;g.win('Six moon pearls make a fine cargo for a boat folded from a single page.');}else{level++;setup();}}}},
        draw(c){
          wash(c,'#18394c','#407884');heading(c,'Paper Nautilus',['THE TEACUP SHOALS','THE NEEDLE PASSAGE'][level],'#e2eee0');
          for(let r=0;r<5;r++)for(let col=0;col<7;col++){const px=ox+col*cell,py=oy+r*cell,cx=px+26,cy=py+26;
            rect(c,px,py,51,51,(r+col)%2?'#3c7480':'#447d86');
            for(let a=0;a<2;a++){const s=Math.sin(time*1.2+col+r+a)*2;line(c,[[px+5+a*20,py+12+a*24+s],[px+9+a*20,py+13+a*24+s],[px+15+a*20,py+12+a*24+s]],'#72a5a4',1);}
            const v=charts[level][r][col];if(v==='#'){poly(c,[[px+5,py+39],[px+19,py+13],[px+37,py+9],[px+48,py+37]],'#c6b89a');poly(c,[[px+19,py+13],[px+29,py+39],[px+48,py+37],[px+37,py+9]],'#827e76');}
            if(v==='D'){rect(c,px+7,py+14,37,24,'#674e42');for(let j=0;j<4;j++)rect(c,px+8+j*9,py+14,5,24,'#f5cf9f');}
            if(pearls.has(r*7+col))pearl(c,cx,cy);
          }
          const cx=ox+x*cell+26,cy=oy+y*cell+26;
          if(trail)line(c,[[ox+trail.x*cell+26,oy+trail.y*cell+26],[ox+trail.px*cell+26,oy+trail.py*cell+26]],'#bdd7cc',3);
          c.save();c.translate(cx,cy);c.rotate((headingDir-1)*Math.PI/2);
          poly(c,[[-17,-9],[20,0],[-17,11],[-8,0]],'#fff5d9');poly(c,[[-8,0],[20,0],[-17,11]],'#d7a793');line(c,[[-12,-5],[14,0],[-8,0]],'#897d76',1);c.restore();
          text(c,'SALVAGE LOG',410,92,16,'#e8d8b7');text(c,(3-pearls.size)+' / 3 pearls',410,123,23,'#fff5dd','left','Georgia');
          text(c,'Bearing  '+['N','E','S','W'][headingDir],410,156,16);text(c,'YOUR HAND',410,185,13,'#a4d5d2');
          hand.forEach((v,i)=>{const py=200+i*50;rect(c,409,py,207,43,selected===i?inks[v]:'#254a57');text(c,cardNames[v],421,py+14,18,selected===i?'#182c35':'#f5efdf','left','Georgia');text(c,cardRules[v],421,py+31,12,selected===i?'#29444d':'#c7e1d7');});
          footer(c,note||'Aim on the chart, then play a card.');}
      };
    }
  });
  registerGame({
    id:'brass-heron',title:'The Brass Heron',genre:'Adventure',kind:'Remix',accent:'#f1b582',best:'Backbone',
    description:'Break into two flooded clock towers. Vault the gaps, fish out a key, and draw the heron away from its gate.',
    controls:'D-pad steps and faces. A reaches for a nearby key or vaults a gap. B throws a decoy coin two squares ahead.',
    sources:[drive('Tap Jab Stamina Melee','A short out-and-back thrust snags a key from its hook.'),drive('Air Dash Arcana','A burst along the facing direction crosses flooded floor.'),['Clockwork Heist','PR #34','A tossed coin draws a clockwork guard away from its post.']],
    create(g){
      const rooms=[['##########','#S.~.K#..#','#..~..W.E#','#..~..#..#','##########'],['##########','#E..#K~..#','#...W.~..#','#...#.~.S#','##########']];
      const cell=55,ox=45,oy=85;
      let level=0,x,y,face,hasKey,turns,coin,guard,phase=0,done=false,time=0,reach=0,info='';
      function tile(a,b){return rooms[level][b]?.[a]||'#';}
      function setup(){face=level?3:1;hasKey=false;turns=0;coin=null;info='Find the key hanging beside the water.';
        rooms[level].forEach((row,r)=>[...row].forEach((v,col)=>{if(v==='S'){x=col;y=r;}if(v==='W')guard=[col,r];}));status();}
      function status(){g.hud('Tower '+(level+1)+'/2  ·  '+(hasKey?'Key recovered':'Find the key')+(turns?'  ·  Guard away '+turns:''));}
      function tick(){if(turns>0&&--turns===0){coin=null;info='The heron has returned to its gate.';}status();}
      function move(nx,ny){const t=tile(nx,ny);if(t==='#')return false;if(t==='~'){info='A vault will carry you over this gap.';return false;}
        if(t==='K'&&!hasKey){info='A short reach will lift the key.';return false;}
        if(t==='W'&&(!hasKey||!turns)){info=hasKey?'The heron blocks you. Throw a coin nearby.':'The gate needs its brass key.';return false;}
        x=nx;y=ny;info='';tick();if(t==='E'){phase=.8;info='The clock door swings open.';}return true;}
      function press(k){
        if(done||phase)return;const d=keys.indexOf(k);if(d>=0){face=d;const [dx,dy]=steps[d];move(x+dx,y+dy);return;}
        const [dx,dy]=steps[face],nx=x+dx,ny=y+dy;
        if(k==='a'){reach=.35;if(tile(nx,ny)==='K'&&!hasKey){hasKey=true;info='The key slips free.';tick();g.tone(650,.15);}
          else if(tile(nx,ny)==='~'&&move(nx+dx,ny+dy)){info='You landed on dry brass.';g.tone(375,.1);}
          else info='Face a key or a water gap, then use A.';}
        if(k==='b'){
          const tx=x+dx*2,ty=y+dy*2;
          if(Math.abs(guard[0]-tx)+Math.abs(guard[1]-ty)>3){info='The coin is too far away for the heron to hear.';return;}
          const at=tile(tx,ty);if(at==='#'||at==='~'||at==='W'){info='Aim the coin at dry floor near the gate.';return;}
          coin=[tx,ty];turns=6;info='The heron follows the ringing coin.';g.tone(835,.12);status();
        }
      }
      setup();
      return {press,tap(tx,ty){const i=selectCell(tx,ty,ox,oy,cell,10,5);if(i<0)return;
        const dx=i%10-x,dy=Math.floor(i/10)-y;if(!dx&&!dy){press('a');return;}
        const d=Math.abs(dx)>Math.abs(dy)?(dx>0?1:3):(dy>0?2:0);face=d;
        if(Math.abs(dx)+Math.abs(dy)>1)press('b');else if(['~','K'].includes(tile(x+steps[d][0],y+steps[d][1])))press('a');else press(keys[d]);
      },update(dt){time+=dt;reach=Math.max(0,reach-dt);if(phase){phase=Math.max(0,phase-dt);if(!phase){if(level){done=true;g.win('You wind the great escapement. Two silent towers strike the hour together.');}else{level++;setup();}}}},
        draw(c){wash(c,'#392d35','#282535');heading(c,'The Brass Heron',['THE WEST ESCAPEMENT','THE EAST ESCAPEMENT'][level],'#ffcf99');
          rooms[level].forEach((row,r)=>[...row].forEach((v,col)=>{const px=ox+col*cell,py=oy+r*cell,cx=px+27,cy=py+27;
            rect(c,px+1,py+1,53,53,v==='#'?'#3e3741':(r+col)%2?'#82675b':'#76605a');
            if(v==='#'){line(c,[[px+6,py+43],[px+6,py+10],[px+47,py+10]],'#61505a',2);oval(c,px+45,py+42,2,2,'#a48570');}
            if(v==='~'){rect(c,px,py,cell,cell,'#294c58');for(let j=0;j<3;j++){let a=Math.sin(time*2+j)*3;line(c,[[px+8,py+10+14*j],[px+22,py+11+14*j+a],[px+44,py+10+14*j]],'#699294',2);}}
            if(v==='E'){poly(c,[[cx-16,cy+17],[cx-16,cy-6],[cx,cy-20],[cx+16,cy-6],[cx+16,cy+17]],'#422f37');line(c,[[cx-12,cy+15],[cx-12,cy-4],[cx,cy-14],[cx+12,cy-4],[cx+12,cy+14]],'#f1c383',3);}
            if(v==='K'&&!hasKey){oval(c,cx-6,cy-4,8,8,'#f5d17a');oval(c,cx-6,cy-4,4,4,'#76605a');line(c,[[cx,cy],[cx+13,cy+8],[cx+11,cy+13]],'#f5d17a',4);}
            if(v==='W')for(let j=0;j<4;j++)rect(c,px+6+j*12,py+4,4,turns?7:46,'#c89c78');
          }));
          const gx=ox+(coin?coin[0]:guard[0])*cell+26,gy=oy+(coin?coin[1]:guard[1])*cell+26;
          if(coin)oval(c,gx+13,gy+13,5,3,'#ffe485');line(c,[[gx-4,gy],[gx-7,gy+15],[gx-12,gy+15]],'#e4bd7d',2);line(c,[[gx+3,gy],[gx+5,gy+17],[gx+1,gy+17]],'#deb77b',2);
          oval(c,gx,gy,13,7,'#d0a471',-.28);line(c,[[gx+7,gy-2],[gx+4,gy-14],[gx+11,gy-19]],'#e8c18c',4);
          poly(c,[[gx+10,gy-20],[gx+24,gy-18],[gx+10,gy-16]],'#d78c62');
          const cx=ox+x*cell+27,cy=oy+y*cell+27,[dx,dy]=steps[face];oval(c,cx,cy+12,15,5,'#56464c');
          poly(c,[[cx,cy-10],[cx-12,cy+13],[cx+11,cy+13]],'#324352');oval(c,cx,cy-9,7,8,'#ead5b9');rect(c,cx-10,cy-14,19,3,'#324352');
          line(c,[[cx+4,cy],[cx+dx*(reach?30:15),cy+dy*(reach?30:15)]],'#ffe9bd',3);
          footer(c,info||'Follow the striped gate to the clock door.');}
      };
    }
  });
  registerGame({
    id:'sunpost',title:'Sunpost Slipway',genre:'Adventure',kind:'Remix',accent:'#ffb190',best:'Backbone',
    description:'Carry the last ember across a fjord. Skid around basalt islands and relight the cairns before the fog closes.',
    controls:'Hold a direction to steer. A gusts forward, B brakes. Tap a point to steer there.',
    sources:[drive('Maze Drift Handbrake Test','Inertial steering with a handbrake slide on sharp turns.'),drive('Air Dash Arcana','A short directional gust adds speed along the current heading.'),['Lantern Deep','PR #34','A draining lamp limits each crossing and cairns restore its oil.']],
    create(g){
      const posts=[[88,235],[430,115],[725,315],[1035,150],[1380,300],[1580,130]];
      const rocks=[[260,235,51,30],[365,52,65,29],[531,277,60,47],[630,131,75,39],[810,220,55,28],[946,352,70,27],[1110,252,55,31],[1240,137,78,40],[1460,220,43,24]];
      let x=posts[0][0],y=posts[0][1],vx=0,vy=0,face=0,goal=1,oil=19,cooldown=0,skid=0,time=0,aim=null,done=false,cam=0,wake=[],interval=0,lastHud='';
      function light(){if(done)return;goal++;g.tone(430+goal*70,.22);oil=19;if(goal===posts.length){done=true;g.win('Five answering fires mark a safe way through the winter fjord.');}else g.say('Cairn lit. Oil replenished.');}
      function reset(){[x,y]=posts[goal-1];vx=0;vy=0;oil=19;aim=null;wake=[];g.say('The last lit cairn guides you back.');}
      function press(k){if(done)return;if(keys.includes(k))aim=null;if(k==='a'&&cooldown<=0){vx+=Math.cos(face)*132;vy+=Math.sin(face)*132;cooldown=1.1;g.tone(465,.11);}if(k==='b'){vx*=.35;vy*=.35;skid=.3;}}
      function mountain(c,base,h,step,shift,color){const pts=[[-25,base]];for(let i=-1;i<19;i++)pts.push([i*step-shift,base-h*(.25+.75*Math.abs(Math.sin(i*2.78+.4)))]);pts.push([675,base]);poly(c,pts,color);}
      return {press,tap(tx,ty){if(ty>=65&&ty<380)aim=[tx+cam,ty];},
        update(dt){if(done)return;time+=dt;oil-=dt;cooldown-=dt;skid=Math.max(0,skid-dt);
          let hx=(g.held('right')?1:0)-(g.held('left')?1:0),hy=(g.held('down')?1:0)-(g.held('up')?1:0);
          if(hx||hy)aim=null;else if(aim){hx=aim[0]-x;hy=aim[1]-y;if(Math.hypot(hx,hy)<8){aim=null;vx*=.5;vy*=.5;hx=0;hy=0;}}
          if(hx||hy){const next=Math.atan2(hy,hx),ang=Math.atan2(Math.sin(next-face),Math.cos(next-face));if(Math.abs(ang)>1.6&&Math.hypot(vx,vy)>50)skid=.35;face=next;
            vx+=Math.cos(face)*200*dt;vy+=Math.sin(face)*200*dt;}
          const drag=Math.exp(-(skid?1.1:1.7)*dt);vx*=drag;vy*=drag;x=clamp(x+vx*dt,20,1630);y=clamp(y+vy*dt,79,360);
          for(const [rx,ry,rw,rh] of rocks){const dx=(x-rx)/rw,dy=(y-ry)/rh,dist=Math.hypot(dx,dy);
            if(dist<1&&dist>.001){x=rx+dx/dist*(rw+1);y=ry+dy/dist*(rh+1);const n=Math.atan2(dy/rh,dx/rw),dot=vx*Math.cos(n)+vy*Math.sin(n);if(dot<0){vx-=1.5*dot*Math.cos(n);vy-=1.5*dot*Math.sin(n);oil-=.15;}skid=.2;}}
          if(Math.hypot(x-posts[goal][0],y-posts[goal][1])<28)light();
          if(!done&&oil<=0)reset();
          cam=clamp(x-193,0,1010);interval+=dt;if(interval>.065){wake.push([x,y,1]);interval=0;}wake=wake.filter(w=>(w[2]-=dt)>0);
          const h='Fires '+Math.min(goal-1,5)+'/5  ·  Oil '+Math.max(0,Math.ceil(oil))+'s';if(h!==lastHud){g.hud(h);lastHud=h;}
        },
        draw(c){wash(c,'#dc987b','#66768a');oval(c,542-cam*.09,74,43,43,'#f3c79b');mountain(c,101,45,58,(cam*.13)%58,'#8b7881');mountain(c,109,35,47,(cam*.23)%47,'#616c7c');rect(c,0,106,640,277,'#485e70');
          for(let i=0;i<52;i++){const px=((i*113-cam*.93)%680+680)%680-20,py=115+(i*67)%253;line(c,[[px,py],[px+7+(i%5)*4,py+(Math.sin(time+i)*1.3)]],i%3?'#59798a':'#7c9096',1.4);}
          for(const [rx,ry,rw,rh] of rocks){const px=rx-cam;if(px<-100||px>740)continue;oval(c,px,ry+6,rw+6,rh*.7,'#97aab0');
            poly(c,[[px-rw,ry],[px-rw*.68,ry-rh],[px-rw*.13,ry-rh*1.3],[px+rw*.3,ry-rh*.72],[px+rw*.65,ry-rh*.8],[px+rw,ry+4],[px+rw*.3,ry+rh*.65],[px-rw*.55,ry+rh*.52]],'#49505a');
            poly(c,[[px-rw,ry],[px-rw*.68,ry-rh],[px-rw*.13,ry-rh*1.3],[px-rw*.27,ry-rh*.3]],'#b6a6a2');}
          posts.forEach(([xx,yy],i)=>{const px=xx-cam;if(px<-40||px>680)return;oval(c,px,yy+9,19,7,'#a6b0af');poly(c,[[px-12,yy+7],[px-6,yy-9],[px+7,yy-9],[px+12,yy+7]],'#6b6262');
            if(i<goal){poly(c,[[px-7,yy-9],[px+1,yy-28-Math.sin(time*7+i)*3],[px+7,yy-9]],'#ffc482');}
            if(i===goal){c.strokeStyle='#ffdb9c';c.lineWidth=2;c.beginPath();c.ellipse(px,yy,25+Math.sin(time*3)*2,17,0,0,tau);c.stroke();text(c,'LIGHT',px,yy-33,12,'#fff2c5','center');}
          });
          for(const [wx,wy,w] of wake)oval(c,wx-cam,wy+2,3+w*3,2,'rgba(215,235,226,'+(w*.5)+')');
          c.save();c.translate(x-cam,y);c.rotate(face);poly(c,[[-15,-8],[18,0],[-15,8],[-9,0]],'#e4c6a5');poly(c,[[-10,-5],[12,0],[-8,3]],'#815d54');oval(c,-3,-1,4,3,'#ffd078');c.restore();
          rect(c,0,0,640,58,'#283743');text(c,'Sunpost Slipway',18,21,22,'#ffcf9e','left','Georgia');
          const p=posts[Math.min(goal,posts.length-1)],angle=Math.atan2(p[1]-y,p[0]-x);
          text(c,'NEXT FIRE',460,22,13,'#e0e9dc');c.save();c.translate(563,22);c.rotate(angle);poly(c,[[-7,-6],[10,0],[-7,6]],'#ffcf91');c.restore();rect(c,18,40,604,4,'#465967');rect(c,18,40,604*clamp(oil/19,0,1),4,'#e6ad81');
          footer(c,'Steer to the gold ring. A gusts · B brakes.');}
      };
    }
  });
  registerGame({
    id:'hushwater-darkroom',title:'Hushwater Darkroom',genre:'Puzzle',kind:'Original',accent:'#f6c49f',best:'Touch',
    description:'Develop three lost field photographs. Layer a set of glass negatives until the print matches the archivist’s contact sheet.',
    controls:'Tap a film slide to advance it. Left and right select a slide. A advances and B rewinds. Two overlapping exposures cancel.',
    sources:[],
    create(g){
      const plates=[
        {name:'Fox at the fence',rows:['10001','11011','11111','01110','00100'],answer:[1,2,1]},
        {name:'Whale in the sound',rows:['00000','01101','11111','11110','01100'],answer:[2,1,3]},
        {name:'Heron at low tide',rows:['00110','00100','11100','01100','01010'],answer:[3,2,2]}
      ];
      const inks=['#e6b48e','#edb6b2','#c7b3d3'];
      let level=0,slide=0,values,layers,target,clock=0,bleach=0,done=false;
      function sheet(){return target.map((_,i)=>layers.reduce((a,layer,j)=>a^layer[values[j]][i],0));}
      function setup(){
        const p=plates[level];target=p.rows.join('').split('').map(Number);values=[0,0,0];slide=0;
        layers=Array.from({length:3},(_,j)=>Array.from({length:4},(_,v)=>target.map((pixel,i)=>{
          const row=Math.floor(i/5),col=i%5;
          if(v===p.answer[j])return (row+col*2+level)%3===j?pixel:0;
          const index=col*17+row*7+j*11+v*3+level*13;
          return (index%11<3 || (col===v&&row===j))?1:0;
        })));
        g.hud('Print '+(level+1)+'/3  ·  '+p.name);
      }
      function expose(delta){if(done||bleach)return;values[slide]=(values[slide]+delta+4)%4;g.tone(170+values[slide]*45+slide*30,.06);
        if(sheet().every((v,i)=>v===target[i])){bleach=1.2;g.tone(650,.2);g.say('The image fixes in the bath.');}}
      function press(k){if(k==='left')slide=(slide+2)%3;if(k==='right')slide=(slide+1)%3;if(k==='a'||k==='up')expose(1);if(k==='b'||k==='down')expose(-1);}
      function pixels(c,arr,x,y,cell,on,off){for(let i=0;i<25;i++)rect(c,x+i%5*cell,y+Math.floor(i/5)*cell,cell-1,cell-1,arr[i]?on:off);}
      setup();
      return {press,tap(tx,ty){if(ty>=264&&ty<371&&tx>=25&&tx<613){slide=clamp(Math.floor((tx-25)/196),0,2);expose(1);}},
        update(dt){clock+=dt;if(bleach){bleach=Math.max(0,bleach-dt);if(!bleach){if(level===2){done=true;g.win('Fox, whale, heron. Three lost sightings return to the Hushwater field archive.');}else{level++;setup();}}}},
        draw(c){wash(c,'#603c42','#271f32');heading(c,'Hushwater Darkroom','FIELD PLATE '+(level+1)+'  /  '+plates[level].name.toUpperCase(),'#fbd4ab');
          const sway=Math.sin(clock*.7)*2;
          line(c,[[0,72],[173,81+sway],[340,83],[465,81-sway],[640,70]],'#c8a68e',2);
          function paper(x,title,arr,on,off){rect(c,x+4,88,162,166,'#302839');rect(c,x,84,162,166,'#e6cfab');pixels(c,arr,x+22,96,24,on,off);text(c,title,x+81,233,13,'#624d50','center');
            rect(c,x+73,76,16,17,'#8f7267');rect(c,x+78,74,5,12,'#573e42');}
          paper(84,'WET PRINT',sheet(),bleach?'#6d484e':'#784758','#dcbca8');paper(394,'CONTACT SHEET',target,'#685466','#e5d4b9');
          text(c,'=',320,162,28,'#e3b9ac','center','Georgia');
          for(let j=0;j<3;j++){const px=25+j*196,py=271;rect(c,px,py,184,94,j===slide?'#d7b39e':'#846d74');rect(c,px+4,py+4,176,86,'#493d4b');
            for(let n=0;n<8;n++){rect(c,px+9+n*22,py+7,10,4,'#bea795');rect(c,px+9+n*22,py+83,10,4,'#bea795');}
            pixels(c,layers[j][values[j]],px+13,py+19,11,inks[j],'#584452');
            text(c,['SKY','REED','SILT'][j],px+80,py+32,17,inks[j]);text(c,'Gate '+(values[j]+1)+'/4',px+80,py+56,14,'#eee2d0');}
          footer(c,'Match the contact sheet. Overlapping marks cancel.');}
      };
    }
  });
})();

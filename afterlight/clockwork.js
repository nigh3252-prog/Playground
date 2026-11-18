(() => {
  'use strict';

  const W = 640, H = 420;
  const dirs = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
  const steps = Object.values(dirs);
  const beside = (p, d) => [p[0] + d[0], p[1] + d[1]];
  const same = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];
  const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
  const at = (r, p) => r[p[1]]?.[p[0]] || '#';
  function locate(r, symbol) {
    const found = [];
    r.forEach((row, y) => Array.from(row).forEach((v, x) => { if (v === symbol) found.push([x, y]); }));
    return found;
  }
  function layout(r) {
    const s = Math.min(45, Math.floor(558 / r[0].length), Math.floor(262 / r.length));
    return { s, x: Math.floor((W - s * r[0].length) / 2), y: Math.floor(188 - s * r.length / 2) };
  }
  function point(l, p) { return [l.x + (p[0] + .5) * l.s, l.y + (p[1] + .5) * l.s]; }
  function rect(c, x, y, w, h, col) { c.fillStyle = col; c.fillRect(x, y, w, h); }
  function line(c, x, y, u, v, col, width = 1) {
    c.strokeStyle = col; c.lineWidth = width; c.beginPath(); c.moveTo(x, y); c.lineTo(u, v); c.stroke();
  }
  function dot(c, x, y, radius, col) { c.fillStyle = col; c.beginPath(); c.arc(x,y,radius,0,Math.PI*2); c.fill(); }
  function ring(c,x,y,r,col,width=1) { c.strokeStyle=col; c.lineWidth=width; c.beginPath(); c.arc(x,y,r,0,Math.PI*2); c.stroke(); }
  function poly(c, pts, col) { c.fillStyle=col; c.beginPath(); pts.forEach(([x,y],i) => i ? c.lineTo(x,y) : c.moveTo(x,y)); c.closePath(); c.fill(); }
  function text(c,t,x,y,size,col,align='left',bold=false) {
    c.font=(bold?'bold ':'')+size+'px monospace'; c.textAlign=align; c.textBaseline='middle'; c.fillStyle=col; c.fillText(t,x,y);
  }
  function frame(c, room, subtitle, accent, bg) {
    rect(c,0,0,W,H,bg); line(c,22,45,618,45,accent+'77');
    text(c,room,22,25,16,'#fbf3df','left',true); text(c,subtitle,616,25,12,accent,'right');
  }
  function lower(c,a,b,accent) {
    line(c,22,339,618,339,accent+'77'); text(c,a,320,360,13,'#faf3e2','center',true);
    text(c,b,320,391,12,accent,'center');
  }
  function tilemap(c,r,l,fn) {
    r.forEach((row,y)=>Array.from(row).forEach((v,x)=>{const [u,w]=point(l,[x,y]); fn(v,x,y,u,w,l.s);}));
  }
  function adjacentTap(l,p,x,y,press) {
    const dest=[Math.floor((x-l.x)/l.s),Math.floor((y-l.y)/l.s)];
    for(const key in dirs) if(same(beside(p,dirs[key]),dest)) { press(key); return; }
  }
  function shortestStep(from, target, open) {
    if (same(from,target)) return null;
    const seen=new Set([from.join()]), q=[[from,null]];
    for(let i=0;i<q.length;i++) {
      const [p,first]=q[i];
      for(const d of steps) {
        const n=beside(p,d);
        if(seen.has(n.join()) || !open(n)) continue;
        const start=first || n;
        if(same(n,target)) return start;
        seen.add(n.join()); q.push([n,start]);
      }
    }
    return null;
  }
  function roundPin(c,x,y,col) {
    ring(c,x,y,10,col,2); dot(c,x,y,4,col);
    for(let a=0;a<4;a++) { const f=a*Math.PI/2; line(c,x+Math.cos(f)*12,y+Math.sin(f)*12,x+Math.cos(f)*15,y+Math.sin(f)*15,col,2); }
  }

  registerGame({
    id:'afterimage-freight',title:'Afterimage Freight',genre:'Puzzle',kind:'Remix',accent:'#66e9d4',best:'Either',
    description:'Rewind a dockworker while freight stays put. Your afterimage can keep an entire rail yard running.',
    controls:'Move to push steel until it hits a stop. B pulls visible steel one tile toward you along a row or column. A rewinds to the start and leaves your echo on the tile you left. Dock the freight on the ring and reach OUT.',
    sources:[['Chrono Vault','PR #34','Rewinding leaves a stationary echo to hold a plate.'],['Rune Golem','PR #34','Pushed pieces slide to the next obstacle.'],['Magnet','PR #35','Pull steel toward yourself along a clear line.']],
    create(g) {
      const rooms=[
        {name:'The empty shift',hint:'Stand on the brass plate, then rewind with A.',map:['###########','#@..|....X#','#.#######.#','#p#########','###########']},
        {name:'Cold rolling stock',hint:'Push the crate east, then pull it back onto the ring.',map:['###########','#@.o...OX##','#........##','#........##','###########']},
        {name:'The last consignment',hint:'Leave an echo at the plate. Pull steel off the far stop.',map:['#############','#@..|.o..O.X#','#...#.......#','#.###.#####.#','#p###.......#','#############']}
      ];
      let room=0,r,l,p,spawn,echo,steel,plate,goal,exit,done=false,note='',clock=0;
      function load() { const data=rooms[room]; r=data.map; l=layout(r); spawn=locate(r,'@')[0]; p=spawn; echo=null; steel=locate(r,'o')[0]; plate=locate(r,'p')[0]; goal=locate(r,'O')[0]; exit=locate(r,'X')[0]; note=data.hint; g.hud('Rail yard '+(room+1)+' / 3'); }
      function openGate(){return !!plate && (same(p,plate)||same(echo,plate)||same(steel,plate));}
      function open(q){const v=at(r,q); return v!=='#' && (v!=='|' || openGate());}
      function press(key) {
        if(done) return;
        if(key==='a') { if(same(steel,spawn)){note='Move the steel off your return pad first.';return;} echo=[...p]; p=spawn; note=same(echo,plate)?'Echo locked. The striped gate is open.':'Rewound. Freight stays where you left it.'; g.tone(330,.08); }
        else if(key==='b' && steel) {
          if(p[0]!==steel[0] && p[1]!==steel[1]) {note='Line up with the steel to pull it.';return;}
          const d=[Math.sign(p[0]-steel[0]),Math.sign(p[1]-steel[1])], next=beside(steel,d);
          if(same(next,p)){note='Step farther away to give the crate room.';return;}
          let q=next; while(!same(q,p) && open(q)) q=beside(q,d);
          if(!same(q,p)) {note='A wall or gate blocks your magnet.';return;}
          steel=next; note=same(steel,goal)?'Freight docked. Head for OUT.':'Steel moved one tie closer.'; g.tone(200,.05);
        } else if(dirs[key]) {
          const d=dirs[key], next=beside(p,d); if(!open(next)) return;
          if(same(next,steel)) { let stop=steel; while(open(beside(stop,d))) stop=beside(stop,d);
            if(same(stop,steel))return; steel=stop; note=same(steel,goal)?'Freight docked. Head for OUT.':'Steel ran to its stop.'; g.tone(120,.07); }
          p=next;
        }
        if(same(p,exit)) {
          if(goal&&!same(steel,goal)){note='Dock the steel on the brass ring first.';return;}
          if(++room===rooms.length){done=true;room--;g.win('The final train rolls out. Your echo stays for one more shift, holding the departure light green.');} else {load();g.tone(530,.12);}
        }
      }
      load();
      return {update(dt){clock+=dt;},press,tap(x,y){adjacentTap(l,p,x,y,press);},draw(c){
        frame(c,rooms[room].name,'FREIGHT OFFICE  /  0'+(room+1),'#66e9d4','#101c20');
        for(let i=0;i<8;i++)line(c,0,60+i*36,640,37+i*36,'#1a2b30');
        tilemap(c,r,l,(v,x,y,u,w,s)=>{
          const q=s/2-1;
          if(v==='#'){rect(c,u-q,w-q,q*2,q*2,'#29373b');line(c,u-q+2,w-q+3,u+q-2,w-q+3,'#455155'); dot(c,u-q+5,w+q-5,1.3,'#708085');return;}
          rect(c,u-q,w-q,q*2,q*2,'#18292c'); for(let f=-9;f<=9;f+=9)rect(c,u+f-1,w-8,3,16,'#35484b');
          line(c,u-q,w-6,u+q,w-6,'#53615c');line(c,u-q,w+6,u+q,w+6,'#53615c');
          if(v==='O')roundPin(c,u,w,'#ffd77b');
          if(v==='p'){rect(c,u-13,w-8,26,16,'#b88944');rect(c,u-10,w-5,20,10,'#ffe5a6');}
          if(v==='|'){for(let k=-12;k<=12;k+=8)rect(c,u+k,w-q,4,openGate()?4:q*2,openGate()?'#66e9d4':'#ffad60');}
          if(v==='X'){rect(c,u-16,w-9,32,17,'#1e695f');text(c,'OUT',u,w,11,'#d2fff0','center',true);}
          if(v==='@')ring(c,u,w,12,'#549da2',2);
        });
        if(echo){const [x,y]=point(l,echo);ring(c,x,y,10+Math.sin(clock*4)*2,'#57dfd6',2);rect(c,x-6,y-8,12,16,'#56c7c188');}
        if(steel){const [x,y]=point(l,steel);rect(c,x-14,y-14,28,28,'#8caaac');rect(c,x-11,y-11,22,22,'#374d54');line(c,x-10,y-10,x+10,y+10,'#99b9b8',3);line(c,x+10,y-10,x-10,y+10,'#99b9b8',3);}
        const [x,y]=point(l,p);dot(c,x,y+4,9,'#11252a');rect(c,x-7,y,14,12,'#57d2c4');dot(c,x,y-5,7,'#ffd89a');rect(c,x-9,y-9,18,4,'#e29441');
        lower(c,note,'MOVE  push   /   A  rewind + echo   /   B  magnet','#8ad9ce');
      }};
    }
  });

  registerGame({
    id:'sounding-bell',title:'The Sounding Bell',genre:'Puzzle',kind:'Remix',accent:'#85d6fa',best:'Either',
    description:'Below the window line, a drowned bell tower still answers sonar. Something else answers too.',
    controls:'Move one tile per turn. A sounds a ping that rings nearby bells, charts the cave, and draws the leviathan to your position. B switches diver/eel at a shell shrine. Eels fit blue grates. Oil lanterns repel the leviathan. Surface in diver form.',
    sources:[['Hollow Echo','PR #34','Sonar reveals the space and lures the leviathan to the sound.'],['Borrowed Skins','PR #34','Possess an eel at a shrine to traverse narrow grates.'],['Lantern Deep','PR #34','Spend oil for light and predator protection, then refill at a lamp.']],
    create(g){
      const rooms=[
        {name:'Hushed vestibule',hint:'Sound a ping within two steps of a hanging bell.',map:['##########','#@...*..X#','#..##....#','##########']},
        {name:'Borrowed gills',hint:'Change at each spiral shrine. Only a diver can surface.',map:['############','#@T=..+T*.X#','####......##','############']},
        {name:'The listening trench',hint:'Ping from the bronze net. Move away while the hunter follows.',map:['#############','#@T=..v..M..#','###=#...###.#','#..=..+.T*.X#','#############']}
      ];
      let room=0,r,l,p,m,eel,oil,fuel,ping,lure,heard,bells,net,hooked,clock=0,done=false,note;
      function load(){r=rooms[room].map;l=layout(r);p=locate(r,'@')[0];m=locate(r,'M')[0];eel=false;oil=5;fuel=new Set();ping=0;lure=null;heard=0;bells=new Set();net=locate(r,'v')[0];hooked=false;note=rooms[room].hint;g.hud('Bell tower '+(room+1)+' / 3');}
      function press(key){
        if(done)return;
        let lit=oil>0;
        if(key==='a'){
          ping=6;heard=8;lure=[...p];note='Your echo travels. Any hunter will follow the sound.';
          for(const q of locate(r,'*')) if(dist(p,q)<=2){bells.add(q.join());note='The bell answers. Its note will last.';}
          g.tone(560,.12);
        } else if(key==='b'){
          if(at(r,p)!=='T'){note='Find a spiral shrine to change bodies.';return;}
          eel=!eel;note=eel?'Eel skin. Slip through blue grates.':'Diver skin. The lift can carry you.';g.tone(eel?420:260,.08);
        } else if(dirs[key]){
          const n=beside(p,dirs[key]),v=at(r,n);if(v==='#')return;
          if(v==='='&&!eel){note='A diver cannot fit through that grate. Find a spiral shrine.';return;}
          p=n;
          if(v==='+'&&!fuel.has(p.join())){oil=8;lit=true;fuel.add(p.join());note='The amber lantern refills your oil.';}
        } else return;
        if(m){
          const safe=(q)=>at(r,q)!=='#' && at(r,q)!=='=' && (!same(q,p)||(!lit && at(r,p)!=='='));
          const target=heard>0?lure:!lit&&dist(m,p)<=2?p:null;
          if(target && !same(m,target)){const n=shortestStep(m,target,safe);if(n)m=n;}
          if(same(m,net)){m=null;hooked=true;note='The bronze net rings shut. The lift is released.';g.tone(120,.2);}
          else if(same(m,p)&&!lit){load();note='The hunter found you. The diving bell sends you back.';return;}
        }
        oil=Math.max(0,oil-1);ping=Math.max(0,ping-1);heard=Math.max(0,heard-1);
        if(at(r,p)==='X'){
          if(eel)note='The lift needs a diver. Change at a spiral shrine.';
          else if(bells.size!==locate(r,'*').length)note='Listen for the hanging bell before rising.';
          else if(net&&!hooked)note='Lure the hunter onto the bronze net to release the lift.';
          else if(++room===3){done=true;room--;g.win('Three bells ring above the water. From far below, a fourth answers. The harbor charts gain one new sound.');}
          else{load();g.tone(680,.13);}
        }
      }
      load();return {press,update(dt){clock+=dt;},tap(x,y){adjacentTap(l,p,x,y,press);},draw(c){
        frame(c,rooms[room].name,'SUBMERGED  /  0'+(room+1),'#85d6fa','#0a1a2b');
        for(let i=0;i<32;i++){let x=(i*117+21)%640,y=54+((i*71-clock*(3+i%5))%272+272)%272;ring(c,x,y,1+i%3,'#2a4860');}
        tilemap(c,r,l,(v,tx,ty,x,y,s)=>{
          const light=ping>0||dist(p,[tx,ty])<=(oil?4:2),d=s/2-1;
          if(v==='#'){poly(c,[[x-d,y-d],[x+d,y-d],[x+d,y+d*.7],[x+d*.25,y+d],[x-d,y+d]],light?'#29445a':'#182b3e');line(c,x-d+3,y-d+4,x+d-5,y-d+2,light?'#496379':'#253950');return;}
          rect(c,x-d,y-d,d*2,d*2,light?'#123348':'#102436');
          if(!light)return;
          if(v==='='){for(let j=-10;j<14;j+=5)line(c,x+j,y-13,x+j,y+13,'#79bdce',2);}
          if(v==='T'){for(let rad of [4,8,12])ring(c,x,y,rad,'#b8a3ee');dot(c,x+7,y,2,'#1c3148');}
          if(v==='*'){const col=bells.has([tx,ty].join())?'#9bffee':'#ffcc7b';poly(c,[[x-10,y+6],[x-6,y+1],[x-5,y-6],[x,y-10],[x+5,y-6],[x+6,y+1],[x+10,y+6]],col);dot(c,x,y+9,2,col);}
          if(v==='+'&&!fuel.has([tx,ty].join())){rect(c,x-6,y-8,12,16,'#ffe197');ring(c,x,y-8,5,'#ffe197');}
          if(v==='v'){for(let i=-10;i<=10;i+=5){line(c,x+i,y-12,x+i,y+12,'#c09a66');line(c,x-12,y+i,x+12,y+i,'#c09a66');}}
          if(v==='X'){ring(c,x,y,13,'#b3dbdf',2);text(c,'↑',x,y,20,'#d5eff4','center',true);}
        });
        if(m&&(ping||dist(m,p)<=(oil?4:3))){const [x,y]=point(l,m);poly(c,[[x-16,y],[x-3,y-9],[x+10,y-5],[x+17,y-10],[x+14,y+2],[x+17,y+8],[x+7,y+5],[x-4,y+9]],'#e58d9f');dot(c,x-8,y-1,2,'#431e36');}
        const [x,y]=point(l,p);if(oil)ring(c,x,y,18,'#ffcf7877',2);
        if(eel){c.beginPath();c.moveTo(x-13,y+3);c.bezierCurveTo(x-4,y-10,x+2,y+10,x+12,y-2);c.strokeStyle='#9bedd1';c.lineWidth=5;c.stroke();dot(c,x+11,y-3,1.5,'#143b45');}
        else{rect(c,x-8,y+1,16,12,'#d49255');dot(c,x,y-3,10,'#e7ba79');dot(c,x+1,y-4,6,'#77bdcc');}
        if(ping&&lure){const [a,b]=point(l,lure);ring(c,a,b,12+((clock*31)%44),'#85d6fa88');}
        lower(c,note,'OIL '+oil+'   /   '+(eel?'EEL':'DIVER')+'   /   A  sonar   /   B  change at shrine','#86bfd7');
      }};
    }
  });

  registerGame({
    id:'shepherd-hour',title:'Shepherd of the Hour',genre:'Puzzle',kind:'Remix',accent:'#f8c9aa',best:'Either',
    description:'Round up the moths that wind a clock tower. Whistle them through its passages and bark them into their nests.',
    controls:'Move through the maze. A whistles each loose moth one step toward you. B barks and sends nearby moths one tile away along your row or column. Nests hold moths. Clock shutters alternate open and shut after each action.',
    sources:[['Flockward','PR #34','Whistle to gather the flock and bark to push it away.'],['Still','PR #35','The clock and its shutters advance only when you act.'],['Rift Walker','PR #34','Navigate authored maze corridors and find alternate approaches.']],
    create(g){
      const rooms=[
        {name:'The watchmaker’s loft',hint:'Whistle from beyond the open nest. Moths walk toward you.',map:['###########','#m....n..@#','#.........#','###########']},
        {name:'The blind pocket',hint:'The nest is a dead end. Bark from behind the moth.',map:['##########','#m....##n#','#...@....#','#.....##.#','##########']},
        {name:'The moving hour',hint:'Shutters change with every action. A quiet bark buys a beat.',map:['############','#m..:...n..#','#...###...##','#.m..:@...n#','#....##...##','############']}
      ];
      let room=0,r,l,p,moths,nests,phase,clock=0,done=false,note;
      function load(){r=rooms[room].map;l=layout(r);p=locate(r,'@')[0];moths=locate(r,'m');nests=locate(r,'n');phase=0;note=rooms[room].hint;g.hud('Clock tower '+(room+1)+' / 3');}
      function nested(q){return nests.some(n=>same(n,q));}
      function open(q){const v=at(r,q);return v!=='#'&&(v!==':'||phase===0);}
      function press(key){
        if(done) return;
        if(dirs[key]){
          const n=beside(p,dirs[key]); if(!open(n)||moths.some(m=>same(m,n)&&!nested(m)))return; p=n;
        } else if(key==='a'||key==='b'){
          let moved=0;
          moths.forEach((m,i)=>{
            if(nested(m))return;
            const free=q=>open(q)&&!moths.some((b,j)=>j!==i&&same(b,q));
            let n=null;
            if(key==='a') n=shortestStep(m,p,free);
            else if(dist(m,p)<=2&&(m[0]===p[0]||m[1]===p[1]))n=beside(m,[Math.sign(m[0]-p[0]),Math.sign(m[1]-p[1])]);
            if(n&&free(n)&&!same(n,p)){moths[i]=n;moved++;}
          });
          note=key==='a'?(moved?'The moths followed your whistle.':'They need a clear path toward you.'):(moved?'Your bark drove the moths away.':'The clock advances. Bark along a row or column.');
          g.tone(key==='a'?720:180,.06);
        }else return;
        phase=1-phase;
        if(moths.every(nested)){
          if(++room===3){room--;done=true;g.win('Every clock moth settles into its nest. The town hears midnight for the first time in a hundred years.');}
          else {load();g.tone(540,.1);}
        }
      }
      load();return{press,update(dt){clock+=dt;},tap(x,y){adjacentTap(l,p,x,y,press);},draw(c){
        frame(c,rooms[room].name,'CLOCK TOWER  /  0'+(room+1),'#f8c9aa','#252031');
        for(let i=0;i<5;i++){const x=34+i*147,y=100+i%2*120;ring(c,x,y,66,'#443143',2);
          for(let k=0;k<12;k++){const a=k*Math.PI/6;line(c,x+Math.cos(a)*60,y+Math.sin(a)*60,x+Math.cos(a)*67,y+Math.sin(a)*67,'#64465a',3);}
          line(c,x,y,x+Math.cos(i+phase)*49,y+Math.sin(i+phase)*49,'#563e4c',3); }
        tilemap(c,r,l,(v,tx,ty,x,y,s)=>{const z=s/2-1;
          if(v==='#'){rect(c,x-z,y-z,z*2,z*2,'#534152');line(c,x-z+2,y-z+3,x+z-1,y-z+3,'#7b6170');line(c,x-5,y-z+5,x-5,y+z-3,'#49394a');return;}
          rect(c,x-z,y-z,z*2,z*2,'#342c3c');dot(c,x+z-4,y+z-4,1.3,'#726176');
          if(v==='n'){ring(c,x,y,12,'#f8cf86',2);for(let k=0;k<7;k++)line(c,x-12+k*4,y+9,x-8+k*3,y+13,'#cc9268',2);}
          if(v===':'){for(let j=-12;j<=12;j+=6)rect(c,x+j,y-z,3,phase===0?5:z*2,'#e7a7a0');}
        });
        for(const m of moths){const [x,y]=point(l,m),flutter=nested(m)?0:2*Math.sin(clock*7);poly(c,[[x,y],[x-12,y-7-flutter],[x-9,y+6],[x,y+3]],'#ffdde2');poly(c,[[x,y],[x+12,y-7-flutter],[x+9,y+6],[x,y+3]],'#e8b5d5');line(c,x,y-4,x,y+6,'#f6d270',2);}
        const [x,y]=point(l,p);poly(c,[[x-10,y+9],[x-8,y-8],[x-2,y-3],[x+4,y-3],[x+10,y-9],[x+10,y+8],[x,y+13]],'#e9aa76');rect(c,x-5,y+3,3,3,'#3c2a32');rect(c,x+4,y+3,3,3,'#3c2a32');
        lower(c,note,'A  whistle   /   B  bark   /   SHUTTERS '+(phase?'CLOSED':'OPEN'),'#e4b9cb');
      }};
    }
  });

  registerGame({
    id:'inkbeam-abbey',title:'Inkbeam Abbey',genre:'Puzzle',kind:'Remix',accent:'#ffdc8f',best:'Either',
    description:'Conduct an old observatory by drawing the sun and moon. Drink matching light or send it back through the stained glass.',
    controls:'Trace SUN with Up then Right or MOON with Down then Left. A matching ward absorbs a bolt at the center. For a RETURN order, cycle the mirror with B to the named window and press A while the bolt crosses the bright ring.',
    sources:[['Glyphcaster','PR #34','Cast by drawing a directional glyph in sequence.'],['Polarity','PR #35','Absorb incoming bolts by matching their polarity.'],['Parry','PR #35','Time a reflection to return an incoming projectile.']],
    create(g){
      const rites=[{name:'A mouth for light',list:[[0,-1],[1,-1],[0,-1]]},
        {name:'The answering glass',list:[[0,0],[1,1],[0,2]]},
        {name:'An antiphonal sky',list:[[1,-1],[0,2],[1,0],[0,-1],[1,1]]}];
      const labels=['WEST','CROWN','EAST'],coords=[[105,217],[320,75],[535,217]],
        colors=['#ffd071','#c1adff'],types=['SUN','MOON'],arrows={up:'↑',down:'↓',left:'←',right:'→'};
      let room=0,index=0,ward=-1,angle=0,progress=0,reprise=.8,delay=0,trace=[],clock=0,note='Trace ↑ then → for the sun ward.',done=false,beam=null;
      const order=()=>rites[room].list[index];
      function refresh(){g.hud('Observatory '+(room+1)+' / 3   ·   Phrase '+(index+1)+' / '+rites[room].list.length);}
      function resolve(ok,msg){
        note=msg;progress=0;reprise=ok?1:.8;g.tone(ok?650:150,ok?.12:.07);
        if(!ok)return;
        index++;if(index===rites[room].list.length){
          index=0;room++;if(room===3){room--;index=rites[room].list.length-1;done=true;g.win('Each pane sings back its share of the sky. At sunrise the old abbey casts two shadows, one silver and one gold.');return;}
          note=room===1?'Aim the mirror with B. Parry on the gold band.':'Read the score. Alternate drinking and returning light.';reprise=2;
        }refresh();
      }
      function press(key){
        if(done)return;
        if(dirs[key]){
          trace=[...trace,key].slice(-2);
          const glyph=trace.join();if(glyph==='up,right'||glyph==='down,left'){ward=glyph==='up,right'?0:1;trace=[];note=types[ward]+' ward inked.';g.tone(ward?440:530,.05);}
        }else if(key==='b'){angle=(angle+1)%3;note='Mirror points '+labels[angle]+'.';g.tone(250+angle*40,.04);}
        else if(key==='a'){
          const [color,target]=order();
          if(target<0){note='This is a DRINK phrase. Hold the matching ward.';return;}
          if(reprise>0||progress<.48||progress>.83){note='Parry when the bolt enters the brass band.';return;}
          if(ward!==color){resolve(false,'The ward was the wrong color. Trace it and try again.');return;}
          if(angle!==target){resolve(false,'The beam missed its window. Turn the mirror with B.');return;}
          beam={to:coords[target],color:colors[color]};delay=.6;resolve(true,'Light returns to the '+labels[target].toLowerCase()+' glass.');
        }
      }
      function update(dt){
        clock+=dt;delay=Math.max(0,delay-dt);if(done)return;
        if(reprise>0){reprise-=dt;return;}
        progress+=dt/(room===0?5.8:room===1?5.2:4.9);
        if(progress>=1){const [color,target]=order();resolve(target===-1&&color===ward,target>=0?'The return passed. Aim and parry as it crosses the band.':color===ward?'The ward drinks the bolt.':'The light scattered. Try the matching glyph.');}
      }
      refresh();return {press,update,tap(x,y){
        if(y>345){if(x<176){press('up');press('right');}else if(x<327){press('down');press('left');}else if(x<474)press('b');else press('a');return;}
        const near=coords.findIndex(([a,b])=>Math.hypot(x-a,y-b)<42);
        if(near>=0){angle=near;note='Mirror points '+labels[angle]+'.';return;}
        if(Math.hypot(x-320,y-212)<86){press('a');return;}
      },draw(c){
        frame(c,rites[room].name,'OBSERVATORY  /  0'+(room+1),'#ffdc8f','#181931');
        for(let k=0;k<60;k++){const x=(k*67+9)%614+13,y=57+(k*k*37)%267;dot(c,x,y,k%6===0?1.4:.65,'#9d97b1');}
        const [color,target]=order(),core=[320,212],orbit=131;
        for(let i=0;i<3;i++){const [x,y]=coords[i];poly(c,[[x-24,y+24],[x-24,y-5],[x,y-32],[x+24,y-5],[x+24,y+24]],i===angle?'#9b7790':'#554964');
          poly(c,[[x-17,y+15],[x-17,y-4],[x,y-23],[x+17,y-4],[x+17,y+15]],i===target?'#efc177':'#8783ac');
          line(c,x,y-22,x,y+15,'#48425a',2);line(c,x-16,y-2,x+16,y-2,'#48425a',2);text(c,labels[i],x,y+37,10,'#e1d4e8','center');}
        for(const r of [orbit,69,22])ring(c,core[0],core[1],r,'#5e526b');
        c.beginPath();c.arc(320,212,46,0,Math.PI*2);c.strokeStyle='#d8b26366';c.lineWidth=46;c.stroke();
        for(let k=0;k<24;k++){const a=k*Math.PI/12;line(c,320+Math.cos(a)*67,212+Math.sin(a)*67,320+Math.cos(a)*72,212+Math.sin(a)*72,'#d2b778');}
        const [ax,ay]=coords[angle];line(c,320,212,ax,ay,'#9987aa',1);
        if(beam&&delay>0)line(c,320,212,beam.to[0],beam.to[1],beam.color,2+delay*7);
        const bearing=[2.5,-.75,.33,2.95,-1.1][(index+room)%5];
        const f=orbit*(1-Math.min(1,progress)),bx=320+Math.cos(bearing)*f,by=212+Math.sin(bearing)*f;
        if(reprise<=0){line(c,bx,by,bx+Math.cos(bearing)*11,by+Math.sin(bearing)*11,colors[color],3);dot(c,bx,by,7,colors[color]);text(c,color?'−':'+',bx,by,11,'#261d36','center',true);}
        dot(c,320,212,18,'#29253a');ring(c,320,212,19,ward<0?'#c3afaa':colors[ward],3);text(c,ward<0?'·':ward?'−':'+',320,212,23,ward<0?'#eeeeee':colors[ward],'center',true);
        rect(c,68,279,504,42,'#272339');text(c,(target<0?'DRINK':'RETURN')+'   '+types[color]+(target<0?'':'   →   '+labels[target]),320,292,15,colors[color],'center',true);
        text(c,note,320,311,11,'#efe4e1','center');line(c,22,339,618,339,'#ffdc8f77');
        const ops=[['↑ →  SUN',colors[0]],['↓ ←  MOON',colors[1]],['B  AIM','#e9d5e3'],['A  PARRY','#ffd579']];
        ops.forEach(([label,col],i)=>{const x=25+i*150;rect(c,x,351,138,35,'#333045');text(c,label,x+69,368,15,col,'center',true);});
        text(c,trace.length?'STROKE   '+trace.map(k=>arrows[k]).join(' '):'Draw a ward with two directions, or tap its button.',320,404,11,'#aea4bc','center');
      }};
    }
  });

  registerGame({
    id:'carbon-garden',title:'Carbon Garden',genre:'Puzzle',kind:'Original',accent:'#f2ab99',best:'Either',
    description:'Print a garden across two sheets. Each brass die changes leaves on the paper and makes a different impression on the carbon beneath.',
    controls:'Move the print head. A stamps, B changes die. Stamping a leaf twice removes it. Match every pale target ring on both sheets and clear the other plots. Dashed copper marks preview the whole print. Tap a plot to select it and tap again to stamp.',
    sources:[],
    create(g){
      const dies=[
        {name:'PAIR',front:[[0,0],[1,0]],back:[[0,0],[0,-1]]},
        {name:'SEED',front:[[0,0]],back:[[0,0]]},
        {name:'FORK',front:[[0,0],[0,-1],[1,0]],back:[[0,0],[-1,0],[0,1]]}
      ];
      const sheets=[
        {name:'First impression',count:1,layers:1,recipe:[[0,0,0],[0,1,1],[0,0,2]]},
        {name:'The undergarden',count:2,layers:2,recipe:[[0,0,1],[1,2,0],[0,1,2]]},
        {name:'Night-bloom proof',count:3,layers:2,recipe:[[2,1,1],[1,0,0],[0,0,2],[2,2,2]]}
      ];
      let room=0,die=0,x=1,y=1,paper,goal,prints=0,clock=0,done=false,flash=0;
      const lefts=[98,383],top=95,cell=54;
      function footprint(d,px,py,side){
        const offsets=side?dies[d].back:dies[d].front;
        const cx=side?2-px:px;
        return offsets.map(([a,b])=>[cx+a,py+b]).filter(([a,b])=>a>=0&&a<3&&b>=0&&b<3).map(([a,b])=>a+3*b);
      }
      function impress(arr,d,px,py){for(let i=0;i<sheets[room].layers;i++)for(const bit of footprint(d,px,py,i))arr[i]^=1<<bit;}
      function load(){paper=[0,0];goal=[0,0];die=0;x=1;y=1;prints=0;for(const [d,a,b] of sheets[room].recipe)impress(goal,d,a,b);g.hud('Garden press '+(room+1)+' / 3');}
      function press(key){
        if(done)return;
        if(dirs[key]){const [dx,dy]=dirs[key];x=Math.max(0,Math.min(2,x+dx));y=Math.max(0,Math.min(2,y+dy));}
        else if(key==='b'){die=(die+1)%sheets[room].count;g.tone(300+die*85,.055);}
        else if(key==='a'){
          impress(paper,die,x,y);prints++;flash=.17;g.tone(170+prints%3*30,.075);
          if(paper.every((v,i)=>v===goal[i])){
            if(++room===3){room--;done=true;g.win('You lift the last proof. In the front garden, the leaves catch dawn. On its carbon twin, the flowers open only at night.');}
            else{load();g.tone(620,.14);}
          }
        }
      }
      function tap(px,py){
        if(py>=342){press(px<315?'b':'a');return;}
        const side=lefts.findIndex(l=>px>=l && px<l+3*cell);
        if(side<0||side>=sheets[room].layers||py<top||py>=top+3*cell)return;
        const tx=Math.floor((px-lefts[side])/cell),nx=side?2-tx:tx,ny=Math.floor((py-top)/cell);
        if(nx===x&&ny===y)press('a');else{x=nx;y=ny;}
      }
      load();return {press,tap,update(dt){clock+=dt;flash=Math.max(0,flash-dt);},draw(c){
        frame(c,sheets[room].name,'BOTANICAL PRESS  /  0'+(room+1),'#f2ab99','#272b29');
        for(let j=0;j<13;j++)line(c,21,67+j*22,618,64+j*22,'#363a34');
        for(let side=0;side<2;side++){
          const lx=lefts[side],on=side<sheets[room].layers,plant=side?'#aa8ecb':'#508b69',ink=side?'#dfd0ea':'#efe2bc';
          rect(c,lx-12,top-20,cell*3+24,cell*3+37,side?'#756877':'#c0ac86');
          rect(c,lx-8,top-16,cell*3+16,cell*3+29,on?(side?'#333140':'#e9ddbd'):'#65616a');
          text(c,side?'CARBON SHEET':'UPPER SHEET',lx+81,top-31,13,side?'#d9c5ee':'#ebdcba','center',true);
          if(!on){for(let k=0;k<7;k++)line(c,lx+8,top+12+k*18,lx+151,top+12+k*18,'#77737b');text(c,'SECOND PULL',lx+81,top+73,15,'#eee5db','center',true);text(c,'opens in room 2',lx+81,top+98,11,'#eee5db','center');continue;}
          const spots=footprint(die,x,y,side);
          for(let i=0;i<9;i++){
            const a=lx+i%3*cell,b=top+Math.floor(i/3)*cell,u=a+27,v=b+27;
            rect(c,a+1,b+1,cell-2,cell-2,side?'#453d50':'#d7c9a7');
            if(goal[side]&(1<<i)){ring(c,u,v,17,side?'#ffebca':'#705746',2);ring(c,u,v,20,side?'#a3939c':'#ab9375');}
            if(paper[side]&(1<<i)){
              c.save();c.translate(u,v);c.rotate(side?.35:-.35);poly(c,[[-2,9],[-10,1],[-8,-7],[1,-12],[9,-11],[11,-4],[7,4]],plant);line(c,-4,9,7,-8,ink,1.3);c.restore();
            }else dot(c,u,v,2,side?'#6d607a':'#b6a481');
            if(spots.includes(i)){const col=flash?'#ffefd2':side?'#f3ae7d':'#966144';for(const [dx,dy,sx,sy] of [[4,4,1,1],[49,4,-1,1],[4,49,1,-1],[49,49,-1,-1]]){line(c,a+dx,b+dy,a+dx+sx*7,b+dy,col,2);line(c,a+dx,b+dy,a+dx,b+dy+sy*7,col,2);}}
          }
        }
        const dif=paper.reduce((n,v,i)=>n+(v^goal[i]).toString(2).replace(/0/g,'').length,0);
        text(c,'BRASS DIE   '+dies[die].name+'     /     '+dif+' plots to match',320,296,15,'#f6dfc0','center',true);
        text(c,'Grow a leaf inside each ring. Stamp twice to erase.',320,319,12,'#d3c9b3','center');
        line(c,22,339,618,339,'#f2ab9977');
        rect(c,100,352,200,36,'#514a41');rect(c,340,352,200,36,'#665345');
        text(c,'B   CHANGE DIE',200,370,14,'#f1dfc1','center',true);text(c,'A   STAMP',440,370,14,'#f1dfc1','center',true);
        text(c,room===0?'Edges clip the die. Copper corners preview the print.':'Carbon flips the print head. Watch both sets of copper corners.',320,406,11,'#c6b9a8','center');
      }};
    }
  });
})();

(() => {
  'use strict';
  const W = 640, H = 420, TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const dist = (x, y, p) => Math.hypot(x - p.x, y - p.y);
  const vec = g => [(+g.held('right')) - (+g.held('left')), (+g.held('down')) - (+g.held('up'))];
  function rect(c,x,y,w,h,col) { c.fillStyle=col; c.fillRect(x,y,w,h); }
  function circle(c,x,y,r,col) { c.fillStyle=col; c.beginPath(); c.arc(x,y,r,0,TAU); c.fill(); }
  function ring(c,x,y,r,col,w=1) { c.strokeStyle=col; c.lineWidth=w; c.beginPath(); c.arc(x,y,r,0,TAU); c.stroke(); }
  function path(c,pts,col,w=1,fill=false) {
    c.beginPath(); pts.forEach(([x,y],i)=>i ? c.lineTo(x,y) : c.moveTo(x,y));
    if (fill) { c.closePath(); c.fillStyle=col; c.fill(); }
    else { c.lineWidth=w; c.strokeStyle=col; c.stroke(); }
  }
  function txt(c,s,x,y,size=13,col='#f5f0d9',align='left') {
    c.fillStyle=col; c.font='bold '+size+'px ui-monospace, monospace'; c.textAlign=align;
    c.textBaseline='middle'; c.fillText(s,x,y); c.textAlign='left';
  }
  function sky(c,top,bottom) { const k=c.createLinearGradient(0,0,0,H); k.addColorStop(0,top); k.addColorStop(1,bottom); c.fillStyle=k;c.fillRect(0,0,W,H); }
  function seed(n) { const a=Math.sin(n*132.19+9.74)*8923;return a-Math.floor(a); }
  function plate(c,s) { const w=Math.min(624,s.length*7.9+26); rect(c,12,12,w,27,'#0c1523df');txt(c,s,23,26,12); }
  function tag(c,s,x,y,col='#fff3c4') { c.font='bold 11px ui-monospace, monospace';const w=c.measureText(s).width+12;rect(c,x-w/2,y-8,w,16,'#0a1726df');txt(c,s,x,y,11,col,'center'); }
  function beacon(c,x,y,t,col) {ring(c,x,y,12+((t*13)%17),col); circle(c,x,y,3,col);}
  function stars(c,n) {for(let i=0;i<n;i++)circle(c,seed(i+106)*W,seed(i+196)*H,0.55+seed(i+163), i%6===0?'#f9cba5':'#9eb7cb');}

  registerGame({
    id:'wakepost',title:'Wakepost',genre:'Adventure',kind:'Remix',accent:'#6ce5bd',
    description:'A mail cutter answers distress flares along three tidal channels. Match the wind, heave to beside castaways, then surf a charged turn through the eastern gate.',
    controls:'D-pad steers. Hold A beside a flare to brake and rescue. Steer with B held to charge a slide, then release B for a burst.',
    best:'Either',sources:[['Tidebreaker','PR #34','Wind changes the cutter’s speed with its heading'],['Lantern River','PR #34','Pole braking in a current enables close rescues'],['Drift','PR #35','Steering through a held slide charges a release boost']],
    create(g) {
      const legs=[
        {name:'Reed Sound',people:[[184,128],[405,295]],rocks:[[313,192,35],[520,112,28]],wind:[1,-.3]},
        {name:'The Twin Narrows',people:[[225,300],[447,105]],rocks:[[163,175,37],[340,273,38],[530,205,25]],wind:[-.25,.95]},
        {name:'Amber Roads',people:[[187,125],[462,277]],rocks:[[295,211,45],[423,114,26],[536,313,26]],wind:[.85,.55]}
      ];
      let leg=0,x=47,y=210,vx=0,vy=0,heading=0,t=0,charge=0,boost=0,prevB=false,done=false;
      let found=[false,false],work=[0,0],wake=[];
      function dest() { return found.every(Boolean); }
      function update(dt) {
        if(done)return;t+=dt;const d=legs[leg], [dx,dy]=vec(g), m=Math.hypot(dx,dy), a=g.held('a'), b=g.held('b');
        if(m)heading=Math.atan2(dy,dx);
        if(b&&m&&!a)charge=clamp(charge+dt*.68,0,1);
        if(prevB&&!b&&charge>.03){boost=.25+charge*.85;charge=0;g.tone(390,.09);}
        prevB=b;boost=Math.max(0,boost-dt);
        const wx=d.wind[0]+.22*Math.sin(t*.45),wy=d.wind[1]+.16*Math.cos(t*.52);
        const wind=m?(dx*wx+dy*wy)/m:0, speed=(b?71:106)+wind*24+(boost?145:0);
        const k=1-Math.exp(-dt*(a?13:b?2.5:5));
        vx+=((a?0:m?dx/m*speed:0)+(a?1:wx*10)-vx)*k;
        vy+=((a?0:m?dy/m*speed:0)+(a?0:wy*10)-vy)*k;
        x=clamp(x+vx*dt,15,624);y=clamp(y+vy*dt,51,393);
        for(const [rx,ry,r] of d.rocks){let nx=x-rx,ny=y-ry,n=Math.hypot(nx,ny);if(n<r+8){n=n||1;x=rx+nx/n*(r+8);y=ry+ny/n*(r+8);vx*=.5;vy*=.5;}}
        if(!wake.length||t-wake[wake.length-1].t>.12)wake.push({x:x-Math.cos(heading)*10,y:y-Math.sin(heading)*10,t});
        wake=wake.filter(p=>t-p.t<1.7);
        d.people.forEach(([px,py],i)=>{if(!found[i]){work[i]=a&&Math.hypot(px-x,py-y)<40?work[i]+dt:0;if(work[i]>.55){found[i]=true;g.tone(625,.18);g.say(dest()?'Both aboard. Sail to the striped eastern gate.':'One aboard. Follow the other flare.');}}});
        if(dest()&&x>603&&Math.abs(y-210)<60){if(leg===2){done=true;g.win('Six castaways reached the mail station.');return;}leg++;x=46;y=210;vx=vy=charge=boost=0;found=[false,false];work=[0,0];wake=[];g.say(legs[leg].name+' — two fresh distress flares.');}
        g.hud(legs[leg].name+' · '+found.filter(Boolean).length+'/2 aboard · slide '+Math.round(charge*100)+'%');
      }
      function draw(c) {
        const d=legs[leg];sky(c,['#174b60','#28475d','#5b5354'][leg],['#357e7c','#337a88','#397975'][leg]);
        for(let i=0;i<94;i++){let px=(seed(i+4)*690+t*(4+leg))%690-24,py=42+seed(i+120)*370;path(c,[[px-6,py],[px,py-1],[px+6,py]],i%3?'#79b7a94a':'#b5e6be60');}
        path(c,[[0,38],[89,51],[172,36],[234,53],[315,35],[475,46],[559,30],[640,43],[640,0],[0,0]],'#334d41',1,true);
        path(c,[[0,420],[0,392],[80,403],[205,390],[322,408],[436,402],[547,394],[640,404],[640,420]],'#314f4d',1,true);
        for(const [rx,ry,r] of d.rocks){ const pts=[];for(let i=0;i<11;i++){const a=i*TAU/11,rad=r*(.86+seed(rx+i)*.15);pts.push([rx+Math.cos(a)*rad,ry+Math.sin(a)*rad]);}ring(c,rx,ry,r+4,'#addab78a',2);path(c,pts,'#32494d',1,true);path(c,pts.slice(1,7),'#86978a',4);}
        for(const [i,[px,py]] of d.people.entries())if(!found[i]){beacon(c,px,py,t+i,'#ffd77d');rect(c,px-11,py+2,22,6,'#995b3f');circle(c,px,py-3,4,'#fff1c9');rect(c,px+7,py-16,2,18,'#e8c5a4');path(c,[[px+9,py-17],[px+20,py-13],[px+9,py-10]],'#ff9b67',1,true);if(dist(x,y,{x:px,y:py})<53)tag(c,work[i]?'BOARDING':'HOLD A',px,py+31);}
        for(let i=0;i<6;i++)rect(c,609,157+i*19,7,10,dest()?'#ffdf89':'#789694');
        if(dest())tag(c,'PORT →',594,137);
        for(const p of wake)ring(c,p.x,p.y,2+(t-p.t)*4,'#c1e8d568');
        c.save();c.translate(x,y);c.rotate(heading);path(c,[[-13,-6],[2,-8],[17,0],[2,8],[-13,6]],'#192d38',1,true);path(c,[[-6,-4],[3,-3],[11,0],[-5,2]],'#f6c678',1,true);path(c,[[-4,-1],[-9,-13],[7,-4]],'#f0efdb',1,true);c.restore();
        plate(c,(leg+1)+'/3  '+d.name.toUpperCase());tag(c,'WIND',555,25);const wx=d.wind[0],wy=d.wind[1];c.save();c.translate(607,25);c.rotate(Math.atan2(wy,wx));path(c,[[-13,0],[12,0],[6,-5],[12,0],[6,5]],'#d4f4dc',2);c.restore();
      }
      return {update,draw};
    }
  });
  registerGame({
    id:'tidal-freight',title:'Tidal Freight',genre:'Adventure',kind:'Remix',accent:'#98b8ff',
    description:'Haul three pieces of a ruined star atlas through the moonworks. Each shard trails on a live cable while passing moons bend your flight.',
    controls:'D-pad fires thrusters. A attaches or releases a nearby shard. Hold B near a moon to lock into orbit. Release B to sling along the tangent.',
    best:'Backbone',sources:[['Salvage Tug','PR #34','Tow drifting cargo on a spring cable'],['Slingstar','PR #34','Use gravity wells to bend and accelerate flight'],['Orbit','PR #35','Lock onto a moon and release on its orbital tangent']],
    create(g){
      const rooms=[
        {name:'Index of Ash',src:[148,264],bay:[556,171],moons:[[308,201,33]]},
        {name:'Broken Meridian',src:[151,100],bay:[556,300],moons:[[313,138,29],[352,290,20]]},
        {name:'The Last Coordinate',src:[182,323],bay:[552,114],moons:[[298,266,36],[417,127,24]]}
      ];
      let n=0,x,y,vx,vy,s,hook,lock,phase,rad,spin,wasB=false,t=0,angle=0,done=false,tracks=[];
      function start(){let d=rooms[n];x=67;y=212;vx=vy=0;s={x:d.src[0],y:d.src[1],vx:0,vy:0};hook=false;lock=null;tracks=[];}
      start();
      function press(key){if(done||key!=='a')return;if(hook){hook=false;g.say('Cable released.');}else if(dist(x,y,s)<65){hook=true;g.tone(280,.13);g.say('Cable secured. Tow the shard inside the receiver.');}else g.say('Close to within the dashed cable radius.');}
      function well(p,dt){for(const [mx,my,mr] of rooms[n].moons){let dx=mx-p.x,dy=my-p.y,dd=Math.max(1,Math.hypot(dx,dy)),f=75000/Math.max(dd*dd,900);p.vx+=dx/dd*f*dt;p.vy+=dy/dd*f*dt;
        if(dd<mr+9){p.x=mx-dx/dd*(mr+9);p.y=my-dy/dd*(mr+9);const into=p.vx*dx/dd+p.vy*dy/dd;if(into>0){p.vx-=1.45*into*dx/dd;p.vy-=1.45*into*dy/dd;}}}}
      function bounds(p){if(p.x<15||p.x>625){p.x=clamp(p.x,15,625);p.vx*=-.35;}if(p.y<46||p.y>402){p.y=clamp(p.y,46,402);p.vy*=-.35;}}
      function update(dt){if(done)return;t+=dt;const d=rooms[n],[dx,dy]=vec(g),b=g.held('b');
        if(b&&!wasB){const ms=d.moons.map(m=>({m,dd:Math.hypot(x-m[0],y-m[1])})).sort((a,z)=>a.dd-z.dd);const near=ms[0];if(near.dd<135){lock=near.m;phase=Math.atan2(y-lock[1],x-lock[0]);rad=Math.max(lock[2]+14,near.dd);spin=(vx*(-Math.sin(phase))+vy*Math.cos(phase))<0?-1:1;}else g.say('Orbital lock reaches 135 units. Move closer to a moon.');}
        if(!b&&lock){vx=-Math.sin(phase)*spin*202;vy=Math.cos(phase)*spin*202;lock=null;g.tone(535,.12);}
        wasB=b;
        if(lock){phase+=spin*dt*1.75;x=lock[0]+Math.cos(phase)*rad;y=lock[1]+Math.sin(phase)*rad;vx=-Math.sin(phase)*rad*spin*1.75;vy=Math.cos(phase)*rad*spin*1.75;}
        else {let p={x,y,vx,vy};well(p,dt);p.vx=(p.vx+dx*194*dt)*Math.exp(-dt*.95);p.vy=(p.vy+dy*194*dt)*Math.exp(-dt*.95);p.x+=p.vx*dt;p.y+=p.vy*dt;bounds(p);({x,y,vx,vy}=p);}
        if(hook){const cx=x-s.x,cy=y-s.y,dd=Math.hypot(cx,cy)||1;const f=Math.max(0,dd-29)*15;
          s.vx+=cx/dd*f*dt;s.vy+=cy/dd*f*dt;if(!lock){vx-=cx/dd*f*.16*dt;vy-=cy/dd*f*.16*dt;}}
        well(s,dt);const drag=Math.exp(-dt*(hook?1.8:1.15));s.vx*=drag;s.vy*=drag;s.x+=s.vx*dt;s.y+=s.vy*dt;bounds(s);
        if(Math.hypot(vx,vy)>9)angle=Math.atan2(vy,vx);
        if(!tracks.length||t-tracks[tracks.length-1].t>.09)tracks.push({x,y,t});tracks=tracks.filter(p=>t-p.t<1.15);
        if(hook&&Math.hypot(s.x-d.bay[0],s.y-d.bay[1])<37){if(n===2){done=true;g.win('The atlas is whole. All three coordinates are home.');return;}n++;start();g.tone(710,.18);g.say('Shard indexed. Entering '+rooms[n].name+'.');}
        g.hud(rooms[n].name+' · '+(n+1)+'/3 · '+(lock?'orbital lock':hook?'cable secured':'find the gold shard'));
      }
      function draw(c){const d=rooms[n];sky(c,'#111a35','#28334a');stars(c,106);
        for(const [mx,my,mr] of d.moons){ring(c,mx,my,135,'#5b80a335');ring(c,mx,my,mr+8,'#759fbe4d');circle(c,mx,my,mr,'#647e92');
          c.save();c.beginPath();c.arc(mx,my,mr,0,TAU);c.clip();circle(c,mx+mr*.51,my+mr*.25,mr,'#314964');
          for(let i=0;i<9;i++)circle(c,mx+(seed(i+mx)-.5)*mr*1.7,my+(seed(i+my)-.5)*mr*1.7,mr*(.05+seed(i+3)*.13),'#4c657b');c.restore();}
        let [bx,by]=d.bay;for(let i=0;i<8;i++){const a=i*TAU/8+t*.16;path(c,[[bx+Math.cos(a)*35,by+Math.sin(a)*35],[bx+Math.cos(a)*45,by+Math.sin(a)*45]],'#96e6c5',3);}
        ring(c,bx,by,34,'#86d5ba');tag(c,'RECEIVER',bx,by+56);
        if(hook)path(c,[[x,y],[(x+s.x)/2,(y+s.y)/2+Math.max(0,9-dist(x,y,s)*.13)],[s.x,s.y]],'#ffdb91',2);
        else ring(c,s.x,s.y,36+Math.sin(t*2)*2,'#dbad6f73');
        c.save();c.translate(s.x,s.y);c.rotate(t*.23);path(c,[[0,-11],[9,2],[0,11],[-9,-1]],'#ffd080',1,true);path(c,[[0,-8],[0,8],[7,1]],'#c47f55',1,true);c.restore();
        if(!hook&&dist(x,y,s)<65)tag(c,'A · CABLE',s.x,s.y+30);
        for(const p of tracks)circle(c,p.x,p.y,1.6,'#c2daef87');
        if(lock)ring(c,lock[0],lock[1],rad,'#e5bb857a');c.save();c.translate(x,y);c.rotate(angle);path(c,[[-11,-7],[2,-6],[14,0],[2,6],[-11,7],[-8,0]],'#d1e4eb',1,true);rect(c,-5,-3,8,6,'#497895');path(c,[[-10,-3],[-18-Math.sin(t*28)*3,0],[-10,3]],'#ffac76',1,true);c.restore();
        plate(c,(n+1)+'/3  '+d.name.toUpperCase());
      }
      return {update,draw,press,tap(px,py){if(dist(px,py,s)<44)press('a');}};
    }
  });
  registerGame({
    id:'hushshaft',title:'Hushshaft',genre:'Adventure',kind:'Remix',accent:'#f3bf77',
    description:'Free a lantern moth from each of three salt seams. Cut a return tunnel, trade amber for a larger fuel tank, and lead the moth past a tremor-hunting worm.',
    controls:'D-pad moves and drills. Hold A for quiet steps. Press B near a moth to call it, then walk back to the lift. The lift refuels and trades amber automatically.',
    best:'Either',sources:[['Mole Mech','PR #34','Drill fuel-limited tunnels and sell minerals for tank upgrades'],['Dune Strider','PR #34','A burrowing worm pursues loud footsteps and drilling tremors'],['Flockward','PR #34','Whistle to draw a creature along a safe route home']],
    create(g){
      const names=['The Ochre Seam','Cinder Gallery','The Glass Root'],dirs=[[1,0],[-1,0],[0,1],[0,-1]],tile=40,ox=20,oy=49;
      let level=0,t=0,map,p,moth,worm,target,moveWait=0,mt=0,wt=0,call=0,noise=0,cap=16,fuel=16,ore=0,done=false,safe=0;
      const xy=(x,y)=>[ox+(x+.5)*tile,oy+(y+.5)*tile];
      const cell=(x,y)=>x>=0&&y>=0&&x<15&&y<9?map[y][x]:'#';
      function start(){map=Array.from({length:9},(_,y)=>Array.from({length:15},(_,x)=>x===0||x===14||y===0||y===8?'#':(x+2*y+level)%5===0?'*':'+'));
        const row=level===1?6:level===2?3:2;for(let y=1;y<=7;y++)for(let x=1;x<=13;x++){if(x<=2||x>=11&&Math.abs(y-row)<=1||y===4&&x<=4)map[y][x]=' ';}
        for(const [x,y] of [[6,2],[6,3],[7,6],[8,6],[9,4]])map[y][x]='#';
        map[4][1]=' '; p={x:1,y:4};moth={x:12,y:row,following:false};worm={x:11,y:7};target=null;fuel=cap;ore=0;moveWait=mt=call=noise=0;wt=1;safe=1;}
      start();
      function route(from,to){const q=[[from.x,from.y,null]],seen=new Set([from.x+','+from.y]);for(let i=0;i<q.length;i++){const [x,y,first]=q[i];if(x===to.x&&y===to.y)return first;for(const [dx,dy] of dirs){let nx=x+dx,ny=y+dy,k=nx+','+ny;if(cell(nx,ny)===' '&&!seen.has(k)){seen.add(k);q.push([nx,ny,first||{x:nx,y:ny}]);}}}return null;}
      function press(key){if(done||key!=='b')return;call=1;g.tone(705,.13);if(Math.abs(p.x-moth.x)+Math.abs(p.y-moth.y)<=4&&(route(moth,p)||moth.x===p.x&&moth.y===p.y)){moth.following=true;g.say('The lantern moth follows your tunnel. Return to the lift.');}else if(!moth.following)g.say('Whistle within four open tunnel steps of the moth.');}
      function step(dx,dy,quiet){const nx=p.x+dx,ny=p.y+dy,k=cell(nx,ny);if(k==='#')return;
        const dig=k==='+'||k==='*';if(dig&&fuel<=0){g.say('Tank empty. Follow an open tunnel to the lift.');return;}
        if(dig){fuel--;if(k==='*')ore++;map[ny][nx]=' ';}p.x=nx;p.y=ny;
        if(!quiet||dig){noise=dig?(quiet?.48:1):.46;target={x:nx,y:ny,time:dig?4.5:2};}
        if(nx===1&&ny===4){if(ore){cap+=ore;g.say('Sold '+ore+' amber. Tank capacity is now '+cap+'.');ore=0;}fuel=cap;}
      }
      function update(dt){if(done)return;t+=dt;safe-=dt;moveWait-=dt;mt-=dt;wt-=dt;noise=Math.max(0,noise-dt*.54);call=Math.max(0,call-dt);if(target&&(target.time-=dt)<0)target=null;
        const [dx,dy]=vec(g),quiet=g.held('a');if((dx||dy)&&moveWait<=0){moveWait=quiet?.27:.16;step(dx||0,dx?0:dy,quiet);}
        if(moth.following&&mt<=0){mt=.24;const next=route(moth,p);if(next)Object.assign(moth,next);}
        if(wt<=0){wt=noise>.65?.52:.8;if(target){const dx=target.x-worm.x,dy=target.y-worm.y;if(Math.abs(dx)>Math.abs(dy))worm.x+=Math.sign(dx);else worm.y+=Math.sign(dy);}}
        if(safe<=0&&worm.x===p.x&&worm.y===p.y&&!(p.x===1&&p.y===4)){p={x:1,y:4};worm={x:13,y:7};target=null;fuel=cap;safe=2;g.tone(105,.23);g.say('The lift winch pulled you clear. Your tunnel stays open.');}
        if(moth.following&&p.x===1&&p.y===4&&Math.abs(moth.x-1)+Math.abs(moth.y-4)<=1){if(level===2){done=true;g.win('Three lantern moths light the lift to the surface.');return;}level++;start();g.tone(815,.15);g.say('Moth sheltered. Descending to '+names[level]+'.');}
        g.hud(names[level]+' · fuel '+fuel+'/'+cap+' · amber '+ore+' · '+(moth.following?'guide moth home':'find the lantern moth'));
      }
      function draw(c){sky(c,'#302b37','#171c29');for(let y=0;y<9;y++)for(let x=0;x<15;x++){const k=map[y][x],[cx,cy]=xy(x,y),i=x+y*15;let tint=['#624c4c','#4f4850','#5c5256'][level];rect(c,cx-20,cy-20,40,40,k==='#'?'#34333d':k===' '?'#222332':tint);
        if(k!==' '){for(let j=0;j<3;j++){const lx=cx+(seed(i*7+j)-.5)*29,ly=cy+(seed(i+j*53)-.5)*29;path(c,[[lx-5,ly+2],[lx,ly],[lx+4,ly+1]],k==='#'?'#474650':'#887064',2);}if(k==='*')for(let j=-1;j<=1;j++)path(c,[[cx+7*j-3,cy+3],[cx+7*j,cy-5],[cx+7*j+3,cy+2],[cx+7*j,cy+7]],'#e1aa67',1,true);}
        else{for(const [dx,dy] of dirs)if(cell(x+dx,y+dy)!==' '){if(dx)rect(c,cx+dx*18-1,cy-20,3,40,'#605156');else rect(c,cx-20,cy+dy*18-1,40,3,'#605156');}}}
        const [lx,ly]=xy(1,4);rect(c,lx-14,ly-17,28,33,'#455858');rect(c,lx-10,ly-12,20,25,'#233d40');path(c,[[lx-7,ly+3],[lx,ly-6],[lx+7,ly+3]],'#91e0bd',2);
        const [wx,wy]=xy(worm.x,worm.y);for(let i=0;i<3;i++){c.strokeStyle=i===0?'#ed9677':'#a8756977';c.lineWidth=2;c.beginPath();c.arc(wx,wy,6+i*4+Math.sin(t*5),.15,Math.PI-.15);c.stroke();}
        const [mx,my]=xy(moth.x,moth.y);ring(c,mx,my,15+Math.sin(t*3)*2,'#e8cd7e75');for(let j of [-1,1]){c.save();c.translate(mx,my);c.scale(j,1);path(c,[[0,0],[9,-8-Math.sin(t*9)*2],[13,-6],[9,3],[2,4]],'#ffe8a9',1,true);c.restore();}circle(c,mx,my,2,'#d79a53');
        const [px,py]=xy(p.x,p.y);if(call)ring(c,px,py,10+(1-call)*55,'#f0db93');if(noise>.3)ring(c,px,py,16+(1-noise)*18,'#cc94785a');rect(c,px-10,py-5,20,13,'#d08458');rect(c,px-6,py-12,13,9,'#859991');rect(c,px-3,py-10,8,4,'#d5edc7');rect(c,px-10,py+7,20,3,'#8a7466');
        plate(c,(level+1)+'/3  '+names[level].toUpperCase());tag(c,'TANK '+fuel+'/'+cap,554,26);
      }
      return {update,draw,press,tap(x,y){if(Math.hypot(x-xy(moth.x,moth.y)[0],y-xy(moth.x,moth.y)[1])<44)press('b');}};
    }
  });
  registerGame({
    id:'crestkeeper',title:'Crestkeeper',genre:'Adventure',kind:'Remix',accent:'#ffa78b',
    description:'Carry beacon fire across three folded mountain ranges. Dive the dune faces, catch warm air, and skim the black spires to earn a burst of speed.',
    controls:'Down dives. Release Down at a rising crest to launch. Up flares the wing. Left and Right adjust speed. B spends graze charge. Press A at the signal tower.',
    best:'Either',sources:[['Updraft','PR #34','Catch thermals to gain altitude while gliding'],['Surf','PR #35','Dive into valleys and release over rising crests'],['Graze','PR #35','Skim danger to charge a short overdrive']],
    create(g){const ridges=['Paper Mountains','Copper Sea','Violet Cairns'],colors=[['#eab48c','#f6ddac','#bc8877','#865e68','#52495c'],['#e1a190','#f5d398','#bb8175','#85586b','#4c485e'],['#b49bb9','#efc9b8','#a18094','#725f85','#49445e']];
      let leg=0,pos=0,y=180,vy=0,speed=100,charge=0,boost=0,contact=false,prevDown=false,t=0,done=false,arrival=false,hit=0,scored=new Set(),tapped=new Set(),launch=0;
      const length=1620;const therm=[320,775,1240],spikes=[484,920,1395],ground=u=>307+45*Math.sin(u/100+leg*.8)+17*Math.sin(u/54+.4);
      function press(k){if(done)return;if(k==='b'){if(charge>=1){charge=0;boost=2.1;g.tone(600,.15);g.say('Overdrive. The relay fire burns blue.');}else g.say('Graze a spire or ride a crest to build charge.');}if(k==='a'&&arrival){if(leg===2){done=true;g.win('All three mountain beacons are burning.');return;}leg++;pos=0;y=170;vy=0;speed=105;charge=0;contact=arrival=false;scored.clear();tapped.clear();g.tone(720,.17);g.say('Beacon lit. The next relay is '+ridges[leg]+'.');}}
      function update(dt){if(done)return;t+=dt;if(arrival){g.hud('Signal tower · press A to light the beacon');return;}
        const down=g.held('down'),up=g.held('up'),[dx]=vec(g),slope=(ground(pos+2)-ground(pos-2))/4;
        boost=Math.max(0,boost-dt);hit=Math.max(0,hit-dt);launch=Math.max(0,launch-dt);
        let desired=99+dx*28+(boost?100:0)+(down?28:0);
        if(contact&&down&&slope>0)desired+=slope*115;
        speed+=(desired-speed)*Math.min(1,1.7*dt);
        if(prevDown&&!down&&contact&&slope<-.07){vy=-Math.min(230,80+speed*.8+Math.abs(slope)*70);contact=false;launch=.75;charge=Math.min(1,charge+.2);g.tone(375,.07);}
        prevDown=down;pos=Math.min(length,pos+speed*dt);
        const thermal=therm.some(q=>Math.abs(pos-q)<54);
        if(!contact||!down){vy+=(57+(down?135:0)-(up?42:0)-(thermal?265:0))*dt;vy*=Math.exp(-dt*.58);vy=clamp(vy,-183,181);y+=vy*dt;}
        if(contact&&down)y=ground(pos)-9;
        if(y>=ground(pos)-9){y=ground(pos)-9;vy=0;contact=true;}else if(y<ground(pos)-10)contact=false;
        if(contact&&thermal&&!down){vy=-104;contact=false;y-=3;}
        if(y<53){y=53;vy=Math.max(0,vy);}
        spikes.forEach((q,i)=>{let dd=Math.hypot(pos-q,y-(ground(q)-56));if(dd<41&&dd>14&&!scored.has(i)){scored.add(i);charge=Math.min(1,charge+.55);g.tone(495,.08);g.say('Close pass. Overdrive +55%.');}
          if(Math.abs(pos-q)<10&&y>=ground(q)-52&&!tapped.has(i)){tapped.add(i);speed*=.54;vy=-118;contact=false;y-=11;hit=.48;g.tone(125,.12);}});
        if(pos>=length){arrival=true;g.say('Signal tower reached. Press A to light the beacon.');}
        g.hud(ridges[leg]+' · '+Math.floor(pos/length*100)+'% · '+(boost?'OVERDRIVE':('charge '+Math.round(charge*100)+'%')));
      }
      function draw(c){const col=colors[leg],cam=pos-160;sky(c,col[0],col[1]);circle(c,478-leg*45,92,34,'#fff0c4');
        for(let layer=0;layer<2;layer++){const pts=[[0,H]];for(let x=-8;x<=650;x+=9){const u=x+cam*(.13+layer*.19);pts.push([x,205+layer*52+Math.sin(u/(83-layer*17)+leg)*30+Math.sin(u/39)*12]);}pts.push([650,H]);path(c,pts,col[2+layer],1,true);}
        for(const q of therm){const sx=q-cam;if(sx < -90||sx>732)continue;for(let j=0;j<6;j++){const yy=ground(q)-((t*46+j*39)%240);const cx=sx+Math.sin(j+t)*15;path(c,[[cx-12,yy+4],[cx,yy-2],[cx+12,yy+4]],'#fff0bcad',2);}}
        for(const q of spikes){const sx=q-cam,gy=ground(q);path(c,[[sx-12,gy+5],[sx-4,gy-30],[sx,gy-57],[sx+4,gy-36],[sx+11,gy+7]],'#4d3448',1,true);circle(c,sx,gy-57,3,'#f48771');}
        const terrain=[[0,H]];for(let x=-4;x<650;x+=6)terrain.push([x,ground(x+cam)]);terrain.push([650,H]);path(c,terrain,col[4],1,true);path(c,terrain.slice(1,-1),'#e6b298',2);
        for(let j=0;j<33;j++){const xx=((j*79-cam*.95)%690+690)%690-20,yy=ground(xx+cam)+16+seed(j)*70;path(c,[[xx-5,yy+1],[xx,yy],[xx+6,yy+1]],'#91768966');}
        const towerX=length-cam,ty=ground(length);rect(c,towerX-8,ty-74,16,76,'#453b4b');path(c,[[towerX-16,ty-74],[towerX,ty-86],[towerX+16,ty-74]],'#504756',1,true);rect(c,towerX-7,ty-71,14,10,'#ffe4a6');
        if(arrival)tag(c,'A · LIGHT BEACON',towerX,ty-102);
        const px=160,py=arrival?ty-44:y,cant=arrival?0:clamp(vy/270,-.42,.54);c.save();c.translate(px,py);c.rotate(cant);if(boost)path(c,[[-10,-1],[-47,7],[-12,5]],'#b8fcff',1,true);path(c,[[-22,-6],[18,-4],[27,-1],[1,3],[-8,12],[-11,5]],hit?'#ffe2d7':'#893f48',1,true);path(c,[[-22,-6],[3,-7],[19,-4],[-3,1]],'#fff3c9',1,true);circle(c,-1,3,3,'#493a4b');c.restore();
        plate(c,(leg+1)+'/3  '+ridges[leg].toUpperCase());if(launch)tag(c,'CREST LAUNCH',px,py-29);if(boost)tag(c,'OVERDRIVE',541,26);
      }
      return {update,draw,press,tap(){if(arrival)press('a');else if(charge>=1)press('b');}};
    }
  });
  registerGame({
    id:'borrowed-moons',title:'Borrowed Moons',genre:'Puzzle',kind:'Original',accent:'#f4cc91',
    description:'Make a three-plate photographic atlas of lost monuments. Walk the camera until a distant moon fills each carved aperture, then choose the lens that fits.',
    controls:'D-pad shifts the camera. B cycles three lenses. A exposes a plate. On touch, drag by holding the D-pad or tap the scene to move the moon toward that point.',
    best:'Either',sources:[],
    create(g){const views=[
      {name:'The Salt Eye',sky:['#284959','#e2b490'],moon:'#ffeac1',rock:'#443f4c',far:'#977d7c',start:[-81,35],lens:1},
      {name:'The Hollow Crown',sky:['#323954','#ca8993'],moon:'#ffda9c',rock:'#35374b',far:'#85738c',start:[104,-42],lens:2},
      {name:'The Night Vessel',sky:['#203956','#a9bfbb'],moon:'#e9e9c7',rock:'#2c4149',far:'#748e94',start:[-94,-57],lens:0}
    ],holes=[24,32,19],lenses=[.72,1,1.32];let n=0,x=0,y=0,lens=0,t=0,exposed=0,done=false,dest=null;
      function reset(){[x,y]=views[n].start;lens=(views[n].lens+1)%3;dest=null;}
      reset();
      function layout(){return {hx:320-x*.22,hy:189-y*.18,mx:320+x*.72,my:189+y*.76,r:holes[n],mr:holes[n]*lenses[lens]/lenses[views[n].lens]};}
      function press(key){if(done||exposed)return;if(key==='b'){lens=(lens+1)%3;g.tone(225+110*lens,.06);}if(key==='a'){if(Math.hypot(x,y)>9){g.say('The moon is off-center. Bring it into the circular carving.');g.tone(145,.08);}
        else if(lens!==views[n].lens){g.say('Center holds. Change lens until the moon touches the inner rim.');g.tone(230,.08);}else{exposed=.86;dest=null;g.tone(675,.15);g.say('Plate exposed — '+views[n].name+'.');}}}
      function update(dt){if(done)return;t+=dt;if(exposed){exposed=Math.max(0,exposed-dt);if(!exposed){if(n===2){done=true;g.win('Three moons, three vanished monuments. The atlas is complete.');return;}n++;reset();}return;}
        let [dx,dy]=vec(g);if(dx||dy)dest=null;else if(dest){let lx=dest.x-x,ly=dest.y-y,dd=Math.hypot(lx,ly);if(dd<3){x=dest.x;y=dest.y;dest=null;}else{dx=lx/dd;dy=ly/dd;}}const m=Math.hypot(dx,dy)||1;x=clamp(x+dx/m*82*dt,-170,170);y=clamp(y+dy/m*82*dt,-105,105);
        const size=layout(),align=Math.hypot(x,y)<9,fit=Math.abs(size.r-size.mr)<1;g.hud(views[n].name+' · lens '+(lens+1)+'/3 · '+(align&&fit?'ready to expose':align?'centered · adjust lens':'align the moon and the carving'));
      }
      function draw(c){const v=views[n],{hx,hy,mx,my,r,mr}=layout();sky(c,...v.sky);for(let i=0;i<47;i++){const sx=seed(i+3)*640,sy=seed(i+97)*181;circle(c,sx,sy,seed(i+8)+.3,'#ecdbbe75');}
        circle(c,mx,my,mr+3,'#f9deb53b');circle(c,mx,my,mr,v.moon);
        for(let j=0;j<2;j++){const pts=[[0,H]];for(let sx=-8;sx<650;sx+=11){const u=sx+x*(.08+j*.23);pts.push([sx,246+j*52+Math.sin(u/67+n*.9)*22+Math.sin(u/29)*7-y*.1]);}pts.push([650,H]);path(c,pts,j?v.rock:v.far,1,true);}
        c.save();c.translate(hx,hy);const stone=v.rock; const pillar=(a,b,d,e)=>path(c,[[a,b],[d,e],[d+10,e+1],[a+12,b+1]],stone,1,true);
        if(n===0){path(c,[[-132,166],[-95,135],[-70,68],[-49,32],[-29,25],[-20,30],[-40,65],[-55,158]],stone,1,true);path(c,[[22,25],[45,23],[66,67],[88,90],[113,158],[68,168],[53,91]],stone,1,true);pillar(-86,131,-56,49);}
        if(n===1){path(c,[[-89,162],[-61,122],[-48,44],[-33,22],[34,22],[48,45],[49,110],[79,168]],stone,1,true);for(const j of [-1,1])path(c,[[j*19,-30],[j*37,-78],[j*37,-47],[j*49,-60],[j*40,-24],[j*29,-8]],stone,1,true);}
        if(n===2){path(c,[[-105,46],[-47,52],[-30,24],[-16,24],[-27,54],[37,54],[19,24],[32,21],[51,50],[114,38],[85,76],[29,93],[20,154],[-24,155],[-31,93],[-76,75]],stone,1,true);}
        c.beginPath();c.arc(0,0,r+11,0,TAU);c.arc(0,0,r,0,TAU,true);c.fillStyle=stone;c.fill('evenodd');ring(c,0,0,r+.8,'#dcc4a4',1.5);
        for(let i=0;i<10;i++){const a=i*TAU/10;path(c,[[Math.cos(a)*(r+4),Math.sin(a)*(r+4)],[Math.cos(a)*(r+8),Math.sin(a)*(r+8)]],'#b39686',1);}
        c.restore();for(const [cx,cy,fx,fy] of [[24,54,1,1],[616,54,-1,1],[24,391,1,-1],[616,391,-1,-1]])path(c,[[cx+fx*27,cy],[cx,cy],[cx,cy+fy*20]],'#eee8cd',2);
        plate(c,'PLATE '+(n+1)+'/3  '+v.name.toUpperCase());tag(c,['28 mm','50 mm','85 mm'][lens],567,27);tag(c,'B  LENS       A  EXPOSE',320,385);
        if(exposed>0)rect(c,0,0,W,H,'rgba(255,241,215,'+Math.min(.95,exposed*1.2)+')');
      }
      function tap(px,py){if(done||exposed)return;const {mx,my}=layout();dest={x:clamp(x+(px-mx)/.94,-170,170),y:clamp(y+(py-my)/.94,-105,105)};}
      return {update,draw,press,tap};
    }
  });
})();

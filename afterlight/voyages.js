(() => {
  'use strict';
  const W=640,H=420,TAU=Math.PI*2;
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  const gap=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const seed=n=>{const s=Math.sin(n*19.73+3.19)*4932.73;return s-Math.floor(s);};
  const axes=g=>({x:Number(g.held('right'))-Number(g.held('left')),y:Number(g.held('down'))-Number(g.held('up'))});
  const source=(name,pr,how)=>[name,'PR #'+pr,how];
  function rect(c,x,y,w,h,color){c.fillStyle=color;c.fillRect(x,y,w,h);}
  function oval(c,x,y,rx,ry,color,rot=0){c.fillStyle=color;c.beginPath();c.ellipse(x,y,rx,ry,rot,0,TAU);c.fill();}
  function circle(c,x,y,r,color){oval(c,x,y,r,r,color);}
  function line(c,points,color,width=2){c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.strokeStyle=color;c.lineWidth=width;c.lineJoin='round';c.lineCap='round';c.stroke();}
  function poly(c,points,color){c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fillStyle=color;c.fill();}
  function arc(c,x,y,r,a,b,color,w=2){c.beginPath();c.arc(x,y,r,a,b);c.strokeStyle=color;c.lineWidth=w;c.stroke();}
  function txt(c,s,x,y,size=14,color='#fff7de',align='left'){c.fillStyle=color;c.font='bold '+size+'px system-ui,sans-serif';c.textAlign=align;c.textBaseline='middle';c.fillText(s,x,y);}
  function box(c,x,y,w,h,color,r=8){c.fillStyle=color;c.beginPath();c.roundRect(x,y,w,h,r);c.fill();}
  function label(c,s,x,y,color='#fff6d5',dark='#143c44'){
    c.font='bold 12px system-ui,sans-serif';const w=c.measureText(s).width+16;
    box(c,x-w/2,y-10,w,20,dark,7);txt(c,s,x,y,12,color,'center');
  }
  function gradient(c,top,bottom){const v=c.createLinearGradient(0,0,0,H);v.addColorStop(0,top);v.addColorStop(1,bottom);rect(c,0,0,W,H,v);}
  function sparkle(c,x,y,size,color){poly(c,[[x,y-size],[x+size*.22,y-size*.22],[x+size,y],[x+size*.22,y+size*.22],[x,y+size],[x-size*.22,y+size*.22],[x-size,y],[x-size*.22,y-size*.22]],color);}
  function particles(){const bits=[],words=[];return {
    burst(x,y,color,n=10){for(let i=0;i<n;i++){const a=i*TAU/n+seed(x+y+i),v=24+seed(i*41+x)*75;bits.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v-35,life:.46,color});}},
    word(x,y,s){words.push({x,y,s,life:1});},
    update(dt){for(let i=bits.length-1;i>=0;i--){const p=bits[i];p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=145*dt;if(p.life<=0)bits.splice(i,1);}
      for(let i=words.length-1;i>=0;i--){const p=words[i];p.y-=20*dt;p.life-=dt;if(p.life<=0)words.splice(i,1);}},
    draw(c){for(const p of bits)circle(c,p.x,p.y,1+3*p.life,p.color);for(const p of words){c.save();c.globalAlpha=Math.min(1,p.life*4);label(c,p.s,p.x,p.y);c.restore();}}
  };}
  function moveToward(p,to,speed,dt){const d=gap(p,to);if(d<=speed*dt){p.x=to.x;p.y=to.y;return true;}p.x+=(to.x-p.x)*speed*dt/d;p.y+=(to.y-p.y)*speed*dt/d;return false;}

  // The beach, meadow and mango grove share one continuous shoreline.
  registerGame({
    id:'wakepost',title:'Palm Pocket',kind:'Remix',genre:'Adventure',best:'Either',accent:'#5cddb0',buttons:{a:'Gather',b:'Tools'},
    description:'Walk along the beach, knock down palms, and build a little raft. Follow the orange birds inland to find what they have been digging up.',
    controls:'Tap ground to walk or tap a resource to walk over and gather it. D-pad walks, A gathers or builds at the dock, B opens tools. In Tools, choose with Up/Down and A.',
    sources:[source('Castaway Cove',34,'Gather island materials, make an axe and assemble a working raft.'),source('Mole Mech',34,'Dig into a mineral seam and spend its ore on a better tool.'),source('Flockward',34,'Whistle nearby birds into a following flock and lead them to their nest.')],
    create(g){
      const end=1700, dock={x:265,y:315,kind:'dock'}, nest={x:1120,y:170,kind:'nest'};
      const p={x:145,y:207},bag={wood:0,stone:0,fiber:0,amber:0},fx=particles(),tools=new Set();
      const recipes=[['Axe',{wood:2,stone:1},'Fell two close palms together'],['Spade',{wood:1,stone:2},'Dig up sparkling seams'],['Gold axe',{amber:1,wood:1},'Cut four logs from one palm']];
      const raft=[['Logs',{wood:4}],['Mast',{wood:2,stone:1}],['Sail',{fiber:3}]];
      const colors={wood:'#be7d4d',stone:'#8695aa',fiber:'#669851',amber:'#ffb232'};
      const inlet=(x,center,width)=>Math.exp(-Math.pow((x-center)/width,2));
      const cape=x=>Math.max(0,1-Math.max(0,Math.min(x,end-x))/86)**2;
      const groundTop=x=>72+Math.sin(x/142)*19+Math.cos(x/70)*7+109*cape(x)+38*inlet(x,647,70);
      
      const groundBottom=x=>347+Math.sin(x/132)*19+Math.sin(x/51)*7-109*cape(x)-52*inlet(x,1196,83);
      const make=(kind,points)=>points.map(([x,y],i)=>({kind,x,y,i,ready:0,fall:0}));
      const nodes=[
        ...make('wood',[[185,195],[228,175],[345,157],[487,221],[545,192],[664,184],[735,153],[768,176],[892,240],[1033,144],[1230,206],[1318,169],[1391,233],[1504,193],[1552,165]]),
        ...make('stone',[[107,244],[322,226],[465,137],[603,260],[838,185],[876,161],[1090,263],[1295,253],[1529,254]]),
        ...make('fiber',[[219,256],[344,273],[515,261],[645,146],[805,265],[999,239],[1195,245],[1335,217],[1483,277]]),
        ...make('amber',[[964,154],[1384,170]]),
      ];
      const birds=[{x:408,y:219},{x:734,y:239},{x:1018,y:196}].map((v,i)=>({...v,i,homeX:v.x,homeY:v.y,follow:false,home:false}));
      let target=null,cam=0,time=0,parts=0,menu=false,choice=0,done=false,walking=false,face=1,steps=0,foundPearl=false,cave=false;
      const pearl={x:1602,y:202,kind:'pearl'};
      const supplies=cost=>Object.entries(cost).map(([k,v])=>v+' '+k).join(' + ');
      const afford=cost=>Object.entries(cost).every(([k,v])=>bag[k]>=v);
      const pay=cost=>Object.entries(cost).forEach(([k,v])=>bag[k]-=v);
      const info=()=>parts===3?'Raft ready · tap the dock to sail':'Raft '+parts+'/3 · '+raft[parts][0]+' needs '+supplies(raft[parts][1]);
      g.say('Tap the palm beside you for wood. The stones and reeds are yours to pick up, too.');
      function openTools(){menu=!menu;target=null;if(menu)g.say('Pick a tool. You can make tools anywhere on the island.');else g.say(info());}
      function buy(i){choice=i;const [name,cost,desc]=recipes[i];if(tools.has(name)){g.say(name+' is already in your pack.');return;}
        if(!afford(cost)){g.say(name+' needs '+supplies(cost)+'.');return;}pay(cost);tools.add(name);menu=false;g.tone(660,.12);fx.word(p.x,p.y-28,name+'!');g.say(name+' made. '+desc+'.');}
      function build(){if(parts===3){done=true;g.win('You launched the raft with '+birds.filter(b=>b.home).length+' birds back in their nest'+(foundPearl?' and the pink pearl in your pack.':'.'));return;}
        const [name,cost]=raft[parts];if(!afford(cost)){g.say('At the dock. '+name+' needs '+supplies(cost)+'.');return;}pay(cost);parts++;fx.burst(dock.x,dock.y-9,'#ffeea4',16);fx.word(dock.x,dock.y-33,name+' built!');g.tone(370+parts*105,.13);g.say(parts===3?'Your raft is ready. Keep exploring, or tap it again to sail.':info());}
      function gather(n){
        if(n.ready>0)return;
        if(n.kind==='amber'&&!tools.has('Spade')){g.say('Amber is showing through the rock. Make a spade in Tools to dig here.');fx.word(n.x,n.y-20,'Needs spade');return;}
        const amount=n.kind==='wood'?(tools.has('Gold axe')?4:tools.has('Axe')?3:1):n.kind==='amber'?1:2;
        bag[n.kind]+=amount;n.ready=n.kind==='wood'?11:6;n.fall=n.kind==='wood'?.65:0;let total=amount;
        if(n.kind==='wood'&&(tools.has('Axe')||tools.has('Gold axe'))){const other=nodes.find(v=>v!==n&&v.kind==='wood'&&v.ready<=0&&gap(v,n)<63);if(other){other.ready=11;other.fall=.8;bag.wood+=amount;total+=amount;fx.burst(other.x,other.y-17,'#abd45e',16);}}
        fx.burst(n.x,n.y-12,n.kind==='wood'?'#a2c957':colors[n.kind],13);fx.word(n.x,n.y-31,'+'+total+' '+n.kind);g.tone(n.kind==='wood'?180:460,.075);
        if(n.kind==='amber'){cave=true;g.say('Amber! The tunnel through the last headland is open. Follow the pink shells east.');}
        else if(total>amount)g.say('One palm knocked down the next. '+total+' logs!');
        else if(bag.wood>=2&&bag.stone>=1&&!tools.has('Axe'))g.say('You have enough for an axe. Open Tools, or save the wood for your raft.');
        else g.say(info());
      }
      function whistle(b){if(b.follow||b.home)return;b.follow=true;g.tone(850,.15);fx.burst(b.x,b.y-9,'#ffdf86');g.say('The bird follows your whistle. Walk east to its big nest.');}
      function interact(n){if(n===dock)build();else if(n===nest)g.say('Bring an orange bird here for sail fiber.');else if(n===pearl){if(!cave){g.say('A seam of amber seals this hollow. Try a spade on the sparkling rocks.');return;}if(!foundPearl){foundPearl=true;bag.fiber+=4;fx.word(n.x,n.y-16,'Pink pearl +4 fiber');g.tone(910,.17);g.say('A pink pearl! Its soft seaweed wrapping gives you four sail fibers.');}}
        else if(birds.includes(n))whistle(n);else gather(n);}
      function things(){return [...nodes.filter(n=>n.ready<=0),...birds.filter(b=>!b.follow&&!b.home),dock,nest,...(foundPearl?[]:[pearl])];}
      function nearest(at,max,art=false){let best=null,bestD=max;for(const n of things()){
        const visual=art&&n.kind==='wood'?{x:n.x,y:n.y-21}:n;
        const hint=art&&n===nodes[0]&&time<9&&!bag.wood?gap(at,{x:185,y:135}):Infinity;const d=Math.min(gap(at,n),gap(at,visual),hint);if(d<bestD){bestD=d;best=n;}}return best;}
      function setTarget(x,y,select){const point={x:x+cam,y};const obj=select?nearest(point,34,true):null;
        const tx=clamp(obj?obj.x:point.x,30,end-30);
        target={x:tx,y:clamp(obj?obj.y:point.y,groundTop(tx)+15,groundBottom(tx)-5),obj};
        if(obj&&gap(p,obj)<56){interact(obj);target=null;}}
      function tap(x,y){if(done)return;if(menu){if(x>=157&&x<=483&&y>=121&&y<286){buy(Math.floor((y-121)/55));}else openTools();return;}
        if(x>=519&&y<=48){openTools();return;}setTarget(x,y,true);}
      function press(k){if(done)return;if(k==='b'){openTools();return;}if(menu){if(k==='up')choice=(choice+2)%3;if(k==='down')choice=(choice+1)%3;if(k==='a')buy(choice);return;}
        if(k==='a'){const n=nearest(p,61);if(n)interact(n);else g.say('Walk up to a tree, rock, reed, bird, or the raft dock.');}}
      function update(dt){if(done)return;time+=dt;fx.update(dt);for(const n of nodes){n.ready=Math.max(0,n.ready-dt);n.fall=Math.max(0,n.fall-dt);}
        walking=false;if(!menu){const v=axes(g),len=Math.hypot(v.x,v.y);const lastX=p.x,lastY=p.y;
          if(len){target=null;p.x+=v.x/len*205*dt;p.y+=v.y/len*205*dt;}
          else if(target){if(moveToward(p,target,225,dt)||(target.obj&&gap(p,target.obj)<27)){const obj=target.obj;target=null;if(obj)interact(obj);}}
          p.x=clamp(p.x,26,end-26);p.y=clamp(p.y,groundTop(p.x)+13,groundBottom(p.x)-4);walking=Math.abs(p.x-lastX)+Math.abs(p.y-lastY)>.06;
          if(walking){steps+=dt*15;if(Math.abs(p.x-lastX)>.1)face=Math.sign(p.x-lastX);}
          let order=0;for(const b of birds){if(b.home)continue;
            if(b.follow){order++;const dest={x:p.x-face*(21+order*15),y:p.y+8+Math.sin(time*4+b.i)*5};if(gap(b,dest)>9)moveToward(b,dest,230,dt);
              if(gap(b,nest)<52){b.home=true;b.follow=false;b.x=nest.x-11+b.i*9;b.y=nest.y-4;bag.fiber+=3;fx.word(nest.x,nest.y-31,'Nest gift +3 fiber');g.tone(715,.11);g.say('Back in the nest! Three soft fibers for your sail.');}}
            else {b.x=b.homeX+Math.sin(time*.9+b.i)*8;b.y=b.homeY+Math.cos(time*1.1+b.i)*4;}}
        }
        cam=clamp(p.x-260,0,end-W);
        g.hud('Wood '+bag.wood+' · Stone '+bag.stone+' · Fiber '+bag.fiber+' · Raft '+parts+'/3');}
      function palm(c,n){const s=n.i%3===0?1.11:.92;oval(c,n.x+7,n.y+1,19,5,'#455a4342');c.save();c.translate(n.x,n.y);c.scale(s,s);
        if(n.ready>0&&n.fall===0){oval(c,0,-1,6,4,'#926747');oval(c,0,-3,5,2,'#dfaf6a');c.restore();return;}
        if(n.fall>0){c.rotate((1-n.fall/.8)*1.5);}
        line(c,[[0,0],[-2,-12],[2,-27],[1,-35]],'#8d5d3f',7);line(c,[[-2,-8],[0,-22],[2,-31]],'#d6a567',2.5);
        for(let j=0;j<8;j++){const a=j*TAU/8+n.i*.45,dx=Math.cos(a)*26,dy=Math.sin(a)*16;
          poly(c,[[1,-33],[dx*.48-4,-41+dy*.36],[dx,-34+dy],[dx*1.21,-27+dy],[dx*.5+4,-32+dy*.4]],j%2?'#287b56':'#35995a');
          line(c,[[1,-35],[dx*.49,-36+dy*.38],[dx*.96,-34+dy]],j%2?'#55aa63':'#8abf66',1.3);}
        circle(c,-1,-29,3,'#a8633d');circle(c,4,-30,2.6,'#ca8644');c.restore();}
      function resource(c,n){if(n.kind==='wood'){palm(c,n);return;}const x=n.x,y=n.y;
        if(n.kind==='stone'||n.kind==='amber'){const amber=n.kind==='amber';const scale=n.ready>0?.49:1;c.save();c.translate(x,y);c.scale(scale,scale);oval(c,2,3,15,5,'#44594f38');
          poly(c,[[-16,1],[-11,-10],[-3,-15],[7,-14],[16,-3],[14,3],[-9,5]],amber?'#766887':'#78879b');
          poly(c,[[-11,-10],[-3,-15],[7,-14],[3,-6],[-13,-1]],amber?'#bc94a2':'#aab6bc');line(c,[[1,-10],[5,-6],[3,-2]],amber?'#ffbd66':'#8598af',2);
          if(amber&&n.ready<=0)sparkle(c,6,-11,4+Math.sin(time*3), '#ffde84');c.restore();}
        else{for(let j=-2;j<=2;j++){const h=n.ready>0?4:12+seed(j+n.x)*11;line(c,[[x+j*3,y+2],[x+j*4,y-h*.43],[x+j*5,y-h]],'#478d58',2);if(n.ready<=0)line(c,[[x+j*5,y-h],[x+j*5+1,y-h-4]],'#b6914e',3);}}}
      function paintDock(c){const {x,y}=dock;for(let j=0;j<7;j++){rect(c,x-44+j*10,y+10,9,32,'#996946');rect(c,x-44+j*10,y+10,8,4,'#c49364');}
        for(const dx of [-47,27]){rect(c,x+dx,y+7,5,39,'#6c5642');oval(c,x+dx+2,y+7,4,2,'#e6bd83');}
        const ry=y+27+Math.sin(time*2)*1.2;if(parts){for(let j=-2;j<=2;j++){box(c,x+37,ry+j*5-3,41,5,'#bb844d',2);line(c,[[x+39,ry+j*5-2],[x+75,ry+j*5-2]],'#dfaa64',1);}for(const dx of [45,66])line(c,[[x+dx,ry-12],[x+dx,ry+10]],'#574d3e',2);}
        if(parts>=2)line(c,[[x+54,ry+4],[x+54,ry-37]],'#714732',3);
        if(parts>=3)poly(c,[[x+56,ry-36],[x+77,ry-12],[x+56,ry-9]],'#fff4c7');
        label(c,parts===3?'Set sail':'Build raft '+parts+'/3',x,y-16);}
      function draw(c){const left=cam;gradient(c,'#338fa2','#4eabb2');c.save();c.translate(-left,0);
        for(let i=Math.floor(left/18);i<(left+W)/18+1;i++)for(let j=0;j<7;j++){const x=i*18+seed(j+i*4)*14,y=j*69+seed(i*7+j)*49;line(c,[[x,y],[x+4+Math.sin(time*2+i)*2,y-1],[x+8,y]],'#b7e9d780',1.5);}
        function land(topInset,bottomInset,color){const pts=[];for(let x=left-8;x<=left+W+9;x+=8)pts.push([x,groundTop(x)+topInset]);for(let x=left+W+8;x>=left-8;x-=8)pts.push([x,groundBottom(x)-bottomInset]);poly(c,pts,color);}
        land(-17,-17,'#70c4bd');land(-5,-5,'#e0f2ca');land(0,0,'#edcc91');land(14,22,'#f7dca2');
        const greens=[];for(let x=left-8;x<=left+W+8;x+=8)greens.push([x,groundTop(x)+41+12*Math.sin(x/65)]);for(let x=left+W+8;x>=left-8;x-=8)greens.push([x,groundBottom(x)-62+14*Math.cos(x/81)]);poly(c,greens,'#9fc877');
        for(let i=Math.floor(left/16);i<(left+W)/16+1;i++){const x=i*16+seed(i)*12,y=groundTop(x)+45+seed(i+8)*(groundBottom(x)-groundTop(x)-99);
          if(i%4===0){circle(c,x,y,2.7,'#fbdda0');circle(c,x+3,y-2,2,'#efb581');}else line(c,[[x-3,y],[x-1,y-3],[x,y],[x+2,y-2]],'#76ac67',1.3);}
        // Sand paths and landmarks distinguish the four stops at walking speed.
        for(let i=Math.max(0,Math.floor(left/17)-2);i<Math.min(98,(left+W)/17+2);i++){const x=47+i*17,y=233+Math.sin(x/94)*24;if(i%3!==1){oval(c,x,y,3.4,1.4,'#d5d08d',-.28);oval(c,x+5,y+3,2.3,1,'#d5d08d',.2);}}
        if(left<155){const x=67,y=173;oval(c,x+3,y+3,22,6,'#666e4640');poly(c,[[x-20,y+2],[x-4,y-25],[x+20,y+2]],'#e6ae66');poly(c,[[x-4,y-25],[x+8,y+2],[x+24,y+2],[x+10,y-19]],'#c77a59');poly(c,[[x-14,y+1],[x-4,y-16],[x+1,y+1]],'#765f4b');line(c,[[x-26,y+3],[x-4,y-25],[x+24,y+4]],'#856348',1.1);
          const cx=x+27,cy=y+14;for(let j=0;j<7;j++){const a=j*TAU/7;oval(c,cx+Math.cos(a)*6,cy+Math.sin(a)*3,2.2,1.5,'#848b77');}poly(c,[[cx-4,cy],[cx-1,cy-8],[cx+1,cy-4],[cx+3,cy-7],[cx+4,cy]],'#f09b49');}
        for(const [sx,sy,name] of [[433,171,'Meadow →'],[855,272,'Bird grove →'],[1270,183,'Shells →']])if(sx>left-65&&sx<left+W+65){line(c,[[sx,sy-19],[sx,sy]],'#886547',3);poly(c,[[sx-29,sy-25],[sx+23,sy-25],[sx+31,sy-18],[sx+23,sy-12],[sx-29,sy-12]],'#ebc68b');txt(c,name,sx,sy-18,9,'#6a553c','center');}
        if(left+W>535&&left<840){for(let i=0;i<50;i++){const x=540+seed(i+88)*277,y=166+seed(i+202)*78;if(Math.abs(y-198)>32*Math.sin((x-530)/300*Math.PI)+3)continue;
          for(let j=0;j<3;j++){const a=j*TAU/3;oval(c,x+Math.cos(a)*2,y+Math.sin(a)*1.6,2.1,1.5,i%3?'#ecb76d':'#e9c1a1',a);}circle(c,x,y,1.1,'#f9dc77');}}
        // Roots and dark slabs make the nest legible before its birds arrive.
        if(left+W>1000&&left<1210){const x=nest.x,y=nest.y;oval(c,x+7,y+6,43,9,'#617b5150');line(c,[[x-9,y],[x-17,y-19],[x-13,y-43],[x-27,y-61]],'#795c49',8);line(c,[[x-14,y-36],[x+4,y-55],[x+20,y-59]],'#87674a',6);
          for(let j=0;j<13;j++){const a=j*2.4,rx=Math.cos(a)*(15+j*.75),ry=Math.sin(a)*9;oval(c,x-5+rx,y-65+ry,15,9,j%2?'#528c64':'#71a366',a*.14);if(j%3===0)circle(c,x-2+rx,y-63+ry,2.8,'#ecb879');}}
        for(let i=0;i<9;i++){const x=1065+i*64,y=groundBottom(x)-20;oval(c,x,y,3,2,'#e59c87',-.4);line(c,[[x-1,y],[x+1,y-1]],'#fff2c1',1);}
        if(left>775){const x=1594,y=199;poly(c,[[x-47,y+10],[x-35,y-32],[x-13,y-46],[x+12,y-42],[x+38,y-20],[x+48,y+13]],'#797c78');poly(c,[[x-34,y-28],[x-13,y-46],[x+12,y-42],[x-5,y-27]],'#a2a397');oval(c,x+4,y+1,23,cave?20:10,cave?'#3a5656':'#aaa09a');if(!foundPearl){circle(c,pearl.x,pearl.y-3,6,cave?'#ffaeaa':'#b69c90');if(cave)sparkle(c,pearl.x-2,pearl.y-5,4,'#fff4e0');}}
        paintDock(c);oval(c,nest.x,nest.y,20,8,'#a47847');for(let i=-3;i<4;i++)line(c,[[nest.x+i*5-3,nest.y-3],[nest.x+i*5+3,nest.y+2]],'#e3b276',1.5);
        const scene=nodes.filter(n=>n.x>left-50&&n.x<left+W+50).map(n=>({y:n.y,draw:()=>resource(c,n)}));
        for(const b of birds)scene.push({y:b.y,draw:()=>{const hop=Math.abs(Math.sin(time*(b.follow?9:3)+b.i))*2;oval(c,b.x,b.y+2,6,2,'#39574d40');oval(c,b.x,b.y-3-hop,6,4,'#ff9c47');circle(c,b.x+3,b.y-7-hop,3.6,'#ffe181');circle(c,b.x+4,b.y-8-hop,.8,'#342e37');poly(c,[[b.x+5,b.y-7-hop],[b.x+10,b.y-6-hop],[b.x+5,b.y-5-hop]],'#bc5d44');}});
        scene.push({y:p.y,draw:()=>{const hop=walking?Math.abs(Math.sin(steps))*2:0;oval(c,p.x,p.y+2,9,3,'#39574d52');c.save();c.translate(p.x,p.y-hop);
          line(c,[[-4,-6],[-4+Math.sin(steps)*2,0]],'#534b4a',3.5);line(c,[[3,-6],[3-Math.sin(steps)*2,0]],'#534b4a',3.5);
          box(c,-6,-16,12,12,'#e46443',3);rect(c,-5,-14,10,2,'#ffe1a5');circle(c,face,-19,5.4,'#a86445');oval(c,0,-23,11,3,'#b37c3f');oval(c,0,-25,6,4,'#ffe091');c.restore();}});
        scene.sort((a,b)=>a.y-b.y).forEach(s=>s.draw());if(target){const a=target;arc(c,a.x,a.y,7+Math.sin(time*7)*1.5,0,TAU,'#fcf8d1',1.8);}
        if(time<9&&!bag.wood&&nodes[0].ready<=0)label(c,'Tap palm',185,135);fx.draw(c);c.restore();
        const region=p.x<520?'Palm Beach':p.x<1000?'Amber Meadow':p.x<1440?'Bird Grove':'Shell Hollow';
        box(c,10,10,120,28,'#143c44ed');txt(c,region,21,24,13);box(c,520,10,109,31,'#143c44ed');txt(c,'Tools  [B]',575,25,14,'#fff7d9','center');
        if(menu){rect(c,0,0,W,H,'#113b4266');box(c,151,72,338,259,'#fff1cd',14);txt(c,'Make a tool',171,98,21,'#24494a');txt(c,'×',464,99,23,'#24494a','center');
          recipes.forEach(([name,cost,desc],i)=>{const y=121+i*55;box(c,161,y,318,50,i===choice?'#c0dcaa':'#e7dfb7',7);txt(c,name,172,y+15,15,'#24494a');txt(c,tools.has(name)?'Made':supplies(cost),469,y+15,12,'#3c5945','right');txt(c,desc,172,y+34,12,'#41665a');});txt(c,'Tap a tool   ·   ↑ ↓ choose   ·   A make   ·   B close',320,308,12,'#43615b','center');}
      }
      return {update,draw,tap,drag(x,y){if(!menu&&!done&&y>46)setTarget(x,y,false);},press};
    }
  });
  registerGame({
    id:'tidal-freight',title:'Claw Bay',kind:'Remix',genre:'Adventure',best:'Either',accent:'#efb668',buttons:{a:'Drop',b:'Pulse'},
    description:'Drop a crane magnet into an aquarium of shipwreck junk. Fish out the bike wheel, trumpet and anchor, and see what shakes loose from the safe.',
    controls:'Tap to drop the magnet or drag it through a pile. D-pad aims and A drops. Tap the safe or press B by it to pop its latch.',
    sources:[source('Salvage Tug',34,'Tow loose cargo back to a collection bay on a spring cable.'),source('Magnet',35,'Pull nearby metal pieces into range and repel them with a pulse.'),source('Mole Mech',34,'Turn collected scrap into a stronger tool when the crane returns to the surface.')],
    create(g){
      const prize=['wheel','horn','anchor'],names={wheel:'Bike wheel',horn:'Trumpet',anchor:'Anchor',scrap:'Scrap',star:'Gold star'};
      const items=[['wheel',158,237],['horn',394,263],['anchor',520,324],['scrap',130,257],['scrap',187,241],['scrap',416,264],['scrap',488,308],['scrap',333,341]].map(([kind,x,y])=>({kind,x,y,ox:x,oy:y,vx:0,vy:0,hook:false,sold:false}));
      const safe={x:304,y:306},m={x:170,y:80},aim={x:158,y:237},fx=particles(),found=new Set();
      let phase='idle',hover=0,time=0,open=false,big=false,scrap=0,done=false,boat=170,pulse=0,pointer=false;
      const radius=()=>big?74:46;
      g.say('Tap the sunken bike wheel to drop your magnet. The two loose bolts nearby will stick, too.');
      function drop(x,y){if(done)return;aim.x=clamp(x,23,617);aim.y=clamp(y,89,369);phase='drop';hover=.2;g.tone(245,.045);}
      function pop(){pulse=.45;g.tone(305,.08);if(gap(m,safe)<85&&!open){open=true;items.push({kind:'star',x:safe.x,y:safe.y-8,ox:safe.x,oy:safe.y-30,vx:7,vy:-140,hook:false,sold:false});fx.burst(safe.x,safe.y-16,'#ffdc75',16);g.say('The safe popped open. Its gold star powers the wide magnet immediately.');}
        for(const i of items)if(!i.sold&&!i.hook&&i.kind==='scrap'&&gap(m,i)<95){const d=gap(m,i)||1;i.vx+=(i.x-m.x)/d*95;i.vy-=70;}}
      function press(k){if(done)return;if(k==='a')drop(aim.x,aim.y);if(k==='b')pop();}
      function update(dt){if(done)return;time+=dt;fx.update(dt);pulse=Math.max(0,pulse-dt);const v=axes(g);
        if(v.x||v.y){aim.x=clamp(aim.x+v.x*225*dt,23,617);aim.y=clamp(aim.y+v.y*225*dt,89,369);}
        boat+=(m.x-boat)*(1-Math.exp(-dt*7));
        if(phase==='drop'){const arrived=moveToward(m,aim,505,dt);if(arrived){if(!open&&gap(m,safe)<28)pop();hover-=dt;if(hover<=0&&!pointer)phase='reel';}}
        if(phase==='reel'){const arrived=moveToward(m,{x:m.x,y:77},340,dt);if(arrived){
          const collected=items.filter(i=>i.hook);if(collected.every(i=>gap(i,m)<31)){for(const i of collected){i.hook=false;i.sold=true;if(prize.includes(i.kind))found.add(i.kind);if(i.kind==='scrap')scrap++;if(i.kind==='star')big=true;}
            if(collected.length){const main=collected.filter(i=>i.kind!=='scrap').map(i=>names[i.kind]).join(' + ');fx.word(m.x,80,main||'Scrap');g.tone(640,.1);g.say(main?main+' aboard! Tap another find.':'Scrap aboard. Two bolts buy a wider magnet.');}
            if(!big&&scrap>=2){big=true;fx.burst(m.x,m.y,'#ffd97e');g.say('Two bolts traded for a wider magnet. Drag through another pile to grab a whole cluster.');}
            phase='idle';if(found.size===3){done=true;g.hud('Finds 3/3 · '+(big?'Wide magnet':'Standard magnet')+(open?' · Safe open':''));g.win('You fished out the wheel, trumpet and anchor'+(open?' and cracked the wreck safe.':'.'));return;}}}}
        for(const i of items){if(i.sold)continue;
          if(!i.hook&&phase==='drop'&&gap(i,m)<radius()){i.hook=true;fx.burst(i.x,i.y,'#b5f3cf',5);g.tone(460+(i.kind==='scrap'?70:140),.045);}
          const tx=i.hook?m.x+(i.kind==='scrap'?10:-3):i.ox,ty=i.hook?m.y+11:i.oy;
          const k=i.hook?72:6,damping=Math.exp(-dt*(i.hook?11:4));i.vx=(i.vx+(tx-i.x)*k*dt)*damping;i.vy=(i.vy+(ty-i.y)*k*dt)*damping;i.x+=i.vx*dt;i.y+=i.vy*dt;}
        g.hud('Finds '+found.size+'/3 · '+(big?'Wide magnet':'Scrap '+scrap+'/2')+(open?' · Safe open':''));}
      function object(c,i){const {kind,x,y}=i;c.save();c.translate(x,y);if(i.hook)c.rotate(clamp(i.vx/500,-.4,.4));
        if(kind==='wheel'){arc(c,0,0,19,0,TAU,'#203e51',6);arc(c,0,0,16,0,TAU,'#e0cbb0',2.5);for(let j=0;j<8;j++){const a=j*TAU/8;line(c,[[0,0],[Math.cos(a)*15,Math.sin(a)*15]],'#a6c4ba',1.6);}circle(c,0,0,4,'#fdb772');}
        if(kind==='horn'){c.rotate(-.16);line(c,[[-18,-2],[-13,-2],[-7,4],[8,4],[10,-1],[-7,-1],[-9,5]],'#ffd17b',4);poly(c,[[3,-2],[14,-4],[22,-11],[22,6],[14,1],[4,2]],'#ffc562');line(c,[[21,-10],[22,5]],'#ffe6aa',3);for(let j=-1;j<=1;j++)line(c,[[j*4,-5],[j*4,3]],'#dd9853',2);}
        if(kind==='anchor'){arc(c,0,-17,4,0,TAU,'#a9dbe3',3);line(c,[[0,-12],[0,17]],'#a7d0d7',5);line(c,[[-8,-7],[8,-7]],'#d1e9df',4);line(c,[[-17,5],[-13,13],[0,19],[13,13],[17,5]],'#acd3d5',4);for(const z of [-1,1])poly(c,[[z*18,0],[z*19,11],[z*12,7]],'#d3e0d7');}
        if(kind==='scrap'){poly(c,[[-5,-3],[1,-5],[6,-1],[4,4],[-3,5],[-6,1]],'#b8c9c7');circle(c,0,0,2,'#416d79');}
        if(kind==='star'){const pts=[];for(let j=0;j<10;j++){const a=-Math.PI/2+j*TAU/10,r=j%2?5:12;pts.push([Math.cos(a)*r,Math.sin(a)*r]);}poly(c,pts,'#ffdf73');}
        c.restore();}
      function draw(c){gradient(c,'#64bac0','#214c68');
        for(let i=0;i<5;i++){const x=30+i*136+Math.sin(time*.35+i)*5;poly(c,[[x,66],[x+14,66],[x-54,372],[x-131,372]],'#c6efe916');}
        poly(c,[[0,320],[94,311],[186,342],[238,325],[330,354],[436,323],[524,342],[640,309],[640,420],[0,420]],'#42717a');
        c.save();c.translate(453,340);c.rotate(-.2);poly(c,[[-121,-23],[83,-23],[57,13],[-92,23]],'#375767');line(c,[[-102,-24],[78,-24]],'#8d9d8b',3);for(let j=0;j<6;j++)line(c,[[-78+j*22,-20],[-66+j*21,6]],'#56777a',3);line(c,[[-20,-25],[-20,-111]],'#547577',4);line(c,[[-22,-97],[-74,-26]],'#64908b',1.5);c.restore();
        const seabed=[];for(let x=0;x<=650;x+=10)seabed.push([x,365+Math.sin(x/45)*9+Math.sin(x/90)*8]);poly(c,[...seabed,[650,H],[0,H]],'#d2b18a');line(c,seabed,'#eccd9e',4);
        for(let i=0;i<48;i++){const x=seed(i+22)*W,y=380+seed(i+60)*37;oval(c,x,y,1+seed(i+21)*3,1.1,'#a68d7b');}
        for(let j=0;j<8;j++){const x=10+j*93,y=367+Math.sin(x/45)*9+Math.sin(x/90)*8;for(let i=-1;i<=1;i++)line(c,[[x+i*4,y],[x+i*8+Math.sin(time+i+j)*2,y-13],[x+i*10-4,y-22-i*5]],'#527c69',3);}
        for(let i=0;i<34;i++){const x=(seed(i+124)*W+Math.sin(time+i)*4),y=80+((seed(i+99)*300-time*(5+seed(i+8)*7))%281+281)%281;arc(c,x,y,1+seed(i+2)*2,0,TAU,'#c1e8e168',1);}
        box(c,safe.x-19,safe.y-8,38,25,'#405464',4);box(c,safe.x-16,safe.y-6,32,18,'#687c82',3);rect(c,safe.x-18,safe.y-7,4,19,'#bea175');arc(c,safe.x+4,safe.y+2,5,0,TAU,'#eaca85',2);
        if(open)poly(c,[[safe.x-18,safe.y-9],[safe.x+17,safe.y-9],[safe.x+10,safe.y-23],[safe.x-22,safe.y-21]],'#9e9c89');else sparkle(c,safe.x+12,safe.y-11,4+Math.sin(time*3),'#fae39b');
        for(const i of items)if(!i.sold&&!i.hook)object(c,i);
        const surf=65+Math.sin(time*2);rect(c,0,0,W,63,'#f4ddb0');circle(c,510,26,20,'#ffefbf');
        poly(c,[[0,56],[41,50],[74,52],[130,32],[160,40],[183,33],[242,56],[344,56],[448,49],[514,57],[640,48],[640,67],[0,67]],'#8aa9a3');rect(c,0,61,W,6,'#b3e2ce');
        c.save();c.translate(boat,surf);poly(c,[[-50,-9],[49,-9],[39,5],[-32,6]],'#b45a45');line(c,[[-46,-8],[47,-8]],'#fff2c4',3);box(c,-26,-30,23,20,'#ecb462',2);rect(c,-22,-26,6,7,'#457283');rect(c,-14,-26,6,7,'#457283');line(c,[[1,-11],[13,-38],[26,-11]],'#4a6268',4);c.restore();
        line(c,[[boat+13,surf-37],[m.x,m.y-9]],'#425b68',2.1);
        if(phase==='drop'){arc(c,m.x,m.y,radius()*(.75+.1*Math.sin(time*8)),0,TAU,'#c6efc278',1.3);}
        c.save();c.translate(m.x,m.y);arc(c,0,-1,9,Math.PI,TAU,'#e27554',6);rect(c,-12,-1,6,10,'#e27554');rect(c,6,-1,6,10,'#e27554');rect(c,-12,6,6,4,'#e2eee3');rect(c,6,6,6,4,'#e2eee3');c.restore();
        if(pulse)arc(c,m.x,m.y,(1-pulse/.46)*80,0,TAU,'#ffe8ad',2);for(const i of items)if(i.hook){line(c,[[m.x,m.y+5],[i.x,i.y]],'#ccf0cd88',1);object(c,i);}
        line(c,[[aim.x-7,aim.y],[aim.x-3,aim.y]],'#ffefc2',2);line(c,[[aim.x+3,aim.y],[aim.x+7,aim.y]],'#ffefc2',2);if(time<8&&phase==='idle'&&!found.size)label(c,'Drop here',158,199);
        label(c,'Finds '+found.size+' / 3',52,22);label(c,big?'Wide magnet':'Tap to drop',567,22);fx.draw(c);}
      return {update,draw,press,tap(x,y){pointer=false;drop(x,y);},drag(x,y){if(done)return;pointer=true;aim.x=clamp(x,23,617);aim.y=clamp(y,89,369);phase='drop';hover=.15;},release(){pointer=false;}};
    }
  });
  registerGame({
    id:'hushshaft',title:'Duck Ferry',kind:'Remix',genre:'Adventure',best:'Either',accent:'#fed36a',buttons:{a:'Whistle',b:'Skid'},
    description:'Skim around a park pond with a trail of ducklings. Take the long way around the lily pads, or skid through the reeds to open a shortcut.',
    controls:'Tap a duck to paddle over and whistle. Tap the striped landing to lead your line home. D-pad paddles, A whistles, hold B to skid and release for a boost. Tap red reeds to burst through.',
    sources:[source('Lantern River',34,'Paddle against a moving current and plant a pole to slow down near a rescue.'),source('Flockward',34,'Whistling attracts individual animals into a following flock.'),source('Drift',35,'A held skid charges a speed boost that fires as you release.')],
    create(g){
      const p={x:104,y:260},land={x:550,y:113},reeds={x:305,y:218},fx=particles();
      const ducks=[[133,269],[241,110],[448,305],[421,139]].map(([x,y],i)=>({x,y,baseX:x,baseY:y,i,joined:false,home:false,face:1}));
      const rocks=[{x:260,y:247,r:30},{x:349,y:190,r:24},{x:421,y:233,r:15}];
      let vx=0,vy=0,target=null,angle=-.15,time=0,whist=0,boost=0,charge=0,braking=false,opened=false,done=false,trail=[],step=0;
      const point=(x,y,s=1)=>({x,y,s});
      g.say('Tap the yellow duck next to your board. Your whistle will bring it along. The striped dock is its home.');
      function call(){whist=.66;g.tone(790,.12);let n=0;for(const d of ducks){if(!d.home&&!d.joined&&gap(p,d)<82){d.joined=true;d.order=ducks.filter(o=>o.joined).length;n++;fx.burst(d.x,d.y,'#fff5b2',5);}}if(n)g.say('Duckling aboard the parade! Pick up more, or tap the striped landing.');}
      function sprint(){if(charge>.08){boost=.24+charge*.57;g.tone(400,.07);charge=0;}}
      function press(k){if(done)return;if(k==='a')call();}
      function aim(x,y,select){if(done)return;let obj=null;if(select){obj=ducks.find(d=>!d.joined&&!d.home&&gap({x,y},d)<35);if(gap({x,y},land)<47)obj=land;if(!opened&&gap({x,y},reeds)<31)obj=reeds;}
        target={x:clamp(obj?obj.x:x,34,608),y:clamp(obj?obj.y:y,72,352),obj};
        if(obj&&ducks.includes(obj)&&gap(p,obj)<82)call();}
      function update(dt){if(done)return;time+=dt;fx.update(dt);whist=Math.max(0,whist-dt);boost=Math.max(0,boost-dt);
        let v=axes(g),m=Math.hypot(v.x,v.y);
        if(m)target=null;else if(target){if(target.obj&&ducks.includes(target.obj)){target.x=target.obj.x;target.y=target.obj.y;}
          const d=gap(p,target);
          if(target.obj&&ducks.includes(target.obj)&&d<65){if(!target.obj.joined)call();target=null;}
          else if(target.obj===reeds&&d<54){charge=1;sprint();opened=true;fx.burst(reeds.x,reeds.y,'#d9d478',18);g.say('The reed gate split! Paddle through its fast current.');target={x:reeds.x+65,y:reeds.y-20};}
          else if(d<12){target=null;vx*=.45;vy*=.45;}
          if(target){v={x:target.x-p.x,y:target.y-p.y};m=Math.hypot(v.x,v.y);
            // Follow the bank of a pad instead of pushing straight into its rim.
            if(m>2)for(const r of rocks){const dx=r.x-p.x,dy=r.y-p.y,along=(dx*v.x+dy*v.y)/m,cross=(dx*v.y-dy*v.x)/m;
              if(along>0&&along<r.r+49&&Math.abs(cross)<r.r+11){const side=cross>=0?1:-1;v={x:v.x/m*.30-v.y/m*side,y:v.y/m*.30+v.x/m*side};m=Math.hypot(v.x,v.y);break;}}}}
        const b=g.held('b');if(b&&m)charge=Math.min(1,charge+dt*1.8);if(braking&&!b)sprint();braking=b;
        const speed=boost>0?310:b?95:189,k=1-Math.exp(-dt*(b?4:10));
        const current=(p.y>180&&p.y<260?(opened&&Math.abs(p.x-reeds.x)<80?52:21):5);
        vx+=((m?v.x/m*speed:0)+current*(b?.05:1)-vx)*k;vy+=((m?v.y/m*speed:0)+Math.sin(p.x/65)*4-vy)*k;
        p.x=clamp(p.x+vx*dt,32,608);p.y=clamp(p.y+vy*dt,70,353);
        for(const r of rocks){const d=gap(p,r);if(d<r.r+8&&d>.1){p.x=r.x+(p.x-r.x)/d*(r.r+8);p.y=r.y+(p.y-r.y)/d*(r.r+8);}}
        if(!opened&&gap(p,reeds)<25&&boost){opened=true;fx.burst(reeds.x,reeds.y,'#e3da86',16);g.say('The reed gate broke. A fast channel runs through the middle!');}
        if(Math.hypot(vx,vy)>15)angle=Math.atan2(vy,vx);
        step+=dt;if(step>.055){trail.unshift(point(p.x,p.y));if(trail.length>50)trail.pop();step=0;}
        const home=ducks.filter(d=>d.home).length;
        for(const d of ducks){if(d.home)continue;
          if(d.joined){const leader=trail[Math.min(trail.length-1,3+d.order*2)]||p;const dx=leader.x-d.x;if(Math.abs(dx)>1)d.face=Math.sign(dx);
            if(gap(d,leader)>2)moveToward(d,leader,230+boost*135,dt);
            if(gap(p,land)<47){d.home=true;d.joined=false;d.x=land.x-18+(d.i%2)*17;d.y=land.y+13+Math.floor(d.i/2)*12;fx.burst(d.x,d.y,'#fff2a1');g.tone(600+80*d.i,.09);}}
          else{d.x=d.baseX+Math.sin(time*1.8+d.i)*5;d.y=d.baseY+Math.cos(time*1.3+d.i)*3;}}
        const now=ducks.filter(d=>d.home).length;if(now>home)g.say(now+' of four ducklings at the landing.');if(now===4){done=true;g.hud('4/4 home');g.win('All four ducklings made it to the park landing'+(opened?' through your new reed shortcut.':'.'));return;}
        g.hud(now+'/4 home · '+ducks.filter(d=>d.joined).length+' following'+(charge?' · Skid '+Math.round(charge*100)+'%':''));}
      function duck(c,x,y,face,i){c.save();c.translate(x,y+Math.sin(time*3+i)*1.2);c.scale(face,1);oval(c,-1,3,10,3,'#216f7780');poly(c,[[-7,0],[-12,-5],[-10,2],[-5,4]],'#e5a54d');oval(c,-1,-1,9,5.5,'#ffe385');circle(c,5,-7,5,'#ffdd6c');oval(c,-2,-1,4.1,2.8,'#efbb58',-.2);poly(c,[[9,-7],[15,-5],[9,-4]],'#ed9854');circle(c,7,-8,.9,'#343f3b');c.restore();}
      function draw(c){gradient(c,'#a9dcd0','#6dbab3');
        const shore=(top)=>{const pts=[];for(let x=-10;x<=650;x+=10){pts.push([x,top?51+Math.sin(x/44)*8+Math.cos(x/79)*5:374+Math.sin(x/51)*10+Math.cos(x/86)*5]);}return pts;};
        for(const top of [true,false]){const pts=shore(top),edge=top?0:H;poly(c,[[0,edge],...pts,[650,edge]],'#bdd286');line(c,pts,'#e9d99d',6);line(c,pts.map(([x,y])=>[x,y+(top?5:-5)]),'#d6edde',2);}
        for(let i=0;i<92;i++){const x=((seed(i+29)*W+time*(i%2?4:8))%W),y=76+seed(i+105)*275;line(c,[[x-4,y],[x,y-1],[x+5,y]],i%3?'#daeee45c':'#417f8b42',1.4);}
        for(let i=0;i<35;i++){const x=seed(i+1)*W,y=i%2?18+seed(i+3)*23:386+seed(i+7)*28;line(c,[[x-3,y+2],[x-2,y-3],[x,y+1],[x+3,y-4]],'#76aa68',1.3);if(i%3===0)circle(c,x-3,y-2,2,'#efb581');}
        for(const r of rocks){oval(c,r.x+2,r.y+4,r.r+8,r.r*.75,'#328a8e52');for(let j=0;j<5;j++){const a=j*TAU/5,px=r.x+Math.cos(a)*r.r*.65,py=r.y+Math.sin(a)*r.r*.5,rr=r.r*.55;oval(c,px,py,rr,rr*.69,j%2?'#619b74':'#77b380');line(c,[[px,py],[px+rr*.81,py-2]],'#a3cc8a',1.6);}for(let j=0;j<6;j++){const a=j*TAU/6;oval(c,r.x+Math.cos(a)*4,r.y+Math.sin(a)*3,4,2.6,'#f5c2ae',a);}circle(c,r.x,r.y,2.6,'#ffe38d');}
        for(let j=-4;j<=4;j++){const x=reeds.x+j*4,y=reeds.y+Math.sin(j*.8)*4;if(opened&&Math.abs(j)<3)continue;line(c,[[x,y+6],[x+Math.sin(time+j)*2,y-9],[x+j*.6,y-16]],'#557d54',2.2);line(c,[[x+j*.6,y-17],[x+j*.6,y-21]],'#bb7858',3.2);}
        if(opened)line(c,[[286,228],[300,220],[317,219],[326,212]],'#e4eee0',2);
        const x=land.x,y=land.y;for(let j=0;j<6;j++){rect(c,x+4,y-47+j*8,37,7,j%2?'#bf9865':'#dbaf78');}for(const z of [1,40])line(c,[[x+z,y-49],[x+z,y+2]],'#896e54',4);
        line(c,[[x+35,y-46],[x+35,y-74]],'#815e4b',3);poly(c,[[x+36,y-73],[x+58,y-69],[x+36,y-57]],'#ed8c65');line(c,[[x+38,y-68],[x+47,y-68]],'#fff1c4',2);
        label(c,'Landing',x+11,y-54);
        if(trail.length>1){for(let i=0;i<Math.min(16,trail.length);i+=3){const q=trail[i];arc(c,q.x,q.y,3+i*.28,0,TAU,'#e3f1d96b',1.2);}}
        for(const d of ducks)duck(c,d.x,d.y,d.face,d.i);c.save();c.translate(p.x,p.y);c.rotate(angle);oval(c,0,3,21,7,'#2b777952');oval(c,0,0,20,6.2,'#c76748');oval(c,1,-1,17,4.1,'#f6a26c');rect(c,4,-5,3,9,'#fff1b5');line(c,[[-5,-9],[5,11]],'#89674f',2);oval(c,6,12,3,5,'#fee5a4',-.5);circle(c,-1,-3,5.6,'#efcf91');circle(c,-1,-4,3.9,'#c28e58');c.restore();
        if(whist)arc(c,p.x,p.y,(1-whist/.67)*75,0,TAU,'#fff8b9',2);if(target){arc(c,target.x,target.y,8,0,TAU,'#fff4b6',1.7);}
        if(time<7&&!ducks[0].joined&&!ducks[0].home)label(c,'Tap duck',131,239);
        label(c,ducks.filter(d=>d.home).length+' / 4 home',57,24);if(time>6&&!opened&&time%12<4)label(c,'Reed shortcut',305,175);fx.draw(c);}
      return {update,draw,press,tap(x,y){aim(x,y,true);},drag(x,y){aim(x,y,false);}};
    }
  });
  registerGame({
    id:'crestkeeper',title:'Orchard Shots',kind:'Remix',genre:'Adventure',best:'Either',accent:'#f68d63',buttons:{a:'Shoot',b:'Arc'},
    description:'Knock apples out of a sprawling orchard with a pocket slingshot. Send a stone through the rising air, or hit a beehive to shake the whole branch.',
    controls:'Tap a spot to shoot. For a power shot, drag back from the slingshot and let go. D-pad aims, A shoots and B switches between a low and high arc.',
    sources:[source('Deepwood Archer',34,'Aim projectiles with real drop and wind.'),source('Sling',35,'Drawing the elastic back sets the direction and speed of a launch.'),source('Updraft',34,'A marked column of rising air lifts airborne objects.')],
    create(g){
      const origin={x:100,y:300},aim={x:241,y:213},hive={x:502,y:150},fx=particles();
      const orchards=[[[241,213],[374,154],[466,204],[537,130]],[[235,164],[329,219],[399,117],[474,199],[560,166]]];
      let stage=0,fruits=[],stones=[],fall=[],time=0,pull=null,high=false,shook=false,done=false,transition=0,hitCount=0,flash=0,stretch=0;
      function grow(){fruits=orchards[stage].map(([x,y],i)=>({x,y,base:x,i,picked:false}));aim.x=fruits[0].x;aim.y=fruits[0].y;shook=false;stones=[];}
      grow();g.say('Tap the red apple just above the slingshot. Drag back on the elastic when you want to set the power yourself.');
      function velocity(at){const t=(high?.37:.14)+Math.max(.31,Math.abs(at.x-origin.x)/555);
        return {vx:(at.x-origin.x)/t,vy:(at.y-origin.y)/t-.5*365*t};}
      function manual(){return {vx:clamp((origin.x-pull.x)*7.1,-430,700),vy:clamp((origin.y-pull.y)*7.1,-590,320)};}
      function spawn(v){if(done||transition)return;stones.push({x:origin.x,y:origin.y,vx:v.vx,vy:v.vy,tail:[],age:0});stretch=.18;g.tone(335,.045);}
      function pick(f,vx=0){if(f.picked)return;f.picked=true;hitCount++;fall.push({x:f.x,y:f.y,vx:vx*.12,vy:-35,spin:f.i,age:0});fx.burst(f.x,f.y,'#ffe0a1',8);g.tone(470+f.i*76,.075);}
      function gust(x){return Math.max(0,1-Math.abs(x-319)/38)*195;}
      function tap(x,y){if(done||transition)return;if(x>522&&y<47){high=!high;return;}if(gap({x,y},origin)<63){pull={x,y};return;}aim.x=clamp(x,112,620);aim.y=clamp(y,58,340);spawn(velocity(aim));}
      function release(){if(!pull)return;const p=pull;if(gap(p,origin)>9)spawn(manual());else spawn(velocity(aim));pull=null;}
      function press(k){if(done||transition)return;if(k==='a')spawn(velocity(aim));else if(k==='b'){high=!high;g.tone(270,.045);}}
      function update(dt){if(done)return;time+=dt;fx.update(dt);stretch=Math.max(0,stretch-dt);flash=Math.max(0,flash-dt);
        if(transition){transition-=dt;if(transition<=0){transition=0;if(stage===1){done=true;g.win('Nine apples picked from both trees'+(shook?' with a little help from the bees.':'.'));return;}stage++;grow();g.say('Try the high arc on the next tree, or wake its bees.');}}
        const v=axes(g);aim.x=clamp(aim.x+v.x*223*dt,113,620);aim.y=clamp(aim.y+v.y*203*dt,62,345);
        for(const f of fruits)f.x=f.base+Math.sin(time*1.5+f.i)*3;
        for(let j=stones.length-1;j>=0;j--){const s=stones[j],lx=s.x,ly=s.y;s.age+=dt;s.vy+=(365-gust(s.x))*dt;s.vx+=Math.sin(time*.65)*3*dt;s.x+=s.vx*dt;s.y+=s.vy*dt;s.tail.unshift([s.x,s.y]);s.tail.length=Math.min(8,s.tail.length);
          function near(o,r){const dx=s.x-lx,dy=s.y-ly,k=clamp(((o.x-lx)*dx+(o.y-ly)*dy)/(dx*dx+dy*dy||1),0,1);return Math.hypot(o.x-lx-k*dx,o.y-ly-k*dy)<r;}
          for(const f of fruits)if(!f.picked&&near(f,21)){pick(f,s.vx);s.vx*=.83;s.vy+=14;}
          if(!shook&&near(hive,23)){shook=true;flash=.85;fx.burst(hive.x,hive.y,'#ffcf58',20);g.tone(790,.12);const branch=fruits.filter(f=>!f.picked&&gap(f,hive)<133);for(const f of branch)pick(f,100);g.say('The bees shook '+branch.length+' apples off the branch!');}
          if(s.y>344&&s.vy>0&&s.age>.2){s.vy*=-.48;s.vx*=.79;s.y=344;fx.burst(s.x,347,'#c4b680',3);}if(s.age>3.6||s.x>660||s.x<0)stones.splice(j,1);}
        for(let i=fall.length-1;i>=0;i--){const a=fall[i];a.age+=dt;a.x+=a.vx*dt;a.vy+=510*dt;a.y+=a.vy*dt;if(a.y>341&&a.vy>0){a.y=341;a.vy*=-.26;a.vx*=.65;}if(a.age>1.4)fall.splice(i,1);}
        if(!transition&&fruits.every(f=>f.picked)){transition=1;g.say(stage?'The basket is full!':'First tree picked. The next one is just over the fence.');}
        g.hud('Tree '+(stage+1)+'/2 · Apples '+hitCount+'/9 · '+(high?'High arc':'Low arc'));}
      function apple(c,x,y,s=1,angle=0){c.save();c.translate(x,y);c.rotate(angle);c.scale(s,s);
        oval(c,-3,1,7,9,'#cb5943',-.2);oval(c,3,1,7,9,'#e26447',.2);oval(c,-3,-2,2,3,'#ffab76',.5);line(c,[[0,-6],[2,-12]],'#795746',2);oval(c,5,-10,4,1.7,'#68834a',-.4);c.restore();}
      function draw(c){gradient(c,stage?'#a3cfd7':'#91cdd8',stage?'#f6dba8':'#f9e5ac');circle(c,92,78,28,'#fff3bc');
        for(let j=0;j<5;j++){const x=25+j*140,y=67+seed(j)*50;oval(c,x,y,30,5,'#ffefd29c');oval(c,x+19,y-3,18,6,'#fff1d796');}
        for(let j=0;j<2;j++){const pts=[[0,H]];for(let x=-15;x<670;x+=10)pts.push([x,250+42*j+Math.sin(x/(90-j*31)+j+stage*.5)*19+Math.cos(x/38)*3]);poly(c,[...pts,[660,H]],j?'#a7b57a':'#abc2a3');}
        for(let i=0;i<17;i++){const x=i*45-20;box(c,x,288+Math.sin(i*2)*4,6,40,'#bba87c',2);}line(c,[[-9,306],[650,298]],'#c8b78d',5);
        const tx=443,shake=flash?Math.sin(time*34)*3:0,leaves=stage?['#647e53','#779255','#9ca75e','#91aa61']:['#5b8359','#70965a','#88a95f','#97b567'];
        poly(c,[[tx-39,347],[tx-17,307],[tx-12,250],[tx-26,215],[tx-20,210],[tx+2,237],[tx+22,201],[tx+31,204],[tx+9,250],[tx+11,290],[tx+28,339],[tx+44,348]],'#896749');
        line(c,[[tx-4,289],[tx-2,256],[tx-41,208],[tx-97,187],[tx-119,144]],'#8b694b',11);line(c,[[tx,256],[tx+53,210],[tx+86,153]],'#937052',10);
        c.save();c.translate(shake,0);for(let j=0;j<34;j++){const x=213+seed(j+4)*383,y=102+seed(j+14)*86;oval(c,x,y,26+seed(j+54)*29,16+seed(j+91)*14,leaves[j%leaves.length],(seed(j)-.5)*.4);}
        for(let j=0;j<83;j++){const lx=218+seed(j+88)*366,ly=111+seed(j+201)*63;if((lx-405)**2/36200+(ly-142)**2/1250<1){oval(c,lx,ly,3,1.6,j%2?'#adc881':'#5c8958',seed(j)*2-1);}}
        for(const f of fruits){line(c,[[f.base-10,f.y-34],[f.base-5,f.y-20],[f.x,f.y-7]],'#796e49',2);if(!f.picked)apple(c,f.x,f.y,1.35);}c.restore();
        for(let j=0;j<4;j++){const y=hive.y-8+j*5;oval(c,hive.x,y,8+Math.sin(j*.9)*5,4,'#d39141');oval(c,hive.x,y-1.1,7+Math.sin(j*.9)*5,2.6,'#efb64b');}line(c,[[hive.x,hive.y-12],[hive.x+2,hive.y-24]],'#866a42',2);circle(c,hive.x+5,hive.y+2,2.6,'#87633d');
        for(let i=0;i<(flash?12:3);i++){const radius=flash?25+i*4:12+i*5,a=time*(2+i*.1)+i*TAU/3,x=hive.x+Math.cos(a)*radius,y=hive.y+Math.sin(a)*radius*.55;oval(c,x,y,2.5,1.5,'#68583d');circle(c,x+1,y-.5,1,'#ffdc6f');}
        for(let j=0;j<5;j++){const y=335-(time*54+j*51)%239,x=319+Math.sin(time+j)*9;line(c,[[x-5,y+3],[x,y-2],[x+5,y+2]],'#fff4d6b0',2);}
        poly(c,[[0,350],[96,342],[200,350],[310,341],[435,345],[550,337],[640,345],[640,H],[0,H]],'#abb45d');
        for(let i=0;i<73;i++){const x=seed(i+4)*W,y=352+seed(i+16)*65;line(c,[[x-2,y],[x,y-3],[x+1,y]],'#87a05c',1.5);if(i%6===0)circle(c,x+2,y-2,1.8,'#ffe19a');}
        const elastic=pull?{x:clamp(pull.x,18,159),y:clamp(pull.y,245,374)}:{x:origin.x+(stretch?5:0),y:origin.y};
        line(c,[[91,342],[92,322],[79,290]],'#76523d',9);line(c,[[92,323],[111,287]],'#926741',9);line(c,[[80,290],[elastic.x,elastic.y],[111,287]],'#654c46',3.2);circle(c,elastic.x,elastic.y,4.5,'#45545a');
        const trajectory=pull?manual():velocity(aim);let x=origin.x,y=origin.y,vy=trajectory.vy;for(let i=0;i<26;i++){vy+=(365-gust(x))*.038;x+=trajectory.vx*.038;y+=vy*.038;if(y>345||x>635)break;if(i%2===0)circle(c,x,y,1.8,'#fffae3cd');}
        arc(c,aim.x,aim.y,12,0,TAU,'#fff1c7ba',1.5);
        for(const s of stones){if(s.tail.length>1)line(c,s.tail,'#fff2beb5',2.8);circle(c,s.x,s.y,4.6,'#475964');}
        for(const a of fall)apple(c,a.x,a.y,1,a.age*2);fx.draw(c);
        label(c,'Tree '+(stage+1)+' / 2',52,24);label(c,'Apples '+hitCount+' / 9',157,24);label(c,high?'High arc [B]':'Low arc [B]',574,24);
        if(time<6&&!hitCount)label(c,'Tap apple',fruits[0].x,fruits[0].y+29);}
      return {update,draw,press,tap,drag(x,y){if(pull){pull.x=x;pull.y=y;}},release};
    }
  });
  registerGame({
    id:'borrowed-moons',title:'Dino Dig',kind:'Original',genre:'Puzzle',best:'Either',accent:'#d8bd8e',buttons:{a:'Brush / fit',b:'Find'},
    description:'Brush a fossil out of a patch of red earth and fit its bones together. Tiny three-toed tracks lead to a second find under the sand.',
    controls:'Rub or tap the sandy bumps to uncover bones. Drag a loose bone onto its matching outline, or tap the bone and then the outline. D-pad moves the brush. A brushes, picks up or fits. B finds the next spot.',
    sources:[],
    create(g){
      const specs=[['Skull',96,121,551,174],['Ribs',251,162,474,201],['Tail',101,247,410,186],['Hips',243,281,432,204],['Legs',167,329,473,237]];
      const pieces=specs.map(([name,x,y,tx,ty],i)=>({name,x,y,tx,ty,i,placed:false,sand:makeSand(x,y,i)}));
      const egg={x:286,y:84,sand:makeSand(286,84,8)},brush={x:96,y:121},fx=particles();
      let held=null,time=0,done=false,big=false,hover=0,trail=[],ending=0,down=false;
      function makeSand(x,y,i){return Array.from({length:9},(_,j)=>({x:x+(j%3-1)*17+(seed(i*7+j)-.5)*7,y:y+(Math.floor(j/3)-1)*12+(seed(i+j+8)-.5)*6,r:11+seed(i*19+j)*5,gone:false}));}
      const exposed=o=>o.sand.every(p=>p.gone);
      const tip=()=>pieces.find(o=>!o.placed);
      g.say('Brush the pale bone tip in the upper-left patch. Rub across the mound, then fit the skull into the outline on the right.');
      function fit(){if(!held)return false;const socket={x:held.tx,y:held.ty};if(gap(brush,socket)>30)return false;held.placed=true;fx.burst(socket.x,socket.y,'#ffdf83',12);fx.word(socket.x,socket.y-21,held.name);g.tone(425+pieces.filter(o=>o.placed).length*85,.1);held=null;
        if(pieces.every(o=>o.placed)){ending=1.05;g.say('A complete triceratops!');}else g.say('It fits. Brush another pale patch in the dig bed.');return true;}
      function sweep(){if(done||ending)return;if(held){if(brush.x>334)fit();return;}
        let dust=false;for(const o of [...pieces,egg]){if(o.placed||o===egg&&big)continue;const was=exposed(o);for(const s of o.sand){if(!s.gone&&gap(brush,s)<(big?39:26)){s.gone=true;dust=true;fx.burst(s.x,s.y,'#e9ba86',3);}}
          if(!was&&exposed(o)){if(o===egg){big=true;g.tone(830,.12);fx.word(egg.x,egg.y-22,'Egg! Wide brush');g.say('A speckled egg! Your new wide brush clears bigger patches.');}
            else {held=o;g.tone(560,.1);g.say(o.name+' uncovered. Drag or tap onto the lit outline on the right.');return;}}
          if(o!==egg&&was&&gap(brush,o)<29){held=o;g.tone(450,.055);g.say('Fit '+o.name.toLowerCase()+' into the bright outline.');return;}}
        if(dust){hover=.12;g.tone(175,.025);} }
      function find(){if(done||ending)return;if(held){brush.x=held.tx;brush.y=held.ty;g.say('Press A to fit the '+held.name.toLowerCase()+'.');return;}
        const o=tip();if(!o)return;const dirt=o.sand.find(s=>!s.gone);brush.x=dirt?dirt.x:o.x;brush.y=dirt?dirt.y:o.y;g.say('Your brush is over the '+o.name.toLowerCase()+'. Press A or rub the patch.');}
      function handle(x,y){brush.x=clamp(x,15,624);brush.y=clamp(y,54,372);trail.push({x:brush.x,y:brush.y,t:time});sweep();}
      function tap(x,y){if(done||ending)return;if(x>555&&y>375){find();return;}down=true;handle(x,y);}
      function press(k){if(k==='b')find();if(k==='a')sweep();}
      function update(dt){if(done)return;time+=dt;fx.update(dt);hover=Math.max(0,hover-dt);trail=trail.filter(q=>time-q.t<.28);
        if(ending){ending-=dt;if(ending<=0){done=true;g.win('You put a triceratops back together'+(big?' and found its speckled egg.':'.'));return;}}
        const v=axes(g),n=Math.hypot(v.x,v.y);if(n){brush.x=clamp(brush.x+v.x/n*207*dt,13,626);brush.y=clamp(brush.y+v.y/n*207*dt,50,369);if(g.held('a'))sweep();}
        g.hud(pieces.filter(o=>o.placed).length+'/5 bones fitted · '+(held?'Carrying '+held.name.toLowerCase():big?'Wide brush':'Field brush'));}
      function bone(c,i,x,y,s,fill,edge){c.save();c.translate(x,y);c.scale(s,s);
        const stroke=(pts,w)=>{line(c,pts,edge,w+2);line(c,pts,fill,w);};
        const shape=pts=>{poly(c,pts,fill);line(c,[...pts,pts[0]],edge,1.3);};
        if(i===0){shape([[-16,6],[-24,-8],[-21,-19],[-13,-17],[-10,-22],[-3,-19],[4,-23],[10,-13],[13,-8],[23,-7],[30,-2],[26,5],[15,7],[9,12],[-1,12],[-6,8]]);shape([[0,-8],[16,-24],[9,-6]]);shape([[9,-7],[24,-18],[18,-4]]);shape([[21,-3],[28,-11],[28,-2]]);oval(c,-7,-9,4,5,edge,-.3);oval(c,7,0,3,2.6,edge);line(c,[[12,8],[21,4],[29,3]],edge,1.7);}
        if(i===1){stroke([[-32,-15],[-18,-19],[0,-20],[21,-18],[34,-14]],5);
          for(let j=0;j<6;j++){const xx=-24+j*9,dy=4*Math.abs(j-2.5);stroke([[xx,-16],[xx+4,-4],[xx+6,8],[xx+2,20-dy]],3.2);}
          stroke([[-19,9],[-2,15],[16,11]],2.5);}
        if(i===2){stroke([[-38,-15],[-21,-9],[-5,-1],[8,3],[22,5],[34,4]],4);for(let j=0;j<7;j++){const xx=-25+j*8,yy=Math.min(4,-11+j*3);oval(c,xx,yy,2+j*.2,2+j*.4,fill,-.45);} }
        if(i===3){shape([[-16,-7],[-20,-17],[-12,-20],[-1,-15],[11,-17],[22,-11],[16,-4],[8,-2],[5,6],[-3,8],[-9,3]]);oval(c,0,-4,4,3,edge);stroke([[-5,8],[-7,20],[-12,30],[-8,35],[0,35]],5);}
        if(i===4){stroke([[-13,-20],[-12,-6],[-16,10],[-16,17],[-7,18]],6);stroke([[13,-19],[9,-4],[12,12],[11,18],[20,18]],6);for(const xx of [-12,11])oval(c,xx,-18,5,4,fill);}
        c.restore();}
      function board(c){box(c,339,43,290,318,'#453d3a',10);box(c,343,47,282,310,'#24494a',8);
        for(let i=0;i<27;i++){const x=348+seed(i+1)*267,y=56+seed(i+48)*294;circle(c,x,y,.8,'#78918b');}
        for(const [x,y] of [[351,56],[617,56],[351,349],[617,349]]){circle(c,x,y,3.1,'#b49e75');line(c,[[x-1,y+1],[x+1,y-1]],'#756c55',1);}
        txt(c,'TRICERATOPS',485,87,19,'#e3dab6','center');line(c,[[394,107],[577,107]],'#698680',1);
        // These pin positions form a single, connected side-view skeleton.
        const neckColor=pieces[0].placed&&pieces[1].placed?'#dbc79a':'#69877e';
        line(c,[[503,183],[518,180],[533,178]],neckColor,3);for(let j=0;j<5;j++)oval(c,505+j*6,182-j,2.4,3.4,neckColor,-.55);
        const order=[2,3,4,1,0];for(const i of order){const o=pieces[i],selected=o===held;bone(c,i,o.tx,o.ty,1.12,o.placed?'#e4d2a2':selected?'#92b8a2':'#496965',o.placed?'#a9926f':selected?'#dcf0bb':'#6d8880');
          if(selected){const a=2+Math.sin(time*5)*2;for(const sx of [-1,1])for(const sy of [-1,1])line(c,[[o.tx+sx*(29+a),o.ty+sy*18],[o.tx+sx*(29+a),o.ty+sy*(22+a)],[o.tx+sx*23,o.ty+sy*(22+a)]],'#fff0a9',1.6);}}
        const count=pieces.filter(o=>o.placed).length;for(let i=0;i<5;i++)circle(c,457+i*14,305,4.3,i<count?'#f4cf87':'#617b70');txt(c,count+' of 5 bones',485,326,13,'#dfd5b0','center');}
      function draw(c){gradient(c,'#ba805f','#986d59');for(let i=0;i<130;i++){const x=seed(i*3+8)*W,y=seed(i*3+2)*H;oval(c,x,y,1+seed(i)*2,.9,i%2?'#e2ad7f':'#9b7059');}
        box(c,10,43,318,318,'#99694d',11);box(c,14,47,310,310,'#d4a071',9);
        for(let j=0;j<9;j++){const x=37+j*35;line(c,[[x,354],[x+5,350],[x+11,352]],'#bf8e68',1);}
        for(let i=0;i<110;i++){const x=21+seed(i+33)*295,y=55+seed(i+61)*290;oval(c,x,y,1+seed(i+1)*2,.9,'#b68563');}
        for(let j=0;j<4;j++){const x=221+j*13,y=85-j*2+Math.sin(j)*5;for(let i=-1;i<=1;i++)line(c,[[x,y+1],[x+i*3,y-2+Math.abs(i)]],'#a47a62',1.4);}
        for(const o of pieces)if(!o.placed&&o!==held){oval(c,o.x,o.y+2,36,18,'#c49470');bone(c,o.i,o.x,o.y,1.03,'#ead6a7','#ac906f');}
        if(!big){oval(c,egg.x,egg.y,9,13,'#f3d397',-.32);for(let i=0;i<5;i++)circle(c,egg.x-5+seed(i+31)*10,egg.y-9+seed(i+1)*17,1.7,'#af8c72');}
        for(const o of [...pieces,egg])if(!o.placed&&o!==held)for(const s of o.sand)if(!s.gone){oval(c,s.x,s.y+1,s.r*1.18,s.r*.76,'#bf8a62');oval(c,s.x-1,s.y-1,s.r*1.16,s.r*.77,'#daaa77');for(let j=0;j<3;j++)circle(c,s.x+(seed(j+s.x)-.5)*s.r*1.3,s.y+(seed(j+s.y)-.5)*s.r*.75,.85,'#b88764');}
        // Small exposed tips identify the dig sites before the first brush stroke.
        for(const o of pieces){if(o.placed||o===held||o.sand.some(s=>s.gone))continue;line(c,[[o.x-9,o.y-3],[o.x-4,o.y-6],[o.x+2,o.y-5]],'#eddbb1',3.4);}
        board(c);if(held){bone(c,held.i,brush.x,brush.y,1,'#fff0c3','#9b805f');if(brush.x<325)label(c,'Fit '+held.name+' →',brush.x,brush.y+35);}
        else{if(trail.length>1)line(c,trail.map(q=>[q.x,q.y]),'#ead5a288',5);c.save();c.translate(brush.x,brush.y);c.rotate(-.65+Math.sin(time*24)*hover);
          box(c,-3,-33,7,26,'#674d3e',3);rect(c,-6,-11,13,8,'#a1aaa1');poly(c,[[-6,-4],[6,-4],[10,9],[-11,9]],'#e9cb91');for(let j=-2;j<=2;j++)line(c,[[j*2,-2],[j*3,8]],'#c6a770',1.1);c.restore();}
        label(c,'Dig bed',55,23);if(big)label(c,'Egg found',208,23);label(c,'Find [B]',588,394);
        if(time<7&&!held&&!pieces.some(o=>o.placed))label(c,'Rub here',94,80);
        txt(c,held?'Drag to its outline':'Rub the sand',18,391,14,'#fff0cd');fx.draw(c);}
      return {update,draw,press,tap,drag(x,y){if(down)handle(x,y);},release(){down=false;if(held)fit();}};
    }
  });
})();

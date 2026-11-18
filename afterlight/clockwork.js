(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const direction = {left:[-1,0],right:[1,0],up:[0,-1],down:[0,1]};
  const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
  const length = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1]);
  function rect(c,x,y,w,h,color){c.fillStyle=color;c.fillRect(x,y,w,h);}
  function oval(c,x,y,rx,ry,col,tilt=0){
    c.fillStyle=col;c.beginPath();c.ellipse(x,y,rx,ry,tilt,0,TAU);c.fill();
  }
  function path(c,pts,col,w=2){
    c.beginPath();pts.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));
    c.lineCap='round';c.lineJoin='round';c.strokeStyle=col;c.lineWidth=w;c.stroke();
  }
  function poly(c,pts,col){
    c.beginPath();pts.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fillStyle=col;c.fill();
  }
  function label(c,msg,x,y,size,col,align='left',font='system-ui'){
    c.font='bold '+size+'px '+font;c.textAlign=align;c.textBaseline='middle';c.fillStyle=col;c.fillText(msg,x,y);
  }
  function sky(c,colors){
    const grad=c.createLinearGradient(0,0,0,420);
    colors.forEach((col,i)=>grad.addColorStop(i/(colors.length-1),col));rect(c,0,0,640,420,grad);
  }
  function badge(c,msg,x,y,col='#243740',light='#fff5d7'){
    c.font='bold 12px system-ui';const w=c.measureText(msg).width;
    c.fillStyle=col;c.beginPath();c.roundRect(x-w/2-8,y-11,w+16,22,9);c.fill();label(c,msg,x,y,12,light,'center');
  }
  function star(c,x,y,r,col){
    poly(c,Array.from({length:8},(_,i)=>[x+Math.sin(i*Math.PI/4)*(i%2?r*.26:r),y+Math.cos(i*Math.PI/4)*(i%2?r*.26:r)]),col);
  }
  function focus(c,p,t,color='#ffefac'){
    const size=21+Math.sin(t*4)*2;
    for(const [dx,dy] of [[-1,-1],[1,-1],[-1,1],[1,1]]){
      const x=p[0]+dx*size,y=p[1]+dy*size;
      path(c,[[x-dx*6,y],[x,y],[x,y-dy*6]],color,2);
    }
  }
  function nextInDirection(points,current,key){
    const d=direction[key],p=points[current];let best=current,cost=Infinity;
    points.forEach((q,i)=>{
      const dx=q[0]-p[0],dy=q[1]-p[1],forward=dx*d[0]+dy*d[1];
      if(forward<=5)return;
      const side=Math.abs(dx*d[1]-dy*d[0]);
      if(side>forward*1.8)return;
      const score=Math.hypot(dx,dy)+side*1.6;if(score<cost){best=i;cost=score;}
    });return best;
  }
  function closest(points,x,y,limit=45){
    let best=-1,dist=limit;
    points.forEach((p,i)=>{const n=length(p,[x,y]);if(n<dist){dist=n;best=i;}});return best;
  }
  const pr34=(name,mechanic)=>[name,'PR #34',mechanic];
  const pr35=(name,mechanic)=>[name,'PR #35',mechanic];

  registerGame({
    id:'afterimage-freight',title:'The Kite on Skate Lake',genre:'Puzzle',kind:'Remix',accent:'#9ee9ed',best:'Either',
    description:'A red scarf, two spruce spars and a spool of string fell through the snow. A little fox has a kite to make.',
    controls:'Swipe the fox, tap a direction on the lake, or use the D-pad to slide. B reels the steel sled one space back along its last run. Bring all three kite parts home.',
    buttons:{a:'Slide',b:'Reel'},
    sources:[pr34('Rune Golem','The sled runs straight until an obstacle stops it.'),pr35('Magnet','A magnetic winch pulls the steel sled backward along its line, one space at a time.'),pr34('Castaway Cove','Gather scattered materials and assemble a working vehicle back at camp.')],
    create(g){
      const board=['........','..#..#..','...#....','.#....#.','........'];
      const hut=[0,2],parts=[[4,0],[7,2],[2,4]],hare=[4,3];
      const xy=p=>[87+p[0]*66,113+p[1]*52];
      const eq=(a,b)=>a[0]===b[0]&&a[1]===b[1];
      let pos=[...hut],shown=xy(pos),rope=[],queue=[],facing=[1,0],got=new Set(),found=false;
      let done=false,clock=0,gesture=null,kite=0,completed=false;
      function hud(){g.hud('Kite parts '+got.size+'/3'+(found?'  ·  Arctic hare':'') );}
      function arrive(){
        pos=queue.shift();shown=xy(pos);const i=parts.findIndex(p=>eq(p,pos));
        if(i>=0&&!got.has(i)){
          got.add(i);g.tone(430+i*90,.09);
          g.say(got.size===3?'All three! Slide back to the red cabin.':['A red silk scarf.','Two light spruce spars.','A whole spool of kite string.'][i]);
        }
        if(!found&&eq(pos,hare)){found=true;g.say('Two black ears! A snowshoe hare hops out of the drift.');g.tone(810,.08);}
        hud();
        if(got.size===3&&eq(pos,hut)){done=true;queue=[];g.say('Up she goes!');g.tone(720,.18);}
      }
      function slide(d){
        if(done||queue.length)return;
        const track=[[...pos]];let p=pos;
        while(true){const q=[p[0]+d[0],p[1]+d[1]];if(board[q[1]]?.[q[0]]!=='.')break;track.push(q);p=q;}
        if(track.length<2){g.say('Ice ends here. Pick another direction.');return;}
        facing=d;rope=track.slice(0,-1);queue=track.slice(1);g.tone(250,.05);g.say('B reels you back one space along the track.');
      }
      function reel(){
        if(done||queue.length)return;
        if(!rope.length){g.say('Make a slide first to lay out your winch line.');return;}
        queue=[rope.pop()];g.tone(370,.06);
      }
      function press(k){if(direction[k])slide(direction[k]);else if(k==='b')reel();else if(k==='a')slide(facing);}
      function aim(dx,dy){return Math.abs(dx)>Math.abs(dy)?[Math.sign(dx),0]:[0,Math.sign(dy)];}
      function tap(x,y){
        gesture=null;if(done)return;
        if(x>492&&y>374){reel();return;}
        if(length(shown,[x,y])<31){gesture=[x,y];return;}
        slide(aim(x-shown[0],y-shown[1]));
      }
      function tree(c,x,y,s){
        rect(c,x-2*s,y-8*s,4*s,11*s,'#7d6357');
        for(let i=0;i<3;i++){const a=(15-i*3)*s,b=y-i*7*s;poly(c,[[x-a,b],[x,b-21*s],[x+a,b]],'#427271');poly(c,[[x-a*.72,b-5*s],[x,b-21*s],[x+a*.58,b-8*s]],'#d8efdf');}
      }
      function object(c,i,x,y){
        oval(c,x,y+11,17,4,'#628f9477');
        if(i===0){path(c,[[x-11,y+5],[x-5,y-8],[x+7,y-7],[x+13,y+7],[x+18,y+5]],'#ba4249',7);path(c,[[x-5,y-9],[x+5,y-9]],'#f9a28a',2);}
        if(i===1){path(c,[[x-12,y+10],[x+10,y-11]],'#946445',4);path(c,[[x-9,y-10],[x+11,y+8]],'#c18f60',4);oval(c,x,y,3,3,'#fff3bd');}
        if(i===2){rect(c,x-9,y-8,18,16,'#bb6941');for(let j=-5;j<7;j+=3)path(c,[[x-8,y+j],[x+8,y+j-1]],'#ffdc8e',2);rect(c,x-12,y-10,24,4,'#805740');rect(c,x-12,y+6,24,4,'#805740');}
      }
      function draw(c){
        sky(c,['#e9c4ac','#e8e0cf','#a6d2d0']);oval(c,483,46,23,23,'#fff0cb');
        poly(c,[[0,100],[0,53],[52,60],[109,20],[176,72],[262,28],[340,79],[429,45],[480,73],[540,18],[640,80],[640,107]],'#93aaa6');
        poly(c,[[62,62],[109,20],[155,61],[127,48],[114,53],[105,42],[91,57]],'#f9ead4');
        for(let i=0;i<27;i++) tree(c,(i*83)%673-16,81+(i*31)%26,.5+(i%3)*.13);
        oval(c,317,226,344,164,'#eef1df');oval(c,318,225,320,146,'#9ccbd0');
        poly(c,[[58,90],[526,84],[588,99],[606,148],[612,309],[572,347],[65,351],[38,312],[34,145]],'#9ecfd1');
        for(let r=0;r<5;r++)for(let s=0;s<8;s++){
          const [x,y]=xy([s,r]);path(c,[[x-25,y+17],[x-12,y+15],[x-4,y+16]],'#c3e3df',1.5);
          if(board[r][s]==='#'){oval(c,x,y+7,27,9,'#84adb0');poly(c,[[x-25,y+3],[x-15,y-15],[x+5,y-21],[x+21,y-11],[x+27,y+7]],'#688388');poly(c,[[x-23,y-2],[x-12,y-18],[x+6,y-23],[x+19,y-14],[x+13,y-10],[x+2,y-13],[x-6,y-7]],'#f7f5e6');}
        }
        const [hx,hy]=xy(hut);rect(c,hx-17,hy-19,35,24,'#a35343');poly(c,[[hx-25,hy-18],[hx,hy-37],[hx+25,hy-18]],'#fcf4dc');rect(c,hx-9,hy-12,10,17,'#653f39');rect(c,hx+6,hy-15,7,7,'#ffe68b');
        parts.forEach((p,i)=>{if(!got.has(i)){const [x,y]=xy(p);star(c,x+16,y-12,3+Math.sin(clock*4+i),'#fff8d5');object(c,i,x,y);}});
        const [ax,ay]=xy(hare);
        if(found){const hop=Math.abs(Math.sin(clock*2.4))*4;oval(c,ax+8,ay-hop,13,8,'#f9f8e8');oval(c,ax+18,ay-6-hop,7,6,'#faf8e8');oval(c,ax+17,ay-15-hop,2.5,9,'#eeeeda',-.2);oval(c,ax+22,ay-15-hop,2.5,9,'#eeeeda',.2);oval(c,ax+20,ay-7-hop,1.2,1.2,'#323e41');}
        else{oval(c,ax,ay+2,19,5,'#b5dcdb');oval(c,ax-3,ay-2,2,5,'#698885',-.18);oval(c,ax+3,ay-1,2,5,'#698885',.2);}
        if(rope.length)path(c,[xy(rope[0]),shown],'#628c91',1.8);
        const [x,y]=shown;oval(c,x,y+12,19,5,'#648f96');path(c,[[x-18,y+10],[x+12,y+10],[x+19,y+6]],'#5c5960',3);
        poly(c,[[x-4,y+5],[x-18,y+1],[x-22,y-8],[x-11,y-3],[x-6,y-4]],'#be5b34');
        oval(c,x,y+1,11,8,'#ce6e39');poly(c,[[x-7,y-7],[x-8,y-20],[x-1,y-15],[x+5,y-16],[x+11,y-21],[x+13,y-8],[x+4,y]],'#d97b43');poly(c,[[x-6,y-8],[x+4,y-4],[x+12,y-9],[x+5,y+1]],'#fff0cd');oval(c,x+7,y-10,1.4,1.4,'#38454b');
        if(!done&&!rope.length&&!queue.length){path(c,[[x+28,y],[x+44,y],[x+37,y-5]],'#416e77',2);}
        if(done){const kx=hx+Math.min(kite,1)*175,ky=hy-25-Math.min(kite,1)*116;path(c,[[hx,hy],[kx,ky]],'#fff5ce',1.5);poly(c,[[kx,ky-16],[kx+14,ky],[kx,ky+24],[kx-13,ky]],'#c95650');path(c,[[kx,ky+20],[kx+8,ky+31],[kx-1,ky+43]],'#d17b4e',2);}
        label(c,'SKATE LAKE',22,29,23,'#294b50','left','Georgia');
        rect(c,0,372,640,48,'#294b50');label(c,done?'The kite is flying.':got.size===3?'Return to the red cabin':'Build a kite',20,396,16,'#fff4d9');
        parts.forEach((_,i)=>{c.save();c.globalAlpha=got.has(i)?1:.55;object(c,i,254+i*48,397);c.restore();if(got.has(i))label(c,'✓',267+i*48,389,12,'#def0c7');});
        badge(c,'B   REEL',558,396,'#477278');
      }
      hud();g.say('Swipe the fox to slide. Gather three kite parts.');
      return {press,tap,drag(x,y){if(gesture&&length(gesture,[x,y])>18){slide(aim(x-gesture[0],y-gesture[1]));gesture=null;}},release(){if(gesture)reel();gesture=null;},draw,update(dt){
        clock+=dt;
        if(done){kite+=dt;if(kite>1.15&&!completed){completed=true;g.win('The kite climbs above Skate Lake.'+(found?' A snowshoe hare chases its red shadow.':''));}return;}
        let remaining=dt*550;
        while(queue.length&&remaining>0){const target=xy(queue[0]),d=length(shown,target);if(d<=remaining){remaining-=d;arrive();}else{shown=shown.map((v,i)=>v+(target[i]-v)*remaining/d);break;}}
      }};
    }
  });

  registerGame({
    id:'sounding-bell',title:'A Mouthful of Sea',genre:'Puzzle',kind:'Remix',accent:'#f6a48e',best:'Either',
    description:'A minnow, a pufferfish and an octopus share one crowded tidepool. Everybody wants a snack.',
    controls:'Tap anywhere to swim. Visit creatures and objects to interact. On a D-pad choose a spot and press A. B calls nearby krill into your wake. Feed a hungry creature to take its shape.',
    buttons:{a:'Swim',b:'Call'},
    sources:[pr34('Borrowed Skins','Feeding a host moves you into its body and gives you its physical ability.'),pr34('Flockward','Call a loose school together and lead the followers to a destination.'),pr34('Castaway Cove','Explore pockets off the main route and gather a resource to open the next part of the world.')],
    create(g){
      const spots=[[112,139],[283,170],[309,306],[468,223],[548,313],[72,304],[525,109]];
      const names=['KRILL','PUFFER','OYSTER','OCTOPUS','CORKED JAR','SPONGE','CREVICE'];
      let body=0,shoal=false,pearl=false,toy=false,treasure=false,focusId=0,target=-1;
      let pos=[76,205],roam=null,clock=0,pulse=0,puff=0,finish=0,done=false,winSent=false;
      const title=()=>['Minnow','Pufferfish','Octopus'][body];
      function hud(){g.hud(title()+(shoal?'  ·  Krill school':'')+(pearl?'  ·  Pearl':'')+(toy?'  ·  Bubble pipe':'')+(treasure?'  ·  Sea glass':''));}
      function call(){
        pulse=1;g.tone(630,.07);
        if(body===0&&length(pos,spots[0])<105){shoal=true;g.say('The krill follow you. They look delicious to the pufferfish.');}
        else if(body===0&&!shoal)g.say('Swim closer to the pink krill to call them.');
        else g.say(body===1?'The puffer puffs up. Try that beside the oyster.':'Your call rolls across the tidepool.');
        if(body===1)puff=1;hud();
      }
      function interact(i){
        if(i===0){call();return;}
        if(i===1){
          if(body===0&&shoal){body=1;shoal=false;puff=1;g.say('Now you’re the pufferfish! Bump that tight-lipped oyster.');g.tone(310,.14);}
          else g.say(body===0?'The pufferfish wants the pink krill.':'The puffer’s old den is full of striped shells.');
        }
        if(i===2){
          if(body===1&&!pearl){puff=1;pearl=true;g.tone(760,.13);g.say('Pop! A pearl. The octopus has one empty spot in its collection.');}
          else g.say(body===0?'Clamped shut. This needs a much bigger bump.':'The oyster fans its silky pink mantle.');
        }
        if(i===3){
          if(body===1&&pearl){body=2;pearl=false;g.tone(500,.14);g.say('Eight arms! Reach into the corked jar.');}
          else g.say(body===2?'Three pearls sit in a perfect row.':'Two pearls and an empty dimple. The octopus is looking for a third.');
        }
        if(i===4){
          if(body===2){done=true;g.say('Pop! Baby seahorses tumble into the tidepool.');g.tone(850,.17);}
          else g.say('A seahorse peeks out. It takes a curling arm to twist this cork.');
        }
        if(i===5){toy=true;pulse=1;g.say('A bubble pipe! The sponge blows a string of tiny bubble rings.');g.tone(900,.1);}
        if(i===6){if(body===2){treasure=true;g.say('Your arm finds a piece of bottle-green sea glass in the crack.');g.tone(980,.1);}else g.say('A green glint at the back. Who could reach into that crack?');}
        hud();
      }
      function visit(i){if(done)return;roam=null;focusId=i;target=i;if(length(pos,spots[i])<2){target=-1;interact(i);}}
      function swim(x,y){
        if(done||y<59||y>374)return;
        const i=closest(spots,x,y,39);
        if(i>=0){visit(i);return;}
        target=-1;roam=[clamp(x,22,617),clamp(y,70,343)];
      }
      function press(k){if(done)return;if(direction[k])focusId=nextInDirection(spots,focusId,k);else if(k==='a')visit(focusId);else if(k==='b')call();}
      function fish(c,x,y,type,s=1){
        c.save();c.translate(x,y);c.scale(s,s);
        if(type===2){
          for(let i=0;i<7;i++){const u=-18+i*6;path(c,[[u*.6,5],[u,16],[u+Math.sin(clock*4+i)*4,23],[u+5,25]],'#cd7c92',4);}
          oval(c,0,-2,17,19,'#ce8297');oval(c,-4,-9,10,7,'#df9bac',-.4);
          oval(c,-5,-1,2.2,3,'#352942');oval(c,5,-1,2.2,3,'#352942');path(c,[[-1,5],[2,6],[5,4]],'#77465b',1.5);
        }else{
          const p=type===1,col=p?'#f2bc65':'#6ad7c5',wide=p?21:19,tall=p?17:9;
          poly(c,[[-wide+4,0],[-wide-10,-8],[-wide-9,8]],p?'#cd9059':'#4aafbd');oval(c,0,0,wide,tall,col);
          if(p)for(let i=0;i<12;i++){const ang=i*TAU/12,dx=Math.cos(ang),dy=Math.sin(ang);poly(c,[[dx*19-dy*2,dy*15+dx*2],[dx*25,dy*21],[dx*19+dy*2,dy*15-dx*2]],'#d49b59');}
          oval(c,4,tall*.5,wide*.68,tall*.3,p?'#ffe1a4':'#b6efdb');oval(c,10,-3,3.5,4,'#fff5cc');oval(c,11,-3,1.8,2.3,'#36334a');
          path(c,[[-2,0],[-8,5],[-2,5]],p?'#b77647':'#378d9e',2);
        }c.restore();
      }
      function krill(c,x,y,s=1){c.save();c.translate(x,y);c.scale(s,s);path(c,[[-5,-3],[-5,1],[-1,4],[4,2],[5,-2]],'#ffb699',3);path(c,[[4,-1],[9,-6],[12,-5]],'#ffd5b4',1);c.restore();}
      function bubble(c,x,y,r){c.beginPath();c.arc(x,y,r,0,TAU);c.strokeStyle='#a4e5dc';c.lineWidth=1.2;c.stroke();oval(c,x-r*.35,y-r*.42,Math.max(1,r*.18),1,'#edffde');}
      function clam(c,x,y,open){
        oval(c,x,y+8,30,7,'#28495c');
        for(let i=0;i<7;i++){const a=(i-3)*.31;oval(c,x+Math.sin(a)*12,y-4,6,15,open?'#faafaa':'#dc9098',a);}
        path(c,[[x-23,y-3],[x-15,y+4],[x,y+8],[x+16,y+4],[x+23,y-3]],'#ffcab1',3);
      }
      function itemBubble(c,i,art){
        const [x,y]=spots[i];oval(c,x+25,y-39,19,15,'#f3ead7');oval(c,x+9,y-24,4,3,'#f3ead7');
        if(art==='shrimp')krill(c,x+23,y-38,1.25);
        else oval(c,x+25,y-39,7,7,'#bca6af'),oval(c,x+23,y-41,4,4,'#fff2d8');
      }
      function draw(c){
        sky(c,['#f7d7a4','#9bd9ce','#347e88','#25485f']);
        for(let i=0;i<7;i++){const x=i*108-64;poly(c,[[x,30],[x+30,33],[x-12,260],[x-92,344]],'#d9f7d81b');}
        for(let i=0;i<12;i++){const x=i*62;path(c,[[x,57+Math.sin(clock+i)*2],[x+22,54],[x+43,56],[x+52,55]],'#eff5cf',2);}
        poly(c,[[0,274],[44,291],[97,288],[182,340],[251,329],[329,356],[439,306],[504,324],[572,276],[640,270],[640,420],[0,420]],'#427579');
        poly(c,[[0,334],[85,326],[157,351],[239,340],[323,361],[417,326],[476,343],[555,339],[640,319],[640,420],[0,420]],'#c6a182');
        for(let i=0;i<41;i++){const x=(i*97)%649,y=347+(i*41)%32;oval(c,x,y,2+i%4,1.5,'#9a8276');}
        for(let i=0;i<13;i++){const x=[11,23,38,58,167,182,195,217,395,404,591,610,631][i],y=344-(i%3)*6;
          path(c,[[x,y],[x+5,y-26],[x-4,y-44],[x+Math.sin(clock*1.6+i)*8,y-68-(i%4)*12]],i%2?'#42826e':'#326d67',5+i%3);}
        for(let i=0;i<15;i++){const x=12+(i*83)%617,y=67+((i*63-clock*(8+i%6))%260+260)%260;bubble(c,x,y,1+i%3);}
        if(!shoal&&body===0)for(let i=0;i<7;i++)krill(c,spots[0][0]+Math.cos(i*2.1+clock)*18,spots[0][1]+Math.sin(i*2.7+clock)*10);
        if(body!==0){for(let i=0;i<3;i++)oval(c,283+i*9,180+i%2*3,6,3,'#d9af81');}
        else{fish(c,283,170+Math.sin(clock)*2,1);itemBubble(c,1,'shrimp');}
        clam(c,309,306,pearl||body===2);
        if(body!==2){fish(c,468,223+Math.sin(clock*1.4)*2,2);itemBubble(c,3,'pearl');}
        for(let i=0;i<(body===2?3:2);i++)oval(c,448+i*13,251,5,5,'#f1dac5');
        const jx=548,jy=312;
        poly(c,[[jx-14,jy-29],[jx-14,jy-20],[jx-24,jy-12],[jx-24,jy+19],[jx-16,jy+24],[jx+19,jy+24],[jx+25,jy+18],[jx+25,jy-12],[jx+14,jy-20],[jx+14,jy-29]],'#b6e7dc77');
        path(c,[[jx-17,jy-27],[jx-10,jy-27],[jx-10,jy-18],[jx-20,jy-10],[jx-20,jy+12]],'#e3f5dc',2);
        rect(c,jx-13+(done?31:0),jy-34-(done?12:0),26,10,'#ad795a');
        for(let i=0;i<(done?5:2);i++){const x=jx-5+i*9+(done?Math.sin(i+clock*2)*finish*35:0),y=jy+5-i%2*5-(done?finish*(48+i*8):0);
          path(c,[[x+4,y-7],[x,y-8],[x-2,y-3],[x+3,y+2],[x+1,y+7],[x-3,y+6]],'#ffd572',3);}
        for(let i=0;i<4;i++){const x=57+i*9,y=312-Math.sin(i*2)*7;oval(c,x,y,6,14,'#d28b6d');oval(c,x,y-11,4,2,'#80585c');}
        if(toy)for(let i=0;i<7;i++)bubble(c,72+Math.sin(i+clock*2)*9,287-((i*12+clock*18)%73),2+i*.6);
        poly(c,[[494,118],[506,94],[527,86],[548,103],[550,121]],'#527983');path(c,[[509,111],[517,105],[523,114],[534,103]],'#263e58',4);star(c,529,109,treasure?2:5,'#b5f5ac');
        if(shoal)for(let i=0;i<7;i++)krill(c,pos[0]-23-i*3,pos[1]+Math.sin(clock*4+i)*9);
        if(pulse>0){c.beginPath();c.arc(...pos,12+(1-pulse)*65,0,TAU);c.strokeStyle='#d4f7dc';c.lineWidth=pulse*2;c.stroke();}
        fish(c,pos[0],pos[1]+Math.sin(clock*3)*2,body,body===1?1+puff*.3:1);
        if(pearl)oval(c,pos[0]+19,pos[1]+8,6,6,'#fae9d5');
        focus(c,spots[focusId],clock);label(c,'A Mouthful of Sea',22,29,24,'#315862','left','Georgia');
        rect(c,0,376,640,44,'#223f50');label(c,title(),18,398,15,'#fff1ce');label(c,names[focusId],320,398,13,'#aee2d5','center');
        badge(c,'B   CALL',564,398,'#406979');
      }
      hud();g.say('Tap the pink krill. The pufferfish is hungry.');
      return {draw,press,tap(x,y){if(done)return;if(y>376&&x>480){call();return;}swim(x,y);},drag(x,y){swim(x,y);},update(dt){
        clock+=dt;pulse=Math.max(0,pulse-dt);puff=Math.max(0,puff-dt*2);
        if(done){finish+=dt;if(finish>1&&!winSent){winSent=true;g.win('Five baby seahorses curl their tails around the kelp.'+(treasure?' A piece of green sea glass shines in your den.':''));}return;}
        if(target<0&&!roam)return;
        const q=roam||spots[target],d=length(pos,q),step=dt*430;
        if(d<=step){pos=[...q];const i=target;target=-1;roam=null;if(i>=0)interact(i);}
        else pos=pos.map((v,i)=>v+(q[i]-v)*step/d);
      }};
    }
  });

  registerGame({
    id:'shepherd-hour',title:'One Mouse Toastie',genre:'Puzzle',kind:'Remix',accent:'#e6bd85',best:'Either',
    description:'The cat has its eye on the kitchen table. There’s cheese on the board and toast in the drawer. Somewhere under a teacup, a mouse is setting supper for two.',
    controls:'Tap a tabletop spot to scamper along the crumb trails. D-pad moves to a neighboring spot. The orange paw marks the cat’s next swat. B waits one beat. Tap the brass button twice, or use A on it, to leave a mouse double holding the toast drawer open.',
    buttons:{a:'Double',b:'Wait'},
    sources:[pr35('Still','The cat changes its target only when the mouse moves or waits.'),pr34('Chrono Vault','Rewind to the mousehole while an echo mouse stays behind on the spring button.'),pr34('Castaway Cove','Fetch scattered ingredients and return home to assemble them.')],
    create(g){
      const pts=[[64,268],[145,222],[232,150],[310,223],[402,164],[527,193],[364,315],[193,307],[509,310]];
      const edges=[[0,1],[0,7],[1,2],[1,3],[1,7],[2,3],[3,4],[3,6],[3,7],[4,5],[5,8],[6,7],[6,8]];
      const labels=['MOUSEHOLE','THIMBLE','CHEDDAR','BUTTON','DRAWER','TOAST','JAM','SPOON','SUGAR'];
      const patrol=[2,3,6,5,8,1,3,7];
      let node=0,pos=[...pts[0]],route=[],to=-1,origin=[...pos],travel=0,phase=0,clock=0,swat=0,swatNode=0;
      let cheese=false,toast=false,echo=false,jam=false,sugar=false,done=false,finish=0,won=false;
      const danger=()=>patrol[phase%patrol.length];
      const neighbors=i=>edges.filter(e=>e.includes(i)).map(([a,b])=>a===i?b:a);
      const pass=i=>echo||![4,5].includes(i);
      const hud=()=>g.hud((cheese?'Cheese ✓':'Cheese ○')+'  ·  '+(toast?'Toast ✓':'Toast ○')+(jam?'  ·  Jam':'')+(sugar?'  ·  Sugar cube':''));
      function double(){
        if(!echo){echo=true;node=0;pos=[...pts[0]];route=[];phase++;g.tone(720,.12);g.say('Your double holds the button. The toast drawer slides open!');}
      }
      function wait(){if(to>=0||done)return;phase++;route=[];g.tone(200,.04);g.say('The cat looks toward the next paw print.');}
      function landed(){
        if(node===2&&!cheese){cheese=true;g.say('One wedge of cheddar. Now for some toast.');g.tone(590,.08);}
        if(node===3&&!echo)g.say('Click! Tap this button again to leave your double here.');
        if(node===5&&!toast){toast=true;g.say(cheese?'Toast and cheese! Take supper to the mousehole.':'Toast! Grab the cheddar and head home.');g.tone(660,.08);}
        if(node===6&&!jam){jam=true;g.say('A drop of raspberry jam sticks to your whiskers. Dessert!');g.tone(800,.08);}
        if(node===8&&!sugar){sugar=true;g.say('A sugar cube! The mouse uses it as a tiny stool.');g.tone(850,.08);}
        if(node===0&&cheese&&toast){done=true;route=[];g.say('Two tiny place settings. Supper is served.');g.tone(730,.14);}
        hud();
      }
      function start(i){
        if(done||to>=0||!neighbors(node).includes(i))return;
        if(!pass(i)){route=[];g.say('The wooden drawer is shut. Try the brass button.');return;}
        if(i===danger()){swat=.66;swatNode=i;route=[];node=0;pos=[...pts[0]];phase++;g.tone(130,.1);g.say('Swat! Safe at home with your food. B waits out a paw print.');return;}
        phase++;origin=[...pos];to=i;travel=0;
      }
      function walk(i){
        if(done||to>=0)return;
        if(i===node){if(i===3&&!echo)double();else wait();return;}
        if(!pass(i)){g.say('Tap the brass button to open the toast drawer.');return;}
        const todo=[[node,[]]],seen=new Set([node]);
        for(let j=0;j<todo.length;j++){
          const [at,list]=todo[j];
          if(at===i){route=list;start(route.shift());return;}
          for(const v of neighbors(at))if(!seen.has(v)&&pass(v)){seen.add(v);todo.push([v,[...list,v]]);}
        }
      }
      function press(k){
        if(done||to>=0)return;
        if(k==='a'){if(node===3&&!echo)double();else wait();return;}
        if(k==='b'){wait();return;}
        if(!direction[k])return;
        const ids=[node,...neighbors(node)],idx=nextInDirection(ids.map(i=>pts[i]),0,k);if(idx>0){route=[];start(ids[idx]);}
      }
      function mouse(c,x,y,ghost=false,scale=1){
        c.save();c.translate(x,y);c.scale(scale,scale);if(ghost)c.globalAlpha=.65;
        const dark=ghost?'#91d7d3':'#8c7279',light=ghost?'#ccf6e6':'#bca5a4';
        path(c,[[-5,4],[-18,7],[-25,5],[-29,1],[-35,1]],ghost?'#a1e7da':'#cd9e94',2);
        oval(c,-1,2,13,8,dark);oval(c,7,-2,8,6,light);poly(c,[[8,-7],[20,-1],[10,2]],light);oval(c,6,-8,5,5,light);oval(c,6,-8,2.5,2.5,ghost?'#e1f9db':'#d6a5a0');oval(c,13,-3,1.3,1.5,'#423943');oval(c,20,-1,1.5,1.5,'#d49a99');c.restore();
      }
      function toastArt(c,x,y){
        c.fillStyle='#ab6c43';c.beginPath();c.roundRect(x-19,y-12,38,29,5);c.fill();oval(c,x,y-10,22,11,'#ad704b');rect(c,x-15,y-9,30,22,'#edbb72');oval(c,x,y-9,17,7,'#f3c883');for(let i=0;i<7;i++)oval(c,x-10+i*3,y+(i*7)%12-6,1.5,1,'#cd9d62');
      }
      function paw(c,x,y,s,col){
        oval(c,x,y+3*s,7*s,5*s,col);
        for(const [u,v] of [[-7,-3],[-2,-7],[4,-7],[8,-2]])oval(c,x+u*s,y+v*s,2.6*s,3.5*s,col);
      }
      function draw(c){
        sky(c,['#556768','#849491','#d9ba8f']);
        for(let i=0;i<11;i++){rect(c,i*65,0,60,72,i%2?'#718483':'#768a86');}
        const look=(danger()-4)*.7;
        poly(c,[[457,96],[470,60],[478,27],[500,46],[534,46],[557,25],[564,65],[580,94]],'#504b51');
        poly(c,[[480,38],[484,56],[495,50]],'#bc8e89');poly(c,[[551,38],[536,51],[552,55]],'#bc8e89');
        oval(c,503,68,9,4,'#e4d793');oval(c,533,68,9,4,'#e4d793');oval(c,503+look,68,2,4,'#393840');oval(c,533+look,68,2,4,'#393840');
        poly(c,[[0,94],[640,83],[640,420],[0,420]],'#c9976e');
        for(let i=0;i<8;i++){
          const y=111+i*39;path(c,[[0,y],[135,y-2],[287,y+1],[465,y-5],[640,y-8]],'#aa7a59',1.4);
          for(let j=0;j<3;j++){const x=(i*107+j*137)%590;path(c,[[x,y+12],[x+24,y+11],[x+35,y+13],[x+60,y+13]],'#bb8966',1);}
        }
        poly(c,[[362,110],[614,97],[625,191],[379,204]],'#795640');
        poly(c,[[369,106],[612,94],[617,151],[376,164]],'#b27c51');
        const lift=echo?26:0;poly(c,[[375,155+lift],[617,143+lift],[618,176+lift],[377,191+lift]],'#976a49');rect(c,472,162+lift,47,5,'#674c43');
        if(echo)poly(c,[[382,158],[610,146],[614,168],[386,181]],'#4e4140');
        for(const [a,b] of edges){const u=pts[a],v=pts[b],dist=length(u,v),n=Math.floor(dist/15);for(let k=1;k<n;k++){const f=k/n;oval(c,u[0]*(1-f)+v[0]*f,u[1]*(1-f)+v[1]*f+8,2.3,1.4,'#f7d5a0');}}
        const [hx,hy]=pts[0];poly(c,[[4,hy+30],[5,hy-32],[54,hy-63],[104,hy-35],[105,hy+22]],'#b77d60');oval(c,hx,hy+3,24,29,'#604a46');rect(c,hx-24,hy+4,48,21,'#604a46');badge(c,'HOME',62,313,'#895e4e');
        const [tx,ty]=pts[1];poly(c,[[tx-13,ty+6],[tx-9,ty-23],[tx+8,ty-25],[tx+16,ty+6]],'#69848b');oval(c,tx,ty+6,17,4,'#90a5a4');for(let i=0;i<7;i++)oval(c,tx-6+i%3*6,ty-16+Math.floor(i/3)*7,1.5,1.5,'#4e6870');
        const [cx,cy]=pts[2];oval(c,cx,cy+12,39,12,'#d5c5a4');oval(c,cx,cy+10,32,9,'#e9daba');
        if(!cheese){poly(c,[[cx-16,cy+7],[cx-16,cy-10],[cx+10,cy-17],[cx+25,cy+3]],'#ffc76c');poly(c,[[cx-16,cy-10],[cx+1,cy-18],[cx+12,cy-17],[cx+25,cy+3]],'#ffdb85');for(let i=0;i<4;i++)oval(c,cx-11+i*6,cy-4+i%2*5,2,1.8,'#d58b47');}
        oval(c,310,228,22,10,'#866952');oval(c,310,echo?226:221,17,8,echo?'#a0d6be':'#e9ba69');if(echo)mouse(c,310,216,true,.8);else{label(c,'↶',310,220,17,'#705540','center');if(cheese)badge(c,'HOLD OPEN',310,251,'#765944');}
        if(!toast){if(echo)toastArt(c,527,188);else badge(c,'TOAST',529,188,'#765841');}
        const [jx,jy]=pts[6];oval(c,jx,jy+8,17,6,'#a3515b');oval(c,jx-3,jy+5,13,4,'#b65b66');oval(c,jx+6,jy+2,4,2,'#e9a28b');
        path(c,[[159,322],[174,315],[198,304],[220,294]],'#c7c8b7',6);oval(c,219,293,14,8,'#9eaaa6',-.38);
        poly(c,[[500,317],[495,303],[508,295],[523,300],[526,313],[512,321]],'#ead6ae');poly(c,[[495,303],[508,295],[523,300],[510,309]],'#fff1ce');if(sugar)mouse(c,513,298,false,.45);
        if(swat>0){
          const [x,y]=pts[swatNode];path(c,[[535,80],[(x+535)/2-14,(y+80)/2],[x,y]],'#655662',21);paw(c,x,y,1.7,'#a37b82');
        }else{const [x,y]=pts[danger()];oval(c,x,y+16,21,8,'#8f634b33');paw(c,x+18,y-15,1.05,'#994e3e');}
        mouse(c,pos[0],pos[1]);if(cheese||toast){oval(c,pos[0]-10,pos[1]+1,5,5,toast?'#dda967':'#ffd679');}
        if(done){mouse(c,88,276,false,.8);toastArt(c,74,282);}
        label(c,'One Mouse Toastie',20,31,25,'#fff1d2','left','Georgia');
        rect(c,0,374,640,46,'#5e4b49');label(c,(cheese?'✓ ':'○ ')+'Cheddar     '+(toast?'✓ ':'○ ')+'Toast',18,398,15,'#fff0c8');
        label(c,labels[node],366,398,12,'#dcc7b2','center');badge(c,'B   WAIT',563,398,'#866a5c');
      }
      hud();g.say('Tap the cheese. Watch the cat’s next paw print.');
      return {press,draw,tap(x,y){if(y>374&&x>486){wait();return;}const i=closest(pts,x,y,46);if(i>=0)walk(i);},update(dt){
        clock+=dt;swat=Math.max(0,swat-dt);
        if(done){finish+=dt;if(finish>.8&&!won){won=true;g.win('The mousehole smells like melted cheddar.'+(jam?' A thumbprint of raspberry jam goes on the side.':'')+(sugar?' Your guest takes the sugar-cube stool.':''));}return;}
        if(to>=0){travel=Math.min(1,travel+dt*5.5);const q=pts[to];pos=[origin[0]+(q[0]-origin[0])*travel,origin[1]+(q[1]-origin[1])*travel-Math.sin(travel*Math.PI)*7];if(travel>=1){node=to;to=-1;landed();}}
        if(to<0&&route.length&&!done)start(route.shift());
      }};
    }
  });

  registerGame({
    id:'inkbeam-abbey',title:'Chalklight Caverns',genre:'Puzzle',kind:'Remix',accent:'#ceb0ff',best:'Either',
    description:'Cave paintings have lost their light. Follow lines in the limestone and see what swims, flutters or leaps off the wall.',
    controls:'Trace the dotted lines in one stroke. Tap crystals or drag through them. D-pad selects a crystal and A inks it. Tap the last crystal again to start over. B sends an echo. Gold crystals refill lamp oil. Tap the lamp to refill by hand.',
    buttons:{a:'Ink',b:'Echo'},
    sources:[pr34('Glyphcaster','Trace continuous directional figures to bring three different creatures to life.'),pr34('Lantern Deep','A lamp spends oil on each lit segment. Amber reservoirs restore its range.'),pr34('Hollow Echo','An expanding sonar pulse charts the cavern beyond the lamp and draws luminous cave life toward it.')],
    create(g){
      const paintings=[
        {name:'The silver fish',ink:'#86e6d8',wall:'#284456',cap:4,stars:[[179,213],[290,142],[423,210],[289,261],[130,153],[124,249]],edges:[[0,1],[1,2],[2,3],[3,0],[0,4],[4,5],[5,0]],start:4,oil:[1],cache:[96,111],find:'a tiny blind salamander'},
        {name:'The velvet moth',ink:'#eabaf0',wall:'#483853',cap:4,stars:[[310,213],[175,134],[191,252],[442,133],[427,249]],edges:[[0,1],[1,2],[2,0],[0,3],[3,4],[4,0]],start:0,oil:[2,4],cache:[164,295],find:'a colony of violet glowworms'},
        {name:'The breaching whale',ink:'#b8d5ff',wall:'#303955',cap:5,stars:[[149,215],[243,161],[360,166],[423,215],[339,267],[217,266],[501,163],[511,240],[240,104]],edges:[[0,1],[1,2],[2,3],[3,4],[4,5],[5,0],[3,6],[6,7],[7,3],[1,8]],start:8,oil:[0,3,7],cache:[477,287],find:'a white cave shrimp'}
      ];
      let room=0,trail=[],used=new Set(),f=0,oil=4,echo=0,echoAt=[0,0],time=0,reveal=0,found=new Set(),done=false,dragged=-1;
      const data=()=>paintings[room],tip=()=>trail[trail.length-1];
      const refresh=()=>g.hud('Grotto '+(room+1)+'/3  ·  Oil '+oil+'/'+data().cap+(found.size?'  ·  Finds '+found.size+'/3':''));
      function setup(){trail=[];used.clear();f=data().start;oil=data().cap;echo=0;dragged=-1;refresh();}
      function sound(at){
        if(done||reveal)return;
        echo=1;echoAt=[...at];g.tone(530,.13);
        if(length(at,data().cache)<118){found.add(room);g.say('Your echo draws out '+data().find+'.');}else g.say('The echo picks out every seam in the limestone.');
        refresh();
      }
      function refill(){oil=data().cap;g.tone(340,.06);g.say('Lamp refilled. Keep tracing the dotted lines.');refresh();}
      function ink(i){
        if(done||reveal)return;
        f=i;
        if(!trail.length){trail=[i];g.say('Follow a dotted line to the next crystal.');g.tone(400,.05);return;}
        if(tip()===i){setup();g.say('Fresh chalk. Choose a starting crystal.');return;}
        const n=data().edges.findIndex(e=>e.includes(tip())&&e.includes(i));
        if(n<0||used.has(n)){g.say('Follow an unused dotted line, or tap your last crystal to start over.');return;}
        if(!oil){g.say('The lamp is dry. Tap the lamp, or press A on it, to refill.');return;}
        used.add(n);trail.push(i);oil--;
        if(data().oil.includes(i)){oil=data().cap;g.say('The amber crystal refills your lamp.');}else g.say('Keep the chalk moving.');
        g.tone(370+used.size*37,.06);refresh();
        if(used.size===data().edges.length){reveal=1.4;g.tone(800,.18);g.say(data().name+' lifts away from the wall.');}
        else if(!data().edges.some((e,j)=>e.includes(i)&&!used.has(j)))g.say('A dead end. Tap this crystal to start a fresh stroke.');
      }
      const items=()=>[...data().stars,[67,352],data().cache];
      function mark(i){if(i===data().stars.length)refill();else if(i===data().stars.length+1)sound(data().cache);else ink(i);}
      function press(k){
        if(done||reveal)return;
        if(direction[k])f=nextInDirection(items(),f,k);
        else if(k==='a')mark(f);else if(k==='b')sound(items()[f]);
      }
      function tap(x,y){
        if(done||reveal)return;
        if(y>380&&x>466){sound(trail.length?data().stars[tip()]:items()[f]);return;}
        const i=closest(items(),x,y,27);
        if(i<0){sound([x,y]);dragged=-1;return;}
        dragged=i;f=i;mark(i);
      }
      function beast(c,id,x,y,s,col){
        c.save();c.translate(x,y);c.scale(s,s);
        if(id===0){poly(c,[[-34,0],[-56,-29],[-52,28]],col);oval(c,4,0,43,21,col,-.08);poly(c,[[-10,-12],[1,-34],[17,-17]],col);oval(c,31,-5,3,3,'#23394a');path(c,[[21,-12],[17,-2],[21,8]],'#fff4d2',1.6);}
        if(id===1){for(const sign of [-1,1]){oval(c,sign*24,-12,31,16,col,sign*-.58);oval(c,sign*20,13,20,11,col,sign*.62);oval(c,sign*30,-14,6,8,'#976da2');oval(c,sign*30,-15,3,3,'#efd2ac');}oval(c,0,0,4,22,'#eee1b3');path(c,[[0,-17],[-5,-27],[-13,-29]],col,2);path(c,[[0,-17],[5,-27],[13,-29]],col,2);}
        if(id===2){oval(c,-2,0,48,23,col,.08);poly(c,[[30,0],[53,-9],[64,-27],[68,-15],[63,-4],[77,-5],[69,5],[51,10],[29,10]],col);oval(c,-7,9,25,10,'#efdfc5',.1);oval(c,-32,-3,2.5,2.5,'#283448');poly(c,[[1,9],[22,25],[11,27],[-3,15]],'#8c9fc7');path(c,[[-19,-20],[-21,-33],[-28,-39]],'#badfff',2);path(c,[[-20,-26],[-15,-37],[-10,-39]],'#badfff',2);}
        c.restore();
      }
      function draw(c){
        const d=data();
        sky(c,['#131a2b',d.wall,'#171e2b']);
        for(let i=0;i<16;i++){const x=i*45-40,h=33+(i*37)%62;poly(c,[[x,0],[x+57,0],[x+37,h*.7],[x+17,h]],i%2?'#252c3d':'#1e2737');}
        for(let i=0;i<13;i++){const x=i*57-28,h=35+(i*19)%33;poly(c,[[x,382],[x+20,382-h],[x+46,382-h*.5],[x+64,382]],i%2?'#283140':'#313848');}
        for(let i=0;i<73;i++){const x=(i*89+27)%633,y=74+(i*29)%250;oval(c,x,y,(i%4)*.5+.6,.8,'#a4a6ab44');}
        const anchor=trail.length?d.stars[tip()]:d.stars[d.start];
        const halo=c.createRadialGradient(...anchor,1,...anchor,72+oil*19);halo.addColorStop(0,'#ffe6a724');halo.addColorStop(1,'#ffe6a700');rect(c,0,0,640,377,halo);
        d.edges.forEach(([a,b],j)=>{
          const u=d.stars[a],v=d.stars[b];
          if(used.has(j)){path(c,[u,v],d.ink+'44',8);path(c,[u,v],d.ink,2.4);}
          else{c.save();c.setLineDash([3,6]);path(c,[u,v],echo>0?'#e3e1d4':'#9292a0',2);c.restore();}
        });
        d.stars.forEach(([x,y],i)=>{
          const col=d.oil.includes(i)?'#ffd789':d.ink;
          oval(c,x,y,12,12,col+'1f');poly(c,[[x,y-8],[x+6,y],[x,y+8],[x-6,y]],trail.includes(i)?'#fff0ca':col);
          if(!trail.length&&i===d.start)badge(c,'START',x,y-25,'#565568');
          if(i===tip()){oval(c,x,y,4,4,'#fff8dc');}
        });
        let [cx,cy]=d.cache;
        if(found.has(room)){
          const follow=Math.sin(echo*Math.PI)*.5;
          cx+=(echoAt[0]-cx)*follow;cy+=(echoAt[1]-cy)*follow;
          const lean=Math.sin(time*3+room)*2;
          if(room===1){for(let i=0;i<6;i++){path(c,[[cx-14+i*6,cy-7],[cx-14+i*6,cy+i%3*3]],'#ccaad8',1);oval(c,cx-14+i*6,cy+2+i%3*3,2,3,'#ffcaff');}}
          else{path(c,[[cx-14+lean,cy+3],[cx-5+lean,cy-2],[cx+3+lean,cy+2],[cx+9+lean,cy]],room?'#efe5ce':'#d6a7bc',3);oval(c,cx+9+lean,cy,4,2.5,'#f0d5d2');}
        }else star(c,cx,cy,3+Math.sin(time*3)*1.5,'#cec4be');
        if(echo>0){c.beginPath();c.arc(...echoAt,(1-echo)*450+2,0,TAU);c.strokeStyle='#c2dced99';c.lineWidth=1.5;c.stroke();}
        if(reveal){const a=Math.min(1,(1.4-reveal)*4);c.save();c.globalAlpha=a;beast(c,room,313+Math.sin((1.4-reveal)*2)*18,202-Math.sin((1.4-reveal)*2)*9,1.7,d.ink);c.restore();}
        else focus(c,items()[f],time,d.ink);
        const lx=67,ly=351;path(c,[[lx-7,ly-6],[lx-7,ly-16],[lx,ly-20],[lx+7,ly-16],[lx+7,ly-6]],'#eac785',2);rect(c,lx-10,ly-7,20,18,'#d19855');rect(c,lx-6,ly-4,12,11,oil?'#ffdf93':'#745756');rect(c,lx-12,ly+10,24,4,'#a57b5b');
        for(let i=0;i<d.cap;i++)oval(c,95+i*10,353,3,4,i<oil?'#f1c77f':'#53515b');
        label(c,'Chalklight Caverns',22,30,23,'#f4e8d1','left','Georgia');
        rect(c,0,379,640,41,'#191c2a');label(c,d.name,18,399,15,d.ink);label(c,used.size+' / '+d.edges.length+' lines',354,399,13,'#dfd8dc','center');badge(c,'B   ECHO',557,399,'#484557');
      }
      setup();g.say('Trace the dotted fish from the START crystal.');
      return {press,tap,draw,drag(x,y){if(done||reveal)return;const i=closest(data().stars,x,y,22);if(i>=0&&i!==dragged){dragged=i;ink(i);}},release(){dragged=-1;},update(dt){
        time+=dt;echo=Math.max(0,echo-dt*1.3);
        if(reveal>0){reveal=Math.max(0,reveal-dt);if(!reveal){
          if(room===2){done=true;g.win('A luminous whale swims through a mountain of solid stone.'+(found.size?' Your notebook holds '+found.size+' of 3 cave creatures.':''));}
          else{room++;setup();g.say(room===1?'Two wings. Trace every line once.':'Trace the whale in a single stroke.');}
        }}
      }};
    }
  });

  registerGame({
    id:'carbon-garden',title:'The Plum Drop',genre:'Puzzle',kind:'Original',accent:'#cbdca0',best:'Either',
    description:'Under an old plum tree, a rabbit, hedgehog and dormouse are waiting with open mouths. One of them has a seed for a whole new branch.',
    controls:'Tap a leaf to tip it left or right. Tap the hanging plum to drop one. With the D-pad choose a leaf and press A to tip it. B drops a plum. Feed the three waiting animals.',
    buttons:{a:'Tip',b:'Drop'},sources:[],
    create(g){
      const stem=[320,65],forks=[[320,135],[168,218],[470,215]],mouths=[[71,316],[250,316],[389,316],[565,316]];
      const places=[stem,...forks],names=['DROP','TOP LEAF','WEST LEAF','EAST LEAF'];
      let tilt=[-1,-1,1],lean=[-1,-1,1],sel=0,plum=null,fed=new Set(),fox=false,growth=0;
      let clock=0,done=false,finish=0,ended=false,splash=0,lastMouth=-1;
      const hud=()=>g.hud('Picnic guests '+fed.size+'/3'+(fox?'  ·  Fox family':''));
      function drop(){
        if(done||plum)return;
        plum={from:[...stem],to:forks[0],time:0,stage:0,branch:-1,where:-1};
        g.say('Tip a leaf to guide the plum.');g.tone(440,.06);
      }
      function tip(i){
        if(done)return;
        if(i===0){drop();return;}
        if(i===3&&!fed.has(1)){g.say('A bare twig. The hedgehog has a seed tucked in its spines.');return;}
        tilt[i-1]*=-1;g.tone(320+i*70,.045);if(!plum)drop();
      }
      function feed(i){
        splash=.75;lastMouth=i;
        if(i===2){
          fox=true;g.tone(820,.12);g.say('A fox kit tumbles out of the hollow log. Its mother comes for a plum, too.');
        }else if(!fed.has(i)){
          fed.add(i);g.tone(570+i*85,.12);
          g.say(i===0?'The rabbit kicks up a cloud of blue butterflies.':i===1?'A seed drops from the hedgehog. Watch the new leaf grow!':'The dormouse pulls a picnic blanket from her nest.');
        }else g.say('Another juicy bite. Who else looks hungry?');
        hud();if(fed.size===3){done=true;g.say('Everybody has a plum. The picnic can begin.');}
      }
      function turn(){
        if(plum.stage===0){const b=tilt[0]<0?1:2;plum.branch=b;plum.from=forks[0];plum.to=forks[b];plum.stage=1;}
        else if(plum.stage===1){const b=plum.branch;
          if(b===2&&!fed.has(1)){lastMouth=-1;splash=.7;plum=null;g.say('Plop. The bare branch needs the hedgehog’s seed.');return;}
          const i=(b===1?0:2)+(tilt[b]>0?1:0);plum.where=i;plum.from=forks[b];plum.to=mouths[i];plum.stage=2;
        }else{feed(plum.where);plum=null;return;}
        plum.time=0;g.tone(plum.stage===1?255:300,.04);
      }
      function press(k){if(done)return;if(direction[k])sel=nextInDirection(places,sel,k);else if(k==='a')tip(sel);else if(k==='b')drop();}
      function fruit(c,x,y,s=1){
        c.save();c.translate(x,y);c.scale(s,s);oval(c,1,0,10,12,'#65416c',.13);oval(c,-2,-1,8,11,'#895783',.16);oval(c,-4,-4,3,5,'#bf96b3',.4);path(c,[[0,-10],[2,-16],[5,-18]],'#664b3b',2);oval(c,6,-14,5,2,'#739650',-.4);c.restore();
      }
      function leaf(c,x,y,a,size,open){
        c.save();c.translate(x,y);c.rotate(a);
        const s=size;c.scale(s,s);
        poly(c,[[-44,-3],[-28,-12],[-12,-14],[0,-10],[15,-13],[36,-9],[47,-3],[36,3],[18,6],[0,4],[-13,7],[-32,5]],open?'#67964e':'#839256');
        path(c,[[-43,-2],[-20,0],[0,0],[25,-2],[44,-3]],'#cde49a',2);for(const d of [-1,1])for(let j=1;j<4;j++)path(c,[[d*j*10,-1],[d*(j*10+5),-7]],'#a9c781',1.2);
        oval(c,0,2,4,4,'#aa7c47');c.restore();
      }
      function animal(c,id,x,y,munch){
        c.save();c.translate(x,y-munch*3);
        if(id===0){
          oval(c,-7,9,22,17,'#b88f76');oval(c,10,0,14,13,'#c5a187');oval(c,5,-18,4.8,15,'#c6a38c',-.22);oval(c,14,-20,4.5,16,'#d4b29b',.14);oval(c,15,-20,2,10,'#d49b91',.14);oval(c,-25,7,7,7,'#eee2c8');oval(c,15,-3,2,2,'#423b41');oval(c,22,1,2,1.6,'#9e746e');
        }else if(id===1){
          poly(c,[[-25,12],[-26,4],[-22,2],[-24,-5],[-18,-5],[-17,-12],[-12,-10],[-9,-17],[-5,-12],[2,-17],[5,-12],[10,-13],[13,-6],[17,-5],[17,9]],'#766051');
          oval(c,2,9,20,11,'#aa8b70');poly(c,[[5,9],[12,-2],[29,8],[17,15]],'#d7b796');oval(c,28,8,2.6,2.3,'#504347');oval(c,16,4,1.6,1.8,'#433d42');
          for(let i=0;i<9;i++){const xx=-19+i%4*7,yy=-3+Math.floor(i/4)*4;path(c,[[xx,yy],[xx+2,yy+5]],'#b79b78',1.4);}
        }else if(id===2){
          poly(c,[[-12,9],[-13,-13],[-6,-9],[0,-7],[8,-15],[12,3],[5,14]],'#cb8052');poly(c,[[-13,-1],[0,5],[12,-2],[4,13]],'#f6dbb1');oval(c,0,7,1.8,1.7,'#5a4a47');oval(c,-5,-2,1.4,1.5,'#4d4447');oval(c,5,-3,1.4,1.5,'#4d4447');
        }else{
          path(c,[[-7,11],[-22,17],[-30,10],[-29,4],[-23,2]],'#ae8e76',6);oval(c,-2,8,17,12,'#c8ac8a');oval(c,9,-1,13,10,'#d9c09e');oval(c,4,-9,6,6,'#d2b392');oval(c,16,-4,2,2,'#473f40');oval(c,22,0,2,1.5,'#9b756d');
        }c.restore();
      }
      function draw(c){
        sky(c,['#b9d9cb','#f0e7bd','#bec98d']);
        oval(c,519,75,30,30,'#fff0ba');
        for(let i=0;i<13;i++)oval(c,i*57-23,232+Math.sin(i*5)*14,65,47,'#acc4a5');
        for(let i=0;i<17;i++){const x=i*43-14;oval(c,x,280+Math.cos(i)*16,49,34,i%2?'#9eb79a':'#a3bb97');}
        poly(c,[[0,287],[95,278],[189,304],[281,292],[385,299],[483,278],[571,288],[640,273],[640,420],[0,420]],'#9bb77b');
        for(let i=0;i<52;i++){const x=i*73%640,y=292+(i*17)%85;path(c,[[x,y],[x-1,y-4],[x+3,y-1],[x+5,y-6]],'#84a16f',1.2);}
        for(let i=0;i<14;i++){const x=(i*73+20)%635,y=323+(i*23)%41;oval(c,x,y,3,2,'#ffdda5');oval(c,x+4,y+1,3,2,'#f3dfab');}
        path(c,[[24,-40],[75,31],[151,61],[239,55],[320,36],[408,12]],'#665544',24);
        path(c,[[104,46],[175,23],[218,-8]],'#745e46',12);
        path(c,[[243,53],[259,91],[285,122],[319,138]],'#836a48',11);
        path(c,[[259,91],[220,136],[174,173],[162,215]],'#92774f',10);
        path(c,[[383,23],[414,62],[435,98],[467,137],[470,216]],'#917750',10);
        for(let i=0;i<38;i++){
          const x=(i*89)%690-25,y=(i*47)%48-15;oval(c,x,y,15+i%8,7+i%4,i%2?'#729654':'#85a15b',Math.sin(i)*.6);
        }
        path(c,[[325,36],[322,45],[320,54]],'#756345',2);if(!plum)fruit(c,...stem,1.2);else oval(c,320,53,3,3,'#67804c');
        
        for(let i=0;i<forks.length;i++){
          const [x,y]=forks[i];
          if(i===2&&growth<.05){path(c,[[x-16,y-8],[x,y],[x+13,y-13]],'#8a7852',3);oval(c,x+12,y-13,5,3,'#9cad61',-.6);continue;}
          const left=i===0?forks[1]:mouths[i===1?0:2],right=i===0?forks[2]:mouths[i===1?1:3];
          c.save();c.setLineDash([2,6]);const toward=tilt[i]<0?left:right;path(c,[[x+tilt[i]*30,y+8],[(x+toward[0])/2,y+25],[toward[0],toward[1]-21]],'#84965b',1.5);c.restore();
          leaf(c,x,y,lean[i]*.24,i===2?growth:1,true);
          const xx=x+tilt[i]*35,yy=y+9;poly(c,[[xx-4,yy-4],[xx+5,yy-4],[xx,yy+3]],'#fff3bb');
        }
        mouths.forEach(([x,y],i)=>{
          if(i===2){oval(c,x,y+11,32,16,'#827155');oval(c,x,y+11,20,12,'#504e42');if(fox){animal(c,2,x,y+2,0);c.save();c.translate(x+24,y+15);c.scale(.58,.58);animal(c,2,0,0,Math.sin(clock*3));c.restore();}else{oval(c,x-5,y+10,1.8,2,'#d4c98b');oval(c,x+4,y+9,1.8,2,'#d4c98b');}return;}
          if(fed.has(3)&&i===3){
            poly(c,[[x-34,y+12],[x+16,y+10],[x+37,y+24],[x-22,y+28]],'#d49481');for(let k=0;k<4;k++)path(c,[[x-26+k*10,y+12],[x-11+k*10,y+26]],'#f6d1a5',2);
          }else oval(c,x-1,y+19,25,4,'#7f9b6a');
          animal(c,i,x,y,Math.sin(clock*5)*(lastMouth===i?splash:0));if(!fed.has(i)){oval(c,x+13,y-34,13,11,'#fff4d4');oval(c,x+5,y-22,3,2,'#fff4d4');fruit(c,x+13,y-33,.57);}
          else{oval(c,x+23,y+7,5,4,'#7e4c70');}
        });
        if(fed.has(0))for(let i=0;i<6;i++){const x=47+i*12+Math.sin(clock+i)*9,y=261+Math.sin(clock*1.3+i*3)*11;oval(c,x-2,y,3,2,'#9ed9d2',.7);oval(c,x+2,y-2,3,2,'#70b9bd',-.6);}
        if(plum){const u=plum.time,a=plum.from,b=plum.to;fruit(c,a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u*u-Math.sin(u*Math.PI)*6);}
        if(splash>0){const [x,y]=lastMouth<0?forks[2]:mouths[lastMouth];for(let i=0;i<5;i++){const a=(i+1)*Math.PI/6;oval(c,x+Math.cos(a)*(1-splash)*32,y-Math.sin(a)*(1-splash)*28,2,2,'#ffe7b0');}}
        if(!done)focus(c,places[sel],clock,'#fff1be');
        label(c,'The Plum Drop',21,83,24,'#3b563e','left','Georgia');
        rect(c,0,376,640,44,'#435c45');label(c,'Picnic guests  '+fed.size+' / 3',18,397,15,'#fff0c9');label(c,names[sel],353,397,12,'#d4e3b6','center');badge(c,'B   DROP',562,397,'#637b52');
      }
      hud();g.say('Tap the hanging plum. Tip a leaf to feed a friend.');
      return {draw,press,tap(x,y){if(done)return;if(y>376&&x>480){drop();return;}const i=closest(places,x,y,49);if(i>=0){sel=i;tip(i);}},update(dt){
        clock+=dt;splash=Math.max(0,splash-dt*1.3);
        if(fed.has(1))growth=Math.min(1,growth+dt*2.5);
        lean=lean.map((v,i)=>v+(tilt[i]-v)*Math.min(1,dt*13));
        if(done){finish+=dt;if(finish>1&&!ended){ended=true;g.win('Three sticky noses, a picnic blanket and a tree full of plums.'+(fox?' A fox cub brings its mother to the picnic.':''));}return;}
        if(plum){plum.time=Math.min(1,plum.time+dt*(plum.stage===0?3:2.25));if(plum.time>=1)turn();}
      }};
    }
  });
})();

(() => {
  "use strict";
  const ink = "#edf1e9", dim = "#acb8bd", dark = "#111a21";
  const compass = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];
  const arrows = ["E","SE","S","SW","W","NW","N","NE"];
  const delta = {right:[1,0], down:[0,1], left:[-1,0], up:[0,-1]};
  const same = (a,b) => a[0] === b[0] && a[1] === b[1];
  const clamp = (v, lo, hi) => Math.max(lo,Math.min(hi,v));
  const source = (name, n, mechanic) => [name, "PR #" + n, mechanic];
  function rect(c,x,y,w,h,col) { c.fillStyle=col; c.fillRect(x,y,w,h); }
  function stroke(c,points,color,weight=2,dash=[]) {
    c.save(); c.beginPath(); c.strokeStyle=color; c.lineWidth=weight; c.lineCap="round"; c.lineJoin="round"; c.setLineDash(dash);
    points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y)); c.stroke(); c.restore();
  }
  function disc(c,x,y,r,color) {
    c.beginPath(); c.arc(x,y,r,0,Math.PI*2); c.fillStyle=color; c.fill();
  }
  function poly(c,pts,color) {
    c.beginPath(); pts.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y)); c.closePath(); c.fillStyle=color; c.fill();
  }
  function type(c,str,x,y,size=14,color=ink,bold=false,align="left") {
    c.save(); c.font=(bold?"700 ":"500 ")+size+"px system-ui, sans-serif"; c.fillStyle=color; c.textAlign=align; c.fillText(str,x,y,align==="left"?Math.max(30,620-x):align==="right"?Math.max(30,x-18):Math.max(60,2*Math.min(x,640-x)-12)); c.restore();
  }
  function base(c,bg,kicker,stage,name,accent) {
    rect(c,0,0,640,420,bg);
    for(let i=0;i<32;i++) rect(c,(i*79+7)%639,(i*i*13+91)%419,2,2,"#ffffff12");
    type(c,kicker.toUpperCase(),24,26,12,accent,true); type(c,name,24,56,25,ink,true);
    type(c,"0"+(stage+1)+"  /  03",617,32,14,dim,true,"right");
    stroke(c,[[24,70],[616,70]],"#ffffff34",1);
  }
  function foot(c,text,sub,accent) {
    rect(c,0,353,640,67,"#10181fee"); stroke(c,[[24,353],[616,353]],accent,1);
    type(c,text,24,379,15,ink,true); type(c,sub,24,403,13,dim);
  }
  function progress(g,id,names,finish,start) {
    let index=0,cleared=false,end=false;
    return {
      get index(){return index;}, get clear(){return cleared;},
      reset(){cleared=false; start(index);},
      complete(){if(cleared||end)return; cleared=true; g.tone(790,.13);
        if(index===names.length-1){end=true;g.win(finish);} else g.hud(id+" · "+names[index]+" cleared");},
      advance(key){if(!cleared)return false; if(key==="a"&&!end){index++;cleared=false;start(index);}return true;},
      overlay(c,accent){if(cleared&&!end){rect(c,64,132,512,126,"#0c161cf7");stroke(c,[[66,133],[574,133]],accent,3);
        type(c,"ROOM COMPLETE",320,166,13,accent,true,"center"); type(c,names[index],320,202,25,ink,true,"center");
        type(c,"A  ·  Continue to "+names[index+1],320,236,15,dim,false,"center");}}
    };
  }

  const quarryLevels = [
    {name:"The east lip",p:[1,2],foes:[[5,2,1]],rocks:[],holes:[],limit:3},
    {name:"The turning bay",p:[1,2],foes:[[4,2,1],[3,0,-1]],rocks:[[0,4],[6,4]],holes:[[5,2]],limit:4},
    {name:"Split seam",p:[2,3],foes:[[2,1,1],[5,1,-1],[4,3,1]],rocks:[[0,0],[6,4],[3,2]],holes:[[2,0],[6,1],[5,3]],limit:5}
  ];
  function quarryRoll(p,foes,heading,rev,lv,pull=0) {
    let pos=[...p], direction=heading, out=foes.map(f=>[...f]), path=[{p:[...pos],foes:out.map(f=>[...f])}];
    const outside=([x,y])=>x<0||x>=7||y<0||y>=5;
    const solid=q=>outside(q)||lv.rocks.some(r=>same(r,q));
    for(let i=0;i<rev*2+1+pull;i++){
      let [dx,dy]=compass[direction], next=[pos[0]+dx,pos[1]+dy];
      if(solid(next)){
        const hitX=dx&&solid([pos[0]+dx,pos[1]]), hitY=dy&&solid([pos[0],pos[1]+dy]);
        if(hitX||(!hitX&&!hitY))dx=-dx; if(hitY||(!hitX&&!hitY))dy=-dy;
        direction=compass.findIndex(([a,b])=>a===dx&&b===dy); next=[pos[0]+dx,pos[1]+dy];
      }
      if(solid(next)||lv.holes.some(r=>same(r,next))) break;
      const fi=out.findIndex(f=>same(f,next));
      if(fi>=0){
        const f=out[fi], beyond=[f[0]+dx,f[1]+dy];
        if(outside(beyond)||lv.holes.some(r=>same(r,beyond))) out.splice(fi,1);
        else if(!solid(beyond)&&!out.some(r=>same(r,beyond))) {f[0]=beyond[0];f[1]=beyond[1];}
        else break;
        direction=(direction+f[2]*2+8)%8;
      }
      pos=next;path.push({p:[...pos],foes:out.map(f=>[...f])});
    }
    return {p:pos,foes:out,path};
  }
  registerGame({id:"carom-quarry",title:"Carom Quarry",genre:"Puzzle",kind:"Remix",accent:"#ffb364",best:"Either",
    description:"Rev a brass top, pull back its sling, and bank off living bumpers to drive them over the lip.",
    controls:"Left/right aim · B sets spin · Hold/release A for extra pull · Down resets",
    sources:[source("Sling",35,"Pull-back pinball launch"),source("Top",35,"Rev a spinning top to ring out opponents"),source("Bumper Crypt",34,"Monsters act as pinball bumpers")],
    create(g){const accent="#ffb364";let lv,p,foes,heading,rev,shots,trail=[],clock=0,ghost=0,pulling=false,tension=0;
      function setup(i){lv=quarryLevels[i];p=[...lv.p];foes=lv.foes.map(f=>[...f]);heading=0;rev=2;shots=lv.limit;trail=[];clock=0;pulling=false;tension=0;g.hud("Ring out every bumper");}
      const run=progress(g,"Carom Quarry",quarryLevels.map(v=>v.name),"The quarry bell rings. Every living bumper rolls free.",setup);run.reset();
      const xy=([x,y])=>[98+x*47,102+y*47];
      function check(){if(!foes.length)run.complete();else if(!shots)g.hud("Out of launches · Down or A to retry");}
      function press(k){
        if(run.advance(k))return;
        if(k==="down"){run.reset();return;} if(trail.length||pulling)return;
        if(!shots){if(k==="a")run.reset();return;}
        if(k==="left")heading=(heading+7)%8;if(k==="right")heading=(heading+1)%8;
        if(k==="b"||k==="up")rev=rev%3+1;
        if(k==="a"){pulling=true;tension=0;}
      }
      return {update(dt){ghost+=dt;
        if(pulling){
          if(g.held&&g.held("a")){tension=Math.min(1,tension+dt*1.7);return;}
          const shot=quarryRoll(p,foes,heading,rev,lv,Math.floor(tension*2));trail=shot.path.slice(1);clock=0;shots--;pulling=false;
          g.tone(180+rev*65,.09);if(!trail.length)check();
        }
        if(!trail.length)return;clock+=dt;
        while(trail.length&&clock>=.095){clock-=.095;const next=trail.shift();p=next.p;if(foes.length!==next.foes.length)g.tone(610,.08);foes=next.foes;if(!trail.length)check();}},
        press,tap(x,y){if(run.clear)return press("a");if(x>445){press(y<172?"left":y<214?"right":y<263?"b":"a");}else if(y>352)press("a");else{let [cx,cy]=xy(p);heading=(Math.round(Math.atan2(y-cy,x-cx)/(Math.PI/4))+8)%8;}},
        draw(c){base(c,"#262728","Brassworks  /  carom quarry",run.index,lv.name,accent);
          rect(c,69,74,340,247,"#11191d");rect(c,73,78,332,239,"#786244");rect(c,76,81,326,233,"#38494a");
          for(let y=0;y<5;y++)for(let x=0;x<7;x++){let [cx,cy]=xy([x,y]);rect(c,cx-21,cy-21,43,43,(x+y)%2?"#344747":"#3b5050");disc(c,cx,cy,2,"#647674");}
          lv.rocks.forEach(v=>{const [x,y]=xy(v);rect(c,x-19,y-19,38,38,"#819086");rect(c,x-14,y-14,28,28,"#465351");});
          lv.holes.forEach(v=>{const [x,y]=xy(v);disc(c,x,y,19,"#ac8059");disc(c,x,y,16,"#131b20");});
          if(!trail.length&&shots&&!run.clear){let preview=quarryRoll(p,foes,heading,rev,lv,pulling?Math.floor(tension*2):0);stroke(c,preview.path.map(f=>xy(f.p)),"#f9bb7580",2,[3,6]);}
          foes.forEach(f=>{let [x,y]=xy(f);disc(c,x,y,18,"#1c282c");disc(c,x,y-2,16,"#dc8168");disc(c,x,y-3,12,"#8b4841");type(c,f[2]>0?"↷":"↶",x,y+4,21,"#fff2d9",true,"center");});
          const [cx,cy]=xy(p),[dx,dy]=compass[heading];if(!trail.length)stroke(c,[[cx-dx*21-dy*7,cy-dy*21+dx*7],[cx,cy],[cx-dx*21+dy*7,cy-dy*21-dx*7]],accent,2);
          if(pulling)stroke(c,[[cx-dy*13,cy+dx*13],[cx-dx*(10+14*tension),cy-dy*(10+14*tension)],[cx+dy*13,cy-dx*13]],"#fff0bc",3);
          disc(c,cx,cy,15,"#1b282a");disc(c,cx,cy-2,12,"#e9ad62");disc(c,cx,cy-3,7,"#775336");
          stroke(c,[[cx,cy-3],[cx+Math.cos(ghost*4)*6,cy-3+Math.sin(ghost*4)*6]],"#ffdfa9",2);
          type(c,"SLING",450,107,12,accent,true);type(c,"Aim   "+arrows[heading],450,144,22,ink,true);
          type(c,"‹  Rotate left",450,172,14,dim);type(c,"›  Rotate right",450,199,14,dim);
          type(c,"B   Spin  "+rev+" / 3",450,242,15,accent,true);type(c,pulling?"Pull  "+Math.round(tension*100)+"%":"A   Sling",450,279,15,ink,true);
          type(c,shots+" shots left",450,313,14,dim);foot(c,!shots&&foes.length&&!trail.length?"Out of spring. Press A to reset.":"Drive each bumper into a pit or over the rim.","Arrows on bumpers turn the top after impact. Down resets the room.",accent);run.overlay(c,accent);}
      };}});

  const railRooms=[
    {name:"East casting",p:[0,0],s:[[3,0]],t:[[5,0]],walls:[]},
    {name:"Crossfeed",p:[1,0],s:[[3,0],[3,1]],t:[[6,1],[0,1]],walls:[[5,0]]},
    {name:"The offset molds",p:[3,1],s:[[2,0],[4,1]],t:[[1,1],[5,0]],walls:[[0,0],[6,1]]}
  ];
  const railColors=["#ffb880","#77dad1"];
  function railMove(state,key,lv){
    let p=[...state.p],s=state.s.map(q=>[...q]),f=state.f,hook=state.hook;
    const blocked=(q,skip=-1)=>q[0]<0||q[0]>6||lv.walls.some(w=>same(w,q))||s.some((w,i)=>i!==skip&&same(w,q));
    if(key==="left"||key==="right"){f=key==="left"?-1:1;let q=[p[0]+f,p[1]];if(!blocked(q))p=q;}
    if(key==="up"||key==="down"){let q=[p[0],1-p[1]];if(!blocked(q))p=q;}
    if(key==="a"&&hook===-1){
      for(let x=p[0]+f;x>=0&&x<7;x+=f){let q=[x,p[1]],i=s.findIndex(v=>same(v,q));if(i>=0){
        hook=i;while(!blocked([s[i][0]+f,p[1]],i))s[i][0]+=f;break;}if(blocked(q))break;}
    }else if(key==="b"&&hook>=0){let q=[...s[hook]];if(p[1]!==q[1])q[1]=p[1];else q[0]+=Math.sign(p[0]-q[0]);
      if(!blocked(q,hook)&&!same(q,p))s[hook]=q;hook=-1;}
    return {p,s,f,hook};
  }
  registerGame({id:"rail-foundry",title:"Rail Foundry",genre:"Puzzle",kind:"Remix",accent:"#77dad1",best:"Backbone",
    description:"Walk the ceiling of a silent forge. Send a magnetic spear through its molds, then recall them onto their stamps.",
    controls:"Left/right move and face · Up/down flip rails · A throw · B recall",
    sources:[source("Magnet Monk",34,"Flip between floor and ceiling rails"),source("Spearbound",34,"Throw and recall a single spear"),source("Rune Golem",34,"Slide stone blocks onto rune sockets")],
    create(g){const accent="#77dad1";let lv,st,hint,flash=0;
      function setup(i){lv=railRooms[i];st={p:[...lv.p],s:lv.s.map(q=>[...q]),f:1,hook:-1};hint="A spear drives a mold until it hits a stop.";g.hud("Dock each mold on its matching stamp");}
      const run=progress(g,"Rail Foundry",railRooms.map(v=>v.name),"The last die seats. The foundry presses its first new star.",setup);run.reset();const xy=([x,y])=>[90+x*77,138+y*133];
      function press(k){if(run.advance(k))return;
        // A second throw while the spear is embedded offers a safe room restart.
        if(k==="a"&&st.hook>=0){if(hint==="Press A again to restart, or B to recall."){run.reset();return;}hint="Press A again to restart, or B to recall.";return;}
        let old=st;st=railMove(st,k,lv);
        if(k==="a"){hint=st.hook>=0?"Spear lodged. Cross rails before recalling to lift the mold.":"No mold in that direction. Face it along the same rail.";flash=.3;}
        else if(k==="b"){hint=old.hook>=0?"Spear returned. Throws always send molds to a stop.":"Throw the spear into a mold first.";flash=.3;}
        else hint=st.hook>=0?"B recalls toward you. Opposite rails pull a mold across.":"Face the mold you want to move, then throw.";
        if(k==="a"||k==="b")g.tone(k==="a"?370:500,.07);
        if(st.s.every((q,i)=>same(q,lv.t[i])))run.complete();}
      return {update(dt){flash=Math.max(0,flash-dt);},press,
        tap(x,y){if(run.clear)return press("a");if(y>351){press(st.hook>=0?"b":"a");return;}if(y>314&&x>490){run.reset();return;}
          let [px,py]=xy(st.p);if(Math.abs(y-py)>70)press("up");else if(Math.abs(x-px)<25)press(st.hook>=0?"b":"a");else press(x>px?"right":"left");},
        draw(c){base(c,"#17292e","Lift station  /  rail foundry",run.index,lv.name,accent);
          for(let i=0;i<7;i++){let x=xy([i,0])[0];stroke(c,[[x,126],[x,284]],"#34454a",2,[3,8]);}
          [0,1].forEach(row=>{let y=xy([0,row])[1],sgn=row===0?-1:1;rect(c,51,y+sgn*29-4,538,8,"#7e9899");for(let x=60;x<586;x+=18)rect(c,x,y+sgn*29-2,5,4,"#c2d2c3");});
          lv.t.forEach((q,i)=>{let [x,y]=xy(q);stroke(c,[[x-28,y-21],[x-28,y+21],[x+28,y+21],[x+28,y-21],[x-28,y-21]],railColors[i],2,[4,4]);type(c,i?"Ⅱ":"Ⅰ",x,y+7,20,railColors[i],true,"center");});
          lv.walls.forEach(q=>{let [x,y]=xy(q);rect(c,x-27,y-23,54,46,"#435358");for(let i=-15;i<20;i+=12)stroke(c,[[x+i-7,y+15],[x+i+7,y-15]],"#9caa9c",3);});
          const [px,py]=xy(st.p);if(st.hook>=0){let [sx,sy]=xy(st.s[st.hook]);stroke(c,[[px,py],[sx,sy]],"#caeee3",flash?3:1,[4,4]);}
          st.s.forEach((q,i)=>{let [x,y]=xy(q);poly(c,[[x-23,y-14],[x-13,y-23],[x+22,y-18],[x+23,y+20],[x-21,y+20]],railColors[i]);rect(c,x-16,y-12,32,24,"#26373c");type(c,i?"Ⅱ":"Ⅰ",x,y+7,20,railColors[i],true,"center");
            if(i===st.hook)disc(c,x+14,y-14,6,"#fff4cc");});
          let sign=st.p[1]===0?-1:1;stroke(c,[[px-7,py+sign*8],[px-8,py+sign*23],[px-14,py+sign*23]],"#e6f1d9",4);
          stroke(c,[[px+5,py+sign*8],[px+7,py+sign*23],[px+12,py+sign*23]],"#e6f1d9",4);disc(c,px,py,12,accent);
          poly(c,[[px+st.f*10,py-7],[px+st.f*18,py],[px+st.f*10,py+6]],"#f3fff3");disc(c,px+st.f*5,py-1,3,dark);
          type(c,st.hook>=0?"LINE LATCHED":"SPEAR READY",54,336,12,accent,true);type(c,"↺ Reset",574,336,12,dim,true,"right");
          foot(c,hint,"← → move / face     ↑ ↓ change rail     A throw     B recall",accent);run.overlay(c,accent);}
      };}});

  const loomRooms=[
    {name:"First filament",start:[3,2],stars:[[3,1]],walls:[],beats:3},
    {name:"The needle gate",start:[3,3],stars:[[2,2],[3,2]],walls:[[3,2]],beats:4},
    {name:"Three points of light",start:[3,3],stars:[[1,2],[3,1],[4,2]],walls:[[3,2],[0,2],[4,1]],beats:8}
  ];
  function loomStep(p,key,lv){let d=delta[key]||[0,0],q=[p[0]+d[0],p[1]+d[1]];
    if(q[0]<0||q[0]>6||q[1]<0||q[1]>4||lv.walls.some(w=>same(w,q)))return p;return q;}
  function crosses(a,b,v){if(same(a,v)||same(b,v))return false;
    return (v[0]-a[0])*(b[1]-a[1])===(v[1]-a[1])*(b[0]-a[0])&&
      (v[0]-a[0])*(v[0]-b[0])+(v[1]-a[1])*(v[1]-b[1])<0;}
  registerGame({id:"afterimage-loom",title:"Afterimage Loom",genre:"Puzzle",kind:"Remix",accent:"#c4a7ff",best:"Either",
    description:"Record a walk, rewind, then play its other half. The filament between your two selves lights stars, even inside stone.",
    controls:"Directions step · A waits one beat · B rewinds or starts over",
    sources:[source("Chrono Vault",34,"Rewind leaves a replaying echo"),source("Tether",35,"Sweep targets with a tethered laser"),source("Still",35,"Time advances only on input")],
    create(g){const accent="#c4a7ff";let lv,path,p,t,lit,phase,echo,spark=0;const xy=([x,y])=>[108+x*66,104+y*53];
      function setup(i){lv=loomRooms[i];path=[[...lv.start]];p=[...lv.start];t=0;lit=new Set();phase="record";echo=lv.start;g.hud("Light stars with the middle of the thread");}
      const run=progress(g,"Afterimage Loom",loomRooms.map(v=>v.name),"Three stars glow through the old stone. Dawn finds the loom still singing.",setup);run.reset();
      function press(k){if(run.advance(k))return;if(k==="b"){
          if(phase==="record"&&path.length>1){phase="weave";p=[...lv.start];t=0;echo=path[0];g.tone(280,.13);}
          else run.reset();return;}
        if(!delta[k]&&k!=="a")return;
        if(phase==="spent")return;
        if(phase==="record"&&t>=lv.beats)return;
        let q=loomStep(p,k,lv);if(k!=="a"&&same(q,p))return;
        p=q;t++;spark=.2;
        if(phase==="record"){path.push([...p]);g.tone(160+t*24,.035);}
        else {echo=path[t];lv.stars.forEach((v,i)=>{if(crosses(echo,p,v))lit.add(i);});
          if(lit.size===lv.stars.length)run.complete();else if(t===path.length-1)phase="spent";}
      }
      return {update(dt){spark=Math.max(0,spark-dt);},press,tap(x,y){if(run.clear)return press("a");if(y>348){press(x<320?"a":"b");return;}
        const [cx,cy]=xy(p),dx=x-cx,dy=y-cy;if(Math.max(Math.abs(dx),Math.abs(dy))<19)return press("a");
        press(Math.abs(dx)>Math.abs(dy)?(dx>0?"right":"left"):(dy>0?"down":"up"));},
        draw(c){base(c,"#1c1930","Observatory  /  afterimage loom",run.index,lv.name,accent);
          for(let i=0;i<7;i++){stroke(c,[xy([i,0]),xy([i,4])],"#54476b",1,[2,5]);}
          for(let j=0;j<5;j++){stroke(c,[xy([0,j]),xy([6,j])],"#54476b",1,[2,5]);}
          for(let y=0;y<5;y++)for(let x=0;x<7;x++){let [a,b]=xy([x,y]);disc(c,a,b,3,"#756e88");}
          lv.walls.forEach(v=>{const [x,y]=xy(v);poly(c,[[x-24,y-10],[x-15,y-23],[x+19,y-19],[x+24,y+12],[x+11,y+21],[x-20,y+17]],"#50495b");stroke(c,[[x-14,y-13],[x+2,y-4],[x-4,y+8]],"#827287",1);});
          stroke(c,path.slice(0,phase==="record"?path.length:t+1).map(xy),"#b49ad6",2,[4,5]);
          if(phase!=="record"){stroke(c,[xy(echo),xy(p)],"#ac82f145",8);stroke(c,[xy(echo),xy(p)],accent,2);const [x,y]=xy(echo);disc(c,x,y,12,"#9782bb");disc(c,x,y,7,"#342a47");}
          lv.stars.forEach((v,i)=>{let [x,y]=xy(v);let color=lit.has(i)?"#ffdf9f":"#ffb975";poly(c,[[x,y-13],[x+4,y-4],[x+13,y],[x+4,y+4],[x,y+13],[x-4,y+4],[x-13,y],[x-4,y-4]],color);if(!lit.has(i))disc(c,x,y,3,"#3e3240");});
          const [x,y]=xy(p);disc(c,x,y,spark?15:12,"#6ce1d0");disc(c,x,y,7,"#233340");disc(c,x-2,y-2,3,"#ccfff4");
          type(c,phase==="record"?"●  RECORDING":phase==="weave"?"◇  WEAVING":"END OF TAPE",30,338,12,phase==="record"?accent:"#86e9d7",true);
          const budget=phase==="record"?lv.beats:path.length-1;for(let i=1;i<=budget;i++)rect(c,224+i*22,328,16,7,i<=t?accent:"#574e68");
          type(c,lit.size+" / "+lv.stars.length+" lit",609,339,13,ink,true,"right");
          let hint=phase==="record"?(t===lv.beats?"Tape full. Press B to rewind and walk the other side.":"Record one end of the thread. B rewinds when ready."):(phase==="spent"?"Tape ended. Press B to record a different route.":"Cross a star with the thread between you and the moving echo.");
          foot(c,hint,"Directions step one beat     A wait one beat     B "+(phase==="record"?"rewind":"new take"),accent);run.overlay(c,accent);}
      };}});

  const postRooms=[
    {name:"One open window",targets:[1],score:[[0,0],null,[1,1],null]},
    {name:"The two ferries",targets:[2,0],score:[[0,1],null,[2,0],null,[2,1],null,[0,0],null]},
    {name:"All three bells",targets:[0,1,2],score:[[1,0],null,[0,1],null,[2,1],null,[1,0],null,[0,0],null,[2,1],null]}
  ];
  const postColors=["#ffc477","#9bc6ff"];
  function glyph(c,x,y,r,pol){
    if(pol){poly(c,[[x,y-r],[x+r,y],[x,y+r],[x-r,y]],postColors[1]);stroke(c,[[x-3,y+3],[x+3,y-3]],"#34455c",2);}
    else {disc(c,x,y,r,postColors[0]);disc(c,x,y,r*.38,"#755639");}
  }
  registerGame({id:"return-post",title:"Return Post",genre:"Adventure",kind:"Remix",accent:"#febd80",best:"Either",
    description:"Route a boomerang through three bell towers. Catch matching pulses for charge, then parry a bolt to bare a bell’s back.",
    controls:"Left/right lane · Up amber / Down blue · A catch or cast · B parry or wait",
    sources:[source("Boomerang",35,"A returning curved weapon strikes behind shields"),source("Polarity",35,"Absorb matching bullet colors for counterattacks"),source("Parry",35,"Reflect an incoming strike to open a target")],
    create(g){const accent="#febd80";let lv,lane,pol,beat,charge,armor,lit,flight,hull,hint,flash=0;
      function setup(i){lv=postRooms[i];lane=0;pol=0;beat=0;charge=0;armor=[-1,-1,-1];lit=new Set();flight=[];hull=3;hint="First catch a matching pulse. On a rest, cast one lane left of a bell.";g.hud("Light every marked bell on a return strike");}
      const run=progress(g,"Return Post",postRooms.map(v=>v.name),"The harbor answers with three bells. Every stranded ferry comes home.",setup);run.reset();
      function press(k){if(run.advance(k))return;if(!hull){if(k==="a"||k==="b")run.reset();return;}
        if(k==="left"||k==="right"){lane=(lane+(k==="right"?1:2))%3;return;}
        if(k==="up"||k==="down"){pol=k==="up"?0:1;return;}
        if(k!=="a"&&k!=="b")return;
        let bolt=lv.score[beat%lv.score.length],safe=!bolt,notes=[];
        if(k==="a"&&bolt&&bolt[0]===lane&&bolt[1]===pol){charge=Math.min(3,charge+1);safe=true;notes.push("Pulse caught.");g.tone(420,.07);}
        else if(k==="a"&&charge){charge--;flight.push({src:lane,dst:(lane+1)%3,at:beat+2});notes.push("Cast toward "+((lane+1)%3+1)+".");g.tone(550,.07);}
        else if(k==="b"&&bolt&&bolt[0]===lane){safe=true;armor[lane]=beat+1;notes.push("Shield opened on "+(lane+1)+".");g.tone(290,.06);}
        if(!safe){hull--;notes.push("Pulse missed.");}
        flight.filter(f=>f.at===beat).forEach(f=>{if(armor[f.dst]>=beat&&lv.targets.includes(f.dst)){lit.add(f.dst);notes.push("Bell "+(f.dst+1)+" rang!");g.tone(840,.1);}else notes.push("Return glanced off.");});flight=flight.filter(f=>f.at>beat);
        beat++;flash=.22;hint=notes.join(" ")||"Waiting for the next pulse.";if(lv.targets.every(v=>lit.has(v)))run.complete();else if(!hull)hint="The hull went dark. Press A to replay the delivery.";}
      const laneX=i=>136+i*183;
      return {update(dt){flash=Math.max(0,flash-dt);},press,tap(x,y){if(run.clear||!hull)return press("a");if(y>352)return press(x<320?"a":"b");if(y<109){press(x<320?"up":"down");return;}lane=clamp(Math.round((x-136)/183),0,2);},
        draw(c){base(c,"#182938","Night harbor  /  return post",run.index,lv.name,accent);
          type(c,"↑ AMBER   /   ↓ BLUE",27,94,12,postColors[pol],true);type(c,"CHARGE  "+charge+"    •    HULL  "+hull,612,94,12,ink,true,"right");
          for(let i=0;i<3;i++){let x=laneX(i),isBell=lv.targets.includes(i),open=armor[i]>=beat;
            rect(c,x-66,111,132,177,i===lane?"#314558":"#253847");stroke(c,[[x,160],[x,265]],"#667989",1,[3,7]);
            poly(c,[[x-36,150],[x-30,128],[x-13,115],[x+13,115],[x+30,128],[x+36,150]],lit.has(i)?"#dbaa66":isBell?"#79909b":"#425562");
            type(c,isBell?(lit.has(i)?"✦":"♢"):"·",x,143,21,lit.has(i)?"#ffebb2":"#172a37",true,"center");
            if(isBell&&!lit.has(i)&&!open)stroke(c,[[x-24,149],[x,157],[x+24,149]],"#edc8a1",3);
            type(c,"0"+(i+1),x-53,178,12,dim,true);
            if(lane===i){poly(c,[[x,253],[x+23,277],[x-23,277]],"#d7eeee");glyph(c,x,269,6,pol);}
          }
          let bolt=lv.score[beat%lv.score.length];if(bolt){glyph(c,laneX(bolt[0]),216,13,bolt[1]);stroke(c,[[laneX(bolt[0]),234],[laneX(bolt[0]),244]],postColors[bolt[1]],2);}
          flight.forEach(f=>{const x=laneX(f.dst);stroke(c,[[laneX(f.src),247],[laneX(f.src)+23,192],[x,169]],"#ffd391",2,[4,5]);type(c,"↶",x,191,24,accent,true,"center");});
          type(c,"NEXT",28,320,12,dim,true);for(let k=0;k<7;k++){let x=95+k*75,b=lv.score[(beat+k)%lv.score.length];rect(c,x-19,299,62,32,k===0?"#475663":"#253540");if(b){glyph(c,x-4,315,6,b[1]);type(c,""+(b[0]+1),x+15,320,13,ink,true,"center");}else type(c,"rest",x+10,320,12,dim,false,"center");}
          foot(c,hint,"A catch / cast     B parry / wait     A cast from 1 → 2,  2 → 3,  3 → 1",accent);run.overlay(c,accent);}
      };}});

  const foldRooms=[
    {name:"The twin seals",budget:1,goal:[0,3]},
    {name:"Four-corner dispatch",budget:1,goal:[0,3,12,15]},
    {name:"The wax remembers",budget:2,goal:[3,4,7,8,11,12,15]}
  ];
  function newSheet(){return Array.from({length:4},(_,y)=>Array.from({length:4},(_,x)=>[y*4+x]));}
  function foldSheet(sheet,k){
    const h=sheet.length,w=sheet[0].length,vert=k==="up"||k==="down";if((vert?h:w)===1)return null;
    let rows=vert?h/2:h,cols=vert?w:w/2;
    return Array.from({length:rows},(_,y)=>Array.from({length:cols},(_,x)=>{
      const a=vert?[x,k==="up"?y:y+rows]:[k==="left"?x:x+cols,y];
      const b=vert?[x,h-1-a[1]]:[w-1-a[0],y];
      return [...sheet[a[1]][a[0]],...sheet[b[1]][b[0]]];
    }));
  }
  registerGame({id:"fold-office",title:"Fold Office",genre:"Puzzle",kind:"Original",accent:"#f4ae9b",best:"Either",
    description:"Fold a wax dispatch and punch several layers in one stroke. Strike a hole twice to seal it again.",
    controls:"B changes tool · Fold tool: arrows fold, A unfolds · Punch tool: arrows aim, A stamps",
    sources:[],
    create(g){const accent="#f4ae9b";let lv,history,marked,tool,cursor,budget,failed,tip;let geom;
      function setup(i){lv=foldRooms[i];history=[newSheet()];marked=new Set();tool="fold";cursor=[0,0];budget=lv.budget;failed=false;
        tip=i===2?"Overlapping punches reseal wax. Work backward from the stencil.":"Fold the sheet so one punch reaches several seals.";g.hud("Match the stencil within the punch allowance");}
      const run=progress(g,"Fold Office",foldRooms.map(v=>v.name),"The last dispatch clears the sorting room, sealed with a map of daylight.",setup);run.reset();
      function press(k){
        if(run.advance(k))return;if(failed){if(k==="a"||k==="b")run.reset();return;}
        let sheet=history[history.length-1];
        if(k==="b"){tool=tool==="fold"?"punch":"fold";tip=tool==="fold"?"Directions fold one half onto the other. A undoes the last fold.":"Move the ring with directions, then press A to punch.";return;}
        if(k==="a"&&tool==="fold"){if(history.length>1){history.pop();cursor=[0,0];tip="One crease opened. All existing holes stay in the wax.";}return;}
        if(k==="a"){for(let cell of sheet[cursor[1]][cursor[0]]){if(marked.has(cell))marked.delete(cell);else marked.add(cell);}
          budget--;g.tone(210,.07);
          if(lv.goal.length===marked.size&&lv.goal.every(n=>marked.has(n))){run.complete();return;}
          if(!budget){failed=true;tip="Stamp allowance spent. A or B resets this dispatch.";}
          else tip="Wax marked. B returns to folding, A unfolds in fold mode.";return;}
        if(!delta[k])return;
        if(tool==="fold"){let next=foldSheet(sheet,k);if(next){history.push(next);cursor=[0,0];g.tone(360,.04);tip="Fold set. B selects the punch, or fold the sheet again.";}}
        else {cursor=[clamp(cursor[0]+delta[k][0],0,sheet[0].length-1),clamp(cursor[1]+delta[k][1],0,sheet.length-1)];}}
      return {update(){},press,tap(x,y){if(run.clear||failed)return press("a");
          if(y>=352){if(x<320)press("b");else press("a");return;}
          if(tool==="punch"&&geom){let {left,top,sz,rows,cols}=geom;let xx=Math.floor((x-left)/sz),yy=Math.floor((y-top)/sz);
            if(xx>=0&&xx<cols&&yy>=0&&yy<rows){cursor=[xx,yy];press("a");}return;}
          if(x<353&&y>80){let dx=x-190,dy=y-204;press(Math.abs(dx)>Math.abs(dy)?(dx>0?"right":"left"):(dy>0?"down":"up"));}},
        draw(c){base(c,"#332b30","Dead-letter bureau  /  fold office",run.index,lv.name,accent);
          const sheet=history[history.length-1],rows=sheet.length,cols=sheet[0].length,sz=46,left=192-cols*sz/2,top=207-rows*sz/2;geom={left,top,sz,rows,cols};
          type(c,"FOLDED SHEET",192,96,12,accent,true,"center");rect(c,left-3,top+5,cols*sz+6,rows*sz,"#704f51");
          for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){let xx=left+x*sz,yy=top+y*sz,stack=sheet[y][x],count=stack.filter(n=>marked.has(n)).length;
            rect(c,xx,yy,sz-1,sz-1,"#e5c6a8");rect(c,xx+2,yy+2,sz-5,sz-5,"#e8cdb4");
            stroke(c,[[xx+5,yy+6],[xx+13,yy+6]],"#caa98f",1);if(count)disc(c,xx+sz/2,yy+sz/2,count===stack.length?8:5,"#774c4d");
            if(tool==="punch"&&cursor[0]===x&&cursor[1]===y){c.beginPath();c.arc(xx+sz/2,yy+sz/2,15,0,Math.PI*2);c.strokeStyle="#964440";c.lineWidth=3;c.stroke();}}
          const mini=(x,y,label,select,tint)=>{type(c,label,x+41,y-11,11,dim,true,"center");for(let i=0;i<16;i++){let xx=x+(i%4)*21,yy=y+Math.floor(i/4)*21;rect(c,xx,yy,19,19,tint);if(select(i))disc(c,xx+9,yy+9,5,"#34252b");}};
          mini(373,164,"ON THE PAGE",n=>marked.has(n),"#d9b8a2");mini(499,164,"STENCIL",n=>lv.goal.includes(n),"#eeac98");
          type(c,"→",475,208,18,dim,true,"center");type(c,sheet[0][0].length+" layers",192,325,14,dim,true,"center");
          type(c,tool.toUpperCase()+" TOOL",373,290,12,accent,true);type(c,budget+" punch"+(budget===1?"":"es")+" left",373,322,21,ink,true);
          foot(c,tip,"B switch tool     "+(tool==="fold"?"Directions fold toward arrow     A unfold one crease":"Directions position the ring     A punch through stack"),accent);run.overlay(c,accent);}
      };}});
})();

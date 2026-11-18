(() => {
  'use strict';

  const W = 640, H = 420, TAU = Math.PI * 2;
  const directions = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  function rect(c, x, y, w, h, color) {
    c.fillStyle = color;
    c.fillRect(x, y, w, h);
  }
  function line(c, points, color, width = 1) {
    c.beginPath();
    points.forEach(([x, y], index) => index ? c.lineTo(x, y) : c.moveTo(x, y));
    c.strokeStyle = color;
    c.lineWidth = width;
    c.stroke();
  }
  function polygon(c, points, color) {
    c.beginPath();
    points.forEach(([x, y], index) => index ? c.lineTo(x, y) : c.moveTo(x, y));
    c.closePath();
    c.fillStyle = color;
    c.fill();
  }
  function ellipse(c, x, y, rx, ry, color, angle = 0) {
    c.beginPath();
    c.ellipse(x, y, rx, ry, angle, 0, TAU);
    c.fillStyle = color;
    c.fill();
  }
  function ring(c, x, y, radius, color, width = 1) {
    c.beginPath();
    c.arc(x, y, radius, 0, TAU);
    c.strokeStyle = color;
    c.lineWidth = width;
    c.stroke();
  }
  function label(c, s, x, y, size, color, align = 'left', face = 'sans-serif', weight = '500') {
    c.font = weight + ' ' + size + 'px ' + face;
    c.textAlign = align;
    c.textBaseline = 'middle';
    c.fillStyle = color;
    c.fillText(s, x, y);
  }
  function header(c, section, title, color, ink) {
    label(c, section.toUpperCase(), 23, 20, 11, color, 'left', 'monospace', 'bold');
    label(c, title, 23, 47, 26, ink, 'left', 'Georgia,serif');
  }
  function button(c, x, y, w, text, fg, bg) {
    rect(c, x, y, w, 32, bg);
    label(c, text, x + w / 2, y + 16, 13, fg, 'center', 'sans-serif', 'bold');
  }
  function add(data) { registerGame(Object.assign({ kind: 'Original', sources: [] }, data)); }

  // Each transparent ink occupies one bit. A solvent plate clears all underlying ink.
  const plates = [
    ['1100','0100','0110','0000'],
    ['0000','1010','0110','1000'],
    ['1000','1100','0001','0011'],
    ['1000','0100','0010','0001']
  ];
  const inkColors = ['#f4e5bf','#ec714d','#4b9ca8','#463e5e','#d6ad43','#bd653d','#769763','#443b40'];
  const inkNames = ['Vermilion', 'Tidal blue', 'Ochre', 'Solvent'];
  const sets = [
    { name: 'The barge canal', ids: [0,1], recipe: [[0,1],[1,3]], blurb: 'Layer the two inks. Their overlap prints violet.' },
    { name: 'The copper marsh', ids: [0,1,2], recipe: [[1,2],[2,1],[0,3]], blurb: 'Three inks can overlap to make seven colors.' },
    { name: 'The white causeway', ids: [0,1,3], recipe: [[1,1],[3,1],[0,2]], blurb: 'Solvent lifts earlier ink. Later ink prints over it.' }
  ];
  function strike(sheet, id, turns) {
    const next = sheet.slice();
    plates[id].forEach((row, j) => [...row].forEach((pixel, i) => {
      if (pixel !== '1') return;
      let x = i, y = j;
      for (let k = 0; k < turns; k++) [x,y] = [3-y,x];
      next[y*4+x] = id === 3 ? 0 : next[y*4+x] | (1 << id);
    }));
    return next;
  }
  function printSheet(c, sheet, x, y, size) {
    rect(c, x-5, y-5, size+10, size+10, '#f4e5bf');
    const cell = size / 4;
    sheet.forEach((value, i) => {
      const xx = x + i % 4 * cell, yy = y + Math.floor(i/4) * cell;
      rect(c, xx, yy, cell, cell, inkColors[value]);
      if (value & 1) for(let k=5; k<cell; k+=9) line(c, [[xx+2,yy+k],[xx+7,yy+k-2]], '#f5bc8b', 1);
      if (value & 2) for(let k=5; k<cell; k+=9) ellipse(c,xx+cell-5,yy+k,1.2,1.2,'#aad5cd');
      if (value & 4) for(let k=5; k<cell; k+=9) line(c,[[xx+k,yy+cell-6],[xx+k,yy+cell-2]],'#f9d67a',1);
    });
    for (let i=0; i<=4; i++) {
      line(c,[[x+i*cell,y],[x+i*cell,y+size]],'#83775d66');
      line(c,[[x,y+i*cell],[x+size,y+i*cell]],'#83775d66');
    }
    for (const [dx,dy] of [[0,0],[size,0],[0,size],[size,size]]) {
      line(c,[[x+dx-5,y+dy],[x+dx+5,y+dy]],'#252b25');
      line(c,[[x+dx,y+dy-5],[x+dx,y+dy+5]],'#252b25');
    }
  }
  add({
    id: 'saltprint-atlas', title: 'Saltprint Atlas', genre: 'Puzzle', accent: '#ed845f', best: 'Touch',
    description: 'Work the hand press in a seaside map shop. Register translucent inks and cut a white road through a flooded coast.',
    controls: 'Left/right selects a plate. Up/down turns it. A prints. B lifts the last impression. You can also tap plates and press buttons.',
    create(g) {
      let level = 0, focus, angles, history, sheet, goal, message, finished = false;
      function reset() {
        focus = 0; angles = [0,0,0,0]; history = []; sheet = Array(16).fill(0);
        goal = sets[level].recipe.reduce((prev, [id, rot]) => strike(prev,id,rot), sheet);
        message = sets[level].blurb;
        g.hud('Chart ' + (level+1) + ' / 3');
      }
      reset();
      function press(k) {
        if (finished) return;
        const ids = sets[level].ids;
        if (k === 'left' || k === 'right') focus = (focus + (k==='right' ? 1 : ids.length-1)) % ids.length;
        const id = ids[focus];
        if (k === 'up' || k === 'down') angles[id] = (angles[id] + (k==='up' ? 1 : 3)) % 4;
        if (k === 'b' && history.length) {
          const last = history.pop();
          sheet = last.before; focus = ids.indexOf(last.id); message = 'Last impression lifted.';
        }
        if (k !== 'a') return;
        if (history.some(h => h.id === id)) { message = 'This plate is spent. Lift an impression to reuse it.'; return; }
        history.push({ id, before: sheet });
        sheet = strike(sheet,id,angles[id]); g.tone(130 + 70*id, .1);
        if (history.length === ids.length) {
          if (sheet.every((v,i) => v === goal[i])) {
            if (level === sets.length-1) { finished = true; g.win('Your white causeway joins the harbor to the mainland. The atlas goes to sea.'); }
            else { const done = sets[level].name; level++; reset(); g.say(done + ' is in print.'); }
          } else message = 'The proof differs from the chart. Lift a plate to revise.';
        } else {
          focus = ids.findIndex(p => history.every(h => h.id !== p));
          message = 'Fresh impression. Register the next plate.';
        }
      }
      return {
        update() {}, press,
        tap(x,y) {
          const ids = sets[level].ids;
          if (y>=290 && y<=349) { const i=Math.floor((x-26)/134); if(i>=0 && i<ids.length) focus=i; }
          if (y>=365 && y<=405) {
            if (x>=26 && x<=163) press('up');
            if (x>=175 && x<=312) press('a');
            if (x>=324 && x<=461) press('b');
          }
        },
        draw(c) {
          rect(c,0,0,W,H,'#182f32'); rect(c,0,70,W,194,'#d3c29e');
          for(let i=0;i<70;i++){let x=(i*83)%640,y=74+(i*31)%183;line(c,[[x,y],[x+13,y-1]],'#b5a785',1);}
          header(c,'Coast survey  /  proof '+(level+1),sets[level].name,'#e9b888','#fff0c9');
          label(c,'REFERENCE',165,88,12,'#323b35','center','monospace','bold');
          label(c,'ON THE PRESS',473,88,12,'#323b35','center','monospace','bold');
          printSheet(c,goal,100,111,128); printSheet(c,sheet,408,111,128);
          line(c,[[319,89],[319,247]],'#918769',1);
          label(c,message,26,278,14,'#fff0cf');
          sets[level].ids.forEach((id,i) => {
            const x=26+i*134, used=history.some(h=>h.id===id);
            rect(c,x,297,126,52,i===focus?'#f0d79a':'#778d87');
            rect(c,x+2,299,122,48,'#264043');
            const bits=strike(Array(16).fill(0),id===3?0:id,angles[id]);
            let solventMask = id===3 ? strike(Array(16).fill(1),3,angles[id]) : null;
            for(let j=0;j<16;j++) if(solventMask ? !solventMask[j] : bits[j]) rect(c,x+7+(j%4)*8,306+Math.floor(j/4)*8,7,7, id===3?'#fcf8e9':inkColors[1<<id]);
            label(c,inkNames[id],x+44,316,12,'#fff3d8');
            label(c,used?'Printed':(angles[id]*90)+'°',x+44,335,11,'#baccc0','left','monospace');
          });
          button(c,26,365,137,'↻  Turn','#f2e5c1','#365357');
          button(c,175,365,137,'A   Print','#172e32','#f3c574');
          button(c,324,365,137,'B   Lift','#f2e5c1','#365357');
        }
      };
    }
  });

  const walks = [
    { name:'Breakfast on the far bank', map:['..*~...','...~.f.','S..~..E','...~.f.','...~...'], clue:['Tall legs stride two.','Short legs step one.','Land on the keepsake,','then reach the arch.'] },
    { name:'The walnut orchard', map:['.fff~~.','.f*.~~E','Sfff~~.','....~~.','~~~....'], clue:['Only short legs fit','under orchard trees.','Tall legs can change','height on dry land.'] },
    { name:'The bell in the reeds', map:['.~.*~..','...~~.E','Sf.~fG.','ff.~fG.','..B~...'], clue:['Stand on the brass bell','to open both gates.','A long stride crosses','two clear tiles.'] }
  ];
  function house(c,x,y,s, tall,t) {
    c.save(); c.translate(x,y); c.scale(s,s);
    const leg = tall?20:9, bob=Math.sin(t*2)*.7;
    for (const side of [-1,1]) {
      line(c,[[side*9,-leg],[side*13,-leg/2+2],[side*11,0],[side*17,0]],'#2f3530',3);
    }
    rect(c,-16,-leg-20+bob,32,21,'#e5bc77');
    rect(c,4,-leg-14+bob,7,15,'#754a3a');
    rect(c,-11,-leg-14+bob,8,7,'#507c70');
    polygon(c,[[-22,-leg-19+bob],[0,-leg-35+bob],[22,-leg-19+bob]],'#923f39');
    rect(c,7,-leg-34+bob,5,10,'#6b4938'); c.restore();
  }
  add({
    id:'heron-house', title:'The House on Heron Legs', genre:'Adventure', accent:'#c8bd75', best:'Either',
    description:'Walk a stilt-legged house home through an orchard and a drowned fen. Even a house forgets things when it moves.',
    controls:'D-pad walks. A changes leg height. B undoes a turn. Tap a nearby tile to walk toward it, or tap a control.',
    create(g) {
      let level=0, x,y,tall, keepsake,bell, history, message, t=0, finished=false;
      function start() {
        const map=walks[level].map;
        y=map.findIndex(row=>row.includes('S')); x=map[y].indexOf('S');
        tall=false; keepsake=false; bell=false; history=[]; message='Find the gold keepsake and reach the arch.';
        g.hud('Passage '+(level+1)+' / 3');
      }
      start();
      function save(){history.push([x,y,tall,keepsake,bell]);}
      function press(k) {
        if(finished)return;
        const map=walks[level].map;
        if(k==='b') {
          if(history.length) { [x,y,tall,keepsake,bell]=history.pop(); message='The house retraces its steps.'; } return;
        }
        if(k==='a') {
          if(tall && map[y][x]==='~'){message='Find dry ground before folding the legs.';return;}
          if(!tall && map[y][x]==='f'){message='The canopy is too low to stand tall here.';return;}
          save(); tall=!tall; message=tall?'Long stride. Both tiles ahead must be clear.':'Short step. Trees offer a way through.'; g.tone(tall?280:170,.08);return;
        }
        if(!directions[k])return;
        const [dx,dy]=directions[k], steps=tall?2:1;
        for(let n=1;n<=steps;n++){
          const tile=map[y+dy*n]?.[x+dx*n];
          if(!tile || (tall && tile==='f') || (!tall && tile==='~') || (tile==='G'&&!bell)) {
            message=!tile?'The house has reached the map edge.':tile==='G'?'The reed gate is shut. Ring the bell.':tile==='f'?'Fold the legs to pass under the trees.':'Stand tall to wade into the water.';return;
          }
        }
        save();x+=dx*steps;y+=dy*steps;
        const tile=map[y][x];g.tone(tall?115:165,.05);
        if(tile==='*'){keepsake=true;message='The lost keepsake rattles safely in the cupboard.';}
        if(tile==='B'){bell=true;message='The bell rings. Both reed gates open.';}
        if(tile==='E') {
          if(!keepsake || (level===2 && !bell)){message=!keepsake?'The keepsake is still out there.':'The ferry keeper is waiting for the bell.';return;}
          if(level===walks.length-1){finished=true;g.win('At first light the house folds its legs. Three keepsakes hang above its new front door.');}
          else {level++;start();g.say('Another morning. Another shore.');}
        }
      }
      return {
        update(dt){t+=dt;}, press,
        tap(px,py){
          if(py>365&&px>=20&&px<200) {press('a');return;} if(py>365&&px>=206&&px<330){press('b');return;}
          if(px<22||px>428||py<70||py>360)return;
          const dx=Math.floor((px-22)/58)-x,dy=Math.floor((py-69)/58)-y;
          if(!dx&&!dy)press('a'); else press(Math.abs(dx)>Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'down':'up'));
        },
        draw(c){
          rect(c,0,0,W,H,'#e9dfc1');
          header(c,'Walking almanac  /  passage '+(level+1),walks[level].name,'#58745e','#283e36');
          walks[level].map.forEach((row,j)=>[...row].forEach((tile,i)=>{
            const px=22+i*58, py=69+j*58, cx=px+29, cy=py+29;
            rect(c,px,py,58,58,tile==='~'?'#72a8a2':(i+j)%2?'#bcbd7a':'#c8c889');
            if(tile==='~'){for(let n=0;n<4;n++){let yy=py+8+n*13,xx=px+3+(n%2)*7;line(c,[[xx,yy],[xx+9,yy+2],[xx+18,yy],[xx+24,yy+1]],'#bad4bb',1.5);}}
            else {for(let n=0;n<5;n++){let xx=px+4+(i*7+j*13+n*11)%46,yy=py+7+(i*9+n*7)%43;line(c,[[xx,yy],[xx+2,yy-3]],'#999e68');}}
            if(tile==='f')for(let n=0;n<3;n++){
              const tx=cx-13+n*13,ty=cy+(n===1?-8:4);
              rect(c,tx-2,ty,4,14,'#664f3c'); ellipse(c,tx,ty-1,10,12,'#54775b'); ellipse(c,tx-2,ty-5,7,7,'#739263');
            }
            if(tile==='G'){for(let n=-12;n<=12;n+=8)line(c,[[cx+n,cy+16],[cx+n+(bell?9:0),cy+(bell?7:-14)]],'#977a4b',3);if(!bell)line(c,[[cx-16,cy],[cx+16,cy]],'#6a5039',3);}
            if(tile==='*'&&!keepsake){ellipse(c,cx,cy+12,12,4,'#999963');polygon(c,[[cx,cy-13],[cx+10,cy],[cx,cy+12],[cx-10,cy]],'#fff2a1');ring(c,cx,cy,10,'#9f743d',2);}
            if(tile==='B'){ellipse(c,cx,cy,9,12,'#ba8b46');rect(c,cx-13,cy+6,26,4,'#805e37');}
            if(tile==='E'){line(c,[[cx-12,cy+14],[cx-12,cy-7],[cx,cy-15],[cx+12,cy-7],[cx+12,cy+14]],'#754739',5);}
            if(i===x&&j===y){ellipse(c,cx,cy+17,19,5,'#51685c77');house(c,cx,cy+15,.85,tall,t);}
          }));
          rect(c,442,69,178,290,'#d8ceb0');
          label(c,tall?'HERON STRIDE':'ORCHARD STEP',531,89,13,'#394d41','center','monospace','bold');
          house(c,530,174,1.65,tall,t);
          walks[level].clue.forEach((s,i)=>label(c,s,452,201+i*19,13,'#354c40'));
          label(c,keepsake?'◆  Keepsake aboard':'◇  Keepsake ashore',452,301,14,'#624f2e');
          if(level===2)label(c,bell?'Bell rung':'Bell silent',452,325,13,'#624f2e');
          button(c,22,367,177,'A   '+(tall?'Fold legs':'Stand tall'),'#eee7cb','#3e6052');
          button(c,207,367,116,'B   Undo','#eee7cb','#596f58');
          label(c,message,23,410,13,'#344a3f');
        }
      };
    }
  });

  const flowerColors = ['#f9a8ad','#f4d678','#b3b7ff','#a2dfbc'];
  const flowerNames = ['Rose','Gold','Iris','Mint'];
  const flights = [
    { name:'The first night letter', flowers:[[185,217,0],[478,135,1],[398,306,2]], order:[0,1], wind:0, burrs:[] },
    { name:'A letter in a crosswind', flowers:[[510,276,0],[180,146,1],[336,258,2]], order:[2,1,0], wind:29, burrs:[[289,151,23]] },
    { name:'The four-color address', flowers:[[533,115,0],[403,276,1],[164,137,2],[295,219,3]], order:[3,0,2,1], wind:41, burrs:[[220,232,21],[421,168,25]] }
  ];
  function flower(c,x,y,id,t,active) {
    const color=flowerColors[id],sway=Math.sin(t*1.5+x)*3;
    line(c,[[x+7,360],[x-5,286],[x+sway,y]],'#526b64',3);
    ellipse(c,x+3,Math.max(y+23,281),15,5,'#526b64',-.6);
    if(active){ring(c,x+sway,y,23+Math.sin(t*4)*2,'#ece6bb',1.6);}
    c.save();c.translate(x+sway,y);
    for(let i=0;i<5+id;i++){
      c.save();c.rotate(i*TAU/(5+id));ellipse(c,0,-9,5+id/2,9,color);c.restore();
    }
    ellipse(c,0,0,5,5,'#28283b'); c.restore();
  }
  add({
    id:'moth-exchange', title:'Moth Exchange', genre:'Adventure', accent:'#c4b5f0', best:'Either',
    description:'Carry letters written in pollen across a moon garden. Match each address petal by petal, then find the porch light.',
    controls:'Steer with the D-pad or tap a destination. A toggles folded wings for a slower, windproof flight. B points to your next stop.',
    create(g){
      let level=0,pos,ink,fold,aim,signal,t=0,bumper,done=false,notice;
      const post=[69,277];
      function start(){pos=[...post];ink=0;aim=null;fold=false;bumper=0;signal=2;
        notice=level===0?'Visit the ringed bloom, then bring the letter home.':level===1?'A crosswind rises. Fold your wings to hold course.':'Burrs brush off the latest color. Fly around them.';
        g.hud('Letter '+(level+1)+' / 3');}
      start();
      function target(){const f=flights[level];return ink<f.order.length?f.flowers.find(v=>v[2]===f.order[ink]):post;}
      function press(k){
        if(done)return;
        if(k==='a'){fold=!fold;notice=fold?'Wings folded. The wind passes over you.':'Wings spread. Fast flight.';}
        if(k==='b'){signal=2.5;notice=ink===flights[level].order.length?'Follow the porch light home.':'Look for the '+flowerNames[target()[2]].toLowerCase()+' bloom.';}
        if(directions[k]){aim=null;pos[0]=clamp(pos[0]+directions[k][0]*4,15,625);pos[1]=clamp(pos[1]+directions[k][1]*4,79,343);}
      }
      return {
        press, tap(x,y){if(y>=369){if(x<196)press('a');else if(x<339)press('b');}else if(y>67)aim=[clamp(x,15,625),clamp(y,79,343)];},
        update(dt){
          if(done)return;
          dt=Math.min(dt,.06); t+=dt; bumper=Math.max(0,bumper-dt);signal=Math.max(0,signal-dt);
          let dx=(g.held('right')?1:0)-(g.held('left')?1:0),dy=(g.held('down')?1:0)-(g.held('up')?1:0);
          if(dx||dy)aim=null;
          if(aim){const d=distance(pos,aim);if(d<3)aim=null;else {dx=(aim[0]-pos[0])/d;dy=(aim[1]-pos[1])/d;}}
          const mag=Math.hypot(dx,dy), speed=fold?94:147;
          if(mag){dx/=mag;dy/=mag;}
          const f=flights[level], gust=!fold?f.wind:0;
          pos[0]=clamp(pos[0]+(dx*speed+gust*Math.cos(t*.63))*dt,15,625);
          pos[1]=clamp(pos[1]+(dy*speed+gust*.6*Math.sin(t+.7))*dt,79,343);
          for(const burr of f.burrs) if(!bumper&&distance(pos,burr)<burr[2]+3){
            const angle=Math.atan2(pos[1]-burr[1],pos[0]-burr[0]);
            pos=[burr[0]+Math.cos(angle)*(burr[2]+13),burr[1]+Math.sin(angle)*(burr[2]+13)];aim=null;bumper=1.1;
            if(ink){ink--;notice='A burr caught the latest pollen. Visit that bloom again.';}
            g.tone(95,.12);
          }
          if(distance(pos,target())<18){
            if(ink<f.order.length){ink++;g.tone(330+ink*90,.10);notice=ink===f.order.length?'The address is complete. Return to the porch light.':'Next color: '+flowerNames[f.order[ink]]+'.';signal=.9;}
            else if(level===flights.length-1){done=true;g.win('By sunrise three windows glow. Everyone in the garden knows someone thought of them.');}
            else {level++;start();g.say('Letter delivered. Another window lights up.');}
          }
        },
        draw(c){
          const f=flights[level],sky=c.createLinearGradient(0,0,0,365);sky.addColorStop(0,'#24243e');sky.addColorStop(1,'#4b4c69');
          rect(c,0,0,W,H,sky);
          for(let i=0;i<49;i++){const x=(i*117+11)%640,y=67+(i*57)%204;ellipse(c,x,y,i%5===0?1.6:.9,i%5===0?1.6:.9,'#c9c8db');}
          ellipse(c,574,95,25,25,'#e9e0c3');ellipse(c,584,87,25,25,'#303049');
          header(c,'Nocturnal postal service  /  letter '+(level+1),f.name,'#ccc3e7','#f4eddc');
          rect(c,440,15,178,36,'#38394f');
          f.order.forEach((id,i)=>{const xx=461+i*40;ellipse(c,xx,33,9,9,flowerColors[id]);label(c,flowerNames[id][0],xx,33,11,'#24243e','center','monospace','bold');if(i<ink)ring(c,xx,33,13,'#fcf3c7',2);});
          polygon(c,[[0,332],[64,308],[108,322],[154,297],[228,329],[290,300],[347,321],[390,310],[448,333],[520,314],[583,292],[640,311],[640,366],[0,366]],'#374654');
          if(f.wind&&!fold) for(let i=0;i<12;i++){const x=(i*67+(t*18)%640)%640,y=85+(i*41)%226;line(c,[[x,y],[x+12,y-2],[x+17,y-1]],'#9093aa',1);}
          f.flowers.forEach(([x,y,id])=>flower(c,x,y,id,t,id===f.order[ink]));
          rect(c,62,286,12,65,'#9b806a');rect(c,50,261,38,27,'#637c7c');
          polygon(c,[[46,263],[68,249],[91,263]],'#a77668');rect(c,62,267,12,15,'#ffe899');
          if(ink===f.order.length)ring(c,post[0],post[1],28+2*Math.sin(t*4),'#fff2a3',2);
          f.burrs.forEach(([x,y,r])=>{for(let i=0;i<13;i++){const a=i*TAU/13;line(c,[[x+Math.cos(a)*(r-6),y+Math.sin(a)*(r-6)],[x+Math.cos(a)*(r+3),y+Math.sin(a)*(r+3)]],'#ed9f8c',2);}ellipse(c,x,y,r-5,r-5,'#754955');});
          if(signal>0){c.save();c.setLineDash([3,7]);line(c,[pos,target()],'#ebdbbe99',1.5);c.restore();}
          if(aim)ring(c,aim[0],aim[1],5,'#ece5d4',1);
          const x=pos[0],y=pos[1],wing=fold?4:7+3*Math.sin(t*24);
          ellipse(c,x-wing*.7,y-3,wing,7,'#e8ddce',-.7);ellipse(c,x+wing*.7,y-3,wing,7,'#e8ddce',.7);
          ellipse(c,x,y+1,2.3,7,bumper?'#ffad95':'#b390a9');
          line(c,[[x,y-5],[x-4,y-10]],'#f9ead6');line(c,[[x,y-5],[x+4,y-10]],'#f9ead6');
          rect(c,0,351,W,69,'#252c40');label(c,notice,23,362,13,'#e2dacf');
          button(c,23,377,169,fold?'A   Spread wings':'A   Fold wings','#f0e7e0','#51506a');button(c,205,377,126,'B   Signal','#f0e7e0','#51506a');
        }
      };
    }
  });

  const cases = [
    { name:'The umbrella boat', weather:'DUSK', events:[['Rain','Rain stipples the road.'],['Gutter','The gutter fills.'],['Launch','A paper boat enters the drain.']],
      scrambled:[2,0,1], clues:['“The gutter was dry until the rain came.”','“The little boat launched after the gutter filled.”'],
      checks:[[0,1],[1,2]], motif:0 },
    { name:'The late projection', weather:'NIGHT', events:[['Curtain','The curtain lifts.'],['Lamp','A lamp burns in the booth.'],['Shadow','The screen fills with a silhouette.'],['Applause','Hands clap in the empty theater.']],
      scrambled:[1,3,0,2],clues:['“The curtain rose before the lamp came on.”','“A shadow appeared immediately after the lamp.”','“The applause followed the shadow.”'],
      checks:[[0,1],[1,2,1],[2,3]],motif:1 },
    { name:'The ferry with no captain', weather:'DAWN', events:[['Fog','A white bank rolls in.'],['Bell','The quay bell rings.'],['Lamp','A lamp lights on deck.'],['Wake','A wake cuts the harbor.'],['Gull','A gull lands on the empty mooring.']],
      scrambled:[3,1,4,2,0],clues:['“The bell sounded one beat after the fog.”','“The lamp lit after the bell, before the wake.”','“The gull landed exactly two beats after the lamp.”'],
      checks:[[0,1,1],[1,2],[2,3],[2,4,2]],motif:2 }
  ];
  function witnessScene(c,level,active,t) {
    const base=['#876e72','#34334b','#789596'][level];rect(c,19,73,602,110,base);
    const seen=id=>active.includes(id);
    if(level===0){
      for(let i=0;i<9;i++){const h=24+(i*23)%45,xx=22+i*74;rect(c,xx,161-h,60,h,'#5f5b69');polygon(c,[[xx-2,161-h],[xx+20,146-h],[xx+62,161-h]],'#454957');for(let j=0;j<3;j++)rect(c,xx+6+j*16,164-h,6,10,'#c4a387');}
      rect(c,19,159,602,24,seen(1)?'#82a9ae':'#9b8982');
      if(seen(0))for(let i=0;i<62;i++){const xx=21+(i*61)%596,yy=74+(i*23+t*75)%92;line(c,[[xx,yy],[xx-4,yy+7]],'#b5c4c5');}
      if(seen(2)){const xx=236+Math.sin(t*.7)*35;polygon(c,[[xx,164],[xx+26,163],[xx+12,176]],'#ecd5a0');polygon(c,[[xx+4,162],[xx+13,152],[xx+19,162]],'#fff0cf');}
    }else if(level===1){
      rect(c,125,85,390,82,'#a49d90');
      if(!seen(0)){for(let i=0;i<17;i++)rect(c,125+i*23,85,23,82,i%2?'#904f57':'#ad6268');}
      else {rect(c,125,85,35,82,'#a35e60');rect(c,480,85,35,82,'#a35e60');}
      if(seen(1))polygon(c,[[55,111],[478,87],[478,165]],'#ebdca259');
      if(seen(2)){ellipse(c,327,114,9,10,'#4b4652');polygon(c,[[319,125],[337,125],[352,161],[306,161]],'#4b4652');}
      for(let i=0;i<15;i++){let xx=34+i*40;ellipse(c,xx,178,13,10,'#302a3e');if(seen(3))line(c,[[xx-7,177],[xx-12,165+Math.sin(t*7+i)*3]],'#b99b96',2);}
    }else{
      rect(c,19,142,602,41,'#62848b');polygon(c,[[19,145],[74,115],[122,137],[184,112],[241,143],[302,129],[376,145],[444,115],[505,138],[572,111],[621,141],[621,148],[19,148]],'#617776');
      if(seen(0))for(let i=0;i<8;i++){const xx=43+(i*79+t*9)%530;ellipse(c,xx,130+(i%3)*5,54,8,'#bdcbc175');}
      const xx=seen(3)?365:246;polygon(c,[[xx-37,148],[xx+38,148],[xx+25,158],[xx-23,158]],'#4b4547');rect(c,xx-14,133,33,15,'#a68064');rect(c,xx,137,6,6,seen(2)?'#fff0a7':'#685b59');
      if(seen(3))for(let i=0;i<4;i++)line(c,[[xx-43-i*10,157+i*3],[xx-68-i*15,156+i*3]],'#cad2ba',1.5);
      rect(c,79,152,113,9,'#785f52');rect(c,156,154,5,27,'#785f52');
      if(seen(1))ring(c,175,135,6+4*Math.abs(Math.sin(t*4)),'#e5cc8d',1.3);
      if(seen(4))line(c,[[153,149],[159,146],[162,149],[167,145]],'#eee9d0',2);
    }
  }
  add({
    id:'rain-remembers',title:'The Rain Remembers',genre:'Puzzle',accent:'#d6a79c',best:'Touch',
    description:'Restore three damaged reels from a town archive. Cross-check witnesses, move the frames, and watch their memories play back.',
    controls:'Left/right selects a frame. A picks it up or places it. B runs the reel. Touch two frames to move one, then tap Play.',
    create(g){
      let level=0,frames,focus,picked,playing,time,beat,t=0,notice,done=false;
      function start(){frames=cases[level].scrambled.slice();focus=0;picked=null;playing=false;time=0;beat=0;notice='Choose two frames to move the first into the second slot.';g.hud('Reel '+(level+1)+' / 3');}
      start();
      function play(){picked=null;playing=true;time=0;beat=0;notice=cases[level].events[frames[0]][1];g.tone(160,.07);}
      function press(k){
        if(done||playing)return;
        if(k==='left'||k==='right')focus=clamp(focus+(k==='right'?1:-1),0,frames.length-1);
        if(k==='a'){
          if(picked===null){picked=focus;notice='Choose the destination slot.';}
          else {frames.splice(focus,0,frames.splice(picked,1)[0]);picked=null;notice='Frames spliced. Run the reel to check the witnesses.';g.tone(226,.07);}
        }
        if(k==='b')play();
      }
      function cardLayout(){return {x:22,w:Math.floor(596/frames.length)};}
      return {
        press,
        tap(x,y){if(playing||done)return;if(y>=267&&y<337){const lay=cardLayout(),i=Math.floor((x-lay.x)/lay.w);if(i>=0&&i<frames.length){focus=i;press('a');}}if(y>368&&x>=22&&x<=182)press('b');},
        update(dt){
          t+=dt;if(!playing||done)return;time+=dt;
          if(time<.72)return;time=0;beat++;
          if(beat<frames.length){notice=cases[level].events[frames[beat]][1];g.tone(160+beat*50,.08);return;}
          playing=false;beat=frames.length-1;
          const bad=cases[level].checks.find(([a,b,n])=>{const d=frames.indexOf(b)-frames.indexOf(a);return n?d!==n:d<=0;});
          if(bad){const [a,b,n]=bad;notice=cases[level].events[b][0]+' belongs '+(n===1?'one beat after ':n===2?'two beats after ':'after ')+cases[level].events[a][0]+'.';return;}
          if(level===cases.length-1){done=true;g.win('Three reels turn again. At the final screening, the ferry keeper recognizes her childhood harbor.');}
          else{level++;start();g.say('Reel restored. The archive sends another tin.');}
        },
        draw(c){
          const rec=cases[level];rect(c,0,0,W,H,'#2e3036');header(c,'Municipal film archive  /  reel '+(level+1),rec.name,'#deb59d','#f6e4cb');
          witnessScene(c,level,playing?frames.slice(0,beat+1):[],t);
          rect(c,19,187,602,72,'#d5c6ad');
          rec.clues.forEach((s,i)=>label(c,s,31,201+i*20,14,'#423c3c','left','Georgia,serif'));
          const lay=cardLayout();
          frames.forEach((id,i)=>{
            let x=lay.x+i*lay.w,w=lay.w-5,selected=playing?i===beat:focus===i;
            rect(c,x,270,w,64,selected?'#f3c68b':'#767577');
            rect(c,x+2,272,w-4,60,picked===i?'#795e58':'#41414b');
            for(let n=0;n<Math.floor(w/18);n++){rect(c,x+6+18*n,276,7,4,'#a6a09c');rect(c,x+6+18*n,323,7,4,'#a6a09c');}
            label(c,String(i+1),x+9,290,10,'#c9bdab','left','monospace');
            label(c,rec.events[id][0],x+w/2,305,15,'#f5e9d6','center','Georgia,serif','bold');
          });
          label(c,notice,22,351,14,'#e2d3be');button(c,22,375,157,playing?'Projecting…':'B   Play reel','#2d3037','#e1b58e');
          label(c,picked===null?'A   Pick a frame':'A   Place frame',202,391,14,'#e8d9c8');
        }
      };
    }
  });

  const soundings = [
    {name:'The teacup bell',targets:[[5,3]],shoals:[],tip:['Drop a sound at sea.','Its ring passes through','the buried object.','Move and sound again.']},
    {name:'The parted chimes',targets:[[2,4],[6,1]],shoals:[[3,2],[4,2],[4,3]],tip:['Two chimes lie apart.','Each sound returns','from the nearest one.','Lift both from the silt.']},
    {name:'The looking-glass fault',targets:[[5,4]],shoals:[[2,2],[2,3],[3,3],[5,2]],tip:['East of the fault, a','sound shows a mirror','image of the wreck.','The west reads true.']}
  ];
  add({
    id:'sounding-glass',title:'Sounding Glass',genre:'Puzzle',accent:'#74cfc3',best:'Either',
    description:'Survey an inland sea with a glass hydrophone. Intersect echo rings to raise a lost set of chimes from the silt.',
    controls:'D-pad moves the survey skiff by one square. A sounds the seabed. B lifts at your position. Tap a square to sail there.',
    create(g){
      let level=0,px,py,targets,pings,misses,flash,t=0,notice,done=false;
      const ox=57,oy=94,unit=46,cols=8,rows=6;
      function start(){px=0;py=0;targets=soundings[level].targets.map(p=>p.slice());pings=[];misses=[];flash=0;
        notice=level===2?'The fault lies between columns D and E.':'Look for grid points where the rings meet.';g.hud('Sounding '+(level+1)+' / 3');}
      start();
      function movable(x,y){return x>=0&&x<cols&&y>=0&&y<rows&&!soundings[level].shoals.some(p=>p[0]===x&&p[1]===y);}
      function press(k){
        if(done)return;
        if(directions[k]){const [dx,dy]=directions[k];if(movable(px+dx,py+dy)){px+=dx;py+=dy;}else notice='Shoal or chart edge. Try another course.';return;}
        if(k==='a'){
          const mirror=level===2&&px>=4;
          const radius=Math.min(...targets.map(([x,y])=>distance([px,py],[mirror?7-x:x,y])));
          if(!pings.some(p=>p.x===px&&p.y===py))pings.push({x:px,y:py,r:radius,mirror});
          flash=1;g.tone(790-radius*40,.19);
          notice=(mirror?'Mirrored echo':'Clear echo')+' at '+radius.toFixed(2)+' squares from '+String.fromCharCode(65+px)+(py+1)+'.';
        }
        if(k==='b'){
          const index=targets.findIndex(([x,y])=>x===px&&y===py);
          if(index<0){if(!misses.some(p=>p[0]===px&&p[1]===py))misses.push([px,py]);notice='Only silt. Sound again from a different square.';g.tone(100,.12);return;}
          targets.splice(index,1);pings=[];misses=[];g.tone(620,.25);
          if(targets.length){notice='First chime aboard. New echoes belong to its partner.';}
          else if(level===soundings.length-1){done=true;g.win('The last glass bell clears the water. For the first time in a century the inland sea has a voice.');}
          else{level++;start();g.say('A chime rises from the silt. Unroll the next chart.');}
        }
      }
      function sail(x,y){
        if(!movable(x,y))return;
        const queue=[[px,py]],seen=new Set([px+','+py]);
        for(let i=0;i<queue.length;i++){
          const [xx,yy]=queue[i];
          if(xx===x&&yy===y){px=x;py=y;return;}
          for(const [dx,dy] of Object.values(directions)){
            const nx=xx+dx,ny=yy+dy,key=nx+','+ny;
            if(movable(nx,ny)&&!seen.has(key)){seen.add(key);queue.push([nx,ny]);}
          }
        }
      }
      return {
        press,update(dt){t+=dt;flash=Math.max(0,flash-dt);},
        tap(x,y){if(y>=365&&y<=403){if(x>=22&&x<=178)press('a');else if(x>=188&&x<=326)press('b');return;}if(x>=ox-unit/2&&x<=ox+7.5*unit&&y>=oy-unit/2&&y<=oy+5.5*unit)sail(Math.round((x-ox)/unit),Math.round((y-oy)/unit));},
        draw(c){
          rect(c,0,0,W,H,'#142f34');header(c,'Inland hydrography  /  chart '+(level+1),soundings[level].name,'#93d2bf','#e5ead8');
          rect(c,32,69,374,280,'#244c50');c.save();c.beginPath();c.rect(32,69,374,280);c.clip();
          for(let n=0;n<12;n++){
            c.beginPath();for(let j=0;j<=70;j++){const a=j*TAU/70,rx=45+n*16+9*Math.sin(a*3),ry=23+n*10+8*Math.sin(a*5);const x=116+Math.cos(a)*rx,y=284+Math.sin(a)*ry;if(!j)c.moveTo(x,y);else c.lineTo(x,y);}
            c.strokeStyle='#3a6262';c.lineWidth=1;c.stroke();
          }
          for(let i=0;i<cols;i++)for(let j=0;j<rows;j++){const x=ox+i*unit,y=oy+j*unit;line(c,[[x-3,y],[x+3,y]],'#7a9690');line(c,[[x,y-3],[x,y+3]],'#7a9690');}
          if(level===2){c.save();c.setLineDash([5,5]);line(c,[[ox+3.5*unit,69],[ox+3.5*unit,349]],'#eaa486',2);c.restore();}
          for(const [x,y] of soundings[level].shoals){const xx=ox+x*unit,yy=oy+y*unit;polygon(c,[[xx-14,yy+6],[xx-5,yy-10],[xx+2,yy-6],[xx+7,yy-12],[xx+15,yy+6]],'#95a68e');}
          for(const ping of pings){const x=ox+ping.x*unit,y=oy+ping.y*unit;
            c.save();if(ping.mirror)c.setLineDash([7,4]);ring(c,x,y,Math.max(3,ping.r*unit),ping.mirror?'#efaa89':'#9fddc4',1.8);c.restore();
            ellipse(c,x,y,3.2,3.2,ping.mirror?'#f2ab90':'#b9e8cc');
          }
          misses.forEach(([x,y])=>{const xx=ox+x*unit,yy=oy+y*unit;line(c,[[xx-4,yy-4],[xx+4,yy+4]],'#dea38b',2);line(c,[[xx+4,yy-4],[xx-4,yy+4]],'#dea38b',2);});
          const sx=ox+px*unit,sy=oy+py*unit;
          if(flash>0)ring(c,sx,sy,3+(1-flash)*67,'rgba(225,242,190,'+flash+')',2);
          ellipse(c,sx+1,sy+4,14,6,'#163c42');polygon(c,[[sx-13,sy+1],[sx+13,sy+1],[sx+7,sy+7],[sx-8,sy+7]],'#e3ae74');
          polygon(c,[[sx-1,sy-13],[sx-1,sy],[sx-10,sy]],'#eee0b3');line(c,[[sx,sy-14],[sx,sy+2]],'#f2d5a2',2);c.restore();
          for(let i=0;i<cols;i++)label(c,String.fromCharCode(65+i),ox+i*unit,63,10,'#b7cdc1','center','monospace');
          for(let j=0;j<rows;j++)label(c,String(j+1),21,oy+j*unit,10,'#b7cdc1','center','monospace');
          rect(c,424,69,195,280,'#213f42');label(c,'HYDROPHONE',439,89,13,'#b7d6c1','left','monospace','bold');
          line(c,[[439,128],[451,128],[457,124],[462,135],[467,112],[472,146],[476,119],[483,131],[491,126],[501,128],[535,128],[542,123],[548,134],[552,121],[559,128],[604,128]],'#9bd8bc',2);
          soundings[level].tip.forEach((s,i)=>label(c,s,438,169+i*22,15,'#e0e9d7'));
          label(c,'Skiff   '+String.fromCharCode(65+px)+(py+1),438,280,14,'#e6c793','left','monospace');
          label(c,'Echoes  '+pings.length,438,305,14,'#d4dfcb','left','monospace');
          if(level===1)label(c,'Chimes  '+(2-targets.length)+'/2',438,329,13,'#e6c793','left','monospace');
          button(c,22,367,156,'A   Sound','#15383c','#a9d6b9');button(c,189,367,138,'B   Lift','#e1e6d4','#38595a');
          label(c,notice,23,410,13,'#d1dfce');
        }
      };
    }
  });
})();

'use strict';
const fs=require('node:fs');
const {execFileSync}=require('node:child_process');
const {PNG}=require('pngjs');
const B=require('./board.cjs');
const X0=30,Y0=820,CS=112,N=9;
const cal=B.loadCalibration('./calibration.json');
function snap(){
  execFileSync('adb',['shell',"su -c 'screencap -p /data/local/tmp/x.png'"]);
  execFileSync('adb',['pull','/data/local/tmp/x.png','./_p.png'],{stdio:'ignore'});
  return PNG.sync.read(fs.readFileSync('./_p.png'));
}
function readGrid(im){
  const g=[];
  for(let r=0;r<N;r++){
    let line='';
    for(let c=0;c<N;c++){
      const f=B.feature(im,X0+c*CS,Y0+r*CS,CS,CS);
      line+=(B.classify(f,cal)||'?');
    }
    g.push(line);
  }
  return g;
}
const isBlock=ch=>ch!=='I'&&ch!=='#'&&ch!=='?'&&ch!=='.';
function candidates(g){
  const R=g.length,C=g[0].length;
  const G=g.map(r=>r.split(''));
  const hasMatch=(r,c)=>{
    const v=G[r][c];
    if(!isBlock(v))return false;
    let n=1;
    for(let i=c-1;i>=0&&G[r][i]===v;i--)n++;
    for(let i=c+1;i<C&&G[r][i]===v;i++)n++;
    if(n>=3)return true;
    n=1;
    for(let i=r-1;i>=0&&G[i][c]===v;i--)n++;
    for(let i=r+1;i<R&&G[i][c]===v;i++)n++;
    return n>=3;
  };
  const out=[];
  for(let r=2;r<=6;r++)for(let c=0;c<C;c++){
    if(!isBlock(G[r][c]))continue;
    for(const d of [[0,1],[1,0]]){
      const r2=r+d[0],c2=c+d[1];
      if(r2>6||c2>=C)continue;
      if(!isBlock(G[r2][c2]))continue;
      let t=G[r][c];G[r][c]=G[r2][c2];G[r2][c2]=t;
      const hit=hasMatch(r,c)||hasMatch(r2,c2);
      t=G[r][c];G[r][c]=G[r2][c2];G[r2][c2]=t;
      if(hit) out.push({r:r,c:c,r2:r2,c2:c2});
    }
  }
  return out;
}
function swipe(m){
  const x1=Math.round(X0+m.c*CS+CS/2),y1=Math.round(Y0+m.r*CS+CS/2);
  const x2=Math.round(X0+m.c2*CS+CS/2),y2=Math.round(Y0+m.r2*CS+CS/2);
  execFileSync('adb',['shell','input','swipe',String(x1),String(y1),String(x2),String(y2),'350']);
}
const rounds=+(process.argv[2]||3);
let prev=readGrid(snap());
console.log('== start ==');
console.log(prev.join('\n'));
for(let k=0;k<rounds;k++){
  const cands=candidates(prev);
  console.log('-- candidates: '+cands.length);
  if(!cands.length){ console.log('NO CANDIDATE'); break; }
  let moved=false;
  for(let i=0;i<Math.min(cands.length,6);i++){
    const m=cands[i];
    swipe(m);
    const t=Date.now(); while(Date.now()-t<1500){}
    const now=readGrid(snap());
    if(now.join('|')!==prev.join('|')){
      console.log('OK move r'+m.r+'c'+m.c+'<->r'+m.r2+'c'+m.c2);
      console.log(now.join('\n'));
      prev=now; moved=true; break;
    }
    console.log('skip r'+m.r+'c'+m.c+'<->r'+m.r2+'c'+m.c2+' (no change)');
    const t2=Date.now(); while(Date.now()-t2<400){}
  }
  if(!moved){ console.log('ALL CANDIDATES FAILED'); break; }
}
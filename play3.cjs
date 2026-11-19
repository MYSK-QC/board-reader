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
const ok=ch=>ch!=='I'&&ch!=='#'&&ch!=='?'&&ch!=='.';
function lines(A,r,c){
  const v=A[r][c];
  if(!ok(v))return [];
  const out=[];
  let a=c; while(a-1>=0&&A[r][a-1]===v)a--;
  let b=c; while(b+1<9&&A[r][b+1]===v)b++;
  if(b-a+1>=3){const cs=[];for(let i=a;i<=b;i++)cs.push([r,i]);out.push(cs);}
  let u=r; while(u-1>=0&&A[u-1][c]===v)u--;
  let d=r; while(d+1<9&&A[d+1][c]===v)d++;
  if(d-u+1>=3){const cs=[];for(let i=u;i<=d;i++)cs.push([i,c]);out.push(cs);}
  return out;
}
function evalMove(G,r,c,r2,c2){
  const A=G.map(s=>s.split(''));
  const t=A[r][c];A[r][c]=A[r2][c2];A[r2][c2]=t;
  const ls=lines(A,r,c).concat(lines(A,r2,c2));
  if(!ls.length)return 0;
  const set=new Set();
  for(const cs of ls)for(const q of cs)set.add(q[0]+','+q[1]);
  let score=set.size;
  for(const key of set){
    const p=key.split(',');const rr=+p[0],cc=+p[1];
    for(const d of [[0,1],[0,-1],[1,0],[-1,0]]){
      const r3=rr+d[0],c3=cc+d[1];
      if(r3<0||r3>=9||c3<0||c3>=9)continue;
      const v=A[r3][c3];
      if(v==='I')score+=3;
      else if(v==='#')score+=5;
    }
  }
  return score;
}
function best(G){
  let bi=null,bs=0;
  for(let r=2;r<=6;r++)for(let c=0;c<9;c++){
    if(!ok(G[r][c]))continue;
    for(const d of [[0,1],[1,0]]){
      const r2=r+d[0],c2=c+d[1];
      if(r2>6||c2>=9)continue;
      if(!ok(G[r2][c2]))continue;
      const s=evalMove(G,r,c,r2,c2);
      if(s>bs){bs=s;bi={r:r,c:c,r2:r2,c2:c2,s:s};}
    }
  }
  return bi;
}
function swipe(m){
  const x1=Math.round(X0+m.c*CS+CS/2),y1=Math.round(Y0+m.r*CS+CS/2);
  const x2=Math.round(X0+m.c2*CS+CS/2),y2=Math.round(Y0+m.r2*CS+CS/2);
  execFileSync('adb',['shell','input','swipe',String(x1),String(y1),String(x2),String(y2),'280']);
}
const rounds=+(process.argv[2]||8);
let G=readGrid(snap());
const t0=Date.now();
for(let k=0;k<rounds;k++){
  const m=best(G);
  if(!m){console.log('#'+(k+1)+' no move');break;}
  console.log('#'+(k+1)+' r'+m.r+'c'+m.c+'<->r'+m.r2+'c'+m.c2+' score='+m.s);
  swipe(m);
  const t=Date.now(); while(Date.now()-t<800){}
  G=readGrid(snap());
}
console.log('elapsed='+((Date.now()-t0)/1000).toFixed(1)+'s');
console.log('--- final ---');
console.log(G.join('\n'));
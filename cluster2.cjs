'use strict';
const fs=require('node:fs');
const {PNG}=require('pngjs');
const im=PNG.sync.read(fs.readFileSync(process.argv[2]));
const X0=+(process.argv[3]||30),Y0=+(process.argv[4]||820),CS=+(process.argv[5]||112),N=9;
function cellStats(cx0,cy0){
  const pad=Math.round(CS*0.22);
  let n=0,sr=0,sg=0,sb=0,sr2=0,sg2=0,sb2=0;
  const hist=new Array(12).fill(0);
  for(let y=cy0+pad;y<cy0+CS-pad;y+=2)for(let x=cx0+pad;x<cx0+CS-pad;x+=2){
    const k=4*(y*im.width+x);
    const R=im.data[k],G=im.data[k+1],B=im.data[k+2];
    sr+=R;sg+=G;sb+=B;sr2+=R*R;sg2+=G*G;sb2+=B*B;n++;
    const mx=Math.max(R,G,B),mn=Math.min(R,G,B);
    let h=0;
    if(mx!==mn){
      if(mx===R)h=((G-B)/(mx-mn)+6)%6;
      else if(mx===G)h=((B-R)/(mx-mn)+2);
      else h=((R-G)/(mx-mn)+4);
    }
    hist[Math.floor(h*2)%12]++;
  }
  const mr=sr/n,mg=sg/n,mb=sb/n;
  const sd=(Math.sqrt(sr2/n-mr*mr)+Math.sqrt(sg2/n-mg*mg)+Math.sqrt(sb2/n-mb*mb))/3;
  for(let i=0;i<12;i++)hist[i]=hist[i]/n;
  return {r:mr,g:mg,b:mb,sd:sd,hist:hist};
}
const cells=[];
for(let r=0;r<N;r++){cells.push([]);for(let c=0;c<N;c++)cells[r].push(cellStats(X0+c*CS,Y0+r*CS));}
function dist(a,b){
  const dr=a.r-b.r,dg=a.g-b.g,db=a.b-b.b;
  let hd=0;for(let i=0;i<12;i++)hd+=Math.abs(a.hist[i]-b.hist[i]);
  return Math.sqrt(dr*dr+dg*dg+db*db)/255 + hd*0.55;
}
function clusterAt(TH){
  const parent=[];for(let i=0;i<N*N;i++)parent.push(i);
  const find=x=>{while(parent[x]!==x){parent[x]=parent[parent[x]];x=parent[x];}return x;};
  for(let i=0;i<N*N;i++)for(let j=i+1;j<N*N;j++){
    if(dist(cells[Math.floor(i/N)][i%N],cells[Math.floor(j/N)][j%N])<TH){
      const a=find(i),b=find(j);if(a!==b)parent[b]=a;
    }
  }
  const label={};let n=0;const abc='ABCDEFGHJKLMNPQRSTUVWXYZ';const g=[];
  for(let r=0;r<N;r++){
    let line='';
    for(let c=0;c<N;c++){
      if(cells[r][c].sd<7){line+='.';continue;}
      const id=find(r*N+c);
      if(!(id in label))label[id]=abc[n++]||'Z';
      line+=label[id];
    }
    g.push(line);
  }
  return {n:n,g:g,th:TH};
}
let best=null;
for(let th=0.06;th<=0.42;th+=0.01){
  const r=clusterAt(th);
  if(!best||Math.abs(r.n-6)<Math.abs(best.n-6))best=r;
  if(r.n>=5&&r.n<=8){best=r;break;}
}
console.log('threshold='+best.th.toFixed(2)+' classes='+best.n);
console.log(best.g.join('\n'));
'use strict';
const fs=require('node:fs');
const {PNG}=require('pngjs');
const im=PNG.sync.read(fs.readFileSync(process.argv[2]));
const X0=30,Y0=820,CS=112,N=9;
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
    if(mx===mn)h=0;
    else if(mx===R)h=((G-B)/(mx-mn)+6)%6;
    else if(mx===G)h=((B-R)/(mx-mn)+2);
    else h=((R-G)/(mx-mn)+4);
    hist[Math.floor(h*2)%12]++;
  }
  const mr=sr/n,mg=sg/n,mb=sb/n;
  const sd=Math.sqrt(sr2/n-mr*mr)+Math.sqrt(sg2/n-mg*mg)+Math.sqrt(sb2/n-mb*mb);
  for(let i=0;i<12;i++)hist[i]=hist[i]/n;
  return {r:mr,g:mg,b:mb,sd:sd/3,hist:hist};
}
const cells=[];
for(let r=0;r<N;r++){cells.push([]);for(let c=0;c<N;c++)cells[r].push(cellStats(X0+c*CS,Y0+r*CS));}
function dist(a,b){
  const dr=a.r-b.r,dg=a.g-b.g,db=a.b-b.b;
  let hd=0;for(let i=0;i<12;i++)hd+=Math.abs(a.hist[i]-b.hist[i]);
  return Math.sqrt(dr*dr+dg*dg+db*db)/255 + hd*0.55;
}
const TH=0.115;
const parent=[];
for(let i=0;i<81;i++)parent.push(i);
function find(x){while(parent[x]!==x){parent[x]=parent[parent[x]];x=parent[x];}return x;}
function uni(a,b){a=find(a);b=find(b);if(a!==b)parent[b]=a;}
for(let i=0;i<81;i++)for(let j=i+1;j<81;j++){
  if(dist(cells[Math.floor(i/9)][i%9],cells[Math.floor(j/9)][j%9])<TH) uni(i,j);
}
const label={};let next=0;const abc='ABCDEFGHJKLMNPQRSTUVWXYZ';
const grid=[];
for(let r=0;r<N;r++){
  let line='';
  for(let c=0;c<N;c++){
    const st=cells[r][c];
    const id=find(r*9+c);
    if(st.sd<6){line+='.';continue;}
    if(!(id in label))label[id]=abc[next++]||'Z';
    line+=label[id];
  }
  grid.push(line);
}
console.log(grid.join('\n'));
console.log('classes='+next);
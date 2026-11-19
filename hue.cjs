'use strict';
const fs=require('node:fs');
const {PNG}=require('pngjs');
const im=PNG.sync.read(fs.readFileSync(process.argv[2]));
const X0=+(process.argv[3]||30),Y0=+(process.argv[4]||820),CS=+(process.argv[5]||112),N=9;
function cell(cx0,cy0){
  const pad=Math.round(CS*0.24);
  const hs=[];
  let n=0,sr=0,sg=0,sb=0;
  for(let y=cy0+pad;y<cy0+CS-pad;y+=2)for(let x=cx0+pad;x<cx0+CS-pad;x+=2){
    const k=4*(y*im.width+x);
    const R=im.data[k],G=im.data[k+1],B=im.data[k+2];
    sr+=R;sg+=G;sb+=B;n++;
    const mx=Math.max(R,G,B),mn=Math.min(R,G,B);
    const sat=mx===0?0:(mx-mn)/mx;
    if(sat>0.30&&mx>70){
      let h;
      if(mx===R)h=((G-B)/(mx-mn)+6)%6;
      else if(mx===G)h=((B-R)/(mx-mn)+2);
      else h=((R-G)/(mx-mn)+4);
      hs.push(h*60);
    }
  }
  hs.sort((a,b)=>a-b);
  const med=hs.length?hs[Math.floor(hs.length/2)]:null;
  const r=sr/n,g=sg/n,b=sb/n;
  return {r:r,g:g,b:b,lum:.299*r+.587*g+.114*b,hue:med,hsN:hs.length};
}
const ICE=[255,252,204];
const dIce=c=>Math.sqrt((c.r-ICE[0])**2+(c.g-ICE[1])**2+(c.b-ICE[2])**2);
const cells=[];
for(let r=0;r<N;r++){cells.push([]);for(let c=0;c<N;c++)cells[r].push(cell(X0+c*CS,Y0+r*CS));}
function hd(a,b){let d=Math.abs(a-b)%360;return d>180?360-d:d;}
const kind=cells.map(row=>row.map(c=>{
  if(c.lum<95)return 'bg';
  if(dIce(c)<42)return 'ice';
  if(c.hue===null)return 'ice';
  return 'blk';
}));
const idx=[];
for(let r=0;r<N;r++)for(let c=0;c<N;c++)if(kind[r][c]==='blk')idx.push([r,c]);
const TH=28;
const par=idx.map((_,i)=>i);
const find=x=>{while(par[x]!==x){par[x]=par[par[x]];x=par[x];}return x;};
for(let i=0;i<idx.length;i++)for(let j=i+1;j<idx.length;j++){
  const a=cells[idx[i][0]][idx[i][1]],b=cells[idx[j][0]][idx[j][1]];
  if(hd(a.hue,b.hue)<TH){const x=find(i),y=find(j);if(x!==y)par[y]=x;}
}
const lab={};let n=0;const abc='ABCDEFGHJKLMNPQRSTUVWXYZ';
const grid=[];
for(let r=0;r<N;r++){
  let line='';
  for(let c=0;c<N;c++){
    const k=kind[r][c];
    if(k==='bg'){line+='_';continue;}
    if(k==='ice'){line+='.';continue;}
    const i=idx.findIndex(p=>p[0]===r&&p[1]===c);
    const root=find(i);
    if(!(root in lab))lab[root]=abc[n++]||'Z';
    line+=lab[root];
  }
  grid.push(line);
}
console.log('blocks='+idx.length+' 色类='+n);
console.log(grid.map((s,i)=>'r'+i+' '+s).join('\n'));
const rows=[];
for(const [r,c] of idx) rows.push('  r'+r+'c'+c+' hue='+(cells[r][c].hue===null?'-':cells[r][c].hue.toFixed(0)));
console.log(rows.join('\n'));
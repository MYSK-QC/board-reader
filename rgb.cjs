'use strict';
const fs=require('node:fs');
const {PNG}=require('pngjs');
const im=PNG.sync.read(fs.readFileSync(process.argv[2]));
const X0=+(process.argv[3]||30),Y0=+(process.argv[4]||820),CS=+(process.argv[5]||112),N=9;
const hx=v=>('0'+Math.round(v).toString(16)).slice(-2);
for(let r=0;r<N;r++){
  const out=[];
  for(let c=0;c<N;c++){
    const pad=Math.round(CS*0.25);
    let n=0,sr=0,sg=0,sb=0;
    for(let y=Y0+r*CS+pad;y<Y0+r*CS+CS-pad;y+=3)for(let x=X0+c*CS+pad;x<X0+c*CS+CS-pad;x+=3){
      const k=4*(y*im.width+x);
      sr+=im.data[k];sg+=im.data[k+1];sb+=im.data[k+2];n++;
    }
    out.push(hx(sr/n)+hx(sg/n)+hx(sb/n));
  }
  console.log('r'+r+' '+out.join(' '));
}
console.log('size='+im.width+'x'+im.height);
'use strict';
const fs=require('node:fs');
const {PNG}=require('pngjs');
const B=require('./board.cjs');
const im=PNG.sync.read(fs.readFileSync(process.argv[2]));
const x0=+(process.argv[3]||30),y0=+(process.argv[4]||816),cs=+(process.argv[5]||112);
const cal=B.loadCalibration('./calibration.json');
const out=[];
for(let r=0;r<9;r++){
  let line='';
  for(let c=0;c<9;c++){
    const f=B.feature(im,x0+c*cs,y0+r*cs,cs,cs);
    line+=(B.classify(f,cal)||'?');
  }
  out.push(line);
}
console.log(out.join('\n'));
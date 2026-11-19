'use strict';
// 消消乐一步求解：给 9x9 网格，找出所有能形成三连的相邻交换
const N = 9;

function parse(grid) {
  return grid.trim().split('\n').map(r => r.trim().split(''));
}

// 判断某格是否是「可吃的」（非 # 非 ?）
function edible(c) { return c && c !== '#' && c !== '?'; }

// 检查整盘有哪些三连（返回坐标列表）
function findMatches(g) {
  const out = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (!edible(g[r][c])) continue;
      // 横三
      if (c + 2 < N && g[r][c] === g[r][c+1] && g[r][c] === g[r][c+2])
        out.push([r,c],[r,c+1],[r,c+2]);
      // 竖三
      if (r + 2 < N && g[r][c] === g[r+1][c] && g[r][c] === g[r+2][c])
        out.push([r,c],[r+1,c],[r+2,c]);
    }
  }
  return out;
}

// 饼干盒旁边的三连：格子 (r,c) 的上下左右若挨着 #
function nearCookie(g, r, c) {
  for (const [dr,dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
    const rr = r+dr, cc = c+dc;
    if (rr>=0 && rr<N && cc>=0 && cc<N && g[rr][cc] === '#') return true;
  }
  return false;
}

function solve(grid) {
  const g0 = parse(grid);
  const results = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      for (const [dr,dc] of [[0,1],[1,0]]) {
        const r2 = r+dr, c2 = c+dc;
        if (r2 >= N || c2 >= N) continue;
        const a = g0[r][c], b = g0[r2][c2];
        if (!edible(a) || !edible(b) || a === b) continue;
        // 交换
        const g = g0.map(row => row.slice());
        g[r][c] = b; g[r2][c2] = a;
        const m = findMatches(g);
        if (!m.length) continue;
        // 去重坐标
        const uniq = new Set(m.map(([rr,cc]) => rr+','+cc));
        // 有多少个三连挨着饼干盒
        let cookieHits = 0;
        for (const key of uniq) {
          const [rr,cc] = key.split(',').map(Number);
          if (nearCookie(g0, rr, cc)) cookieHits++;
        }
        results.push({
          from: [r,c], to: [r2,c2],
          swap: a + '<->' + b,
          matched: uniq.size,
          cookie: cookieHits
        });
      }
    }
  }
  results.sort((x,y) => (y.cookie - x.cookie) || (y.matched - x.matched));
  return results;
}

const grid = process.argv[2] || require('node:fs').readFileSync(0,'utf8');
const all = solve(grid);
console.log('moves=' + all.length);
for (const m of all.slice(0, 8)) {
  console.log(`  (${m.from[0]+1},${m.from[1]+1}) <-> (${m.to[0]+1},${m.to[1]+1})  ${m.swap}  matched=${m.matched} cookie=${m.cookie}`);
}
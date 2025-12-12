const { N_SECTORS } = require("./geometry");

const ACTIVE_LEN = 6;
const SHIFT_PER_SURVEY = 2;

const ANIMALS = Object.freeze({
  OAK: "OAK",
  LEOPARD: "LEOPARD",
  ZEBRA: "ZEBRA",
  VULTURE: "VULTURE",
  AARDWOLF: "AARDWOLF",
});

const SURVEYABLE = new Set([ANIMALS.OAK, ANIMALS.LEOPARD, ANIMALS.ZEBRA, ANIMALS.VULTURE]);

const OAK_ALLOWED = new Set([1,3,5,8,10,13].map(n => n-1)); // 0-based
const SURVEY_COST_MIN = Object.freeze({ 2: 20, 3: 15, 4: 10 });

function wrap(i){ return ((i % N_SECTORS) + N_SECTORS) % N_SECTORS; }
function ringDist(a,b){
  const d = Math.abs(a-b);
  return Math.min(d, N_SECTORS - d);
}

function isSectorActive(sectorIdx, activeStartIdx){
  for(let k=0;k<ACTIVE_LEN;k++){
    if (wrap(activeStartIdx + k) === sectorIdx) return true;
  }
  return false;
}

function uniqueInts(arr){
  const s = new Set();
  for(const x of arr) s.add(x);
  return Array.from(s);
}

// Returns { ok: boolean, ordered: number[] | null }
function contiguousRun(sectors){
  if(!Array.isArray(sectors)) return { ok:false, ordered:null };
  const u = uniqueInts(sectors);
  if(u.length !== sectors.length) return { ok:false, ordered:null };
  const n = sectors.length;
  if(n < 2 || n > 4) return { ok:false, ordered:null };

  const set = new Set(sectors);
  for(const start of sectors){
    const seq = [];
    for(let k=0;k<n;k++) seq.push(wrap(start + k));
    let matches = true;
    for(const x of seq) if(!set.has(x)) { matches = false; break; }
    if(matches) return { ok:true, ordered: seq };
  }
  return { ok:false, ordered:null };
}

function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

function zebraComponents(zebraIdx){
  const set = new Set(zebraIdx);
  const seen = new Set();
  const comps = [];
  for(const start of zebraIdx){
    if(seen.has(start)) continue;
    const stack = [start];
    seen.add(start);
    const comp = [];
    while(stack.length){
      const v = stack.pop();
      comp.push(v);
      for(const u of [wrap(v-1), wrap(v+1)]){
        if(set.has(u) && !seen.has(u)){
          seen.add(u);
          stack.push(u);
        }
      }
    }
    comps.push(comp);
  }
  return comps;
}

function validateSolution(sol){
  const errs = [];
  const counts = {};
  for(const v of sol) counts[v] = (counts[v] || 0) + 1;

  const need = (k,n) => { if((counts[k]||0)!==n) errs.push(`Expected ${n} ${k}, found ${(counts[k]||0)}.`); };
  need(ANIMALS.OAK, 3);
  need(ANIMALS.LEOPARD, 3);
  need(ANIMALS.ZEBRA, 4);
  need(ANIMALS.VULTURE, 2);
  need(ANIMALS.AARDWOLF, 1);

  for(let i=0;i<N_SECTORS;i++){
    if(sol[i]===ANIMALS.OAK && !OAK_ALLOWED.has(i)) errs.push(`Oak in invalid sector ${i+1}.`);
  }

  const L = [];
  for(let i=0;i<N_SECTORS;i++) if(sol[i]===ANIMALS.LEOPARD) L.push(i);
  for(let a=0;a<L.length;a++) for(let b=a+1;b<L.length;b++){
    if(ringDist(L[a],L[b]) < 3) errs.push(`Leopards too close at ${L[a]+1} and ${L[b]+1}.`);
  }

  const V = [];
  for(let i=0;i<N_SECTORS;i++) if(sol[i]===ANIMALS.VULTURE) V.push(i);
  if(V.length===2){
    const isCW = (idx)=> sol[wrap(idx-1)]===ANIMALS.LEOPARD;  // vulture is CW of leopard
    const isCCW = (idx)=> sol[wrap(idx+1)]===ANIMALS.LEOPARD; // vulture is CCW of leopard
    const okCW = isCW(V[0]) && isCW(V[1]);
    const okCCW = isCCW(V[0]) && isCCW(V[1]);
    if(!(okCW||okCCW)) errs.push("Vulture directional rule violated.");
  }

  const Z = [];
  for(let i=0;i<N_SECTORS;i++) if(sol[i]===ANIMALS.ZEBRA) Z.push(i);
  if(Z.length===4){
    for(const i of Z){
      const hasAdj = Z.includes(wrap(i-1)) || Z.includes(wrap(i+1));
      if(!hasAdj) errs.push(`Zebra at ${i+1} not adjacent to another zebra.`);
    }
    const comps = zebraComponents(Z);
    const sizes = comps.map(c=>c.length).sort((a,b)=>a-b);
    const ok = (sizes.length===1 && sizes[0]===4) || (sizes.length===2 && sizes[0]===2 && sizes[1]===2);
    if(!ok) errs.push(`Zebra grouping invalid: ${sizes.join(",")}`);
  }

  return { ok: errs.length===0, errs };
}

function tryPlaceZebrasQuad(sol){
  const starts = shuffle([...Array(N_SECTORS).keys()]);
  for(const s of starts){
    const idxs = [0,1,2,3].map(k=>wrap(s+k));
    if(idxs.every(i=>sol[i]==null)){
      for(const i of idxs) sol[i]=ANIMALS.ZEBRA;
      return true;
    }
  }
  return false;
}

function tryPlaceZebrasPairs(sol){
  const pairs = [];
  for(let s=0;s<N_SECTORS;s++){
    const a=s, b=wrap(s+1);
    if(sol[a]==null && sol[b]==null) pairs.push([a,b]);
  }
  const order = shuffle([...Array(pairs.length).keys()]);
  for(let i=0;i<order.length;i++){
    for(let j=i+1;j<order.length;j++){
      const p1 = pairs[order[i]];
      const p2 = pairs[order[j]];
      const set = new Set([...p1,...p2]);
      if(set.size!==4) continue;
      const all = Array.from(set);
      if(!all.every(k=>sol[k]==null)) continue;
      const comps = zebraComponents(all);
      const sizes = comps.map(c=>c.length).sort((a,b)=>a-b);
      if(!(sizes.length===2 && sizes[0]===2 && sizes[1]===2)) continue;
      for(const k of all) sol[k]=ANIMALS.ZEBRA;
      return true;
    }
  }
  return false;
}

function placeZebras(sol){
  const modes = shuffle(["quad","pairs"]);
  for(const m of modes){
    const ok = (m==="quad") ? tryPlaceZebrasQuad(sol) : tryPlaceZebrasPairs(sol);
    if(ok) return true;
  }
  return false;
}

function generateSolution(){
  const MAX = 150000;
  for(let attempt=0; attempt<MAX; attempt++){
    const sol = Array(N_SECTORS).fill(null);

    if(!placeZebras(sol)) continue;

    const open = shuffle([...Array(N_SECTORS).keys()].filter(i=>sol[i]==null));
    const leopards = [];
    for(const idx of open){
      if(leopards.length===3) break;
      if(leopards.every(e=>ringDist(e,idx) >= 3)){
        leopards.push(idx);
        sol[idx]=ANIMALS.LEOPARD;
      }
    }
    if(leopards.length!==3) continue;

    const cwCand = [];
    const ccwCand = [];
    for(const L of leopards){
      const cw = wrap(L+1);
      const ccw = wrap(L-1);
      if(sol[cw]==null) cwCand.push(cw);
      if(sol[ccw]==null) ccwCand.push(ccw);
    }
    const cwU = uniqueInts(cwCand);
    const ccwU = uniqueInts(ccwCand);
    const dirs = [];
    if(cwU.length>=2) dirs.push("CW");
    if(ccwU.length>=2) dirs.push("CCW");
    if(dirs.length===0) continue;
    const dir = dirs[Math.floor(Math.random()*dirs.length)];
    const pool = shuffle(dir==="CW"?cwU:ccwU).slice(0,2);
    for(const i of pool) sol[i]=ANIMALS.VULTURE;

    const oakSlots = [...OAK_ALLOWED].filter(i=>sol[i]==null);
    if(oakSlots.length<3) continue;
    const oaks = shuffle(oakSlots).slice(0,3);
    for(const i of oaks) sol[i]=ANIMALS.OAK;

    const rem = [];
    for(let i=0;i<N_SECTORS;i++) if(sol[i]==null) rem.push(i);
    if(rem.length!==1) continue;
    sol[rem[0]]=ANIMALS.AARDWOLF;

    const check = validateSolution(sol);
    if(check.ok) return sol;
  }
  throw new Error("Failed to generate solution after many attempts.");
}

function generateHints(solution){
  // Updated spec: exactly 6 hints: 3 vulture, 2 leopard, 1 zebra. All in different sectors.
  const wanted = [ANIMALS.VULTURE, ANIMALS.VULTURE, ANIMALS.VULTURE,
                  ANIMALS.LEOPARD, ANIMALS.LEOPARD,
                  ANIMALS.ZEBRA];
  const animals = shuffle(wanted);
  const used = new Set();
  const hints = [];

  for(const a of animals){
    const candidates = [];
    for(let s=0;s<N_SECTORS;s++){
      if(used.has(s)) continue;
      if(solution[s] !== a) candidates.push(s);
    }
    if(candidates.length===0) throw new Error("HINT_GEN_FAILED");
    const sector = candidates[Math.floor(Math.random()*candidates.length)];
    used.add(sector);
    hints.push({ animal: a, sector }); // 0..12
  }
  return hints;
}

function sectorsDisplay(ordered){
  const start = ordered[0], end = ordered[ordered.length-1];
  const wrapFlag = end < start;
  const base = `${start+1} to ${end+1}`;
  return { text: wrapFlag ? `${base} (wrap)` : base, wrap: wrapFlag };
}

function countInSectors(solution, sectors, animal){
  let c=0;
  for(const s of sectors) if(solution[s]===animal) c++;
  return c;
}

module.exports = {
  ACTIVE_LEN,
  SHIFT_PER_SURVEY,
  ANIMALS,
  SURVEYABLE,
  SURVEY_COST_MIN,
  wrap,
  isSectorActive,
  contiguousRun,
  sectorsDisplay,
  generateSolution,
  generateHints,
  countInSectors,
};

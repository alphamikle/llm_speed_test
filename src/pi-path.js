import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export function piPath() {
  let dir = path.dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent')));
  for (let level=0;level<8;level++,dir=path.dirname(dir)) {
    const file = path.join(dir,'package.json');
    if (fs.existsSync(file)) {
      const pkg=JSON.parse(fs.readFileSync(file,'utf8'));
      if (pkg.name==='@earendil-works/pi-coding-agent') return {root:dir, cli:path.join(dir,typeof pkg.bin==='string'?pkg.bin:pkg.bin.pi),version:pkg.version};
    }
  }
  throw new Error('Cannot locate the installed Pi CLI. Reinstall sllm with npm install -g.');
}

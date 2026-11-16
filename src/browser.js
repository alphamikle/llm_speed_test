import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
import {ensureDir} from './util.js';

export const GAME_CONTRACT = `# Benchmark interoperability contract

Use data-testid="auto-place" for automatic fleet placement, "start-game" for starting play, "restart" for a new game, and "opponent-cell-R-C" for each target cell (zero-based R and C).
The page must have an accessible heading and show both boards after the game starts.
engine.js must export chooseShot(knowledge). knowledge has {size:10, shots:[{row,col,result:'hit'|'miss'|'sunk'}], remainingShips:[5,4,3,3,2]}. Return {row,col} for an untried legal square. Remaining ships excludes already sunk ships. Consecutive sunk ship records are ordinary previously fired shots. The function must work without a DOM, network or hidden board and must not mutate knowledge. Use knowledge.seed when tie-breaking reproducibly; otherwise Math.random is available. The benchmark resolves shots against secret random boards externally and checks pursuit efficiency, no repeated shots and independence from irrelevant hidden data. Use ES module exports and package.json type: module.
Playwright is preinstalled. Use the supplied browser-check.mjs helper to capture real desktop and mobile screenshots. Use the read tool to inspect screenshots before finishing. You may add more browser tests.
`;
export async function serveWorkspace(root) {
  const server=http.createServer((req,res)=>{
    let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400);res.end();return;}
    const file=path.resolve(root,`.${pathname==='/'?'/index.html':pathname}`);
    if(!file.startsWith(path.resolve(root)+path.sep)){res.writeHead(403);res.end();return;}
    if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
    const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.png':'image/png'};
    res.setHeader('content-type',types[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(resolve=>server.close(resolve))};
}
export async function inspectGame(root,dir) {
  ensureDir(dir);const server=await serveWorkspace(root);let browser;const errors=[];const details=[];
  try{
    browser=await chromium.launch({headless:true});
    for(const [name,width,height] of [['desktop',1440,1000],['mobile',390,844]]){
      const page=await browser.newPage({viewport:{width,height}});const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
      await page.goto(server.url,{waitUntil:'networkidle',timeout:20000});
      await page.getByTestId('auto-place').click({timeout:5000});
      await page.getByTestId('start-game').click({timeout:5000});
      await page.getByTestId('opponent-cell-0-0').click({timeout:5000});await page.waitForTimeout(700);
      const cells=await page.locator('[data-testid^="opponent-cell-"]').count();if(cells!==100)errors.push(`${name}: expected 100 opponent cells, got ${cells}`);
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+3);if(overflow)errors.push(`${name}: horizontal viewport overflow`);
      await page.screenshot({path:path.join(dir,`${name}.png`),fullPage:true});
      await page.getByTestId('restart').click({timeout:5000});
      if(pageErrors.length)errors.push(...pageErrors.map(error=>`${name}: ${error}`));
      details.push({name,width,height,cells,overflow,page_errors:pageErrors,screenshot:`${name}.png`});await page.close();
    }
    const svg=fs.readdirSync(root,{recursive:true}).filter(file=>file.endsWith('.svg')&&!file.includes('node_modules'));
    if(!svg.length)errors.push('No locally generated SVG assets');
    return {passed:!errors.length,errors,viewports:details,svg_assets:svg};
  }catch(error){return {passed:false,errors:[...errors,error.message],viewports:details};}
  finally{await browser?.close();await server.close();}
}
export function browserHelperSource() {
  return `import {inspectGame} from ${JSON.stringify(new URL('./browser.js',import.meta.url).href)};\nconst result=await inspectGame(process.cwd(),process.cwd()+'/screenshots');console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1;\n`;
}

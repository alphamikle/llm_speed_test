import fs from 'node:fs';
import {initConfig} from '../src/config.js';
import {piPath} from '../src/pi-path.js';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
try {
  const pkg = piPath();
  if (!fs.existsSync(pkg.cli)) throw new Error('Pi dependency is missing');
  const file = initConfig();
  console.log(`sllm installed with Pi. Configuration: ${file}`);
  if (process.env.SLLM_SKIP_BROWSER_INSTALL !== '1') execFileSync(process.execPath,[path.join(path.dirname(fileURLToPath(import.meta.resolve('playwright/package.json'))),'cli.js'),'install','chromium'],{stdio:'inherit'});
} catch (error) {console.error(`sllm installation error: ${error.message}`); process.exitCode = 1;}

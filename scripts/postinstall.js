import fs from 'node:fs';
import {initConfig} from '../src/config.js';
import {piPath} from '../src/pi-path.js';
try {
  const pkg = piPath();
  if (!fs.existsSync(pkg.cli)) throw new Error('Pi dependency is missing');
  const file = initConfig();
  console.log(`sllm installed with Pi. Configuration: ${file}`);
} catch (error) {console.error(`sllm installation error: ${error.message}`); process.exitCode = 1;}

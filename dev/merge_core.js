#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';

const coreFiles = [
  'src/index.ts',
  'src/core/config.ts',
  'src/core/markdown.ts', 
  'src/core/output.ts',
  'src/core/types.ts',
  'src/bridge/client.ts',
  'src/bridge/daemon.ts',
  'src/bridge/protocol.ts',
  'src/python/health.ts',
  'src/python/setup.ts',
  'src/ui/logger.ts',
  'src/ui/progress.ts',
  'src/utils/completions.ts'
];

const separator = '\n' + '='.repeat(80) + '\n';

function mergeCoreCode() {
  const outputPath = 'combined_code.txt';
  let combinedContent = '';
  
  combinedContent += 'COMBINED CORE SYSTEM CODE\n';
  combinedContent += `Generated on: ${new Date().toISOString()}\n`;
  combinedContent += '='.repeat(80) + '\n\n';
  
  for (const filePath of coreFiles) {
    try {
      const fullPath = path.resolve(filePath);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf8');
        combinedContent += `FILE: ${filePath}\n`;
        combinedContent += separator;
        combinedContent += content + '\n';
        combinedContent += separator + '\n';
      } else {
        combinedContent += `FILE: ${filePath} (NOT FOUND)\n`;
        combinedContent += separator + '\n';
      }
    } catch (error) {
      combinedContent += `FILE: ${filePath} (ERROR READING: ${error})\n`;
      combinedContent += separator + '\n';
    }
  }
  
  fs.writeFileSync(outputPath, combinedContent, 'utf8');
  console.log(`Combined code written to: ${outputPath}`);
  console.log(`Total files processed: ${coreFiles.length}`);
}

mergeCoreCode();

/**
 * HeaderHandler - 处理头文件注入
 */

const fs = require('fs');
const path = require('path');
const injection = require('../../injection/injectionService.js');

class HeaderHandler {
  constructor() {
    this.importReg = /^\#import\s*<[A-Za-z0-9_]+\/[A-Za-z0-9_+.-]+\.h>$/;
  }

  async handle(specFile, updateFile, headerLine, importArray, isSwift) {
    if (isSwift || updateFile.endsWith('.h')) {
      await injection.handleHeaderLine(specFile, updateFile, headerLine, importArray, isSwift);
      return;
    }

    const dotIndex = updateFile.lastIndexOf('.');
    const mainPathFile = updateFile.substring(0, dotIndex) + '.h';

    fs.access(mainPathFile, fs.constants.F_OK, async (err) => {
      if (err) {
        await injection.handleHeaderLine(specFile, updateFile, headerLine, importArray, isSwift);
        return;
      }
      fs.readFile(mainPathFile, 'utf8', async (readErr, data) => {
        if (readErr) {
          await injection.handleHeaderLine(specFile, updateFile, headerLine, importArray, isSwift);
          return;
        }

        const lineArray = data.split('\n');
        lineArray.forEach(element => {
          const lineVal = element.trim();
          if (this.importReg.test(lineVal)) {
            importArray.push(lineVal);
          }
        });

        await injection.handleHeaderLine(specFile, updateFile, headerLine, importArray, isSwift);
      });
    });
  }
}

module.exports = new HeaderHandler();

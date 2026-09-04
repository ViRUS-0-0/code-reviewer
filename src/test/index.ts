import * as path from 'path';
import Mocha = require('mocha');

export function run(): Promise<void> {
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
  });

  return new Promise((resolve, reject) => {
    try {
      require('./diffProcessor.test');
      mocha.run((failures: number) => {
        if (failures > 0) {
          reject(new Error(`${failures} tests failed.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

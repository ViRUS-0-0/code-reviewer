"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.run = void 0;
const Mocha = require("mocha");
function run() {
    const mocha = new Mocha({
        ui: 'tdd',
        color: true,
    });
    return new Promise((resolve, reject) => {
        try {
            require('./diffProcessor.test');
            mocha.run((failures) => {
                if (failures > 0) {
                    reject(new Error(`${failures} tests failed.`));
                }
                else {
                    resolve();
                }
            });
        }
        catch (err) {
            reject(err);
        }
    });
}
exports.run = run;
//# sourceMappingURL=index.js.map
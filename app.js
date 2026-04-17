'use strict';

const Homey = require('homey');

class MyApp extends Homey.App {

  async onInit() {
    this.log('V2C Wallbox app initialized');

    this._memwarnHandler = (data) => {
      this.log('memwarn event received on app level', data || {});
    };
    this.homey.on('memwarn', this._memwarnHandler);
  }

  async onUninit() {
    if (this._memwarnHandler) {
      this.homey.removeListener('memwarn', this._memwarnHandler);
      this._memwarnHandler = null;
    }
  }

}

module.exports = MyApp;
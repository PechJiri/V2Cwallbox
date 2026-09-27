'use strict';

const Homey = require('homey');

class MyApp extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   * This is the entry point for your app, where you can set up 
   * anything that needs to be initialized when the app starts.
   */
  async onInit() {
    this.log('MyApp has been initialized');

    // Here you can initialize global event listeners or services
    // For example, you can set up WebSocket connections, HTTP servers, etc.
    
    this.initializeGlobalListeners();
    this.registerWallboxWidgetAutocomplete();
  }

  /**
   * Initializes any global event listeners or services that the app needs.
   * This method can be used to set up any recurring tasks, listeners, 
   * or external integrations that should be active throughout the app's lifecycle.
   */
  initializeGlobalListeners() {
    // Example: Listening for a global event
    // this.homey.on('someEvent', this.handleSomeEvent.bind(this));

    // Example: Set up a recurring task
    // this.homey.setInterval(this.someRecurringTask.bind(this), 10000); // Run every 10 seconds

    this.log('Global listeners have been initialized');
  }

  registerWallboxWidgetAutocomplete() {
    const dashboards = this.homey?.dashboards;
    if (typeof dashboards?.getWidget !== 'function') {
      this.log('Dashboard widget settings are unavailable; wallbox selection autocomplete was not registered');
      return;
    }

    const widget = dashboards.getWidget('wallbox-status');
    if (typeof widget?.registerSettingAutocompleteListener !== 'function') {
      this.log('Wallbox widget autocomplete listener is unavailable');
      return;
    }

    widget.registerSettingAutocompleteListener('device_id', async (query) => {
      const driver = this.homey.drivers.getDriver('v2c-wallbox');
      const devices = await driver.getDevices();
      const searchText = typeof query === 'string'
        ? query.trim().toLocaleLowerCase()
        : typeof query?.query === 'string'
          ? query.query.trim().toLocaleLowerCase()
          : '';

      return devices
        .map((device) => {
          const pairingId = device.getData()?.id;
          if (typeof pairingId !== 'string' || pairingId.trim() === '') return null;
          return {
            name: device.getName(),
            id: pairingId
          };
        })
        .filter((suggestion) => suggestion && (
          searchText === '' ||
          suggestion.name.toLocaleLowerCase().includes(searchText) ||
          suggestion.id.toLocaleLowerCase().includes(searchText)
        ));
    });
  }

  /**
   * Handles a specific event that the app is listening for.
   * This is just an example of how you might structure event handling.
   */
  async handleSomeEvent(data) {
    this.log('Handling some event with data:', data);

    // Process the event data here
  }

  /**
   * Example of a recurring task that could be set up in initializeGlobalListeners.
   * This is just an example method to illustrate how you might set up recurring logic.
   */
  async someRecurringTask() {
    this.log('Running some recurring task');

    // Add logic for the recurring task here
  }

}

module.exports = MyApp;

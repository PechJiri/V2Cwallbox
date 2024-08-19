V2C Wallbox Homey App

Overview

The V2C Wallbox Homey App allows you to integrate your V2C electric vehicle (EV) charger with the Homey platform, enabling you to monitor and control your charging sessions directly from the Homey app. With this app, you can track real-time data, view the charging status, and much more, all from the comfort of your Homey setup.

Features

	•	Real-time Monitoring: View current charging power, voltage, energy consumed, and other vital statistics of your EV charger.
	•	Status Notifications: Receive alerts about the charging status, whether the vehicle is connected, charging, or if there is an error.
	•	Detailed Insights: Access information about the intensity, dynamic charging status, and whether the charger is locked.
	•	Easy Setup: Simply input your V2C Wallbox’s IP address to connect your charger to Homey.

Capabilities

This app provides the following capabilities:

	•	measure_charge_state: Indicates the current charging state (e.g., not connected, connected, charging).
	•	measure_charge_power: Shows the current charging power in Watts (W).
	•	measure_voltage_installation: Displays the voltage of the installation in Volts (V).
	•	measure_charge_energy: Tracks the total energy charged in kilowatt-hours (kWh).
	•	measure_slave_error: Reports any errors from the slave device.
	•	measure_charge_time: Shows the duration of the current charging session in minutes.
	•	measure_paused: Indicates if the charging is paused.
	•	measure_locked: Indicates if the charger is locked.
	•	measure_intensity: Displays the current charging intensity.
	•	measure_dynamic: Shows whether dynamic charging is enabled.

Installation

	1.	Install the app: Search for “V2C Wallbox” in the Homey App Store and install the app.
	2.	Add your Wallbox: In the Homey app, navigate to Devices > Add Device > V2C Wallbox.
	3.	Enter your IP address: When prompted, enter the IP address of your V2C Wallbox.
	4.	Start Monitoring: Your V2C Wallbox is now connected to Homey! You can monitor the charger’s status and receive notifications directly in the Homey app.

Requirements

	•	A V2C Wallbox charger connected to your local network.
	•	Homey version 5.0.0 or higher.

Troubleshooting

	•	Unable to connect: Ensure that your V2C Wallbox is on the same local network as Homey and that the IP address is correct.
	•	No data received: Check your network connection and restart the V2C Wallbox and Homey.

Contribution

We welcome contributions to improve this app! Feel free to open issues or submit pull requests on our GitHub repository.

License

This app is licensed under the MIT License. See the LICENSE file for more information.

Feel free to modify this README as necessary to better fit your app and its features.
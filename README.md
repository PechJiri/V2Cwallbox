V2C Wallbox Homey App
Overview
The V2C Wallbox Homey App provides comprehensive integration of your V2C electric vehicle (EV) charger with the Homey platform. Monitor charging sessions, control charging behavior, and automate your EV charging through Homey's intuitive interface and powerful flow system.
Features
Real-time Monitoring

Live charging status and power consumption
Detailed energy statistics (session, monthly, yearly)
House power consumption (with measuring clamps)
Solar production and battery status (with proper installation)
Installation voltage and signal strength
Error monitoring and connection status
Firmware version tracking

Advanced Control

Pause/Resume charging
Lock/Unlock charger
Adjustable charging intensity (6-32A)
Homey Energy tab control — set charging power in Watts (target_power) with automatic W↔A conversion based on your installation's phase count
Power management modes exposed via target_power_mode (standard Homey Energy capability):

Homey controls (Homey drives target_power)
V2C Dynamic — Timed Power Enabled / Disabled
V2C Dynamic — FV Exclusive
V2C Dynamic — FV + Min Power
V2C Dynamic — Grid + FV
V2C Dynamic — Without Charge


Timer control

Dashboard Widget

Live status monitoring
Real-time power display (kW)
Energy consumption tracking (kWh)
Quick pause/resume control
Dark/light theme support

Flow Support

Extensive triggers for car connection and charging states
Condition cards for charging status and power thresholds
Action cards for controlling all charger functions

Requirements

A V2C Wallbox charger connected to your local network
Static IP address assigned to the wallbox
Homey and wallbox on the same network
For advanced features (house consumption, solar production):

Measuring clamps properly installed
Connection to solar inverter (if applicable)
Dynamic mode enabled



Installation

Install the app from Homey App Store
Add your wallbox through Devices > Add Device > V2C Wallbox
Enter your wallbox's static IP address
Configure desired settings:

Installation phase count (1 or 3) — important for correct W↔A conversion when using Homey Energy target_power
Voltage measurement type (Line-to-Neutral ~230V / Line-to-Line ~400V) — only affects 3-phase installations; set this to whatever your V2C reports as installation voltage
Min/Max charging intensity
Dynamic power mode preferences
Debug logging options

Upgrading from v1.x

After upgrading to v2.0 it is recommended to remove and re-pair your V2C Wallbox. Automatic capability migration runs on first launch, but Homey's system flow cards for target_power, evcharger_charging and target_power_mode are only generated for freshly paired devices — existing devices won't see them in the flow editor until re-paired.



Capabilities
The app provides extensive capabilities including:

Charging state monitoring (evcharger_charging_state)
Power consumption tracking (measure_charge_power, measure_power)
Installation voltage monitoring (measure_voltage_installation)
Energy consumption statistics (measure_charge_energy, measure_monthly_energy, measure_yearly_energy, meter_power)
House power monitoring (measure_house_power)
Solar production tracking (measure_fv_power)
Battery status (measure_battery_power)
Charging control (evcharger_charging, locked)
Homey Energy target control (target_power, target_power_mode)
Dynamic charging management (min_intensity, max_intensity, set_intensity)
System monitoring (firmware_version, signal_status, measure_slave_error)

Troubleshooting

Verify network connectivity between Homey and wallbox
Ensure static IP is correctly configured
Check measuring clamps installation for power monitoring features
Enable debug logging in settings for detailed diagnostics
Verify dynamic mode settings for advanced power features

Contribution
If you appreciate this app, consider supporting its development. Feedback and contributions are welcome!
Support
For issues or questions:

Check connection requirements
Verify hardware installation for advanced features
Review debug logs
Contact support through Homey community

License
This app is licensed under the MIT License. See the LICENSE file for details.
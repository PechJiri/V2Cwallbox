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
Dynamic power management with multiple modes:

FV Exclusive mode
FV+Min Power mode
Grid+FV mode
Timed power modes


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

Update interval
Min/Max charging intensity
Dynamic power mode preferences
Debug logging options



Capabilities
The app provides extensive capabilities including:

Charging state monitoring (measure_charge_state)
Power consumption tracking (measure_charge_power)
Installation voltage monitoring (measure_voltage_installation)
Energy consumption statistics (measure_charge_energy, measure_monthly_energy, measure_yearly_energy)
House power monitoring (measure_house_power)
Solar production tracking (measure_fv_power)
Battery status (measure_battery_power)
Charging control (measure_paused, measure_locked)
Dynamic charging management (measure_dynamic, min_intensity, max_intensity)
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
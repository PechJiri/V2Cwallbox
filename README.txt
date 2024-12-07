The app provides comprehensive control and monitoring of your V2C Wallbox charger through Homey's interface. It retrieves detailed real-time data about charging status, vehicle connection, power consumption, and enables advanced control through Homey flows.
Key features include:

Real-time monitoring of charging status, power consumption, and vehicle connection
Monthly and yearly energy statistics tracking
Advanced control capabilities (pause/resume charging, lock/unlock, intensity settings)
Dynamic power management with multiple operation modes
House power consumption and solar production monitoring (requires measuring clamps installation)
Intuitive dashboard widget for quick status overview and control
Extensive Flow support with triggers, conditions, and actions

For house consumption data, solar production, and dynamic power features, your V2C Wallbox must be properly connected to your electrical installation using measuring clamps or directly to your solar inverter, and dynamic mode must be enabled.
The app communicates with the wallbox via HTTP commands on your local network, so both Homey and the V2C wallbox must be on the same network. For reliable operation, it's recommended to assign a static IP address to your wallbox.
Control actions can be used in two modes:

With dynamic mode enabled - supports min/max intensity settings and various power modes (FV Exclusive, FV+Min Power, Grid+FV)
Without dynamic mode - supports direct intensity control and basic charging management

Tested on V2C Trydan charger and should be compatible with all V2C charger models due to unified specifications.
Note: All features require proper network setup and configuration. Some advanced features are dependent on proper installation of measuring clamps and connection to solar inverter if applicable.
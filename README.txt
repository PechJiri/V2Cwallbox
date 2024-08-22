The app allows you to monitor your V2C Wallbox online, retrieve complete data on charging progress, vehicle connection, and more, and control other devices in your home through flows based on this data.

Latest release added a THEN controls for your wallbox. Some of them should be used only with dynamic mode on (min, max intensity) and some of them without dynamic mode (intensity).

App is based on HTTP GET specification and controls wallbox via local network. So Homey and V2C wallbox should be on same network.

Tested on V2C Trydan charger, but should work for every V2C charger.
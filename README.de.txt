Die App bietet umfassende Kontrolle und Überwachung Ihres V2C Wallbox-Ladegeräts über die Homey-Oberfläche. Sie ruft detaillierte Echtzeitdaten zum Ladestatus, zur Fahrzeugverbindung und zum Stromverbrauch ab und ermöglicht erweiterte Kontrolle über Homey-Flows. 
Wichtige Funktionen umfassen:

Echtzeitüberwachung des Ladestatus, Stromverbrauchs und Fahrzeugverbindung
Monatliche und jährliche Energiestatistikverfolgung
Erweiterte Steuerungsmöglichkeiten (Aufladen pausieren/fortsetzen, sperren/entsperren, Intensitätseinstellungen)
Dynamisches Energiemanagement mit mehreren Betriebsmodi
Überwachung des Hausstromverbrauchs und der Sonnenenergieproduktion (erfordert Installation von Messklemmen)
Intuitives Dashboard-Widget für schnelle Statusübersicht und Steuerung
Umfangreiche Flow-Unterstützung mit Auslösern, Bedingungen und Aktionen

Für Daten zum Hausverbrauch, Sonnenenergieproduktion und dynamische Energiemanagementfunktionen muss Ihre V2C Wallbox ordnungsgemäß mit Ihrer elektrischen Installation über Messklemmen oder direkt mit Ihrem Solarinverter verbunden und der dynamische Modus aktiviert sein. Die App kommuniziert über HTTP-Befehle im lokalen Netzwerk mit der Wallbox, daher müssen sowohl Homey als auch die V2C Wallbox im selben Netzwerk sein. Für einen zuverlässigen Betrieb wird empfohlen, Ihrer Wallbox eine feste IP-Adresse zuzuweisen. 
Steuerungsaktionen können in zwei Modi verwendet werden:

Mit aktiviertem dynamischen Modus - unterstützt Min/Max-Intensitätseinstellungen und verschiedene Energiemodi (FV Exklusiv, FV+Min Energie, Netz+FV)
Ohne dynamischen Modus - unterstützt direkte Intensitätskontrolle und grundlegende Ladeverwaltung

Getestet am V2C Trydan-Ladegerät und sollte mit allen V2C-Ladegerätemodellen aufgrund einheitlicher Spezifikationen kompatibel sein. 
Hinweis: Alle Funktionen erfordern eine ordnungsgemäße Netzwerkeinrichtung und -konfiguration. Einige erweiterte Funktionen hängen von der ordnungsgemäßen Installation von Messklemmen und der Verbindung mit einem Solarinverter ab, falls zutreffend.
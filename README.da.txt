Appen giver omfattende kontrol og overvågning af din V2C Wallbox-oplader gennem Homeys interface. Den henter detaljerede realtidsdata om opladningsstatus, køretøjsforbindelse, strømforbrug og muliggør avanceret kontrol via Homey flows.  
Nøglefunktioner inkluderer:

Realtidsovervågning af opladningsstatus, strømforbrug og køretøjsforbindelse  
Månedlig og årlig energistatistik  
Avancerede kontrolmuligheder (pause/genoptag opladning, lås/oplås, intensitetsindstillinger)  
Dynamisk strømstyring med flere driftsformer  
Overvågning af husforbrug og solproduktion (kræver installation af måleklemmer)  
Intuitiv dashboard-widget til hurtig statusoversigt og kontrol  
Omfattende Flow-support med triggere, betingelser og handlinger

For husforbrugsdata, solproduktion og dynamiske strømfunktioner skal din V2C Wallbox være korrekt forbundet til din elektriske installation ved hjælp af måleklemmer eller direkte til din solinverter, og dynamisk tilstand skal være aktiveret.  
Appen kommunikerer med wallboxen via HTTP-kommandoer på dit lokale netværk, så både Homey og V2C wallboxen skal være på samme netværk. For pålidelig drift anbefales det at tildele en statisk IP-adresse til din wallbox.  
Kontrolhandlinger kan bruges i to tilstande:

Med dynamisk tilstand aktiveret - understøtter min/maks intensitetsindstillinger og forskellige strømmodi (FV eksklusiv, FV+Min strøm, Net+FV)  
Uden dynamisk tilstand - understøtter direkte intensitetskontrol og basal opladningsstyring

Testet på V2C Trydan-oplader og bør være kompatibel med alle V2C-oplader modeller på grund af ensartede specifikationer.  
Bemærk: Alle funktioner kræver korrekt netværksopsætning og konfiguration. Nogle avancerede funktioner er afhængige af korrekt installation af måleklemmer og tilslutning til solinverter, hvis det er relevant.
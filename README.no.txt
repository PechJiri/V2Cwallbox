Appen gir omfattende kontroll og overvåking av din V2C Wallbox-lader gjennom Homey sin grensesnitt. Den henter detaljerte sanntidsdata om ladestatus, kjøretøytilkobling, strømforbruk, og muliggjør avansert kontroll gjennom Homey-flows. 
Nøkkelfunksjoner inkluderer:

Sanntidsovervåking av ladestatus, strømforbruk og kjøretøytilkobling
Måneds- og årsstatistikk for energiforbruk
Avanserte kontrollmuligheter (pause/fortsett lading, låse/åpne, intensitetsinnstillinger)
Dynamisk strømstyring med flere operasjonsmoduser
Overvåking av husets strømforbruk og solproduksjon (krever installasjon av måleklemmer)
Intuitiv dashboard-widget for rask statusoversikt og kontroll 
Omfattende Flow-støtte med utløser, betingelser, og handlinger

For data om husforbruk, solproduksjon, og dynamiske strømfunksjoner, må din V2C Wallbox være skikkelig koblet til din elektriske installasjon ved bruk av måleklemmer eller direkte til din solinverter, og dynamisk modus må være aktivert. 
Appen kommuniserer med laderen via HTTP-kommandoer på ditt lokale nettverk, så både Homey og V2C wallbox må være på samme nettverk. For pålitelig drift, anbefales det å tildele en statisk IP-adresse til laderen din. 
Kontrollhandlinger kan brukes i to moduser:

Med dynamisk modus aktivert – støtter minimum/maksimum intensitetsinnstillinger og ulike strømmoduser (FV Eksklusiv, FV+Min Strøm, Nett+FV)
Uten dynamisk modus – støtter direkte intensitetskontroll og grunnleggende ladestyring

Testet på V2C Trydan-lader og bør være kompatibel med alle V2C ladermodeller på grunn av enhetlige spesifikasjoner.
Merk: Alle funksjoner krever riktig nettverksoppsett og konfigurasjon. Noen avanserte funksjoner er avhengige av riktig installasjon av måleklemmer og tilkobling til solinverter hvis aktuelt.
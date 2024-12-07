Appen ger omfattande kontroll och övervakning av din V2C Wallbox-laddare genom Homeys gränssnitt. Den hämtar detaljerad information i realtid om laddningsstatus, fordonsanslutning, strömförbrukning och möjliggör avancerad kontroll via Homey-flöden.
Viktiga funktioner inkluderar:

Övervakning i realtid av laddningsstatus, strömförbrukning och fordonsanslutning
Uppföljning av månads- och årsstatistik för energiförbrukning
Avancerade kontrollfunktioner (pausa/återuppta laddning, lås/lås upp, justering av intensitet)
Dynamisk energihantering med flera driftslägen
Övervakning av husets strömförbrukning och solproduktion (kräver installation av mätklämmor)
Intuitiv instrumentpanelwidget för snabb statusöversikt och kontroll
Omfattande Flow-stöd med triggers, villkor och handlingar

För husförbrukningsdata, solproduktion och dynamisk energifunktionalitet måste din V2C Wallbox vara korrekt ansluten till din elektriska installation med mätklämmor eller direkt till din solcellsväxelriktare, och dynamiskt läge måste vara aktiverat.
Appen kommunicerar med wallboxen via HTTP-kommandon på ditt lokala nätverk, så både Homey och V2C wallbox måste vara på samma nätverk. För tillförlitlig drift rekommenderas att tilldela en statisk IP-adress till din wallbox.
Kontrollåtgärder kan användas i två lägen:

Med dynamiskt läge aktiverat - stöder min/max-intensitetsinställningar och olika driftslägen (FV Exklusiv, FV+Min Styrka, Nät+FV)
Utan dynamiskt läge - stöder direkt intensitetskontroll och grundläggande laddhantering

Testad på V2C Trydan-laddare och bör vara kompatibel med alla V2C-laddarmodeller tack vare enhetliga specifikationer.
Notera: Alla funktioner kräver korrekt nätverksinställning och konfiguration. Vissa avancerade funktioner är beroende av korrekt installation av mätklämmor och anslutning till solcellsväxelriktare om tillämpligt.
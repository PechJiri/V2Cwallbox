De app biedt uitgebreide controle en monitoring van je V2C Wallbox oplader via Homey's interface. Het haalt gedetailleerde realtime gegevens op over de laadstatus, voertuigverbinding, energieverbruik en maakt geavanceerde controle mogelijk via Homey flows.
Belangrijkste functies zijn:

Realtime monitoring van laadstatus, energieverbruik en voertuigverbinding
Maandelijkse en jaarlijkse energie statistieken bijhouden
Geavanceerde bedieningsmogelijkheden (pauzeren/hervatten laden, vergrendelen/ontgrendelen, intensiteitsinstellingen)
Dynamisch energiebeheer met meerdere bedieningsmodi
Monitoring van energieverbruik en zonneproductie in huis (vereist installatie van meetklemmen)
Intuïtieve dashboard widget voor snel statusoverzicht en bediening
Uitgebreide Flow-ondersteuning met triggers, condities en acties

Voor gegevens over energieverbruik in huis, zonneproductie en dynamische energiekenmerken moet je V2C Wallbox goed verbonden zijn met je elektrische installatie met behulp van meetklemmen of rechtstreeks aan je zonne-omvormer, en de dynamische modus moet ingeschakeld zijn.
De app communiceert met de wallbox via HTTP-commando's op je lokale netwerk, dus zowel Homey als de V2C wallbox moeten op hetzelfde netwerk zitten. Voor betrouwbare werking is het aan te raden om een statisch IP-adres aan je wallbox toe te wijzen.
Controleacties kunnen in twee modi worden gebruikt:

Met ingeschakelde dynamische modus - ondersteunt minimum/maximum intensiteitsinstellingen en verschillende energiemodi (FV Exclusief, FV+Min Kracht, Net+FV)
Zonder dynamische modus - ondersteunt directe intensiteitscontrole en basis laadbeheer

Getest op de V2C Trydan oplader en zou compatibel moeten zijn met alle V2C opladermodellen vanwege de uniforme specificaties.
Opmerking: Alle functies vereisen een juiste netwerkinstelling en configuratie. Sommige geavanceerde functies zijn afhankelijk van de juiste installatie van meetklemmen en de aansluiting op een zonne-omvormer indien van toepassing.
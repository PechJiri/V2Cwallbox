L'app offre un controllo completo e monitoraggio del tuo caricabatterie V2C Wallbox tramite l'interfaccia di Homey. Fornisce dati dettagliati in tempo reale sullo stato della ricarica, connessione del veicolo, consumo di energia e consente un controllo avanzato tramite i flussi di Homey.  
Le caratteristiche principali includono:

Monitoraggio in tempo reale dello stato di ricarica, consumo di energia e connessione del veicolo
Tracciamento delle statistiche energetiche mensili e annuali
Capacità di controllo avanzato (pausa/ripresa della ricarica, blocco/sblocco, impostazioni di intensità)
Gestione dinamica della potenza con modalità operative multiple
Monitoraggio del consumo energetico della casa e produzione solare (richiede l'installazione di pinze di misura)
Widget dashboard intuitivo per un rapido controllo e panoramica dello stato
Ampio supporto Flusso con trigger, condizioni e azioni

Per i dati sul consumo della casa, produzione solare e funzionalità di potenza dinamica, il tuo V2C Wallbox deve essere correttamente collegato alla tua installazione elettrica utilizzando pinze di misura o direttamente al tuo inverter solare e la modalità dinamica deve essere abilitata.  
L'app comunica con il wallbox tramite comandi HTTP sulla tua rete locale, quindi sia Homey che il wallbox V2C devono essere sulla stessa rete. Per un funzionamento affidabile, è raccomandato assegnare un indirizzo IP statico al tuo wallbox.  
Le azioni di controllo possono essere utilizzate in due modalità:

Con modalità dinamica abilitata - supporta impostazioni di intensità minima/massima e varie modalità di potenza (FV Esclusivo, FV+Min Potenza, Rete+FV)
Senza modalità dinamica - supporta controllo diretto dell'intensità e gestione di base della ricarica

Testato sul caricabatterie V2C Trydan e dovrebbe essere compatibile con tutti i modelli di caricabatterie V2C grazie a specifiche unificate.  
Nota: Tutte le funzionalità richiedono una corretta configurazione della rete e della configurazione. Alcune funzioni avanzate dipendono dall'installazione corretta delle pinze di misura e dalla connessione all'inverter solare se applicabile.
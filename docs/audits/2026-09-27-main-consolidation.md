# Sjednocení větví a nové výchozí doporučení

27. 9. 2026. Tento dokument aktualizuje závěry auditu po začlenění `codex/voltage-energy-settings`, commit `5a11b1507160f1d1f54c5084f2bf91dbbb392818`, aplikace **2.0.4**.

## Rozsah sjednocení

- Lokální `main` byl na `8b7bbd9`, vzdálený `main` na `f052bb7` (2.0.2).
- Dokončená větev `codex/voltage-energy-settings` obsahovala dalších 18 commitů nad lokálním `main`. Všechny byly začleněny přímým posunutím `main`, bez řešení konfliktů a přepisování historie.
- Dva auditní dokumenty z této konverzace byly dosud nesledované. Jsou zachovány jako historický audit verze 2.0.2 s upozorněním na toto nové vyhodnocení.
- Nové opravy widgetu nebo další funkce nejsou součástí úklidu. Sjednocení dokončené práce není tvrzením, že aplikace nemá zbývající chyby.

## Odkud vznikla větev Clauda

`claude/analyze-homey-app-6s8Sw` ukazuje na `8bead717d5d3d44904b275879af5f51bb9566f25`. Commity mají autora Claude a pocházejí ze 17. 4. 2026. Obsahují tehdejší EV integraci, session funkce, widgety a jejich redesign.

GitHub zaznamenává [PR #2 — Widgety: V2C brand redesign s animacemi](https://github.com/PechJiri/V2Cwallbox/pull/2), založený účtem `PechJiri` 17. 4. 2026 v 11:20:59 UTC a sloučený v 11:21:12 UTC. Merge commit je `440217ef278afbc33c944ee981523869c2ca6458`; jeho strom odpovídá commitu `fa4ec90`. Poslední commit `8bead71` s kruhovým ukazatelem výkonu malého widgetu přišel až poté, v 11:26:47 UTC.

Současná historie aplikace pokračovala od společného základu jinak: `37efd8f` zavedl upravenou integraci ve verzi 1.6.0 a `5660b60` následně provedl výslovný přepis pro systémové EV capabilities ve verzi 2.0.0. Proto Git nevidí starou Claude větev jako běžně začleněnou, i když části jejího řešení pozdější implementace převzala nebo nahradila.

Uživatel následně výslovně rozhodl tuto větev pouze smazat. Vzdálená větev byla odstraněna bez sloučení do `main`; její obsah ani historie nebyly při úklidu přeneseny do současné implementace. Smazání bylo podmíněno očekávanou hodnotou reference `8bead71`, aby se neodstranily případné nové souběžně přidané commity. Nevznikla další archivní větev ani tag.

## Co už novější verze obsahuje

| Oblast | Stav v 2.0.4 | Dopad na předchozí doporučení |
| --- | --- | --- |
| Energie při pauze a pokračování | Uchovává nejvyšší platnou hodnotu relace a jednorázově ji zúčtuje při odpojení; operace jsou serializované. | Původní F18 s opakovaným přičítáním čítače nepopisuje současnou implementaci. |
| Obnova energetických součtů | Připravená transakce s absolutními cíli umožňuje opakování po částečném selhání bez dalšího přičtení stejné relace. | Před rozsáhlým návrhem nového energetického modelu nejprve vyhodnotit tento model. |
| První vzorek nabíjení | Neodečítá se jako začáteční baseline starým způsobem. | Původní příčina F20 je odstraněna; konec relace a reset čítače stále vyžadují vlastní scénáře. |
| Elektroměr pro Homey | Používá systémové `measure_power` a `meter_power`, při inicializaci nastaví uložený lifetime součet nebo nulu. | Základní integraci nepřidávat podruhé. |
| Ruční opravy energie | Původní karta zachována, přibyla možnost lifetime a serializace oprav součtů. | Je to lokální účetnictví aplikace, nikoli reset čítače wallboxu. |
| Proud a napětí fází L1–L3 | Přidáno šest systémových subcapabilities, mapování HTTP údajů a názvy pro již spárovaná zařízení. | Z předchozího seznamu nových funkcí vyřadit „teprve přidat měření fází“. |
| Instalační napětí | Pokročilé nastavení s hodnotami 220/230/240/380/400/415 V, návazností na typ napětí a místní migrací bez zápisu při upgradu. | Neplánovat jako chybějící funkci; samostatně posoudit použití napětí ve výpočtech. |
| Obecné výpočtové Flow | Stále pracují s vlastními explicitními vstupy; `set_power` je zvlášť ovládací karta. | Ponechat samostatné použití a kompatibilitu uložených Flow. |

Dokumentace nové implementace je v [Homey Energy and Flows](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/docs/homey-energy-and-flows.md). Součástí původního plánu této větve je záměrné zúčtování energie při odpojení. Průběžné zúčtování by měnilo tento model a vyžaduje samostatné rozhodnutí o výsledném chování.

### Energetické scénáře, které nová implementace ještě nepokrývá

Nový kód je zlepšení proti starému modelu, ale nelze ho označit za ověřený pro každý průběh firmware. Dva konkrétní podmíněné scénáře potvrdil koordinátor nezávislým spuštěním skutečného `EnergyManager` s náhradou úložiště a capabilities:

- Poslední připojený vzorek **0,20 kWh**, následný odpojovací vzorek **0,40 kWh**: započte se **0,20 kWh**. Větev pro odpojení vypořádá uložené maximum dříve, než vyhodnotí aktuální vzorek. Pokud firmware při odpojení vrací vyšší finální hodnotu, poslední část spotřeby se ztratí. Původní F20 je tedy opraven z hlediska odečítání první hodnoty, ale konec relace stále vyžaduje opravu/ověření. Opakovaný odpojovací vzorek nesmí při případné opravě vytvořit další započtení.
- Čítač během nepřerušeného připojení **5 → 0 → 3 kWh**: započte se nejvyšší hodnota **5 kWh**, nikoli součet segmentů **8 kWh**. Model předpokládá čítač kumulativní přes celé připojení. Pokud se v tomto stavu skutečně resetuje například při restartu wallboxu, chybí rozlišení nové části relace od běžného poklesu či opožděného vzorku.

Skutečný výskyt obou průběhů na 2.5.1 nebyl ověřen. Jsou výslovně uvedené jako otevřené podmínky pro následující opravy, nikoli zakryté zelenými testy. Stávající testy předpokládají při odpojení nulový čítač.

### Další omezení ověřená při review změn

- **Počáteční lifetime součet:** při chybějícím nebo neplatném `lifetimeEnergyData` se v nové verzi začíná od nuly. Starší kód se pokoušel součet odhadnout z ročních statistik; ty však nejsou úplným celoživotním čítačem. Nová volba je záměrná a pokrytá testem, nikoli nechtěné zúčtování. Pokud má instalace dříve zobrazené číslo, ale nemá platný uložený lifetime součet, může uživatel po upgradu vidět nový výchozí bod. Zachování jiného autoritativního podkladu je samostatné migrační doporučení; existující platný lifetime součet se zachovává.
- **Chybějící fázová telemetrie:** nová pole nevyrábějí nuly, ale při vynechaném údaji se capability neaktualizuje. Po dřívějším úspěšném měření proto může v Homey zůstat stará hodnota. Je třeba řešit stáří údajů i pro tato pole, zejména po změně firmware. Původní F15 je opraven pro první výskyt chybějících nových fázových údajů, ne pro všechny ostatní doplňkové výkony.
- **Zápis nastavení a potvrzení:** úspěšný zápis instalačního napětí následovaný neúspěšným načtením vrací chybu z `onSettings`. To neznamená, že první zápis neproběhl. Jde o záměrně přísné potvrzení nové cesty; vhodné uživatelské hlášení má odlišit neprovedený příkaz od nepotvrzeného výsledku.
- **Částečné selhání ruční lifetime opravy:** nový helper ukládá hodnotu do persistentního úložiště, potom zapisuje `meter_power` a až nakonec změní in-memory součet. Pokud prostřední krok selže, vrátí `false`, ale uložená hodnota už je nová a součet v paměti zůstává starý. Agent reprodukoval výchozích 12 kWh, požadovaných 42,5 kWh a selhání capability zápisu: v úložišti 42,5, v paměti 12; další běžná aktualizace může znovu zobrazit 12. Trvalé úložiště tím není samo přepsáno zpět, ale zpětná vazba a zobrazený elektroměr jsou nekonzistentní. Při další opravě sjednotit přijetí hodnoty a retry publikace a doplnit test selhání tohoto kroku. Viz [helper](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/lib/EnergyManager.js:547).
- **Selhání uložení průběžného maxima:** `rememberPendingSessionEnergy()` nastaví maximum v paměti před dokončením uložení. Pokud zápis selže, další stejný nebo nižší vzorek se nemusí znovu ukládat; restart před odpojením potom obnoví starší uložené maximum. Je to podmíněná větev chyby úložiště, kterou běžné testy úspěšné persistence nepokrývají. Při další opravě doplnit opakování neúspěšného uložení. Viz [uložení maxima](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/lib/EnergyManager.js:151).

Tyto podmínky nebyly při úklidu řešeny novou změnou runtime. Zelené testy potvrzují testované smlouvy implementace; nejsou důkazem absence všech podmíněných problémů.

## Co stále řešit jako další práci

1. **Widget a příkazy:** F01/F03/F06/F07, správné zařízení, explicitní Start/Pauza, pořadí odpovědí a viditelná chyba. Nezávislé výpočtové karty nejsou součástí problému s výběrem zařízení. Reprodukce opožděné odpovědi a druhého opačného příkazu funguje i na 2.0.4.
2. **Respektování Stop a pořadí startu:** F16/F26 zůstávají; kladný setpoint může přepsat pauzu a odpozastavení předchází nastavení proudu.
3. **Skutečný účinek ovládacích Flow a Repair:** F04/F24 nadále vyžadují cílené opravy. Nová implementace nastavení instalačního napětí je neopravuje automaticky.
4. **API režimy a poruchové stavy:** F02/F05/F12 ověřit a upravit podle původního vymezení. U režimů 2/3 a LogoLED před změnou významu existujících voleb potvrdit kontrakt na 2.5.1.
5. **Náhradní napětí:** F17 zůstává. `_applyTargetPower()` i přes nové nastavení používá při chybějící telemetrii stále 230 V; to není správná univerzální náhrada pro L-L. Oprava má zachovat explicitní parametry samostatných kalkulaček.
6. **Stáří dat a další odolnost:** původní problémy F09–F11/F13–F15, lifecycle F22/F23 a IP F27 dále posoudit v aktuálním kódu. Měsíční porovnání F21 stále nemá celý rok-měsíc.

F08 zůstává návrhem lepšího vysvětlení stavu, nikoli automatického rušení zámku nebo strategie. F25 je nadále vyřazen — CLI podporuje současný zápis kategorie. F28 neřešit přepisováním identity již spárovaných zařízení. F29 je drobné zpřístupnění chybového tokenu, nikoli důkaz nefunkčního triggeru.

### Převod všech původních nálezů na aktuální verzi

| Původní položka | Výsledek na `5a11b15` / 2.0.4 |
| --- | --- |
| F01 — widget a zařízení | Otevřené; dopad na jiné zařízení vyžaduje více wallboxů. |
| F02 — režimy 2/3 | Otevřený rozpor s HTTP tabulkou; před změnou ověřit 2.5.1. |
| F03 — Flow a zařízení | Otevřené pro karty pracující se zařízením; samostatné kalkulačky nejsou dotčené. |
| F04 — nastavení bez účinku | Otevřené u uvedených dynamických/proudových Flow a Repair. |
| F05 — poruchové stavy | Otevřené. |
| F06 — inverze akce widgetu | Otevřené, znovu reprodukováno v kombinaci s F07. |
| F07 — opožděné odpovědi | Otevřené, znovu reprodukováno. |
| F08 — další blokátory | UX doporučení, nikoli automatické odstranění zámku/plánu. |
| F09 — cache a polling | Otevřené; strict refresh nové voltage cesty cache předem vyčistí, běžnou vazbu TTL/timeout neřeší. |
| F10 — pozdní offline | Otevřené. |
| F11 — HTTP status | Otevřené. |
| F12 — LogoLED | Otevřený kontrakt k ověření na firmware. |
| F13 — povinná verze | Otevřené podmíněné; absence na 2.5.1 není doložena. |
| F14 — převod booleanů | Otevřené podmíněné, nižší priorita. |
| F15 — chybějící měření | Otevřené pro původní House/FV/Battery/signal údaje; nová fázová pole mají vlastní null/finite politiku. |
| F16 — Stop přepsaný cílem | Otevřené. |
| F17 — náhradní napětí | Otevřené; nové pokročilé nastavení samo výpočet neopravilo. |
| F18 — dvojí započtení přes pauzu | Původní reprodukovaná cesta odstraněna. Ověřit předpoklad kumulativního čítače přes celé připojení. |
| F19 — elektroměr až při konci | Záměrný současný model, případné průběžné zúčtování odloženo k samostatnému návrhu. |
| F20 — odečtený první vzorek | Původní příčina odstraněna; nezapočtený vyšší odpojovací vzorek zůstává podmíněnou mezerou. |
| F21 — rok a měsíc | Otevřené, nižší priorita pro dlouhou mezeru provozu. |
| F22 — doběhnutí po smazání | Otevřené, lifecycle údržba. |
| F23 — init po neplatné IP | Otevřené podmíněné. |
| F24 — výkonový práh | Otevřené; argument podmínky se nezměnil. |
| F25 — category | Vyřazeno; CLI podporuje pole i řetězec. |
| F26 — start před proudem | Otevřené. |
| F27 — IPv4 s úvodní nulou | Otevřené. |
| F28 — IP jako identita | Migrace odložena; existující ID nepřepisovat při úklidu. |
| F29 — chybový token | Otevřené, malé rozšíření s nižší prioritou. |

## Ověření sjednocené implementace

- `node --test`: **54/54** testů prošlo.
- Syntaktická kontrola **14 JavaScript souborů**, parsování **46 JSON souborů** a strukturální porovnání vygenerovaného manifestu s `5a11b15` prošly.
- `homey app build`: úspěšný build a validace na úrovni `debug`. První pokus narazil na přechodný `EBUSY` při kopírování souboru v pracovním adresáři; samostatné opakování uspělo.
- `homey app validate --level publish`: prošlo. Tento příkaz aplikaci nepublikoval do Homey Store.
- Samostatná kontrola skutečných Flow handlerů potvrdila výpočet 10 A / 1 A bez čtení nastavení či měření wallboxu a bez příkazu; ovládací `set_power` naproti tomu zapisuje `Intensity=10`.
- Během kontroly nebyl ovládán skutečný wallbox ani provedeno hardwarové ověření firmware 2.5.1.

Přezkoumání provedlo deset agentů `gpt-6-luna` s reasoning effort `max`: energetická matematika, persistence, napětí, telemetrie, manifest/SDK, Flow, původ Claude větve, widgety, testy a aktualizace starého auditu. Koordinátor nezávisle ověřil společné testy, manifest, výpočtové karty, opožděné odpovědi widgetu, dva energetické průběhy a částečné selhání lifetime opravy.

Výsledek review dovoluje sjednotit dokončenou větev bez dalšího přepisu runtime. Nebyl doložen bezpodmínečný blokátor přímého upgradu z existujícího `main` s platnými uloženými součty; uvedené podmíněné scénáře a chyby dílčích zápisů jsou otevřené pro následující opravy. Sloučení větve na GitHubu neznamená nové vydání aplikace do Homey Store.

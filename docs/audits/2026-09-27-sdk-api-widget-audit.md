# Audit Homey SDK, V2C HTTP API a widgetu — 27. 9. 2026

> **Historický audit verze 2.0.2 (`8b7bbd9`).** Po sjednocení větví je aktuálním základem 2.0.4 (`5a11b15`). Novější energetický model a měření fází tento audit nezahrnuje. Pro další práci použij [aktualizaci po sjednocení main](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/docs/audits/2026-09-27-main-consolidation.md); zejména staré reprodukce F18/F20 nelze vydávat za ověření aktuálního kódu.

> **Po následném review:** Pro rozhodnutí o práci použij [přezkoumaná doporučení s uživatelským vysvětlením](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/docs/audits/2026-09-27-reviewed-recommendations.md). F25 je vyřazen jako nepotvrzený problém: nainstalované CLI pole kategorií výslovně podporuje. F03 platí pro karty pracující se zařízením, nikoli čisté výpočty. F08 je zlepšení srozumitelnosti ovládání, nikoli požadavek na automatické odstranění všech překážek nabíjení. F02/F12 vyžadují před změnou chování ověření kontraktu na firmware 2.5.1.

Audit se týká revize `8b7bbd9`, aplikace Homey `2.0.2` a firmware Trydan `2.5.0` / `2.5.1`. Uživatel během auditu potvrdil přechod z 2.5.0 na 2.5.1. Počet spárovaných wallboxů nebyl potvrzen.

Práci provedlo deset paralelních agentů `gpt-6-luna`, každý s reasoning effort `max`, a koordinátor, který nezávisle ověřil klíčové nálezy. Oblasti: frontend widgetu, backend widgetu, HTTP transport, řízení zařízení, polling a lifecycle, energie, validace telemetrie, Flow a párování, Homey SDK a nové funkce.

Kód aplikace se během auditu neměnil. Reprodukce používají stuby Homey, DOM a HTTP odpovědí; neposílají příkazy skutečnému wallboxu. Potvrzená chyba kódu není automaticky důkazem, že právě ona způsobila konkrétní uživatelův neúspěšný pokus o spuštění. K tomu chybí časově spárovaný záznam z widgetu a skutečného zařízení.

## Hlavní výsledky

| Oblast | Závěr | Položky |
| --- | --- | --- |
| Widget start | Staré Resume a opakovaný klik mohou poslat pause po úspěšném startu; reprodukováno pro jedno zařízení. | F06/F07 |
| Více wallboxů | Widget i vlastní Flow mohou směrovat příkazy na jiné než vybrané zařízení. | F01/F03 |
| Nabíjecí strategie | FV exclusive a FV+minimum mají proti HTTP tabulce prohozené kódy. | F02 |
| Stop/start | Debounced stop může přepsat kladný setpoint; start před nastavením proudu má riziko částečného selhání. | F16/F26 |
| Energie | V reprodukci s pauzou/resume 0,40 kWh skončilo jako 0,90 kWh; meter se aktualizuje až při konci session. | F18/F19 |
| Nastavení/Repair | Některé Flow i Repair ukládají nastavení bez potřebného runtime/HTTP účinku. | F04 |
| Diagnostika | Chybové stavy jsou maskované/odmítnuté a výpadek se hlásí pozdě. | F05/F10 |
| Nové funkce | Nejjednodušší je dokončení timer ovládání a přidání šesti per-phase měření. | Tabulka příležitostí níže |

Původních 29 položek zahrnuje potvrzené chyby, rozdíly proti dokumentaci i výslovně označené podmíněné scénáře. Po následném review je F25 vyřazen. Nejde o 29 chyb ověřených na skutečném hardware ani o 29 samostatných implementačních úkolů.

## Aktuální zdroje

- [Homey Apps SDK](https://apps.developer.homey.app/) a [index dokumentace](https://apps.developer.homey.app/llms.txt).
- [Widget SDK](https://apps.developer.homey.app/the-basics/widgets.md), [výběr zařízení widgetu](https://apps.developer.homey.app/the-basics/widgets/settings.md), [Homey Energy](https://apps.developer.homey.app/the-basics/devices/energy.md) a [Node.js 22](https://apps.developer.homey.app/upgrade-guides/node-22.md).
- [V2C aktualizace](https://v2charge.com/updates/): nejnovější Trydan 2.5.1 z 9. 9. 2026; 2.5.0 z 14. 7. 2026 a relevantní HTTP změny ve 2.4.4 / 2.4.0.
- [Veřejná V2C HTTP specifikace](https://docs.google.com/spreadsheets/u/1/d/e/2PACX-1vQGA_7Z4YaSMZeHRTnAP6z_82dVPmM33NxJhvsDBEFn8LyWjX-RX_fkR7KCErqAE4aGFvPrUufooHoM/pubhtml#gid=1147522182), revize 14. 7. 2026, načtená přes [CSV export stejného listu](https://docs.google.com/spreadsheets/d/e/2PACX-1vQGA_7Z4YaSMZeHRTnAP6z_82dVPmM33NxJhvsDBEFn8LyWjX-RX_fkR7KCErqAE4aGFvPrUufooHoM/pub?gid=1147522182&single=true&output=csv).

Dokument `docs/http-api-coverage.md` vychází ze staršího PDF s revizí 4. 5. 2026. Při rozdílech v tomto auditu používáme aktuální zveřejněný HTTP list. Příklady a tabulka ani v něm nejsou dokonale konzistentní: příklad obsahuje `IntensityMeasure_L1y`, tabulka definuje `IntensityMeasure_L1`. Odpovědi nových parametrů je proto potřeba ověřit na firmware 2.5.1.

## Význam priorit a důkazů

- **P1:** opravit před přidáváním dalších ovládacích funkcí; nesprávný příkaz, zařízení nebo energetická data.
- **P2:** zhoršená spolehlivost, diagnostika nebo správnost méně časté cesty.
- **P3:** údržba, zjednodušení a menší UX nedostatky.
- **Reprodukce:** izolovaný běh skutečného kódu s řízenými vstupy.
- **Staticky potvrzeno:** cesta je doložená kódem nebo konkrétním rozdílem proti specifikaci.
- **Podmíněné:** dopad závisí na skutečném payloadu či chování firmware; hardware ho během auditu nepotvrdil.

## Výsledky ověřování

- Node.js `v22.21.0`; `node --test`: 7/7 existujících testů prošlo.
- `node --check`: 13 JavaScript souborů bez syntaktické chyby.
- Parsování 48 JSON souborů prošlo. První pokus přes PowerShell bez `-AsHashtable` narazil na platný prázdný klíč; následné parsování s podporou tohoto klíče uspělo.
- Nezávislé reprodukce potvrdily nesprávné směrování widgetu při více zařízeních, chybové stavy 4/5/6, odmítnutí payloadu bez `FirmwareVersion`, převod řetězce `"0"` na `true` a přijetí HTTP 503 s JSON tělem.

Sedm zelených testů nepokrývá widget, více wallboxů, energii ani skutečný HTTP kontrakt. Test LED přímo očekává `LogoLED=42`, přestože současná HTTP tabulka pro tento klíč uvádí pouze 0/1.

## Nálezy, podmíněná rizika a doporučení

### F01 — P1 — Widget může ovládat jiný wallbox

[Backend výběru zařízení](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/widgets/wallbox-status/api.js:15) porovnává příchozí `deviceId` s `device.getData().id`. [Párování](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/drivers/v2c-wallbox/driver.js:81) tam ukládá IP wallboxu. Widget ovšem získává Homey ID přes `Homey.getDeviceIds()`. Pokud nenajde shodu, tiše zvolí první zařízení, a to i tehdy, když uživatel explicitně vybral jiné.

**Reprodukce:** dva stuby zařízení A/B, požadavek s Homey ID B; skutečný backend zavolal `setParameter('Paused','0')` na A. S jedním zařízením fallback obvykle skryje chybu, proto tento nález sám nevysvětluje všechny neúspěšné starty.

**Náprava:** směrovat podle Homey ID, případně použít dokumentovaný resolver SDK; explicitně neplatné nebo odstraněné zařízení odmítnout. Fallback ponechat pouze pro starou instanci bez výběru a jednoznačnou situaci s jedním zařízením. [Kontrakt výběru widgetu](https://apps.developer.homey.app/the-basics/widgets/settings.md).

### F02 — P1 k ověření na zařízení — Solární režimy 2/3 odporují HTTP tabulce

[Obě mapování](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/lib/constants.js:125) a číselné volby nastavení používají `2 = FV Exclusive`, `3 = FV + Min`. Aktuální HTTP tabulka definuje `2 = Min Power`, `3 = Exclusive`. Volba výhradního solárního nabíjení tedy podle kontraktu aktivuje režim s minimálním výkonem; opačná volba udělá opak. Chybně je i zobrazený readback.

**Důkaz:** statické porovnání obou směrů mapování, capability titulů, nastavení a HTTP tabulky. **Náprava:** opravit oba směry, číselné popisky a Flow volby. Před migrací uložených nastavení rozlišit uložený číselný kód a historický uživatelský záměr; automatické přepsání bez tohoto rozlišení může opět změnit skutečný režim. Režim `1` je navíc ve stejné specifikaci označen jako deprecated.

**Upřesnění po review:** před změnou významu voleb ověřit vazbu známého režimu z oficiálního rozhraní na přečtený kód HTTP na 2.5.1. Tabulka obsahuje i jiné nekonzistence, proto samotné porovnání s ní nepotvrzuje fyzické chování wallboxu. Starý režim 1 nepřemapovávat ani neodstraňovat existující Flow pouze kvůli označení deprecated.

### F03 — P1 — Flow karty mohou pracovat s posledním inicializovaným zařízením

[Registrace akcí](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/drivers/v2c-wallbox/FlowCardManager.js:462) probíhá pro každé zařízení nad společnými Flow kartami. Callbacky většinou zavírají `this.device` a ignorují `args.device`. Podmínky mají stejný vzor na řádku 208. Přeregistrace druhým zařízením může přesměrovat akci pro první zařízení na druhé; výjimkou jsou některé energetické akce, které `args.device` již používají.

**Náprava:** registrace jednou na úrovni app/driver a použití zařízení z argumentu Flow tam, kde karta skutečně čte nebo ovládá zařízení. Přidat test dvou zařízení pro příkazy, podmínky a trigger filtry. Pouhé odstranění duplicitních listenerů neřeší špatný výběr zařízení. Čisté `calculate_power_with_buffer` a `compare_calculated_current` zařízení pro svůj výsledek nepotřebují; jejich nezávislost, vstupy a výstupní tokeny zachovat. Také `set_energy_counter` záměrně mění lokální statistiky, nikoli wallbox.

### F04 — P1 — Některé Flow a Repair změní nastavení bez změny wallboxu

[Flow akce](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/drivers/v2c-wallbox/FlowCardManager.js:278) `set_dynamic`, `set_dynamic_power_mode`, `set_min_intensity` a `set_max_intensity` volají pouze `setSettings()`. Homey po programovém `setSettings()` nespouští `onSettings()`. Proto se neprovedou související HTTP zápisy. [Repair](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/drivers/v2c-wallbox/driver.js:131) má přímo opačný předpoklad v komentáři: uloží novou IP, ale existující runtime klient dál používá starou IP až do reinicializace.

**Náprava:** sdílené aplikační metody, které provedou validaci, HTTP příkaz nebo výměnu klienta, uloží nastavení a obnoví stav. Použít je z UI nastavení, Flow i Repair. Správný příklad již existuje v `setInstallationPhaseMode()`, který provádí side effects explicitně.

### F05 — P1 — Poruchové stavy se ztrácejí nebo zastaví aktualizace

[Validátor](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/lib/DataValidator.js:186) převádí číselný `ChargeState=4` na odpojení. Stavy `5` a `6` nejsou v konstantách ani akceptovaném schématu. HTTP tabulka tyto stavy popisuje jako poruchu/únik, chybu CP/zemnění a požadavek ventilace.

**Reprodukce:** validní payload se stavem 4 → `chargeState='0'`; stav 5/6 → `null`. Widget proto může zobrazit „Idle“ nebo ponechat poslední známý stav. Úspěšný JSON fetch zároveň resetuje transportní čítač; chyby následné validace samy nedosáhnou větve `API_MAX_ERRORS_EXCEEDED`. Chyba telemetrie tak může dlouhodobě zůstat bez connection alarmu.

**Náprava:** zachovat všechny dokumentované stavy, oddělit poruchu zařízení od nedostupnosti sítě a zobrazit samostatný alarm/Flow událost. Poruchu nepřevádět na běžné odpojení ani ji automaticky řešit restartem nabíjení.

### F06 — P2 — Widget přepíná stav místo provedení zobrazené akce

[Click handler](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/widgets/wallbox-status/public/index.html:499) po kliknutí načte další stav a pošle jeho inverzi. Pokud tlačítko zobrazovalo Resume, ale mezitím jiný controller nabíjení odpozastavil, čerstvý GET vrátí `paused=false` a tento klik pošle `paused=true`. Uživatelský pokus o start se tak může změnit na pauzu. GET navíc čte capability cache Homey, nikoli přímo wallbox.

**Náprava:** posílat explicitní požadovaný stav podle akce, kterou uživatel stiskl; start má být idempotentní. Konflikt s novějším stavem řešit synchronizací nebo viditelným výsledkem, ne další inverzí. Dopad je podmíněn změnou mezi zobrazením tlačítka a jeho obsluhou.

### F07 — P2 — Úspěšný příkaz neznamená aktuální widget

[Refresh](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/widgets/wallbox-status/public/index.html:471) při probíhajícím GET prostě skončí. Click handler po POST čeká 400 ms a poté zavolá právě tento refresh; může tedy čekat na funkci, která nic neudělá. Starý GET může následně překreslit widget starými daty. Chyby POST jsou navíc pouze v konzoli na řádku 513, uživatel nevidí důvod neúspěchu.

**Náprava:** po příkazu zajistit nevynechanou obnovu, označit pořadí odpovědí a ignorovat odpovědi starší než daný příkaz. Zobrazit probíhající akci a její výsledek, včetně chyby. Tento problém prokazuje chybnou zpětnou vazbu; sám o sobě nedokazuje, že wallbox příkaz nepřijal.

**Nezávisle spuštěná reprodukce F06+F07:** VM skutečného frontend skriptu, jeden wallbox a opožděný GET. První klik poslal `paused=false` a uspěl. Opožděný GET obnovil staré „Resume“. Druhý klik na toto tlačítko poslal `paused=true`. Výsledek: příkazy `[false,true]`, konečný stav opět pozastavený. Jde o konkrétní cestu, kterou opakovaný pokus o start může nabíjení znovu zastavit, i když první příkaz byl v pořádku.

### F08 — UX doporučení — Resume potřebuje srozumitelnější výsledek

[Backend příkazu](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/widgets/wallbox-status/api.js:64) zapisuje pouze `Paused=0` a nastaví `evcharger_charging=true`. Stav pro widget neobsahuje `Locked`, `Timer`, `DynamicPowerMode`, `PauseDynamic` ani důvod čekání. Přímo doložený blokátor je `Locked=1`, tedy deaktivovaný charge point; příkaz Resume ho nemění. Vliv rozvrhu, stop/PV režimu a modulace je další větev k ověření na hardware. Není správné tyto volby potají vypínat jen kvůli kliknutí.

**Náprava:** sdílená cesta pro explicitní pause/resume, potvrzení readbackem a jasné rozlišení „povoleno nabíjení“ / „skutečně nabíjí“. Ve widgetu zobrazit známý blokátor; nabídnout oddělený explicitní ovládací prvek, pokud uživatel chce změnit zámek, časovač či strategii.

**Upřesnění po review:** Samotné zachování zámku, časovače nebo solární strategie není chyba. Stav `Timer=1` sám nedokazuje, že právě časovač brání nabíjení. Widget má ukázat známé nastavení a skutečný stav, nikoli vymýšlet jednoznačný důvod čekání.

### F09 — P2 — Pětisekundový polling ve skutečnosti aktualizuje přibližně po 10 s

[Cache shortcut](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/drivers/v2c-wallbox/device.js:469) používá šestisekundový HTTP timeout jako TTL. Charging interval je pět sekund. Tick po pěti sekundách vrátí cache a neaktualizuje capabilities; další skutečný fetch nastane typicky po deseti sekundách. Stejný shortcut může spolknout jednorázový refresh po změně nastavení či fáze.

**Náprava:** oddělit timeout od platnosti cache, umožnit vynucený refresh a sdílet jeden probíhající fetch. Běžné intervalové i přímé volání mají používat stejný mechanismus; `_isProcessing` dnes chrání pouze timer callback.

### F10 — P2 — Nedostupnost se hlásí velmi pozdě

[Runtime error handling](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/drivers/v2c-wallbox/device.js:512) nastaví connection alarm až po dvaceti transportních chybách. Mezitím exponential backoff dosáhne pěti minut; nepřetržitý výpadek tak může být viditelný až po více než hodině. Runtime chyby ani nevolají `setUnavailable()`. Widget čte staré capabilities a nemusí poznat, že jsou dlouho neaktuální.

**Náprava:** sledovat stáří posledního validního snapshotu, oddělit stale/offline stav od retry intervalu a rychleji zobrazit nedostupnost. Backoff ponechat pro snížení zátěže; nemá určovat, jak dlouho uživatel nevidí problém. Zahrnout také chyby validace, nikoli jen odmítnuté HTTP požadavky.

### F11 — P2 — HTTP read ignoruje neúspěšný status

[Čtení API](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/drivers/v2c-wallbox/api.js:78) volá `response.json()` a vrací výsledek bez kontroly `response.ok`. Jakýkoli parsovatelný JSON může resetovat čítač transportních chyb i při HTTP 503.

**Reprodukce:** stub HTTP 503 s platným JSON → `_getDataImpl()` vrátí data a změní čítač z 2 na 0. **Náprava:** vyhodnotit status, parsování a minimální schéma odděleně; úspěch evidovat až po validním snapshotu. Nezavádět slepé retry všech zápisů bez rozlišení timeoutu a potvrzeného readbacku.

### F12 — P2 — Logo LED dostává nedokumentované hodnoty

[LED Flow](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/drivers/v2c-wallbox/FlowCardManager.js:355) posílá rozsah 0–100 také pro `LogoLED`; HTTP tabulka uvádí `LogoLED` pouze jako 0/1. Rozsah 0–100 je v ní pro `LightLED`. Aktuální test očekává hodnotu mimo tento dokumentovaný kontrakt pro logo.

**Náprava:** oddělit přepínač loga od jasu displeje. Pokud konkrétní firmware podporuje pro logo více hodnot, musí to být doloženo jeho HTTP kontraktem a testem zařízení. Zmínka o Modbus jasu v release notes tento HTTP kontrakt nedokazuje.

**Upřesnění po review:** nejprve ověřit rozsah na 2.5.1 a stanovit kompatibilní chování stávající karty včetně volby „both“. Bez tohoto kroku kartu neodstraňovat ani potichu neměnit význam uloženého procenta.

### F13 — P2 — Povinná FirmwareVersion není součástí dokumentovaného HTTP minima

[Required fields](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/lib/DataValidator.js:13) vyžadují `FirmwareVersion`, ačkoli aktuální publikovaný realtime příklad a tabulka tento klíč neuvádějí. Jinak validní payload bez verze se odmítne celý.

**Reprodukce:** odstranění pouze `FirmwareVersion` z platného testovacího payloadu → `null`. **Podmíněné:** uživatelův wallbox může klíč běžně poskytovat; audit neprokazuje jeho absenci na 2.5.1. **Náprava:** diagnostickou verzi zpracovat jako volitelnou nebo jasně zdokumentovat konkrétní minimální firmware, který ji zaručuje.

### F14 — P3 — Připravený převod booleanů se nepoužívá

[Boolean mapping](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/lib/DataValidator.js:155) používá `Boolean(rawData.Paused)` a obdobně další přepínače, přestože soubor obsahuje vhodnější `validateBooleanValue()`. Řetězce `"0"` a `"false"` jsou tak pravdivé.

**Reprodukce:** `Paused="0"` → `paused=true`. **Podmíněné:** publikovaný příklad používá číselné hodnoty; není potvrzeno, že firmware 2.5.1 vrací tyto řetězce. **Náprava:** použít jednotný explicitní převod a rozlišit chybějící/neočekávanou hodnotu od platného vypnutí.

### F15 — P2 — Chybějící telemetrie se tváří jako měření

[Numerický převod](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/lib/DataValidator.js:194) vytvoří z chybějícího či null `HousePower`, `FVPower` nebo `BatteryPower` nulu. Neznámý signál se na řádku 223 převádí na první enum „Low“. Samotné schéma přitom pro volitelné výkonové údaje povoluje null. `BatteryPower` navíc není v aktuální HTTP tabulce; nula proto nemusí znamenat, že se baterie skutečně nenabíjí.

**Náprava:** zachovat unavailable/unknown a nevyrábět měření z absence. Konkrétní `BatteryPower` klíč ověřit na zařízení před jakoukoli automatizací podle něj.

### F16 — P1 — Kombinovaný příkaz může zrušit explicitní zastavení

[Debounced listener](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/drivers/v2c-wallbox/device.js:233) zapíše `Paused=1`, pokud dávka obsahuje `evcharger_charging=false`. Poté ale pokračuje v aplikaci kladného `target_power` a `_applyTargetPower()` na řádku 284 zapíše `Paused=0`. Příklad dávky: změna cíle na 6000 W a stop, které dorazí v jednom 500ms okně.

**Reprodukce agenta:** `{target_power_mode:'homey', target_power:6000, evcharger_charging:false}` → `Dynamic=0`, `Paused=1`, `Paused=0`, `Intensity=15`. Explicitní stop je tím přepsán. **Náprava:** jasná priorita explicitního stopu a transakční zpracování jedné dávky; ponechat cíl pro příští start. Homey EV příklad při explicitním `false` ukončuje zpracování po zastavení.

### F17 — P2 — Náhradní napětí neodpovídá konfiguraci L-L

[_applyTargetPower](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/drivers/v2c-wallbox/device.js:262) při nulovém/chybějícím napětí používá 230 V i při `voltage_type='line_to_line'`. Tento režim se však počítá ze sdruženého napětí přibližně 400 V. Nulové `VoltageInstallation` se objevuje i v dokumentovaném realtime příkladu.

**Výpočet:** 6000 W, tři fáze, FLOOR: při L-L 230 V vyjde 15 A, při 400 V 8 A. Pokud později začne nabíjení při skutečných 400 V, první setpoint může znamenat přibližně 10,4 kW místo požadovaných 6 kW. **Podmíněné:** vyžaduje L-L konfiguraci a neplatné/nulové aktuální napětí. **Náprava:** náhradní hodnoty podle typu napětí, nebo odložení setpointu do validního měření; shodný postup i pro opačný výpočet.

### F18 — P1 — Pause/resume může několikanásobně započítat energii

[Zdroj předchozí hodnoty](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/lib/EnergyManager.js:95) bere `lastKnownEnergy` z agregované capability `measure_charge_energy`, ale porovnává ji se surovým session `ChargeEnergy`. [Connected větev](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/lib/EnergyManager.js:193) navíc přičte průběžný session čítač do `baseChargeEnergy`; po resume je čítač přičten znovu. Další normální raw sample pak vypadá jako reset.

**Nezávisle spuštěná reprodukce:** v rámci jedné relace raw 0 → 0,20 kWh, pause/connected, resume 0,30 → 0,31 → odpojení s 0,40. Zobrazená energie po resume skočí na 0,50 a pak na 0,31. Monthly i lifetime skončí na **0,90 kWh místo 0,40 kWh**. Podmínkou je pokračování stejného V2C session čítače přes pauzu, což odpovídá dokumentované session-kumulativní hodnotě; skutečný payload tohoto přechodu ověřit na 2.5.1.

**Náprava:** ukládat předchozí raw sample odděleně od zobrazené session hodnoty, přičítat pouze nové raw přírůstky a každé ukončení/reset vyhodnotit jednou. Nevytvářet další součet z čítače, který je již kumulativní.

### F19 — P2 — Homey Energy dostává spotřebu až při ukončení relace

[Lifetime součet](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/lib/EnergyManager.js:202) se mění jen při resetu nebo odpojení. [Polling](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/drivers/v2c-wallbox/device.js:552) sice zapisuje `meter_power` průběžně, ale většinou se stejnou nezměněnou hodnotou. Přírůstek pak přijde skokem až při ukončení. Vlastní měsíční/roční součty navíc připisují celou relaci do období dokončení.

**Dopad:** relace přes půlnoc nebo konec měsíce nemá správné časové přiřazení; Homey může při výpočtu rozdílů kumulativního elektroměru dostat zkreslený průběh. **Náprava:** aktualizovat monotónní `meter_power` z průběžných raw přírůstků a dělit období podle času sample. Z pouhých dvou měření nelze přesně zrekonstruovat rozdělení během dlouhého offline intervalu; tuto nejistotu zachovat. [Homey Energy](https://apps.developer.homey.app/the-basics/devices/energy.md).

### F20 — P2 — Začátek nabíjení může být odečten ze session energie

[Start baseline](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/lib/EnergyManager.js:163) nastaví `chargingStartEnergy` na první naměřenou hodnotu, která může být nenulová. Odpojení později započítá pouze rozdíl od této hodnoty.

**Nezávisle spuštěná reprodukce:** první charging poll 0,03 kWh, finální session 0,20 kWh při stavu disconnected → měsíční/lifetime součet **0,17 místo 0,20 kWh**. **Podmíněné:** vyžaduje, aby V2C při přechodu na disconnected ještě vracelo finální session hodnotu. **Náprava:** rozlišit skutečnou session nulu od prvního pozorovaného sample a záměr případného počátečního baseline při prvním párování; neodečítat první průběžné kWh každé relace.

### F21 — P2 — Měsíční reset ignoruje rok

[Rollover](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/lib/EnergyManager.js:378) a update porovnávají pouze číslo měsíce. Po celoroční mezeře leden → leden zůstane starý měsíční součet, ačkoli roční součet se resetuje.

**Nezávisle spuštěná reprodukce:** uložený leden 2025 s 42 kWh, další běh v lednu 2026 → měsíční součet stále 42 kWh, roční 0. **Náprava:** používat celý klíč období rok-měsíc. Je to okrajový scénář po dlouhém odstavení nebo obnově starých dat, nikoli chyba každého běžného přechodu prosinec → leden.

### F22 — P2 — Poll může doběhnout do již zrušeného zařízení

[onDeleted](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/drivers/v2c-wallbox/device.js:768) zastaví interval a nastaví závislosti na null, ale nečeká na již spuštěný poll a neruší ho. Jakmile doběhne blokovaný fetch, zpracování a error handler narazí na nulované objekty. Timer callback má `finally`, ale nemá obsluhu odmítnutí celé async operace.

**Reprodukce agenta:** zadržení pollu, `onDeleted()`, následné uvolnění → odmítnutí s přístupem k null loggeru. **Náprava:** lifecycle guard / generace zařízení a bezpečné dokončení nebo zrušení rozpracované operace; obsloužit odmítnutí timer callbacku. Dopad na běh celé app závisí na zacházení runtime s unhandled rejection.

### F23 — P2 — Oprava počáteční neplatné IP nedokončí inicializaci

[onInit](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/drivers/v2c-wallbox/device.js:63) při chybějící/neplatné IP skončí před capability listenery a spuštěním intervalů. Pozdější ruční nastavení platné IP vytvoří klienta a provede jednorázové načtení, ale chybějící listenery/polling nedoregistruje.

**Náprava:** oddělit idempotentní inicializaci běhu zařízení od validace připojení; změna IP má obnovit plně funkční zařízení bez nutnosti restartu aplikace. Vztahuje se na zařízení, která opravdu vstoupila do této init větve, například po migraci nebo poškozeném nastavení.

### F24 — P2 — Výkonové Flow podmínky porovnávají s undefined

[Generic condition callback](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/drivers/v2c-wallbox/FlowCardManager.js:215) předává práh jen z `args.value`. [Manifest výkonových podmínek](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/drivers/v2c-wallbox/driver.flow.compose.json:345) ale definuje argument `power`. Běžné volání proto porovnává výkon s undefined a obě podmínky `power-greater-than` / `power-less-than` vracejí false i při splněném prahu. Tento problém platí i pro jedno zařízení a je nezávislý na F03.

**Náprava:** použít přesný argument deklarovaný danou kartou; ověřit obě porovnání nad a pod prahem a s explicitním `args.device`.

### F25 — Vyřazeno po review — Pole category je podporováno CLI

[Compose manifest](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/.homeycompose/app.json:38) i výsledný `app.json` mají `category: ["energy"]`. Aktuální dokumentace manifestu definuje tuto vlastnost jako řetězec `"energy"`.

**Nové ověření:** nainstalované Homey CLI `4.2.0` s `homey-lib 2.49.1` má ve schématu `category.oneOf` řetězec i pole řetězců a validátor obě varianty explicitně zpracovává. Viz [schéma](C:/Users/jirip/AppData/Roaming/npm/node_modules/homey/node_modules/homey-lib/assets/app/schema.json:1222) a [validátor](C:/Users/jirip/AppData/Roaming/npm/node_modules/homey/node_modules/homey-lib/lib/App/index.js:320). Rozdíl proti stručné [dokumentaci](https://apps.developer.homey.app/the-basics/app/manifest.md) není důkaz chyby aplikace. **Doporučení:** ponechat; neplánovat jako opravu. Toto ověření není tvrzením o provedení celé publikační validace.

### F26 — P1 — Start proběhne před úspěšným nastavením nového proudu

[_applyTargetPower](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/drivers/v2c-wallbox/device.js:284) nejprve zapisuje `Paused=0` a teprve potom `Intensity`. Jestliže je wallbox pozastaven s předchozím vyšším proudem a uživatel nastaví nižší výkon, první příkaz ho odpozastaví ještě se starým proudem. Když druhý HTTP zápis selže, metoda se odmítne, ale předchozí odpozastavení není vráceno zpět.

**Důkaz:** skutečná posloupnost v kódu a ve stub reprodukci; selhání druhého kroku nemá rollback. **Podmíněné:** vyšší skutečný proud / zda EV ihned začne odebírat závisí na stavu wallboxu a auta. **Náprava:** dokončit a potvrdit proudový limit před odpozastavením, případně zvolit explicitní bezpečný stav při částečném selhání. Sdílená fronta má držet celou operaci pohromadě.

### F27 — P2 — Validátor adres a URL parser nesouhlasí na oktetech s nulou

[IP validátor](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/lib/ip_validator.js:26) parsuje oktety jako desítkové hodnoty, ale toleruje úvodní nuly. Nativní URL parser může stejný text vyhodnotit jako oktalové IPv4. Do `fetch()` se předává původní text, nikoli jednotná kanonická hodnota.

**Nezávislá reprodukce bez sítě:** `validateWallboxIP('010.0.0.1')` → `{valid:true}`, ale `new URL('http://010.0.0.1/RealTimeData').hostname` → `8.0.0.1`. Privátní omezení je tak obejitelné a skutečný cíl je jiný než validovaný. **Náprava:** odmítnout nekonvenční oktety nebo používat shodně ověřenou kanonickou adresu v celé cestě. Reprodukce neposlala HTTP požadavek na veřejnou adresu.

### F28 — P2 — Pairing používá proměnlivou IP jako identitu zařízení

[Pairing](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/drivers/v2c-wallbox/driver.js:69) používá `baseSession.IP` jako `data.id`. Po změně IP a opětovném párování může stejný wallbox získat jinou identitu a být nabízen jako nové zařízení.

**Náprava:** pro nové instalace použít stabilní V2C identifikátor, až bude ověřena jeho jedinečnost. Starým zařízením nepřepisovat identitu bez migračního plánu; jejich Flow a historie ji již mohou používat. Repair má zachovat existující zařízení a měnit pouze připojení. [Homey pairing](https://apps.developer.homey.app/the-basics/devices/pairing).

### F29 — P3 — Chybový trigger poskytuje nedeklarovaný token

[triggerSlaveErrorChanged](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/drivers/v2c-wallbox/FlowCardManager.js:539) posílá token `error_description`. [Deklarace karty](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/drivers/v2c-wallbox/driver.flow.compose.json:120) však žádné `tokens` neobsahuje. Uživatel proto nemá deklarovaný token popisu chyby pro navazující Flow.

**Náprava:** deklarovat typovaný token a sladit název/obsah. Nález sám nedokazuje, že se celá trigger karta nespouští; týká se dostupnosti tokenu. [Homey tokens](https://apps.developer.homey.app/the-basics/flow/tokens).

## Co v současném Homey SDK odpovídá

- SDK úroveň `3` je stále aktuálně dokumentovaná; `compatibility >=12.13.0` odpovídá použití `target_power` a `target_power_mode`.
- EV class, `measure_power`, kumulativní `meter_power`, `evcharger_charging` / state a `energy.evCharger` jsou správně zvolené. Problémy F18/F19 jsou v hodnotách a průběhu, nikoli v absenci Homey Energy integrace.
- Vlastní strategie `target_power_mode` obsahují `homey` a další hodnoty; současné SDK dovoluje takto nahradit defaultní `device` hodnotu.
- Widget `devices` selector `type:app`, `singular:true` a `Homey.getDeviceIds()` jsou dokumentované. Chyba je v backend směrování a synchronizaci.
- Cílové Homey běží v generaci Node 22; nativní `fetch` / `AbortSignal.timeout` jsou pro ni dostupné. Aplikace nepoužívá `node-fetch`, takže známý specifický problém tohoto balíčku není automaticky její problém.
- Npm `latest` pro používanou stabilní řadu `homey-apps-sdk-v3-types` je při auditu skutečně `0.3.12`, stejná jako deklarovaná a nainstalovaná verze. Samotné číslo závislosti proto není důkazem zastaralosti. Starší Node typings jsou tooling záležitost při budoucím zavedení typechecku; současná aplikace je JavaScript.

Zdroje: [Homey Energy](https://apps.developer.homey.app/the-basics/devices/energy.md), [capabilities](https://apps.developer.homey.app/the-basics/devices/capabilities.md), [widget settings](https://apps.developer.homey.app/the-basics/widgets/settings.md), [Node 22](https://apps.developer.homey.app/upgrade-guides/node-22.md), [primární npm metadata](https://registry.npmjs.org/homey-apps-sdk-v3-types).

## Závěr k widgetu a ověřování na firmware 2.5.1

Nejsilnější doložená cesta k popsanému symptomu pro jeden wallbox je kombinace **F06+F07**: opožděná odpověď, staré „Resume“ a druhý klik, který znovu pozastaví nabíjení. Na backendu existuje obdobná možnost: starý poll už načetl `Paused=1`, widget mezitím úspěšně zapíše `Paused=0` a optimisticky změní capability, ale dokončení starého pollu ji znovu přepíše. HTTP fronta chrání requesty, nikoli jejich pozdější zápisy do Homey capabilities. Sekvenování musí proto pokrýt i zpracování snapshotu.

Pro konkrétní případ je vhodné zachytit: zobrazenou akci před klikem, ID cílového zařízení, požadovaný `Paused`, status/tělo odpovědi, readback `Paused`/`Locked`/`ChargeState`, strategii a čas vzniku snapshotu. Pozorování umožní rozlišit znovupozastavení druhým klikem, opožděnou UI aktualizaci, odmítnutý HTTP příkaz a úspěšné Resume s dalším blokátorem. Audit neposílal žádné příkazy skutečnému zařízení.

## Optimalizace a údržba

1. **Jedna cesta ovládání zařízení.** Widget, systémové capability a vlastní Flow mají používat společné metody pro pause/resume, dynamický režim, proudové limity a změnu IP. Tím se sjednotí validace, potvrzení a chování při selhání; řeší F04/F08.
2. **Jeden probíhající snapshot.** Sloučit souběžná volání poll/settings/refresh do stejného Promise a serializovat také následné zpracování energie/stavů. Současná HTTP fronta již zabraňuje paralelním HTTP požadavkům stejného klienta, ale nechrání celý fetch→capabilities→store cyklus.
3. **Příkazy jako celé operace.** Fronta dnes serializuje jednotlivé requesty, ne posloupnosti `Dynamic`/mode/`Paused`/`Intensity`. V několika současných akcích se kroky mohou proložit. Zavést frontu operací a po úspěchu potvrdit očekávaný stav; bez readbacku nelze tvrdit, že nabíjení skutečně běží.
4. **Widget aktualizovat po potvrzeném snapshotu.** Použít SDK eventy přes `Homey.on()` jako doplněk lehkého obnovování, označit revizi snapshotu a přidat stáří dat. To může snížit opakované API čtení capabilities i reakční dobu. Zachovat úvodní načtení a obnovu po návratu dashboardu. [Widget API](https://apps.developer.homey.app/the-basics/widgets.md).
5. **Oddělit síťové timeouty, cache a dostupnost.** Tři různé účely mají dnes nepřímé vazby; F09/F10 ukazují praktický dopad. Optimalizovat až podle naměřené odezvy firmware 2.5.1; pevný 150ms rozestup requestů zatím neodstraňovat, protože byl zaveden kvůli nestabilitě V2C HTTP serveru.
6. **Kritické testy před refaktoringem.** Widget stale GET / dvojklik / POST error, dva wallboxy, stop spolu s kladným setpointem, PV enumy, Repair IP a programové nastavení, stav 4/5/6 a několik energetických průběhů. Testy mají kontrolovat správné chování a protokol, nikoli kopírovat nynější chybné implementace.
7. **Koordinace klientů a zániku operací.** Queue je per-instance: Repair probe vytváří další klient a `initializeSession()` navíc frontu obchází. Probe stejné IP tak může soutěžit s běžným pollingem; reálný dopad na 2.5.1 je potřeba změřit. Při změně IP vyčistit cache a nedovolit starému pollu přepsat nový snapshot. Zvážit deadline/rušení také pro čekání ve frontě; šestisekundový AbortSignal pokrývá jen aktivní request, ne celý backlog. Nativní timeout v lokálním Node 22 má název `TimeoutError`, zatímco specializovaná větev čeká `AbortError`; generic větev však chybu stále započítá, nejde o chybějící backoff.

**Další scénáře řízení k ověření:** přechod z Homey zero-power pauzy do V2C strategie ponechává `Paused=1`; samostatné start/resume jen odpozastaví aktuální Intensity. Je nutné rozlišit pauzu vynucenou nulovým cílem a explicitní uživatelský stop, a ověřit, jak má být zachován setpoint při změně strategie. Automatické zrušení všech pauz při změně režimu by mohlo být nežádoucí. Toto jsou důležité integrační scénáře, ne důkaz konkrétního firmware blokátoru.

**Podmíněná migration větev:** `initializeCapabilities()` toleruje selhání přidání capability, ale mnoho následných zápisů není chráněno `hasCapability()`. Stub s chybějící `measure_charge_power` odmítl celou aktualizaci. Potřebné capability má inicializace buď vyžadovat, nebo se jejich absence musí explicitně podporovat; reálný výskyt selhání migrace na podporovaných instalacích nebyl ověřen.

## Nové funkce doložené lokálním HTTP API

| Pořadí | Funkce | Doložený HTTP klíč | Chybějící část a vhodné Homey rozhraní | Podmínky |
| --- | --- | --- | --- | --- |
| 1 | Zapnout/vypnout V2C časovače | `Timer=0/1` | `api.js:setTimer()` již existuje, chybí akce a podmínka Flow / ovládací prvek. | Nízká složitost; ověřit readback a vztah k plánům. |
| 2 | Proud a napětí každé fáze | `IntensityMeasure_L1/L2/L3`, `VoltageMeasure_L1/L2/L3`, read-only A/V | Šest měření, případně subcapabilities, diagnostika fází a Flow prahy. | Ověřit skutečné názvy/typy na 2.5.1; příklad má typo `_L1y`. |
| 3 | Přehled důvodu čekání a poruchy ve widgetu | `Locked`, `Timer`, `Paused`, `DynamicPowerMode`, `ChargeState` | Rozšířený stav, chybová zpráva, explicitní akce start/pause; žádné skryté rušení uživatelských strategií. | Z parametrů zobrazovat známá omezení, nikoli odhadovat nezdokumentovaný detailní důvod. |
| 4 | Limit příkonu pro V2C regulaci | `ContractedPower`, writable W | Pokročilé nastavení a omezená číselná Flow akce; aplikace klíč nevyužívá. | Ověřit povolené limity a profilové chování. Release 2.4.4 zmiňuje opravu koordinace s HTTP API. |
| 5 | Pozastavit pouze dynamickou modulaci | `PauseDynamic=0/1` | Oddělená akce Flow, stav regulace a případně widget indikátor. | Ověřit, zda zastavuje pouze modulaci, jaký proud ponechá a vztah k `Dynamic`/`Paused`. |
| 6 | Smíšený jednofázový/třífázový režim | `ChargeMode=2` | Samostatná strategie místo číselného pevného `phase_mode`; Flow volba režimu. | Nestačí přidat enum: výpočty výkonu a aktivních fází musí podporovat dynamickou změnu; ověřit HW. |
| 7 | Samostatný přepínač loga a jas displeje | `LogoLED=0/1`, `LightLED=0..100` | Oddělené explicitní akce; správný widget či nastavení. | Především oprava stávajícího kontraktu F12. |
| 8 | Síťová diagnostika | realtime `SSID`, `IP`, `SignalStatus` | Diagnostický přehled pro porovnání nastavené IP a odpovědi; aktuálně SSID chybí. | Bez nových zápisů; nepublikovat síťové údaje v nepotřebných veřejných výstupech. |

Tabulka vychází z [aktuální HTTP specifikace](https://docs.google.com/spreadsheets/u/1/d/e/2PACX-1vQGA_7Z4YaSMZeHRTnAP6z_82dVPmM33NxJhvsDBEFn8LyWjX-RX_fkR7KCErqAE4aGFvPrUufooHoM/pubhtml#gid=1147522182). Podpora klíče v dokumentaci potvrzuje možnost návrhu funkce; neznamená ještě úspěšné ověření této funkce na konkrétním wallboxu.

### Firmware novinky, které zatím nejsou doložené pro lokální HTTP

Firmware 2.5.0/2.5.1 uvádí řízení domácí baterie, odemykání blízkostí telefonu, více RFID a zlepšení OCPP/integrací měničů; 2.4.4 přidalo cílové kWh. Aktuální HTTP list však neposkytuje klíče pro tyto ovládací funkce. Nepřidávat smyšlené `/write/TargetEnergy` nebo podobné endpointy. Nejdříve získat specifikaci vhodného rozhraní; případná Modbus, cloud či OCPP integrace je samostatný rozsah práce. [V2C releases](https://v2charge.com/updates/).
## Doporučené pořadí další práce

1. **Widget a směrování:** F01, F03, F06/F07; explicitní idempotentní akce, stale response guard, viditelná chyba, potvrzení stavem.
2. **Správnost řízení:** F02, F04, F05, F16/F26; sjednotit příkazové cesty, respektovat stop, opravit API kontrakt a poruchové stavy.
3. **Energie a připojení:** F18–F21 a F09/F10/F11; nový model raw přírůstků, průběžný elektroměr, period keys a stáří dat.
4. **Ostatní lifecycle a kontrakty:** F12–F15, F17, F22–F24, F27–F29. Kanonizaci adres řešit už při úpravě Repair/pairing. F25 po review nevyžaduje změnu.
5. **Nové funkce:** nejdříve časovače a per-phase telemetrie, poté ověřené `ContractedPower`/`PauseDynamic`; mixed až s korektním modelem aktivních fází.

## Reprodukční artefakty

Všechny skripty jsou mimo runtime aplikace. Baseline suite nebyla přepsána, aby očekávala chybné chování; tyto skripty pouze zachycují aktuální chyby pro audit.

- [Nezávislé backend/API/schema kontroly](C:/Users/jirip/.codex/visualizations/2026/09/27/01a0e14e-813f-76c0-9198-f379ad37460a/audit-sources/independent-checks.cjs).
- [Frontend widgetu — opožděný GET a opakovaný Resume](C:/Users/jirip/.codex/visualizations/2026/09/27/01a0e14e-813f-76c0-9198-f379ad37460a/audit-sources/widget-frontend-repro.cjs).
- [Flow více zařízení](C:/Users/jirip/.codex/visualizations/2026/09/27/01a0e14e-813f-76c0-9198-f379ad37460a/audit-sources/flows-repro.cjs).
- [Řízení — stop/setpoint a L-L napětí](C:/Users/jirip/.codex/visualizations/2026/09/27/01a0e14e-813f-76c0-9198-f379ad37460a/audit-sources/device-controls-repro.cjs).
- [Energie — pause/resume, baseline a rollover](C:/Users/jirip/.codex/visualizations/2026/09/27/01a0e14e-813f-76c0-9198-f379ad37460a/audit-sources/energy-repro.cjs).

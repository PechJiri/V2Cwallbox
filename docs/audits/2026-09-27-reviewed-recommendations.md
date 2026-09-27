# Přezkoumaná doporučení pro V2C Homey aplikaci

> **Vymezení verze:** Toto review se vztahovalo k `8b7bbd9` / aplikaci 2.0.2. Po začlenění dokončené větve do `main` platí [novější vyhodnocení pro 2.0.4](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/docs/audits/2026-09-27-main-consolidation.md). Pauza/resume a první vzorek energie mají novou implementaci; měření fází už existuje. Původní doporučení proto není aktuální seznam všech chyb ani všech chybějících funkcí.

27. 9. 2026. Navazuje na [technický audit](C:/Users/jirip/SynologyDrive/HomeyApps/V2CWallbox/docs/audits/2026-09-27-sdk-api-widget-audit.md), aplikace 2.0.2. Uživatel přešel z firmware 2.5.0 na 2.5.1. Tento dokument doporučuje rozsah další práce; produkční kód se při review neměnil a skutečný wallbox nebyl ovládán.

## Výsledek review

Hlavní doporučení obstojí: nejdříve opravit spolehlivost widgetu, směrování příkazů a respektování zastavení; následně zpřesnit energii a dostupnost. Původní seznam ale potřeboval užší vymezení. Obsahuje skutečné chyby, podmíněná rizika, návrhy lepšího ovládání i jednu položku, kterou po ověření vyřazuji. Není vhodné všech 29 bodů převést bez dalšího na seznam oprav.

Zásadní pravidlo: obecné výpočtové Flow karty jsou samostatná užitečná funkce aplikace. Je správně, že se jejich výsledek nemusí řídit aktuálním stavem wallboxu a že mohou sloužit jiné automatizaci. Opravy ovládání se nesmějí promítnout do změny jejich významu.

## 1. Co zachovat u Flow karet

| Skupina | Konkrétní karty | Co uživateli poskytují | Pravidlo pro úpravy |
| --- | --- | --- | --- |
| Výpočet | `calculate_power_with_buffer` | Spočítá proud ze zadaného výkonu, rezervy, napětí a fází a vrátí číslo do dalšího Flow. | Zachovat vlastní vstupy, zaokrouhlení a token `calculated_current`; nepřidávat odeslání do wallboxu ani závislost na jeho dostupnosti. |
| Číselná podmínka | `compare_calculated_current` | Porovná vložené hodnoty podle vybraného operátoru. | Zachovat porovnání vstupů, nikoli nahrazovat jeden vstup aktuálním měřením wallboxu. |
| Výpočet s ovládáním | `set_power` | Spočítá proud, zapíše jej do wallboxu a vrátí vypočtené číslo. | Opravit případný výběr zařízení, ale zachovat explicitní parametry výpočtu i výstupní token. |
| Ovládání a měření | `set_intensity`, nastavení dynamiky a limitů, výkonové podmínky | Mění nebo čtou konkrétní vybrané zařízení. | Používat správné zařízení a hlásit skutečný výsledek operace. |
| Lokální statistiky | `set_energy_counter` | Upraví měsíční/roční počítadla vedená aplikací. | Zachovat lokální význam. Není to příkaz pro reset čítače ve wallboxu. |

**Příklad:** přebytek 2 300 W při jedné fázi a 230 V dává 10 A. Uživatel může číslo předat do jiné automatizace, porovnat ho s limitem nebo jen zobrazit. Výpočtová karta kvůli tomu nemusí nic nastavovat na nabíječce. U malého výkonu může záměrně vrátit i méně než 6 A; převod takového výsledku na skutečný nabíjecí příkaz je samostatné rozhodnutí.

To jsem ověřil spuštěním skutečných handlerů s náhradou zařízení, která by při čtení jeho nastavení či měření vyhodila chybu. Výpočet vrátil 10 A a v druhém scénáři 1 A, číselná podmínka fungovala a nevznikl žádný zápis. Teprve `set_power` odeslal `Intensity=10`. Viz [ověřovací skript](C:/Users/jirip/.codex/visualizations/2026/09/27/01a0e14e-813f-76c0-9198-f379ad37460a/audit-sources/review-flow-intent.cjs).

Karty jsou dnes technicky registrované u driveru. To z nich nedělá povinně ovládací karty. Při opravách zachovat identifikátory, názvy argumentů a tokeny, aby uživatelé nemuseli předělávat uložená Flow. Případné nové obecné karty dostupné i bez spárovaného zařízení by byly samostatné rozšíření; pouhé přestěhování existujících karet nelze považovat za bezpečnou kosmetickou změnu. Také rozšíření současných rozsahů nebo změna práce se zápornými čísly vyžadují vlastní zadání.

## 2. První balíček: důvěryhodné tlačítko a ovládání

### Widget: kliknutí musí provést zobrazenou akci

**Co se může dít dnes:** klikneš na „Začít“, příkaz uspěje, ale opožděná odpověď vrátí na obrazovku staré tlačítko. Klikneš znovu a současná logika může poslat opačný příkaz — pauzu. Tento průběh se podařilo reprodukovat i s jediným zařízením. Je to silný kandidát na tvůj problém, nikoli důkaz, že právě to nastalo při konkrétním pokusu.

**Co navrhuji:** Start vždy znamená „zruš pauzu“, Pauza vždy „pozastav“. Během požadavku widget ukáže průběh a omezí opakovaný klik. Starší odpověď nepřepíše novější výsledek. Po příkazu se skutečně načte nový stav; chyba nebo neověřený výsledek budou viditelné v rozhraní.

**Co získáš:** nebudeš muset odhadovat, zda kliknutí proběhlo, ani nevědomky rušit první úspěšný start dalším kliknutím. Důležitá je odezva a pravdivý stav, nikoli slib okamžitého odběru energie.

**Jak poznáme hotovo:** test opožděné odpovědi, dvojího kliknutí, chyby požadavku a návratu na dashboard; poté zkouška na firmware 2.5.1. Dvakrát stisknutý Start nesmí vytvořit následný příkaz Pauza. Položky F06/F07 a související F09.

### Povolené nabíjení a skutečné nabíjení jsou různé stavy

Zrušení pauzy neznamená, že auto okamžitě začne odebírat. Wallbox může být zamčený, může být aktivní časový plán nebo solární strategie, případně auto nepožaduje energii. Samotné zachování těchto nastavení je správné.

Navrhuji ve widgetu rozlišit „nabíjení povoleno“, „nabíjí“ a „pozastaveno“ a doplnit dostupné informace o zámku, režimu, poruše a stáří dat. U časovače lze z jeho zapnutí spolehlivě říct „časovač aktivní“, ale bez dalších údajů nelze tvrdit „právě časovač blokuje nabíjení“. Změna zámku či strategie má mít vlastní záměrnou akci. F08 proto hodnotím jako zlepšení srozumitelnosti, ne jako chybu, která se má opravit automatickým odemknutím.

### Vybrané zařízení a Stop musí mít jednoznačný význam

U více wallboxů se widget může vrátit k prvnímu zařízení a některé Flow handlery používat poslední inicializované zařízení. Oprava má zajistit, že akce patří zařízení vybranému uživatelem; neplatný výběr vrátí srozumitelnou chybu. Týká se to karet pracujících se zařízením, nikoli výpočtů uvedených výše. F01/F03.

Dále může současně přijatý požadavek Stop a změna výkonu skončit opětovným spuštěním. Navrhuji, aby explicitní Stop měl přednost a nový výkon se pouze uchoval pro další start. Pokud se při startu mění proud, nejdříve musí úspěšně proběhnout jeho nastavení a teprve potom odpozastavení. Při chybě nesmí aplikace předstírat úspěch. F16/F26; nejde o pokus vyrobit z více HTTP zápisů skutečnou transakci, kterou API neposkytuje.

## 3. Druhý balíček: Flow a nastavení skutečně udělají to, co slibují

**Co dnes nesedí:** čtyři ovládací Flow akce pro dynamiku, její režim a minimální/maximální proud ukládají nastavení do Homey, ale chybí navazující zápis do wallboxu. Oprava IP přes Repair může podobně uložit novou adresu, zatímco běžící připojení používá starou. Dvě podmínky „výkon je větší/menší než“ čtou jinak pojmenovaný argument, než dostávají, a mohou vracet nesprávný výsledek.

**Co navrhuji:** pro konkrétní ovládací operaci vytvořit jednu společnou cestu používanou nastavením, Flow i widgetem, pokud mají stejný význam. Ta ověří vstup, provede operaci a ověří výsledek. Změna IP obnoví i běžící připojení. Výkonové podmínky dostanou správný práh. Obecné výpočty a lokální energetické počítadlo do této cesty nepatří.

**Přínos:** úspěšně dokončená automatizace bude znamenat provedenou změnu; uživatel nebude řešit situaci „v Homey se to přepsalo, ale nabíječka se chová stejně“. Testy musí ověřit účinek i selhání pro každou dotčenou kartu, dvě zařízení a změnu adresy bez restartu aplikace. F04/F24, při úpravě připojení také F23/F27.

**Před změnou solárních režimů je potřeba ověření:** zveřejněná HTTP tabulka a aplikace mají prohozené významy režimů 2 a 3. Dopad může být zásadní — volba „jen přebytky“ by mohla znamenat režim umožňující doplnění ze sítě. Rozpor je potvrzený, chování konkrétního firmware zatím ne. Nejprve porovnat známou volbu v oficiálním rozhraní s přečteným HTTP kódem na 2.5.1. Potom opravit mapování a popisky, pokud se nesoulad potvrdí. Automaticky přepisovat uložené číselné hodnoty nebo rušit starý režim 1 by mohlo poškodit existující automatizace. F02.

Stejný princip platí pro logo LED: tabulka udává zapnuto/vypnuto, aplikace posílá procenta jasu. Ověřit podporovaný rozsah a připravit kompatibilní úpravu existující karty; bez dalšího neodstraňovat její volbu „obojí“ ani měnit význam uložených Flow. F12.

## 4. Třetí balíček: věrohodná energie

**Co může uživatel vidět:** energie po pauze a pokračování může poskočit nebo se započítat vícekrát. V reprodukci se stejným průběžným čítačem přes pauzu skončilo skutečných 0,40 kWh jako 0,90 kWh v součtech. Jiná cesta může naopak vynechat první část nabíjení. Kumulativní elektroměr pro Homey se navíc významně mění až při konci relace; časové přiřazení spotřeby může být zkreslené.

**Co navrhuji:** oddělit surový čítač wallboxu od součtů vedených aplikací. Každý nový přírůstek započítat právě jednou a průběžně ho předávat Homey. Ošetřit pauzu, odpojení, reset čítače, restart aplikace, první párování a přechod měsíce/roku. Před návrhem migrace zachytit skutečný průběh čítače na 2.5.1. F18–F21.

**Přínos:** použitelné měsíční přehledy a lepší podklad pro energetické automatizace. Součástí opravy musí být zachování stávajících počítadel nebo zdokumentovaný výchozí bod; nelze zpětně spolehlivě opravit historii, pokud chybí původní vzorky. Ani rozdělení energie během dlouhého výpadku mezi dva dny nelze z jediného konečného čísla určit přesně. Nejde o příslib fakturačního měření.

**Jak poznáme hotovo:** po sérii nabíjení/pauza/pokračování/odpojení odpovídá celkový přírůstek skutečnému čítači, restart ho nepřičte znovu a průběžné hodnoty nevyrábějí falešný reset. V testech použít i zaznamenané přechody firmware. Oprava porovnání roku a měsíce je drobná součást tohoto balíčku, ne samostatný urgentní projekt.

## 5. Čtvrtý balíček: ukázat poruchu a stáří údajů

**Co dnes hrozí:** některé poruchové stavy wallboxu se změní na běžné odpojení nebo se celý vzorek odmítne. Při výpadku spojení může dlouho zůstat zobrazený starý stav. Chybějící doplňkové měření se může tvářit jako nula, ačkoli skutečnou hodnotu neznáme.

**Co navrhuji:** odlišit poruchu wallboxu, nedostupné spojení a neaktuální údaj. Ukázat čas posledního platného načtení, správně vyhodnotit HTTP chyby a nepřevádět chybějící data na vymyšlené hodnoty. Zachovat všechny doložené poruchové stavy. Volitelné diagnostické údaje, například verze firmware, by samy neměly blokovat celý přehled. F05/F10/F11/F13–F15/F29.

**Přínos:** uživatel pozná rozdíl mezi „auto stojí“, „nabíječka hlásí chybu“ a „Homey neví, protože nemá čerstvá data“. Automatizace nedostanou falešnou nulu jako skutečné měření. Správná reakce na výpadek nevyžaduje častěji zatěžovat wallbox: interval opakovaných pokusů může růst, zatímco uživateli problém zobrazíme včas.

## 6. Optimalizace jako součást oprav

Navrhuji cíleně upravit načítání a koordinaci příkazů, nikoli plošně přepsat aplikaci. Přínos má být měřitelný: kratší čekání po kliknutí, méně duplicitních požadavků a žádné přepsání nových dat starou odpovědí.

- Oddělit dobu čekání na HTTP odpověď od doby platnosti cache. Dnes jejich vazba mění zamýšlené pětisekundové načítání při nabíjení typicky na přibližně desetisekundové. Po příkazu umožnit skutečnou obnovu. F09.
- Sdílet rozpracované čtení a koordinovat celou ovládací operaci. Zachovat úmyslné zpomalování při výpadku a zatím i ochranné rozestupy požadavků; odstranění bez měření může zhoršit chování V2C serveru.
- Po smazání zařízení nebo změně IP nedovolit staré operaci zapsat výsledek do již neplatného stavu. F22/F23.
- Změnit jen spotřebované hodnoty, pokud je to bezpečné pro jejich časové značky a události. Widget může dostávat upozornění na nový stav; stále potřebuje úvodní načtení a obnovu po návratu na dashboard. Úsporu nejprve měřit.

Rozsáhlé sjednocování všech Flow karet, přepis do TypeScriptu nebo přidávání mezipamětí bez doloženého přínosu do doporučeného rozsahu nezařazuji.

## 7. Nové funkce, které dávají uživatelský smysl

| Doporučení | Příklad použití | Co je opravdu doloženo a co ještě ověřit |
| --- | --- | --- |
| **Nejdříve: ovládání existujících V2C časovačů** | Flow při odjezdu zapne nebo vypne plánované nabíjení. | HTTP `Timer` umožňuje přepnutí; nejde o doloženou možnost vytvářet a editovat jednotlivé časové plány. Ověřit účinek a zpětné načtení. |
| **Nejdříve: proud a napětí jednotlivých fází** | Uživatel vidí, kolik auto odebírá z každé fáze; snáze pozná odlišný odběr nebo chybějící měření. | Tabulka má šest příslušných údajů. Ověřit skutečné názvy a dostupnost na 2.5.1; nevyvozovat závadu pouze z nulového odběru jedné fáze. |
| **Součást opravy widgetu: přehled čekání, režimu a poruch** | Je zřejmé, zda je nabíjení pozastavené, povolené nebo opravdu běží a zda jsou data čerstvá. | Zobrazovat doložené stavy; přesný důvod neodběru nemusí API poskytovat. |
| **Později: limit pro dynamickou regulaci** | Pokročilé Flow mění limit, se kterým V2C reguluje nabíjení. | Zápis `ContractedPower` je zdokumentovaný. Před návrhem ověřit rozsah, aktivní profil a význam vůči ostatním limitům. Nejde automaticky o přímý požadavek výkonu auta. |
| **Později: pozastavení dynamické regulace** | Pokročilý uživatel dočasně pozastaví automatickou regulaci. | `PauseDynamic` existuje. Bez ověření nelze slíbit, jaký proud zůstane nastaven ani zaměňovat tuto akci za zastavení nabíjení. |
| **Až po ověření hardware: smíšený režim fází** | Nabíječka podle podmínek využívá jednofázové/třífázové nabíjení. | `ChargeMode=2` je v tabulce. Vyžaduje správný model aktivních fází a podporu konkrétního zařízení; nestačí nová položka seznamu. |

Podkladem je [veřejná HTTP specifikace](https://docs.google.com/spreadsheets/u/1/d/e/2PACX-1vQGA_7Z4YaSMZeHRTnAP6z_82dVPmM33NxJhvsDBEFn8LyWjX-RX_fkR7KCErqAE4aGFvPrUufooHoM/pubhtml#gid=1147522182). Názvy klíčů jsou důkazem možnosti integrace, nikoli zkouškou konkrétního hardware.

Novinky uvedené v [release notes V2C](https://v2charge.com/updates/) nelze automaticky považovat za nové možnosti lokálního HTTP. Pro řízení domácí baterie, správu RFID či odemykání podle blízkosti telefonu v tomto listu nemáme odpovídající příkazy. Tyto funkce proto nyní neslibuji. Základní Homey Energy integrace již v aplikaci existuje; její zpřesnění výše není nová integrace od nuly.

## 8. Rozhodnutí o všech původních nálezech

„Ponechat“ znamená doporučení k opravě dané cesty, ne potvrzení incidentu na uživatelově wallboxu. Podrobné odkazy na kód a původní reprodukce jsou v technickém auditu.

| Nález | Výsledek review | Rozsah / podmínka |
| --- | --- | --- |
| F01 — widget a zařízení | Ponechat | Nesprávný fallback; dopad na jiný wallbox vyžaduje více zařízení. |
| F02 — režimy 2/3 | Ověřit před změnou | Rozpor s tabulkou je doložen; ověřit firmware a migraci uložených voleb. |
| F03 — Flow a zařízení | Zúžit | Pouze handlery pracující se zařízením; výpočty jsou záměrně samostatné. |
| F04 — zápisy nastavení | Ponechat, přesně vymezit | Čtyři ovládací Flow a Repair. Ne obecné výpočty ani lokální počítadla. |
| F05 — poruchové stavy | Ponechat | Chybu nezobrazovat jako normální odpojení; nezkoušet automatický restart. |
| F06 — inverze akce widgetu | Ponechat, vysoká praktická priorita | Start musí zůstat Start i při souběžné změně stavu. |
| F07 — staré odpovědi widgetu | Ponechat, vysoká praktická priorita | Reprodukovaná cesta k druhému opačnému příkazu; doplnit zpětnou vazbu. |
| F08 — další blokátory | Překlasifikovat na UX | Je správně ponechat zámek/plán/režim; zlepšit vysvětlení stavu. |
| F09 — cache a polling | Ponechat | Oddělit timeout/TTL a zajistit obnovu po příkazu, nikoli plošně zrychlit polling. |
| F10 — pozdní offline | Ponechat | Stáří dat vyhodnocovat nezávisle na intervalu dalších pokusů. |
| F11 — HTTP status | Ponechat | Parsovatelný JSON při HTTP chybě není úspěšná komunikace. |
| F12 — LogoLED | Ověřit před změnou | Potvrzený rozpor s dokumentací; zachovat kompatibilitu dosavadní karty. |
| F13 — FirmwareVersion | Podmíněná odolnost | Odmítnutí chybějícího klíče potvrzeno; absence na 2.5.1 nepotvrzena. |
| F14 — řetězcové booleany | Nízká priorita | Chybný převod je doložen; takový payload konkrétního firmware nikoli. |
| F15 — chybějící měření | Ponechat | Neznámý údaj nemá znamenat naměřenou nulu. |
| F16 — Stop a výkon | Ponechat | Stop má přednost; cíl uchovat pro pozdější start. |
| F17 — náhradní napětí | Ponechat, podmíněný scénář | Týká se automatické cesty s chybějícím napětím L-L, ne přepisování explicitních vstupů kalkulačky. |
| F18 — energie po pauze | Ponechat; ověřit reálný průběh | Chyba součtu reprodukována při zachování čítače přes pauzu. |
| F19 — průběžný elektroměr | Ponechat s omezením tvrzení | Pozdní přírůstky mohou zkreslit časové přiřazení; nelze zaručit konkrétní chování každého grafu Homey. |
| F20 — první vzorek energie | Zahrnout do F18 | Ověřit finální čítač při odpojení a odlišit první párování od nové relace. |
| F21 — rok a měsíc | Snížit prioritu | Okrajová dlouhá mezera; drobná oprava při úpravě energie. |
| F22 — doběhnutí pollu | Ponechat jako údržbu | Rušení zařízení/připojení nesmí ponechat zápis ze staré operace. |
| F23 — neúplná inicializace | Ponechat, podmíněný scénář | Zařízení původně inicializované s neplatnou IP; řešit s Repair. |
| F24 — výkonové podmínky | Ponechat | Chybný název argumentu; netýká se čistého porovnání proudu. |
| F25 — category | **Vyřadit z oprav** | CLI 4.2.0 / homey-lib 2.49.1 podporují pole i řetězec. |
| F26 — proud až po startu | Ponechat | Pořadí příkazů má bránit rozběhu se starým limitem při selhání druhého kroku. |
| F27 — IP s úvodní nulou | Ponechat, běžná robustnost | Validovat a používat stejnou adresu; nejde o doložený útok na instalaci. |
| F28 — IP jako identita | Odložit migraci, použít Repair | Stabilní ID pro nové párování až po ověření jedinečnosti; zachovat stávající zařízení a historii. |
| F29 — token chyby | Ponechat jako malé rozšíření | Chybí deklarovaný token; nelze z toho tvrdit nefunkčnost celého triggeru. |

Vyřazení F25 stojí na přímém čtení [schématu CLI](C:/Users/jirip/AppData/Roaming/npm/node_modules/homey/node_modules/homey-lib/assets/app/schema.json:1222) a [validátoru](C:/Users/jirip/AppData/Roaming/npm/node_modules/homey/node_modules/homey-lib/lib/App/index.js:320). [Webová dokumentace manifestu](https://apps.developer.homey.app/the-basics/app/manifest.md) uvádí užší tvar, ale samotný rozdíl neprokazuje chybu.

## Doporučené pořadí vydání

1. **Opravy ovládání:** widget, správné zařízení, priorita Stop a pořadí nastavení proudu. Současně ověřit kontrakt režimů 2/3 na 2.5.1 a zachovat všechny existující výpočtové karty.
2. **Spolehlivé automatizace a data:** skutečný účinek ovládacích Flow a Repair, výkonové podmínky, poruchové stavy, stáří dat a energie. Energetická migrace zaslouží samostatně kontrolovatelnou změnu.
3. **Nové funkce:** přepínání existujících časovačů a měření jednotlivých fází; pokročilé řízení až po ověření konkrétních parametrů.

Každá změna má mít ověření uživatelského výsledku a kompatibility uložených Flow. Oprava widgetu je nejbližší tvému konkrétnímu problému; není důvod ji odkládat kvůli kompletní přestavbě aplikace.

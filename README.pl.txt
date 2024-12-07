Aplikacja oferuje kompleksową kontrolę i monitorowanie ładowarki V2C Wallbox za pośrednictwem interfejsu Homey. Pozyskuje szczegółowe dane w czasie rzeczywistym dotyczące statusu ładowania, połączenia pojazdu, zużycia energii i umożliwia zaawansowaną kontrolę dzięki przepływom Homey.  
Kluczowe funkcje to:

Monitorowanie w czasie rzeczywistym statusu ładowania, zużycia energii i połączenia pojazdu  
Miesięczne i roczne śledzenie statystyk energetycznych  
Zaawansowane możliwości kontroli (zawieszenie/wznowienie ładowania, blokowanie/odblokowywanie, ustawienia intensywności)  
Dynamiczne zarządzanie mocą z różnymi trybami pracy  
Monitorowanie zużycia energii w domu i produkcji solarnej (wymaga instalacji klamer pomiarowych)  
Intuicyjny widget panelu nawigacyjnego do szybkiego przeglądu statusu i kontroli  
Rozszerzone wsparcie dla Flow z wyzwalaczami, warunkami i akcjami

Aby uzyskać dane dotyczące zużycia energii w domu, produkcji solarnej oraz funkcje dynamicznej mocy, Twoja ładowarka V2C Wallbox musi być prawidłowo podłączona do twojej instalacji elektrycznej za pomocą klamr pomiarowych lub bezpośrednio do falownika solarnego, a tryb dynamiczny musi być włączony.  
Aplikacja komunikuje się z ładowarką za pomocą poleceń HTTP w sieci lokalnej, więc zarówno Homey, jak i V2C Wallbox muszą być w tej samej sieci. Dla niezawodnego działania zaleca się przypisanie statycznego adresu IP do ładowarki.  
Działania kontrolne mogą być używane w dwóch trybach:

Z włączonym trybem dynamicznym - obsługuje ustawienia min/maks intensywności i różne tryby mocy (FV Exclusive, FV+Minimalna Moc, Sieć+FV)  
Bez trybu dynamicznego - obsługuje bezpośrednią kontrolę intensywności i podstawowe zarządzanie ładowaniem  

Przetestowano na ładowarce V2C Trydan i powinno być kompatybilne ze wszystkimi modelami ładowarek V2C dzięki zunifikowanej specyfikacji.  
Uwaga: Wszystkie funkcje wymagają prawidłowej konfiguracji sieci i ustawień. Niektóre zaawansowane funkcje zależą od prawidłowego zainstalowania klamer pomiarowych i podłączenia do falownika solarnego, jeżeli dotyczy.
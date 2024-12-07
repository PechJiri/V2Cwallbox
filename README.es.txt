La aplicación proporciona un control completo y monitoreo de tu cargador V2C Wallbox a través de la interfaz de Homey. Obtiene datos detallados en tiempo real sobre el estado de carga, conexión del vehículo, consumo de energía y permite un control avanzado mediante flujos de Homey.  
Las características clave incluyen:

Monitoreo en tiempo real del estado de carga, consumo de energía y conexión del vehículo  
Seguimiento de estadísticas de energía mensuales y anuales  
Capacidades avanzadas de control (pausar/reanudar carga, bloquear/desbloquear, configuraciones de intensidad)  
Gestión dinámica de energía con múltiples modos de operación  
Monitoreo del consumo de energía del hogar y producción solar (requiere instalación de pinzas de medición)  
Widget de panel intuitivo para visión general rápida del estado y control  
Extenso soporte de Flows con disparadores, condiciones y acciones  

Para los datos de consumo del hogar, producción solar y funciones de energía dinámica, tu V2C Wallbox debe estar correctamente conectado a tu instalación eléctrica usando pinzas de medición o directamente a tu inversor solar, y el modo dinámico debe estar habilitado.  
La aplicación se comunica con el wallbox a través de comandos HTTP en tu red local, por lo que tanto Homey como el wallbox V2C deben estar en la misma red. Para un funcionamiento confiable, se recomienda asignar una dirección IP estática a tu wallbox.  
Las acciones de control pueden usarse en dos modos:

Con el modo dinámico habilitado: admite configuraciones de intensidad mínima/máxima y varios modos de energía (FV Exclusivo, FV+Mínima Energía, Red+FV)  
Sin el modo dinámico: admite control de intensidad directa y gestión básica de carga  

Probado en el cargador V2C Trydan y debería ser compatible con todos los modelos de cargadores V2C debido a especificaciones unificadas.  
Nota: Todas las funciones requieren una configuración y configuración de red adecuada. Algunas funciones avanzadas dependen de la correcta instalación de pinzas de medición y conexión al inversor solar si es aplicable.  
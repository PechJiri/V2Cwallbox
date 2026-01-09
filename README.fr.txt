L'application offre un contrôle complet et une surveillance de votre chargeur V2C Wallbox via l'interface de Homey. Elle récupère des données détaillées en temps réel sur l'état de charge, la connexion du véhicule, la consommation d'énergie, et permet un contrôle avancé à travers les flows Homey. 

Les fonctionnalités clés incluent :

Surveillance en temps réel de l'état de charge, de la consommation d'énergie, et de la connexion du véhicule
Suivi des statistiques énergétiques mensuelles et annuelles
Capacités de contrôle avancées (pause/reprise de charge, verrouillage/déverrouillage, réglages d'intensité)
Gestion dynamique de la puissance avec plusieurs modes de fonctionnement
Surveillance de la consommation domestique et de la production solaire (nécessite l'installation de pinces de mesure)
Widget de tableau de bord intuitif pour un aperçu rapide de l'état et le contrôle
Support extensif des Flows avec déclencheurs, conditions, et actions

Pour les données de consommation domestique, la production solaire, et les fonctionnalités de puissance dynamique, votre V2C Wallbox doit être correctement connecté à votre installation électrique en utilisant des pinces de mesure ou directement à votre onduleur solaire, et le mode dynamique doit être activé. L'application communique avec le wallbox via des commandes HTTP sur votre réseau local, donc Homey et le chargeur V2C doivent être sur le même réseau. Pour un fonctionnement fiable, il est recommandé d'attribuer une adresse IP statique à votre wallbox.

Les actions de contrôle peuvent être utilisées de deux manières :

Avec le mode dynamique activé - prend en charge les réglages d'intensité min/max et divers modes de puissance (FV Exclusif, FV+Mini Puissance, Réseau+FV)
Sans mode dynamique - prend en charge le contrôle direct de l'intensité et la gestion de charge de base

Testé sur le chargeur V2C Trydan et doit être compatible avec tous les modèles de chargeurs V2C grâce à des spécifications unifiées. 

Note : Toutes les fonctionnalités nécessitent une configuration et un réglage réseau appropriés. Certaines fonctionnalités avancées dépendent de l'installation correcte de pinces de mesure et de la connexion à un onduleur solaire si applicable.
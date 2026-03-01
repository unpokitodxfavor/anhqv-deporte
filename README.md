# ⚡ Amazfit Ultra Tracker

**Amazfit Ultra Tracker** es una aplicación web moderna y potente diseñada para sincronizar, visualizar y gestionar datos de actividad deportiva directamente desde dispositivos Huami/Amazfit (como Stratos, Verge, GTR, GTS, T-Rex, etc.) utilizando la API de **Web Bluetooth**.

![Versión](https://img.shields.io/badge/version-1.5.9-brightgreen)
![Tecnologías](https://img.shields.io/badge/tech-Vanilla_JS_|_CSS3_|_HTML5-blue)
![Licencia](https://img.shields.io/badge/license-MIT-orange)

---

## 🚀 Características Principales

### ⌚ Sincronización Directa
- **Conexión BLE**: Comunicación directa con el reloj sin necesidad de servidores intermedios a través de Web Bluetooth.
- **Autenticación Segura**: Uso de una clave de autenticación de 32 caracteres (Auth Key) para vincular el dispositivo.
- **Sincronización Inteligente**: Descarga solo las actividades nuevas detectadas o permite forzar una sincronización completa.

### 📊 Visualización y Análisis
- **Mapas Interactivos**: Visualización de rutas en pantalla completa utilizando **Leaflet.js**.
- **Métricas Detalladas**: Información precisa sobre Distancia, Duración, Ritmo (Pace), Frecuencia Cardíaca Media y Calorías.
- **Dashboard de Estadísticas**: Análisis histórico con totales acumulados (histórico, mensual, semanal) y récords personales.
- **Desglose Mensual**: Listado organizado por meses para una mejor navegación del historial.

### 💾 Gestión de Datos y Exportación
- **Exportación GPX**: Descarga tus actividades en formato GPX estándar para usarlas en Strava, Garmin Connect o Google Earth.
- **Copia de Seguridad en la Nube**: Integración completa con **Google Drive** para guardar copias de seguridad del historial y subir archivos GPX automáticamente.
- **Privacidad**: Todos los datos se almacenan localmente en el navegador (`LocalStorage`) hasta que decidas sincronizarlos con la nube.

### 🛠️ Consola Técnica
- **Registro en Tiempo Real**: Consola integrada para monitorear la comunicación Bluetooth y depurar posibles errores de conexión.

---

## 💻 Arquitectura Técnica

La aplicación ha sido desarrollada siguiendo principios de minimalismo y rendimiento, evitando frameworks pesados y apostando por tecnologías web nativas.

### Stack de Tecnologías
- **Core**: HTML5 Semántico y JavaScript (ES6+).
- **Estilos**: Vanilla CSS3 con una estética **Glassmorphism** y un tema oscuro premium.
- **Mapas**: [Leaflet.js](https://leafletjs.com/) para el renderizado de mapas y rutas.
- **Tipografía**: Google Fonts (Outfit).
- **APIs de Terceros**:
  - **Web Bluetooth API**: Para la comunicación con el hardware.
  - **Google Identity Services (GSI)**: Para la gestión de OAuth2.
  - **Google Drive API**: Para el almacenamiento en la nube.

### Estructura de Archivos
- `index.html`: Estructura principal de la aplicación.
- `styles.css`: Sistema de diseño responsivo y animaciones.
- `app.js`: Lógica principal de la aplicación y gestión de la UI.
- `ble.js`: Capa de comunicación Bluetooth (Protocolo Huami).
- `parser.js`: Parsers de datos binarios y generador de archivos GPX.
- `map.js`: Módulo de gestión de mapas Leaflet.
- `config.js`: Configuración global y constantes.

---

## 🛠️ Instalación y Configuración

1. **Requisitos**: Se requiere un navegador moderno con soporte para Web Bluetooth (Chrome, Edge o navegadores basados en Chromium).
2. **Obtener Auth Key**: Necesitas la clave de 32 caracteres de tu reloj. Esta clave se puede obtener a través de aplicaciones como Zepp o Gadgetbridge.
3. **Google Drive (Opcional)**: Si deseas usar las funciones de copia de seguridad, introduce tu **Google Client ID** en la sección de Ajustes.

---

## 📂 Estructura del Proyecto

```text
anhqv-deporte/
├── index.html          # Punto de entrada
├── styles.css          # Estilos premium
├── app.js             # Lógica de negocio
├── ble.js             # Comunicación hardware
├── parser.js          # Procesamiento de datos
├── map.js             # Visualización geográfica
├── config.js          # Configuración
└── auth_key_guide.md  # Guía de autenticación
```

---

## ⚖️ Licencia

Este proyecto está bajo la Licencia MIT. Siéntete libre de usarlo, modificarlo y compartirlo.

---

Desarrollado con ❤️ para la comunidad de entusiastas de Amazfit.

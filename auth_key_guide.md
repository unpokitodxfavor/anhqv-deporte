# Guía para Auto-Conexión BLE en Android

Si tu navegador indica que la auto-conexión no está soportada, sigue estos pasos para habilitar las funciones experimentales de Bluetooth de Chrome:

## Pasos para Chrome / Edge en Android

1. Abre una nueva pestaña.
2. Escribe `chrome://flags` en la barra de direcciones.
3. Busca la opción **"Web Bluetooth getDevices()"**.
4. Cámbiala a **Enabled**.
5. Busca **"Web Bluetooth permissions backend"** y selecciónalo como **Enabled**.
6. Reinicia el navegador cuando te lo pida.

> [!NOTE]
> Una vez activadas estas opciones, la aplicación podrá recordar tus dispositivos emparejados y conectarse automáticamente al abrir la página.

## Limitaciones
Si usas un navegador como **Brave**, es posible que el "Shield" bloquee el acceso a dispositivos Bluetooth. Asegúrate de desactivar los bloqueadores para la URL de la aplicación.

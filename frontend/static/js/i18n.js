/**
 * Osvium i18n — diccionario local ES/EN.
 *
 * Convenciones:
 * - La "clave" del diccionario es el texto en español literal. Esto evita
 *   refactorizar todos los strings del código para usar claves semánticas.
 * - Si una clave no existe en DICT_EN, se devuelve el texto original
 *   (fallback silencioso — requisito del producto).
 * - El idioma se persiste en localStorage.osvium_lang ('es' | 'en').
 * - Los templates marcan nodos estáticos con [data-i18n] o [data-i18n-html].
 * - Los textos dinámicos inyectados por JS deben pasar por window.i18n.t().
 * - Un MutationObserver captura nodos insertados después del load inicial.
 *
 * API pública: window.i18n = { t, setLang, getLang, applyAll, onChange }
 * Evento global: document dispara 'i18n:change' con detail { lang }.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'osvium_lang';
  const DEFAULT_LANG = 'es';
  const SUPPORTED = ['es', 'en'];

  const DICT_EN = {
    /* Lockscreen */
    'Toca para continuar': 'Tap to continue',

    /* Info panel — default */
    'Validando identidad': 'Verifying identity',
    'Espera un momento mientras verificamos tu acceso':
      'Please wait while we verify your access',
    'Colócate a una distancia adecuada\ny evita mover la cabeza':
      'Stand at an appropriate distance\nand avoid moving your head',
    'Colócate a una distancia adecuada<br>y evita mover la cabeza':
      'Stand at an appropriate distance<br>and avoid moving your head',
    'Coloca tu rostro dentro de la guía': 'Place your face within the guide',
    'Buscando rostro...': 'Searching for face...',
    'Buscando rostro…': 'Searching for face…',

    /* Face guidance — mensajes del backend (vision/face_guidance.py) */
    'Listo para escaneo': 'Ready to scan',
    'Mantente quieto': 'Hold still',
    'Rostro alineado': 'Face aligned',
    'Cámara no disponible': 'Camera unavailable',
    'Solo debe haber una persona': 'Only one person allowed',
    'Rostro fuera de la zona de captura': 'Face outside capture zone',
    'Aléjate un poco': 'Move back a bit',
    'Acércate un poco': 'Move closer a bit',
    'Muévete a la derecha': 'Move to the right',
    'Muévete a la izquierda': 'Move to the left',
    'Baja ligeramente la cabeza': 'Lower your head slightly',
    'Sube ligeramente la cabeza': 'Raise your head slightly',
    'Ajusta tu posición': 'Adjust your position',

    /* Toast — main */
    'Acceso concedido': 'Access granted',
    'Acceso denegado': 'Access denied',
    'Acceso restringido': 'Access restricted',
    'Validación biométrica exitosa': 'Biometric validation successful',
    'Identidad no válida para ingreso': 'Identity not valid for access',
    'Límite de intentos excedido': 'Attempt limit exceeded',
    'Procesando': 'Processing',
    'Analizando biometría facial': 'Analyzing facial biometrics',
    'Sistema inicializando': 'System initializing',
    'Cargando cámara y modelo': 'Loading camera and model',
    'Sin rostro detectado': 'No face detected',
    'Esperando frente a cámara': 'Waiting in front of camera',
    'Rostro no reconocido': 'Face not recognized',
    'No coincide con usuarios activos': 'Does not match active users',
    'Error de cámara': 'Camera error',
    'Verifique conexión del dispositivo': 'Check device connection',
    'Análisis en curso': 'Analysis in progress',
    'Espere a que finalice el proceso actual':
      'Wait for the current process to finish',

    /* Badge / camera states */
    'No reconocido': 'Not recognized',
    'Rostro detectado': 'Face detected',
    'Esperando detección': 'Awaiting detection',
    'Cargando modelo': 'Loading model',
    'Sin modelo': 'No model',
    'Analizando': 'Analyzing',

    /* Info panel — titles with <br> */
    'Acceso<br>concedido': 'Access<br>granted',
    'Acceso<br>denegado': 'Access<br>denied',
    'Acceso<br>restringido': 'Access<br>restricted',
    'No<br>reconocido': 'Not<br>recognized',
    'Validando<br>identidad': 'Verifying<br>identity',
    'Esperando<br>detección': 'Awaiting<br>detection',
    'Error de<br>cámara': 'Camera<br>error',
    'Cargando<br>modelo': 'Loading<br>model',
    'Sin<br>modelo': 'No<br>model',

    /* Info panel — descriptions with <br><strong> */
    'Identidad verificada<br><strong>acceso autorizado</strong>':
      'Identity verified<br><strong>access authorized</strong>',
    'Identidad no autorizada<br><strong>acceso denegado</strong>':
      'Identity not authorized<br><strong>access denied</strong>',
    'Demasiados intentos<br><strong>acceso restringido</strong>':
      'Too many attempts<br><strong>access restricted</strong>',
    'Rostro no registrado<br><strong>en el sistema</strong>':
      'Face not registered<br><strong>in the system</strong>',
    'Espera un momento mientras<br><strong>verificamos tu acceso</strong>':
      'Please wait while we<br><strong>verify your access</strong>',
    'Coloca tu rostro frente<br><strong>a la cámara</strong>':
      'Place your face<br><strong>in front of the camera</strong>',
    'Verifique la conexión<br><strong>del dispositivo</strong>':
      'Check the<br><strong>device connection</strong>',
    'Cargando modelo<br><strong>de reconocimiento</strong>':
      'Loading model<br><strong>for recognition</strong>',
    'Entrena un modelo desde<br><strong>el panel de administración</strong>':
      'Train a model from<br><strong>the admin panel</strong>',

    /* Misc */
    'Error de conexión': 'Connection error',
    'Acceso principal': 'Main access',
    'Notificación': 'Notification',
    'Operación completada': 'Operation complete',

    /* Tooltip del botón */
    'Cambiar idioma': 'Change language',
    'Idioma: Español': 'Language: Spanish',
    'Idioma: Inglés': 'Language: English',

    /* ──────────────────────────────────────────────
       Login
       ────────────────────────────────────────────── */
    'Volver al inicio': 'Back to home',
    'Inicio': 'Home',
    'Control biométrico': 'Biometric control',
    'Inicio de sesión': 'Log in',
    '¡Bienvenido de vuelta! Ingresa tu contraseña para continuar.':
      'Welcome back! Enter your password to continue.',
    /* Mantener compatibilidad: claves antiguas si quedan en código heredado. */
    'Panel de administración': 'Admin panel',
    'Ingresa con tu cuenta para continuar': 'Sign in to continue',
    'Credenciales inválidas.': 'Invalid credentials.',
    'Usuario': 'Username',
    'Contraseña': 'Password',
    'Entrar': 'Sign in',
    '¿Olvidaste tu contraseña? Llama al <span class="login-recover__phone">314 161 1779</span> para recuperarla.':
      'Forgot your password? Call <span class="login-recover__phone">314 161 1779</span> to recover it.',

    /* ──────────────────────────────────────────────
       Admin — sidebar + topbar
       ────────────────────────────────────────────── */
    'Salir': 'Sign out',
    'Cerrar sesión': 'Sign out',
    'Cerrar navegación lateral': 'Close side navigation',
    'Área principal': 'Main area',
    'Hora actual': 'Current time',
    'Barra superior': 'Top bar',
    'Resumen': 'Overview',
    'Personas': 'People',
    'Enrolamiento': 'Enrollment',
    'Accesos': 'Access logs',
    'Sistema': 'System',
    'Administración': 'Administration',
    'Navegación principal': 'Main navigation',

    /* Admin — resumen */
    'Centro de control': 'Control center',
    'Monitoreando': 'Monitoring',
    'Estado actual': 'Current status',
    'Cargando estado operativo…': 'Loading operational status…',
    'Sincronizando estado y actividad.': 'Syncing status and activity.',
    'Cámara, modelo y puerta en una sola lectura.':
      'Camera, model and door in a single view.',
    'Cámara activa - Modelo cargado - Puerta en simulación':
      'Camera active - Model loaded - Door in simulation',
    'Estado de subsistemas': 'Subsystem status',
    'Cámara activa': 'Camera active',
    'Cámara degradada': 'Camera degraded',
    'Cámara con error': 'Camera error',
    'Cámara inactiva': 'Camera inactive',
    'Modelo cargado': 'Model loaded',
    'Modelo con error': 'Model error',
    'Modelo no cargado': 'Model not loaded',
    'Puerta en simulación': 'Door in simulation',
    'Puerta lista': 'Door ready',
    'Puerta con alerta': 'Door alert',
    'Puerta sin estado': 'Door unknown',
    'Activa': 'Active',
    'Degradada': 'Degraded',
    'Inactiva': 'Inactive',
    'Simulación': 'Simulation',
    'Alerta': 'Alert',
    'Sin estado': 'Unknown',
    'Atención': 'Attention',
    'El sistema mostrará aquí la incidencia principal.':
      'The system will show the main incident here.',
    'Indicadores operativos': 'Operational indicators',
    'Personas activas': 'Active people',
    'Actividad hoy': 'Activity today',
    'Accesos hoy': 'Accesses today',
    'Tasa de reconocimiento': 'Recognition rate',
    'Manuales hoy': 'Manual today',
    'Bloqueados': 'Blocked',
    'Siguiente movimiento': 'Next move',
    'Acción sugerida': 'Suggested action',
    'Seleccionando la mejor acción.': 'Selecting the best action.',
    'Ver accesos': 'View access logs',
    'Revisa rechazos.': 'Review rejections.',
    'Agregar persona': 'Add person',
    'Crea identidad.': 'Create identity.',

    /* Admin — personas */
    'Registrar persona': 'Register person',
    'Escribe el nombre y el sistema abrirá la cámara para guardar su rostro.':
      'Enter the name and the system will open the camera to save their face.',
    'Nombre completo': 'Full name',
    'Agregar': 'Add',
    'Crear y registrar rostro': 'Create and enroll face',
    'Personas': 'People',
    'Buscando personas registradas.': 'Searching registered people.',
    'Personas registradas': 'Registered people',
    'Buscar persona': 'Search person',
    'Buscar por nombre': 'Search by name',
    'Buscar…': 'Search…',

    /* Admin — accesos */
    'Hoy': 'Today',
    'Reconocidos': 'Recognized',
    'Rechazados': 'Rejected',
    'Manuales': 'Manual',
    'Historial reciente': 'Recent history',
    'Filtrar por resultado': 'Filter by result',
    'Todos': 'All',
    'Búsqueda avanzada': 'Advanced search',
    'Buscar': 'Search',
    'Persona, ID, motivo': 'Person, ID, reason',
    'Desde': 'From',
    'Hasta': 'To',
    'Confianza mín.': 'Min. confidence',
    'Confianza máx.': 'Max. confidence',
    'Limpiar filtros': 'Clear filters',

    /* Admin — settings root */
    'Diagnóstico': 'Diagnostics',
    'Comprobando…': 'Checking…',
    'Configuración': 'Settings',
    'Reconocimiento': 'Recognition',
    'Cargando…': 'Loading…',
    'Puerta': 'Door',
    'Mantenimiento': 'Maintenance',
    'Traductor': 'Translator',
    'Cambiar idioma del sistema': 'Change system language',
    'Sistema y cuenta': 'System and account',
    'Cuenta': 'Account',
    'Acerca de': 'About',
    'Avanzado': 'Advanced',

    /* Admin — reconocimiento */
    'Modo de reconocimiento': 'Recognition mode',
    'Estricto': 'Strict',
    'Mayor seguridad': 'Higher security',
    'Equilibrado': 'Balanced',
    'Recomendado': 'Recommended',
    'Permisivo': 'Permissive',
    'Más tolerante': 'More tolerant',
    'Personalizado': 'Custom',
    'Intentos antes de bloquear': 'Attempts before lockout',
    'Intentos máximos': 'Max attempts',
    'Reducir': 'Decrease',
    'Aumentar': 'Increase',
    'Los intentos fallidos consecutivos bloquean el acceso temporalmente.':
      'Consecutive failed attempts temporarily lock access.',

    /* Admin — puerta */
    'Tiempo de apertura': 'Open duration',
    'Segundos abierta': 'Seconds open',
    'Tiempo que permanece desbloqueada la puerta tras un acceso autorizado.':
      'Time the door remains unlocked after an authorized access.',

    /* Admin — mantenimiento */
    'Acciones de mantenimiento': 'Maintenance actions',
    'Abrir puerta ahora': 'Open door now',
    'Activa el actuador manualmente': 'Manually trigger the actuator',
    'Reentrenar modelo': 'Retrain model',
    'Actualiza el modelo de reconocimiento facial':
      'Update the face recognition model',

    /* Admin — cuenta */
    'Sesión actual': 'Current session',
    'Cuenta de administrador': 'Administrator account',
    'Seguridad': 'Security',
    'Cambiar contraseña': 'Change password',
    'Sesión': 'Session',

    /* Admin — acerca de */
    'Información del dispositivo': 'Device information',
    'Nombre': 'Name',
    'Versión del software': 'Software version',
    'Dirección IP': 'IP address',
    'Espacio libre': 'Free space',
    'Tiempo encendido': 'Uptime',

    /* Admin — avanzado */
    'Parámetros avanzados': 'Advanced parameters',
    'Umbral de coincidencia': 'Match threshold',
    'Rango 1–200 · Menor = más estricto': 'Range 1–200 · Lower = stricter',
    'Aplicar': 'Apply',
    '<strong>Estricto (50)</strong> — Más exigente. Rechaza si hay la menor duda. Puede denegar a personas registradas en condiciones difíciles.':
      '<strong>Strict (50)</strong> — More demanding. Rejects on the slightest doubt. May deny registered people under difficult conditions.',
    '<strong>Equilibrado (70)</strong> — Configuración recomendada para la mayoría de los casos.':
      '<strong>Balanced (70)</strong> — Recommended setting for most cases.',
    '<strong>Permisivo (95)</strong> — Acepta con mayor flexibilidad. Útil cuando las personas cambian mucho de apariencia.':
      '<strong>Permissive (95)</strong> — Accepts with greater flexibility. Useful when people change appearance often.',

    /* Admin — sheet de contraseña */
    'Contraseña actual': 'Current password',
    'Nueva contraseña': 'New password',
    'Mínimo 8 caracteres': 'Minimum 8 characters',
    'Cancelar': 'Cancel',
    'Cambiar': 'Change',

    /* Admin — dialog de confirmación */
    'Confirmar acción': 'Confirm action',
    '¿Deseas continuar?': 'Continue?',
    'Esta acción requiere confirmación.': 'This action requires confirmation.',
    'Continuar': 'Continue',

    /* Admin — toasts y resultados comunes */
    'Guardado': 'Saved',
    'Guardado correctamente': 'Saved successfully',
    'Error al guardar': 'Save failed',
    'Operación exitosa': 'Operation successful',
    'Error': 'Error',
    'Éxito': 'Success',
    'Usuario creado': 'User created',
    'Usuario eliminado': 'User deleted',
    'Usuario actualizado': 'User updated',
    'No se pudo completar la operación': 'Could not complete the operation',
    'Sin conexión con el servidor': 'No connection to the server',
    'Acción confirmada': 'Action confirmed',
    'Modelo entrenado': 'Model trained',
    'Entrenando modelo…': 'Training model…',
    'Puerta abierta': 'Door opened',
    'Contraseña actualizada': 'Password updated',
    'La contraseña debe tener al menos 8 caracteres':
      'The password must be at least 8 characters long',
    'Contraseña actual incorrecta': 'Current password is incorrect',

    /* Admin — accesos: motivos y resultados de log */
    'Autorizado': 'Authorized',
    'Denegado': 'Denied',
    'Manual': 'Manual',
    'Bloqueado': 'Blocked',
    'Sin coincidencia': 'No match',
    'Rostro desconocido': 'Unknown face',
    'Persona': 'Person',
    'Resultado': 'Result',
    'Confianza': 'Confidence',
    'Fecha': 'Date',
    'Hora': 'Time',
    'Motivo': 'Reason',
    'Acciones': 'Actions',
    'Eliminar': 'Delete',
    'Editar': 'Edit',
    'Guardar': 'Save',
    'Sin resultados': 'No results',
    'Sin datos': 'No data',
    'Cargando datos…': 'Loading data…',

    /* Enrollment view */
    'Registro facial': 'Face enrollment',
    'Primero elige a la persona. Después la cámara guiará los movimientos.':
      'First choose the person. Then the camera will guide the movements.',
    'Enrolar persona': 'Enroll person',
    'Selecciona una persona': 'Select a person',
    'Elige una persona...': 'Choose a person...',
    'Elige quién se va a registrar.': 'Choose who will be enrolled.',
    'Antes de empezar': 'Before starting',
    'Buena luz, sin sombras en el rostro': 'Good light, no shadows on the face',
    'Rostro centrado y fondo limpio': 'Centered face and clean background',
    'Sin gorras ni lentes que tapen el rostro': 'No hats or glasses covering the face',
    'Verificando...': 'Checking...',
    'Cámara': 'Camera',
    'Comenzar': 'Start',
    'Solo una persona': 'Only one person',
    'Iniciar enrolamiento': 'Start enrollment',
    'Detener enrolamiento': 'Stop enrollment',
    'Reiniciar': 'Restart',
    'Capturar': 'Capture',
    'Cancelar enrolamiento': 'Cancel enrollment',
    'Entrenar y terminar': 'Train and finish',
    'Guardar sin entrenar': 'Save without training',
    'Enrolamiento completado': 'Enrollment complete',
    'Enrolamiento cancelado': 'Enrollment cancelled',
    'Paso completado': 'Step complete',
    'Centra tu rostro en la guia': 'Center your face in the guide',
    'Mejora la iluminacion': 'Improve lighting',
    'Mantente quieto...': 'Hold still...',
    'No se pudo capturar la muestra': 'Could not capture sample',
    'Se interrumpio la captura': 'Capture interrupted',
    'Frontal': 'Front',
    'Mirando al frente': 'Looking forward',
    'Inclina la cabeza hacia la izquierda': 'Tilt your head to the left',
    'Inclina la cabeza hacia la derecha': 'Tilt your head to the right',
    'Mira hacia arriba': 'Look up',
    'Mira hacia abajo': 'Look down',
    'Gira la cabeza a la izquierda': 'Turn your head left',
    'Gira la cabeza a la derecha': 'Turn your head right',
    'Sigue las instrucciones': 'Follow the instructions',
    'Coloca tu rostro frente a la camara': 'Place your face in front of the camera',
    'Perfecto, mantente quieto': 'Perfect, hold still',
    'Completa primero la posicion central': 'Complete the center position first',
    'No se detecta tu rostro de frente': 'Your face is not detected from the front',
    'No se detecta tu rostro': 'Your face is not detected',
    'Muevete a la derecha': 'Move to the right',
    'Muevete a la izquierda': 'Move to the left',
    'Baja un poco': 'Move down a bit',
    'Sube un poco': 'Move up a bit',
    'Paso desconocido': 'Unknown step',
    'Capturando…': 'Capturing…',
    'Listo': 'Ready',

    /* Admin — diagnóstico (rows típicos) */
    'Cámara': 'Camera',
    'Modelo': 'Model',
    'Almacenamiento': 'Storage',
    'En línea': 'Online',
    'Desconectada': 'Disconnected',
    'Cargado': 'Loaded',
    'No cargado': 'Not loaded',
    'Operativo': 'Operational',
    'Degradado': 'Degraded',
    'Error de hardware': 'Hardware error',
    'Estado del sistema': 'System status',
    'Reconocimiento facial': 'Face recognition',
    'Control de puerta': 'Door control',
    'Reinicia el servidor para activar diagnóstico':
      'Restart the server to enable diagnostics',
    'No se pudo obtener el diagnóstico': 'Could not load diagnostics',
    'El servidor está corriendo una versión sin los nuevos endpoints. Reinicia el proceso (Ctrl+C y vuelve a ejecutar) para que carguen.':
      'The server is running a version without the new endpoints. Restart the process (Ctrl+C and run again) so they load.',
    'Detalle técnico': 'Technical detail',
    'GB libres de': 'GB free of',

    /* Admin — runtime fragments (admin.js) */
    'sin hora': 'no time',
    'Sin confianza': 'No confidence',
    'confianza': 'confidence',
    'Camara en linea': 'Camera online',
    'camara degradada': 'camera degraded',
    'camara con error': 'camera with error',
    'camara fuera de linea': 'camera offline',
    'modelo cargado': 'model loaded',
    'modelo con error': 'model with error',
    'modelo no cargado': 'model not loaded',
    'puerta lista': 'door ready',
    'puerta en simulacion': 'door in simulation',
    'puerta con alerta': 'door with alert',
    'puerta sin estado': 'door without state',
    'y': 'and',
    'Sin dato': 'No data',
    'Activo': 'Active',
    'Inactivo': 'Inactive',
    'Activa': 'Active',
    'Inactiva': 'Inactive',
    'No abre la puerta': 'Does not open the door',
    'Falta rostro': 'Face missing',
    'Necesita registro facial': 'Needs face enrollment',
    'Falta entrenar': 'Training needed',
    'Actualizar modelo': 'Update model',
    'Puede ser reconocida': 'Can be recognized',
    'Registrar rostro': 'Enroll face',
    'Entrenar': 'Train',
    'Ver': 'View',
    'persona registrada': 'registered person',
    'personas registradas': 'registered people',
    'de': 'of',
    'foto guardada': 'saved photo',
    'fotos guardadas': 'saved photos',
    'fotos': 'photos',
    'estado': 'status',
    'Últimos accesos': 'Recent access',
    'Sin accesos recientes': 'No recent access',
    'Cerrar detalle': 'Close detail',
    'Crea la primera persona para iniciar el registro facial.':
      'Create the first person to start face enrollment.',
    'Registrar': 'Enroll',
    'Activar': 'Activate',
    'Desactivar': 'Deactivate',
    'Eliminar usuario': 'Delete user',
    'ID': 'ID',
    'Estado': 'Status',
    'Accion': 'Action',
    'Sin personas registradas': 'No registered people',
    'Sin registros': 'No records',
    'Crea la primera identidad activa.': 'Create the first active identity.',
    'Agrega identidad y valida actividad reciente.':
      'Add an identity and review recent activity.',
    'Revisa lo ultimo antes de seguir.': 'Review the latest before continuing.',
    'Valida actividad y mantén actualizado el padrón.':
      'Validate activity and keep the registry up to date.',
    'Critico': 'Critical',
    'Ultimo evento': 'Last event',
    'Corrige la falla antes de seguir.': 'Fix the fault before continuing.',
    'Preparacion': 'Setup',
    'Agrega la primera identidad para habilitar reconocimiento.':
      'Add the first identity to enable recognition.',
    'Ultimo intento bloqueado': 'Last attempt blocked',
    'Ultimo intento rechazado': 'Last attempt rejected',
    'Actividad que conviene revisar': 'Activity worth reviewing',
    'fallos seguidos': 'consecutive failures',
    'rechazo(s) hoy': 'rejection(s) today',
    'Revision': 'Review',
    'Atencion inmediata': 'Immediate attention',
    '': 'Quick access',
    'Revision recomendada': 'Review recommended',
    'Sistema listo': 'System ready',
    'persona': 'person',
    'personas': 'people',
    'hoy': 'today',
    'sin actividad hoy': 'no activity today',
    'reconocidos': 'recognized',
    'ultimo evento': 'last event',
    'Vigilar': 'Monitor',
    'Estable': 'Stable',
    'Desconocido': 'Unknown',
    'segundo': 'second',
    'segundos': 'seconds',
    'Reconocido': 'Recognized',
    'Rechazado': 'Rejected',

    /* Admin — confirm dialog copy */
    'Estado de persona': 'Person status',
    'Activar usuario': 'Activate user',
    'Desactivar usuario': 'Deactivate user',
    'Se actualizara el estado operativo de la persona con ID':
      'The operational status of the person with ID will be updated',
    'actualizado': 'updated',
    'Persona activada': 'Person activated',
    'Persona desactivada': 'Person deactivated',
    'No se pudo actualizar': 'Could not update',
    'Accion irreversible': 'Irreversible action',
    'sera eliminado junto con sus muestras y su relacion con los accesos. Esta accion no se puede deshacer.':
      'will be deleted along with their samples and access history. This action cannot be undone.',
    'fue eliminado': 'was deleted',
    'No se pudo eliminar': 'Could not delete',
    'Persona registrada': 'Person registered',
    'registrado': 'registered',
    'Abriendo registro de rostro': 'Opening face enrollment',
    'Registrar ahora': 'Enroll now',
    'fue agregado': 'was added',
    'No se pudo crear': 'Could not create',
    'No se pudo cargar detalle': 'Could not load detail',
    'Entrenamiento final': 'Final training',
    'Se usaran las muestras guardadas para reconocer a las personas registradas.':
      'Saved samples will be used to recognize registered people.',
    'Espera un momento': 'Wait a moment',
    'No se pudo entrenar': 'Could not train',
    'Reentrenamiento': 'Retraining',
    'Actualizar modelo facial': 'Update face model',
    'Se generara un nuevo modelo con las muestras actuales y reemplazara al modelo en uso.':
      'A new model will be generated with current samples, replacing the active model.',
    'Reentrenar': 'Retrain',
    'Procesando...': 'Processing...',
    'Entrenando modelo...': 'Training model...',
    'Esto puede tardar unos segundos': 'This may take a few seconds',
    'Entrenado con': 'Trained with',
    'muestras de': 'samples from',
    'Entrenamiento completado': 'Training complete',
    'Error de entrenamiento': 'Training error',
    'Abrir': 'Open',
    'Se enviará un pulso al actuador para abrir la puerta manualmente.':
      'A pulse will be sent to the actuator to open the door manually.',
    'Comando enviado al actuador': 'Command sent to actuator',
    'No se pudo abrir': 'Could not open',
    'Ajuste guardado': 'Setting saved',
    'Configuración aplicada': 'Settings applied',
    'No se pudo guardar': 'Could not save',
    'Sesion invalida o error de carga': 'Invalid session or load error',
    'Vuelve a iniciar sesion administrativa': 'Sign in to the admin panel again',

    /* Admin — password sheet */
    'Completa ambos campos.': 'Fill in both fields.',
    'La nueva contraseña debe tener al menos 8 caracteres.':
      'The new password must be at least 8 characters long.',
    'Guardando…': 'Saving…',
    'No se pudo cambiar la contraseña.': 'Could not change the password.',
    'Los cambios se aplicaron correctamente': 'Changes applied successfully',

    /* Admin — generic error fallback */
    'No se pudo completar la operacion': 'Could not complete the operation',
    'No se pudo entrenar el modelo.': 'Could not train the model.',

    /* Enrollment — runtime fragments (enrollment-controller.js) */
    'Mira de frente': 'Look forward',
    'Inclina hacia la izquierda': 'Tilt to the left',
    'Inclina hacia la derecha': 'Tilt to the right',
    'Mira hacia arriba': 'Look up',
    'Mira hacia abajo': 'Look down',
    'Gira a la izquierda': 'Turn left',
    'Gira a la derecha': 'Turn right',
    'Seleccionar persona...': 'Select a person...',
    'Selecciona una persona para iniciar': 'Select a person to start',
    'Prepara la iluminacion y centra el rostro antes de comenzar.':
      'Prepare lighting and center the face before starting.',
    'Sin sesion activa': 'No active session',
    'Sin seleccionar': 'Not selected',
    'Revision final': 'Final review',
    'Atencion': 'Attention',
    'Capturando': 'Capturing',
    'Capturando de frente': 'Capturing front view',
    'Por favor, remueve los lentes': 'Please remove your glasses',
    'Entrenando modelo...': 'Training model...',
    'Las muestras se guardaron': 'Samples saved',
    'El modelo se puede entrenar despues desde Sistema': 'Model can be trained later from System',
    'Modelo actualizado': 'Model updated',
    'muestras de': 'samples from',
    'Guiado': 'Guided',
    'Sesion detenida': 'Session paused',
    'foto': 'photo',
    'muestras': 'samples',
    'total': 'total',
    'muestras listas para entrenar': 'samples ready to train',
    'muestras capturadas': 'samples captured',
    'Se detuvo el enrolamiento': 'Enrollment stopped',
    'Revisa la sesion y vuelve a intentarlo.':
      'Review the session and try again.',

    /* Enrollment — readiness panel */
    'En linea': 'Online',
    'Disponible con alerta': 'Available with alert',
    'En reposo': 'Sleeping',
    'Fuera de linea': 'Offline',
    'Con error': 'With error',
    'Sin verificar': 'Unverified',
    'Lista': 'Ready',
    'Bloquea inicio': 'Blocks start',
    'Disponible': 'Available',
    'Informativo': 'Informational',
    'Sistema listo para capturar': 'System ready to capture',
    'Hace falta revisar la camara': 'Camera needs review',

    /* Enrollment — toast strings (translated via showAdminToast → tr) */
    'No se pudieron cargar las personas': 'Could not load people',
    'No se pudo verificar el sistema': 'Could not verify the system',
    'Se perdio la sesion de enrolamiento': 'Enrollment session lost',
    'No se pudo recuperar la sesion': 'Could not recover the session',
    'Selecciona una persona': 'Select a person',
    'La camara no esta lista': 'The camera is not ready',
    'No se pudo iniciar': 'Could not start',
    'Error al iniciar': 'Start error',
    'No se pudo reiniciar el paso': 'Could not restart the step',
    'Error al repetir el paso': 'Step retry error',
    'Modelo actualizado': 'Model updated',
    'No se pudo entrenar ahora': 'Could not train now',
    'Las muestras quedaron guardadas para entrenar despues desde Sistema.':
      'Samples are saved to train later from System.',
    'No se pudo cerrar la sesion': 'Could not close the session',

    /* Enrollment — confirm dialogs (translated via openAdminConfirm → tr) */
    'Se perdera el progreso capturado en esta sesion y tendras que comenzar de nuevo.':
      'Progress captured in this session will be lost and you will need to start over.',
    'La sesion seguira disponible para retomarla despues, pero la captura se pausara al volver a Personas.':
      'The session will remain available to resume later, but capture will pause when returning to People.',
    'Se usaran las muestras nuevas para generar un modelo actualizado y reemplazar el modelo activo.':
      'The new samples will be used to generate an updated model and replace the active one.',
    'Esta accion requiere confirmacion.': 'This action requires confirmation.',

    /* Enrollment — camera readiness notes */
    'No se pudo verificar el estado de la camara.':
      'Could not verify camera status.',
    'La camara esta disponible, aunque con estado degradado.':
      'The camera is available but in a degraded state.',
    'La camara esta lista para iniciar la captura.':
      'The camera is ready to start capture.',
    'La camara esta en reposo. Reactiva el sistema antes de iniciar.':
      'The camera is sleeping. Reactivate the system before starting.',
    'La camara no esta lista. Revisa la conexion antes de iniciar.':
      'The camera is not ready. Check the connection before starting.',
  };

  /* ── Estado ── */

  function readLang() {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return SUPPORTED.includes(v) ? v : DEFAULT_LANG;
    } catch (_) {
      return DEFAULT_LANG;
    }
  }

  function writeLang(lang) {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (_) {
      /* storage bloqueado — continuar sin persistir */
    }
  }

  let currentLang = readLang();

  /* ── Core ── */

  function t(text) {
    if (text == null) return text;
    const str = String(text);
    if (currentLang === 'es') return str;
    return Object.prototype.hasOwnProperty.call(DICT_EN, str)
      ? DICT_EN[str]
      : str;
  }

  function snapshotOriginal(el, attr, prop) {
    const key = `_i18nOriginal_${prop}`;
    if (el[key] === undefined) {
      el[key] = prop === 'innerHTML' ? el.innerHTML : el.textContent;
    }
    return el[key];
  }

  function applyNode(el) {
    if (el.hasAttribute('data-i18n')) {
      const original = snapshotOriginal(el, 'data-i18n', 'textContent');
      el.textContent = t(original);
    }
    if (el.hasAttribute('data-i18n-html')) {
      const original = snapshotOriginal(el, 'data-i18n-html', 'innerHTML');
      el.innerHTML = t(original);
    }
    if (el.hasAttribute('data-i18n-attr')) {
      /* Formato: "attr1:clave1;attr2:clave2" — la clave es el texto en español */
      const spec = el.getAttribute('data-i18n-attr');
      spec.split(';').forEach((pair) => {
        const idx = pair.indexOf(':');
        if (idx < 0) return;
        const attr = pair.slice(0, idx).trim();
        const key = pair.slice(idx + 1).trim();
        if (attr && key) el.setAttribute(attr, t(key));
      });
    }
  }

  function applyAll(root) {
    const scope = root || document;
    const nodes = scope.querySelectorAll(
      '[data-i18n], [data-i18n-html], [data-i18n-attr]'
    );
    nodes.forEach(applyNode);
  }

  function setLang(lang) {
    if (!SUPPORTED.includes(lang)) return;
    if (lang === currentLang) return;
    currentLang = lang;
    writeLang(lang);
    document.documentElement.lang = lang;
    applyAll();
    renderToggleButton();
    document.dispatchEvent(
      new CustomEvent('i18n:change', { detail: { lang } })
    );
  }

  function getLang() {
    return currentLang;
  }

  function onChange(handler) {
    document.addEventListener('i18n:change', (ev) => handler(ev.detail.lang));
  }

  /* ── MutationObserver para nodos inyectados en runtime ── */

  const observer = new MutationObserver((mutations) => {
    if (currentLang === 'es') return; /* nativo — nada que hacer */
    for (const m of mutations) {
      if (m.type === 'childList') {
        m.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          if (
            node.hasAttribute('data-i18n') ||
            node.hasAttribute('data-i18n-html') ||
            node.hasAttribute('data-i18n-attr')
          ) {
            applyNode(node);
          }
          if (node.querySelectorAll) applyAll(node);
        });
      } else if (m.type === 'attributes') {
        applyNode(m.target);
      }
    }
  });

  /* ── Botón flotante (solo kiosk) ── */

  /* Icono neutral de globo terráqueo. Sin emojis, líneas finas, escalable. */
  const GLOBE_ICON_SVG = `
<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"
     fill="none" stroke="currentColor" stroke-width="1.6"
     stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="9"/>
  <ellipse cx="12" cy="12" rx="4.5" ry="9"/>
  <path d="M3 12h18"/>
  <path d="M4 7.5h16"/>
  <path d="M4 16.5h16"/>
</svg>`.trim();

  function ensureButton() {
    let btn = document.getElementById('i18nToggleBtn');
    if (btn) return btn;
    btn = document.createElement('button');
    btn.id = 'i18nToggleBtn';
    btn.type = 'button';
    btn.className = 'i18n-toggle';
    btn.setAttribute('aria-label', 'Cambiar idioma');
    btn.addEventListener('click', () => {
      setLang(currentLang === 'es' ? 'en' : 'es');
    });
    (document.body || document.documentElement).appendChild(btn);
    return btn;
  }

  function renderToggleButton() {
    const btn = document.getElementById('i18nToggleBtn');
    if (!btn) return;
    /* Botón neutro: siempre globo. La etiqueta indica al idioma destino:
       en ES muestra "EN" (acción = pasar a inglés), en EN muestra "ES". */
    const targetLabel = currentLang === 'es' ? 'EN' : 'ES';
    btn.innerHTML = `
      <span class="i18n-toggle__icon">${GLOBE_ICON_SVG}</span>
      <span class="i18n-toggle__label">${targetLabel}</span>
    `;
    btn.setAttribute(
      'title',
      currentLang === 'es' ? 'Switch to English' : 'Cambiar a Español'
    );
  }

  function mountButton() {
    ensureButton();
    renderToggleButton();
  }

  /* ── Bootstrap ── */

  function boot() {
    document.documentElement.lang = currentLang;
    applyAll();

    /* Solo monta el botón si el template lo pide explícitamente
       (data-i18n-toggle="true" en <html> o <body>). Así admin/login
       heredan el idioma pero no muestran el botón. */
    const wantsToggle =
      document.documentElement.dataset.i18nToggle === 'true' ||
      document.body?.dataset.i18nToggle === 'true';
    if (wantsToggle) mountButton();

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-i18n', 'data-i18n-html', 'data-i18n-attr'],
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  window.i18n = { t, setLang, getLang, applyAll, onChange };
})();

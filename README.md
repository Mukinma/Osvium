# Vireom

Sistema biometrico facial embebido para control de acceso fisico. Ejecuta deteccion, reconocimiento y decision sobre Raspberry Pi 5 sin conexion a internet, sin deep learning y sin servicios de terceros.

## Contexto

Los sistemas de control de acceso biometrico comerciales dependen de servicios cloud, hardware propietario o modelos de deep learning. Vireom demuestra que un sistema funcional y medible puede construirse con algoritmos clasicos de vision por computadora sobre hardware de bajo coste.

## Stack tecnico

| Capa | Tecnologia |
|---|---|
| Lenguaje | Python 3.9+ |
| Vision | OpenCV 4 (contrib) -- Haar Cascades, LBPH |
| Backend | FastAPI, Uvicorn |
| Frontend | HTML, CSS, Vanilla JS (sin frameworks) |
| Base de datos | SQLite 3 (WAL mode) |
| Hardware | Raspberry Pi 5, GPIO, Rele 12 V |
| Templates | Jinja2 |

## Pipeline de reconocimiento

```
Frame -> Grayscale -> Haar Cascade -> ROI -> Resize 200x200 -> LBPH -> Umbral -> Decision -> Registro -> GPIO
```

Cada frame pasa por deteccion facial con Haar Cascade frontal, extraccion del ROI en escala de grises, redimensionado a 200x200 px y prediccion LBPH. Si la confianza supera el umbral configurado, el sistema registra el acceso y activa el rele GPIO.

## Estructura del proyecto

```
Vireom/
  main.py                   Punto de entrada y orquestador de hilos
  config.py                 Configuracion centralizada (dataclass + .env)
  init_db.py                Inicializacion de la base de datos
  api/routes.py             Endpoints REST (FastAPI)
  database/db.py            Capa de acceso a SQLite
  vision/
    camera.py               Captura de camara (hilo dedicado)
    detector.py             Deteccion Haar Cascade
    recognizer.py           Reconocimiento LBPH
    trainer.py              Entrenamiento del modelo
    enrollment.py           Maquina de estados de enrolamiento
    pose_heuristic.py       Heuristicas de pose facial
    face_guidance.py        Guia visual de posicion facial
    secure_storage.py       Almacenamiento cifrado de biometricos (AES-128-CBC)
  hardware/gpio_control.py  Control de rele GPIO
  frontend/
    templates/              Jinja2 (kiosco, login, admin)
    static/                 CSS, JS, fuentes, iconos
  models/                   Modelo LBPH entrenado (.xml)
  dataset/                  Imagenes de entrenamiento por usuario
```

## Enrolamiento facial

El modulo de enrolamiento implementa una FSM que controla la captura de muestras faciales desde el panel de administracion.

- Captura automatica de 20 fotos frontales por usuario.
- Deteccion de lentes mediante comparacion de cascadas Haar (haarcascade_eye vs haarcascade_eye_tree_eyeglasses). Si detecta lentes, bloquea la captura.
- Validaciones en tiempo real: iluminacion insuficiente, multiples rostros, cara fuera de guia, cara perdida.
- Hold steady de 600 ms antes de cada captura para garantizar estabilidad.
- Interfaz minima: stream de camara, barra de progreso y boton de cancelar.

## Seguridad

- Sesiones con SessionMiddleware y proteccion CSRF en todos los endpoints de escritura.
- Cifrado opcional de datos biometricos en reposo (AES-128-CBC via Fernet).
- Sin transmision de datos biometricos a servicios externos.
- Validacion de entradas con Pydantic.

## Instalacion

```bash
git clone https://github.com/Mukinma/Vireom.git
cd Vireom
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env       # Editar con valores propios
python init_db.py
```

## Ejecucion

```bash
python main.py
```

| Vista | URL |
|---|---|
| Kiosco (operacion) | `http://<IP>:8000/` |
| Administracion | `http://<IP>:8000/admin` |

Modo escritorio sin navegador: `python desktop_launcher.py` (usa pywebview, abre en fullscreen).

## Variables de entorno

Configurables en `.env`. Ver `.env.example` para referencia completa.

| Variable | Descripcion | Default |
|---|---|---|
| `CAMERAPI_DEBUG` | Modo desarrollo | `false` |
| `CAMERAPI_SECRET` | Clave secreta para sesiones | Obligatorio en produccion |
| `CAMERAPI_ADMIN_USER` | Usuario administrador | `admin` |
| `CAMERAPI_ADMIN_PASSWORD` | Contrasena administrador | `""` |
| `CAMERAPI_STORAGE_ENCRYPTED` | Cifrado de biometricos en reposo | `0` |
| `CAMERAPI_LIVENESS_ENABLED` | Anti-spoofing (vision clasica) | `0` |
| `CAMERAPI_CAMERA_FLIP_HORIZONTAL` | Correccion de espejo horizontal | `true` |

## Validacion experimental

| Script | Proposito |
|---|---|
| `cross_validation.py` | K-Fold estratificado por usuario (k=5) |
| `session_validation.py` | Evaluacion entre sesiones temporales |
| `real_session_validation.py` | Evaluacion bidireccional entre sesiones reales A/B |
| `statistical_analysis.py` | Calculo de FAR, FRR, EER, Accuracy, Precision, Recall |
| `calibrate_threshold.py` | Calibracion del umbral de confianza |
| `experimental_validation.py` | Generacion de predicciones genuinas/impostor |
| `generate_plots.py` | Histogramas, curvas ROC, distribuciones |
| `bootstrap_dataset.py` | Procesamiento y carga inicial de imagenes |
| `train_model.py` | Entrenamiento LBPH desde CLI |
| `soak_test.py` | Prueba de estabilidad continua (health check periodico) |
| `prevalidate_and_soak.py` | Prevalidacion completa + soak de 2 horas |

## Health check

- `GET /health` -- endpoint publico minimo.
- `GET /api/health/detail` -- valida camara, modelo, BD, GPIO e incluye metricas (avg_recognition_ms, fps, failed_attempts_consecutive).

## Licencia

MIT

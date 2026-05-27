# Osvium
Sistema de control de acceso mediante reconocimiento facial embebido. Funciona sobre Raspberry Pi 5 sin conexion a internet, sin deep learning y sin servicios de terceros.

## Acerca del proyecto

Osvium es un sistema biometrico facial disenado para controlar el acceso fisico en instalaciones. Utiliza algoritmos clasicos de vision por computadora para detectar y reconocer rostros en tiempo real, operando de forma completamente offline sobre hardware de bajo coste.

Desarrollado como proyecto academico para el Puerto de Manzanillo.

## Caracteristicas

-Reconocimiento facial en tiempo real con algoritmos clasicos de vision por computadora
-Funcionamiento completamente offline, sin dependencia de servicios cloud
-Enrolamiento facial guiado con validaciones automaticas (iluminacion, pose, lentes)
-Panel de administracion web para gestion de usuarios y monitoreo
-Modo kiosco para operacion en punto de acceso
-Cifrado de datos biometricos en reposo
-Control de acceso fisico mediante rele GPIO

## Tecnologias utilizadas

Python 3.9+
OpenCV 4 (Haar Cascades, LBPH)
FastAPI + Uvicorn
SQLite 3
Jinja2 + HTML/CSS/JS
Raspberry Pi 5 + GPIO

## Instalacion

git clone https://github.com/Mukinma/Osvium.git
cd Osvium
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python init_db.py

## Ejecucion

python main.py


| Vista | URL |
|---|---|
| Kiosco (operacion) | `http://<IP>:8000/` |
| Administracion | `http://<IP>:8000/admin` |

## Licencia

Este proyecto es de uso academico.


## Desarrolladores

-Ballesteros Cobian Erick Santiago
-Contreras Avalos Fatima Isabel
-Cuervas Cervantes Ximena
-Hernandez Mendoza Josefina Guadalupe
-Nieves Martinez Christopher Eugenio

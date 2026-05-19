---
name: feature-gap-audit
description: Detecta brechas funcionales en Vireom. Úsala para identificar qué funcionalidades faltan, cuáles están parciales y cuáles deberían existir según el tipo de sistema que Vireom pretende ser.
argument-hint: "[ruta, módulo o contexto opcional]"
context: fork
agent: Explore
allowed-tools: Read Grep Glob
---

# Feature Gap Audit for Vireom

Tu trabajo es actuar como un product minded software architect senior.

## Objetivo

Evaluar Vireom como producto de software, no solo como conjunto de archivos.

Debes identificar qué funcionalidades:

- ya existen y aportan valor real
- existen parcialmente
- faltan por completo
- sobran o desvían foco
- deberían existir por el tipo de sistema que Vireom quiere ser

## Contexto del sistema

Asume que Vireom pretende ser un sistema biométrico facial local para control de acceso, con procesamiento embebido o local, administración básica, flujo de reconocimiento en tiempo real y capacidad de operar como demo funcional seria.

Por ello, la auditoría debe revisar si el sistema cubre de forma razonable estos grupos funcionales:

### Núcleo biométrico
- captura
- detección
- alineación
- enrolamiento
- entrenamiento
- reconocimiento
- decisión de autorización

### Operación del sistema
- arranque
- configuración
- cambio de parámetros
- control del stream
- reinicio o recuperación de errores
- estado de salud

### Gestión administrativa
- alta de usuarios
- edición o baja
- consulta de registros
- parámetros de operación
- administración de sesiones o acceso administrativo

### Trazabilidad operativa
- registro de accesos
- registro de errores
- eventos relevantes
- estado del modelo
- estado de cámara
- estado del hardware

### Integración física o simulada
- activación de acceso
- respuesta ante fallo de hardware
- modo mock o modo seguro
- separación entre simulación y operación real

## Cómo pensar

No te preguntes solo “¿hay código?”
Pregúntate:

- ¿esta funcionalidad realmente existe como comportamiento?
- ¿está cerrada de punta a punta?
- ¿está integrada en el flujo real?
- ¿se siente suficiente para el tipo de sistema que es?
- ¿falta algo importante que el usuario final o el operador esperaría?

## Reglas duras

- No hagas una lista abstracta de features genéricas.
- Debes evaluar contra el tipo específico de sistema que es Vireom.
- No conviertas esto en revisión académica.
- No conviertas esto en revisión puramente técnica de refactor.
- Si una feature existe pero está claramente parcial, márcala como parcial.
- Si una feature no existe pero debería existir razonablemente, dilo.
- Si una feature parece bonita pero secundaria, dilo.
- Prioriza funciones core antes que extras.

## Clasificación requerida

Debes clasificar cada hallazgo como una de estas:

- **Funcionalidad sólida**
- **Funcionalidad parcial**
- **Funcionalidad ausente**
- **Funcionalidad débil**
- **Funcionalidad secundaria**
- **Funcionalidad innecesaria o de bajo valor**

## Qué debes detectar

### Brechas funcionales típicas
- enrolamiento no completamente cerrado
- entrenamiento no integrado al flujo admin
- reconocimiento sin consecuencias claras en el sistema
- logs poco útiles
- panel admin limitado
- configuración solo parcial
- flujo de error pobre
- ausencia de estados del sistema
- falta de rollback o recuperación
- falta de feedback claro al operador
- falta de distinción entre modo demo y modo real

### Brechas de experiencia operativa
- operador no sabe qué está pasando
- usuario no entiende cómo colocarse o qué hacer
- flujo se rompe ante entradas inválidas
- estados ambiguos
- acciones sin confirmación o sin resultado visible

### Brechas del producto
- falta de visión de ciclo completo
- falta de administración usable
- falta de control real sobre parámetros importantes
- falta de monitoreo mínimo para operar con confianza

## Formato de salida

## Resumen ejecutivo
Explica qué tan completo se siente Vireom como sistema.

## Funcionalidades sólidas
Incluye solo las que realmente estén útiles y conectadas.

## Funcionalidades parciales o débiles
Explica qué existe pero todavía no cierra bien.

## Funcionalidades ausentes importantes
Lista lo que falta para que el sistema se sienta completo y coherente.

## Funcionalidades secundarias
Marca lo que puede esperar y no debe distraer ahora.

## Funcionalidades de bajo valor o innecesarias
Marca lo que parece aportar poco al objetivo principal.

## Gap principal del producto
Resume la mayor carencia funcional del sistema actual.

## Siguiente bloque funcional recomendado
Propón una sola línea de avance funcional que maximice valor real.

## Estilo esperado

- Piensa como arquitecto con sensibilidad de producto.
- Sé concreto.
- No seas académico.
- No seas complaciente.
- Prioriza cierre funcional real.
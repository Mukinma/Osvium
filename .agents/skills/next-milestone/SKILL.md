---
name: next-milestone
description: Define el siguiente hito correcto para Vireom. Úsala cuando quieras saber exactamente qué sigue, en qué orden hacerlo, qué entregar y cómo saber si quedó bien.
argument-hint: "[fase actual, fecha límite o contexto opcional]"
context: fork
agent: Plan
allowed-tools: Read Grep Glob
---

# Next Milestone Planner for Vireom

Tu trabajo es convertir el estado actual de **Vireom** en un **solo hito siguiente**, claro, ejecutable y defendible.

## Propósito

No debes generar una lista infinita de tareas.
Debes elegir el **próximo bloque de trabajo correcto**, con foco, orden y criterio de terminado.

## Marco del proyecto

Asume, salvo evidencia contraria, que Vireom:

- es un proyecto integrador académico
- tiene restricciones técnicas y metodológicas
- necesita coherencia entre documentación, arquitectura, implementación y evidencia
- debe llegar a una defensa o entrega formal
- no solo necesita “hacer cosas”, sino demostrar que están bien hechas

## Cómo decidir el siguiente hito

### Paso 1. Entiende la situación actual
Busca y resume:

- qué ya existe
- qué falta
- qué está bloqueado
- qué se acerca como entregable o defensa
- qué dependencias impiden avanzar
- qué pieza produciría el mayor avance neto

Si el usuario dio `$ARGUMENTS`, úsalo para contextualizar la planificación.

### Paso 2. Elige un solo hito principal
Elige un solo hito que cumpla la mayor cantidad posible de estos criterios:

- reduce riesgo importante
- desbloquea trabajo posterior
- genera evidencia útil
- acerca al proyecto a un estado defendible
- tiene alcance razonable
- se puede verificar con claridad

No propongas un hito ornamental si aún falta base estructural.

### Paso 3. Descompón el hito
Convierte el hito en un plan ejecutable con:

- objetivo concreto
- entregables
- subtareas ordenadas
- dependencias
- criterio de aceptación
- evidencia esperada

### Paso 4. Ajusta el alcance
Evita que el hito quede:

- demasiado grande para ejecutarse
- demasiado pequeño para mover el proyecto
- ambiguo
- dependiente de supuestos no validados

Si el hito correcto es demasiado grande, divídelo en una versión alcanzable sin perder valor.

## Reglas duras

- Debes elegir **un hito principal**.
- No des roadmap genérico de varias fases futuras salvo una nota breve al final.
- No confundas actividad con avance.
- No propongas implementar algo si antes falta definición crítica.
- No propongas documentación decorativa si la carencia real es técnica.
- No propongas refactor por estética si faltan piezas básicas o evidencia.
- Si detectas que el proyecto necesita cerrar una contradicción antes de construir, dilo y usa eso como hito.

## Formato de salida

## Lectura del estado actual
Resume qué asumes y en qué evidencia te basas.

## Hito siguiente recomendado
Nombra el hito en una frase breve y específica.

## Por qué este hito y no otro
Justifica la elección con lógica de prioridad.

## Resultado esperado
Describe qué debe existir al finalizar.

## Alcance exacto
Define qué sí entra y qué no entra en este hito.

## Subtareas en orden
Usa una secuencia clara y dependiente.

Para cada subtarea indica:
- objetivo
- salida esperada
- dependencia previa, si existe

## Criterio de terminado
Debes poder responder sí o no.
Incluye criterios verificables, no subjetivos.

## Evidencia mínima requerida
Incluye exactamente qué debe existir, por ejemplo:
- documento actualizado
- diagrama corregido
- módulo implementado
- prueba ejecutada
- captura o video
- bitácora
- resultado de integración

## Riesgos o bloqueos
Solo los que de verdad puedan impedir cerrar el hito.

## Siguiente hito después de este
Mención breve de una sola línea para mantener continuidad.

## Estilo esperado

- Sé concreto.
- Ordena el trabajo de forma lógica.
- Haz que el plan sea accionable hoy.
- Si hace falta, traduce cosas vagas a entregables medibles.
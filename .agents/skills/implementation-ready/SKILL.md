---
name: implementation-ready
description: Evalúa si una tarea ya está suficientemente definida para implementarse sin improvisación peligrosa.
argument-hint: "[tarea, módulo o feature]"
context: fork
agent: Explore
allowed-tools: Read Grep Glob
effort: high
---

# Implementation Ready

Evalúa si `$ARGUMENTS` está listo para implementarse.

## Objetivo
Responder con claridad:
- sí, listo para implementar
- no, aún no
- listo con reservas

## Checklist
Revisa si existen:
- objetivo claro
- alcance definido
- dependencias conocidas
- entradas y salidas identificadas
- criterio de aceptación
- impacto en arquitectura
- impacto en datos
- impacto en pruebas
- riesgos conocidos

## Reglas
- No apruebes una tarea ambigua.
- Si faltan decisiones, enuméralas.
- Si el alcance es excesivo, propone corte mínimo viable.
- Si la tarea toca varias capas, dilo explícitamente.

## Salida
## Veredicto
## Qué ya está definido
## Qué falta definir
## Riesgos de implementarlo ya
## Corte mínimo viable recomendado
## Criterio de aceptación propuesto
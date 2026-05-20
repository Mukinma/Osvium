---
name: task-breakdown
description: Descompone un hito o tarea compleja en subtareas ordenadas, dependencias, criterios de aceptación y evidencia esperada.
argument-hint: "[hito o tarea]"
context: fork
agent: Plan
allowed-tools: Read Grep Glob
effort: medium
---

# Task Breakdown

Descompón `$ARGUMENTS` en un plan de ejecución claro.

## Objetivo
Transformar una tarea compleja en unidades de trabajo concretas.

## Método
- Entiende el objetivo real.
- Separa análisis, diseño, implementación, prueba y evidencia.
- Ordena subtareas por dependencia.
- Detecta decisiones que deben tomarse antes de empezar.

## Reglas
- No generes subtareas decorativas.
- No mezcles pasos de distinta granularidad.
- Cada subtarea debe producir un resultado observable.
- Marca explícitamente qué depende de qué.

## Salida
## Objetivo de la tarea
## Supuestos
## Subtareas en orden
Para cada subtarea incluye:
- propósito
- entradas
- salida esperada
- dependencia
- criterio de terminado
## Riesgos
## Evidencia mínima
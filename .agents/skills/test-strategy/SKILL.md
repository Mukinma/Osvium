---
name: test-strategy
description: Diseña una estrategia de pruebas útil para un módulo o cambio, priorizando riesgo, cobertura y evidencia verificable.
argument-hint: "[módulo, feature o cambio]"
context: fork
agent: Explore
allowed-tools: Read Grep Glob
effort: high
---

# Test Strategy

Define la estrategia de pruebas para `$ARGUMENTS`.

## Objetivo
Determinar qué probar, por qué y con qué prioridad.

## Método
- Identifica rutas críticas y comportamientos sensibles.
- Revisa pruebas existentes.
- Busca edge cases, errores, valores límite y dependencias externas.
- Propón una batería realista y de alto valor.

## Clasificación sugerida
- pruebas unitarias
- pruebas de integración
- pruebas manuales guiadas
- pruebas de regresión
- pruebas de fallos o condiciones límite

## Reglas
- No infles cobertura con casos de poco valor.
- Prioriza lo que puede romper más.
- Si no hay infraestructura de pruebas, propón alternativa viable.
- Distingue claramente entre lo automatizable y lo manual.

## Salida
## Riesgos a cubrir
## Cobertura actual observada
## Casos prioritarios
## Pruebas recomendadas por tipo
## Datos o fixtures necesarios
## Evidencia de validación esperada
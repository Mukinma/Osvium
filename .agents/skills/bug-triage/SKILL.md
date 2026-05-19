---
name: bug-triage
description: Investiga un bug, estima severidad, hipótesis de causa raíz, alcance del impacto y siguiente acción técnica más segura.
argument-hint: "[bug, síntoma o módulo]"
context: fork
agent: Explore
allowed-tools: Read Grep Glob
effort: high
---

# Bug Triage

Investiga `$ARGUMENTS` con mentalidad de diagnóstico.

## Objetivo
Producir un análisis útil antes de tocar código.

## Debes responder
- qué síntoma existe
- dónde podría originarse
- cómo reproducirlo
- qué módulos toca
- qué severidad tiene
- cuál es la hipótesis principal de causa raíz
- qué validar primero

## Reglas
- No propongas arreglar a ciegas.
- Separa síntoma de causa raíz.
- Si faltan datos para reproducir, dilo.
- Prioriza validaciones baratas y de alta señal.

## Salida
## Síntoma observado
## Contexto técnico relevante
## Hipótesis de causa raíz
## Reproducción sugerida
## Alcance del impacto
## Severidad
## Qué revisar primero
## Fix seguro propuesto
## Pruebas que deben acompañar el fix
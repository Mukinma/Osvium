---
name: project-audit
description: Audita el estado real del proyecto, separa lo sólido de lo incompleto, detecta contradicciones y decide el siguiente avance prioritario.
argument-hint: "[rutas, fase o contexto opcional]"
context: fork
agent: Explore
allowed-tools: Read Grep Glob
effort: high
---

# Project Audit

Audita el proyecto actual con criterio técnico y académico.

## Objetivo
Determinar:
1. qué está definido
2. qué está implementado
3. qué está verificado
4. qué contradicciones existen
5. cuál es el siguiente avance con mejor relación impacto-riesgo

## Método
- Prioriza README, AGENTS.md, docs, código, pruebas, scripts, bitácora y entregables.
- Si el usuario pasa `$ARGUMENTS`, úsalo como foco principal.
- Construye una lectura real, no optimista, del estado del proyecto.
- Separa siempre hecho observado de inferencia.

## Clasificación obligatoria
Para cada componente relevante usa:
- Definido
- Parcialmente definido
- Implementado
- Parcialmente implementado
- Verificado
- No encontrado
- Contradictorio

## Debes revisar
- requisitos
- arquitectura
- modelo de datos
- interfaz
- backend o lógica principal
- pruebas
- documentación
- evidencia de validación
- integración entre componentes

## Reglas
- No felicites sin evidencia.
- No confundas documentación con implementación.
- No confundas implementación con validación.
- Si algo está sobredocumentado pero poco construido, dilo.
- Si algo está construido pero mal justificado, dilo.

## Salida
## Resumen ejecutivo
## Estado por áreas
## Lo más sólido
## Lo incompleto o frágil
## Inconsistencias detectadas
## Riesgos principales
## Siguiente avance prioritario
## Evidencia mínima para darlo por válido
## Preguntas abiertas
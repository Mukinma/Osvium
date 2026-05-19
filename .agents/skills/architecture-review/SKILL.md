---
name: architecture-review
description: Revisa si la arquitectura propuesta y la implementación visible siguen siendo coherentes entre sí y con las restricciones del proyecto.
argument-hint: "[módulo, capa o contexto opcional]"
context: fork
agent: Explore
allowed-tools: Read Grep Glob
effort: high
---

# Architecture Review

Evalúa la coherencia de la arquitectura del proyecto.

## Objetivo
Determinar si existe alineación entre:
- problema y objetivos
- arquitectura declarada
- módulos reales
- flujo de datos
- integración entre capas
- restricciones técnicas
- riesgos operativos

## Debes revisar
- separación de responsabilidades
- acoplamiento entre módulos
- puntos de entrada
- dependencias críticas
- persistencia
- comunicación entre componentes
- seguridad o control de acceso, si aplica
- manejo de errores
- observabilidad y pruebas, si existen

## Busca señales de mala arquitectura
- responsabilidades mezcladas
- decisiones técnicas sin justificación
- módulos ausentes frente a la arquitectura declarada
- rutas de datos ambiguas
- dependencia circular o implícita
- interfaz y backend desalineados
- documentación atrasada respecto al código

## Salida
## Lectura de la arquitectura actual
## Componentes identificados
## Coherencias
## Incoherencias
## Riesgos arquitectónicos
## Cambios recomendados por prioridad
## Evidencia mínima para considerar la arquitectura defendible
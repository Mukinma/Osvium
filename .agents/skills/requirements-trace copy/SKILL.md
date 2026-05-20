---
name: requirements-trace
description: Traza requisitos contra documentación, arquitectura, código, pruebas y evidencia para comprobar cobertura real.
argument-hint: "[ruta de requisitos, módulo o contexto opcional]"
context: fork
agent: Explore
allowed-tools: Read Grep Glob
effort: high
---

# Requirements Trace

Construye una trazabilidad real entre requisitos y artefactos.

## Objetivo
Responder con evidencia:
- qué requisitos existen
- dónde están documentados
- dónde aparecen en diseño y arquitectura
- dónde están implementados
- dónde fueron probados
- qué carece de cobertura suficiente

## Método
1. Encuentra la fuente de requisitos.
2. Si no existe una lista formal, reconstruye una lista provisional con IDs tipo RF-01 y RNF-01.
3. Busca cobertura en documentación, arquitectura, código, pruebas y evidencia.
4. Detecta artefactos huérfanos.

## Estados permitidos
- Cobertura completa
- Cobertura parcial
- Mención sin implementación
- Implementación sin prueba
- Sin cobertura encontrada
- Cobertura contradictoria

## Reglas
- No asumas cobertura por similitud de nombre.
- Marca explícitamente cuando los requisitos sean reconstruidos.
- Si hay código sin requisito claro, señálalo.
- Si hay requisito sin prueba ni implementación visible, señálalo.

## Salida
## Fuente de requisitos
## Matriz de trazabilidad
Usa tabla con columnas:
Requisito | Descripción | Documentación | Diseño | Código | Prueba o validación | Estado
## Requisitos sin cobertura suficiente
## Cobertura contradictoria
## Artefactos huérfanos
## Recomendaciones inmediatas
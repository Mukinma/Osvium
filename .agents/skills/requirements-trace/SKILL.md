---
name: requirements-trace
description: Traza requisitos contra documentación, arquitectura, código, pruebas y evidencia en Vireom. Úsala para verificar si lo que se pide realmente está cubierto y demostrar qué falta.
argument-hint: "[ruta de requisitos, módulo o contexto opcional]"
context: fork
agent: Explore
allowed-tools: Read Grep Glob
---

# Requirements Trace for Vireom

Tu trabajo es construir una trazabilidad real entre los requisitos de **Vireom** y los artefactos del proyecto.

## Objetivo

Responder con evidencia:

1. qué requisitos existen
2. dónde están documentados
3. dónde están reflejados en la arquitectura o diseño
4. dónde aparecen en el código
5. dónde están probados o validados
6. cuáles no tienen cobertura suficiente
7. qué artefactos existen sin requisito claro asociado

## Principio central

No basta con que un requisito “aparezca mencionado”.
Debe poder trazarse, idealmente, a varios niveles:

- especificación
- diseño o arquitectura
- implementación
- prueba o validación
- evidencia

## Cómo trabajar

### Paso 1. Encuentra los requisitos
Busca primero fuentes candidatas:

- documento de requisitos
- planteamiento del problema
- objetivos
- alcance
- casos de uso
- historias de usuario
- bitácora
- entregables
- comentarios en documentación
- nombres de módulos o features

Si el usuario pasó `$ARGUMENTS`, prioriza esas rutas o ese módulo.

Si no existe una lista formal de requisitos, debes **reconstruir una lista provisional** con identificadores claros como:

- RF-01, RF-02
- RNF-01, RNF-02

Pero marca explícitamente que son provisionales y derivadas de la evidencia encontrada.

### Paso 2. Localiza cobertura por requisito
Para cada requisito, busca cobertura en:

- documentación
- diagramas o arquitectura
- modelos de datos
- interfaz
- código
- pruebas
- evidencias o validaciones

### Paso 3. Clasifica el nivel de cobertura
Usa solo una de estas clasificaciones por requisito:

- **Cobertura completa**
- **Cobertura parcial**
- **Mención sin implementación**
- **Implementación sin prueba**
- **Sin cobertura encontrada**
- **Cobertura contradictoria**

### Paso 4. Detecta artefactos huérfanos
Debes identificar también:

- módulos sin requisito claramente asociado
- pruebas que no trazan a nada claro
- documentación que describe capacidades no visibles
- código que parece exceder el alcance sin justificación

## Reglas duras

- No inventes requisitos si no puedes derivarlos razonablemente.
- Si reconstruyes requisitos provisionales, dilo de forma explícita.
- No des por válida una cobertura solo porque el nombre se parece.
- Separa evidencia fuerte de coincidencia superficial.
- Si una funcionalidad está implementada pero no documentada, eso es un hallazgo.
- Si un requisito está documentado pero no aparece en código o pruebas, eso también es un hallazgo.

## Formato de salida

## Fuente de requisitos
Indica de dónde salió la lista de requisitos y si es formal o provisional.

## Matriz de trazabilidad
Usa una tabla con estas columnas:

| Requisito | Descripción | Documentación | Diseño o arquitectura | Código | Prueba o validación | Estado |
|---|---|---|---|---|---|---|

En cada celda usa referencias concretas cuando existan.

## Requisitos sin cobertura suficiente
Lista solo los que tengan cobertura parcial, débil o nula.

## Cobertura sospechosa o contradictoria
Señala los casos en los que la trazabilidad exista pero no sea confiable.

## Artefactos huérfanos
Lista artefactos que no logran vincularse claramente a un requisito.

## Recomendaciones inmediatas
Propón acciones mínimas para cerrar la trazabilidad más crítica.

## Estilo esperado

- Sé metódico.
- Sé conservador con las conclusiones.
- Prioriza evidencia concreta.
- Usa identificadores claros.
- Evita frases generales como “parece cubierto”.
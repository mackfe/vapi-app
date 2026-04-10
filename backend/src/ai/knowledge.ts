export const MUNICIPAL_KNOWLEDGE = `
# Base de conocimiento RAG — Municipio de 3 de Febrero
## Dominio: Árboles, poda y restos verdes

---

## 1. Propósito del dominio
Esta base organiza la información necesaria para que un agente de voz pueda:
- clasificar consultas de vecinos sobre árboles, poda y restos verdes;
- hacer preguntas breves de validación;
- indicar documentación requerida;
- distinguir cuándo corresponde el trámite, cuándo corresponde esperar y cuándo corresponde derivar;
- evitar prometer aprobaciones o resoluciones que no están definidas en la fuente;
- responder con lenguaje claro, breve y oral.

---

## 2. Intenciones principales

### 2.1. Solicitud de poda
Corresponde analizar si la poda está vinculada a alguno de estos motivos:
- formación del árbol;
- despeje de luminaria;
- ramas que interfieren con cables.
Si la consulta no entra claramente en alguno de esos tres motivos, el agente no debe afirmar directamente que corresponde el reclamo. Debe pedir una descripción adicional del problema.

### 2.2. Solicitud de extracción de árbol
Primero debe verificarse si el árbol está en alguna de estas condiciones:
- seco;
- ahuecado;
- podrido;
- inclinado o yendo hacia la calle o calzada.
Si se cumple alguna de esas condiciones, la extracción puede corresponder.
Si no se cumple ninguna, no corresponde extracción directa y debe derivarse a permiso de extracción a cargo del frentista.

### 2.3. Retiro de restos de poda
Primero debe identificarse quién realizó la poda:
- la municipalidad;
- el vecino o un particular.
La respuesta cambia según quién hizo la poda y el tiempo transcurrido o la forma de acondicionamiento de los restos.

---

## 3. Criterios de decisión

### 3.1. Poda — criterios de corresponde
- el árbol necesita formación o mantenimiento;
- las ramas tapan una luminaria;
- las ramas interfieren con cables.

### 3.2. Poda — criterios de no afirmación directa
No debe afirmarse que corresponde cuando la descripción es ambigua o incompleta. Pedir más contexto.

### 3.3. Extracción — criterios de corresponde
- seco; ahuecado; podrido; inclinado hacia la calle.

### 3.4. Extracción — no corresponde directo
- Derivar a permiso de extracción a cargo del frentista.

### 3.5. Retiro de restos — si la poda la hizo la municipalidad
- El retiro puede demorar hasta 24 horas.
- Si < 24hs: esperar.
- Si > 24hs: reclamo por falta de recolección.

### 3.6. Retiro de restos — si la poda la hizo el vecino
- Restos en la vereda. Reclamo por web municipal.
- Acondicionamiento: bolsas o manojos de 50 x 80 cm.
- Límite: hasta 15 bolsas/manojos por semana.
- Troncos grandes: corresponde volquete privado.

---

## 4. Documentación requerida
- Poda: foto del árbol, DNI con dirección (o servicio).
- Extracción: DNI, dirección, fotos del árbol, boleta municipal TSG.
- Por Obra/Fachada: inicio de expediente, planos aprobados, DNI, fotos, TSG.

---

## 5. Reglas de respuesta para voz (CRÍTICO)
- Usar frases cortas y claras (una idea por oración).
- Tono cordial y profesional.
- Pedir un dato por vez.
- No prometer aprobaciones.
- Si falta información, preguntar brevemente (ej: "¿Maneja bolsas o manojos?").
- Negativa Knowledge: Si algo no está aquí (ej: plazos totales), decir que no está especificado.
`;

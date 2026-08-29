# 📱 Guion conversacional del Bot de Contingencia (WhatsApp → Sheets)

> Qué ve y qué escribe el usuario en cada paso. El bot valida que quien escribe es el coordinador
> asignado a la mesa/seccional (validación en `src/flows.js`). Todo reporte se vuelca al Excel en Drive.

---

## 0) Arranque

**Usuario:** *(cualquier mensaje, ej. "hola")*

**Bot:**
```
👋 Hola. Soy el bot de reporte electoral de contingencia.
Puedo registrar 3 momentos de tu mesa:
1️⃣ Instalación de mesa (jurados, kit, sillas, mesa física)
2️⃣ Participación (cantidad de sufragantes al cierre)
3️⃣ Acta 021 (precinto, testigos, cuadre de votos)
Escribe el número del momento que quieres reportar (1, 2 o 3).
Escribe MENU en cualquier momento para volver al inicio.
```

---

## 1) Instalación de mesa

**Bot:**
```
🟦 MOMENTO 1 — INSTALACIÓN DE MESA
Dime el código de tu mesa (ej. 53) y tu municipio (ej. CHAPARRAL).
Puedes escribirlos juntos: 53 CHAPARRAL
```
**Usuario:** `53 CHAPARRAL`

**Bot:**
```
✅ Mesa 53 — CHAPARRAL.
Ahora dime, separado por comas:
- Jurados presentes (0 a 3)
- Kit de materiales entregado (SI/NO)
- Sillas disponibles (0 a 3)
- Mesa física instalada (SI/NO)
Ejemplo: 3, SI, 3, SI
```
**Usuario:** `3, SI, 3, SI`

**Bot:**
```
📸 Envíame una foto del acta de instalación (opcional pero recomendada).
Si no tienes foto, escribe "omitir".
```
**Usuario:** *(foto)*  —o—  `omitir`

**Bot:**
```
✅ INSTALACIÓN REGISTRADA — Mesa 53 (CHAPARRAL)
Jurados: 3 · Kit: SI · Sillas: 3 · Mesa física: SI
Estado: OK
Gracias. Escribe 2 para Participación o 3 para el Acta 021.
```

> Si falta algún dato obligatorio el bot lo pide de nuevo. Si la mesa no coincide con tu asignación:
> `⛔ No estás asignado a la mesa 53.`

---

## 2) Participación

**Bot:**
```
🟦 MOMENTO 2 — PARTICIPACIÓN
Dime cuántos sufragantes votaron en tu mesa (número entero).
```
**Usuario:** `312`

**Bot:**
```
📸 Envíame una foto del formulario de participación o del certificado del simulacro (opcional).
Escribe "omitir" para continuar.
```
**Usuario:** `omitir`

**Bot:**
```
✅ PARTICIPACIÓN REGISTRADA — Mesa 53 (CHAPARRAL)
Sufragantes: 312
(Si tu mesa vota varios municipios, repite este paso por cada uno.)
Escribe 3 para el Acta 021.
```

---

## 3) Acta 021

**Bot:**
```
🟦 MOMENTO 3 — ACTA 021 (PRECONTEo)
Primero el PRECINTO y TESTIGOS:
- Hora de precinto (HH:MM)
- Testigos electorales presentes (SI/NO)
- Nombre del primer testigo (si hay)
Ejemplo: 16:00, SI, MARIA PEREZ
```
**Usuario:** `16:00, SI, MARIA PEREZ`

**Bot:**
```
Ahora el CUADRE DE VOTOS. Escribe, separado por comas:
- Votos válidos (total)
- Votos en blanco
- Votos nulos
- Votos unidad (SI/NO)
- Votos fijos (SI/NO)
- Votos especiales (SI/NO)
- Votos de contingencia (SI/NO)
- Inconsistencias (SI/NO)
Ejemplo: 305, 4, 3, SI, NO, NO, NO, NO
```
**Usuario:** `305, 4, 3, SI, NO, NO, NO, NO`

**Bot:**
```
📸 Envíame foto del Acta 021 (obligatoria).
```
**Usuario:** *(foto)*

**Bot:**
```
🔎 Verificando cuadre...
```
*(el bot valida: válidos = blancos + nulos + unidad + fijos + especiales + contingencia)*

- Si cuadra:
```
✅ ACTA 021 REGISTRADA — Mesa 53 (CHAPARRAL)
Precinto: 16:00 · Testigos: SI
Válidos: 305 · Blanco: 4 · Nulo: 3
Unidad: SI · Fijos: NO · Especiales: NO · Contingencia: NO
Cuadre: OK ✅
¡Reporte completo! Gracias.
```
- Si no cuadra:
```
⚠️ ALERTA DE CUADRE — Mesa 53 (CHAPARRAL)
La suma de votos (blanco+nulo+unidad+fijos+especiales+contingencia = X)
no coincide con los votos válidos (305).
Revisa el acta y reenvíala, o confirma con una nota.
Tu reporte se guardó como ALERTA para seguimiento del coordinador seccional.
```

---

## Comandos en cualquier momento

- `MENU` → vuelve al menú inicial.
- `CANCELAR` → borra el reporte en curso y reinicia.

## Validaciones

- **Número no autorizado:** `⛔ Este número no está autorizado para reportar.`
- **Mesa fuera de tu asignación:** `⛔ No estás asignado a la mesa X.`
- **Dato inválido:** el bot repite la pregunta con el formato esperado.
- **Hora de cierre (opcional):** si se configura `CIERRE_HORARIO`, tras esa hora el bot informa que el reporte está cerrado.

# Crack del Día (prototipo del modo diario)

Un futbolista por día. Al arrancar se ven todas las pistas básicas (posición, altura, debut, retiro,
debut en la selección) y la bandera. Para lo demás hay que pedir una pista: se elige una categoría
(carrera, apodo, palmarés, nacimiento, dorsal, curiosidades) en un modal y se revela el próximo dato
de esa categoría. Cada pista pedida baja el puntaje 100, con un piso de 100. Cuantas menos pidas, más puntos.

## Probarlo en tu máquina

```
npm install
npm run dev        # http://localhost:3000
npm test           # 47 pruebas (lógica + flujo completo contra el servidor real)
```

Sin `data/players.json` usa `data/players.sample.json` (7 jugadores de ejemplo, **sin verificar**) y lo avisa en pantalla.
Este zip ya trae el `data/players.json` real y limpio. Para regenerarlo:

```
node bajar-jugadores.mjs                              # baja de Wikidata -> players.json (en tu PC, con internet abierto)
node limpiar-datos.mjs players.json data/players.json # corrige fechas, filiales, posiciones y nombres de clubes
```

Después, para sumar la **nacionalidad** (bandera junto a la silueta), en tu PC:

```
node bajar-nacionalidad.mjs data/players.json
```

Baja las ciudadanías de Wikidata (unas 7 consultas), agrega `nacionalidad` a cada jugador y guarda `nacionalidades.json` (si volvés a correr `limpiar-datos.mjs`, se reaplica sola). Los que queden sin bandera se listan al final; se corrigen en `nacionalidades-manual.json` (`{ "Q123": ["rs", "Serbia"] }`) y se vuelve a correr. Las banderas son SVG propios en `public/banderas` (flag-icons, MIT), porque Windows no dibuja los emojis de bandera. Sin ese paso el juego anda igual, solo que sin país.

Y para sumar **apodo, palmarés, lugar de nacimiento y dorsal**, también en tu PC (ver [Pistas extra](#pistas-extra-bajar-extrasmjs) más abajo):

```
node bajar-extras.mjs data/players.json
```

El limpiador marca con `excluir` a quienes no sirven como jugador del día (entrenadores, datos dudosos); siguen en el autocompletado.

En desarrollo se puede probar otro día con `?fecha=2026-11-05` en las llamadas a `/api/*`.

## Publicarlo en Vercel

1. Creá una base en [Turso](https://turso.tech) y sacá la URL y el token.
2. En Vercel, en Settings > Environment Variables, cargá:
   - `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN`
   - `SEMILLA`: un texto largo y secreto. Define el orden de los jugadores. Si es público, se pueden saber los de los próximos días.
   - Opcionales: `FECHA_INICIO` (día del Nº 1, por defecto 2026-10-22) `MIN_POPULARIDAD` (piso general de idiomas de Wikipedia) y `MIN_POP_ARGENTINOS` / `MIN_POP_SUDAMERICANOS` / `MIN_POP_MUNDIALES` (pisos por grupo; por defecto 35 / 55 / 80, unos 340 jugadores del día posibles).
3. Subí el proyecto a GitHub e importalo en Vercel (Framework Preset: Other, sin comando de build).

La tabla `partidas` y `practicas` de una base ya existente se actualiza sola la primera vez que el
servidor arranca (agrega la columna `pedidas` con `ALTER TABLE`; ver [Reglas de la partida](#reglas-de-la-partida)). No hace falta tocar nada a mano en Turso.

## Qué hay en cada carpeta

- `public/`: la pantalla (HTML, CSS y JS, sin librerías).
- `api/`: los endpoints. El servidor es el único que sabe quién es el jugador del día; al navegador solo le llegan las pistas básicas y las que ya se pidieron.
- `lib/juego.js`: las reglas (pistas básicas, categorías, puntaje, jugador del día). Lo primero que conviene leer.
- `lib/partida.js`: una partida (diaria o práctica): intentos, pedir una pista, armar lo que ve el navegador.
- `lib/store.js`: la base de datos (archivo local en desarrollo, Turso en producción).

## Modo práctica

Pestaña **Práctica**: un jugador al azar filtrado por grupo (Todos, Argentinos, Sudamérica, Europa) y dificultad (Fácil, Medio, Difícil, Mezcla). No suma al ranking ni a la racha, y la partida sigue donde la dejaste si recargás. Usa exactamente la misma mecánica de pistas y puntaje que el modo diario.

- Los grupos salen de la nacionalidad (`nacionalidad.codigo`) y el continente de `lib/continentes.js`. Sin nacionalidad cargada, solo funciona "Argentinos" (por el grupo con el que se bajó).
- La dificultad se mide **dentro del grupo elegido**, por fama (idiomas de Wikipedia): el tercio más famoso es Fácil, el del medio Medio y el resto Difícil.
- No se repiten los jugadores que ya te tocaron hasta que los jugás a todos.
- Endpoints: `api/practica/estado`, `nueva`, `adivinar`, `pista` (este último con `{ partida, categoria }`).
- Para correcciones manuales sin volver a consultar Wikidata: `node bajar-nacionalidad.mjs data/players.json --solo-manual`.

## Reglas de la partida

**Pistas básicas** (gratis, se ven todas desde que arranca la partida, en este orden): posición, altura,
debut, retiro (o "—" si sigue activo; se omite si el dato está incompleto) y debut en la selección (se
omite si nunca debutó). La bandera también se ve desde el principio: no es una pista que se pida.

**Categorías** (se piden con el botón "Pedir pista", que abre un modal): cada una tiene una lista
ordenada de ítems y solo aparece en el modal si el jugador tiene datos para ella. Cada pedido revela
el próximo ítem de esa categoría.

| Categoría      | De dónde sale                                            | Repetible |
|----------------|-----------------------------------------------------------|-----------|
| Carrera        | `carrera` (los clubes, agrupados, hasta 8, "1°", "2°"...) | Sí        |
| Apodo          | `apodo` (string)                                          | No        |
| Palmarés       | `titulo` (string, a mano) + `palmares` (array de strings) | Sí        |
| Nacimiento     | `lugarNacimiento` (string, "Ciudad, País")                | No        |
| Dorsal         | `dorsal` (número)                                         | No        |
| Curiosidades   | `curiosidades` (array de strings, **se carga a mano**)    | Sí        |

El catálogo está en un solo lugar (`CATEGORIAS` en `lib/juego.js`): para agregar una categoría nueva
alcanza con sumar una entrada ahí, con una función `items(jugador)` que devuelva la lista ordenada.

**Puntaje**: si acertás, `max(100, 1000 - 100 × cantidad de pistas pedidas)`. Si perdés, 0. No depende
de cuántos datos tenga el jugador: pedir una pista siempre cuesta 100 puntos, sea cual sea la categoría.

**Intentos**: equivocarse de jugador **no revela pistas**, gasta uno de **3 intentos** (`INTENTOS_MAX`
en `lib/juego.js`). Al tercero, la partida termina en 0 puntos.

**Al terminar** (ganada o perdida) se muestran todas las pistas de todas las categorías, marcando con
una línea punteada las que no se llegaron a usar.

La partida guarda **qué categorías se pidieron, en qué orden** (columna `pedidas`, un JSON como
`["carrera","carrera","apodo"]`), no solo un contador. La columna vieja `pistas` se mantiene al día (=
cantidad de pistas pedidas) porque el ranking y el historial la siguen leyendo.

## Pistas extra (`bajar-extras.mjs`)

Mismo patrón que `bajar-nacionalidad.mjs`: corré `node bajar-extras.mjs data/players.json` en tu PC
(con internet abierto a Wikidata). Baja de Wikidata, con etiqueta en español y si no hay, en inglés:

- `apodo`: P1449 (también conocido como).
- `palmares`: P166 (premios) y, cuando se puede armar bien, participaciones/títulos de Mundial vía P1344.
- `lugarNacimiento`: P19, como "Ciudad, País".
- `dorsal`: P1618.

Hace copia de seguridad la primera vez (`<archivo>.sin-extras.bak`), pide de a 120 ids por consulta,
reintenta si Wikidata responde 429 o se corta la conexión, y al final lista quiénes quedaron sin cada
dato. Admite `--solo-manual` para no consultar Wikidata y aplicar solo las correcciones de abajo.

`curiosidades` **no se baja** de ningún lado: es un dato de color (un gol épico, una anécdota) que se
carga a mano en `extras-manual.json`, igual que `nacionalidades-manual.json`:

```json
{
  "Q615": {
    "curiosidades": [
      "Metió un gol de arco a arco en un Mundial.",
      "Es el máximo goleador histórico de su selección."
    ]
  }
}
```

Ese mismo archivo también sirve para corregir a mano `apodo`, `palmares`, `lugarNacimiento` o `dorsal`
cuando Wikidata trae algo raro o vacío (mismo formato: `{ "Qid": { "apodo": "..." } }`). El script
limpia valores obviamente malos (apodo igual al nombre, textos vacíos, duplicados) antes de guardar.

## Límites conocidos

- Sin cuentas, el ranking se puede manipular: quien borra los datos del navegador juega de nuevo, ya sabiendo la respuesta. Para un ranking serio hace falta un login (por ejemplo con Google).
- Cambiar `players.json` o `SEMILLA` cambia el orden de los jugadores de los días que vienen.
- El palmarés "de a mano" (`titulo`, por ejemplo "Clausura 2004") no viene de Wikidata.
- No hay límite de intentos por minuto.

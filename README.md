# Crack del Día (prototipo del modo diario)

Un futbolista por día. Las pistas se abren de a una, en el orden del programa: posición, altura, debut, retiro, título, selección y clubes. Cada error abre otra pista, y también se puede pedir una a propósito. Cuantas menos pistas uses, más puntos (de 1000 a 1000/cantidad de pistas).

## Probarlo en tu máquina

```
npm install
npm run dev        # http://localhost:3000
npm test           # 19 pruebas (lógica + flujo completo contra el servidor real)
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

El limpiador marca con `excluir` a quienes no sirven como jugador del día (entrenadores, datos dudosos); siguen en el autocompletado.

En desarrollo se puede probar otro día con `?fecha=2026-11-05` en las llamadas a `/api/*`.

## Publicarlo en Vercel

1. Creá una base en [Turso](https://turso.tech) y sacá la URL y el token.
2. En Vercel, en Settings > Environment Variables, cargá:
   - `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN`
   - `SEMILLA`: un texto largo y secreto. Define el orden de los jugadores. Si es público, se pueden saber los de los próximos días.
   - Opcionales: `FECHA_INICIO` (día del Nº 1, por defecto 2026-10-22) `MIN_POPULARIDAD` (piso general de idiomas de Wikipedia) y `MIN_POP_ARGENTINOS` / `MIN_POP_SUDAMERICANOS` / `MIN_POP_MUNDIALES` (pisos por grupo; por defecto 35 / 55 / 80, unos 340 jugadores del día posibles).
3. Subí el proyecto a GitHub e importalo en Vercel (Framework Preset: Other, sin comando de build).

## Qué hay en cada carpeta

- `public/`: la pantalla (HTML, CSS y JS, sin librerías).
- `api/`: los endpoints. El servidor es el único que sabe quién es el jugador del día; al navegador solo le llegan las pistas ya abiertas.
- `lib/juego.js`: las reglas (pistas, puntaje, jugador del día). Lo primero que conviene leer.
- `lib/store.js`: la base de datos (archivo local en desarrollo, Turso en producción).

## Modo práctica

Pestaña **Práctica**: un jugador al azar filtrado por grupo (Todos, Argentinos, Sudamérica, Europa) y dificultad (Fácil, Medio, Difícil, Mezcla). No suma al ranking ni a la racha, y la partida sigue donde la dejaste si recargás.

- Los grupos salen de la nacionalidad (`nacionalidad.codigo`) y el continente de `lib/continentes.js`. Sin nacionalidad cargada, solo funciona "Argentinos" (por el grupo con el que se bajó).
- La dificultad se mide **dentro del grupo elegido**, por fama (idiomas de Wikipedia): el tercio más famoso es Fácil, el del medio Medio y el resto Difícil.
- No se repiten los jugadores que ya te tocaron hasta que los jugás a todos.
- Endpoints: `api/practica/estado`, `nueva`, `adivinar`, `pista`.
- Para correcciones manuales sin volver a consultar Wikidata: `node bajar-nacionalidad.mjs data/players.json --solo-manual`.

## Reglas de la partida

- Se ve la nacionalidad desde el principio y la primera pista (posición). Las demás se abren de a una con "Pedir otra pista" y cada una baja el puntaje.
- Equivocarse de jugador **no abre pistas**: gasta uno de **3 intentos** (`INTENTOS_MAX` en `lib/juego.js`). Al tercero, la partida termina en 0 puntos.

## Límites conocidos

- Sin cuentas, el ranking se puede manipular: quien borra los datos del navegador juega de nuevo, ya sabiendo la respuesta. Para un ranking serio hace falta un login (por ejemplo con Google).
- Cambiar `players.json` o `SEMILLA` cambia el orden de los jugadores de los días que vienen.
- El título ("Clausura 2004") no viene de Wikidata: hay que cargarlo a mano en el campo `titulo` de cada jugador. Si falta, esa pista se omite.
- No hay límite de intentos por minuto.

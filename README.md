# Crack del Día (prototipo del modo diario)

Un futbolista por día. Al arrancar se ven todas las pistas básicas (posición, altura, debut, retiro,
debut en la selección) y la bandera. Para lo demás hay que pedir una pista: se elige una categoría
(carrera, apodo, palmarés, nacimiento, dorsal, curiosidades) en un modal y se revela el próximo dato
de esa categoría. Cada pista pedida baja el puntaje 100, con un piso de 100. Cuantas menos pidas, más puntos.

Los datos salen de [Wikidata](https://www.wikidata.org/) y de [Wikipedia](https://es.wikipedia.org/)
(texto bajo [CC BY-SA](https://creativecommons.org/licenses/by-sa/4.0/)); las fotos, de Wikimedia
Commons, con el crédito de cada autor. El juego atribuye las tres cosas en el pie de la página.

## Probarlo en tu máquina

```
npm install
npm run dev        # http://localhost:3000
npm test           # 89 pruebas (lógica + flujo completo contra el servidor real)
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

Y para saber quién **pasó por el fútbol argentino** (ver [Fútbol argentino](#fútbol-argentino-bajar-argentinamjs) más abajo), que decide quién puede salir como jugador del día y alimenta el checkbox de práctica:

```
node bajar-argentina.mjs data/players.json
```

El limpiador marca con `excluir` a quienes no sirven como jugador del día (entrenadores, datos dudosos); siguen en el autocompletado.

En desarrollo se puede probar otro día con `?fecha=2026-11-05` en las llamadas a `/api/*`.

## Publicarlo en Vercel

1. Creá una base en [Turso](https://turso.tech) y sacá la URL y el token.
2. En Vercel, en Settings > Environment Variables, cargá:
   - `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN`
   - `SEMILLA`: un texto largo y secreto. Define el orden de los jugadores. Si es público, se pueden saber los de los próximos días.
   - Opcionales: `FECHA_INICIO` (día del Nº 1, por defecto 2026-10-22) `MIN_POPULARIDAD` (piso general de idiomas de Wikipedia) y `MIN_POP_ARGENTINOS` / `MIN_POP_SUDAMERICANOS` / `MIN_POP_MUNDIALES` (pisos por grupo; por defecto 30 / 55 / 80). Junto con el filtro de [quién puede ser jugador del día](#reglas-de-la-partida) (argentino o `jugoEnArgentina`), da unos 240 jugadores del día posibles.
   - `SITE_URL` (opcional): la URL pública del sitio, p. ej. `https://crackdeldia.com.ar` (sin barra
     final). La usan las etiquetas Open Graph/Twitter (`og:url`, `og:image`...) — ver
     [Compartir](#compartir). Sin esta variable, usa `https://crack-del-dia.vercel.app` como fallback.
3. Subí el proyecto a GitHub e importalo en Vercel (Framework Preset: Other, sin comando de build).

La tabla `partidas` y `practicas` de una base ya existente se actualiza sola la primera vez que el
servidor arranca (agrega las columnas `pedidas` y `argentina` con `ALTER TABLE`; ver [Reglas de la
partida](#reglas-de-la-partida) y [Modo práctica](#modo-práctica)). No hace falta tocar nada a mano en Turso.

## Qué hay en cada carpeta

- `public/`: la pantalla (HTML, CSS y JS, sin librerías).
- `api/`: los endpoints. El servidor es el único que sabe quién es el jugador del día; al navegador solo le llegan las pistas básicas y las que ya se pidieron.
- `lib/juego.js`: las reglas (pistas básicas, categorías, puntaje, jugador del día). Lo primero que conviene leer.
- `lib/partida.js`: una partida (diaria o práctica): intentos, pedir una pista, armar lo que ve el navegador.
- `lib/store.js`: la base de datos (archivo local en desarrollo, Turso en producción).

## Modo práctica

Pestaña **Práctica**: un jugador al azar filtrado por grupo (Todos, Argentinos, Sudamérica, Europa) y dificultad (Fácil, Medio, Difícil, Mezcla). No suma al ranking ni a la racha, y la partida sigue donde la dejaste si recargás. Usa exactamente la misma mecánica de pistas y puntaje que el modo diario.

- Los grupos salen de la nacionalidad (`nacionalidad.codigo`) y el continente de `lib/continentes.js`. Sin nacionalidad cargada, solo funciona "Argentinos" (por el grupo con el que se bajó). Ojo: "Sudamérica" incluye a los argentinos (el continente no los separa); "Argentinos" es un grupo aparte, no excluyente.
- Checkbox **"Pasaron por Argentina"**, debajo de los grupos: restringe el pool a `jugoEnArgentina === true`, combinado con el grupo y la dificultad elegidos. Los contadores de cada grupo se recalculan según el checkbox (`GET /api/practica/estado?argentina=1`). Se guarda en `localStorage` junto con el grupo y la dificultad.
- La dificultad se mide **dentro del pool ya filtrado** (grupo + checkbox), por fama (idiomas de Wikipedia): el tercio más famoso es Fácil, el del medio Medio y el resto Difícil.
- No se repiten los jugadores que ya te tocaron hasta que los jugás a todos.
- Endpoints: `api/practica/estado` (GET, admite `?argentina=1`), `nueva` (POST `{ grupo, dificultad, argentina }`), `adivinar`, `pista` (POST `{ partida, categoria }`). Si la combinación de grupo + dificultad + checkbox queda sin nadie, `nueva` devuelve el mismo error de siempre (`sin_jugadores`).
- Para correcciones manuales sin volver a consultar Wikidata: `node bajar-nacionalidad.mjs data/players.json --solo-manual`.

El checkbox es **distinto** de la regla que decide el jugador del día (ver abajo), a propósito: acá
hace falta haber jugado en un club argentino, nacionalidad o país de origen no alcanzan. Un argentino
que nunca jugó en el país (Messi) sale en el diario pero no en práctica con el checkbox tildado.

## Reglas de la partida

**Quién puede ser el jugador del día**: tiene que cumplir los criterios de siempre (`esElegible` en
`lib/juego.js`: jugable, no excluido, con al menos 3 pistas básicas y alguna categoría para pedir, por
encima del piso de fama de su origen) y, además, tener algo que ver con Argentina: ser argentino (por
`origen === 'Argentinos'` o `nacionalidad.codigo === 'ar'`) **o** haber jugado en un club argentino
(`jugoEnArgentina === true`). Los no-argentinos que entran por `jugoEnArgentina` siguen sujetos al piso
de fama de su propio origen (Sudamericanos 55, Estrellas mundiales 80 por defecto): un uruguayo o una
estrella mundial que jugó acá pero no llega a ese piso no sale igual. Un argentino que nunca jugó en el
país (como Messi) sí puede salir, porque ser argentino ya alcanza.

**Pistas básicas** (gratis, se ven todas desde que arranca la partida, en este orden): posición, altura,
debut, retiro (o "—" si sigue activo; se omite si el dato está incompleto) y debut en la selección (se
omite si nunca debutó). La bandera también se ve desde el principio: no es una pista que se pida.

**Categorías** (se piden con el botón "Pedir pista", que abre un modal): cada una tiene una lista
ordenada de ítems y solo aparece en el modal si el jugador tiene datos para ella. Cada pedido revela
el próximo ítem de esa categoría.

| Categoría      | En pantalla                   | De dónde sale                                            | Repetible |
|----------------|--------------------------------|-----------------------------------------------------------|-----------|
| Carrera        | Carrera                        | `carrera` (los clubes, agrupados, hasta 8, "1°", "2°"...) | Sí        |
| Apodo          | Apodo                          | `apodo` (string)                                          | No        |
| Palmarés       | **Vitrina** (títulos y premios) | `titulo` (string, a mano) + `palmares` (array de strings) | Sí        |
| Nacimiento     | Nacimiento                     | `lugarNacimiento` (string, "Ciudad, País")                | No        |
| Dorsal         | Dorsal                         | `dorsal` (número)                                         | No        |
| Curiosidades   | Curiosidades                   | `curiosidades` (array de strings, **se carga a mano**)    | Sí        |

"Vitrina" es solo el nombre en pantalla (el modal aclara "títulos y premios"); por dentro sigue
siendo la categoría `palmares`, con el campo `palmares` y el script `bajar-palmares.mjs` de siempre.

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

## Compartir

Solo el modo diario (la práctica no tiene botón de compartir). Lo arma `public/compartir.js`
(funciones puras, testeadas en `test/compartir.test.mjs`): **nunca** incluye el nombre, la foto, el
club ni la nacionalidad del jugador del día, ni siquiera habiendo ganado.

**Botón "Compartir"**: arma el texto (`Nº`, resultado, pistas y intentos en emoji, puntaje y racha) y
lo pasa a `navigator.share({ text, url })` si el navegador lo tiene (la mayoría de los celulares); si
no (navegadores de escritorio), lo copia al portapapeles y avisa "Copiado". Si la persona cierra el
menú de compartir sin elegir nada, no se muestra ningún error.

**Open Graph / Twitter card** (`public/plantilla.html`, con `{{SITE_URL}}` sin resolver): para que
`og:image` sea una URL absoluta (como pide el estándar) hace falta conocer el dominio del sitio al
momento de servir la página, y eso no se puede hacer desde un archivo estático. La solución más
simple que funciona en Vercel sin build propio: `api/index.js` lee `public/plantilla.html`, reemplaza
`{{SITE_URL}}` por la variable de entorno `SITE_URL` (con un fallback si no está puesta) y sirve el
resultado; `vercel.json` tiene un rewrite de `"/"` a `"/api/index"` para que sea esa función, y no el
archivo estático, la que responda en la raíz. `dev-server.mjs` hace lo mismo en local (con
`http://localhost:3000` como `SITE_URL` por defecto), así que **no visites `/plantilla.html` directo**:
vas a ver el placeholder `{{SITE_URL}}` sin reemplazar. El resto de `/public` se sigue sirviendo tal
cual, como archivos estáticos.

**Falta agregar `public/og.png`** (1200×630) a mano — este trabajo no lo generó. Mientras no esté, el
link de `og:image` da 404 en las vistas previas (el resto de la página funciona igual).

## Pistas extra (`bajar-extras.mjs`)

Mismo patrón que `bajar-nacionalidad.mjs`: corré `node bajar-extras.mjs data/players.json` en tu PC
(con internet abierto a Wikidata). Baja de Wikidata, con etiqueta en español y si no hay, en inglés:

- `apodo`: P1449 (también conocido como).
- `palmares`: P166 (premios) y, cuando se puede armar bien, participaciones/títulos de Mundial vía P1344.
  **Este `palmares` de Wikidata es un piso, no el definitivo**: cubre poco y a veces se equivoca (le
  faltan campeones del mundo). Después de correr este script conviene correr
  [`bajar-palmares.mjs`](#palmares-bajar-palmaresmjs), que arma un `palmares` mejor desde las tablas
  de Wikipedia y lo reemplaza; el de acá queda solo para los jugadores en los que Wikipedia no tenga
  nada.
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

## Fútbol argentino (`bajar-argentina.mjs`)

Mismo patrón que los otros `bajar-*.mjs`: corré `node bajar-argentina.mjs data/players.json` en tu PC
(con internet abierto a Wikidata). Agrega a cada jugador:

- `jugoEnArgentina`: `true` o `false`. Sale de los pasos de carrera (P54) cuyo club tiene a Argentina
  como país (P17) o cuya liga es de Argentina (P118 → P17), sin contar selecciones, juveniles, reservas
  ni filiales, y descartando los pasos que empezaron antes de los 15 años (inferiores: un paso por las
  divisiones menores de un club argentino no cuenta).
- `clubesArgentinos`: array con los nombres de esos clubes (solo si `jugoEnArgentina` es `true`).

Hace copia de seguridad la primera vez (`<archivo>.sin-argentina.bak`), pide de a 100 ids por consulta,
reintenta si Wikidata responde 429 o se corta la conexión, y al final imprime un resumen: cuántos
jugadores pasaron por Argentina, cuántos argentinos **no** figuran como tales (para chequear casos como
Messi), y los jugadores de otros países más famosos que sí pasaron por acá. Admite `--solo-manual` para
no consultar Wikidata y aplicar solo las correcciones de `argentina-manual.json`:

```json
{ "Q12345": true, "Q67890": false }
```

Estos dos campos son los que usa el servidor para decidir quién puede ser jugador del día (sumado a si
es argentino) y para el checkbox "Pasaron por Argentina" del modo práctica — ver
[Reglas de la partida](#reglas-de-la-partida) y [Modo práctica](#modo-práctica).

## Palmarés (`bajar-palmares.mjs`)

El `palmares` de Wikidata (ver [Pistas extra](#pistas-extra-bajar-extrasmjs)) cubre poco y a veces se
equivoca: le faltaban, por ejemplo, los campeones del mundo 2022 (Di María, Dybala), 2002 (Roberto
Carlos) y 1958/62 (Garrincha), o el 1978 de Fillol. Este script arma un `palmares` mejor leyendo
directamente la sección **"Palmarés"** del artículo del jugador en Wikipedia en español, que trae esos
títulos en tablas (Título / Club / País / Año). Correlo **después** de `bajar-extras.mjs`, así solo
reemplaza con algo mejor, nunca deja a alguien sin nada:

```
node bajar-palmares.mjs data/players.json
node bajar-palmares.mjs data/players.json --solo-manual   # sin internet: solo aplica extras-manual.json
```

Qué hace:

1. Resuelve el título del artículo de cada jugador con una consulta a Wikidata (el sitelink a
   `eswiki`), en lotes. Si no hay artículo en español, prueba en inglés — aunque en la práctica eso
   casi nunca da un `palmares` nuevo, porque el parser lee específicamente las tablas en español; es
   solo para que el reporte final diga "sin artículo" con más precisión.
2. Baja el HTML de cada artículo con la REST API de Wikipedia (`/api/rest_v1/page/html/<título>`),
   con una pausa de cortesía de ~400 ms entre pedidos y caché en `cache/palmares-html/` (si se corta
   a mitad de camino, `Ctrl+C` y volvés a correr el mismo comando: retoma de donde quedó).
3. Prioriza a los jugadores jugables y no excluidos, ordenados por fama, así lo más importante queda
   cubierto primero si hay que cortarlo.
4. Parsea esa sección con `lib/palmares.js` (funciones puras, testeadas en `test/palmares.test.mjs`
   contra páginas reales guardadas) y arma ítems del tipo `"Campeón del Mundo con Argentina (1978)"` o
   `"Campeonato Metropolitano con River Plate (1975, 1979, 1980)"`, con el género y el artículo
   correctos ("Campeón del Sudamericano Sub-20", "Campeón de la Copa América", "Campeón de la
   Finalissima" para la Copa de Campeones Conmebol-UEFA), agrupando por torneo y juntando los años, y
   descartando distinciones de relleno (como "Título de Glorias de..." de un club menor). Hasta 12 por
   jugador, en este orden: selección absoluta, selección juvenil/olímpica, los premios individuales
   más importantes (Balón de Oro, Bota de Oro, mejor jugador o arquero de un Mundial — para que a los
   grandes no se les pierdan entre tantos títulos de club), torneos internacionales de club, títulos
   nacionales y regionales, el resto de las distinciones individuales.
5. Si para un jugador no encuentra nada en Wikipedia (sin artículo, sin sección "Palmarés", o una
   tabla con un formato que el parser no reconoce), **conserva el `palmares` que ya tenía** — nunca lo
   borra. `extras-manual.json` (el mismo archivo de `bajar-extras.mjs`) tiene prioridad sobre todo
   esto: si un jugador está ahí con `"palmares"`, ese valor gana siempre.

Al final imprime cuántos jugadores tenían `palmares` antes y después de correrlo, y (para chequear)
el resultado completo de una lista corta de jugadores conocidos.

Hace copia de seguridad la primera vez (`<archivo>.sin-palmares.bak`).

## Límites conocidos

- Sin cuentas, el ranking se puede manipular: quien borra los datos del navegador juega de nuevo, ya sabiendo la respuesta. Para un ranking serio hace falta un login (por ejemplo con Google).
- Cambiar `players.json` o `SEMILLA` cambia el orden de los jugadores de los días que vienen.
- El palmarés "de a mano" (`titulo`, por ejemplo "Clausura 2004") no viene de Wikidata.
- No hay límite de intentos por minuto.
- El pool del jugador del día (argentinos + quienes jugaron acá) es bastante más chico que el total de
  jugables: muchas estrellas mundiales que nunca jugaron en Argentina quedan afuera por más famosas que
  sean. Si con el tiempo se queda corto, conviene revisar `jugoEnArgentina` con `bajar-argentina.mjs` o
  bajar el piso de fama por origen.

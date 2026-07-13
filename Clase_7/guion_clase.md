# Guion de clase — DevSecOps: SAST y DAST en el Pipeline

> Guía desde la perspectiva del profesor. El objetivo es **construir una app con
> vulnerabilidades deliberadas, agregar escaneo SAST (SonarCloud) y DAST (OWASP
> ZAP) al pipeline de CI, ver los hallazgos y arreglar una vulnerabilidad en
> vivo** para entender el ciclo completo.
>
> Convenciones:
> - `[NUEVO]` = creas el fichero desde cero.
> - `[ACTUALIZA]` = el fichero ya existe y le **añades** código.
> - `► Checkpoint` = momento para ejecutar comandos y ver algo funcionando.

---

## Mapa del recorrido

```
Bloque 1  La app vulnerable     → package.json, server.js     → correr localmente
Bloque 2  SAST con SonarCloud    → sonar-project.properties,    → ver hallazgos
                                    workflow SAST                  en el dashboard
Bloque 3  DAST con OWASP ZAP     → ampliar workflow con DAST    → descargar reporte
Bloque 4  Fix en vivo            → query parametrizada          → ver cómo desaparece
```

Pre-requisitos: Node 20+ y `pnpm` instalados, cuenta en GitHub.

---

# BLOQUE 1 — La app vulnerable

Vamos a crear una app Express mínima con SQLite que tiene **4 vulnerabilidades
deliberadas**. La app es a propósito insegura —es el "junior" que escribe código
sin pensar en seguridad— para que luego los escáneres tengan algo que encontrar.

## Paso 1 — [NUEVO] `Clase_7/app/package.json`

**Qué hace:** Declara las dependencias (`express`, `sqlite3`, `jsonwebtoken`) y
el script de arranque. Usa ESM (`"type": "module"`).

```json
{
  "name": "devsecops-demo",
  "version": "1.0.0",
  "description": "App vulnerable para demo de SAST y DAST",
  "type": "module",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "packageManager": "pnpm@11.3.0",
  "dependencies": {
    "express": "^4.21.0",
    "jsonwebtoken": "^9.0.2",
    "sqlite3": "^5.1.7"
  }
}
```

**Línea por línea:**

- `"type": "module"` → habilita `import`/`export` (ESM) en vez de `require`
  (CommonJS). Es la forma moderna de escribir JavaScript.
- `"packageManager": "pnpm@11.3.0"` → fija la versión de pnpm. GitHub Actions
  lee este campo para instalar la misma versión en CI.
- `express` → framework web minimalista. Maneja rutas y peticiones HTTP.
- `jsonwebtoken` → para firmar tokens JWT en el endpoint `/login`.
- `sqlite3` → driver de SQLite. Nos permite usar SQL real (y cometer SQLi real).

## Paso 2 — [NUEVO] `Clase_7/app/server.js`

**Qué hace:** La app completa. Crea una base SQLite en memoria, seedea 2
usuarios y expone 4 endpoints. **Contiene las 4 vulnerabilidades que vamos a
detectar.**

```javascript
import express from "express";
import sqlite3 from "sqlite3";
import jwt from "jsonwebtoken";
import crypto from "crypto";

const JWT_SECRET = "super-secret-jwt-key-12345";

const db = new sqlite3.Database(":memory:");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT,
      password_hash TEXT
    )
  `);

  const hashPassword = (password) =>
    crypto.createHash("md5").update(password).digest("hex");

  db.run(
    "INSERT OR IGNORE INTO users (username, email, password_hash) VALUES (?, ?, ?)",
    ["admin", "admin@demo.com", hashPassword("admin123")]
  );
  db.run(
    "INSERT OR IGNORE INTO users (username, email, password_hash) VALUES (?, ?, ?)",
    ["user1", "user1@demo.com", hashPassword("password1")]
  );
});

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (_req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <body>
      <h1>App Demo - DevSecOps</h1>

      <h2>Buscar</h2>
      <form action="/search" method="GET">
        <input type="text" name="q" placeholder="Buscar..." />
        <button type="submit">Buscar</button>
      </form>

      <h2>Usuarios</h2>
      <ul>
        <li><a href="/user/1">Usuario 1</a></li>
        <li><a href="/user/2">Usuario 2</a></li>
      </ul>

      <h2>Login</h2>
      <form action="/login" method="POST">
        <input type="text" name="username" placeholder="Usuario" />
        <input type="password" name="password" placeholder="Password" />
        <button type="submit">Login</button>
      </form>
    </body>
    </html>
  `);
});

app.get("/search", (req, res) => {
  const q = req.query.q || "";
  res.send(`
    <!DOCTYPE html>
    <html>
    <body>
      <h1>Resultados de busqueda</h1>
      <p>Buscaste: ${q}</p>
      <a href="/">Volver</a>
    </body>
    </html>
  `);
});

app.get("/user/:id", (req, res) => {
  const id = req.params.id;
  const query = "SELECT id, username, email FROM users WHERE id = " + id;

  db.get(query, (err, row) => {
    if (err) {
      res.send(`<p>Error: ${err.message}</p><a href="/">Volver</a>`);
    } else if (row) {
      res.send(`
        <!DOCTYPE html>
        <html>
        <body>
          <h1>Usuario #${row.id}</h1>
          <p>Username: ${row.username}</p>
          <p>Email: ${row.email}</p>
          <a href="/">Volver</a>
        </body>
        </html>
      `);
    } else {
      res.send("<p>Usuario no encontrado</p><a href="/">Volver</a>");
    }
  });
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const hash = crypto.createHash("md5").update(password).digest("hex");

  db.get(
    "SELECT * FROM users WHERE username = ? AND password_hash = ?",
    [username, hash],
    (err, row) => {
      if (err || !row) {
        return res.status(401).json({ error: "credenciales invalidas" });
      }
      const token = jwt.sign({ id: row.id, username: row.username }, JWT_SECRET);
      res.json({ token });
    }
  );
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`App corriendo en http://localhost:${PORT}`);
});
```

**Las 4 vulnerabilidades — dónde están:**

| # | Línea | Vulnerabilidad | Por qué es un problema |
|---|-------|---------------|----------------------|
| 1 | `const query = "... WHERE id = " + id` | **SQL Injection** | Concatenar input del usuario en una query SQL permite inyecciones como `1 OR 1=1`. |
| 2 | `Buscaste: ${q}` en `/search` | **XSS reflejado** | El input del usuario se refleja en HTML sin sanitizar. Permite inyectar `<script>`. |
| 3 | `crypto.createHash("md5")` | **Criptografía débil** | MD5 es trivial de romper con rainbow tables. Los passwords hasheados con MD5 no están seguros. |
| 4 | `const JWT_SECRET = "super-..."` | **Secret hardcodeado** | El secreto para firmar JWT está en el código. Quien vea el repo puede falsificar tokens. |

**Línea por línea (conceptos clave):**

- `new sqlite3.Database(":memory:")` → crea una base SQLite **en RAM**. Al
  reiniciar la app se pierde (es un demo, no nos importa la persistencia).
- `db.serialize(...)` → ejecuta las queries en orden (una tras otra), no en
  paralelo. Necesario para que el `CREATE TABLE` termine antes de los `INSERT`.
- `db.get(query, callback)` → ejecuta una query y devuelve **la primera fila**
  que coincida. Si la query es vulnerable a SQLi, un atacante puede leer datos
  que no debería.
- `crypto.createHash("md5")` → calcula el hash MD5 de un string. MD5 fue diseñado
  para ser criptográficamente seguro, pero hoy se rompe en segundos.
- `jwt.sign(payload, secret)` → firma un token JWT. Si el `secret` está
  hardcodeado en el código, un atacante puede crear tokens válidos para
  cualquier usuario.
- `res.send(...)` → envía la respuesta HTTP. Cuando incluimos input del usuario
  sin sanitizar dentro del HTML, abrimos la puerta a XSS.

## Paso 3 — [NUEVO] `Clase_7/app/.gitignore`

**Qué hace:** Evita que `node_modules` se suba al repo.

```
node_modules/
```

## Paso 3b — [NUEVO] `Clase_7/app/pnpm-workspace.yaml`

**Qué hace:** Permite que pnpm ejecute el script de compilación de `sqlite3`
(es un módulo nativo que necesita compilarse).

```yaml
allowBuilds:
  sqlite3: true
```

> Sin este archivo, pnpm bloquea la compilación de sqlite3 por seguridad y la
> app falla al arrancar.

## ► Checkpoint: ¡correr la app!

```bash
cd Clase_7/app
pnpm install
pnpm start
```

Deberías ver `App corriendo en http://localhost:3000`.

**Probar los endpoints:**

```bash
# Home — ver la página con formularios
curl http://localhost:3000/

# XSS — inyectar HTML (probar en el navegador)
# http://localhost:3000/search?q=<script>alert(1)</script>

# SQL Injection — leer todos los usuarios
curl http://localhost:3000/user/1%20OR%201=1

# Login normal
curl -X POST http://localhost:3000/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}'
```

> El `1 OR 1=1` inyectado en el primer `curl` debería devolver un usuario
> distinto al que pediste. Eso es SQL Injection en acción: la query resultante
> es `SELECT ... WHERE id = 1 OR 1=1`, que siempre es verdadera.

---

# BLOQUE 2 — SAST con SonarCloud

SonarCloud analiza el **código fuente** sin ejecutar la aplicación. Detecta
patrones peligrosos: concatenación de SQL, uso de MD5, secretos hardcodeados, etc.
Lo integraremos en el pipeline para que **cada push** dispare un análisis
automático.

## Paso 4 — Configurar SonarCloud (una sola vez)

**Esto se hace fuera del código, en la web de SonarCloud:**

1. Entrar a [sonarcloud.io](https://sonarcloud.io) y loguearse con GitHub.
2. Importar el repositorio (arriba a la derecha → "+" → "Analyze new project").
3. Seleccionar el repo y crear el proyecto.
4. SonarCloud genera un **token** (`SONAR_TOKEN`). Copiarlo.
5. En GitHub: repo → **Settings → Secrets and variables → Actions → New
   repository secret** → Nombre: `SONAR_TOKEN`, Valor: el token copiado.
6. Anotar dos valores que aparecen en la configuración del proyecto:
   - **Project Key** (ej. `coderhouse-clase7-devsecops`)
   - **Organization Key** (ej. `tu-usuario-github`)

> **Importante:** cada alumno debe hacer esto con su propio fork. El token es
> personal.

## Paso 5 — [NUEVO] `Clase_7/sonar-project.properties`

**Qué hace:** Le dice al scanner de SonarCloud qué analizar y con qué
identidad.

```properties
sonar.projectKey=coderhouse-clase7-devsecops
sonar.organization=tu-organizacion
sonar.sources=app
sonar.exclusions=app/node_modules/**,**/*.test.js
sonar.javascript.environments=node
```

> ⚠️ **Reemplazar** `sonar.projectKey` y `sonar.organization` con los valores que
> anotaste en el paso 4.

**Línea por línea:**

- `sonar.projectKey` → identificador único del proyecto en SonarCloud. Debe
  coincidir con el que creaste en la web.
- `sonar.organization` → tu organización en SonarCloud (normalmente tu usuario
  de GitHub).
- `sonar.sources=app` → dónde está el código a analizar (carpeta `app/`).
- `sonar.exclusions` → qué ignorar. `node_modules` siempre; los tests porque no
  tenemos en esta clase.
- `sonar.javascript.environments=node` → le dice que el código JavaScript corre
  en Node (no en navegador). Evita falsos positivos.

## Paso 6 — [NUEVO] `.github/workflows/security.yml` (parte SAST)

**Qué hace:** Define el pipeline de GitHub Actions. Por ahora solo con SAST.

> ⚠️ **Ojo:** los workflows de GitHub Actions **deben** estar en la carpeta
> `.github/workflows/` en la **raíz del repositorio**, no dentro de `Clase_7/`.

```yaml
name: Security Pipeline (SAST + DAST)

on:
  push:
  workflow_dispatch:

jobs:
  security:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
          cache-dependency-path: Clase_7/app/pnpm-lock.yaml

      - name: Install dependencies
        run: pnpm install
        working-directory: Clase_7/app

      - name: SAST - SonarCloud
        uses: SonarSource/sonarcloud-github-action@master
        env:
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
        with:
          projectBaseDir: Clase_7
```

**Línea por línea:**

- `name:` → nombre visible en la pestaña "Actions" de GitHub.
- `on: [push, workflow_dispatch]` → se dispara en cada `git push` y también
  manualmente (botón "Run workflow").
- `jobs: → security:` → un job llamado `security`.
- `runs-on: ubuntu-latest` → corre en una VM de Ubuntu que GitHub provee gratis.
- `actions/checkout@v4` → descarga el código del repo en la VM.
- `pnpm/action-setup@v4` → instala pnpm en la VM. Lee la versión del campo
  `"packageManager"` del `package.json`, así usa la misma versión que en local.
- `actions/setup-node@v4` → instala Node 20 y activa caché de dependencias
  pnpm (acelera el `install` en runs siguientes).
- `pnpm install` → instala las dependencias. `working-directory` indica que
  ejecute el comando dentro de `Clase_7/app/`.
- `SonarSource/sonarcloud-github-action@master` → ejecuta el scanner de SonarCloud
  sobre `projectBaseDir: Clase_7` (donde está el `sonar-project.properties`).
  Usa el `SONAR_TOKEN` como secreto para autenticarse.

## ► Checkpoint: ¡primera corrida de SAST!

```bash
git add .
git commit -m "Agregar app vulnerable y pipeline SAST"
git push
```

Ir a la pestaña **Actions** del repo en GitHub. Verás el workflow corriendo.
Cuando termine (puede tardar 2-3 min), el resultado será **rojo (❌)** — porque
el Quality Gate de SonarCloud detectó vulnerabilidades.

Luego ir a [sonarcloud.io](https://sonarcloud.io) → tu proyecto. Verás:

- **Vulnerabilities:** SQL Injection, XSS.
- **Security Hotspots:** MD5 (weak hash), JWT secret hardcodeado.
- **Code Smells:** posibles mejoras de calidad.

> **Momento de discusión:** "Miren — sin ejecutar la app, solo leyendo el código,
> SonarCloud encontró 4 problemas de seguridad. Eso es SAST. Y corre solo, en
> cada commit."

---

# BLOQUE 3 — DAST con OWASP ZAP

ZAP **ataca la app en ejecución**. En el pipeline, levantamos la app dentro del
runner de GitHub Actions y luego ZAP la escanea: recorre las páginas (spider),
envía payloads de SQLi y XSS, y reporta lo que encuentra.

## Paso 7 — [ACTUALIZA] `.github/workflows/security.yml`

**Qué cambia:** Añadimos los pasos para levantar la app, esperar a que esté
lista, correr ZAP, y subir el reporte como artifact.

Pegar **al final** de los `steps`, después del paso de SonarCloud:

```yaml
      - name: Start app
        run: |
          node server.js &
          sleep 3
        working-directory: Clase_7/app

      - name: Verify app is running
        run: curl -s http://localhost:3000/ > /dev/null

      - name: DAST - OWASP ZAP Full Scan
        uses: zaproxy/action-full-scan@v0.12.0
        with:
          target: "http://localhost:3000"
          cmd_options: "-a"

      - name: Upload ZAP report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: zap-report
          path: report_html.html
```

**Línea por línea:**

- `node server.js &` → arranca la app **en background** (el `&` libera la
  terminal). El `sleep 3` da tiempo a que arranque antes del siguiente paso.
- `curl -s http://localhost:3000/ > /dev/null` → verifica que la app responde.
  Si no responde, el workflow falla aquí (antes de ZAP) con un error claro.
- `zaproxy/action-full-scan@v0.12.0` → ejecuta el escaneo completo de ZAP:
  - `target: "http://localhost:3000"` → la URL a escanear.
  - `cmd_options: "-a"` → habilita el **escaneo activo** (envía payloads de
    ataque). Sin esto, ZAP solo haría análisis pasivo (revisar headers) y no
    encontraría SQLi ni XSS.
- `actions/upload-artifact@v4` → sube el reporte HTML de ZAP como artifact
  descargable. `if: always()` asegura que se suba incluso si ZAP falla (que es
  lo esperado, porque hay vulnerabilidades).

> **El concepto clave:** SAST corrió **antes** de levantar la app (analiza
> código). DAST corre **después** (necesita la app corriendo para atacarla).
> Esa es la diferencia fundamental.

## ► Checkpoint: ¡primera corrida de DAST!

```bash
git add .
git commit -m "Agregar DAST con OWASP ZAP al pipeline"
git push
```

En la pestaña **Actions**, el workflow ahora incluye los pasos de ZAP. El
escaneo activo tarda **3-5 minutos** (ZAP prueba cada endpoint con múltiples
payloads).

Cuando termine:

1. El workflow estará **rojo (❌)** — ZAP encontró vulnerabilidades de riesgo
   alto.
2. En la página del workflow run, abajo a la derecha, sección **Artifacts** →
   descargar `zap-report`.
3. Descomprimir y abrir `report_html.html` en el navegador.

Verás un reporte con:
- **High alerts:** SQL Injection, XSS reflejado.
- **Medium/Low alerts:** información expuesta, faltan cookies seguras, etc.

> **Momento de discusión:** "ZAP no leyó el código —atacó la app como lo haría un
> hacker. Encontró los mismos SQLi y XSS que SonarCloud, pero de forma
> independiente, probando la app real. Eso es DAST."

---

# BLOQUE 4 — Fix en vivo: arreglar SQL Injection

Vamos a arreglar **una sola vulnerabilidad** en vivo para demostrar el ciclo
completo: detectar → arreglar → verificar que desaparece.

## Paso 8 — [ACTUALIZA] `Clase_7/app/server.js`

**Qué cambia:** Reemplazar la query concatenada por una **query
parametrizada**.

Buscar esta línea en el endpoint `/user/:id`:

```javascript
const query = "SELECT id, username, email FROM users WHERE id = " + id;

db.get(query, (err, row) => {
```

Reemplazarla por:

```javascript
db.get(
  "SELECT id, username, email FROM users WHERE id = ?",
  [id],
  (err, row) => {
```

**Qué cambió:**

- **Antes:** `"WHERE id = " + id` → el `id` viene directo del usuario y se
  pega al string SQL. Si alguien pasa `1 OR 1=1`, la query es
  `WHERE id = 1 OR 1=1` y devuelve todo.
- **Después:** `WHERE id = ?` con `[id]` como segundo argumento → el `?` es un
  **placeholder** que SQLite reemplaza de forma segura. Pase lo que pase en
  `id`, SQLite lo trata como un **valor literal**, no como código SQL. `1 OR 1=1`
  se interpreta como el string literal `"1 OR 1=1"`, que no coincide con ningún
  ID.

> Esta misma técnica (`?` + array de valores) es la que ya usamos en `/login` y
> en los `INSERT`. Es el patrón correcto. La app era inconsistente a propósito:
> `/login` estaba bien, `/user/:id` estaba mal.

## ► Checkpoint: ¡ver cómo desaparece!

```bash
git add .
git commit -m "Fix SQL Injection: query parametrizada"
git push
```

Esperar a que el pipeline termine. Ahora:

1. **SonarCloud:** la vulnerabilidad de SQL Injection ya no aparece en el
   dashboard. Las otras 3 (XSS, MD5, JWT secret) siguen ahí.
2. **ZAP report:** el alerta de SQL Injection desapareció. XSS y los demás
   siguen.

> **Momento de discusión:** "Una línea de cambio. Antes el pipeline estaba
> rojo por SQLi en ambos escáneres. Ahora esa vulnerabilidad desapareció de
> ambos reportes. **Eso** es DevSecOps: detectar automáticamente, arreglar, y
> verificar que el fix funciona — en cada commit."

---

# Resumen

## Orden de creación

| Paso | Fichero | Acción |
|------|---------|--------|
| 1 | `Clase_7/app/package.json` | [NUEVO] dependencias |
| 2 | `Clase_7/app/server.js` | [NUEVO] app con 4 vulnerabilidades |
| 3 | `Clase_7/app/.gitignore` | [NUEVO] ignorar node_modules |
| 3b | `Clase_7/app/pnpm-workspace.yaml` | [NUEVO] permitir build de sqlite3 |
| 4 | — | Configurar SonarCloud en la web |
| 5 | `Clase_7/sonar-project.properties` | [NUEVO] config scanner |
| 6 | `.github/workflows/security.yml` | [NUEVO] workflow con SAST |
| 7 | `.github/workflows/security.yml` | [ACTUALIZA] añadir DAST |
| 8 | `Clase_7/app/server.js` | [ACTUALIZA] fix SQLi |

## Conceptos clave

- **SAST** analiza el **código fuente** sin ejecutar la app. Corre temprano en
  el pipeline (solo necesita el código). Detecta patrones: SQLi por
  concatenación, MD5, secretos hardcodeados.
- **DAST** ataca la **app en ejecución**. Corre más tarde (necesita la app
  desplegada). Detecta comportamientos: SQLi explotable, XSS reflejado.
- **SonarCloud** (SAST) → resultados en dashboard web. **OWASP ZAP** (DAST) →
  reporte descargable como artifact.
- Son **complementarios:** SQLi y XSS los detectan **ambos**, por caminos
  distintos. MD5 y el secret hardcodeado **solo SAST** (no hay forma de
  detectarlos atacando la app desde afuera).
- El **Quality Gate** hace que el pipeline **falle** si hay vulnerabilidades —
  la seguridad no es informativa, es un gate que bloquea el deploy.
- El fix de SQLi fue una línea: de concatenación a query parametrizada (`?`).

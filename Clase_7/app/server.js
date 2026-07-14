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
      <p><a href="/search?q=test">Probar busqueda</a></p>

      <h2>Usuarios</h2>
      <ul>
        <li><a href="/user?id=1">Usuario 1</a></li>
        <li><a href="/user?id=2">Usuario 2</a></li>
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

app.get("/user", (req, res) => {
    const id = req.query.id;
    if (id === undefined || id === "") {
        return res.send("<p>ID requerido</p><a href='/'>Volver</a>");
    }
    const query = "SELECT id, username, email FROM users WHERE id = " + id;

    db.get(query, (err, row) => {
        try {
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
                res.send("<p>Usuario no encontrado</p><a href='/'>Volver</a>");
            }
        } catch (e) {
            if (!res.headersSent) res.send("<p>Error interno</p>");
        }
    });
});

app.post("/login", (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: "username y password son obligatorios" });
    }
    const hash = crypto.createHash("md5").update(String(password)).digest("hex");

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

app.use((err, _req, res, _next) => {
    console.error("Error no manejado:", err);
    if (!res.headersSent) res.status(500).send("<p>Error interno</p>");
});

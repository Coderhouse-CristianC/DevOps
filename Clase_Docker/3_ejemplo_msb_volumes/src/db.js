const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS todos (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log("Tabla 'todos' verificada/creada");
}

async function getTodos() {
  const result = await pool.query(
    "SELECT * FROM todos ORDER BY created_at DESC"
  );
  return result.rows;
}

async function createTodo(title) {
  await pool.query("INSERT INTO todos (title) VALUES ($1)", [title]);
}

async function deleteTodo(id) {
  await pool.query("DELETE FROM todos WHERE id = $1", [id]);
}

async function checkConnection() {
  const result = await pool.query("SELECT NOW()");
  return result.rows[0].now;
}

module.exports = { init, getTodos, createTodo, deleteTodo, checkConnection };

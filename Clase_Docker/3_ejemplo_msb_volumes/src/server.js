const express = require("express");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

function renderPage(todos) {
  const todoRows = todos
    .map(
      (todo) => `
      <tr>
        <td>${todo.id}</td>
        <td>${todo.title}</td>
        <td>${new Date(todo.created_at).toLocaleString()}</td>
        <td>
          <form method="POST" action="/todos/${todo.id}/delete" style="display:inline">
            <button type="submit">Eliminar</button>
          </form>
        </td>
      </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head><title>Todo App</title></head>
<body>
  <h1>Todo App</h1>
  <div style="display:flex; gap:40px;">
    <div>
      <h2>Nueva Tarea</h2>
      <form method="POST" action="/todos">
        <input type="text" name="title" placeholder="Titulo de la tarea" required />
        <button type="submit">Crear</button>
      </form>
    </div>
    <div>
      <h2>Tareas</h2>
      <table border="1" cellpadding="5">
        <tr><th>ID</th><th>Titulo</th><th>Creada</th><th>Accion</th></tr>
        ${todoRows || '<tr><td colspan="4">No hay tareas</td></tr>'}
      </table>
    </div>
  </div>
</body>
</html>`;
}

app.get("/", async (req, res) => {
  const todos = await db.getTodos();
  res.send(renderPage(todos));
});

app.post("/todos", async (req, res) => {
  await db.createTodo(req.body.title);
  res.redirect("/");
});

app.post("/todos/:id/delete", async (req, res) => {
  await db.deleteTodo(req.params.id);
  res.redirect("/");
});

app.get("/health", async (req, res) => {
  try {
    const now = await db.checkConnection();
    res.json({ status: "ok", db_time: now });
  } catch {
    res.status(500).json({ status: "error", message: "Database unreachable" });
  }
});

async function start() {
  await db.init();
  app.listen(PORT, () => {
    console.log(`Server running in ${process.env.NODE_ENV || "unknown"} mode on port ${PORT}`);
  });
}

start();

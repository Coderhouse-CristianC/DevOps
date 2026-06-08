# Todo App - Multi-Stage Build con PostgreSQL

Ejemplo de Docker multi-stage build con una Todo App conectada a PostgreSQL via docker-compose.

Demuestra como los datos se pierden sin volumenes y como persisten al declarar un volumen nombrado para PG.

## Estructura de stages

| Stage | Descripcion |
|---|---|
| `base` | Instala solo dependencias de produccion |
| `source` | Copia el codigo fuente |
| `development` | Agrega devDependencies, usa nodemon |
| `production` | Corre con `USER node`, optimizado |

## Levantar

```bash
docker compose up --build
```

Abrir http://localhost:3000 para ver la app.

## Detener

```bash
docker compose down
```

Esto elimina containers y redes. Al levantar de nuevo, PostgreSQL arranca con un nuevo volumen anonimo (datos en blanco).

## Limpiar volumenes huerfanos

```bash
docker volume prune
```

Elimina volumenes anonimos no referenciados por ningun container.

## Probar sin persistencia (datos se pierden)

1. Levantar: `docker compose up --build`
2. Abrir http://localhost:3000 y crear algunas tareas
3. Detener: `docker compose down`
4. Levantar de nuevo: `docker compose up --build`
5. Las tareas ya no existen

## Probar con persistencia

Descomentar las lineas de volumen en `docker-compose.yml`:

```yaml
db:
  volumes:
    - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

1. Levantar: `docker compose up --build`
2. Crear algunas tareas
3. Detener: `docker compose down`
4. Levantar de nuevo: `docker compose up --build`
5. Las tareas siguen existiendo

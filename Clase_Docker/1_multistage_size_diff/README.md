# Multi-Stage Build - Diferencia de Tamaño

Ejemplo que demuestra la diferencia de tamaño de imagen entre un Dockerfile tradicional y un multi-stage build, usando una aplicacion simple en Go.

## Que demuestra

- **Dockerfile.tradicional**: Usa la imagen completa de Go (~300MB+), incluye compiladores, SDK y herramientas que no se necesitan en produccion
- **Dockerfile.multistage**: Compila en una etapa con Go y copia solo el binario final a una imagen Alpine limpia (~10MB)

## Archivos

| Archivo | Descripcion |
|---|---|
| `main.go` | Servidor HTTP simple en Go que responde en el puerto 8080 |
| `Dockerfile.tradicional` | Build tradicional en una sola etapa |
| `Dockerfile.multistage` | Build multi-stage con etapa de compilacion y produccion separadas |
| `docker-compose.yml` | PostgreSQL + Adminer para gestion visual de la base de datos |

## Comandos

### Build y comparar tamaños

```bash
# Build tradicional
docker build -f Dockerfile.tradicional -t go-app:tradicional .

# Build multi-stage
docker build -f Dockerfile.multistage -t go-app:multistage .

# Comparar tamaños
docker images go-app
```

### Run

```bash
# Traditional
docker run -p 8080:8080 go-app:tradicional

# Multi-stage
docker run -p 8080:8080 go-app:multistage
```

## Probar

```bash
curl http://localhost:8080
```

Devuelve: `Hola Coder desde un binario de Go!`

## Docker Compose (PostgreSQL + Adminer)

```bash
docker compose up -d
```

- **Adminer**: http://localhost:8080
- **PostgreSQL**: `localhost:5432` (user: `cristian`, pass: `password123`, db: `clase_docker`)

### Detener

```bash
docker compose down
```

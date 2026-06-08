# Multi-Stage Build - Different Environments

Ejemplo de Docker multi-stage build que demuestra como seleccionar diferentes entornos usando `--target`.

## Stages

| Stage | Descripcion |
|---|---|
| `base` | Instala solo dependencias de produccion (`npm ci --only=production`) |
| `development` | Hereda de `base`, agrega `devDependencies`, usa `nodemon` |
| `production` | Hereda de `base`, corre con `USER node`, optimizado |

## Comandos

### Build

```bash
# Development
docker build --target development -t app:dev .

# Production
docker build --target production -t app:prod .
```

### Run

```bash
# Development
docker run -p 3000:3000 app:dev

# Production
docker run -p 3000:3000 app:prod
```

## Probar

```bash
curl http://localhost:3000/
curl http://localhost:3000/health
```

El endpoint `/` devuelve el entorno actual (`development` o `production`) y un timestamp.

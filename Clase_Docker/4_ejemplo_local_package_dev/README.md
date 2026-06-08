# Desarrollo Local de Paquetes con Docker

Ejemplo de como montar un paquete local sobre `node_modules` usando volumenes en Docker, permitiendo editar el paquete sin publicarlo en npm.

## Que demuestra

- El Dockerfile instala `string-uppercase` desde npm (version 0.3.1)
- El `docker-compose.yml` monta `./packages/string-uppercase` sobre `/app/node_modules/string-uppercase`
- Los cambios en el paquete local se reflejan inmediatamente sin rebuild

## Estructura

```
ejemplo_local_package_dev/
├── packages/
│   └── string-uppercase/    # Paquete local editable
│       ├── package.json
│       └── lib/
│           └── index.js
├── src/
│   └── server.js            # Servidor Express
├── docker-compose.yml
├── Dockerfile
└── package.json
```

## Levantar

```bash
docker compose up --build
```

Abrir http://localhost:3000?text=hola

## Probar

Con el compose levantado, el endpoint devuelve:

```json
{"original":"hola","uppercase":"HOLA","source":"local","package_version":"1.0.0"}
```

`source: "local"` indica que esta usando el paquete montado, no el de npm.

## Editar en vivo

1. Con el compose corriendo, editar `packages/string-uppercase/lib/index.js`
2. Por ejemplo, cambiar el return a: `return str.toUpperCase() + "!!!"`
3. El servidor se reinicia automaticamente con nodemon
4. Probar: http://localhost:3000?text=hola → `{"uppercase":"HOLA!!!"}`

## Detener

```bash
docker compose down
```

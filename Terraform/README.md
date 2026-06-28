# Clase: Terraform + AWS — API de usuarios (Node + PostgreSQL)

En esta clase montamos una API REST (Node + Express) que guarda usuarios en
PostgreSQL, la probamos en local con Docker y luego levantamos toda la
infraestructura en AWS con **Terraform**.

```
POST /users  -> crea un usuario
GET  /users  -> lista los usuarios
GET  /health -> chequeo de vida
```

## Objetivos de la clase

1. Entender el ciclo `init / plan / apply / destroy` de Terraform.
2. Modelar infraestructura con módulos y recursos de AWS.
3. Conectar una VM (EC2) con una base de datos gestionada (RDS) usando Security Groups.
4. Desplegar código sobre la VM con `user_data` y `systemd`.

---

## Requisitos previos

| Herramienta | Para qué | Verificación |
|-------------|----------|--------------|
| Cuenta AWS  | Crear recursos | — |
| AWS CLI     | Credenciales de Terraform | `aws sts get-caller-identity` |
| Terraform ≥ 1.5 | Infraestructura como código | `terraform version` |
| Docker      | Probar la app en local | `docker --version` |
| Git         | Versionar y clonar el repo | `git --version` |
| curl        | Probar la API | `curl --version` |

Configura tus credenciales de AWS antes de empezar:

```bash
aws configure   # pide Access Key, Secret Key, región y formato
```

> Importante: usa una cuenta dentro del **free tier** (primeros 12 meses) si no
> quieres incurrir en costos. RDS y EC2 te dan 750 h/mes gratis en ese período.

---

## Estructura del repositorio

```
.
├── app/                         # Código del backend (separado de la infra)
│   ├── server.js                #   Express + pg, endpoints y auto-init del schema
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml           # Entorno local: postgres + app
├── infraestructura/             # TODO lo de Terraform vive aquí
│   ├── versions.tf              #   Providers (aws, random, tls, local)
│   ├── variables.tf             #   Variables de entrada
│   ├── main.tf                  #   Data sources + 3 módulos
│   ├── outputs.tf               #   Outputs (ip, endpoint, url...)
│   ├── terraform.tfvars.example #   Ejemplo de valores
│   └── modules/
│       ├── security/            #   Security Groups (EC2 y RDS)
│       ├── database/            #   RDS Postgres + password aleatorio
│       └── compute/             #   EC2 + Elastic IP + key + user_data
└── README.md
```

---

## Parte 1 — La aplicación

`app/server.js` es una API mínima:

- Usa **Express** para exponer HTTP y el driver **`pg`** para hablar con Postgres.
- Al arrancar ejecuta `CREATE TABLE IF NOT EXISTS users (...)` → **auto-init**,
  así no hace falta un paso de migraciones aparte.
- Lee la conexión de variables de entorno:
  `PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE`.

Esquema de la tabla:

| columna      | tipo         | notas                       |
|--------------|--------------|-----------------------------|
| id           | SERIAL (PK)  | autoincremental             |
| name         | TEXT         | NOT NULL                    |
| email        | TEXT         | UNIQUE                      |
| created_at   | TIMESTAMPTZ  | por defecto `now()`         |

---

## Parte 2 — Probar en local con Docker

Levantamos la app + Postgres con un solo comando:

```bash
docker compose up --build
```

Esto crea dos contenedores:

- `users-api-db` → PostgreSQL 16 (con healthcheck `pg_isready`).
- `users-api-app` → la API, que espera a que la DB esté sana antes de arrancar.

Probamos:

```bash
# salud
curl http://localhost:3000/health
# {"status":"ok"}

# crear usuario
curl -X POST http://localhost:3000/users \
  -H 'Content-Type: application/json' \
  -d '{"name":"Ada","email":"ada@ejemplo.com"}'

# listar usuarios
curl http://localhost:3000/users
```

Para parar: `docker compose down` (los datos persisten en el volumen `pgdata`).

---

## Parte 3 — La infraestructura (Terraform)

Todo el código Terraform está en `infraestructura/`.

### Arquitectura en AWS

```
                 Internet
                    │
        ┌───────────┴───────────┐
        │   Security Group EC2  │   :3000 y :22 abiertos a 0.0.0.0/0
        │   (EC2 t3.micro)      │
        │   node server.js      │◀── systemd (Restart=always)
        └───────────┬───────────┘
                    │ :5432  (solo la EC2 puede llegar)
        ┌───────────┴───────────┐
        │   Security Group RDS  │
        │   RDS PostgreSQL 16   │   db.t4g.micro, 20 GB, privada
        └───────────────────────┘
```

- **VPC por defecto** (no creamos red nueva; la réfénciamos con `data`).
- **EC2** (`modules/compute`): AMI Amazon Linux 2023, `t3.micro`, Elastic IP,
  key pair generado por Terraform, y un `user_data` que:
  1. instala `git` y `nodejs`,
  2. hace `git clone` del repo,
  3. `npm install`,
  4. escribe `/etc/app.env` con las credenciales,
  5. crea un servicio **systemd** y lo activa.
- **RDS** (`modules/database`): Postgres 16, `db.t4g.micro`, password generado
  con el provider `random`, `skip_final_snapshot=true` para borrar sin trabas.
- **Security Groups** (`modules/security`): la EC2 expone `:3000` y `:22`; la
  RDS solo acepta `:5432` desde el SG de la EC2.

> **Footgun didáctico:** el password de la DB se inyecta en texto plano dentro
> del `user_data`. Es visible con
> `aws ec2 describe-instance-attribute --instance-id <id> --attribute userData --query UserData.Value --output text | base64 -d`.
> Sirve para arrancar; luego sería el momento de mejorar a **SSM Parameter
> Store** + IAM Role.

### Variables principales (`infraestructura/variables.tf`)

| Variable        | Default                              | Descripción                         |
|-----------------|--------------------------------------|-------------------------------------|
| `aws_region`    | `us-east-1`                          | Región de despliegue                |
| `project_name`  | `users-api`                          | Prefijo de los nombres de recursos  |
| `app_repo_url`  | `https://github.com/CHANGEME/...git` | **Tu repo público** (¡obligatorio!) |
| `db_name`       | `appdb`                              | Nombre de la base                   |
| `db_username`   | `api`                                | Usuario de la base                  |
| `instance_type` | `t3.micro`                           | Tipo de EC2 (free tier)             |

---

## Parte 4 — Desplegar en AWS, paso a paso

> Antes de empezar: el repo debe ser **público** en GitHub, porque la EC2 lo
> clona con `git clone` sin credenciales.

```bash
cd infraestructura

# 1) Copia el archivo de variables y edita tu repo
cp terraform.tfvars.example terraform.tfvars
#    -> cambia app_repo_url por la URL pública de TU repo

# 2) Inicializa Terraform (descarga providers)
terraform init

# 3) Revisa el plan antes de crear nada
terraform plan

# 4) Crea la infraestructura
terraform apply      # escribe "yes" cuando pida confirmar
```

Al terminar, Terraform muestra los **outputs**:

- `api_url` → `http://<IP>:3000`
- `ec2_public_ip`
- `ssh_command` → `ssh -i clave.pem ec2-user@<IP>`
- `rds_endpoint` (sensible)

También genera un archivo **`infraestructura/clave.pem`** con la clave privada
para entrar por SSH (ya con permisos `600`).

> ⏱️ El `apply` tarda varios minutos (sobre todo la RDS). El `user_data` corre
> en segundo plano al primer arranque de la EC2; espera ~1-2 min extra a que
> termine de instalar paquetes y levantar el servicio.

---

## Parte 5 — Probar la API desplegada

Usa la `api_url` del output:

```bash
API=http://<IP>:3000

# salud
curl $API/health

# crear un par de usuarios
curl -X POST $API/users -H 'Content-Type: application/json' \
  -d '{"name":"Ada Lovelace","email":"ada@ejemplo.com"}'
curl -X POST $API/users -H 'Content-Type: application/json' \
  -d '{"name":"Alan Turing","email":"alan@ejemplo.com"}'

# listar
curl $API/users
```

### Depurar en la VM (opcional)

```bash
ssh -i infraestructura/clave.pem ec2-user@<IP>

# estado del servicio
systemctl status app
# logs en vivo
sudo journalctl -u app -f
# variables que ve la app
sudo cat /etc/app.env
```

---

## Parte 6 — Limpieza (¡para no facturar!)

Cuando termines la clase, destruye todo:

```bash
cd infraestructura
terraform destroy        # escribe "yes"
```

Como configuramos `skip_final_snapshot=true` y `deletion_protection=false`, el
destroy borra la RDS sin trabas ni costos residuales de snapshot.

> Recomendado: entra a la consola de AWS (EC2 y RDS) y confirma que no quedan
> instancias sueltas.

---

## Ciclo de vida de Terraform (resumen para la clase)

| Comando              | Qué hace                                         |
|----------------------|--------------------------------------------------|
| `terraform init`     | Descarga providers, prepara el directorio         |
| `terraform fmt`      | Formatea el código `.tf`                          |
| `terraform validate` | Comprueba que la sintaxis sea correcta            |
| `terraform plan`     | Muestra qué crearía/cambiaría/destruiría (dry-run)|
| `terraform apply`    | Aplica los cambios                                |
| `terraform destroy`  | Borra toda la infra gestionada                    |

---

## Ideas para siguientes clases

- Migrar el password de `user_data` a **SSM Parameter Store** + IAM Role.
- Añadir un **dominio + HTTPS** (Route 53 + ALB + Certificate Manager).
- Estado remoto en **S3 + DynamoDB** (lock) para trabajar en equipo.
- Pasar de `user_data` + `git clone` a un **AMI horneada** con Packer o a CI/CD.

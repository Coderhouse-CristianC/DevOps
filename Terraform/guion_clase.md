# Guion de clase — Construyendo la infra paso a paso

> Guía desde la perspectiva del profesor. El objetivo es **llegar a la estructura
> final con módulos**, pero **creando los ficheros de uno en uno**, entendiendo
> qué aporta cada uno y pudiendo ejecutar comandos entre pasos (checkpoints).
>
> Convenciones:
> - `[NUEVO]` = creas el fichero desde cero.
> - `[ACTUALIZA]` = el fichero ya existe y le **añades** código al final.
> - `► Checkpoint` = momento para ejecutar comandos y ver algo funcionando.

---

## Mapa del recorrido

```
Bloque 1  Andamiaje        → versions.tf, variables.tf        → terraform init
Bloque 2  Leer infra       → main.tf (data sources)           → terraform plan
Bloque 3  Módulo security  → SG de EC2 y RDS                  → crea 2 SG
Bloque 4  Módulo database  → RDS + password aleatorio         → crea la base
Bloque 5  Módulo compute   → EC2 + EIP + key + user_data      → crea la VM
Bloque 6  Despliegue       → tfvars + apply final             → API en producción
```

Pre-requisito: `aws configure` hecho y `terraform` instalado.

---

## Paso 0 — El código que vamos a desplegar (contexto)

La clase es de Terraform, así que la app la tratamos como una **caja negra ya
resuelta**. La creamos rápido y pasamos a lo importante. La explicación
línea por línea se reserva para los ficheros Terraform.

### 0.1 [NUEVO] `app/package.json`

Declara las dependencias (`express` y `pg`) y el script de arranque.

```json
{
  "name": "users-api",
  "version": "1.0.0",
  "description": "API de usuarios con Node + PostgreSQL",
  "type": "module",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.19.2",
    "pg": "^8.12.0"
  }
}
```

### 0.2 [NUEVO] `app/server.js`

La API. Lee la conexión a Postgres de variables de entorno, crea la tabla al
arrancar (auto-init) y expone `POST /users`, `GET /users` y `GET /health`.

```javascript
import express from "express";
import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT) || 5432,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : undefined,
});

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/users", async (req, res) => {
  const { name, email } = req.body;
  if (!name || !email) {
    return res.status(400).json({ error: "name y email son obligatorios" });
  }
  try {
    const result = await pool.query(
      "INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *",
      [name, email]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    if (err.code === "23505") {
      return res.status(409).json({ error: "email ya existe" });
    }
    res.status(500).json({ error: "error interno" });
  }
});

app.get("/users", async (_req, res) => {
  try {
    const result = await pool.query("SELECT * FROM users ORDER BY id ASC");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "error interno" });
  }
});

const PORT = process.env.PORT || 3000;

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log("schema inicializado");
  app.listen(PORT, () => console.log(`api escuchando en puerto ${PORT}`));
}

init().catch((err) => {
  console.error("no se pudo iniciar", err);
  process.exit(1);
});
```

### 0.3 [NUEVO] `app/Dockerfile`

Para empaquetar la app en una imagen reproducible.

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

### 0.4 [NUEVO] `app/.dockerignore`

Evita copiar `node_modules` local dentro de la imagen.

```
node_modules
npm-debug.log
Dockerfile
.dockerignore
```

### 0.5 [NUEVO] `docker-compose.yml`

Entorno local: levanta Postgres + la API para probar antes de ir a AWS.

```yaml
services:
  db:
    image: postgres:16-alpine
    container_name: users-api-db
    environment:
      POSTGRES_USER: api
      POSTGRES_PASSWORD: api
      POSTGRES_DB: api
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U api -d api"]
      interval: 5s
      timeout: 3s
      retries: 10

  app:
    build:
      context: ./app
    container_name: users-api-app
    ports:
      - "3000:3000"
    environment:
      PGHOST: db
      PGPORT: "5432"
      PGUSER: api
      PGPASSWORD: api
      PGDATABASE: api
    depends_on:
      db:
        condition: service_healthy

volumes:
  pgdata:
```

> ► Prueba local: `docker compose up --build` y luego
> `curl http://localhost:3000/health`.

---

# BLOQUE 1 — El andamiaje de Terraform

Empezamos dentro de la carpeta `infraestructura/` (créala si no existe).

```bash
mkdir -p infraestructura
cd infraestructura
```

## Paso 1 — [NUEVO] `infraestructura/versions.tf`

**Qué hace:** Declara qué versión de Terraform hace falta y qué **providers**
(plugin que sabe hablar con un proveedor cloud) vamos a usar. Por ahora solo el
de AWS. Aquí también configuramos el provider con la región.

```hcl
terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}
```

**Línea por línea:**

- `terraform { ... }` → bloque de configuración del propio Terraform.
- `required_version = ">= 1.5.0"` → exigimos Terraform 1.5 o superior. Evita
  que alguien con una versión muy vieja use sintaxis no soportada.
- `required_providers { ... }` → lista de plugins a descargar.
- `aws = { source = "hashicorp/aws", version = "~> 5.0" }` → el provider de AWS.
  `source` es el registro (registry.terraform.io). `~> 5.0` significa
  "cualquier 5.x pero no 6.0": permite parches, prohíbe cambios mayores que
  podrían romper el código.
- `provider "aws" { region = var.aws_region }` → instancia el provider indicando
  en qué región operará. Usa la variable `aws_region` (la creamos en el paso 2).

> `[ACTUALIZA]` más adelante: cuando añadamos la base de datos meteremos aquí el
> provider `random`, y con la VM añadiremos `tls` y `local`.

## Paso 2 — [NUEVO] `infraestructura/variables.tf`

**Qué hace:** Define las **variables de entrada**. Empezamos con dos: la región
y un nombre de proyecto que usaremos como prefijo para todos los recursos.

```hcl
variable "aws_region" {
  description = "Region de AWS donde se despliega la infra"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Prefijo usado para nombrar todos los recursos"
  type        = string
  default     = "users-api"
}
```

**Línea por línea (bloque `variable`):**

- `variable "aws_region"` → declara una variable llamada `aws_region`. Se lee en
  cualquier sitio con `var.aws_region` (lo vimos en `provider "aws"`).
- `description` → documentación; se muestra en `terraform plan`.
- `type = string` → fuerza el tipo. Terraform fallará si le pasas un número.
- `default` → valor por defecto si nadie lo sobreescribe (vía `-var`, `*.tfvars`
  o variables de entorno `TF_VAR_*`).

> `[ACTUALIZA]` más adelante: iremos añadiendo variables (`db_name`,
> `db_username`, `app_repo_url`, `instance_type`) conforme las necesitemos.

## ► Checkpoint: ¡primer `init`!

```bash
terraform init
```

Verás que descarga el provider `hashicorp/aws` y crea `.terraform/` y
`.terraform.lock.hcl`. Ya tenemos Terraform "vivo".

---

# BLOQUE 2 — Leer la infraestructura existente

AWS ya tiene un **VPC por defecto** con subnets en cada zona. En vez de crear
red nueva (complicado y caro), la **referenciamos** con `data`. Aprender la
diferencia entre `resource` (crea) y `data` (lee) es clave.

## Paso 3 — [NUEVO] `infraestructura/main.tf`

**Qué hace:** Por ahora solo **data sources**: identifica el VPC por defecto,
sus subnets y busca la AMI más reciente de Amazon Linux 2023. No crea nada.

```hcl
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-x86_64"]
  }
}
```

**Línea por línea:**

- `data "aws_vpc" "default" { default = true }` → busca el VPC que AWS marca como
  "por defecto". Queda accesible como `data.aws_vpc.default.id`.
- `data "aws_subnets" "default"` → devuelve la **lista de subnets** de ese VPC.
  - `filter { name = "vpc-id", values = [data.aws_vpc.default.id] }` → filtra
    subnets que pertenezcan al VPC de arriba. El resultado es una lista
    (`data.aws_subnets.default.ids`).
- `data "aws_ami" "al2023"` → busca una imagen de máquina (AMI) para arrancar la
  EC2. En el paso 5 la usaremos.
  - `most_recent = true` → si hay varias, coge la última.
  - `owners = ["amazon"]` → solo imágenes oficiales de AWS (fiables).
  - `filter` por `name` → el patrón `al2023-ami-2023.*-x86_64` pega con las AMI
    de Amazon Linux 2023 para x86_64.

## ► Checkpoint: ¡primer `plan`!

```bash
terraform plan
```

Saldrá **"No changes"**: Terraform solo leyó datos, no va a crear nada. Pero ya
sabe quién es el VPC, las subnets y la AMI. Perfecto.

---

# BLOQUE 3 — El módulo `security`

Vamos a crear nuestro **primer módulo**. Un módulo es simplemente **una carpeta
con ficheros `.tf`** que encapsula recursos relacionados. Así reutilizamos y
ordenamos el código. Lo aplicamos a los **Security Groups** (los firewalls de
AWS): uno para la EC2 y otro para la RDS.

## Paso 4 — [NUEVO] `infraestructura/modules/security/variables.tf`

**Qué hace:** Define qué datos necesita el módulo para funcionar. Un módulo se
comunica con el exterior **solo** a través de sus variables.

```hcl
variable "name_prefix" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "app_port" {
  type = number
}
```

**Línea por línea:**

- `name_prefix` → texto que se antepondrá al nombre de cada SG (ej.
  `users-api-ec2-sg`). Así evitamos chocar con recursos ajenos.
- `vpc_id` → el VPC donde vivirán los SG. Se lo pasaremos desde `main.tf`.
- `app_port` → el puerto de la API (3000). Lo dejamos como variable para no
  "adivinarlo" dentro del módulo.

## Paso 5 — [NUEVO] `infraestructura/modules/security/main.tf`

**Qué hace:** Define los dos Security Groups. Aquí aparece por primera vez la
palabra `resource` (que **crea** infraestructura).

```hcl
resource "aws_security_group" "ec2" {
  name   = "${var.name_prefix}-ec2-sg"
  vpc_id = var.vpc_id

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "API HTTP"
    from_port   = var.app_port
    to_port     = var.app_port
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "rds" {
  name   = "${var.name_prefix}-rds-sg"
  vpc_id = var.vpc_id

  ingress {
    description     = "Postgres desde la EC2"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ec2.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
```

**Línea por línea:**

- `resource "aws_security_group" "ec2"` → crea un SG. Sintaxis general de un
  recurso: `resource "TIPO" "NOMBRE_LOCAL"`. El "nombre local" (`ec2`) es cómo
  lo referenciamos dentro de Terraform.
- `name = "${var.name_prefix}-ec2-sg"` → el nombre real en AWS. La
  interpolación `${...}` inserta la variable.
- `vpc_id = var.vpc_id` → a qué VPC pertenece el SG.
- `ingress { ... }` → **regla de entrada** (qué tráfico deja pasar hacia el
  recurso). Hay dos bloques `ingress`: uno para SSH (22) y otro para la API.
  - `from_port`/`to_port` → rango de puertos (aquí uno solo).
  - `protocol = "tcp"` → protocolo.
  - `cidr_blocks = ["0.0.0.0/0"]` → desde qué IPs. `0.0.0.0/0` = todo Internet.
    Lo abrimos para que los alumnos prueben la API desde cualquier sitio (es un
    "smell" de seguridad: buen tema de discusión).
- `egress { ... }` → **regla de salida**. Con `protocol = "-1"`, `from_port = 0`
  y `to_port = 0` permitimos **cualquier salida** (la EC2 podrá descargar
  paquetes, llamar a GitHub, etc.).
- El segundo recurso `aws_security_group.rds` protege la base de datos. La
  diferencia clave:
  - `security_groups = [aws_security_group.ec2.id]` → en vez de un CIDR, permite
    conectar al 5432 **solo a quienes pertenezcan al SG de la EC2**. Así la base
    queda inaccesible desde Internet, pero la VM llega a ella. Es el patrón
    recomendado SG-a-SG.

## Paso 6 — [NUEVO] `infraestructura/modules/security/outputs.tf`

**Qué hace:** Expone los IDs de los SG para que el `main.tf` raíz pueda pasarlos
a otros módulos (la RDS necesita el SG de la EC2).

```hcl
output "ec2_sg_id" {
  value = aws_security_group.ec2.id
}

output "rds_sg_id" {
  value = aws_security_group.rds.id
}
```

**Línea por línea:**

- `output "ec2_sg_id" { value = aws_security_group.ec2.id }` → publica el ID del
  SG de la EC2 con el nombre `ec2_sg_id`. Desde fuera se lee como
  `module.security.ec2_sg_id`. Lo mismo con `rds_sg_id`.

## Paso 7 — [ACTUALIZA] `infraestructura/main.tf`

**Qué cambia:** Añadimos un **bloque `module`** que "instancia" el módulo
security, pasándole sus variables. Pega esto **al final** del `main.tf` que ya
tiene los data sources.

```hcl
module "security" {
  source      = "./modules/security"
  name_prefix = var.project_name
  vpc_id      = data.aws_vpc.default.id
  app_port    = 3000
}
```

**Línea por línea:**

- `module "security"` → usa el módulo. El nombre `security` es cómo lo
  referenciamos (`module.security.xxx`).
- `source = "./modules/security"` → ruta de la carpeta del módulo.
- El resto (`name_prefix`, `vpc_id`, `app_port`) → son las **variables** que
  definimos en el paso 4. Se las rellenamos pasándoles valores del raíz:
  `var.project_name` y `data.aws_vpc.default.id`.

> Al añadir un módulo nuevo, Terraform necesita recargar la configuración.

```bash
terraform init     # registra el módulo
terraform plan     # ahora sí: propone crear 2 Security Groups
terraform apply    # crea los 2 SG
```

## ► Checkpoint

En la consola de AWS → VPC → Security Groups verás dos grupos nuevos
(`users-api-ec2-sg` y `users-api-rds-sg`).

---

# BLOQUE 4 — El módulo `database`

Creamos la base de datos **RDS PostgreSQL** gestionada. Aprovechamos para
introducir dos cosas: el provider `random` (para generar el password) y el
recurso `aws_db_instance`.

## Paso 8 — [ACTUALIZA] `infraestructura/versions.tf`

**Qué cambia:** Añadimos el provider `random` dentro del bloque
`required_providers` (junto al de `aws`).

```hcl
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
```

**Por qué:** El provider `random` sabe generar valores aleatorios ( passwords,
IDs). Lo usaremos para que el password de la base no sea fijo ni se repita.

> Tras tocar `versions.tf`, ejecuta `terraform init` para descargar el provider
> nuevo.

## Paso 9 — [ACTUALIZA] `infraestructura/variables.tf`

**Qué cambia:** Añadimos dos variables para la base de datos, al final del
fichero.

```hcl
variable "db_name" {
  description = "Nombre de la base de datos Postgres"
  type        = string
  default     = "appdb"
}

variable "db_username" {
  description = "Usuario administrador de la base de datos"
  type        = string
  default     = "api"
}
```

**Por qué:** La RDS necesita saber cómo se llama la base y el usuario. El
password **no** es variable: se genera aleatoriamente (siguientes pasos).

## Paso 10 — [NUEVO] `infraestructura/modules/database/variables.tf`

**Qué hace:** Entradas del módulo database.

```hcl
variable "name_prefix" {
  type = string
}

variable "db_name" {
  type = string
}

variable "db_username" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "allowed_sg_id" {
  description = "Security group autorizado a conectar a Postgres (el de la EC2)"
  type        = string
}
```

**Línea por línea:**

- `subnet_ids` → lista de subnets donde RDS puede ubicarse. RDS exige un **DB
  Subnet Group** con varias subnets (en distintas zonas) aunque uses una sola.
  `type = list(string)` → es una lista de strings.
- `allowed_sg_id` → el SG con permiso para conectar al 5432 (el de la EC2).

## Paso 11 — [NUEVO] `infraestructura/modules/database/main.tf`

**Qué hace:** Genera el password, crea el DB Subnet Group y la instancia RDS.

```hcl
resource "random_password" "master" {
  length  = 24
  special = false
}

resource "aws_db_subnet_group" "this" {
  name       = "${var.name_prefix}-sng"
  subnet_ids = var.subnet_ids
}

resource "aws_db_instance" "this" {
  identifier                 = "${var.name_prefix}-db"
  engine                     = "postgres"
  engine_version             = "16"
  instance_class             = "db.t4g.micro"
  allocated_storage          = 20
  storage_type               = "gp3"
  db_name                    = var.db_name
  username                   = var.db_username
  password                   = random_password.master.result
  db_subnet_group_name       = aws_db_subnet_group.this.name
  vpc_security_group_ids     = [var.allowed_sg_id]
  publicly_accessible        = false
  skip_final_snapshot        = true
  deletion_protection        = false
  backup_retention_period    = 0
  auto_minor_version_upgrade = true
}
```

**Línea por línea:**

- `random_password.master`:
  - `length = 24` → 24 caracteres.
  - `special = false` → sin símbolos raros, para no romper URLs ni el `user_data`
    más adelante. El valor se lee como `random_password.master.result`.
- `aws_db_subnet_group.this` → grupo lógico de subnets que RDS usará para
  colocar la instancia. `subnet_ids = var.subnet_ids`.
- `aws_db_instance.this` → la base de datos en sí:
  - `engine = "postgres"`, `engine_version = "16"` → motor y versión.
  - `instance_class = "db.t4g.micro"` → tamaño (free tier, ARM Graviton).
  - `allocated_storage = 20`, `storage_type = "gp3"` → 20 GB de disco rápido.
  - `db_name`, `username` → de las variables.
  - `password = random_password.master.result` → el password generado arriba.
  - `db_subnet_group_name` → el grupo del recurso anterior. Observa cómo un
    recurso referencia a otro: `aws_db_subnet_group.this.name`.
  - `vpc_security_group_ids = [var.allowed_sg_id]` → le asociamos el SG de la
    EC2 (solo ella podrá conectar).
  - `publicly_accessible = false` → la base **no** tiene IP pública. Solo
    alcanzable desde dentro del VPC. Más seguro.
  - `skip_final_snapshot = true` → al hacer `destroy`, no exige un snapshot
    final (que trabaría el borrado y podría costar dinero).
  - `deletion_protection = false` → permite borrarla.
  - `backup_retention_period = 0` → sin backups automáticos (más barato, típico
    de un entorno de clase).

## Paso 12 — [NUEVO] `infraestructura/modules/database/outputs.tf`

**Qué hace:** Publica los datos de conexión. Otros módulos (compute) y el raíz
los necesitan.

```hcl
output "endpoint" {
  description = "Endpoint completo host:port"
  value       = aws_db_instance.this.endpoint
}

output "endpoint_address" {
  description = "Solo el host (para PGHOST)"
  value       = aws_db_instance.this.address
}

output "db_name" {
  value = aws_db_instance.this.db_name
}

output "db_username" {
  value = aws_db_instance.this.username
}

output "db_password" {
  value     = random_password.master.result
  sensitive = true
}
```

**Línea por línea:**

- `endpoint` → `host:puerto` (ej. `midb.abc.eu-west-1.rds.amazonaws.com:5432`).
- `endpoint_address` → solo el host, que es lo que pondremos en `PGHOST`.
- `db_password { sensitive = true }` → marca el valor como **sensible**. Así no
  se imprime en el `plan`/`apply` ni en `terraform output` (hay que pedirlo con
  `terraform output -raw db_password` o pasarlo a quien lo necesite).

## Paso 13 — [ACTUALIZA] `infraestructura/main.tf`

**Qué cambia:** Añadimos el bloque `module "database"`. Pégalo después del de
`security`.

```hcl
module "database" {
  source        = "./modules/database"
  name_prefix   = var.project_name
  db_name       = var.db_name
  db_username   = var.db_username
  subnet_ids    = data.aws_subnets.default.ids
  allowed_sg_id = module.security.rds_sg_id
}
```

**Línea por línea:**

- `subnet_ids = data.aws_subnets.default.ids` → le pasamos la lista de subnets
  del VPC por defecto (del data source del paso 3).
- `allowed_sg_id = module.security.rds_sg_id` → **un módulo alimentando a otro**:
  el SG de RDS que creó el módulo security se lo pasamos al módulo database.
  Terraform entiende la dependencia y creará security antes que database.

## Paso 14 — [NUEVO] `infraestructura/outputs.tf`

**Qué hace:** Creamos el fichero de outputs del raíz con el endpoint de la base.
Más adelante añadiremos los de la VM.

```hcl
output "rds_endpoint" {
  description = "Endpoint de RDS (host:port)"
  value       = module.database.endpoint
  sensitive   = true
}
```

**Línea por línea:**

- `value = module.database.endpoint` → lee el output `endpoint` del módulo
  database y lo reexpone a quien ejecute Terraform.

## ► Checkpoint

```bash
terraform init      # si no lo hiciste tras el paso 8 (provider random)
terraform plan      # propone crear: password + subnet group + RDS
terraform apply
```

> La RDS tarda varios minutos en crearse. Al acabar,
> `terraform output rds_endpoint` muestra el endpoint.

---

# BLOQUE 5 — El módulo `compute`

El más rico: creamos la clave SSH, la EC2 con su `user_data`, la IP elástica y
generamos el archivo `.pem` en local.

## Paso 15 — [ACTUALIZA] `infraestructura/versions.tf`

**Qué cambia:** Añadimos los providers `tls` (claves criptográficas) y `local`
(escribir ficheros en disco).

```hcl
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.0"
    }
```

**Por qué:** `tls` genera el par de claves RSA; `local` nos permite volcar la
clave privada a un archivo `clave.pem` para poder hacer SSH.

> `terraform init` para descargar los providers nuevos.

## Paso 16 — [ACTUALIZA] `infraestructura/variables.tf`

**Qué cambia:** Añadimos la URL del repo y el tipo de instancia.

```hcl
variable "app_repo_url" {
  description = "URL publica del repo que la EC2 clonara (https://github.com/USUARIO/REPO.git)"
  type        = string
  default     = "https://github.com/Coderhouse-CristianC/DevOps.git"
}

variable "instance_type" {
  description = "Tipo de instancia EC2 (free tier: t3.micro)"
  type        = string
  default     = "t3.micro"
}
```

**Por qué:** La VM necesita saber de dónde descargar el código y qué tamaño
tener. El `default` ya apunta al repo del curso; si tienes tu propio fork,
sobreescribe `app_repo_url` en `terraform.tfvars`.

## Paso 17 — [NUEVO] `infraestructura/modules/compute/variables.tf`

**Qué hace:** Entradas del módulo compute.

```hcl
variable "name_prefix" {
  type = string
}

variable "ami_id" {
  type = string
}

variable "instance_type" {
  type = string
}

variable "subnet_id" {
  type = string
}

variable "ec2_sg_id" {
  type = string
}

variable "app_repo_url" {
  type = string
}

variable "db_host" {
  type = string
}

variable "db_port" {
  type = number
}

variable "db_name" {
  type = string
}

variable "db_username" {
  type = string
}

variable "db_password" {
  type      = string
  sensitive = true
}

variable "key_filename" {
  description = "Nombre del archivo .pem que se genera en la raiz del proyecto"
  type        = string
  default     = "clave.pem"
}
```

**Línea por línea (lo relevante):**

- `ami_id`, `instance_type`, `subnet_id`, `ec2_sg_id` → para configurar la VM.
- `app_repo_url` y los datos de la base (`db_host`, `db_port`, `db_name`,
  `db_username`, `db_password`) → se inyectan en el `user_data` para que la app
  sepa dónde y cómo conectarse.
- `db_password { sensitive = true }` → aunque venga de otro módulo, lo
  marcamos sensible aquí también para que no se filtre en logs.
- `key_filename` → con valor por defecto: si no nos importa, no hay que pasarla.

## Paso 18 — [NUEVO] `infraestructura/modules/compute/user_data.sh.tpl`

**Qué hace:** Es una **plantilla** de script bash que AWS ejecutará la **primera
vez** que arranque la EC2 (cloud-init). Lleva placeholders `${...}` que
Terraform rellenará. Es donde "instalamos y arrancamos" la app.

```bash
#!/bin/bash
set -euxo pipefail

# Instalar git y nodejs (incluye npm) en Amazon Linux 2023
dnf install -y git nodejs

# Clonar el repositorio si no existe; si ya esta, hacer git pull
if [ -d /opt/app/.git ]; then
  cd /opt/app
  git pull
else
  rm -rf /opt/app
  git clone ${app_repo_url} /opt/app
fi

# Instalar dependencias y dejar permisos para ec2-user
cd /opt/app/Terraform/app
npm install --omit=dev
chown -R ec2-user:ec2-user /opt/app

# Archivo de variables de entorno para la app
cat > /etc/app.env <<'ENVEOF'
PGHOST=${db_host}
PGPORT=${db_port}
PGUSER=${db_username}
PGPASSWORD=${db_password}
PGDATABASE=${db_name}
PGSSL=true
ENVEOF
chmod 600 /etc/app.env

# Servicio systemd: arranca la app y la reinicia si muere
cat > /etc/systemd/system/app.service <<'UNITEOF'
[Unit]
Description=Users API (Node)
After=network.target

[Service]
EnvironmentFile=/etc/app.env
WorkingDirectory=/opt/app/Terraform/app
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
User=ec2-user

[Install]
WantedBy=multi-user.target
UNITEOF

systemctl daemon-reload
systemctl enable --now app
```

**Línea por línea:**

- `#!/bin/bash` → "shebang": indica que es un script bash.
- `set -euxo pipefail` → modo "estricto": para el script al primer error (`-e`),
  muestra cada comando (`-x`), y trata variables sin definir y pipes rotas como
  error. Así, si algo falla, lo vemos en los logs de la VM.
- `dnf install -y git nodejs` → Amazon Linux 2023 usa `dnf`. Instala git y node
  (que trae npm).
- `if [ -d /opt/app/.git ] ... else ... git clone` → si el repo ya fue
  clonado (existe `/opt/app/.git`), hace `git pull` para traer los últimos
  cambios; si no, lo clona desde cero. Así el script es idempotente: funciona
  tanto en el primer arranque como en reinicios posteriores.
- `git clone ${app_repo_url} /opt/app` → baja TU repo público a `/opt/app`. El
  `${app_repo_url}` lo rellena Terraform.
- `cd /opt/app/Terraform/app` → el código Node está en `Terraform/app/` dentro
  del repo (no en la raíz).
- `npm install --omit=dev` → instala dependencias (sin las de desarrollo).
- `chown -R ec2-user:ec2-user /opt/app` → deja los archivos propiedad del
  usuario `ec2-user`, porque systemd ejecutará la app como ese usuario.
- `cat > /etc/app.env <<'ENVEOF' ... ENVEOF` → escribe un fichero de variables.
  Las comillas en `<<'ENVEOF'` son importantes: evitan que bash interprete `$`,
  pero Terraform **sí** reemplaza los `${...}` antes de que bash los vea. Así
  metemos host, puerto, usuario, **password** y nombre de la base.
- `chmod 600 /etc/app.env` → solo root puede leerlo (protege el password).
- El segundo `cat` escribe una **unit de systemd** en
  `/etc/systemd/system/app.service`:
  - `EnvironmentFile=/etc/app.env` → carga las variables de `/etc/app.env`.
  - `WorkingDirectory=/opt/app/Terraform/app` → dónde se ejecuta.
  - `ExecStart=/usr/bin/node server.js` → el comando que arranca la API.
  - `Restart=always`, `RestartSec=3` → si el proceso muere, systemd lo reinicia
    en 3 s (esto sustituye con ventaja al `nohup`).
  - `User=ec2-user` → usuario con el que corre.
- `systemctl daemon-reload && systemctl enable --now app` → recarga systemd,
  habilita el servicio para que arranque en cada reinicio y lo inicia ya.

## Paso 19 — [NUEVO] `infraestructura/modules/compute/main.tf`

**Qué hace:** Genera la clave SSH, la registra en AWS, crea la EC2 (con su
user_data), asocia una IP elástica y vuelca la clave privada a un archivo local.

```hcl
resource "tls_private_key" "this" {
  algorithm = "RSA"
  rsa_bits  = 2048
}

resource "aws_key_pair" "this" {
  key_name   = "${var.name_prefix}-key"
  public_key = tls_private_key.this.public_key_openssh
}

locals {
  user_data = templatefile("${path.module}/user_data.sh.tpl", {
    app_repo_url = var.app_repo_url
    db_host      = var.db_host
    db_port      = var.db_port
    db_name      = var.db_name
    db_username  = var.db_username
    db_password  = var.db_password
  })
}

resource "aws_instance" "this" {
  ami                    = var.ami_id
  instance_type          = var.instance_type
  subnet_id              = var.subnet_id
  vpc_security_group_ids = [var.ec2_sg_id]
  key_name               = aws_key_pair.this.key_name
  user_data              = local.user_data

  tags = {
    Name = "${var.name_prefix}-ec2"
  }
}

resource "aws_eip" "this" {
  instance = aws_instance.this.id
  domain   = "vpc"
}

resource "local_file" "private_key" {
  content         = tls_private_key.this.private_key_pem
  filename        = "${path.root}/${var.key_filename}"
  file_permission = "0600"
}
```

**Línea por línea:**

- `tls_private_key.this` → genera un par de claves RSA de 2048 bits. La
  **privada** se queda en el estado de Terraform; la **pública** se sube a AWS.
- `aws_key_pair.this` → registra la clave pública en AWS con un nombre, para
  poder asignársela a la EC2 y poder hacer SSH.
- `locals { user_data = templatefile(...) }` → un `local` es una variable
  interna. `templatefile(RUTA, { variables })` lee la plantilla `.tpl`, sustituye
  los `${...}` por los valores del map, y devuelve el script ya relleno. Es la
  forma limpia de pasar secretos/config al `user_data`.
- `aws_instance.this` → la máquina virtual:
  - `ami = var.ami_id` → la imagen (la del data source `aws_ami` del paso 3).
  - `instance_type = var.instance_type` → el tamaño (t3.micro).
  - `subnet_id` → en qué subnet.
  - `vpc_security_group_ids = [var.ec2_sg_id]` → le asignamos el SG de la EC2.
  - `key_name` → la clave para SSH.
  - `user_data = local.user_data` → el script que se ejecuta al primer arranque.
  - `tags` → etiquetas (útiles en consola).
- `aws_eip.this` → **Elastic IP**: una IP pública fija. Sin esto, al reiniciar
  la VM cambiaría de IP. La asociamos a la instancia.
- `local_file.private_key` → escribe la clave privada en disco para que puedas
  hacer SSH. `path.root` apunta a la carpeta raíz de Terraform; le ponemos
  permisos `0600` (solo el dueño puede leer, requisito de SSH).

## Paso 20 — [NUEVO] `infraestructura/modules/compute/outputs.tf`

**Qué hace:** Expone la IP pública y el ID de la instancia.

```hcl
output "public_ip" {
  value = aws_eip.this.public_ip
}

output "instance_id" {
  value = aws_instance.this.id
}
```

## Paso 21 — [ACTUALIZA] `infraestructura/main.tf`

**Qué cambia:** Añadimos el bloque `module "compute"`, que depende de los otros
dos (les lee outputs).

```hcl
module "compute" {
  source        = "./modules/compute"
  name_prefix   = var.project_name
  ami_id        = data.aws_ami.al2023.id
  instance_type = var.instance_type
  subnet_id     = data.aws_subnets.default.ids[0]
  ec2_sg_id     = module.security.ec2_sg_id
  app_repo_url  = var.app_repo_url
  db_host       = module.database.endpoint_address
  db_port       = 5432
  db_name       = module.database.db_name
  db_username   = module.database.db_username
  db_password   = module.database.db_password
}
```

**Línea por línea:**

- `ami_id = data.aws_ami.al2023.id` → la AMI buscada en el paso 3.
- `subnet_id = data.aws_subnets.default.ids[0]` → la **primera** subnet de la
  lista (las VMs solo quieren una). `[0]` indexa la lista.
- `ec2_sg_id = module.security.ec2_sg_id` → el SG de la EC2 (del módulo
  security).
- `app_repo_url = var.app_repo_url` → tu repo público (variable del paso 16).
- Los datos de la base (`db_host`, etc.) vienen **del módulo database**.
  Terraform ve que compute depende de database y security, y los crea en orden.

## Paso 22 — [ACTUALIZA] `infraestructura/outputs.tf`

**Qué cambia:** Añadimos los outputs útiles para usar la API y conectarnos por
SSH (antes del `rds_endpoint` o después, el orden no importa).

```hcl
output "api_url" {
  description = "URL publica de la API"
  value       = "http://${module.compute.public_ip}:3000"
}

output "ec2_public_ip" {
  description = "IP publica de la EC2"
  value       = module.compute.public_ip
}

output "ssh_command" {
  description = "Comando para conectarse por SSH"
  value       = "ssh -i clave.pem ec2-user@${module.compute.public_ip}"
}
```

**Línea por línea:**

- `api_url` → construye la URL con la IP elástica y el puerto 3000. Nota cómo se
  interpola `${module.compute.public_ip}` dentro de un string.
- `ssh_command` → te da el comando SSH listo para copiar/pegar.

---

# BLOQUE 6 — Despliegue final

## Paso 23 — [NUEVO] `infraestructura/terraform.tfvars.example`

**Qué hace:** Plantilla de valores. Lo copias a `terraform.tfvars` (que está en
`.gitignore`) y pones tus valores reales si necesitas cambiar algo.

```hcl
aws_region    = "us-east-1"
project_name  = "users-api"

# IMPORTANTE: URL publica del repo que la EC2 clonara al arrancar
app_repo_url  = "https://github.com/Coderhouse-CristianC/DevOps.git"

db_name       = "appdb"
db_username   = "api"
instance_type = "t3.micro"
```

**Por qué:** `terraform.tfvars` es donde pones valores sin tocarlos por
command-line. Dejar un `*.example` versionado documenta qué variables existen y
qué formato esperan, sin exponer datos reales.

## ► Checkpoint: despliegue completo

```bash
cd infraestructura
cp terraform.tfvars.example terraform.tfvars
# edita terraform.tfvars y pon tu app_repo_url real

terraform init      # por si faltaban providers/módulos
terraform plan      # revisa: debe proponer crear EC2 + EIP + key (la RDS ya existe)
terraform apply     # confirma con "yes"
```

Tras el `apply`, Terraform escribe los outputs y genera `infraestructura/clave.pem`.

## Probar la API desplegada

```bash
API=$(terraform output -raw api_url)

curl $API/health

curl -X POST $API/users -H 'Content-Type: application/json' \
  -d '{"name":"Ada Lovelace","email":"ada@ejemplo.com"}'

curl $API/users
```

> Si el primer `curl` falla, espera 1–2 min: el `user_data` instala paquetes en
> segundo plano tras el arranque.

## Depurar en la VM (opcional)

```bash
ssh -i infraestructura/clave.pem ec2-user@$(terraform output -raw ec2_public_ip)

systemctl status app          # estado del servicio
sudo journalctl -u app -f     # logs en vivo
sudo cat /etc/app.env         # variables que ve la app
```

## ► Checkpoint final: limpieza

```bash
terraform destroy   # confirma con "yes"
```

Como pusimos `skip_final_snapshot = true` y `deletion_protection = false`, borra
todo sin trabas. Verifica en la consola que no quedan recursos sueltos.

---

# Resumen de orden de creación

| Paso | Fichero | Acción |
|------|---------|--------|
| 0.1–0.5 | `app/*`, `docker-compose.yml` | [NUEVO] contexto de la app |
| 1 | `infraestructura/versions.tf` | [NUEVO] provider aws |
| 2 | `infraestructura/variables.tf` | [NUEVO] aws_region, project_name |
| 3 | `infraestructura/main.tf` | [NUEVO] data sources |
| 4–6 | `modules/security/*` | [NUEVO] módulo SG |
| 7 | `infraestructura/main.tf` | [ACTUALIZA] module "security" |
| 8 | `infraestructura/versions.tf` | [ACTUALIZA] provider random |
| 9 | `infraestructura/variables.tf` | [ACTUALIZA] db_name, db_username |
| 10–12 | `modules/database/*` | [NUEVO] módulo RDS |
| 13 | `infraestructura/main.tf` | [ACTUALIZA] module "database" |
| 14 | `infraestructura/outputs.tf` | [NUEVO] rds_endpoint |
| 15 | `infraestructura/versions.tf` | [ACTUALIZA] providers tls, local |
| 16 | `infraestructura/variables.tf` | [ACTUALIZA] app_repo_url, instance_type |
| 17 | `modules/compute/user_data.sh.tpl` | [NUEVO] script de arranque |
| 18–20 | `modules/compute/*` | [NUEVO] módulo EC2 |
| 21 | `infraestructura/main.tf` | [ACTUALIZA] module "compute" |
| 22 | `infraestructura/outputs.tf` | [ACTUALIZA] api_url, ip, ssh |
| 23 | `infraestructura/terraform.tfvars.example` | [NUEVO] valores |

# Conceptos clave que has tocado

- `provider` / `required_providers` → plugins (aws, random, tls, local).
- `data` → leer infra existente; `resource` → crear infra.
- `variable` / `output` → entradas y salidas; `sensitive` para secretos.
- `module` → encapsular y reutilizar; un módulo alimenta a otro (dependencias).
- `templatefile` + `user_data` → configurar la VM en el primer arranque.
- Ciclo: `init → fmt → validate → plan → apply → destroy`.

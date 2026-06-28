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

variable "app_repo_url" {
  description = "URL publica del repo que la EC2 clonara (https://github.com/USUARIO/REPO.git)"
  type        = string
  default     = "https://github.com/Coderhouse-CristianC/DevOps.git"
}

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

variable "instance_type" {
  description = "Tipo de instancia EC2 (free tier: t3.micro)"
  type        = string
  default     = "t3.micro"
}

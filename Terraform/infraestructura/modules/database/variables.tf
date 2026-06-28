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

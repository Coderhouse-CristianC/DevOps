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

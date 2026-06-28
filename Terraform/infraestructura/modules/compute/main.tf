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

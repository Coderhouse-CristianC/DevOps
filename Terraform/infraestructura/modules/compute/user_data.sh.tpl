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

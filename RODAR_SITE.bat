@echo off
title Cardoso Online V7
cd /d "%~dp0"
if not exist node_modules (
  echo Instalando dependencias...
  npm install
)
npm start
pause

@echo off
cd /d "%~dp0"
.\node_modules\.bin\electron.cmd .\out\main\index.js

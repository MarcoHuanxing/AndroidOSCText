@echo off
chcp 65001 >nul
title AndroidOSCText Bridge

echo ================================================================
echo   AndroidOSCText  手机 - VRChat Chatbox 桥接
echo ================================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 Node.js
    echo         请先安装：https://nodejs.org/
    echo.
    pause
    exit /b 1
)

cd /d "%~dp0..\pc-bridge"
if errorlevel 1 (
    echo [错误] 找不到 pc-bridge 目录
    pause
    exit /b 1
)

node src/index.js
echo.
echo 服务已停止。
pause

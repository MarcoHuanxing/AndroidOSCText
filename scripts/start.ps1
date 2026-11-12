<#
.SYNOPSIS
  AndroidOSCText 一键启动脚本
.DESCRIPTION
  启动 PC 端桥接，显示手机需要填写的信息，并自动尝试放行防火墙。
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\start.ps1
#>
$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $PSScriptRoot
$bridge = Join-Path $here 'pc-bridge'

if (-not (Test-Path (Join-Path $bridge 'package.json'))) {
    Write-Host '[错误] 找不到 pc-bridge 目录，请确认脚本在项目内运行。' -ForegroundColor Red
    exit 1
}

# --- 检查 Node.js ---
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host '[错误] 未找到 Node.js。请先安装 Node.js 18 或更高版本：https://nodejs.org/' -ForegroundColor Red
    exit 1
}
$ver = (& node --version) -replace '^v', ''
$major = [int]($ver -split '\.')[0]
if ($major -lt 18) {
    Write-Host "[错误] Node.js 版本过低（当前 $ver，需要 >= 18）" -ForegroundColor Red
    exit 1
}
Write-Host "[信息] Node.js $ver" -ForegroundColor DarkGray

# --- 尝试放行防火墙（需要管理员，失败不阻塞）---
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin) {
    $existing = Get-NetFirewallRule -DisplayName 'AndroidOSCText Bridge' -ErrorAction SilentlyContinue
    if (-not $existing) {
        try {
            New-NetFirewallRule -DisplayName 'AndroidOSCText Bridge' -Direction Inbound -LocalPort 7712 -Protocol TCP -Action Allow -Profile Private,Domain | Out-Null
            Write-Host '[信息] 已添加防火墙规则（端口 7712）' -ForegroundColor DarkGray
        } catch {
            Write-Host "[提示] 防火墙规则添加失败：$($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
} else {
    Write-Host '[提示] 非管理员运行，跳过防火墙配置。' -ForegroundColor DarkGray
    Write-Host '       若手机连不上，请用管理员 PowerShell 运行：' -ForegroundColor DarkGray
    Write-Host '       New-NetFirewallRule -DisplayName "AndroidOSCText Bridge" -Direction Inbound -LocalPort 7712 -Protocol TCP -Action Allow' -ForegroundColor DarkGray
}

Write-Host ''
Set-Location $bridge
& node src/index.js

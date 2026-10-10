$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$beifaNode = Get-Command node -ErrorAction SilentlyContinue
if (-not $beifaNode) {
  Write-Host '请先安装 Node.js 18 或更新版本，再运行本文件。'
  Read-Host '按回车退出'
  exit 1
}
Write-Host '请打开下面输出的本地地址。关闭此窗口将停止服务。'
& $beifaNode.Source (Join-Path $PSScriptRoot 'server.cjs')

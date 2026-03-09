$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $PSScriptRoot
$HostAddress = if ($env:HOST) { $env:HOST } else { "127.0.0.1" }
$PortNumber = if ($env:PORT) { $env:PORT } else { "8000" }

$PythonCommand = Get-Command "py" -ErrorAction SilentlyContinue
if ($PythonCommand) {
  $PythonArgs = @("-3", "-m", "backend")
} else {
  $PythonCommand = Get-Command "python" -ErrorAction SilentlyContinue
  if (-not $PythonCommand) {
    throw "未找到 Python 解释器，请先安装 Python 3.12+。"
  }

  $PythonArgs = @("-m", "backend")
}

Push-Location $RootDir
try {
  $env:HOST = $HostAddress
  $env:PORT = $PortNumber
  & $PythonCommand.Source @PythonArgs
} finally {
  Pop-Location
}

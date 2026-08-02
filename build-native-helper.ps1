$ErrorActionPreference = "Stop"

python -m pip install --user pyinstaller
python -m PyInstaller --onefile --name native_helper (Join-Path $PSScriptRoot "native_helper.py")
Copy-Item -Force (Join-Path $PSScriptRoot "dist\native_helper.exe") (Join-Path $PSScriptRoot "native_helper.exe")
Write-Output "native_helper.exe created."

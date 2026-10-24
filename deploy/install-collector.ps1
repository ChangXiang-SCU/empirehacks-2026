# Start the collector now and at every logon (hidden window). Run from the repo: deploy\install-collector.ps1
$node = (Get-Command node).Source
$script = (Resolve-Path (Join-Path $PSScriptRoot '..\collector\mnemo-collector.mjs')).Path
$vbs = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\mnemo-collector.vbs"
$line = 'CreateObject("WScript.Shell").Run """' + $node + '"" ""' + $script + '"" --quiet", 0, False'
[IO.File]::WriteAllText($vbs, $line)
Start-Process wscript.exe -ArgumentList "`"$vbs`""
Start-Sleep 3
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ? CommandLine -match 'mnemo-collector' | % { "collector running pid=$($_.ProcessId)" }

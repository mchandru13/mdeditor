# Verifies the native menu bar structure of the packaged app.
#
# Windows UI Automation can read the menu bar of a window even when this session
# cannot deliver keystrokes or clicks to it, so this check asserts the structure.
# Item behaviour is covered by tests/integration/app.test.tsx (menu commands) and
# by the shared menu-event channel exercised in the packaged app.
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/menu-check.ps1

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$exe = Resolve-Path 'src-tauri/target/release/mdeditor.exe'
$proc = Start-Process -FilePath $exe -PassThru
Start-Sleep -Seconds 6

function Get-AppWindow([int]$processId) {
  $condition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $processId)
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    $window = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
      [System.Windows.Automation.TreeScope]::Children, $condition)
    if ($window) { return $window }
    Start-Sleep -Milliseconds 500
  }
  throw "Window not found for process $processId"
}

$results = [System.Collections.Generic.List[string]]::new()

try {
  $window = Get-AppWindow $proc.Id

  $menuBarCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::MenuBar)
  $bars = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $menuBarCondition)
  $menus = @()
  foreach ($bar in $bars) {
    $children = $bar.FindAll(
      [System.Windows.Automation.TreeScope]::Children,
      [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($child in $children) { $menus += $child.Current.Name }
  }

  $results.Add("INFO  top-level menus: $($menus -join ', ')")
  $missing = @('File', 'Edit', 'View', 'Help') | Where-Object { $_ -notin $menus }
  if ($missing.Count -eq 0) {
    $results.Add('PASS  File, Edit, View and Help are present')
  }
  else {
    $results.Add("FAIL  missing menus: $($missing -join ', ')")
  }

  $results.Add('SKIP  item invocation: this session cannot deliver input to the window')
}
catch {
  $results.Add("FAIL  $($_.Exception.Message)")
}
finally {
  if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
}

$results | ForEach-Object { Write-Output $_ }
$failed = ($results | Where-Object { $_ -like 'FAIL*' }).Count
$passed = ($results | Where-Object { $_ -like 'PASS*' }).Count
$skipped = ($results | Where-Object { $_ -like 'SKIP*' }).Count
Write-Output ""
Write-Output "$passed passed, $failed failed, $skipped skipped"
exit $failed

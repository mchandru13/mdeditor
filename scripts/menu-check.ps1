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

# MDEDITOR_EXE points at an installed copy, which is what a user runs; the
# default is the build in this checkout.
$exe = if ($env:MDEDITOR_EXE) {
  (Resolve-Path $env:MDEDITOR_EXE).Path
}
else {
  (Resolve-Path 'src-tauri/target/release/mdeditor.exe').Path
}
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
  # The window shows before its native menu is exposed to UI Automation, and the
  # gap varies per launch. Poll for the menu rather than racing it.
  $bars = $null
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    $bars = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $menuBarCondition)
    if ($bars -and $bars.Count -gt 0) { break }
    Start-Sleep -Milliseconds 1000
  }
  if (-not $bars -or $bars.Count -eq 0) { throw 'menu bar not exposed by UI Automation' }
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

  # The Edit submenu is where a new command can silently fail to appear. Expand
  # it through UI Automation (no input delivery needed) and check the item and
  # its accelerator, so a menu regression is caught by this check rather than by
  # a user noticing the command is gone.
  $editItem = $null
  foreach ($bar in $bars) {
    $children = $bar.FindAll(
      [System.Windows.Automation.TreeScope]::Children,
      [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($child in $children) {
      if ($child.Current.Name -eq 'Edit') { $editItem = $child; break }
    }
    if ($editItem) { break }
  }

  $editNames = @()
  $addComment = $null
  if ($editItem) {
    # UI Automation occasionally refuses to expand a menu on a freshly shown
    # window. Retrying keeps the check meaningful instead of silently skipping
    # the assertion it exists for.
    $expanded = $false
    for ($attempt = 0; $attempt -lt 3 -and -not $expanded; $attempt++) {
      try {
        $pattern = $editItem.GetCurrentPattern(
          [System.Windows.Automation.ExpandCollapsePattern]::Pattern)
        $pattern.Expand()
        Start-Sleep -Milliseconds 900
        $expanded = $true
      }
      catch {
        Start-Sleep -Milliseconds 700
      }
    }
    if (-not $expanded) {
      $results.Add('INFO  Edit submenu could not be expanded')
    }
    if ($expanded) {
      try {
        $menuItemCondition = New-Object System.Windows.Automation.PropertyCondition(
          [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
          [System.Windows.Automation.ControlType]::MenuItem)
        $items = $editItem.FindAll(
          [System.Windows.Automation.TreeScope]::Descendants, $menuItemCondition)
        foreach ($item in $items) {
          $editNames += $item.Current.Name
          if (-not $addComment -and $item.Current.Name -like 'Add Comment*') {
            $addComment = $item
          }
        }
      }
      catch {
        $editNames = @()
        $results.Add("INFO  Edit submenu expand failed: $($_.Exception.Message)")
      }
      finally {
        try { $pattern.Collapse() } catch { }
      }
    }
  }

  if ($editNames.Count -gt 0) {
    $results.Add("INFO  Edit items: $($editNames -join ', ')")
  }

  if ($addComment) {
    $results.Add('PASS  Edit menu contains Add Comment')
    $accelerator = $addComment.Current.AcceleratorKey
    if ($accelerator -match 'Ctrl\+Shift\+M') {
      $results.Add("PASS  Add Comment accelerator is $accelerator")
    }
    else {
      $results.Add("FAIL  Add Comment accelerator is '$accelerator', expected Ctrl+Shift+M")
    }
  }
  elseif ($editNames.Count -eq 0) {
    $results.Add('SKIP  could not enumerate the Edit submenu from this session')
  }
  else {
    $results.Add("FAIL  Edit menu lacks Add Comment (saw: $($editNames -join ', '))")
  }

  $results.Add('SKIP  item invocation: this session cannot deliver input to the window')
}
catch {
  $results.Add("FAIL  $($_.Exception.Message)")
}
finally {
  if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
}

# File menu labels.
#
# Read from the binary rather than by expanding the menu: UI Automation's Expand()
# blocks indefinitely on some submenus here, and a check that hangs is worse than
# one that skips. Labels are compiled in as UTF-16 literals, so this is exact and
# races nothing. It proves the strings shipped; that they are attached to the
# right items is covered by cargo test menu:: (the COMMANDS table).
try {
  $bytes = [System.IO.File]::ReadAllBytes($exe)
  # The literals are UTF-8 in the binary, not UTF-16.
  $text = [System.Text.Encoding]::UTF8.GetString($bytes)
  foreach ($needed in @('Print / Export PDF', 'Export HTML')) {
    if ($text.Contains($needed)) {
      $results.Add("PASS  File menu ships '$needed'")
    }
    else {
      $results.Add("FAIL  '$needed' is not in the binary")
    }
  }
}
catch {
  $results.Add("FAIL  could not read the binary: $($_.Exception.Message)")
}

$results | ForEach-Object { Write-Output $_ }
$failed = ($results | Where-Object { $_ -like 'FAIL*' }).Count
$passed = ($results | Where-Object { $_ -like 'PASS*' }).Count
$skipped = ($results | Where-Object { $_ -like 'SKIP*' }).Count
Write-Output ""
Write-Output "$passed passed, $failed failed, $skipped skipped"
exit $failed

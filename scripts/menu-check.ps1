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
# default is the build in this checkout. Resolved inside the try below so a bad
# path still produces the passed/failed/skipped summary.
$exe = if ($env:MDEDITOR_EXE) { $env:MDEDITOR_EXE } else { 'src-tauri/target/release/mdeditor.exe' }
$proc = $null

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
  if (-not (Test-Path $exe)) { throw "MDEDITOR_EXE/build not found: $exe" }
  $exe = (Resolve-Path $exe).Path
  $proc = Start-Process -FilePath $exe -PassThru
  Start-Sleep -Seconds 6
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

  # File carries the export and print commands, and their labels are the only
  # place "Export PDF" is discoverable. Read them by expanding the submenu, like
  # Edit above. `Expand()` can block on an unresponsive shell, so each attempt is
  # bounded: a hang would leave this process holding the app's single instance and
  # make every later run forward-and-exit, which produced a string of misleading
  # "Window not found" failures.
  $fileItem = $null
  foreach ($bar in $bars) {
    $children = $bar.FindAll(
      [System.Windows.Automation.TreeScope]::Children,
      [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($child in $children) {
      if ($child.Current.Name -eq 'File') { $fileItem = $child; break }
    }
    if ($fileItem) { break }
  }

  $fileNames = @()
  if ($fileItem) {
    try {
      $filePattern = $fileItem.GetCurrentPattern(
        [System.Windows.Automation.ExpandCollapsePattern]::Pattern)
      $filePattern.Expand()
      Start-Sleep -Milliseconds 900
      $fileItems = $fileItem.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        (New-Object System.Windows.Automation.PropertyCondition(
          [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
          [System.Windows.Automation.ControlType]::MenuItem)))
      foreach ($item in $fileItems) { $fileNames += $item.Current.Name }
    }
    catch {
      $fileNames = @()
    }
    finally {
      try { $filePattern.Collapse() } catch { }
    }
  }

  if ($fileNames.Count -eq 0) {
    $results.Add('SKIP  could not enumerate the File submenu from this session')
  }
  else {
    $results.Add("INFO  File items: $($fileNames -join ', ')")
    # Compare without the trailing ellipsis: how this .ps1 is decoded decides
    # whether U+2026 survives as one character.
    $flat = $fileNames | ForEach-Object { ($_ -replace '[^\w\s/]', '').Trim() }
    $print = $flat | Where-Object { $_ -like 'Print*' } | Select-Object -First 1
    if ($print -like '*Export PDF*') {
      $results.Add("PASS  File menu offers '$print'")
    }
    elseif ($print) {
      $results.Add("FAIL  print item reads '$print', expected it to name Export PDF")
    }
    else {
      $results.Add("FAIL  File menu has no print/export item (saw: $($fileNames -join ', '))")
    }
    if ($flat | Where-Object { $_ -like 'Export HTML*' }) {
      $results.Add('PASS  File menu still has Export HTML')
    }
    else {
      $results.Add("FAIL  File menu lost Export HTML (saw: $($fileNames -join ', '))")
    }
  }

  $results.Add('SKIP  item invocation: this session cannot deliver input to the window')
}
catch {
  $results.Add("FAIL  $($_.Exception.Message)")
}
finally {
  if ($null -ne $proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
}

$results | ForEach-Object { Write-Output $_ }
$failed = ($results | Where-Object { $_ -like 'FAIL*' }).Count
$passed = ($results | Where-Object { $_ -like 'PASS*' }).Count
$skipped = ($results | Where-Object { $_ -like 'SKIP*' }).Count
Write-Output ""
Write-Output "$passed passed, $failed failed, $skipped skipped"
exit $failed

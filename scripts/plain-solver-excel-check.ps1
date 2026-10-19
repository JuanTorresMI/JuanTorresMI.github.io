# Opens each workbook plain-solver-excel-check.js wrote, runs the Solver model stored in it with
# Excel's own Solver, and compares the goal it reaches with Plain Solver's. Windows, Excel, Solver add-in.
param([string]$Dir)
$summary = Get-Content (Join-Path $Dir "summary.json") -Raw | ConvertFrom-Json
$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false
try {
  $null = $xl.Workbooks.Open("C:\Program Files\Microsoft Office\root\Office16\Library\SOLVER\SOLVER.XLAM")
  foreach ($s in $summary) {
    if ($s.error) { "{0,-15} {1,-7} EXPORT ERROR {2}" -f $s.id, $s.tag, $s.error; continue }
    $file = Join-Path $Dir ("{0}-{1}.xlsx" -f $s.id, $s.tag)
    $wb = $xl.Workbooks.Open($file)
    $ws = $wb.Worksheets.Item("Model"); $ws.Activate()
    $goal = $ws.Names.Item("solver_opt").RefersToRange
    $before = $goal.Value2
    $code = $xl.Run("SOLVER.XLAM!SolverSolve", $true)
    $xl.Calculate()
    $after = $goal.Value2
    $ok = [math]::Abs($after - $s.want) -le 1e-4 * [math]::Max(1, [math]::Abs($s.want))
    "{0,-15} {1,-7} code={2} start={3} excel={4} plain={5} {6}" -f $s.id, $s.tag, $code, $before, $after, $s.want, $(if ($ok) { "MATCH" } else { "DIFFERENT" })
    $wb.Close($false)
  }
} finally { $xl.Quit(); [System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl) | Out-Null }

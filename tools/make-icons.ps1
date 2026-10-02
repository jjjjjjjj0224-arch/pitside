# Draws the PitSide app icons (a camera on a navy background) as PNG files.
# Run from the project folder:  powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1

Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot '..\icons'
New-Item -ItemType Directory -Force $outDir | Out-Null

function New-RoundedRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $p.AddArc($x, $y, $d, $d, 180, 90)
    $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

# $size: image size in px. $scale: how much of the icon the camera fills
# (smaller for "maskable" icons, which Android may crop to a circle).
function Save-Icon([int]$size, [float]$scale, [string]$file) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'

    $navy = [System.Drawing.Color]::FromArgb(255, 20, 33, 61)
    $orange = [System.Drawing.Color]::FromArgb(255, 245, 158, 11)
    $white = [System.Drawing.Color]::White
    $g.Clear($navy)

    $u = $size * ($scale / 100.0) / 100.0   # 1 unit = 1% of the camera area
    $ox = ($size - 100 * $u) / 2
    $oy = ($size - 100 * $u) / 2

    # Viewfinder bump
    $bump = New-RoundedRect ($ox + 30 * $u) ($oy + 14 * $u) (40 * $u) (16 * $u) (5 * $u)
    $g.FillPath((New-Object System.Drawing.SolidBrush $white), $bump)
    # Camera body
    $body = New-RoundedRect ($ox + 6 * $u) ($oy + 24 * $u) (88 * $u) (62 * $u) (12 * $u)
    $g.FillPath((New-Object System.Drawing.SolidBrush $white), $body)
    # Lens: orange ring, navy centre, small highlight
    $g.FillEllipse((New-Object System.Drawing.SolidBrush $orange), $ox + 28 * $u, $oy + 33 * $u, 44 * $u, 44 * $u)
    $g.FillEllipse((New-Object System.Drawing.SolidBrush $navy), $ox + 37 * $u, $oy + 42 * $u, 26 * $u, 26 * $u)
    $g.FillEllipse((New-Object System.Drawing.SolidBrush $white), $ox + 43 * $u, $oy + 47 * $u, 7 * $u, 7 * $u)
    # Flash dot
    $g.FillEllipse((New-Object System.Drawing.SolidBrush $orange), $ox + 78 * $u, $oy + 32 * $u, 8 * $u, 8 * $u)

    $bmp.Save((Join-Path $outDir $file), [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    Write-Output "Saved icons\$file"
}

Save-Icon 192 72 'icon-192.png'
Save-Icon 512 72 'icon-512.png'
Save-Icon 512 56 'icon-maskable-512.png'   # inside the maskable "safe zone"
Save-Icon 180 72 'apple-touch-icon.png'    # iPhone home screen

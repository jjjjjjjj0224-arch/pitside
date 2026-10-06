# Tiny local web server for testing PitSide on this computer (Windows, no installs).
# Run from the project folder:
#   powershell -ExecutionPolicy Bypass -File serve.ps1
# Then open http://localhost:8080 in Chrome or Edge. Press Ctrl+C to stop.
# (Camera, microphone and service workers are allowed on localhost without HTTPS.)

param([int]$Port = 8080)

$root = $PSScriptRoot
$types = @{
  '.html' = 'text/html; charset=utf-8'
  '.js' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'
  '.webmanifest' = 'application/manifest+json'
  '.json' = 'application/json'
  '.png' = 'image/png'
  '.svg' = 'image/svg+xml'
  '.ico' = 'image/x-icon'
  '.md' = 'text/plain; charset=utf-8'
  '.sql' = 'text/plain; charset=utf-8'
  '.wasm' = 'application/wasm'
  '.webp' = 'image/webp'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Output "PitSide running at http://localhost:$Port  (Ctrl+C to stop)"

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $res = $ctx.Response
    try {
      $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
      if ($path -eq '/') { $path = '/index.html' }
      $file = [IO.Path]::GetFullPath((Join-Path $root $path.TrimStart('/')))
      if ($file.StartsWith($root) -and (Test-Path -LiteralPath $file -PathType Leaf)) {
        $ext = [IO.Path]::GetExtension($file).ToLower()
        $res.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' }
        $res.Headers.Add('Cache-Control', 'no-cache')
        [byte[]]$bytes = [IO.File]::ReadAllBytes($file)
        if ($ctx.Request.HttpMethod -eq 'HEAD') {
          $res.ContentLength64 = $bytes.Length
        } else {
          $res.OutputStream.Write($bytes, 0, $bytes.Length)
        }
      } else {
        $res.StatusCode = 404
      }
    } catch {
      Write-Output "Error serving $($ctx.Request.Url): $_"
    } finally {
      try { $res.Close() } catch { }
    }
  }
} finally {
  $listener.Stop()
}

param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination,
    [Parameter(Mandatory = $true)][string]$IconPath
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.Drawing
[System.IO.Compression.ZipFile]::CreateFromDirectory($Source, $Destination, [System.IO.Compression.CompressionLevel]::Optimal, $false)

$bitmap = New-Object System.Drawing.Bitmap 64, 64
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::FromArgb(232, 240, 221))
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(76, 103, 65)), 5
$graphics.DrawLines($pen, [System.Drawing.Point[]]@(
    (New-Object System.Drawing.Point 17, 18),
    (New-Object System.Drawing.Point 30, 31),
    (New-Object System.Drawing.Point 17, 44)
))
$graphics.DrawLine($pen, 35, 45, 49, 45)
$memory = New-Object System.IO.MemoryStream
try {
    $bitmap.Save($memory, [System.Drawing.Imaging.ImageFormat]::Png)
    $png = $memory.ToArray()
    $file = [System.IO.File]::Create($IconPath)
    $writer = New-Object System.IO.BinaryWriter $file
    try {
        $writer.Write([UInt16]0); $writer.Write([UInt16]1); $writer.Write([UInt16]1)
        $writer.Write([byte]64); $writer.Write([byte]64)
        $writer.Write([byte]0); $writer.Write([byte]0)
        $writer.Write([UInt16]1); $writer.Write([UInt16]32)
        $writer.Write([UInt32]$png.Length); $writer.Write([UInt32]22)
        $writer.Write($png)
    } finally { $writer.Dispose(); $file.Dispose() }
} finally { $memory.Dispose(); $pen.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }

import struct, zlib, os, subprocess

def make_png(size, r, g, b):
    def chunk(tag, data):
        c = zlib.crc32(tag + data) & 0xffffffff
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', c)
    # Tipo de color 6 = RGBA (4 canales)
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    row  = bytes([0]) + bytes([r, g, b, 255] * size)  # añade canal alpha=255
    idat = zlib.compress(row * size)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b'')

base = '/Users/macbookair/Documents/filesea/src-tauri/icons'
os.makedirs(base, exist_ok=True)

sizes = [
    ('32x32.png',      32),
    ('128x128.png',   128),
    ('128x128@2x.png',256),
    ('icon.png',      512),
]

for name, sz in sizes:
    path = os.path.join(base, name)
    with open(path, 'wb') as f:
        f.write(make_png(sz, 26, 28, 39))
    print(f'  OK {name} ({sz}x{sz})')

# Generar icon.icns a partir del icon.png con sips + iconutil (macOS)
iconset = os.path.join(base, 'Filesea.iconset')
os.makedirs(iconset, exist_ok=True)
src = os.path.join(base, 'icon.png')

icns_sizes = [
    ('icon_16x16.png',       16),
    ('icon_16x16@2x.png',    32),
    ('icon_32x32.png',       32),
    ('icon_32x32@2x.png',    64),
    ('icon_128x128.png',    128),
    ('icon_128x128@2x.png', 256),
    ('icon_256x256.png',    256),
    ('icon_256x256@2x.png', 512),
    ('icon_512x512.png',    512),
]

for fname, sz in icns_sizes:
    out = os.path.join(iconset, fname)
    subprocess.run(['sips', '-z', str(sz), str(sz), src, '--out', out],
                   capture_output=True)

icns_out = os.path.join(base, 'icon.icns')
subprocess.run(['iconutil', '-c', 'icns', iconset, '-o', icns_out])
print(f'  OK icon.icns')

# icon.ico — usar el 32x32 renombrado (Tauri solo lo necesita para Windows)
import shutil
shutil.copy(os.path.join(base, '32x32.png'), os.path.join(base, 'icon.ico'))
print(f'  OK icon.ico (placeholder)')

print('Iconos listos.')

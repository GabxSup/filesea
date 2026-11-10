# Filesea

Filesea es un explorador de archivos de escritorio para macOS y Linux, construido con Tauri 2, Rust y una interfaz web sin framework. El backend realiza las operaciones del sistema de archivos; la interfaz solo invoca comandos explícitos y presenta sus resultados.

## Funciones

- Pestañas con historial independiente, restauración de ubicaciones y navegación directa con `⌘/Ctrl + L`.
- Barra lateral con carpetas estándar del sistema, volúmenes montados y Favoritos persistentes; se pueden añadir con la estrella o arrastrando una carpeta.
- Vistas de lista y cuadrícula, orden por nombre, tamaño, fecha o tipo, selección múltiple y archivos ocultos.
- Búsqueda instantánea en la carpeta actual o búsqueda recursiva en subcarpetas. La búsqueda recursiva devuelve hasta 3.000 coincidencias por consulta y no sigue enlaces simbólicos.
- Copiar, cortar, pegar, duplicar, mover, renombrar, crear carpetas y enviar a la papelera. Las copias no reemplazan silenciosamente un elemento existente: Filesea propone un nombre como `archivo (copia).txt`.
- Arrastrar y soltar entre carpetas de Filesea; los archivos que llegan desde otras aplicaciones se copian a la carpeta de destino.
- Vista previa de imágenes, PDF y texto; el texto se limita a 512 KB y los archivos de imagen/PDF a 15 MB.
- Crear y extraer archivos ZIP. La extracción rechaza rutas de escape, evita seguir enlaces simbólicos preexistentes y tiene límites de 100.000 entradas y 20 GB descomprimidos por operación.
- Propiedades con fechas, tamaño (incluido el cálculo de carpetas), permisos y estado de enlace simbólico.
- Abrir elementos, mostrar su ubicación en el gestor de archivos y abrir una terminal en una carpeta.

## Atajos

| Acción | macOS | Linux |
|---|---|---|
| Atrás / adelante / subir | `Alt + ←/→/↑` | `Alt + ←/→/↑` |
| Nueva pestaña / cerrar pestaña | `⌘ + T` / `⌘ + W` | `Ctrl + T` / `Ctrl + W` |
| Ir a una ruta | `⌘ + L` | `Ctrl + L` |
| Lista / cuadrícula | `⌘ + 1` / `⌘ + 2` | `Ctrl + 1` / `Ctrl + 2` |
| Mostrar ocultos | `⌘ + H` | `Ctrl + H` |
| Copiar / cortar / pegar | `⌘ + C/X/V` | `Ctrl + C/X/V` |
| Seleccionar todo | `⌘ + A` | `Ctrl + A` |
| Renombrar / vista previa | `F2` / `Espacio` | `F2` / `Espacio` |
| Papelera / actualizar / cerrar | `Delete` / `F5` / `Esc` | `Delete` / `F5` / `Esc` |

El portapapeles de archivos (copiar/cortar y pegar) opera dentro de Filesea. El arrastre permite importar desde otras aplicaciones, pero la integración de portapapeles de archivos con Finder y otros gestores todavía no forma parte de esta versión. Filesea muestra los volúmenes que el sistema ya montó; no administra conexiones SFTP/SMB. Para recuperar elementos enviados a la papelera se usa la papelera del sistema, no un historial de deshacer propio.

## Arquitectura

```text
src/
├── index.html             # Estructura accesible de la aplicación
├── styles.css             # Tema y diseño adaptable
├── app.js                 # Coordinación de UI, acciones y eventos
└── js/
    ├── bridge.js          # Frontera IPC hacia comandos Tauri
    ├── format.js          # Formato de tamaños, fechas e iconos
    └── tab-state.js        # Estado de pestañas e historial de sesión

src-tauri/src/
├── main.rs                # Composición de Tauri y registro de comandos
├── models.rs              # Contratos de datos serializables
├── filesystem.rs          # Listado, búsqueda, vistas previas y operaciones
├── archives.rs            # Creación/extracción ZIP con validación
├── platform.rs            # Lugares, volúmenes, terminal y gestor de archivos
└── preferences.rs         # Persistencia de Favoritos por usuario
```

Las capacidades de Tauri limitan el acceso de plugins expuesto a la webview. La lectura y modificación de archivos se hace a través de comandos Rust concretos, con validación de nombres, manejo de errores y protección frente a sobrescrituras accidentales. El envío a la papelera usa la integración nativa del sistema mediante la biblioteca `trash`.

## Requisitos

### macOS

- macOS 12 o posterior.
- Xcode Command Line Tools.
- Rust estable y Node.js 18 o posterior.

### Linux

- Una distribución de escritorio con WebKitGTK 4.1, GTK 3, Rust estable y Node.js 18 o posterior.
- En Ubuntu/Debian, instala las dependencias de Tauri 2 según la versión de la distribución. Un ejemplo común:

```bash
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev libssl-dev libgtk-3-dev \
  libayatana-appindicator3-dev librsvg2-dev build-essential curl
```

Para abrir una terminal desde Filesea debe haber una terminal de escritorio instalada. En Linux se prueban GNOME Terminal, Konsole, XFCE Terminal, Kitty, Alacritty y `x-terminal-emulator`; en macOS se usa Terminal.

## Desarrollo y compilación

```bash
npm install
npm run dev
```

Para compilar paquetes nativos, ejecuta la compilación en el sistema de destino: macOS produce los formatos macOS disponibles y Linux los formatos admitidos por la distribución y las herramientas instaladas.

```bash
npm run build
```

Las pruebas unitarias del backend incluyen operaciones de copia y seguridad ZIP:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

El empaquetado no sustituye la firma y notarización de macOS. Para distribuir una aplicación fuera del equipo de desarrollo, configura certificados y notarización de Apple por separado.

## Licencia

MIT. Consulta [LICENSE](LICENSE).

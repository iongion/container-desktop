import os
import subprocess
import shutil



PROJECT_HOME = os.path.dirname(os.path.dirname(__file__))
SOURCE_PATH = os.path.join(PROJECT_HOME, "support/resources/appIcon-source.svg")
SOURCE_MONOCHROME_PATH = os.path.join(PROJECT_HOME, "support/resources/appIcon-monochrome.svg")
SIZES = [16, 32, 48, 64, 96, 128, 150, 180, 192, 256, 512, 1024]
SQUARE_SIZES = [30, 44, 71, 89, 107, 142, 150, 284, 310]
ICO_SIZES = [16, 32, 48, 128, 256]
ICNS_SIZES =[16, 32, 48, 128, 256, 512]


# sudo apt-get install -y imagemagick icnsutils inkscape


def generate_icon(size=16):
    export_path = os.path.join(PROJECT_HOME, "src-tauri/icons", f"{size}x{size}.png")
    export_2x_path = os.path.join(PROJECT_HOME, "src-tauri/icons", f"{int(size/2)}x{int(size/2)}@2x.png") if size > 16 else None
    args = [
        "inkscape",
        "--export-background-opacity=0",
        f"--export-width={size}",
        "--export-type=png",
        "--export-filename",
        export_path,
        SOURCE_PATH
    ]
    args_2x = [
        "inkscape",
        "--export-background-opacity=0",
        f"--export-width={size}",
        "--export-type=png",
        "--export-filename",
        export_2x_path,
        SOURCE_PATH
    ]
    if os.path.exists(export_path):
        print(f"Executing: {" ".join(args)} - skip")
    else:
        print(f"Executing: {" ".join(args)}")
        subprocess.run(args)
    if export_2x_path is not None:
        if os.path.exists(export_2x_path):
            print(f"Executing: {" ".join(args_2x)} - skip")
        else:
            print(f"Executing: {" ".join(args_2x)}")
            subprocess.run(args_2x)
    shutil.copyfile(os.path.join(PROJECT_HOME, "src-tauri/icons/64x64.png"), os.path.join(PROJECT_HOME, "src-tauri/icons/icon.png"))


def generate_square(size, output_name=None):
    export_path = os.path.join(PROJECT_HOME, "src-tauri/icons", f"Square{size}x{size}Logo.png" if output_name is None else output_name)
    args = [
        "inkscape",
        "--export-background-opacity=0",
        f"--export-width={size}",
        "--export-type=png",
        "--export-filename",
        export_path,
        SOURCE_PATH
    ]
    if os.path.exists(export_path):
        print(f"Executing: {" ".join(args)} - skip")
    else:
        print(f"Executing: {" ".join(args)}")
        subprocess.run(args)

def generate_plain():
    export_path = os.path.join(PROJECT_HOME, "src-tauri/icons/icon.svg")
    args = [
        "inkscape",
        "--export-type=svg",
        "--export-filename",
        export_path,
        SOURCE_PATH
    ]
    if os.path.exists(export_path):
        print(f"Executing: {" ".join(args)} - skip")
    else:
        print(f"Executing: {" ".join(args)}")
        subprocess.run(args)
    # T744 - Safari pinned tab


def generate_tray(size=64, monochrome=False):
    export_path = os.path.join(PROJECT_HOME, "src-tauri/icons/trayIcon.png")
    args = [
        "inkscape",
        "--export-background-opacity=0",
        f"--export-width={size}",
        "--export-type=png",
        "--export-filename",
        export_path,
        SOURCE_MONOCHROME_PATH if monochrome else SOURCE_PATH
    ]
    if os.path.exists(export_path):
        print(f"Executing: {" ".join(args)} - skip")
    else:
        print(f"Executing: {" ".join(args)}")
        subprocess.run(args)


def generate_icns():
    export_path = os.path.join(PROJECT_HOME, "src-tauri/icons/icon.icns")
    args = [
        "png2icns",
        export_path,
    ]
    for size in ICNS_SIZES:
        import_path = os.path.join(PROJECT_HOME, "src-tauri/icons", f"{size}x{size}.png")
        args.append(import_path)
    print(f"Executing: {" ".join(args)}")
    subprocess.run(args)

def generate_ico():
    export_path = os.path.join(PROJECT_HOME, "src-tauri/icons/icon.ico")
    args = ["convert"]
    for size in ICO_SIZES:
        import_path = os.path.join(PROJECT_HOME, "src-tauri/icons", f"{size}x{size}.png")
        args.append(import_path)
    args += ["-colors", "512", export_path]
    print(f"Executing: {" ".join(args)}")
    subprocess.run(args)


def main():
    for size in SIZES:
        generate_icon(size)
    for size in SQUARE_SIZES:
        generate_square(size)
    ## Extra icons and logos
    generate_square(size=50, output_name="StoreLogo.png")
    generate_plain()
    generate_tray(monochrome=True)
    generate_icns()
    generate_ico()
    # Generate resources
    shutil.copyfile(os.path.join(PROJECT_HOME, "src-tauri/icons/icon.icns"), os.path.join(PROJECT_HOME, "src/resources/icons/appIcon.icns"))
    shutil.copyfile(os.path.join(PROJECT_HOME, "src-tauri/icons/icon.svg"), os.path.join(PROJECT_HOME, "src/resources/icons/appIcon.svg"))
    shutil.copyfile(os.path.join(PROJECT_HOME, "src-tauri/icons/icon.ico"), os.path.join(PROJECT_HOME, "src/resources/icons/favicon.ico"))
    shutil.copyfile(os.path.join(PROJECT_HOME, "src-tauri/icons/icon.png"), os.path.join(PROJECT_HOME, "src/resources/icons/favicon.png"))
    shutil.copyfile(os.path.join(PROJECT_HOME, "src-tauri/icons/icon.png"), os.path.join(PROJECT_HOME, "src/resources/icons/icon.png"))
    shutil.copyfile(os.path.join(PROJECT_HOME, "src-tauri/icons/icon.png"), os.path.join(PROJECT_HOME, "src/resources/icons/appIcon.png"))
    shutil.copyfile(os.path.join(PROJECT_HOME, "src-tauri/icons/trayIcon.png"), os.path.join(PROJECT_HOME, "src/resources/icons/trayIcon.png"))
    # Public and docs icons
    shutil.copyfile(os.path.join(PROJECT_HOME, "src-tauri/icons/icon.ico"), os.path.join(PROJECT_HOME, "public/favicon.ico"))
    shutil.copyfile(os.path.join(PROJECT_HOME, "src-tauri/icons/icon.png"), os.path.join(PROJECT_HOME, "public/favicon.png"))
    shutil.copyfile(os.path.join(PROJECT_HOME, "src-tauri/icons/icon.ico"), os.path.join(PROJECT_HOME, "docs/favicon.ico"))
    shutil.copyfile(os.path.join(PROJECT_HOME, "src-tauri/icons/16x16.png"), os.path.join(PROJECT_HOME, "docs/favicon-16x16.png"))
    shutil.copyfile(os.path.join(PROJECT_HOME, "src-tauri/icons/32x32.png"), os.path.join(PROJECT_HOME, "docs/favicon-32x32.png"))
    shutil.copyfile(os.path.join(PROJECT_HOME, "src-tauri/icons/150x150.png"), os.path.join(PROJECT_HOME, "docs/mstile-150x150.png"))
    shutil.copyfile(os.path.join(PROJECT_HOME, "src-tauri/icons/180x180.png"), os.path.join(PROJECT_HOME, "docs/apple-touch-icon.png"))
    shutil.copyfile(os.path.join(PROJECT_HOME, "src-tauri/icons/192x192.png"), os.path.join(PROJECT_HOME, "docs/android-chrome-192x192.png"))
    shutil.copyfile(os.path.join(PROJECT_HOME, "src-tauri/icons/512x512.png"), os.path.join(PROJECT_HOME, "docs/android-chrome-512x512.png"))
    shutil.copyfile(os.path.join(PROJECT_HOME, "src-tauri/icons/icon.svg"), os.path.join(PROJECT_HOME, "docs/safari-pinned-tab.svg"))

if __name__ == "__main__":
    main()

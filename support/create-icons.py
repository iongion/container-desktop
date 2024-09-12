import os
import subprocess
import shutil

PROJECT_HOME = os.path.dirname(os.path.dirname(__file__))
SOURCE_PATH = os.path.join(PROJECT_HOME, "support/resources/appIcon-source.svg")
SOURCE_MONOCHROME_PATH = os.path.join(PROJECT_HOME, "support/resources/appIcon-monochrome.svg")
SIZES = [16, 32, 48, 64, 71, 96, 128, 150, 300, 180, 192, 256, 512, 1024]
SQUARE_SIZES = [30, 44, 71, 89, 107, 142, 150, 284, 300, 310]
ICO_SIZES = [16, 32, 48, 128, 256]
ICNS_SIZES =[16, 32, 48, 128, 256, 512]
OUTPUT_PATH = os.path.join(PROJECT_HOME, "temp/icons")

def generate_icon(size=16):
    export_path = os.path.join(OUTPUT_PATH, f"{size}x{size}.png")
    export_2x_path = os.path.join(OUTPUT_PATH, f"{int(size/2)}x{int(size/2)}@2x.png") if size > 16 else None
    args = [
        "resvg",
        "--width", str(size),
        "--height", str(size),
        SOURCE_PATH,
        export_path
    ]
    args_2x = [
        "resvg",
        "--width", str(int(size/2)),
        "--height", str(int(size/2)),
        SOURCE_PATH,
        export_2x_path
    ]
    print(f"Executing: {' '.join(args)}")
    subprocess.run(args)
    if export_2x_path is not None:
        print(f"Executing: {' '.join(args_2x)}")
        subprocess.run(args_2x)



def generate_square(size, output_name=None):
    export_path = os.path.join(OUTPUT_PATH, f"Square{size}x{size}Logo.png" if output_name is None else output_name)
    args = [
        "resvg",
        "--width", str(size),
        "--height", str(size),
        SOURCE_PATH,
        export_path
    ]
    print(f"Executing: {' '.join(args)}")
    subprocess.run(args)

def generate_plain():
    export_path = os.path.join(OUTPUT_PATH, "icon.svg")
    args = [
        "svgo.cmd" if os.name == 'nt' else "svgo",
        SOURCE_PATH,
        "-o",
        export_path
    ]
    print(f"Optimizing: {' '.join(args)}")
    subprocess.run(args)



def generate_tray(size=64, monochrome=False):
    export_path = os.path.join(OUTPUT_PATH, "trayIcon.png")
    args = [
        "resvg",
        "--width", str(size),
        "--height", str(size),
        SOURCE_MONOCHROME_PATH if monochrome else SOURCE_PATH,
        export_path,
    ]
    if os.path.exists(export_path):
        print(f"Executing: {' '.join(args)} - skip")
    else:
        print(f"Executing: {' '.join(args)}")
        subprocess.run(args)


def generate_icns():
    export_path = os.path.join(OUTPUT_PATH, "icon")
    import_size = 512
    import_path = os.path.join(OUTPUT_PATH, f"{import_size}x{import_size}.png")
    args = [
        # png2icons sample.png icon -allp -bc -i
        # export_path,
        "png2icons.cmd" if os.name == 'nt' else "png2icons",
        import_path,
        export_path,
        "-allp",
        "-bc",
        "-i"

    ]
    # for size in ICNS_SIZES:
    #     import_path = os.path.join(OUTPUT_PATH, f"{size}x{size}.png")
    #     args.append(import_path)
    print(f"Executing: {' '.join(args)}")
    subprocess.run(args)

def generate_ico():
    export_path = os.path.join(OUTPUT_PATH, "icon.ico")
    args = ["magick"]
    for size in ICO_SIZES:
        import_path = os.path.join(OUTPUT_PATH, f"{size}x{size}.png")
        args.append(import_path)
    args += ["-colors", "512", export_path]
    print(f"Executing: {' '.join(args)}")
    subprocess.run(args)


def generate_icons():
    os.makedirs(os.path.join(OUTPUT_PATH, "icons"), exist_ok=True)
    os.makedirs(os.path.join(PROJECT_HOME, "src/resources/icons"), exist_ok=True)
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
    return
    shutil.copyfile(os.path.join(OUTPUT_PATH, "96x96.png"), os.path.join(OUTPUT_PATH, "icon.png"))
    # Generate resources
    shutil.copyfile(os.path.join(OUTPUT_PATH, "icon.icns"), os.path.join(PROJECT_HOME, "src/resources/icons/appIcon.icns"))
    shutil.copyfile(os.path.join(OUTPUT_PATH, "icon.svg"), os.path.join(PROJECT_HOME, "src/resources/icons/appIcon.svg"))
    shutil.copyfile(os.path.join(OUTPUT_PATH, "icon.ico"), os.path.join(PROJECT_HOME, "src/resources/icons/favicon.ico"))
    shutil.copyfile(os.path.join(OUTPUT_PATH, "96x96.png"), os.path.join(PROJECT_HOME, "src/resources/icons/favicon.png"))
    shutil.copyfile(os.path.join(OUTPUT_PATH, "512x512.png"), os.path.join(PROJECT_HOME, "src/resources/icons/icon.png"))
    shutil.copyfile(os.path.join(OUTPUT_PATH, "96x96.png"), os.path.join(PROJECT_HOME, "src/resources/icons/appIcon.png"))
    shutil.copyfile(os.path.join(OUTPUT_PATH, "trayIcon.png"), os.path.join(PROJECT_HOME, "src/resources/icons/trayIcon.png"))
    # Public and docs icons
    shutil.copyfile(os.path.join(OUTPUT_PATH, "icon.ico"), os.path.join(PROJECT_HOME, "public/favicon.ico"))
    shutil.copyfile(os.path.join(OUTPUT_PATH, "96x96.png"), os.path.join(PROJECT_HOME, "public/favicon.png"))
    shutil.copyfile(os.path.join(OUTPUT_PATH, "icon.svg"), os.path.join(PROJECT_HOME, "docs/img/logo.svg"))
    shutil.copyfile(os.path.join(OUTPUT_PATH, "icon.ico"), os.path.join(PROJECT_HOME, "docs/favicon.ico"))
    shutil.copyfile(os.path.join(OUTPUT_PATH, "16x16.png"), os.path.join(PROJECT_HOME, "docs/favicon-16x16.png"))
    shutil.copyfile(os.path.join(OUTPUT_PATH, "32x32.png"), os.path.join(PROJECT_HOME, "docs/favicon-32x32.png"))
    shutil.copyfile(os.path.join(OUTPUT_PATH, "150x150.png"), os.path.join(PROJECT_HOME, "docs/mstile-150x150.png"))
    shutil.copyfile(os.path.join(OUTPUT_PATH, "180x180.png"), os.path.join(PROJECT_HOME, "docs/apple-touch-icon.png"))
    shutil.copyfile(os.path.join(OUTPUT_PATH, "192x192.png"), os.path.join(PROJECT_HOME, "docs/android-chrome-192x192.png"))
    shutil.copyfile(os.path.join(OUTPUT_PATH, "512x512.png"), os.path.join(PROJECT_HOME, "docs/android-chrome-512x512.png"))
    shutil.copyfile(os.path.join(OUTPUT_PATH, "icon.svg"), os.path.join(PROJECT_HOME, "docs/safari-pinned-tab.svg"))

if __name__ == "__main__":
    generate_icons()

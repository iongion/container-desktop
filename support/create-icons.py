import os
import subprocess
import sys


PROJECT_HOME = os.path.dirname(os.path.dirname(__file__))
SOURCE_PATH = os.path.join(PROJECT_HOME, "support/resources/appIcon-source.svg")
SOURCE_MONOCHROME_PATH = os.path.join(PROJECT_HOME, "support/resources/appIcon-monochrome.svg")
SIZES = [16, 32, 48, 64, 71, 96, 128, 150, 300, 180, 192, 256, 512, 1024]
SQUARE_SIZES = [30, 44, 71, 89, 107, 142, 150, 284, 300, 310]
ICO_SIZES = [16, 32, 48, 128, 256]
ICNS_SIZES = [16, 32, 48, 128, 256, 512]
OUTPUT_PATH = os.path.join(PROJECT_HOME, "temp/icons")
APPX_PATH = os.path.join(PROJECT_HOME, "src/resources/appx")

# Windows Store (appx/MSIX) tiles + logos, keyed by on-disk name -> pixel size,
# rendered straight into src/resources/appx from the same vector master as every
# other icon. Keeping them in this pipeline means a rebrand can't leave the store
# tiles stranded on old art the way the hand-assembled Sep-2024 set was.
# Wide310x150Logo is non-square and handled separately.
APPX_SQUARES = {
    "Square44x44Logo.png": 44,
    "StoreLogo.png": 50,
    "71x71.png": 71,
    "SmallTile.png": 71,
    "150x150.png": 150,
    "Square150x150Logo.png": 150,
    "300x300.png": 300,
    "LargeTile.png": 310,
}


def generate_icon(size=16):
    export_path = os.path.join(OUTPUT_PATH, f"{size}x{size}.png")
    export_2x_path = os.path.join(OUTPUT_PATH, f"{int(size / 2)}x{int(size / 2)}@2x.png") if size > 16 else None
    args = [
        "resvg",
        "--width",
        str(size),
        "--height",
        str(size),
        SOURCE_PATH,
        export_path,
    ]
    args_2x = [
        "resvg",
        "--width",
        str(int(size / 2)),
        "--height",
        str(int(size / 2)),
        SOURCE_PATH,
        export_2x_path,
    ]
    print(f"Executing: {' '.join(args)}")
    subprocess.run(args, check=True)
    if export_2x_path is not None:
        print(f"Executing: {' '.join(args_2x)}")
        subprocess.run(args_2x, check=True)


def generate_square(size, output_name=None):
    export_path = os.path.join(
        OUTPUT_PATH,
        f"Square{size}x{size}Logo.png" if output_name is None else output_name,
    )
    args = [
        "resvg",
        "--width",
        str(size),
        "--height",
        str(size),
        SOURCE_PATH,
        export_path,
    ]
    print(f"Executing: {' '.join(args)}")
    subprocess.run(args, check=True)


def generate_plain():
    export_path = os.path.join(OUTPUT_PATH, "icon.svg")
    args = ["svgo.cmd" if os.name == "nt" else "svgo", SOURCE_PATH, "-o", export_path]
    print(f"Optimizing: {' '.join(args)}")
    subprocess.run(args, check=True)


def generate_tray(size=64, monochrome=False):
    export_path = os.path.join(OUTPUT_PATH, "trayIcon.png")
    args = [
        "resvg",
        "--width",
        str(size),
        "--height",
        str(size),
        SOURCE_MONOCHROME_PATH if monochrome else SOURCE_PATH,
        export_path,
    ]
    if os.path.exists(export_path):
        print(f"Executing: {' '.join(args)} - skip")
    else:
        print(f"Executing: {' '.join(args)}")
        subprocess.run(args, check=True)


def generate_icns():
    export_path = os.path.join(OUTPUT_PATH, "icon")
    import_size = 512
    import_path = os.path.join(OUTPUT_PATH, f"{import_size}x{import_size}.png")
    args = [
        # png2icons sample.png icon -allp -bc -i
        # export_path,
        "png2icons.cmd" if os.name == "nt" else "png2icons",
        import_path,
        export_path,
        "-allp",
        "-bc",
        "-i",
    ]
    # for size in ICNS_SIZES:
    #     import_path = os.path.join(OUTPUT_PATH, f"{size}x{size}.png")
    #     args.append(import_path)
    print(f"Executing: {' '.join(args)}")
    subprocess.run(args, check=True)


def generate_ico():
    export_path = os.path.join(OUTPUT_PATH, "icon.ico")
    args = ["magick"]
    for size in ICO_SIZES:
        import_path = os.path.join(OUTPUT_PATH, f"{size}x{size}.png")
        args.append(import_path)
    args += ["-colors", "512", export_path]
    print(f"Executing: {' '.join(args)}")
    subprocess.run(args, check=True)


def generate_appx_square(size, output_name):
    export_path = os.path.join(APPX_PATH, output_name)
    args = ["resvg", "--width", str(size), "--height", str(size), SOURCE_PATH, export_path]
    print(f"Executing: {' '.join(args)}")
    subprocess.run(args, check=True)


def generate_appx_wide(width=310, height=150, mark=130):
    # resvg only rasterizes the square viewBox, so render the mark and letterbox it
    # onto a transparent width x height canvas to keep the wide tile centered.
    export_path = os.path.join(APPX_PATH, "Wide310x150Logo.png")
    mark_path = os.path.join(APPX_PATH, "_wide-mark.png")
    render = ["resvg", "--width", str(mark), "--height", str(mark), SOURCE_PATH, mark_path]
    print(f"Executing: {' '.join(render)}")
    subprocess.run(render, check=True)
    compose = [
        "magick",
        mark_path,
        "-background",
        "none",
        "-gravity",
        "center",
        "-extent",
        f"{width}x{height}",
        "-strip",
        export_path,
    ]
    print(f"Executing: {' '.join(compose)}")
    subprocess.run(compose, check=True)
    os.remove(mark_path)


def generate_appx():
    os.makedirs(APPX_PATH, exist_ok=True)
    for output_name, size in APPX_SQUARES.items():
        generate_appx_square(size, output_name)
    generate_appx_wide()


def generate_icons():
    os.makedirs(os.path.join(OUTPUT_PATH, "icons"), exist_ok=True)
    os.makedirs(os.path.join(PROJECT_HOME, "src/resources/icons"), exist_ok=True)
    for size in SIZES:
        generate_icon(size)
    for size in SQUARE_SIZES:
        generate_square(size)
    ## Extra icons and logos
    generate_square(size=50, output_name="StoreLogo.png")
    ## Windows Store tiles, rendered straight into src/resources/appx
    generate_appx()
    generate_plain()
    generate_tray(monochrome=True)
    generate_icns()
    generate_ico()


if __name__ == "__main__":
    if "appx" in sys.argv[1:]:
        generate_appx()
    else:
        generate_icons()

# How to build

1. Preparing the infrastructure

    ```bash
    make prepare
    ```

2. Build the application

    ```bash
    make build
    ```

3. Create bundles (snap, deb, rpm, appImage, dmg, exe)

    ```bash
    TARGET=linux make bundle
    ```

Then see `shell/dist` for the output assets.

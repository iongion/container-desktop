# How to build

1. Preparing the infrastructure

    ```bash
    inv prepare
    ```

2. Build the application

    ```bash
    NODE_ENV=production APP_ENV=production inv build
    ```

3. Create bundles (snap, deb, rpm, appImage, dmg, exe)

    ```bash
    NODE_ENV=production APP_ENV=production inv bundle
    ```

Then see `shell/dist` for the output assets.
